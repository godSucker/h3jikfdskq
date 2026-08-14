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

// --- i18n-пилот (Батч 11): EN/ES/FR словари ---------------------------------
// GENE_RU/TYPE_RU/BINGO_RU/ABILITY_RU выше НЕ трогаются - от них зависит весь
// остальной (пока не переведённый) сайт. Локале-осознанные версии - отдельно,
// используются только на переведённых страницах (MutantsBrowser/MutantModal).
import type { Locale } from './i18n'

export const GENE_DICT: Partial<Record<Locale, Record<string, string>>> = {
  ru: GENE_RU,
  en: { A: 'Cyborg', B: 'Undead', C: 'Brawler', D: 'Beast', E: 'Galactic', F: 'Mythic' },
  es: { A: 'Cíborg', B: 'No muerto', C: 'Luchador', D: 'Bestia', E: 'Galáctico', F: 'Mítico' },
  fr: { A: 'Cyborg', B: 'Mort-vivant', C: 'Bagarreur', D: 'Bête', E: 'Galactique', F: 'Mythique' },
}

export const TYPE_DICT: Partial<Record<Locale, Record<string, string>>> = {
  ru: TYPE_RU,
  en: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Special',
    SPECIAL: 'Special',
    special: 'Special',
    ZODIAC: 'Zodiac',
    GACHA: 'Reactor',
    gacha: 'Reactor',
    COMMUNITY: 'Community',
    default: 'Basic/Starter',
    HEROIC: 'Heroic',
    LEGEND: 'Legendary',
    RECIPE: 'Secrets',
    SEASONAL: 'Events',
    VIDEOGAME: 'Video games',
  },
  es: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Especial',
    SPECIAL: 'Especial',
    special: 'Especial',
    ZODIAC: 'Zodiaco',
    GACHA: 'Reactor',
    gacha: 'Reactor',
    COMMUNITY: 'Comunidad',
    default: 'Básico/Inicial',
    HEROIC: 'Héroes',
    LEGEND: 'Legendarios',
    RECIPE: 'Secretos',
    SEASONAL: 'Eventos',
    VIDEOGAME: 'Videojuegos',
  },
  fr: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Spécial',
    SPECIAL: 'Spécial',
    special: 'Spécial',
    ZODIAC: 'Zodiaque',
    GACHA: 'Réacteur',
    gacha: 'Réacteur',
    COMMUNITY: 'Communauté',
    default: 'Basique/Débutant',
    HEROIC: 'Héros',
    LEGEND: 'Légendaires',
    RECIPE: 'Secrets',
    SEASONAL: 'Événements',
    VIDEOGAME: 'Jeux vidéo',
  },
}

export const ABILITY_DICT: Partial<Record<Locale, Record<string, string>>> = {
  ru: ABILITY_RU,
  en: {
    ability_shield: 'Shield',
    ability_shield_plus: 'Shield',
    ability_regen: 'Life Drain',
    ability_regen_plus: 'Life Drain',
    ability_retaliate: 'Retaliate',
    ability_retaliate_plus: 'Retaliate',
    ability_slash: 'Wound',
    ability_slash_plus: 'Wound',
    ability_strengthen: 'Strengthen',
    ability_strengthen_plus: 'Strengthen',
    ability_weaken: 'Curse',
    ability_weaken_plus: 'Curse',
  },
  es: {
    ability_shield: 'Escudo',
    ability_shield_plus: 'Escudo',
    ability_regen: 'Absorción de vida',
    ability_regen_plus: 'Absorción de vida',
    ability_retaliate: 'Contraataque',
    ability_retaliate_plus: 'Contraataque',
    ability_slash: 'Herida',
    ability_slash_plus: 'Herida',
    ability_strengthen: 'Fortalecer',
    ability_strengthen_plus: 'Fortalecer',
    ability_weaken: 'Maldición',
    ability_weaken_plus: 'Maldición',
  },
  fr: {
    ability_shield: 'Bouclier',
    ability_shield_plus: 'Bouclier',
    ability_regen: 'Vol de vie',
    ability_regen_plus: 'Vol de vie',
    ability_retaliate: 'Répliquer',
    ability_retaliate_plus: 'Répliquer',
    ability_slash: 'Blessure',
    ability_slash_plus: 'Blessure',
    ability_strengthen: 'Renforcer',
    ability_strengthen_plus: 'Renforcer',
    ability_weaken: 'Malédiction',
    ability_weaken_plus: 'Malédiction',
  },
}

