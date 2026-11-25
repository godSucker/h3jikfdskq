// Единственный источник правды для "что показать в разделе Сегодня в
// магазине" - используется И build-daily-digest.ts (голый `npx tsx`), И
// render-today-shop.astro (Vite/Astro). Файл намеренно БЕЗ импортов - тот же
// принцип, что announcement-schema.ts (см. комментарий там про границу
// tsx/Vite): build-daily-digest.ts не может импортировать Vite-граф.
//
// НАЙДЕНО (юзер 2026-11-25, "есть на 25-26 Охотник за головами" - его не было
// в посте): обе точки читали ТОЛЬКО последнюю запись shopForecast/dailyNews
// (latestByCategory). Когда детектор перекатывается на новый спринт, он
// публикует НОВУЮ запись через fetchShopForecast(cs/cs+1/cs+2) - старый
// спринт больше не перезапрашивается НИКОГДА, даже если его подтверждённый
// kartel-датой оффер (exactDateStart) ещё не наступил (тут - "261|
// Specimen_A_05_Bronze", подтверждён kartel на 25-26 ноября, см.
// scripts/kartel/date-ledger.json: Shop_Specimen_A_05_Bronze). "Последняя
// запись" в этот момент - уже спринт 262 без этого оффера: инфа не ошибочная,
// просто не перенесённая вперёд. Фикс - смотреть ВСЕ записи категории, не
// только последнюю (announcements.json и так копится, ничего не теряет).
//
// Второй баг в той же жалобе ("дублирует предложения с шопа и 'скоро в игре'
// баннер"): shopForecast и dailyNews - два независимых детектора над одним и
// тем же релизом, dailyNews заворачивает тот же specimen-id под префиксом
// (Daily_News_Specimen_CB_15_release) - раньше просто конкатенировались без
// дедупа. ВАЖНО: дедуп только межисточниковый (shopForecast "съедает"
// dailyNews для того же мутанта) - варианты ВНУТРИ shopForecast (Gold/rc/
// Bronze - это разные реальные офферы с разными ценами) дедупу НЕ подлежат
// (см. feedback-show-data-as-is-no-silent-dedup в памяти - не схлопывать
// данные молча сверх того, на что явно жаловался юзер).

export interface TodayShopItemLike {
  id: string
  name?: string
  exactDateStart?: string | null
  exactDateApprox?: boolean
  exactDateSource?: string | null
}

export interface TodayShopAnnouncementLike<T extends TodayShopItemLike = TodayShopItemLike> {
  date: string
  category: string
  items: T[]
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
export const mskDateKey = (d: Date): string =>
  new Date(d.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10)

// specimenId БЕЗ суффикса варианта (Bronze/Gold/rc/...) - для сопоставления
// "это тот же релиз мутанта", не для показа. Используется и для
// межисточникового дедупа, и (в build-daily-digest.ts) для тир-вердикта.
export function shopOfferSpecimenId(rawId: string): string | null {
  const afterSprint = rawId.includes('|') ? rawId.slice(rawId.indexOf('|') + 1) : rawId
  const m = /(specimen_[a-z]+_\d+)/i.exec(afterSprint)
  return m ? m[1].toLowerCase() : null
}

// id БЕЗ префикса спринта (261|/262|/...), но С вариантом - ключ для дедупа
// ОДНОГО И ТОГО ЖЕ оффера, перепубликованного в нескольких записях (напр.
// сперва как "+1"-лукахед, потом как живой текущий спринт).
function strippedId(rawId: string): string {
  const afterSprint = rawId.includes('|') ? rawId.slice(rawId.indexOf('|') + 1) : rawId
  return afterSprint.toLowerCase()
}

function isBetterSource(a: TodayShopItemLike, b: TodayShopItemLike): boolean {
  const aApprox = a.exactDateApprox === true
  const bApprox = b.exactDateApprox === true
  if (aApprox !== bApprox) return !aApprox
  const aKartel = a.exactDateSource === 'kartel'
  const bKartel = b.exactDateSource === 'kartel'
  if (aKartel !== bKartel) return aKartel
  return false
}

function dedupeBySameOffer<T extends TodayShopItemLike>(items: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const it of items) {
    const key = strippedId(it.id)
    const existing = byKey.get(key)
    if (!existing || isBetterSource(it, existing)) byKey.set(key, it)
  }
  return [...byKey.values()]
}

function todaysItemsAcrossAllRecords<T extends TodayShopItemLike>(
  announcements: TodayShopAnnouncementLike<T>[],
  category: string,
  todayKey: string,
): T[] {
  const items = announcements
    .filter((a) => a.category === category)
    .flatMap((a) => a.items)
    .filter((it) => it.exactDateStart && mskDateKey(new Date(it.exactDateStart)) === todayKey)
  return dedupeBySameOffer(items)
}

export function selectTodayShopItems<T extends TodayShopItemLike>(
  announcements: TodayShopAnnouncementLike<T>[],
  todayKey: string,
): T[] {
  const shopForecastToday = todaysItemsAcrossAllRecords(announcements, 'shopForecast', todayKey)
  const dailyNewsToday = todaysItemsAcrossAllRecords(announcements, 'dailyNews', todayKey)

  const shopForecastSpecimens = new Set(
    shopForecastToday.map((it) => shopOfferSpecimenId(it.id)).filter((id): id is string => !!id),
  )
  const shopForecastStrippedIds = new Set(shopForecastToday.map((it) => strippedId(it.id)))

  const dailyNewsFiltered = dailyNewsToday.filter((it) => {
    const specimen = shopOfferSpecimenId(it.id)
    if (specimen && shopForecastSpecimens.has(specimen)) return false
    if (shopForecastStrippedIds.has(strippedId(it.id))) return false
    return true
  })

  return [...shopForecastToday, ...dailyNewsFiltered]
}
