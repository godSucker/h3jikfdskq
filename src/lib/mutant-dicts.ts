// Словари и вспомогательные функции для перевода данных мутантов.
// Этот модуль экспортирует названия и стили, которые переиспользуются
// компонентами MutantModal, MutantsBrowser и другими частями приложения.

// Русские названия для генов. Используются для отображения комбинаций.
export const GENE_RU: Record<string, string> = {
  A: 'Киборг',
  B: 'Нежить',
  C: 'Рубака',
  D: 'Зверь',
  E: 'Галактик',
  F: 'Мифик',
}

// Переводы для значений бинго. Если ключ не найден, возвращается исходный ключ.
export const BINGO_RU: Record<string, string> = {
  hp: 'ХП',
  health: 'ХП',
  atk: 'Атака',
  attack: 'Атака',
  attack1: 'Атака 1',
  attack2: 'Атака 2',
  spd: 'Скорость',
  speed: 'Скорость',
  credit: 'Кредиты',
  credits: 'Кредиты',
  xp: 'Опыт',
  gene_a: 'Киборг',
  gene_b: 'Нежить',
  gene_c: 'Рубака',
  gene_d: 'Зверь',
  gene_e: 'Галактик',
  gene_f: 'Мифик',
  '2025_events': 'Ивенты 2025',
  '2025_mutants': 'Мутанты 2025',
  '2025_skins': 'Скины 2025',
  '2026_events': 'Ивенты 2026',
  '2026_mutants': 'Мутанты 2026',
  '2026_skins': 'Скины 2026',
  amazons: 'Амазонки',
  anniversary_25: 'Годовщина',
  bingo_bronze: 'Бронзовое разведение',
  bingo_silver: 'Серебряное разведение',
  bingo_gold: 'Золотое разведение',
  bingo_plat: 'Платиновое разведение',
  cross_mutation: 'Кросс-мутация',
  event_2019: 'Ивенты 2019',
  event_2020: 'Ивенты 2020',
  event_2021: 'Ивенты 2021',
  event_2022: 'Ивенты 2022',
  event_2023: 'Ивенты 2023',
  event_2024: 'Ивенты 2024',
  events: 'Праздники',
  event_xmas2016: 'Ёлка 2016',
  event_xmas2017: 'Ёлка 2017',
  event_xmas2018: 'Ёлка 2018',
  event_xmas2019: 'Ёлка 2019',
  event_xmas2020: 'Ёлка 2020',
  event_xmas2021: 'Ёлка 2021',
  event_xmas2022: 'Ёлка 2022',
  event_xmas2023: 'Ёлка 2023',
  event_xmas2024: 'Ёлка 2024',
  event_xmas2025: 'Ёлка 2025',
  anniversary_21: 'Годовщина 2021',
  anniversary_24: 'Годовщина 2024',
  anniversary_26: 'Годовщина 2026',
  '10years': '10 лет игре',
  heroic: 'Герои',
  legend: 'Легенды',
  reactor: 'Реактор',
  research_1: 'Исследование 1',
  research_2: 'Исследование 2',
  research_3: 'Исследование 3',
  research_4: 'Исследование 4',
  research_5: 'Исследование 5',
  research_6: 'Исследование 6',
  research_7: 'Исследование 7',
  research_8: 'Исследование 8',
  research_9: 'Исследование 9',
  research_10: 'Исследование 10',
  research_11: 'Исследование 11',
  rumble: 'Грохот',
  Starter: 'Базовое бинго',
  starter_plat: 'Платиновое бинго',
  zodiac: 'Зодиаки',
  zodiac_silver: 'Серебряные зодиаки',
}

// Переводы типов мутантов. Если тип не найден, возвращается исходное значение.
export const TYPE_RU: Record<string, string> = {
  Pvp: 'ПВП',
  PVP: 'ПВП',
  Special: 'Особые',
  SPECIAL: 'Особые',
  special: 'Особые',
  ZODIAC: 'Зодиаки',
  GACHA: 'Реактор',
  gacha: 'Реактор',
  COMMUNITY: 'Сообщество',
  default: 'Обычные/Начальные',
  HEROIC: 'Герои',
  LEGEND: 'Легенды',
  RECIPE: 'Секреты',
  SEASONAL: 'Ивенты',
  VIDEOGAME: 'Видеоигры',
}

// Названия для разных уровней звёздной редкости.
export const STAR_LABEL: Record<string, string> = {
  normal: 'Обычный',
  bronze: 'Бронза',
  silver: 'Серебро',
  gold: 'Золото',
  platinum: 'Платина',
}

// Цвета (классы Tailwind) для бейджа звёздной редкости в модалке.
export const STAR_COLOR: Record<string, string> = {
  normal: 'bg-slate-700/60 text-slate-200 ring-slate-400/40',
  bronze: 'bg-amber-700/60 text-amber-200 ring-amber-400/40',
  silver: 'bg-slate-400/60 text-slate-900 ring-slate-300/40',
  gold: 'bg-yellow-500/60 text-yellow-900 ring-yellow-300/40',
  platinum: 'bg-cyan-500/60 text-cyan-900 ring-cyan-300/40',
}

/**
 * Возвращает строку, объединяющую русские названия генов для заданного кода.
 * Например, 'AB' -> 'Киборг+Нежить'. Неизвестные символы возвращаются как есть.
 */
export function geneLabel(code: string): string {
  if (!code) return ''
  return code
    .toUpperCase()
    .split('')
    .map((ch) => GENE_RU[ch] || ch)
    .join('+')
}

/**
 * Переводит ключ бинго в русское название. Если нет перевода, возвращает исходный ключ.
 */
export function bingoLabel(key: string): string {
  if (!key) return ''
  const lower = key.toLowerCase()
  return BINGO_RU[lower] || BINGO_RU[key] || key
}

export const ABILITY_RU: Record<string, string> = {
  ability_shield: 'Щит',
  ability_shield_plus: 'Щит',
  ability_regen: 'Вытягивание жизни',
  ability_regen_plus: 'Вытягивание жизни',
  ability_retaliate: 'Отражение',
  ability_retaliate_plus: 'Отражение',
  ability_slash: 'Рана',
  ability_slash_plus: 'Рана',
  ability_strengthen: 'Усиление',
  ability_strengthen_plus: 'Усиление',
  ability_weaken: 'Проклятие',
  ability_weaken_plus: 'Проклятие',
}
