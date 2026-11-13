// Журнал ротаций залов обмена: Зал испытаний, джекпот-зал, Анализатор тайны.
// Что в нём и как датируется - в scripts/lib/hall-rotations.ts и
// scripts/journals/README.md. Пишет scripts/journals/hall-rotations.json;
// из него build-offer-history.ts берёт даты Зала испытаний.
//
// Не зависит от того, "полный" ли снэпшот kartel: состав слотов читается из живого
// XML, а окна kartel (если есть) только уточняют дату. Любой сбой XML - пропуск
// прогона без изменения файла. Каждый прогон дописывает строку в
// offer-history-runs.jsonl.
import { fetchGameXml } from './game-xml-cache'
import { getLiveSnapshot, loadDateLedger } from './kartel-filter-dates'
import { runMain } from './lib/run-main'
import {
  observeHall,
  parseHallRewards,
  parseMysteryRewards,
  type HallEvent,
  type HallHint,
  type HallJournal,
  type HallObservation,
  type NewsWindow,
} from './lib/hall-rotations'
import { appendJsonl, journalPath, readJson, writeJsonIfChanged } from './lib/journals'

const GAMEDEFS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gamedefinitions.xml'
const RUNS_CAP = 600
const NEWS_FILTER_PREFIX = 'Daily_news_challenge_hall_block_'

async function main() {
  const nowIso = new Date().toISOString()
  let xml: string
  try {
    xml = await fetchGameXml(GAMEDEFS_URL)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.warn('[hall-rotations] gamedefinitions.xml не скачался, пропуск:', reason)
    await appendJsonl(
      journalPath('offer-history-runs.jsonl'),
      [{ ts: nowIso, script: 'hall-rotations', status: 'xml_failed', reason }],
      RUNS_CAP,
    )
    return
  }

  const snap = await getLiveSnapshot()
  const ledger = await loadDateLedger()
  // Журнал окон kartel помнит окно, даже когда оно уже вышло за горизонт снэпшота.
  const windowsJournal = await readJson<{
    filters?: Record<string, { start: string | null; end: string | null }>
  } | null>(journalPath('kartel-windows.json'), null)
  const journaled = windowsJournal?.filters ?? {}

  // Окна: живой снэпшот в приоритете, иначе только старт из date-ledger.
  const windowOf = (name: string): { start: string; end: string | null } | null => {
    const live = snap.filters[name]
    if (live?.start) return { start: live.start, end: live.end ?? null }
    const j = journaled[name]
    if (j?.start) return { start: j.start, end: j.end ?? null }
    return ledger[name] ? { start: ledger[name], end: null } : null
  }
  const newsWindows: NewsWindow[] = [
    ...new Set([...Object.keys(snap.filters), ...Object.keys(journaled), ...Object.keys(ledger)]),
  ]
    .filter((n) => n.startsWith(NEWS_FILTER_PREFIX))
    .flatMap((name) => {
      const w = windowOf(name)
      return w ? [{ name, ...w }] : []
    })
  // Старт окна фильтров слотов: самый поздний среди слотов (новая ротация - свежий фильтр).
  const filterStartOf = (filters: (string | null)[]): HallHint['filterStart'] => {
    let best: { date: string; name: string } | null = null
    for (const f of filters) {
      const w = f ? windowOf(f) : null
      if (w && (!best || w.start.slice(0, 10) > best.date)) {
        best = { date: w.start.slice(0, 10), name: f! }
      }
    }
    return best
  }

  const journalFile = journalPath('hall-rotations.json')
  const journal = await readJson<HallJournal>(journalFile, {})

  const event = parseHallRewards(xml, 'Building_Event_1').filter(
    (r) => r.tokenId === 'Material_Event_Token',
  )
  const jackpot = parseHallRewards(xml, 'Building_Tokens_Jackpot').filter(
    (r) => r.tokenId === 'Material_Jackpot_Token' && r.filter,
  )
  const mystery = parseMysteryRewards(xml)

  const halls: {
    key: string
    obs: HallObservation | null
    hint: HallHint
    minSlots: number
  }[] = [
    {
      key: 'event_hall',
      obs: {
        slots: Object.fromEntries(event.map((r) => [r.slot, r.spec.toLowerCase()])),
        amounts: Object.fromEntries(event.map((r) => [r.slot, r.amount])),
      },
      hint: { newsWindows },
      minSlots: 3,
    },
    {
      key: 'jackpot_hall',
      obs: {
        slots: Object.fromEntries(jackpot.map((r) => [r.slot, r.spec.toLowerCase()])),
        amounts: Object.fromEntries(jackpot.map((r) => [r.slot, r.amount])),
      },
      hint: { filterStart: filterStartOf(jackpot.map((r) => r.filter)) },
      minSlots: 3,
    },
    {
      key: 'mystery_hall',
      obs: {
        slots: Object.fromEntries(
          mystery.map((r) => [r.slot, `${r.spec.toLowerCase()}|${r.skin}`]),
        ),
        amounts: {},
      },
      hint: { filterStart: filterStartOf(mystery.map((r) => r.filter)) },
      minSlots: 6,
    },
  ]

  const events: Record<string, HallEvent['kind'] | string> = {}
  for (const h of halls) {
    const { state, event: ev } = observeHall(journal[h.key], h.obs, nowIso, h.hint, h.minSlots)
    journal[h.key] = state
    events[h.key] = ev.kind === 'skipped' ? `skipped: ${ev.reason}` : ev.kind
    if (ev.kind === 'rotation' || ev.kind === 'date-updated') {
      console.log(`[hall-rotations] ${h.key}: ${ev.kind}, ${ev.date} (${ev.dateSource})`)
    }
    if (ev.kind === 'skipped') console.warn(`[hall-rotations] ${h.key}: ${ev.reason}`)
  }

  const wrote = await writeJsonIfChanged(journalFile, journal)
  await appendJsonl(
    journalPath('offer-history-runs.jsonl'),
    [
      {
        ts: nowIso,
        script: 'hall-rotations',
        status: snap.status,
        newsWindows: newsWindows.length,
        halls: events,
        wrote,
      },
    ],
    RUNS_CAP,
  )
  console.log(
    `[hall-rotations] ${JSON.stringify(events)}; файл ${wrote ? 'обновлён' : 'без изменений'}`,
  )
}

runMain(import.meta.url, 'hall-rotations', main)
