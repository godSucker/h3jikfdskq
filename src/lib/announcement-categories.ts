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
  'dungeon' | 'mutant' | 'skin' | 'reactor' | 'box' | 'bingo' | 'forecast' | 'exchange' | 'generic'

export function cardKind(category: string | undefined): CardKind {
  if (category === 'raid' || category === 'ladder' || category === 'eventLadder') return 'dungeon'
  if (category === 'mutant') return 'mutant'
  if (category === 'skin') return 'skin'
  if (category === 'reactor') return 'reactor'
  if (category === 'box') return 'box'
  if (category === 'bingo') return 'bingo'
  if (category === 'shopForecast' || category === 'dailyNews') return 'forecast'
  if (category === 'exchange') return 'exchange'
  return 'generic'
}

// Виды карточек, которые рендерят только первый item. forecast/exchange/generic
// рендерят items.map(...) целиком - для них батч корректен.
const SINGLE_ITEM_KINDS = new Set<CardKind>([
  'dungeon',
  'mutant',
  'skin',
  'reactor',
  'box',
  'bingo',
])

// true -> публиковать каждый найденный объект ОТДЕЛЬНЫМ анонсом, иначе
// N-1 объектов не увидит никто.
export function isSingleItemCategory(category: string | undefined): boolean {
  return SINGLE_ITEM_KINDS.has(cardKind(category))
}