// BINGO_RU покрывает много точечных ивент-меток (годы, ёлки) - для пилота
// переводим механически по годам/паттернам, не отдельно каждую строку.
const bingoEn: Record<string, string> = {
  hp: 'HP',
  health: 'HP',
  atk: 'Attack',
  attack: 'Attack',
  attack1: 'Attack 1',
  attack2: 'Attack 2',
  spd: 'Speed',
  speed: 'Speed',
  credit: 'Credits',
  credits: 'Credits',
  xp: 'XP',
  gene_a: 'Cyborg',
  gene_b: 'Undead',
  gene_c: 'Brawler',
  gene_d: 'Beast',
  gene_e: 'Galactic',
  gene_f: 'Mythic',
  amazons: 'Amazons',
  anniversary_25: 'Anniversary',
  anniversary_21: 'Anniversary 2021',
  anniversary_24: 'Anniversary 2024',
  anniversary_26: 'Anniversary 2026',
  bingo_bronze: 'Bronze Breeding',
  bingo_silver: 'Silver Breeding',
  bingo_gold: 'Gold Breeding',
  bingo_plat: 'Platinum Breeding',
  cross_mutation: 'Cross-mutation',
  events: 'Holidays',
  heroic: 'Heroes',
  legend: 'Legends',
  reactor: 'Reactor',
  rumble: 'Rumble',
  Starter: 'Starter Bingo',
  starter_plat: 'Platinum Bingo',
  zodiac: 'Zodiacs',
  zodiac_silver: 'Silver Zodiacs',
  '10years': '10 Years of the Game',
}
const bingoEs: Record<string, string> = {
  hp: 'PS',
  health: 'PS',
  atk: 'Ataque',
  attack: 'Ataque',
  attack1: 'Ataque 1',
  attack2: 'Ataque 2',
  spd: 'Rapidez',
  speed: 'Rapidez',
  credit: 'Créditos',
  credits: 'Créditos',
  xp: 'XP',
  gene_a: 'Cíborg',
  gene_b: 'No muerto',
  gene_c: 'Luchador',
  gene_d: 'Bestia',
  gene_e: 'Galáctico',
  gene_f: 'Mítico',
  amazons: 'Amazonas',
  anniversary_25: 'Aniversario',
  anniversary_21: 'Aniversario 2021',
  anniversary_24: 'Aniversario 2024',
  anniversary_26: 'Aniversario 2026',
  bingo_bronze: 'Cría de bronce',
  bingo_silver: 'Cría de plata',
  bingo_gold: 'Cría de oro',
  bingo_plat: 'Cría de platino',
  cross_mutation: 'Cruce mutación',
  events: 'Fiestas',
  heroic: 'Héroes',
  legend: 'Leyendas',
  reactor: 'Reactor',
  rumble: 'Alboroto',
  Starter: 'Bingo inicial',
  starter_plat: 'Bingo platino',
  zodiac: 'Zodiacos',
  zodiac_silver: 'Zodiacos plata',
  '10years': '10 años del juego',
}
const bingoFr: Record<string, string> = {
  hp: 'PV',
  health: 'PV',
  atk: 'Attaque',
  attack: 'Attaque',
  attack1: 'Attaque 1',
  attack2: 'Attaque 2',
  spd: 'Vitesse',
  speed: 'Vitesse',
  credit: 'Crédits',
  credits: 'Crédits',
  xp: 'XP',
  gene_a: 'Cyborg',
  gene_b: 'Mort-vivant',
  gene_c: 'Bagarreur',
  gene_d: 'Bête',
  gene_e: 'Galactique',
  gene_f: 'Mythique',
  amazons: 'Amazones',
  anniversary_25: 'Anniversaire',
  anniversary_21: 'Anniversaire 2021',
  anniversary_24: 'Anniversaire 2024',
  anniversary_26: 'Anniversaire 2026',
  bingo_bronze: 'Élevage bronze',
  bingo_silver: 'Élevage argent',
  bingo_gold: 'Élevage or',
  bingo_plat: 'Élevage platine',
  cross_mutation: 'Mutation croisée',
  events: 'Fêtes',
  heroic: 'Héros',
  legend: 'Légendes',
  reactor: 'Réacteur',
  rumble: 'Rumble',
  Starter: 'Bingo de base',
  starter_plat: 'Bingo platine',
  zodiac: 'Zodiaques',
  zodiac_silver: 'Zodiaques argent',
  '10years': '10 ans du jeu',
}
// Ивенты/ёлки по годам (2016-2026) - механический паттерн "Events YYYY"/"Christmas YYYY" и т.п.
for (let y = 2016; y <= 2026; y++) {
  if (BINGO_RU[`event_${y}`]) {
    bingoEn[`event_${y}`] = `Events ${y}`
    bingoEs[`event_${y}`] = `Eventos ${y}`
    bingoFr[`event_${y}`] = `Événements ${y}`
  }
  if (BINGO_RU[`event_xmas${y}`]) {
    bingoEn[`event_xmas${y}`] = `Christmas ${y}`
    bingoEs[`event_xmas${y}`] = `Navidad ${y}`
    bingoFr[`event_xmas${y}`] = `Noël ${y}`
  }
  if (BINGO_RU[`${y}_events`]) {
    bingoEn[`${y}_events`] = `Events ${y}`
    bingoEs[`${y}_events`] = `Eventos ${y}`
    bingoFr[`${y}_events`] = `Événements ${y}`
  }
  if (BINGO_RU[`${y}_mutants`]) {
    bingoEn[`${y}_mutants`] = `Mutants ${y}`
    bingoEs[`${y}_mutants`] = `Mutantes ${y}`
    bingoFr[`${y}_mutants`] = `Mutants ${y}`
  }
  if (BINGO_RU[`${y}_skins`]) {
    bingoEn[`${y}_skins`] = `Skins ${y}`
    bingoEs[`${y}_skins`] = `Skins ${y}`
    bingoFr[`${y}_skins`] = `Skins ${y}`
  }
  if (BINGO_RU[`research_${y - 2015}`] && y - 2015 <= 11) {
    bingoEn[`research_${y - 2015}`] = `Research ${y - 2015}`
    bingoEs[`research_${y - 2015}`] = `Investigación ${y - 2015}`
    bingoFr[`research_${y - 2015}`] = `Recherche ${y - 2015}`
  }
}
export const BINGO_DICT: Partial<Record<Locale, Record<string, string>>> = {
  ru: BINGO_RU,
  en: bingoEn,
  es: bingoEs,
  fr: bingoFr,
}

