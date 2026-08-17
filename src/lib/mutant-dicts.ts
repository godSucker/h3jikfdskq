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
  de: { A: 'Cyborg', B: 'Untot', C: 'Schläger', D: 'Bestie', E: 'Galaktisch', F: 'Mythisch' },
  pt: { A: 'Ciborgue', B: 'Morto-vivo', C: 'Brigão', D: 'Fera', E: 'Galáctico', F: 'Mítico' },
  it: { A: 'Cyborg', B: 'Non morto', C: 'Attaccabrighe', D: 'Bestia', E: 'Galattico', F: 'Mitico' },
  tr: { A: 'Siborg', B: 'Yaşayan Ölü', C: 'Kavgacı', D: 'Canavar', E: 'Galaktik', F: 'Mitik' },
  nl: { A: 'Cyborg', B: 'Ondode', C: 'Vechtersbaas', D: 'Beest', E: 'Galactisch', F: 'Mythisch' },
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
  de: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Spezial',
    SPECIAL: 'Spezial',
    special: 'Spezial',
    ZODIAC: 'Tierkreis',
    GACHA: 'Reaktor',
    gacha: 'Reaktor',
    COMMUNITY: 'Community',
    default: 'Basis/Starter',
    HEROIC: 'Helden',
    LEGEND: 'Legendär',
    RECIPE: 'Geheimnisse',
    SEASONAL: 'Events',
    VIDEOGAME: 'Videospiele',
  },
  pt: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Especial',
    SPECIAL: 'Especial',
    special: 'Especial',
    ZODIAC: 'Zodíaco',
    GACHA: 'Reator',
    gacha: 'Reator',
    COMMUNITY: 'Comunidade',
    default: 'Básico/Inicial',
    HEROIC: 'Heróis',
    LEGEND: 'Lendários',
    RECIPE: 'Segredos',
    SEASONAL: 'Eventos',
    VIDEOGAME: 'Jogos eletrônicos',
  },
  it: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Speciale',
    SPECIAL: 'Speciale',
    special: 'Speciale',
    ZODIAC: 'Zodiaco',
    GACHA: 'Reattore',
    gacha: 'Reattore',
    COMMUNITY: 'Community',
    default: 'Base/Iniziale',
    HEROIC: 'Eroi',
    LEGEND: 'Leggendari',
    RECIPE: 'Segreti',
    SEASONAL: 'Eventi',
    VIDEOGAME: 'Videogiochi',
  },
  tr: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Özel',
    SPECIAL: 'Özel',
    special: 'Özel',
    ZODIAC: 'Burç',
    GACHA: 'Reaktör',
    gacha: 'Reaktör',
    COMMUNITY: 'Topluluk',
    default: 'Temel/Başlangıç',
    HEROIC: 'Kahramanlar',
    LEGEND: 'Efsanevi',
    RECIPE: 'Sırlar',
    SEASONAL: 'Etkinlikler',
    VIDEOGAME: 'Video Oyunları',
  },
  nl: {
    Pvp: 'PvP',
    PVP: 'PvP',
    Special: 'Speciaal',
    SPECIAL: 'Speciaal',
    special: 'Speciaal',
    ZODIAC: 'Dierenriem',
    GACHA: 'Reactor',
    gacha: 'Reactor',
    COMMUNITY: 'Community',
    default: 'Basis/Starter',
    HEROIC: 'Helden',
    LEGEND: 'Legendarisch',
    RECIPE: 'Geheimen',
    SEASONAL: 'Evenementen',
    VIDEOGAME: 'Videogames',
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
  de: {
    ability_shield: 'Schild',
    ability_shield_plus: 'Schild',
    ability_regen: 'Lebensraub',
    ability_regen_plus: 'Lebensraub',
    ability_retaliate: 'Vergeltung',
    ability_retaliate_plus: 'Vergeltung',
    ability_slash: 'Wunde',
    ability_slash_plus: 'Wunde',
    ability_strengthen: 'Stärken',
    ability_strengthen_plus: 'Stärken',
    ability_weaken: 'Fluch',
    ability_weaken_plus: 'Fluch',
  },
  pt: {
    ability_shield: 'Escudo',
    ability_shield_plus: 'Escudo',
    ability_regen: 'Roubo de vida',
    ability_regen_plus: 'Roubo de vida',
    ability_retaliate: 'Retaliação',
    ability_retaliate_plus: 'Retaliação',
    ability_slash: 'Ferimento',
    ability_slash_plus: 'Ferimento',
    ability_strengthen: 'Fortalecer',
    ability_strengthen_plus: 'Fortalecer',
    ability_weaken: 'Maldição',
    ability_weaken_plus: 'Maldição',
  },
  it: {
    ability_shield: 'Scudo',
    ability_shield_plus: 'Scudo',
    ability_regen: 'Furto di vita',
    ability_regen_plus: 'Furto di vita',
    ability_retaliate: 'Rappresaglia',
    ability_retaliate_plus: 'Rappresaglia',
    ability_slash: 'Ferita',
    ability_slash_plus: 'Ferita',
    ability_strengthen: 'Rafforzare',
    ability_strengthen_plus: 'Rafforzare',
    ability_weaken: 'Maledizione',
    ability_weaken_plus: 'Maledizione',
  },
  tr: {
    ability_shield: 'Kalkan',
    ability_shield_plus: 'Kalkan',
    ability_regen: 'Can Emme',
    ability_regen_plus: 'Can Emme',
    ability_retaliate: 'Misilleme',
    ability_retaliate_plus: 'Misilleme',
    ability_slash: 'Yara',
    ability_slash_plus: 'Yara',
    ability_strengthen: 'Güçlendirme',
    ability_strengthen_plus: 'Güçlendirme',
    ability_weaken: 'Lanet',
    ability_weaken_plus: 'Lanet',
  },
  nl: {
    ability_shield: 'Schild',
    ability_shield_plus: 'Schild',
    ability_regen: 'Levensroof',
    ability_regen_plus: 'Levensroof',
    ability_retaliate: 'Vergelding',
    ability_retaliate_plus: 'Vergelding',
    ability_slash: 'Verwonding',
    ability_slash_plus: 'Verwonding',
    ability_strengthen: 'Versterken',
    ability_strengthen_plus: 'Versterken',
    ability_weaken: 'Vloek',
    ability_weaken_plus: 'Vloek',
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
const bingoDe: Record<string, string> = {
  hp: 'LP',
  health: 'LP',
  atk: 'Angriff',
  attack: 'Angriff',
  attack1: 'Angriff 1',
  attack2: 'Angriff 2',
  spd: 'Geschwindigkeit',
  speed: 'Geschwindigkeit',
  credit: 'Credits',
  credits: 'Credits',
  xp: 'XP',
  gene_a: 'Cyborg',
  gene_b: 'Untot',
  gene_c: 'Schläger',
  gene_d: 'Bestie',
  gene_e: 'Galaktisch',
  gene_f: 'Mythisch',
  amazons: 'Amazonen',
  anniversary_25: 'Jubiläum',
  anniversary_21: 'Jubiläum 2021',
  anniversary_24: 'Jubiläum 2024',
  anniversary_26: 'Jubiläum 2026',
  bingo_bronze: 'Bronze-Zucht',
  bingo_silver: 'Silber-Zucht',
  bingo_gold: 'Gold-Zucht',
  bingo_plat: 'Platin-Zucht',
  cross_mutation: 'Kreuzmutation',
  events: 'Feiertage',
  heroic: 'Helden',
  legend: 'Legenden',
  reactor: 'Reaktor',
  rumble: 'Rumble',
  Starter: 'Starter-Bingo',
  starter_plat: 'Platin-Bingo',
  zodiac: 'Tierkreiszeichen',
  zodiac_silver: 'Silberne Tierkreiszeichen',
  '10years': '10 Jahre Spiel',
}
const bingoPt: Record<string, string> = {
  hp: 'PV',
  health: 'PV',
  atk: 'Ataque',
  attack: 'Ataque',
  attack1: 'Ataque 1',
  attack2: 'Ataque 2',
  spd: 'Velocidade',
  speed: 'Velocidade',
  credit: 'Créditos',
  credits: 'Créditos',
  xp: 'XP',
  gene_a: 'Ciborgue',
  gene_b: 'Morto-vivo',
  gene_c: 'Brigão',
  gene_d: 'Fera',
  gene_e: 'Galáctico',
  gene_f: 'Mítico',
  amazons: 'Amazonas',
  anniversary_25: 'Aniversário',
  anniversary_21: 'Aniversário 2021',
  anniversary_24: 'Aniversário 2024',
  anniversary_26: 'Aniversário 2026',
  bingo_bronze: 'Reprodução de Bronze',
  bingo_silver: 'Reprodução de Prata',
  bingo_gold: 'Reprodução de Ouro',
  bingo_plat: 'Reprodução de Platina',
  cross_mutation: 'Mutação cruzada',
  events: 'Feriados',
  heroic: 'Heróis',
  legend: 'Lendas',
  reactor: 'Reator',
  rumble: 'Rumble',
  Starter: 'Bingo Inicial',
  starter_plat: 'Bingo Platina',
  zodiac: 'Zodíacos',
  zodiac_silver: 'Zodíacos de Prata',
  '10years': '10 Anos do Jogo',
}
const bingoIt: Record<string, string> = {
  hp: 'PV',
  health: 'PV',
  atk: 'Attacco',
  attack: 'Attacco',
  attack1: 'Attacco 1',
  attack2: 'Attacco 2',
  spd: 'Velocità',
  speed: 'Velocità',
  credit: 'Crediti',
  credits: 'Crediti',
  xp: 'XP',
  gene_a: 'Cyborg',
  gene_b: 'Non morto',
  gene_c: 'Attaccabrighe',
  gene_d: 'Bestia',
  gene_e: 'Galattico',
  gene_f: 'Mitico',
  amazons: 'Amazzoni',
  anniversary_25: 'Anniversario',
  anniversary_21: 'Anniversario 2021',
  anniversary_24: 'Anniversario 2024',
  anniversary_26: 'Anniversario 2026',
  bingo_bronze: 'Allevamento bronzo',
  bingo_silver: 'Allevamento argento',
  bingo_gold: 'Allevamento oro',
  bingo_plat: 'Allevamento platino',
  cross_mutation: 'Mutazione incrociata',
  events: 'Festività',
  heroic: 'Eroi',
  legend: 'Leggende',
  reactor: 'Reattore',
  rumble: 'Rumble',
  Starter: 'Bingo iniziale',
  starter_plat: 'Bingo platino',
  zodiac: 'Zodiaci',
  zodiac_silver: 'Zodiaci argento',
  '10years': '10 anni di gioco',
}
const bingoTr: Record<string, string> = {
  hp: 'SP',
  health: 'SP',
  atk: 'Saldırı',
  attack: 'Saldırı',
  attack1: 'Saldırı 1',
  attack2: 'Saldırı 2',
  spd: 'Hız',
  speed: 'Hız',
  credit: 'Krediler',
  credits: 'Krediler',
  xp: 'XP',
  gene_a: 'Siborg',
  gene_b: 'Yaşayan Ölü',
  gene_c: 'Kavgacı',
  gene_d: 'Canavar',
  gene_e: 'Galaktik',
  gene_f: 'Mitik',
  amazons: 'Amazonlar',
  anniversary_25: 'Yıl Dönümü',
  anniversary_21: '2021 Yıl Dönümü',
  anniversary_24: '2024 Yıl Dönümü',
  anniversary_26: '2026 Yıl Dönümü',
  bingo_bronze: 'Bronz Üreme',
  bingo_silver: 'Gümüş Üreme',
  bingo_gold: 'Altın Üreme',
  bingo_plat: 'Platin Üreme',
  cross_mutation: 'Çapraz mutasyon',
  events: 'Tatiller',
  heroic: 'Kahramanlar',
  legend: 'Efsaneler',
  reactor: 'Reaktör',
  rumble: 'Rumble',
  Starter: 'Başlangıç Bingosu',
  starter_plat: 'Platin Bingo',
  zodiac: 'Burçlar',
  zodiac_silver: 'Gümüş Burçlar',
  '10years': 'Oyunun 10. Yılı',
}
const bingoNl: Record<string, string> = {
  hp: 'GP',
  health: 'GP',
  atk: 'Aanval',
  attack: 'Aanval',
  attack1: 'Aanval 1',
  attack2: 'Aanval 2',
  spd: 'Snelheid',
  speed: 'Snelheid',
  credit: 'Credits',
  credits: 'Credits',
  xp: 'XP',
  gene_a: 'Cyborg',
  gene_b: 'Ondode',
  gene_c: 'Vechtersbaas',
  gene_d: 'Beest',
  gene_e: 'Galactisch',
  gene_f: 'Mythisch',
  amazons: 'Amazones',
  anniversary_25: 'Jubileum',
  anniversary_21: 'Jubileum 2021',
  anniversary_24: 'Jubileum 2024',
  anniversary_26: 'Jubileum 2026',
  bingo_bronze: 'Bronzen fokkerij',
  bingo_silver: 'Zilveren fokkerij',
  bingo_gold: 'Gouden fokkerij',
  bingo_plat: 'Platina fokkerij',
  cross_mutation: 'Kruismutatie',
  events: 'Feestdagen',
  heroic: 'Helden',
  legend: 'Legendes',
  reactor: 'Reactor',
  rumble: 'Rumble',
  Starter: 'Starter-bingo',
  starter_plat: 'Platina bingo',
  zodiac: 'Dierenriemtekens',
  zodiac_silver: 'Zilveren dierenriemtekens',
  '10years': '10 jaar spel',
}
// Ивенты/ёлки по годам (2016-2026) - механический паттерн "Events YYYY"/"Christmas YYYY" и т.п.
for (let y = 2016; y <= 2026; y++) {
  if (BINGO_RU[`event_${y}`]) {
    bingoEn[`event_${y}`] = `Events ${y}`
    bingoEs[`event_${y}`] = `Eventos ${y}`
    bingoFr[`event_${y}`] = `Événements ${y}`
    bingoDe[`event_${y}`] = `Events ${y}`
    bingoPt[`event_${y}`] = `Eventos ${y}`
    bingoIt[`event_${y}`] = `Eventi ${y}`
    bingoTr[`event_${y}`] = `Etkinlikler ${y}`
    bingoNl[`event_${y}`] = `Evenementen ${y}`
  }
  if (BINGO_RU[`event_xmas${y}`]) {
    bingoEn[`event_xmas${y}`] = `Christmas ${y}`
    bingoEs[`event_xmas${y}`] = `Navidad ${y}`
    bingoFr[`event_xmas${y}`] = `Noël ${y}`
    bingoDe[`event_xmas${y}`] = `Weihnachten ${y}`
    bingoPt[`event_xmas${y}`] = `Natal ${y}`
    bingoIt[`event_xmas${y}`] = `Natale ${y}`
    bingoTr[`event_xmas${y}`] = `Noel ${y}`
    bingoNl[`event_xmas${y}`] = `Kerst ${y}`
  }
  if (BINGO_RU[`${y}_events`]) {
    bingoEn[`${y}_events`] = `Events ${y}`
    bingoEs[`${y}_events`] = `Eventos ${y}`
    bingoFr[`${y}_events`] = `Événements ${y}`
    bingoDe[`${y}_events`] = `Events ${y}`
    bingoPt[`${y}_events`] = `Eventos ${y}`
    bingoIt[`${y}_events`] = `Eventi ${y}`
    bingoTr[`${y}_events`] = `Etkinlikler ${y}`
    bingoNl[`${y}_events`] = `Evenementen ${y}`
  }
  if (BINGO_RU[`${y}_mutants`]) {
    bingoEn[`${y}_mutants`] = `Mutants ${y}`
    bingoEs[`${y}_mutants`] = `Mutantes ${y}`
    bingoFr[`${y}_mutants`] = `Mutants ${y}`
    bingoDe[`${y}_mutants`] = `Mutanten ${y}`
    bingoPt[`${y}_mutants`] = `Mutantes ${y}`
    bingoIt[`${y}_mutants`] = `Mutanti ${y}`
    bingoTr[`${y}_mutants`] = `Mutantlar ${y}`
    bingoNl[`${y}_mutants`] = `Mutanten ${y}`
  }
  if (BINGO_RU[`${y}_skins`]) {
    bingoEn[`${y}_skins`] = `Skins ${y}`
    bingoEs[`${y}_skins`] = `Skins ${y}`
    bingoFr[`${y}_skins`] = `Skins ${y}`
    bingoDe[`${y}_skins`] = `Skins ${y}`
    bingoPt[`${y}_skins`] = `Skins ${y}`
    bingoIt[`${y}_skins`] = `Skin ${y}`
    bingoTr[`${y}_skins`] = `Skinler ${y}`
    bingoNl[`${y}_skins`] = `Skins ${y}`
  }
  if (BINGO_RU[`research_${y - 2015}`] && y - 2015 <= 11) {
    bingoEn[`research_${y - 2015}`] = `Research ${y - 2015}`
    bingoEs[`research_${y - 2015}`] = `Investigación ${y - 2015}`
    bingoFr[`research_${y - 2015}`] = `Recherche ${y - 2015}`
    bingoDe[`research_${y - 2015}`] = `Forschung ${y - 2015}`
    bingoPt[`research_${y - 2015}`] = `Pesquisa ${y - 2015}`
    bingoIt[`research_${y - 2015}`] = `Ricerca ${y - 2015}`
    bingoTr[`research_${y - 2015}`] = `Araştırma ${y - 2015}`
    bingoNl[`research_${y - 2015}`] = `Onderzoek ${y - 2015}`
  }
}
export const BINGO_DICT: Partial<Record<Locale, Record<string, string>>> = {
  ru: BINGO_RU,
  en: bingoEn,
  es: bingoEs,
  fr: bingoFr,
  de: bingoDe,
  pt: bingoPt,
  it: bingoIt,
  tr: bingoTr,
  nl: bingoNl,
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
