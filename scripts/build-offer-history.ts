// История последних офферов мутантов (даты из kartel-фильтров) для модалки мутанта.
//
// Источники (везде дата = начало окна фильтра kartel, живой снимок или
// постоянный scripts/kartel/date-ledger.json):
//  - магазин/боксы/наборы: товар shopitems.xml с Filter -> мутанты по записям
//    obtain.json с тем же itemId, либо сам товар - мутант (itemId Specimen_XX_YY).
//    Цена - из <Cost> (золото/серебро) или RealPrices USD (наборы).
//  - реакторы: gacha.json (filter gacha_pack_<id>) -> мутанты генератора.
//    Цена - hc_cost золота и/или token_cost жетонов реактора.
//  - рейды/лесенки: filter_dungeon_<raid|challenge|experiment>_<id> -> mutantId
//    из guides/raids.json и guides/special-ladders.json.
//  - залы обмена (джекпот/ивент): контракты gamedefinitions.xml (Filter окна
//    ротации). Цена в жетонах уже стоит в самой подписи записи obtain.json.
//  - Анализатор тайны (Building_Mystery): 6 контрактов с общим фильтром окна
//    ротации; запись obtain.json находим по скину контракта.
//  - PvP-сезоны: даты старта сезонов по постам канала t.me/mutants_mgg_fb (см.
//    PVP_SEASON_RUNS), только на участках, где сетка подтверждена якорями.
//  - добор из scripts/obtain-last-seen.json для товаров, у которых окна нет.
//
// Не покрыто сознательно: PvP-сезоны вне подтверждённых участков, рулетки,
// квесты, кампания, скрещивание, бинго - у них нет дат в данных.
// Покрытие НЕПОЛНОЕ по конструкции: kartel отдаёт окна лишь для части фильтров;
// мутанты без известных дат в файле просто отсутствуют.
//
// Отдельного журнала нет сознательно: date-ledger.json уже копит даты
// фильтров навсегда. Выходной файл дополнительно сливается с предыдущей версией
// (merge-only), чтобы пропавший из kartel фильтр не стирал уже показанную дату.
//
// Выход: src/data/mutants/offer-history.json
//   { mutantId: [[date, ref, price|null], ...] }, новые первыми, до KEEP записей.
//   ref: itemId товара (магазин) либо "<type>|<where>" записи obtain.json -
//   модалка по ref находит запись и берёт её локализованную подпись.
//   price: [[cur, amount], ...], cur: g золото, s серебро, $ USD, t жетон реактора.
// Защита от вайпа (см. память auto-announcements-architecture): при снимке не
// 'full' скрипт ничего не пишет.
import fs from 'fs/promises'
import path from 'path'
import { fetchGameXml } from './game-xml-cache'
import { getLiveSnapshot } from './kartel-filter-dates'
import { runMain } from './lib/run-main'

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const GAMEDEFS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gamedefinitions.xml'
const ROOT = process.cwd()
const P = (p: string) => path.join(ROOT, p)
const OUT_PATH = P('src/data/mutants/offer-history.json')

const KEEP = 10
const MAX_SHOP_WINDOW_DAYS = 31
const DAY_MS = 24 * 60 * 60 * 1000

