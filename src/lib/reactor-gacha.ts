import gachaRaw from '@/data/simulators/reactor/gacha.json'
import mutantNamesRaw from '@/data/simulators/reactor/mutant_names.json'
import gachaNameRuRaw from '@/data/simulators/reactor/gacha-name-ru.json'
import gachaCoversRaw from '@/data/simulators/reactor/gacha-covers.json'
import gachaCoversI18nRaw from '@/data/simulators/reactor/gacha-covers-i18n.json'

export type GachaId = keyof typeof gachaRaw

export interface BasicReward {
  specimen: string
  stars: number
  odds: number
  bonus: number
}

export interface GachaDefinition {
  token_cost: number
  hc_cost: number
  filter: string
  basic_elements: BasicReward[]
  completion_reward: BasicReward | null
}

export interface GachaMeta extends GachaDefinition {
  id: string
  name: string
  totalOdds: number
  cover: string | null
}

export const STAR_LABEL: Record<number, string> = {
  0: '',
  1: 'Бронзовая звезда',
  2: 'Серебряная звезда',
  3: 'Золотая звезда',
  4: 'Платиновая звезда',
}

export const STAR_ICON: Record<number, string> = {
  0: '/stars/no_stars.webp',
  1: '/stars/star_bronze.webp',
  2: '/stars/star_silver.webp',
  3: '/stars/star_gold.webp',
  4: '/stars/star_platinum.webp',
}

// Вынесено в JSON (2026-08-07, Фаза 2 авто-анонсов) - .локал-флоу в
// telegram-webhook.ts дописывает сюда RU-имя через GitHub Contents API PUT,
// патчить объект внутри .ts строковыми правками было бы хрупко.
export const GACHA_NAME_RU: Record<string, string> = gachaNameRuRaw

// Официальный текст с самого баннера (assets/gachacontent/btn_gacha_<id>-*.png)
// - подтверждено визуально 2026-08-16, что Kobojo НЕ локализует эти баннеры
// (все 8 языковых копий на CDN оказались побайтово идентичны, MD5 совпадает -
// GACHA_COVERS_I18N ниже физически хранит одну и ту же картинку под разными
// путями). Название реактора на баннере - английское для ЛЮБОЙ локали игры,
// поэтому это единственный официальный источник для не-RU локалей - RU-имя в
// GACHA_NAME_RU выше творческая адаптация сайта ("Хищницы" для "Girl Power" и
// т.п.), не дословный перевод, LLM-перевод кураторского RU не использовался.
export const GACHA_NAME_EN: Record<string, string> = {
  western: 'Western',
  gachaboss: 'Big Boss!',
  japan: 'Japan',
  fantasy: 'Dark Fantasy',
  lucha: 'Lucha Libre',
  olympians: 'Gods of the Arena',
  music: 'Music',
  villains: 'Mutants Super-Villains',
  starwars: 'Space Wars',
  beach: 'Tropical Summer',
  heroes: 'Mutants Super-Heroes',
  soldiers: 'Time Soldiers',
  gothic: 'Gothic',
  movies: 'Movies',
  elements: 'Elements Squad',
  steampunk: 'The Steampunk',
  vegetal: 'Photosynthesis',
  girl: 'Girl Power',
  olympics: 'Bloody Games',
  checkmate: 'Checkmate',
  gemstones: 'Gemstones',
}

function gachaName(id: string, locale: string): string {
  if (locale === 'ru') return GACHA_NAME_RU[id] ?? id
  return GACHA_NAME_EN[id] ?? GACHA_NAME_RU[id] ?? id
}

// Обложки - официальный крoп-арт игры (assets/gachacontent/btn_gacha_<live-id>-ru.png
// на Kobojo CDN), локализованная RU-версия с русским текстом на баннере, .png
// (перезалиты 2026-08-06 взамен старых .webp с английским текстом). Ключ здесь -
// наш локальный slug генератора, который может отличаться от текущего id в игре
// (checkmate -> chess, см. gacha.json) - подтверждено сверкой fingerprint'а по
// составу specimen'ов basic_elements/completion_reward.
// Вынесено в JSON по той же причине, что и GACHA_NAME_RU выше - Фаза 2
// авто-добавления реакторов дописывает сюда путь после загрузки арта на CDN.
export const GACHA_COVERS: Partial<Record<string, string>> = gachaCoversRaw

// Локализованные обложки (2026-08-15) - те же официальные крoп-арты с Kobojo
// CDN, но с текстом названия реактора на нужном языке
// (assets/gachacontent/btn_gacha_<live-id>-<lang>.png). RU остаётся в
// GACHA_COVERS выше (обратная совместимость с build-announcements.ts/
// simulate-announcements-page-data.ts, которые читают только этот флэт-файл
// и не должны знать о локалях). checkmate тоже смаплен на "chess" live-id,
// как и в GACHA_COVERS.
const GACHA_COVERS_I18N: Partial<Record<string, Partial<Record<string, string>>>> =
  gachaCoversI18nRaw

export function getGachaCover(id: string, locale: string): string | null {
  if (locale === 'ru') {
    return GACHA_COVERS[id] ?? null
  }
  return GACHA_COVERS_I18N[id]?.[locale] ?? GACHA_COVERS[id] ?? null
}

export const mutantNames: Record<string, string> = mutantNamesRaw

export const gachaMap: Record<string, GachaDefinition> = gachaRaw

export function getGachaMeta(id: string, locale = 'ru'): GachaMeta | null {
  const definition = gachaMap[id]
  if (!definition) {
    return null
  }
  const totalOdds = definition.basic_elements.reduce((sum, item) => sum + item.odds, 0)
  const name = gachaName(id, locale)
  const cover = getGachaCover(id, locale)
  return {
    id,
    name,
    totalOdds,
    cover,
    ...definition,
  }
}

export function listGachas(locale = 'ru'): GachaMeta[] {
  return Object.keys(gachaMap)
    .map((id) => getGachaMeta(id, locale)!)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, locale))
}

export function getMutantName(specimenId: string): string {
  return mutantNames[specimenId] ?? specimenId
}

// Взвешенный выбор награды из пула по odds. rng инжектируется (default
// Math.random), тот же паттерн, что в cash-machine.ts/lucky-machine.ts/
// madness-machine.ts/craft-simulator.ts - реальный UI ничего не передаёт,
// это про тестируемость (детерминированный прогон с fixed rng), не про то,
// что дефолт должен быть не Math.random.
export function rollWeighted(
  pool: BasicReward[],
  totalW: number,
  rng: () => number = Math.random,
): BasicReward {
  let threshold = rng() * totalW
  for (const item of pool) {
    threshold -= item.odds
    if (threshold <= 0) return item
  }
  return pool[pool.length - 1]
}
