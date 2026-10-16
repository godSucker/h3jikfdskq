// Журналы для точности анонсов (scripts/journals/*). Состояние на момент
// прогона хранится в репозитории, а история версий лежит в git. Здесь только
// чистые функции (их покрывают тесты) и тонкие обёртки над файлами.
//
// Журналы и зачем они нужны, см. scripts/journals/README.md.
import fs from 'node:fs/promises'
import path from 'node:path'

export const JOURNALS_DIR = path.join(process.cwd(), 'scripts/journals')
export const journalPath = (name: string) => path.join(JOURNALS_DIR, name)

// ---------------------------------------------------------------------------
// Файловые обёртки
// ---------------------------------------------------------------------------

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

// Записывает JSON, только если содержимое изменилось (git-диффы без шума).
// Возвращает true, если файл реально перезаписан.
export async function writeJsonIfChanged(file: string, data: unknown): Promise<boolean> {
  const next = JSON.stringify(data, null, 2) + '\n'
  try {
    if ((await fs.readFile(file, 'utf-8')) === next) return false
  } catch {
    // файла нет - пишем
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, next, 'utf-8')
  return true
}

// Дописывает строки JSONL и обрезает файл до последних cap строк.
export async function appendJsonl(file: string, entries: unknown[], cap: number): Promise<number> {
  if (entries.length === 0) return 0
  let lines: string[] = []
  try {
    lines = (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean)
  } catch {
    // файла нет
  }
  lines.push(...entries.map((e) => JSON.stringify(e)))
  if (lines.length > cap) lines = lines.slice(lines.length - cap)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf-8')
  return entries.length
}

// ---------------------------------------------------------------------------
// 1. Журнал изменений дат анонсов (date-changes.jsonl)
//
// Каждое изменение даты у оффера в announcements.json: откуда, куда, каким
// методом. Строится сравнением файла до и после прогона, поэтому покрывает все
// пути записи (новая запись, дозаполнение, мердж, kartel) одним местом.
// ---------------------------------------------------------------------------

export interface DateSnap {
  start: string | null
  end: string | null
  approx: boolean
  unc: number
  src: string | null
}

export interface DateChange {
  ts: string
  cat: string
  ann: string
  sprint: string | null
  item: string
  from: DateSnap | null
  to: DateSnap | null
}

interface ItemLike {
  id: string
  exactDateLabel?: string | null
  exactDateStart?: string | null
  exactDateEnd?: string | null
  exactDateApprox?: boolean
  exactDateUncertainDays?: number
  exactDateSource?: string
}

export interface AnnouncementLike {
  id: string
  category: string
  sprintKey?: string
  items?: ItemLike[]
}