// Цепочка fallback для локале-осознанных словарей: locale -> EN -> RU (см.
// FALLBACK_LOCALE в i18n.ts). Для de/pt/it/tr/nl своих словарей пока нет -
// отрисовываются через EN, не через RU, пока перевод не написан.
export function geneLabelL(code: string, locale: Locale): string {
  if (!code) return ''
  const dict = GENE_DICT[locale] ?? GENE_DICT.en ?? GENE_RU
  return code
    .toUpperCase()
    .split('')
    .map((ch) => dict[ch] || GENE_DICT.en?.[ch] || GENE_RU[ch] || ch)
    .join('+')
}

export function bingoLabelL(key: string, locale: Locale): string {
  if (!key) return ''
  const dict = BINGO_DICT[locale] ?? BINGO_DICT.en ?? BINGO_RU
  const lower = key.toLowerCase()
  return (
    dict[lower] ||
    dict[key] ||
    BINGO_DICT.en?.[lower] ||
    BINGO_DICT.en?.[key] ||
    BINGO_RU[lower] ||
    BINGO_RU[key] ||
    key
  )
}

export function typeLabelL(type: string, locale: Locale): string {
  const dict = TYPE_DICT[locale] ?? TYPE_DICT.en ?? TYPE_RU
  return dict[type] ?? TYPE_DICT.en?.[type] ?? TYPE_RU[type] ?? type
}

export function abilityLabelL(name: string, locale: Locale): string {
  const dict = ABILITY_DICT[locale] ?? ABILITY_DICT.en ?? ABILITY_RU
  return dict[name] ?? ABILITY_DICT.en?.[name] ?? ABILITY_RU[name] ?? name
}

export const STAR_DICT: Partial<Record<Locale, Record<string, string>>> = {
  ru: STAR_LABEL,
  en: { normal: 'Normal', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' },
  es: { normal: 'Normal', bronze: 'Bronce', silver: 'Plata', gold: 'Oro', platinum: 'Platino' },
  fr: { normal: 'Normal', bronze: 'Bronze', silver: 'Argent', gold: 'Or', platinum: 'Platine' },
  de: { normal: 'Normal', bronze: 'Bronze', silver: 'Silber', gold: 'Gold', platinum: 'Platin' },
  pt: { normal: 'Normal', bronze: 'Bronze', silver: 'Prata', gold: 'Ouro', platinum: 'Platina' },
  it: { normal: 'Normale', bronze: 'Bronzo', silver: 'Argento', gold: 'Oro', platinum: 'Platino' },
  tr: { normal: 'Normal', bronze: 'Bronz', silver: 'Gümüş', gold: 'Altın', platinum: 'Platin' },
  nl: { normal: 'Normaal', bronze: 'Brons', silver: 'Zilver', gold: 'Goud', platinum: 'Platina' },
}
export function starLabelL(star: string, locale: Locale): string {
  const dict = STAR_DICT[locale] ?? STAR_DICT.en ?? STAR_LABEL
  return dict[star] ?? STAR_DICT.en?.[star] ?? STAR_LABEL[star] ?? star
}
