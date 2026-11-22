// Единственный источник правды "категория анонса -> вид карточки".
//
// Раньше это знание жило в ДВУХ местах: cardKind() в announcements-render.ts
// (рендер) и захардкоженный список SINGLE_ITEM_CATEGORIES в
// build-announcements.ts (публикация), с комментарием "синхронизировать
// руками". На этом уже ловили баг: карточки вида dungeon/mutant/skin/reactor/
// box/bingo рендерят ТОЛЬКО items[0], поэтому публиковать их батчем нельзя -
// когда детектор находил 9 новых лесенок разом, на сайте показывалась одна,
// а остальные 8 молча пропадали.
//
// Файл намеренно БЕЗ импортов: build-announcements.ts гоняется голым `npx tsx`
// вне Astro/Vite, а announcements-render.ts тянет localisation/craft-simulator
// с Vite-only `?raw`-импортами .txt - импортировать его из скрипта нельзя,
// падает на ERR_UNKNOWN_FILE_EXTENSION.

export type CardKind =
  | 'dungeon'
  | 'mutant'
  | 'skin'
  | 'reactor'
  | 'box'
  | 'bingo'
  | 'forecast'
  | 'exchange'
  | 'quests'
  | 'pvp'
  | 'generic'

export function cardKind(category: string | undefined): CardKind {
  if (category === 'raid' || category === 'ladder' || category === 'eventLadder') return 'dungeon'
  if (category === 'mutant') return 'mutant'
  if (category === 'skin') return 'skin'
  if (category === 'reactor') return 'reactor'
  if (category === 'box') return 'box'
  if (category === 'bingo') return 'bingo'
  if (category === 'shopForecast' || category === 'dailyNews') return 'forecast'
  if (category === 'exchange') return 'exchange'
  if (category === 'eventQuests') return 'quests'
  if (category === 'pvp') return 'pvp'
  return 'generic'
}

// Виды карточек, которые рендерят только первый item. forecast/exchange/generic
// рендерят items.map(...) целиком - для них батч корректен.
const SINGLE_ITEM_KINDS = new Set<CardKind>([
  'dungeon',
  'mutant',
  'skin',
  // Реакторы намеренно НЕ здесь: в игре одновременно крутятся три генератора
  // с общим окном ротации, и три отдельные карточки с одной и той же датой -
  // это шум. Карточка одна, баннеры внутри кликабельные (просьба юзера
  // 2026-09-21).
  'box',
  'bingo',
  // Одна цепочка заданий = одна карточка со своими этапами.
  'quests',
  // Один сезон = одна карточка со своей таблицей наград.
  'pvp',
])

// true -> публиковать каждый найденный объект ОТДЕЛЬНЫМ анонсом, иначе
// N-1 объектов не увидит никто.
export function isSingleItemCategory(category: string | undefined): boolean {
  return SINGLE_ITEM_KINDS.has(cardKind(category))
}

// Пороги лиг PvP (getPvPInfo, поле TR[].Key) - ФИКСИРОВАННЫЕ игровые
// константы, одни и те же для любого сезона (не приходят в live-ответе).
// Названия - localisation_ru.txt (league_1..5), атаки/проценты - скриншот
// "Current Reward Level" из игры (юзер прислал 2026-11-22). Имена других
// локалей (localisation_{lang}.txt на Kobojo CDN, те же ключи league_N) -
// бэклог, как и остальной i18n этой карточки (см. announcements.pvp.league.N).
// Key 0 (ниже Новичков) сюда не входит - рангу без наград номер не нужен.
export const PVP_LEAGUE_META: Record<number, { attacks: number; percentile: number | null }> = {
  1: { attacks: 1, percentile: null },
  2: { attacks: 5, percentile: 50 },
  3: { attacks: 15, percentile: 10 },
  4: { attacks: 30, percentile: 3 },
  5: { attacks: 50, percentile: 1 },
}
