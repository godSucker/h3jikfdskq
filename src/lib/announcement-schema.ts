// Единственный источник правды для формы данных анонса (announcements.json) -
// используется И build-announcements.ts (голый `npx tsx`, публикация), И
// announcements-render.ts (Vite/Astro, рендер). Файл намеренно БЕЗ импортов -
// тот же принцип, что announcement-categories.ts: build-announcements.ts не
// может импортировать announcements-render.ts (тот тянет localisation/
// craft-simulator с Vite-only `?raw`-импортами .txt, падает на голом tsx с
// ERR_UNKNOWN_FILE_EXTENSION).
//
// НАЙДЕНО (Opus 5.5 audit, 2026-09-22): AnnouncementItem/Announcement были
// объявлены дважды и разъехались - версия в announcements-render.ts не несла
// exactDateEnd/exactDateApprox/exactDateOpenEnd/sprintKey, ribbon был
// типизирован как голый string. CATEGORY_ICON (build-announcements.ts) не
// содержал 'eventLadder' - живой баг: анонс с этой категорией уходил в личный
// Telegram-алерт (notifyRunSummary) с эмодзи-заглушкой 🔔 вместо своего.
// RIBBONS дублировался в announcements-render.ts отдельной константой.

// Зеркалит OfferRibbon из scripts/shop-offer-tags.ts - держим отдельным
// маленьким типом, а не импортом, тот файл вне Vite-графа этой страницы (см.
// комментарий выше про границу tsx/Vite).
export type OfferRibbon =
  'legendary' | 'limited' | 'new' | 'heroic' | 'exclusive' | 'seasonal' | `discount-${number}`

// Именованные ленты (без discount-N - та рисуется по regex в ribbonLabel()).
// Для каждой должен существовать CSS-класс .ribbon-<name> в
// AnnouncementCard.astro и ключ announcements.ribbon.<name> в src/i18n/*.json -
// см. announcement-schema.test.ts.
export const RIBBONS = ['legendary', 'limited', 'new', 'heroic', 'exclusive', 'seasonal'] as const

// Категории детекторов. Для каждой должен существовать ключ
// announcements.category.<name> в src/i18n/*.json и запись в CATEGORY_ICON
// ниже - см. announcement-schema.test.ts.
export const CATEGORIES = [
  'mutant',
  'skin',
  'bingo',
  'box',
  'exchange',
  'raid',
  'ladder',
  'eventLadder',
  'reactor',
  'token',
  'shopForecast',
  'dailyNews',
  'eventQuests',
  'rebalance',
] as const

// Эмодзи для личного Telegram-алерта (notifyRunSummary в build-announcements.ts).
export const CATEGORY_ICON: Record<(typeof CATEGORIES)[number], string> = {
  mutant: '🧬',
  skin: '🎨',
  bingo: '🎲',
  box: '📦',
  exchange: '🔁',
  raid: '⚔️',
  ladder: '🪜',
  eventLadder: '🪜',
  token: '🪙',
  reactor: '🎰',
  shopForecast: '🛒',
  dailyNews: '📰',
  eventQuests: '📜',
  rebalance: '⚖️',
}

