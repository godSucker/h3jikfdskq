// Порядок досок бинго в фильтре /mutants: по смыслу, группами с
// разделителями - как у фильтра "Источник" (obtain-sources.ts).
//
// Семейства досок с номером или годом (исследования, ивенты, ёлки, годовщины,
// мутанты/скины года) узнаются по id, поэтому новая доска из часового синка
// (например event_xmas2026 или 2027_events) сама встаёт в свою группу на своё
// место. Доска, не подошедшая ни под одно правило, уходит в конец списка -
// видна, а не потеряна.

type Rule = { match: (id: string) => number | null }

function fixed(ids: string[]): Rule {
  return { match: (id) => (ids.includes(id) ? ids.indexOf(id) : null) }
}

function numbered(re: RegExp, rank: (m: RegExpMatchArray) => number): Rule {
  return {
    match: (id) => {
      const m = id.match(re)
      return m ? rank(m) : null
    },
  }
}

// Одна группа может собираться из нескольких правил (ивенты 2019-2024 и
// 2025+ названы по-разному: event_2024, но 2025_events).
const GROUPS: Rule[][] = [
  // Базовые и разведение
  [
    fixed([
      'Starter',
      'starter_plat',
      'bingo_bronze',
      'bingo_silver',
      'bingo_gold',
      'bingo_plat',
      'cross_mutation',
    ]),
  ],
  // Коллекции
  [
    fixed([
      'legend',
      'heroic',
      'reactor',
      'zodiac',
      'zodiac_silver',
      'amazons',
      'rumble',
      'events',
    ]),
  ],
  // Исследования
  [numbered(/^research_(\d+)$/, (m) => Number(m[1]))],
  // Ивенты по годам
  [
    numbered(/^event_(\d{4})$/, (m) => Number(m[1])),
    numbered(/^(\d{4})_events$/, (m) => Number(m[1])),
  ],
  // Мутанты и скины года
  [numbered(/^(\d{4})_(mutants|skins)$/, (m) => Number(m[1]) * 10 + (m[2] === 'mutants' ? 0 : 1))],
  // Годовщины (10 лет игре - 2025 год, рядом с годовщиной 25)
  [
    numbered(/^anniversary_(\d+)$/, (m) => Number(m[1]) * 10),
    { match: (id) => (id === '10years' ? 25 * 10 + 5 : null) },
  ],
  // Ёлки
  [numbered(/^event_xmas(\d{4})$/, (m) => Number(m[1]))],
]

function position(id: string): { group: number; rank: number } | null {
  for (let g = 0; g < GROUPS.length; g++) {
    for (const rule of GROUPS[g]) {
      const rank = rule.match(id)
      if (rank !== null) return { group: g, rank }
    }
  }
  return null
}

export function bingoBoardGroup(id: string): number {
  return position(id)?.group ?? GROUPS.length
}

export function compareBingoBoards(a: string, b: string, label: (id: string) => string): number {
  const pa = position(a)
  const pb = position(b)
  if (pa && pb) return pa.group - pb.group || pa.rank - pb.rank
  if (pa) return -1
  if (pb) return 1
  return label(a).localeCompare(label(b), 'ru')
}