// Одно и то же мгновение пишется по-разному (".000Z" и "+00:00"), поэтому
// сравниваем и пишем в журнал нормализованное значение.
const iso = (s: string | null | undefined): string | null => {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function dateSnap(it: ItemLike): DateSnap | null {
  const start = iso(it.exactDateStart)
  if (!start && !it.exactDateLabel) return null
  return {
    start,
    end: iso(it.exactDateEnd),
    approx: it.exactDateApprox === true,
    unc: it.exactDateUncertainDays ?? 0,
    src: it.exactDateSource ?? null,
  }
}

const sameSnap = (a: DateSnap | null, b: DateSnap | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export function diffDateChanges(
  before: AnnouncementLike[],
  after: AnnouncementLike[],
  nowIso: string,
): DateChange[] {
  const key = (a: AnnouncementLike, it: ItemLike) => `${a.id}\u0001${it.id}`
  const prev = new Map<string, ItemLike>()
  for (const a of before) for (const it of a.items ?? []) prev.set(key(a, it), it)

  const out: DateChange[] = []
  const seen = new Set<string>()
  for (const a of after) {
    for (const it of a.items ?? []) {
      const k = key(a, it)
      seen.add(k)
      const old = prev.get(k)
      const from = old ? dateSnap(old) : null
      const to = dateSnap(it)
      if (!from && !to) continue
      if (sameSnap(from, to)) continue
      out.push({
        ts: nowIso,
        cat: a.category,
        ann: a.id,
        sprint: a.sprintKey ?? null,
        item: it.id,
        from,
        to,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 2. Журнал окон kartel (kartel-windows.json)
//
// date-ledger.json хранит только старт подтверждённого окна. Здесь по каждому
// фильтру: когда окно впервые увидели (отсюда срок предупреждения), какое оно
// и как менялось. Снэпшот kartel живёт в CI-артефакте 5 суток, этот журнал
// сохраняет главное навсегда.
// ---------------------------------------------------------------------------

export interface ObservedWindow {
  // null у записей, найденных при создании журнала: когда они появились на
  // самом деле, неизвестно, и считать по ним срок предупреждения нельзя.
  first: string | null
  start: string | null
  end: string | null
  changes?: { ts: string; start: string | null; end: string | null }[]
}

export interface WindowsJournal {
  version: 1
  bootstrapAt: string | null
  filters: Record<string, ObservedWindow>
}

export interface LiveWindow {
  start?: string | null
  end?: string | null
}

const MAX_WINDOW_CHANGES = 6

export function observeWindows(
  prev: WindowsJournal | null,
  live: Record<string, LiveWindow>,
  nowIso: string,
  maxAgeDays = 150,
): { next: WindowsJournal; added: number; changed: number } {
  const bootstrap = !prev || Object.keys(prev.filters).length === 0
  const filters: Record<string, ObservedWindow> = { ...(prev?.filters ?? {}) }
  const touchedNew: string[] = []
  const touchedChanged: string[] = []
  for (const [name, w] of Object.entries(live)) {
    const start = iso(w.start)
    const end = iso(w.end)
    if (!start) continue
    const old = filters[name]
    if (!old) {
      filters[name] = { first: bootstrap ? null : nowIso, start, end }
      touchedNew.push(name)
    } else if (old.start !== start || old.end !== end) {
      const changes = [...(old.changes ?? []), { ts: nowIso, start, end }].slice(
        -MAX_WINDOW_CHANGES,
      )
      filters[name] = { ...old, start, end, changes }
      touchedChanged.push(name)
    }
  }
  // Старые окна вычищаем, чтобы файл не рос бесконечно.
  const cutoff = new Date(nowIso).getTime() - maxAgeDays * 86_400_000
  for (const [name, w] of Object.entries(filters)) {
    const last = new Date(w.end ?? w.start ?? nowIso).getTime()
    if (last < cutoff) delete filters[name]
  }
  return {
    next: {
      version: 1,
      bootstrapAt: prev?.bootstrapAt ?? (bootstrap ? nowIso : null),
      filters,
    },
    added: touchedNew.filter((n) => n in filters).length,
    changed: touchedChanged.filter((n) => n in filters).length,
  }
}

// ---------------------------------------------------------------------------
// 3. История активных промо-акций (promo-history.json)
//
// ABGetExperiments отдаёт только активный процент (скидка на эво, реактор и
// т.п.). Журнал пишет момент включения, смены и выключения, чтобы знать, как
// акции шли раньше (в том числе процент скидки на эво).
// ---------------------------------------------------------------------------

export interface PromoChange {
  ts: string
  name: string
  from: number | null
  to: number | null
}

export interface PromoJournal {
  version: 1
  active: Record<string, number>
  log: PromoChange[]
}

const MAX_PROMO_LOG = 1000

// Пустой ответ считается сбоем запроса (в норме активны десятки экспериментов),
// поэтому по нему ничего не выключаем.
export function promoTransitions(
  prev: PromoJournal | null,
  current: Record<string, number>,
  nowIso: string,
): { next: PromoJournal; changes: PromoChange[] } {
  const base: PromoJournal = prev ?? { version: 1, active: {}, log: [] }
  if (Object.keys(current).length === 0) return { next: base, changes: [] }
  const changes: PromoChange[] = []
  const hadBaseline = prev !== null
  for (const [name, value] of Object.entries(current)) {
    const was = base.active[name]
    if (was === value) continue
    // Первый запуск: фиксируем состояние, но не выдаём его за "включилось".
    if (hadBaseline) changes.push({ ts: nowIso, name, from: was ?? null, to: value })
  }
  for (const [name, was] of Object.entries(base.active)) {
    if (!(name in current) && hadBaseline) changes.push({ ts: nowIso, name, from: was, to: null })
  }
  return {
    next: {
      version: 1,
      active: { ...current },
      log: [...base.log, ...changes].slice(-MAX_PROMO_LOG),
    },
    changes,
  }
}

// ---------------------------------------------------------------------------
// 4. Журнал прогонов kartel (kartel-runs.jsonl)
// ---------------------------------------------------------------------------

export interface KartelRun {
  ts: string
  fetch: string
  status: string
  requested: number | null
  returned: number | null
  failed: string[]
  // На сколько суток вперёд самое далёкое известное окно.
  horizonDays: number | null
  promoActive: number | null
}

export function buildKartelRun(input: {
  nowIso: string
  fetchOutcome: string
  status: string
  meta: { requestedCount?: number; returnedCount?: number; failedSources?: string[] } | null
  filters: Record<string, LiveWindow>
  promoCount: number | null
}): KartelRun {
  const now = new Date(input.nowIso).getTime()
  let maxStart = -Infinity
  for (const w of Object.values(input.filters)) {
    const t = w.start ? new Date(w.start).getTime() : NaN
    if (!Number.isNaN(t) && t > maxStart) maxStart = t
  }
  return {
    ts: input.nowIso,
    fetch: input.fetchOutcome,
    status: input.status,
    requested: input.meta?.requestedCount ?? null,
    returned: input.meta?.returnedCount ?? null,
    failed: input.meta?.failedSources ?? [],
    horizonDays: Number.isFinite(maxStart)
      ? Math.round(((maxStart - now) / 86_400_000) * 10) / 10
      : null,
    promoActive: input.promoCount,
  }
}

// ---------------------------------------------------------------------------
// 5. Структура XML (xml-structure.json)
//
// Порядок офферов в блоках спринтов shopitems/dailypopup и порядок пула
// дневных офферов. По этим данным можно переиграть любую правку датирования на
// реальной истории (git хранит версии файла). Сами XML не коммитим: они весят
// мегабайты, а нужен только порядок.
// ---------------------------------------------------------------------------

export interface XmlStructure {
  version: 1
  capturedAt: string
  // спринт -> [itemId, filter][] (filter = null, если равен Shop_<itemId>)
  shopitems: Record<string, [string, string | null][]>
  // спринт -> [filter, entity, имя картинки][]
  dailypopup: Record<string, [string, string | null, string | null][]>
  // порядок пула дневных офферов, как его читает лестница: [itemId, filter][]
  dailyPool: [string, string | null][]
  // раздел <Promotions> dailypopup.xml: 7-10 флагманских офферов на спринт
  // (в XML он закомментирован). Похоже на недельные окна: в списке 258 стоят
  // Specimen_BA_13_Gold и Specimen_DA_13_Gold, а их реальные окна 6-13 и 12-19
  // октября. Спринт -> [itemId, filter][].
  promotions: Record<string, [string, string | null][]>
}

const SHOP_SPRINT_RE = /itemId="-+\/\/ SPRINT (\d+) \\\\-+"/g
const POOL_ITEM_RE = /^-*#?(specimen_|bundle_orbs_|pack_daily_)/i

function recentSprints(nums: number[], keep: number): Set<number> {
  return new Set([...new Set(nums)].sort((a, b) => b - a).slice(0, keep))
}

// Фильтр оффера почти всегда равен "Shop_" + itemId. Храним только отличающийся,
// иначе файл вдвое больше (пул дневных офферов - больше тысячи записей).
const shortFilter = (id: string, filter: string | null): string | null =>
  filter && filter.toLowerCase() !== `shop_${id}`.toLowerCase() ? filter : null

// Содержимое раздела <Tag>...</Tag>; нет раздела - пустая строка.
function sectionOf(xml: string, tag: string): string {
  const a = xml.indexOf(`<${tag}>`)
  const b = xml.indexOf(`</${tag}>`)
  return a === -1 || b === -1 ? '' : xml.slice(a, b)
}

export function extractXmlStructure(
  shopitemsXml: string,
  dailypopupXml: string,
  nowIso: string,
  keepSprints = 6,
): XmlStructure {
  // shopitems: блоки по маркеру спринта, внутри каждого ShopItem по порядку.
  const markers: { pos: number; sprint: number }[] = []
  for (const m of shopitemsXml.matchAll(SHOP_SPRINT_RE)) {
    markers.push({ pos: m.index ?? 0, sprint: Number(m[1]) })
  }
  const keep = recentSprints(
    markers.map((m) => m.sprint),
    keepSprints,
  )
  const shopitems: XmlStructure['shopitems'] = {}
  for (let i = 0; i < markers.length; i++) {
    const { pos, sprint } = markers[i]
    if (!keep.has(sprint)) continue
    const end = i + 1 < markers.length ? markers[i + 1].pos : shopitemsXml.length
    const list: [string, string | null][] = []
    for (const item of shopitemsXml
      .slice(pos, end)
      .match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
      const id = item.match(/itemId="([^"]+)"/)?.[1]
      if (!id || /hidden="true"/.test(item.match(/<ShopItem\b[^>]*>/)?.[0] ?? '')) continue
      list.push([id, shortFilter(id, item.match(/<Filter>([^<]*)<\/Filter>/)?.[1] ?? null)])
    }
    shopitems[String(sprint)] = list
  }

  // порядок пула дневных офферов (тот же отбор, что в лестнице прогноза магазина)
  const dailyPool: XmlStructure['dailyPool'] = []
  for (const item of shopitemsXml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    if (!item.includes('subCat="dailyoffer"')) continue
    const id = item.match(/itemId="([^"]+)"/)?.[1]
    if (!id || !POOL_ITEM_RE.test(id)) continue
    dailyPool.push([id, shortFilter(id, item.match(/<Filter>([^<]*)<\/Filter>/)?.[1] ?? null)])
  }

  // dailypopup: раздел <OfferWindow> (баннеры) и раздел <Promotions>. Маркеры
  // "DEBUT SPRINT N" повторяются в обоих, поэтому делим файл на разделы.
  const offerSection = sectionOf(dailypopupXml, 'OfferWindow')
  const promoSection = sectionOf(dailypopupXml, 'Promotions')

  const blocksOf = (xml: string) => {
    const marks: { pos: number; len: number; sprint: number }[] = []
    for (const m of xml.matchAll(/<!--\s*DEBUT SPRINT (\d+)\s*-->/g)) {
      marks.push({ pos: m.index ?? 0, len: m[0].length, sprint: Number(m[1]) })
    }
    const keepSet = recentSprints(
      marks.map((m) => m.sprint),
      keepSprints,
    )
    return marks
      .map((m, i) => ({
        sprint: m.sprint,
        body: xml.slice(m.pos + m.len, i + 1 < marks.length ? marks[i + 1].pos : xml.length),
      }))
      .filter((b) => keepSet.has(b.sprint))
  }

  const dailypopup: XmlStructure['dailypopup'] = {}
  for (const { sprint, body } of blocksOf(offerSection)) {
    const list: [string, string | null, string | null][] = []
    for (const offer of body.match(/<Offer\b[^>]*>[\s\S]*?<\/Offer>/g) ?? []) {
      const filter = offer.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
      if (!filter) continue
      const entity = offer.match(/<Tag key="entity" value="([^"]*)"\s*\/>/)?.[1] ?? null
      const image = offer.match(/image="[^"]*?([^/"]+?)(?:\$\$)?\.jpg"/)?.[1] ?? null
      list.push([filter, entity, image])
    }
    dailypopup[String(sprint)] = list
  }

  // <ShopItem> внутри закомментированного блока тоже читаем: это и есть данные.
  const promotions: XmlStructure['promotions'] = {}
  for (const { sprint, body } of blocksOf(promoSection)) {
    const list: [string, string | null][] = []
    for (const item of body.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
      const id = item.match(/itemId="([^"]+)"/)?.[1]
      if (!id) continue
      list.push([id, shortFilter(id, item.match(/<Filter>([^<]*)<\/Filter>/)?.[1] ?? null)])
    }
    promotions[String(sprint)] = list
  }

  return { version: 1, capturedAt: nowIso, shopitems, dailypopup, dailyPool, promotions }
}

// Сравнение структур без метки времени.
export const sameStructure = (a: XmlStructure | null, b: XmlStructure): boolean =>
  !!a && JSON.stringify({ ...a, capturedAt: '' }) === JSON.stringify({ ...b, capturedAt: '' })

// ---------------------------------------------------------------------------
// Аналитика по журналам (используется scripts/date-accuracy-report.ts)
// ---------------------------------------------------------------------------

const dayNum = (isoStr: string) => Math.floor(Date.parse(isoStr) / 86_400_000)

export interface MethodRow {
  item: string
  method: string
  errDays: number
  leadDays: number
}

// По журналу изменений дат: для каждого оффера берём ПОСЛЕДНЮ приблизительную
// дату перед первой точной и считаем ошибку и срок (за сколько до точной даты
// догадка была опубликована). Метод это источник именно этой догадки.
export function methodAccuracy(changes: DateChange[]): MethodRow[] {
  const byItem = new Map<string, DateChange[]>()
  for (const c of changes) {
    const k = `${c.ann}\u0001${c.item}`
    byItem.set(k, [...(byItem.get(k) ?? []), c])
  }
  const rows: MethodRow[] = []
  for (const list of byItem.values()) {
    const sorted = [...list].sort((a, b) => a.ts.localeCompare(b.ts))
    const exactIdx = sorted.findIndex((c) => c.to && !c.to.approx && c.to.start)
    if (exactIdx <= 0) continue
    const exact = sorted[exactIdx]
    const guess = [...sorted.slice(0, exactIdx)].reverse().find((c) => c.to?.approx && c.to.start)
    if (!guess?.to?.start || !exact.to?.start) continue
    rows.push({
      item: guess.item,
      method: guess.to.src ?? 'unknown',
      errDays: dayNum(exact.to.start) - dayNum(guess.to.start),
      leadDays: (Date.parse(exact.ts) - Date.parse(guess.ts)) / 86_400_000,
    })
  }
  return rows
}

// Срок предупреждения kartel: насколько раньше старта окна оно впервые
// появилось в ответе. Записи, найденные при создании журнала (first = null),
// не считаются.
export function kartelLeadDays(journal: WindowsJournal): number[] {
  const out: number[] = []
  for (const w of Object.values(journal.filters)) {
    if (!w.first || !w.start) continue
    const lead = (Date.parse(w.start) - Date.parse(w.first)) / 86_400_000
    if (lead >= -1) out.push(Math.round(lead * 10) / 10)
  }
  return out.sort((a, b) => a - b)
}
