// Обновляет журналы точности анонсов (scripts/journals/*): окна kartel, история
// промо-процентов, журнал прогонов kartel, структура XML. Запускается шагом
// часового воркфлоу после живых запросов kartel. Журнал дат анонсов
// (date-changes.jsonl) пишет сам build-announcements.ts. Описание всех журналов
// в scripts/journals/README.md.
//
// Ничего не критично для прогона: при любом сбое пишет в лог и выходит, не
// трогая остальное. Без живого снэпшота kartel окна и промо не обновляются.
import { getLiveSnapshot } from './kartel-filter-dates'
import { hasLivePromoData, loadPromoPercents } from './kartel-promo-percents'
import { fetchGameXml } from './game-xml-cache'
import { runMain } from './lib/run-main'
import {
  appendJsonl,
  buildKartelRun,
  extractXmlStructure,
  journalPath,
  observeWindows,
  promoTransitions,
  readJson,
  sameStructure,
  writeJsonIfChanged,
  type PromoJournal,
  type WindowsJournal,
  type XmlStructure,
} from './lib/journals'

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const DAILYPOPUP_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dailypopup.xml'
const RUNS_CAP = 600

async function main() {
  const nowIso = new Date().toISOString()
  const snap = await getLiveSnapshot()
  const havePromo = await hasLivePromoData()
  const promos = havePromo ? await loadPromoPercents() : {}

  // Журнал прогонов пишем всегда: сбой запроса тоже данные (для статистики).
  const run = buildKartelRun({
    nowIso,
    fetchOutcome: process.env.KARTEL_FETCH_OUTCOME || 'unknown',
    status: snap.status,
    meta: snap.meta,
    filters: snap.filters,
    promoCount: havePromo ? Object.keys(promos).length : null,
  })
  await appendJsonl(journalPath('kartel-runs.jsonl'), [run], RUNS_CAP)
  console.log(
    `[JOURNALS] kartel-runs: ${run.fetch}/${run.status}, окон ${run.returned ?? '?'}, горизонт ${run.horizonDays ?? '?'} сут.`,
  )

  // Окна kartel: только при живом снэпшоте (partial тоже: возвращённые окна настоящие).
  if (snap.status !== 'missing') {
    const prev = await readJson<WindowsJournal | null>(journalPath('kartel-windows.json'), null)
    const { next, added, changed } = observeWindows(prev, snap.filters, nowIso)
    const wrote = await writeJsonIfChanged(journalPath('kartel-windows.json'), next)
    console.log(
      `[JOURNALS] kartel-windows: новых ${added}, изменённых ${changed}, файл ${wrote ? 'обновлён' : 'без изменений'}`,
    )
  } else {
    console.log('[JOURNALS] kartel-windows: живого снэпшота нет, пропуск')
  }

  // История промо: пустой ответ считается сбоем и ничего не выключает.
  if (havePromo) {
    const prev = await readJson<PromoJournal | null>(journalPath('promo-history.json'), null)
    const { next, changes } = promoTransitions(prev, promos, nowIso)
    await writeJsonIfChanged(journalPath('promo-history.json'), next)
    for (const c of changes)
      console.log(`[JOURNALS] промо ${c.name}: ${c.from ?? '-'} -> ${c.to ?? '-'}`)
  }

  // Структура XML: файл переписывается только при реальном изменении порядка.
  try {
    const [shop, popup] = await Promise.all([
      fetchGameXml(SHOPITEMS_URL),
      fetchGameXml(DAILYPOPUP_URL),
    ])
    const structure = extractXmlStructure(shop, popup, nowIso)
    const prev = await readJson<XmlStructure | null>(journalPath('xml-structure.json'), null)
    if (!sameStructure(prev, structure)) {
      await writeJsonIfChanged(journalPath('xml-structure.json'), structure)
      console.log(
        `[JOURNALS] xml-structure: обновлён (спринтов ${Object.keys(structure.shopitems).length}, пул ${structure.dailyPool.length})`,
      )
    } else {
      console.log('[JOURNALS] xml-structure: без изменений')
    }
  } catch (e) {
    console.warn(
      '[JOURNALS] xml-structure: XML не скачался, пропуск:',
      e instanceof Error ? e.message : e,
    )
  }
}

runMain(import.meta.url, 'JOURNALS', main)
