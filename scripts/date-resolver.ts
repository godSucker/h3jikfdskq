// Единый резолвер точных дат (этап 4 аудита Opus 5.5), пока в ТЕНЕВОМ режиме.
//
// Сейчас каждый потребитель берёт у kartel-снимка ОДНО окно фильтра - то, что
// fetch-filters.py::pick_current выбрал "ближе всего к сейчас", - и отбраковывает
// его своим окном: прогноз (shopForecast/dailyNews) - спринт +-3 дня, рейды/
// боксы/залы (exactDateFor) - "не старше 30 дней и не кончилось >3 дней назад".
// Игра переиспользует имена фильтров, и у одного имени бывает несколько окон
// (kartel отдаёт их все). pick_current выбирает, не зная, какое окно нужно
// потребителю: подходящее окно (например, будущее, внутри нужного спринта)
// теряется, неподходящее отбраковывается - отсюда класс "чужая дата" (три
// волны регрессий, LuckyBox_Research_IX и т.п.).
//
// resolveFilterDate() - тот же принцип выбора, что pick_current (активное сейчас,
// иначе ближайшее по старту к сейчас), но ТОЛЬКО среди окон, подходящих под
// ожидание потребителя. Все окна переиспользуемых имён берутся из
// `occurrences` снимка (fetch-filters.py).
//
// ТЕНЕВОЙ РЕЖИМ: потребители по-прежнему используют старый результат, а
// resolveFilterDate() считается рядом, и каждое расхождение копится и печатается
// в конце прогона build-announcements.ts (и в summary CI). Переключение -
// после того, как по логам будет видно, что расхождения - только ожидаемые
// (резолвер нашёл дату там, где старый путь её терял).
import type { FilterDateRange, LiveSnapshot } from './kartel-filter-dates'

const DAY_MS = 86_400_000
const STALE_PAST_DAYS = 30
const ENDED_GRACE_DAYS = 3

export type DateExpectation =
  // Прогноз спринта: старт окна внутри [startMs, endMs).
  | { kind: 'sprint'; startMs: number; endMs: number }
  // Свежий объект (рейд/бокс/зал): старт не старше 30 дней, и окно не
  // закончилось больше 3 дней назад - те же пороги, что exactDateFor().
  | { kind: 'fresh'; nowMs: number }

function fits(r: FilterDateRange, exp: DateExpectation): boolean {
  const start = Date.parse(r.start)
  if (Number.isNaN(start)) return false
  if (exp.kind === 'sprint') return start >= exp.startMs && start < exp.endMs
  if (start < exp.nowMs - STALE_PAST_DAYS * DAY_MS) return false
  if (r.end) {
    const end = Date.parse(r.end)
    if (!Number.isNaN(end) && end < exp.nowMs - ENDED_GRACE_DAYS * DAY_MS) return false
  }
  return true
}

export function resolveFilterDate(
  snapshot: Pick<LiveSnapshot, 'filters' | 'occurrences'>,
  name: string | null | undefined,
  exp: DateExpectation,
  nowMs: number = Date.now(),
): FilterDateRange | null {
  if (!name) return null
  const all = snapshot.occurrences[name] ?? (snapshot.filters[name] ? [snapshot.filters[name]] : [])
  const valid = all.filter((r) => fits(r, exp))
  if (valid.length === 0) return null
  // Тот же приоритет, что pick_current в fetch-filters.py - но только среди
  // окон, подходящих потребителю.
  const score = (r: FilterDateRange): [number, number] => {
    const start = Date.parse(r.start)
    const end = r.end ? Date.parse(r.end) : NaN
    if (!Number.isNaN(end) && start <= nowMs && nowMs < end) return [0, 0]
    return [1, Math.abs(nowMs - start)]
  }
  return valid.reduce((best, r) => {
    const [a1, a2] = score(r)
    const [b1, b2] = score(best)
    return a1 < b1 || (a1 === b1 && a2 < b2) ? r : best
  })
}

// ---- теневой режим ----

export interface ShadowDiff {
  context: string
  filter: string
  current: FilterDateRange | null
  resolved: FilterDateRange | null
}

const diffs: ShadowDiff[] = []
let compared = 0

const sameRange = (a: FilterDateRange | null, b: FilterDateRange | null) =>
  (!a && !b) ||
  (!!a &&
    !!b &&
    Date.parse(a.start) === Date.parse(b.start) &&
    (a.end ? Date.parse(a.end) : null) === (b.end ? Date.parse(b.end) : null))

// Никогда не бросает и ни на что не влияет - только копит расхождения.
export function shadowCompare(
  context: string,
  snapshot: Pick<LiveSnapshot, 'filters' | 'occurrences'>,
  name: string | null | undefined,
  exp: DateExpectation,
  current: FilterDateRange | null,
): void {
  try {
    if (!name) return
    compared++
    const resolved = resolveFilterDate(snapshot, name, exp)
    if (!sameRange(current, resolved)) diffs.push({ context, filter: name, current, resolved })
  } catch {
    // теневой режим не имеет права ломать прогон
  }
}

export function shadowReport(): string {
  const fmt = (r: FilterDateRange | null) =>
    r ? `${r.start.slice(0, 10)}..${r.end?.slice(0, 10) ?? '?'}` : 'нет'
  const lines = [
    `### Резолвер дат (теневой режим): расхождений ${diffs.length} из ${compared} сравнений`,
  ]
  const gained = diffs.filter((d) => !d.current && d.resolved).length
  const lost = diffs.filter((d) => d.current && !d.resolved).length
  const changed = diffs.length - gained - lost
  if (diffs.length) {
    lines.push(
      `нашёл дату, которую старый путь терял: ${gained}; выбрал другое окно: ${changed}; потерял дату: ${lost}`,
    )
    lines.push('| где | фильтр | сейчас | резолвер |', '|---|---|---|---|')
    for (const d of diffs.slice(0, 60))
      lines.push(`| ${d.context} | ${d.filter} | ${fmt(d.current)} | ${fmt(d.resolved)} |`)
    if (diffs.length > 60) lines.push(`… и ещё ${diffs.length - 60}`)
  }
  return lines.join('\n')
}

export function shadowStats(): { compared: number; diffs: ShadowDiff[] } {
  return { compared, diffs: [...diffs] }
}