export interface AnnouncementItem {
  id: string
  name: string
  image?: string | null
  addedNames?: string[]
  // Только eventQuests: этапы, добавленные в уже анонсированную цепочку.
  addedStepIds?: string[]
  // Только rebalance: сколько мутантов затронуто (id записи - дата ребаланса).
  rebalanceCount?: number
  // Только для shopForecast/dailyNews - реальная цена оффера, если она есть
  // (не у всех, часть daily_news - чисто событийные анонсы без покупки).
  // 'usd' - донат-паки за реальные деньги (<RealPrices Currency="USD">).
  price?: { amount: number; type: 'hardcurrency' | 'softcurrency' | 'usd' } | null
  // Только для shopForecast/dailyNews - настоящая игровая лента оффера
  // (offerTag из shopitems.xml), см. scripts/shop-offer-tags.ts.
  ribbon?: OfferRibbon | null
  // Только dailyNews - живой процент скидки (ABGetExperiments, см.
  // scripts/kartel-promo-percents.ts). Пока только баннер тех-центра. null -
  // живых данных нет или сейчас нет акции.
  discountPercent?: number | null
  // shopForecast/dailyNews/raid/ladder/box - точный диапазон ЭТОГО оффера из
  // живого kartel-запроса (см. scripts/kartel-filter-dates.ts). null, если
  // live-данных для него нет.
  exactDateLabel?: string | null
  // ISO-дата начала (не форматированная) - для хронологической сортировки.
  exactDateStart?: string | null
  // ISO-конец окна и пометки вида подписи. approx - "≈ 5 сентября" (оффер
  // датирован по соседям, а не живым окном), openEnd - "26 августа — ?"
  // (начало известно, конец kartel ещё не отдал).
  exactDateEnd?: string | null
  exactDateApprox?: boolean
  exactDateOpenEnd?: boolean
  // Только shopForecast - 'week'/'month' (окно продажи ~7 или ~28-31 день,
  // см. classifyFeaturedMutant). 'day' - оффер из пула daily-offer.
  featuredMutant?: 'day' | 'week' | 'month' | 'zodiac' | null
  // Мутанты внутри пакета - чтобы тайл прогноза был кликабельным, даже когда
  // сам itemId мутанта не содержит.
  packMutants?: string[]
  // Только exchange - какой из 3 залов (джекпот/испытания/анализатор тайны).
  hall?: 'jackpot' | 'event' | 'mystery' | null
  // Только hall==='mystery' - цена контракта.
  cost?: { id?: string; amount: number; name: string; image: string | null } | null
  // Только hall==='mystery' - клик должен открыть модалку сразу на этом скине.
  star?: string | null
  skin?: string | null
}

// Прогнозы (shopForecast/dailyNews) рисуются двумя неделями спринта, и
// скриншот-бот снимает каждую неделю отдельным кадром. Какой оффер в какой
// неделе - должны считать одинаково И карточка (AnnouncementCard.astro), И бот
// (process-pending-screenshots.ts решает, какие недели вообще снимать), иначе
// бот пришлёт пустой кадр или пропустит неделю. Поэтому логика здесь, один раз.

// Номер спринта прогноза - префикс id первого оффера ("257|...").
export function forecastSprint(items: { id: string }[]): number | null {
  const raw = items[0]?.id.split('|')[0]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

// Один и тот же баннер/иконка может прийти несколькими офферами - на доске
// показываем его один раз (первое вхождение в исходном порядке).
export function dedupeForecastOffers<T extends { image?: string | null }>(items: T[]): T[] {
  return items.filter((o, i, arr) => !o.image || arr.findIndex((x) => x.image === o.image) === i)
}

export const FORECAST_WEEK_MS = 7 * 86_400_000

// Граница недели считается от точного старта спринта, а не от середины списка -
// офферы распределены по дням неравномерно. Оффер без точной даты кладём в
// первую неделю: сортировка карточки и так отправляет такие в конец списка.
export function forecastWeekOf(
  exactDateStart: string | null | undefined,
  sprintStartMs: number,
): 1 | 2 {
  if (!exactDateStart) return 1
  return new Date(exactDateStart).getTime() - sprintStartMs < FORECAST_WEEK_MS ? 1 : 2
}

export interface Announcement {
  id: string
  date: string
  category: string
  title: string
  text?: string | null
  imagePath?: string | null
  sourceUrl?: string | null
  items: AnnouncementItem[]
  link?: string | null
  // Только shopForecast/dailyNews - номер спринта этой записи (см.
  // build-announcements.ts::main() - находит уже опубликованную запись для
  // дозаполнения exactDateLabel на следующих часовых прогонах).
  sprintKey?: string
}