// Участки непрерывной 14-дневной сетки PvP-сезонов (старт - понедельник ~07:00 UTC).
// Источник - посты "Стартовал новый сезон PvP" в t.me/mutants_mgg_fb, сопоставленные
// с номером сезона по главной награде (src/data/guides/pvp-seasons.json). Каждый
// участок проверен несколькими независимыми постами, попадающими на сетку:
//  263-266: 2023-05-08 Микс0-Лог, 06-05 Король Лулу, 06-19 Ревозавр.
//  281-302: 2024-02-05 Энвайро, 03-18 Звёздный доктор, 04-29 Окулюс, 06-24 и
//           07-08, 08-21 (пост на 2 дня позже), 11-27 УТ-Мститель (на 2 дня позже).
//  304-329: 2024-12-20 Сантагонист (на 4 дня позже), 2025-02-24 Обрея, 04-21
//           Иши-но-Оками, 07-28 Франкендворф, 09-22 Gwenn, 10-20 Гамаллия,
//           11-03 Окулюс, 12-01 Ан0малия.
//  332-346: 2026-01-19 Окулюс, 02-16 Ходячий кошмар, 03-02 Совабатор, 03-16
//           Энвайро, 04-13 Коктуй, 07-07 Gwenn, 07-20 Раздор, 08-03 Ктопи.
// Между участками сетка сбивается (303, 330-331, 267-280, 296-301 вне якорей) -
// там даты не ставим. Сезон 348 - пост 2026-09-01 (после 9-дневного 347).
const PVP_SEASON_RUNS: { from: number; to: number; start: string }[] = [
  { from: 263, to: 266, start: '2023-05-08' },
  { from: 281, to: 302, start: '2024-02-05' },
  { from: 304, to: 329, start: '2024-12-16' },
  { from: 332, to: 346, start: '2026-01-19' },
  { from: 348, to: 348, start: '2026-09-01' },
]
function pvpSeasonStart(season: number): string | null {
  for (const r of PVP_SEASON_RUNS) {
    if (season < r.from || season > r.to) continue
    const t = new Date(`${r.start}T00:00:00Z`).getTime() + (season - r.from) * 14 * DAY_MS
    return new Date(t).toISOString().slice(0, 10)
  }
  return null
}

type Price = [string, number][] | null
type Entry = [string, string, Price] // [date YYYY-MM-DD, ref, price]
type ObtainEntry = { type: string; where: string; itemId?: string }

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function main() {
  const snapshot = await getLiveSnapshot()
  if (snapshot.status !== 'full') {
    console.warn(`[offer-history] снимок ${snapshot.status} - файл не трогаем.`)
    return
  }

  const dateLedger = await readJson<Record<string, string>>(
    P('scripts/kartel/date-ledger.json'),
    {},
  )
  const obtain = await readJson<Record<string, ObtainEntry[]>>(
    P('src/data/mutants/obtain.json'),
    {},
  )
  const mutantIds = new Set(
    (await readJson<{ id: string }[]>(P('src/data/mutants/mutants.json'), [])).map((m) =>
      String(m.id).toLowerCase(),
    ),
  )

  // Окно фильтра -> дата начала. Для магазина только ограниченные окна (до 31
  // дня): окно без конца или на годы - постоянный товар, "даты оффера" там нет.
  // Для реакторов/рейдов/залов (longOk) окно может быть длинным - это сам ивент.
  function startDateFor(filter: string, longOk = false): string | null {
    const range = snapshot.filters[filter]
    if (range) {
      if (!range.end) return null
      const start = new Date(range.start).getTime()
      const end = new Date(range.end).getTime()
      if (!(end > start)) return null
      if (!longOk && end - start > MAX_SHOP_WINDOW_DAYS * DAY_MS) return null
      return range.start.slice(0, 10)
    }
    // Выпал из живого снимка - берём из date-ledger (там только start, а
    // длительность уже проверена 3-дневным гейтом при записи в журнал).
    const fromLedger = dateLedger[filter]
    return fromLedger ? fromLedger.slice(0, 10) : null
  }

  // mutantId -> "date|ref" -> price
  const found = new Map<string, Map<string, Price>>()
  const add = (mutantId: string, date: string, ref: string, price: Price) => {
    let m = found.get(mutantId)
    if (!m) found.set(mutantId, (m = new Map()))
    m.set(`${date}|${ref}`, price)
  }
  const obtainRef = (e: ObtainEntry) => `${e.type}|${e.where}`
  const stats: Record<string, number> = {}
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1)

  // ---- 1. Магазин / боксы / наборы ----
  const itemToMutants = new Map<string, Set<string>>()
  for (const [mutantId, entries] of Object.entries(obtain)) {
    for (const e of entries) {
      if (!e.itemId) continue
      let set = itemToMutants.get(e.itemId)
      if (!set) itemToMutants.set(e.itemId, (set = new Set()))
      set.add(mutantId.toLowerCase())
    }
  }
  const mutantsOfItem = (itemId: string): string[] => {
    const list = [...(itemToMutants.get(itemId) ?? [])]
    const direct = itemId.match(/^(Specimen_[A-Z]{2}_\d{2})(?:_|$)/i)?.[1]?.toLowerCase()
    if (direct && mutantIds.has(direct) && !list.includes(direct)) list.push(direct)
    return list
  }
  const shopXml = await fetchGameXml(SHOPITEMS_URL)
  const withWindow = new Set<string>()
  const priceByItem = new Map<string, Price>()
  for (const item of shopXml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const itemId = item.match(/itemId="([^"]+)"/)?.[1]
    if (!itemId) continue
    let price: Price = null
    const cost = item.match(/<Cost\b[^>]*amount="(\d+)"[^>]*type="(hardcurrency|softcurrency)"/)
    const usd = item.match(/<RealPrices\b[^>]*Currency="USD"[^>]*Value="([\d.]+)"/)
    if (cost) price = [[cost[2] === 'hardcurrency' ? 'g' : 's', Number(cost[1])]]
    else if (usd) price = [['$', Number(usd[1])]]
    priceByItem.set(itemId, price)
    const filter = item.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    if (!filter) continue
    const date = startDateFor(filter)
    if (!date) continue
    for (const mutantId of mutantsOfItem(itemId)) {
      add(mutantId, date, itemId, price)
      withWindow.add(itemId)
      bump('shop')
    }
  }
  // Добор из last-seen: только товары без найденного окна (иначе один оффер
  // показался бы дважды - датой начала и датой последнего открытия).
  const lastSeen = await readJson<Record<string, string>>(P('scripts/obtain-last-seen.json'), {})
  for (const [itemId, date] of Object.entries(lastSeen)) {
    if (itemId.startsWith('gacha:') || withWindow.has(itemId)) continue
    for (const mutantId of mutantsOfItem(itemId)) {
      add(mutantId, date, itemId, priceByItem.get(itemId) ?? null)
      bump('lastSeen')
    }
  }

  // ---- 2. Реакторы ----
  type Gacha = {
    token_cost?: number
    hc_cost?: number
    filter?: string
    basic_elements?: { specimen: string }[]
    completion_reward?: { specimen: string }
  }
  const gacha = await readJson<Record<string, Gacha>>(
    P('src/data/simulators/reactor/gacha.json'),
    {},
  )
  const gachaNames = await readJson<Record<string, string>>(
    P('src/data/simulators/reactor/gacha-name-ru.json'),
    {},
  )
  for (const [id, g] of Object.entries(gacha)) {
    const date = g.filter ? startDateFor(g.filter, true) : null
    const name = gachaNames[id]
    if (!date || !name) continue
    const where = `Реактор — ${name}`
    const price: [string, number][] = []
    if (g.hc_cost) price.push(['g', g.hc_cost])
    if (g.token_cost) price.push(['t', g.token_cost])
    const specimens = [
      ...(g.basic_elements ?? []).map((e) => e.specimen),
      ...(g.completion_reward ? [g.completion_reward.specimen] : []),
    ]
    for (const sp of new Set(specimens.map((s) => s.toLowerCase()))) {
      const entry = obtain[sp]?.find((e) => e.type === 'gacha' && e.where === where)
      if (!entry) continue
      add(sp, date, obtainRef(entry), price.length ? price : null)
      bump('gacha')
    }
  }

  // ---- 3. Рейды / лесенки ----
  type Dungeon = { id: string; name: string; mutantId?: string }
  const raids = await readJson<Dungeon[]>(P('src/data/guides/raids.json'), [])
  const special = await readJson<Record<string, Dungeon[]>>(
    P('src/data/guides/special-ladders.json'),
    {},
  )
  const dungeonById = new Map<string, Dungeon>()
  for (const r of raids) dungeonById.set(`raid_${r.id}`, r)
  for (const [kind, list] of Object.entries(special)) {
    for (const d of list) dungeonById.set(`${kind}_${d.id}`, d)
  }
  for (const filter of Object.keys(snapshot.filters)) {
    const key = filter.match(/^filter_dungeon_(.+)$/)?.[1]
    const d = key ? dungeonById.get(key) : undefined
    if (!d?.mutantId) continue
    const date = startDateFor(filter, true)
    if (!date) continue
    const sp = d.mutantId.toLowerCase()
    const entry = obtain[sp]?.find(
      (e) => e.type === 'event_raid' && e.where.endsWith(`: ${d.name}`),
    )
    if (!entry) continue
    add(sp, date, obtainRef(entry), null)
    bump('dungeon')
  }

  // ---- 4. Залы обмена (джекпот / ивент) ----
  // Контракт: InteractiveAction CONTRACT_n (Cost + Filter) -> состояние WORKING_n ->
  // READY_n -> награда-мутант. Тот же разбор, что fetchHallContracts в
  // build-announcements.ts (там он не экспортируется).
  const gameXml = await fetchGameXml(GAMEDEFS_URL)
  const HALLS = [
    {
      entityId: 'Building_Tokens_Jackpot',
      type: 'jackpot_hall',
      tokenId: 'Material_Jackpot_Token',
    },
    { entityId: 'Building_Event_1', type: 'event_hall', tokenId: 'Material_Event_Token' },
  ]
  for (const { entityId, type, tokenId } of HALLS) {
    const block = gameXml.match(
      new RegExp(`<EntityDescriptor id="${entityId}"[^>]*>([\\s\\S]*?)<\\/EntityDescriptor>`),
    )
    if (!block) continue
    const inner = block[1]
    const costByWorking = new Map<
      string,
      { amount: number; tokenId: string; filter: string | null }
    >()
    for (const m of inner.matchAll(
      /<InteractiveAction[^>]*target="(WORKING_\d+)"[^>]*id="CONTRACT_\d+">([\s\S]*?)<\/InteractiveAction>/g,
    )) {
      const cost = m[2].match(/<Cost amount="(\d+)" type="entity" id="([^"]+)"/)
      const filter = m[2].match(/<Filter>([^<]*)<\/Filter>/)
      if (cost) {
        costByWorking.set(m[1], {
          amount: Number(cost[1]),
          tokenId: cost[2],
          filter: filter?.[1] || null,
        })
      }
    }
    const workingByReady = new Map<string, string>()
    for (const m of inner.matchAll(
      /<State[^>]*id="(WORKING_\d+)"[^>]*>\s*<TimeAction[^>]*target="(READY_\d+)"/g,
    )) {
      workingByReady.set(m[2], m[1])
    }
    for (const m of inner.matchAll(
      /<State[^>]*id="(READY_\d+)"[^>]*>\s*<InteractiveAction[^>]*id="RECOLT"[^>]*>\s*<Reward\b([^/>]*)\/?>/g,
    )) {
      const spec = m[2].match(/id="([^"]+)"/)?.[1]
      if (!spec || !/^Specimen_/i.test(spec)) continue
      const cost = costByWorking.get(workingByReady.get(m[1]) ?? '')
      if (!cost || cost.tokenId !== tokenId || !cost.filter) continue
      const date = startDateFor(cost.filter, true)
      if (!date) continue
      const sp = spec.toLowerCase()
      // Подпись записи уже содержит цену в жетонах ("Зал обмена - 1300 жетонов ...").
      const amountRe = new RegExp(`(^|\\D)${cost.amount}(\\D|$)`)
      const entry = obtain[sp]?.find((e) => e.type === type && amountRe.test(e.where))
      if (!entry) continue
      add(sp, date, obtainRef(entry), null)
      bump('hall')
    }
  }

  // ---- 5. Анализатор тайны (Building_Mystery) ----
  // 6 контрактов-рецептов с общим фильтром окна ротации. Мутант награды - со
  // скином, поэтому запись obtain.json ищем по скину в подписи "(3★, скин «X»)".
  const mysteryBlock = gameXml.match(
    /<EntityDescriptor id="Building_Mystery"[^>]*>([\s\S]*?)<\/EntityDescriptor>/,
  )
  if (mysteryBlock) {
    const inner = mysteryBlock[1]
    const filterByNum = new Map<string, string>()
    for (const m of inner.matchAll(
      /<InteractiveAction[^>]*target="WORKING_(\d+)"[^>]*id="CONTRACT_\d+">([\s\S]*?)<\/InteractiveAction>/g,
    )) {
      const filter = m[2].match(/<Filter>([^<]*)<\/Filter>/)?.[1]
      if (filter) filterByNum.set(m[1], filter)
    }
    for (const m of inner.matchAll(/<State[^>]*id="READY_(\d+)"[^>]*>([\s\S]*?)<\/State>/g)) {
      const reward = m[2].match(/<Reward id="([^"]+)">([\s\S]*?)<\/Reward>/)
      const filter = filterByNum.get(m[1])
      if (!reward || !filter) continue
      const skin = reward[2].match(/<Tag key="skin" value="([^"]+)"/)?.[1]
      const date = startDateFor(filter, true)
      if (!skin || !date) continue
      const sp = reward[1].toLowerCase()
      const entry = obtain[sp]?.find((e) => e.type === 'mystery_hall' && e.where.includes(`«${skin}»`))
      if (!entry) continue
      add(sp, date, obtainRef(entry), null)
      bump('mystery')
    }
  }

  // ---- 6. PvP-сезоны ----
  for (const [mutantId, entries] of Object.entries(obtain)) {
    for (const e of entries) {
      if (e.type !== 'pvp') continue
      const season = e.where.match(/(?:Сезон|Season)\s+(\d+)/i)?.[1]
      const date = season ? pvpSeasonStart(Number(season)) : null
      if (!date) continue
      add(mutantId.toLowerCase(), date, obtainRef(e), null)
      bump('pvp')
    }
  }

  // Merge-only с предыдущим выходом: ничего не удаляем.
  const prev = await readJson<Record<string, [string, string, Price?][]>>(OUT_PATH, {})
  for (const [mutantId, entries] of Object.entries(prev)) {
    for (const e of entries) {
      if (!found.get(mutantId)?.has(`${e[0]}|${e[1]}`)) add(mutantId, e[0], e[1], e[2] ?? null)
    }
  }
  const out: Record<string, Entry[]> = {}
  for (const mutantId of [...found.keys()].sort()) {
    const entries: Entry[] = [...found.get(mutantId)!].map(([k, price]) => {
      const i = k.indexOf('|')
      return [k.slice(0, i), k.slice(i + 1), price]
    })
    entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : b[0].localeCompare(a[0])))
    out[mutantId] = entries.slice(0, KEEP)
  }

  const nextOutText = JSON.stringify(out) + '\n'
  const prevOutText = await fs.readFile(OUT_PATH, 'utf-8').catch(() => '')
  if (prevOutText !== nextOutText) await fs.writeFile(OUT_PATH, nextOutText)
  console.log(
    `[offer-history] мутантов с датами: ${Object.keys(out).length}; записей по источникам: ${JSON.stringify(stats)}`,
  )
}

runMain(import.meta.url, 'offer-history', main)
