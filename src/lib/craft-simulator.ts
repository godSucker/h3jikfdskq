/**
 * This module is a TypeScript port of the original desktop craft simulator that
 * lived in {@link src/data/simulators/CRAFT/craft.py}. The legacy script
 * consumed the same XML-like recipe files, translated item identifiers and
 * simulated reward rolls. By mirroring those routines we guarantee that the web
 * version stays perfectly in sync with the proven Python reference.
 */

import blackholeRaw from '@/data/simulators/CRAFT/blackhole.txt?raw'
import labRaw from '@/data/simulators/CRAFT/lab.txt?raw'
import orbRaw from '@/data/simulators/CRAFT/orb.txt?raw'
import starRaw from '@/data/simulators/CRAFT/star.txt?raw'
import incentiveRaw from '@/data/simulators/CRAFT/incentreward.txt?raw'
import mutantNamesData from '@/data/mutant_names.json'
import craftI18nRaw from '@/data/simulators/craft-i18n.json'
import { textureUrl } from '@/lib/texture-cdn'
import type { Locale } from '@/lib/i18n'

type CraftI18nDict = Partial<Record<string, Partial<Record<Locale, string>>>>
const craftI18n = craftI18nRaw as {
  items: CraftI18nDict
  headers: CraftI18nDict
  regex: CraftI18nDict
}

const CRAFT_LEVEL_WORD: Record<Locale, string> = {
  ru: 'ур.',
  en: 'Lv.',
  es: 'Nv.',
  fr: 'Niv.',
  de: 'Stufe ',
  pt: 'Nv.',
  it: 'Liv.',
  tr: 'Sv.',
  nl: 'Niv.',
}

export type CraftCategory = 'blackhole' | 'lab' | 'orb' | 'star'

export interface CraftIngredient {
  regex: string
  amount: number
}

export interface CraftReward {
  id: string
  amount: number
  odds: number
}

export interface CraftRecipe {
  id: string
  category: CraftCategory
  bonusPer1000: number
  okHC: number
  ingredients: CraftIngredient[]
  rewards: CraftReward[]
}

export interface IncentiveReward {
  duration: number // minutes
  id: string
  per1000: number
  probability: number // 0–1
}

export interface SimulationResult {
  crafts: number
  mainRewards: Record<string, number>
  incentiveRewards: Record<string, number>
}

export interface RewardSummary {
  id: string
  amount: number
  perCraft: number
  share: number
}

export interface IncentiveSummary {
  id: string
  amount: number
  perCraft: number
}

export interface DetailedSimulationResult extends SimulationResult {
  rewardDetails: RewardSummary[]
  incentiveDetails: IncentiveSummary[]
  expectedIncentiveChance: number
  log: string[]
}

const RAW_SOURCES: Array<{ category: CraftCategory; raw: string }> = [
  { category: 'blackhole', raw: blackholeRaw },
  { category: 'lab', raw: labRaw },
  { category: 'orb', raw: orbRaw },
  { category: 'star', raw: starRaw },
]

const ITEM_TRANSLATIONS: Record<string, string> = {
  // Stars
  Star_Bronze: 'Бронзовая звезда',
  Star_Silver: 'Серебряная звезда',
  Star_Gold: 'Золотая звезда',
  Star_Platinum: 'Платиновая звезда',

  // Basic orbs
  orb_basic_attack: 'Сфера атаки',
  orb_basic_life: 'Сфера HP',
  orb_basic_critical: 'Сфера крит. урона',
  orb_basic_strengthen: 'Сфера усиления',
  orb_basic_weaken: 'Сфера понижения',
  orb_basic_regenerate: 'Сфера регенерации',
  orb_basic_shield: 'Сфера щита',
  orb_basic_retaliate: 'Сфера отражения',
  orb_basic_slash: 'Сфера ранения',
  orb_basic_xp: 'Сфера опыта',

  // Special orbs
  orb_special_addstrengthen: 'Особая сфера усиления',
  orb_special_addweaken: 'Особая сфера понижения',
  orb_special_addregenerate: 'Особая сфера регенерации',
  orb_special_addshield: 'Особая сфера щита',
  orb_special_addretaliate: 'Особая сфера отражения',
  orb_special_addslash: 'Особая сфера ранения',
  orb_special_speed: 'Особая сфера скорости',

  // Random orb recipes
  orb_basic_1: 'Случайная сфера ур.1',
  orb_basic_2: 'Случайная сфера ур.2',
  orb_basic_3: 'Случайная сфера ур.3',
  orb_basic_4: 'Случайная сфера ур.4',
  orb_special_1: 'Случайная особая сфера ур.1',
  orb_special_2: 'Случайная особая сфера ур.2',
  orb_special_3: 'Случайная особая сфера ур.3',

  // Reroll orb recipes
  orb_reroll_basic_1: 'Замена сферы ур.1',
  orb_reroll_special_1: 'Замена особой сферы ур.1',
  orb_reroll_basic_2: 'Замена сферы ур.2',
  orb_reroll_special_2: 'Замена особой сферы ур.2',
  orb_reroll_basic_3: 'Замена сферы ур.3',
  orb_reroll_special_3: 'Замена особой сферы ур.3',

  // Materials & supplies
  Material_Muto1: 'Малая доза мутостерона',
  Material_Muto10: 'Доза мутостерона',
  Material_Muto50: 'Большая доза мутостерона',
  Material_XP10: 'Плитка опыта',
  Material_XP250: 'Баночка опыта',
  Material_XP1000: 'Банка опыта',
  Material_LP10: 'Маленькая аптечка',
  Material_LP100: 'Средняя аптечка',
  Material_LP1000: 'Большая аптечка',
  Material_Gacha_Token: 'Жетон генератора',
  Material_Event_Token: 'Жетон испытания',
  Material_Jackpot_Token: 'Жетон джекпота',
  Material_Energy1: 'Пропуск',
  Material_Energy5: '5 пропусков',
  Material_Energy25: '25 пропусков',
  Material_Mystery25_Token: 'Таинственный жетон 2025',
  Material_Mystery26_Token: 'Таинственный жетон 2026',
  Material_Crawling_Token: 'Жетон ползучего',
  Material_Plague_Token: 'Жетон чумы',
  Material_Trick_Token: 'Жетон фокусов',

  // Buildings
  Building_HC_1: 'Златокузня',
  Building_HC_2: 'Золотоплавильня',
  Building_Hospital_1: 'Медлаборатория',
  Building_Mystery: 'Анализатор тайны',

  // Habitats (Zones)
  Habitat_A_3_HC: 'Люкс-зона КИБОРГОВ x4',
  Habitat_B_3_HC: 'Люкс-зона МЕРТВЯКОВ x4',
  Habitat_C_3_HC: 'Люкс-зона РУБАК x4',
  Habitat_D_3_HC: 'Люкс-зона ЗООМОРФОВ x4',
  Habitat_E_3_HC: 'Люкс-зона ГАЛАКТИКОВ x4',
  Habitat_F_3_HC: 'Люкс-зона МИФИКОВ x4',
  Habitat_ABCDEF_3_HC: 'Люкс-зона x4',

  // Boosters
  Charm_Xpx3_7: 'Бустер опыта +200% (7д)',
  Charm_Xpx2_7: 'Бустер опыта +100% (7д)',
  Charm_Regenx4_7: 'Бустер восстановления +300% (7д)',
  Charm_Regenx2_7: 'Бустер восстановления +100% (7д)',
  Charm_Critical_7: 'Бустер крит. ударов (7д)',
  Charm_Anticritical_7: 'Бустер щита (7д)',
  Charm_Xpx3_3: 'Бустер опыта +200% (3д)',
  Charm_Xpx2_3: 'Бустер опыта +100% (3д)',
  Charm_Regenx4_3: 'Бустер восстановления +300% (3д)',
  Charm_Regenx2_3: 'Бустер восстановления +100% (3д)',
  Charm_Critical_3: 'Бустер крит. ударов (3д)',
  Charm_Anticritical_3: 'Бустер щита (3д)',
  Charm_Xpx3_1: 'Бустер опыта +200% (1д)',
  Charm_Xpx2_1: 'Бустер опыта +100% (1д)',
  Charm_Regenx4_1: 'Бустер восстановления +300% (1д)',
  Charm_Regenx2_1: 'Бустер восстановления +100% (1д)',
  Charm_Critical_1: 'Бустер крит. ударов (1д)',
  Charm_Anticritical_1: 'Бустер щита (1д)',

  // Переименованные рецепты для Black Hole (перемещены в "Крафты")
  little_rewards_01: 'Крафт из 2 предметов',
  big_rewards_01: 'Крафт звёзд и жетонов испытаний',
  big_rewards_02: 'Крафт жетона генератора (шанс 15%)',

  // Рецепты для левой колонки (token_sink)
  token_sink_01: 'Платиновая звезда',
  token_sink_02: 'Золотая звезда',
  token_sink_03: 'Серебряная звезда',
  token_sink_04: 'Бронзовая звезда',
  token_sink_05: 'Золотая звезда',
  token_sink_06: 'Серебряная звезда',

  // Transformatron — базовые сферы (апгрейд/крафт)
  orb_rankup_basic_attack: 'Сфера атаки',
  orb_rankup_basic_critical: 'Сфера крит. урона',
  orb_rankup_basic_life: 'Сфера HP',
  orb_rankup_basic_regenerate: 'Сфера регенерации',
  orb_rankup_basic_retaliate: 'Сфера отражения',
  orb_rankup_basic_shield: 'Сфера щита',
  orb_rankup_basic_slash: 'Сфера ранения',
  orb_rankup_basic_strengthen: 'Сфера усиления',
  orb_rankup_basic_weaken: 'Сфера понижения',
  orb_rankup_basic_xp: 'Сфера опыта',

  // Transformatron — особые сферы (апгрейд/крафт)
  orb_rankup_special_addregenerate: 'Особая сфера регенерации',
  orb_rankup_special_addretaliate: 'Особая сфера отражения',
  orb_rankup_special_addshield: 'Особая сфера щита',
  orb_rankup_special_addslash: 'Особая сфера ранения',
  orb_rankup_special_addstrengthen: 'Особая сфера усиления',
  orb_rankup_special_addweaken: 'Особая сфера понижения',
  orb_rankup_special_speed: 'Особая сфера скорости',

  // Black Hole — хроносмещённые сферы (ур.4)
  chronoshifted_addregen: 'Хронос-сфера регенерации',
  chronoshifted_addshield: 'Хронос-сфера щита',
  chronoshifted_addslash: 'Хронос-сфера ранения',
  chronoshifted_addstrengthen: 'Хронос-сфера усиления',
  chronoshifted_addweaken: 'Хронос-сфера понижения',
  chronoshifted_retaliate: 'Хронос-сфера отражения',

  // Black Hole — pot_pourri
  pot_pourri_03: 'Смешанный крафт: 3 аптечки',
  pot_pourri_04: 'Смешанный крафт: 4 аптечки',
  pot_pourri_05: 'Смешанный крафт: 5 аптечек',
  pot_pourri_06: 'Смешанный крафт: 6 аптечек',
  pot_pourri_07: 'Смешанный крафт: 7 аптечек',

  // Supplies Lab — альтернативные ID
  medpack_1: 'Маленькая аптечка',
  muto_1: 'Малая доза мутостерона',
  muto_10: 'Доза мутостерона',
  xp_10: 'Плитка опыта',
  xp_250: 'Баночка опыта',

  // Metal Factory — строчные варианты звёзд
  star_bronze: 'Бронзовая звезда',
  star_silver: 'Серебряная звезда',
  star_gold: 'Золотая звезда',
}

// Кастомные заголовки для detail view
export const RECIPE_HEADER_TITLES: Record<string, string> = {
  // Crafts (правая колонка)
  big_rewards_01: 'Крафт на получение звёзд, жетонов испытаний и особых сфер 3 уровня',
  pot_pourri_03: 'Крафт 3 аптечек',
  pot_pourri_04: 'Крафт 4 аптечек',
  pot_pourri_05: 'Крафт 5 аптечек',
  pot_pourri_06: 'Крафт 6 аптечек',
  pot_pourri_07: 'Крафт 7 аптечек',
  little_rewards_01: 'Крафт из 2 предметов для задания',
  big_rewards_02: 'Шанс скрафтить жетон генератора (не советуем)',

  // Recipes (левая колонка)
  token_sink_01: 'Крафт платиновой звезды',
  token_sink_02: 'Крафт золотой звезды',
  token_sink_03: 'Крафт серебряной звезды',
  token_sink_04: 'Крафт бронзовой звезды',
  token_sink_05: 'Крафт золотой звезды',
  token_sink_06: 'Крафт серебряной звезды х3',
  chronoshifted_addshield: 'Крафт особой сферы щита 4 уровня',
  chronoshifted_addslash: 'Крафт особой сферы ранения 4 уровня',
  chronoshifted_addregen: 'Крафт особой сферы регенерации 4 уровня',
  chronoshifted_addweaken: 'Крафт особой сферы понижения 4 уровня',
  chronoshifted_addstrengthen: 'Крафт особой сферы усиления 4 уровня',
  chronoshifted_retaliate: 'Крафт особой сферы отражения 4 уровня',
}

const ITEM_TEXTURES: Record<string, string> = {
  // Stars
  Star_Bronze: '/stars/star_bronze.webp',
  Star_Silver: '/stars/star_silver.webp',
  Star_Gold: '/stars/star_gold.webp',
  Star_Platinum: '/stars/star_platinum.webp',

  // Tokens
  Material_Gacha_Token: '/materials/Material_Gacha_Token.png',
  Material_Event_Token: '/materials/Material_Event_Token.png',
  Material_Jackpot_Token: '/materials/Material_Jackpot_Token.png',
  Material_Mystery25_Token: '/tokens/material_mystery25_token.webp',
  Material_Mystery26_Token: '/tokens/material_mystery26_token.webp',

  // Supplies
  Material_Muto1: '/materials/mini_muto.webp',
  Material_Muto10: '/materials/normal_muto.webp',
  Material_Muto50: '/materials/big_muto.webp',
  Material_XP10: '/materials/mini_xp.webp',
  Material_XP250: '/materials/normal_xp.webp',
  Material_XP1000: '/materials/big_xp.webp',
  Material_LP10: '/med/mini_med.webp',
  Material_LP100: '/med/normal_med.webp',
  Material_LP1000: '/med/big_med.webp',
  Material_Energy5: '/materials/ticket_5.webp',
  Material_Energy25: '/materials/ticket_25.webp',
  Material_Energy1: '/materials/ticket_1.webp',
  Material_Crawling_Token: '/materials/Material_Crawling_Token.png',
  Material_Plague_Token: '/materials/Material_Plague_Token.png',
  Material_Trick_Token: '/materials/Material_Trick_Token.png',

  // Buildings, выданные как награда (не здание на /materials, а сам предмет-приз)
  Building_Hospital_1: '/buildings/hospital.png',
  Building_Mystery: '/buildings/building_mystery.png',

  // Текстуры для перемещённых рецептов Black Hole
  little_rewards_01: '/materials/big_xp.webp',
  big_rewards_01: '/stars/star_silver.webp', // Star_Silver
  big_rewards_02: '/materials/Material_Gacha_Token.png', // Generator Token Craft
}

const SPECIAL_ORB_TEXTURE_BLACKLIST = new Set([
  'orb_special_shield',
  'orb_special_shield_1',
  'orb_special_shield_2',
  'orb_special_shield_3',
  'orb_special_shield_4',
  'orb_special_shield_5',
])

const COMPLEX_REGEX_DESCRIPTIONS: Record<string, string> = {
  'orb_(basic|special)_[abcdefghijklmnopqrstuvwxyz]+':
    'Любая сфера (базовая или особая) любого типа',
  'orb_(special|basic)_[abcdefghijklmnopqrstuvwxyz]+_.*|Star_Bronze|Material_Jackpot_Token|(Material_XP|Material_Muto).*|Material_LP100|Material_LP1000':
    'Любые 3 предмета из списка: сферы любого уровня, бронзовые звезды, жетоны джекпота, опыт или мутостерон, аптечки (средние/большие)',
  'orb_(special|basic)_[abcdefghijklmnopqrstuvwxyz]+_.*|Star_Bronze|Star_Silver|Material_Jackpot_Token|(Material_XP|Material_Muto).*|Material_LP100|Material_LP1000':
    'Любые 4 предмета из списка: сферы любого уровня, бронзовые или серебряные звезды, жетоны джекпота, опыт или мутостерон, аптечки (средние/большие)',
  'Material_Muto50|Material_XP1000': 'Любая большая доза мутостерона или банка опыта',
  'orb_basic_[abcdefghijklmnopqrstuvwxyz]+': 'Любая базовая сфера',
  'orb_basic_[abcdefghijklmnopqrstuvwxyz]+_01': 'Любая базовая сфера ур.1',
  'orb_basic_[abcdefghijklmnopqrstuvwxyz]+_02': 'Любая базовая сфера ур.2',
  'orb_basic_[abcdefghijklmnopqrstuvwxyz]+_03': 'Любая базовая сфера ур.3',
  'orb_special_[abcdefghijklmnopqrstuvwxyz]+': 'Любая особая сфера',
  'orb_special_[abcdefghijklmnopqrstuvwxyz]+_01': 'Любая особая сфера ур.1',
  'orb_special_[abcdefghijklmnopqrstuvwxyz]+_02': 'Любая особая сфера ур.2',
  'orb_special_[abcdefghijklmnopqrstuvwxyz]+_03': 'Любая особая сфера ур.3',
}

function parseAttributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  const attrRegex = /(\w+)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = attrRegex.exec(tag)) !== null) {
    result[match[1]] = match[2]
  }
  return result
}

function parseRecipes(raw: string, category: CraftCategory): CraftRecipe[] {
  const recipes: CraftRecipe[] = []
  const recipeRegex = /<Recipe[^>]*>[\s\S]*?<\/Recipe>/g
  const ingredientRegex = /<ingredient[^>]*>/g
  const rewardRegex = /<reward[^>]*>/g

  const cleanedRaw = raw.replace(/-->.*$/gm, '').replace(/<\/Recipe>\s*$/m, '</Recipe>')

  const matches = cleanedRaw.match(recipeRegex)
  if (!matches) {
    return recipes
  }

  for (const block of matches) {
    const headerMatch = block.match(/<Recipe[^>]*>/)
    if (!headerMatch) continue
    const attrs = parseAttributes(headerMatch[0])

    const recipe: CraftRecipe = {
      id: attrs.id ?? 'unknown',
      category,
      bonusPer1000: attrs.bonusPer1000 ? Number(attrs.bonusPer1000) : 0,
      okHC: attrs.okHC ? Number(attrs.okHC) : 0,
      ingredients: [],
      rewards: [],
    }

    const ingredientMatches = block.match(ingredientRegex) ?? []
    for (const ingredientTag of ingredientMatches) {
      const ingredientAttrs = parseAttributes(ingredientTag)
      if (ingredientAttrs.regex) {
        recipe.ingredients.push({
          regex: ingredientAttrs.regex,
          amount: ingredientAttrs.amount ? Number(ingredientAttrs.amount) : 1,
        })
      }
    }

    const rewardMatches = block.match(rewardRegex) ?? []
    for (const rewardTag of rewardMatches) {
      const rewardAttrs = parseAttributes(rewardTag)
      if (rewardAttrs.id) {
        recipe.rewards.push({
          id: rewardAttrs.id,
          amount: rewardAttrs.amount ? Number(rewardAttrs.amount) : 1,
          odds: rewardAttrs.odds ? Number(rewardAttrs.odds) : 1000,
        })
      }
    }

    recipes.push(recipe)
  }

  return recipes
}

function parseIncentives(raw: string): IncentiveReward[] {
  const matches = raw.match(/<IncentiveReward[^>]*>/g)
  if (!matches) return []

  return matches.map((tag) => {
    const attrs = parseAttributes(tag)
    const per1000 = attrs.per1000 ? Number(attrs.per1000) : 0
    return {
      duration: attrs.duration ? Number(attrs.duration) : 0,
      id: attrs.id ?? 'unknown',
      per1000,
      probability: per1000 / 1000,
    } satisfies IncentiveReward
  })
}

// incentreward.txt is a straight dump of the <IncentiveLoop> the live game
// server has been cycling through since 2015 (confirmed byte-for-byte against
// gameconfig/craft.xml on the CDN, which wraps the same 18 entries in
// <IncentiveLoop startdate="2015-11-28T12:00:00"> with the comment "Running,
// total duration is 15d11h" - 22260 minutes, matches sum(duration) exactly).
// File order = loop order = the thing that makes "duration" meaningful; do
// NOT sort this array, only a *copy* for display purposes (see below).
export const incentiveLoopOrder = parseIncentives(incentiveRaw)
const INCENTIVE_LOOP_START_UTC = Date.UTC(2015, 10, 28, 12, 0, 0) // 10 = November (0-indexed)
const INCENTIVE_LOOP_TOTAL_MINUTES = incentiveLoopOrder.reduce((sum, r) => sum + r.duration, 0)

export interface IncentiveCycleState {
  activeIndex: number
  active: IncentiveReward | null
  elapsedInSlotMinutes: number
  remainingMinutes: number
  totalCycleMinutes: number
}

// Deterministic position in the loop for any given moment - no live server
// call needed, the whole cycle is a fixed public XML file on a fixed clock.
// Caveat: assumes the server's "startdate" is UTC (undocumented in the XML,
// standard assumption for this game's infra) - could be off by the server's
// actual timezone if that assumption is wrong.
export function getIncentiveCycleState(now: Date = new Date()): IncentiveCycleState {
  if (INCENTIVE_LOOP_TOTAL_MINUTES <= 0 || incentiveLoopOrder.length === 0) {
    return {
      activeIndex: -1,
      active: null,
      elapsedInSlotMinutes: 0,
      remainingMinutes: 0,
      totalCycleMinutes: 0,
    }
  }
  const elapsedTotal = (now.getTime() - INCENTIVE_LOOP_START_UTC) / 60000
  const pos =
    ((elapsedTotal % INCENTIVE_LOOP_TOTAL_MINUTES) + INCENTIVE_LOOP_TOTAL_MINUTES) %
    INCENTIVE_LOOP_TOTAL_MINUTES
  let cumulative = 0
  for (let i = 0; i < incentiveLoopOrder.length; i++) {
    const entry = incentiveLoopOrder[i]
    if (pos < cumulative + entry.duration) {
      return {
        activeIndex: i,
        active: entry,
        elapsedInSlotMinutes: pos - cumulative,
        remainingMinutes: cumulative + entry.duration - pos,
        totalCycleMinutes: INCENTIVE_LOOP_TOTAL_MINUTES,
      }
    }
    cumulative += entry.duration
  }
  // Unreachable unless floating-point rounding lands exactly on the boundary.
  const last = incentiveLoopOrder[incentiveLoopOrder.length - 1]
  return {
    activeIndex: incentiveLoopOrder.length - 1,
    active: last,
    elapsedInSlotMinutes: last.duration,
    remainingMinutes: 0,
    totalCycleMinutes: INCENTIVE_LOOP_TOTAL_MINUTES,
  }
}

const RECIPES = RAW_SOURCES.flatMap(({ category, raw }) => parseRecipes(raw, category))

export const craftRecipesByCategory: Record<CraftCategory, CraftRecipe[]> = {
  blackhole: RECIPES.filter((recipe) => recipe.category === 'blackhole'),
  lab: RECIPES.filter((recipe) => recipe.category === 'lab'),
  orb: RECIPES.filter((recipe) => recipe.category === 'orb'),
  star: RECIPES.filter((recipe) => recipe.category === 'star'),
}

// Дропдаун ручного выбора сортирует по шансу (старое поведение) - берём копию,
// цикл ('incentiveLoopOrder' выше) остаётся в исходном порядке файла.
export const incentiveRewards = [...incentiveLoopOrder].sort((a, b) => b.per1000 - a.per1000)

export function translateItemId(itemId: string): string {
  // Проверка в словаре предметов
  if (ITEM_TRANSLATIONS[itemId]) {
    return ITEM_TRANSLATIONS[itemId]
  }

  // Проверка в словаре имен мутантов (для Specimen_* ID)
  const mutantNames = mutantNamesData as Record<string, string>
  if (mutantNames[itemId]) {
    return mutantNames[itemId]
  }

  // Проверка на варианты предметов с суффиксами
  for (const [baseId, title] of Object.entries(ITEM_TRANSLATIONS)) {
    if (itemId.startsWith(`${baseId}_`)) {
      const suffix = itemId.slice(baseId.length + 1)
      if (/^\d+$/.test(suffix)) {
        return `${title} ур.${Number(suffix)}`
      }
    }
  }

  const readable = itemId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return readable.charAt(0).toUpperCase() + readable.slice(1)
}

// translateItemId() выше - RU-only (ITEM_TRANSLATIONS + mutantNamesData),
// без единого параметра locale - craft-simulator рендерил русские названия
// на всех 9 языках (найдено систематическим аудитом 2026-08-17, тот же класс
// бага, что в cash-machine.ts/madness-machine.ts/lucky-machine.ts).
// craft-i18n.json (src/data/simulators/craft-i18n.json) покрывает все
// 222 id, используемых в orb.txt/lab.txt/star.txt/blackhole.txt/
// incentreward.txt - 120 скопированы из materials-i18n.json (реальные
// предметы), 58 craft-специфичных (recipe/token_sink id, orb_rankup_*
// базовые названия без суффикса уровня - суффикс "ур.N"/"Lv.N"
// добавляется здесь же, как и в translateItemId) переведены вручную.
// materials-i18n.ts НЕ импортируется отсюда напрямую: CraftSimulator.svelte
// - client:load, а materials-i18n.ts тянет 255KB словарь в клиентский бандл
// (тот же класс регрессии, что 2.2MB в madness, см. d0390955b) - craft-i18n.json
// самодостаточен именно поэтому.
export function getCraftItemLabel(itemId: string, locale: Locale = 'ru'): string {
  const ru = translateItemId(itemId)
  if (locale === 'ru') return ru

  const items = craftI18n.items
  const direct = items[itemId]?.[locale]
  if (direct) return direct

  for (const baseId of Object.keys(items)) {
    if (itemId.startsWith(`${baseId}_`)) {
      const suffix = itemId.slice(baseId.length + 1)
      const base = items[baseId]?.[locale]
      if (base && /^\d+$/.test(suffix)) {
        return `${base} ${CRAFT_LEVEL_WORD[locale]}${Number(suffix)}`
      }
    }
  }

  return ru
}

export function getRecipeHeaderTitle(recipeId: string, locale: Locale = 'ru'): string {
  const ru = RECIPE_HEADER_TITLES[recipeId]
  if (ru) {
    if (locale === 'ru') return ru
    return craftI18n.headers[recipeId]?.[locale] ?? ru
  }
  return getCraftItemLabel(recipeId, locale)
}

export function getItemTexture(itemId: string): string | null {
  const raw = getRawTexture(itemId)
  return raw ? textureUrl(raw) : null
}

function getRawTexture(itemId: string): string | null {
  if (ITEM_TEXTURES[itemId]) {
    return ITEM_TEXTURES[itemId]
  }

  // Handle specific random orb recipes first (before general patterns)
  if (itemId === 'orb_basic_1') {
    return `/orbs/orb_basic_empty_01.webp`
  }
  if (itemId === 'orb_basic_2') {
    return `/orbs/orb_basic_empty_02.webp`
  }
  if (itemId === 'orb_basic_3') {
    return `/orbs/orb_basic_empty_03.webp`
  }
  if (itemId === 'orb_basic_4') {
    return `/orbs/orb_basic_empty_04.webp`
  }
  if (itemId === 'orb_special_1') {
    return `/orbs/orb_special_empty_01.webp`
  }
  if (itemId === 'orb_special_2') {
    return `/orbs/orb_special_empty_02.webp`
  }
  if (itemId === 'orb_special_3') {
    return `/orbs/orb_special_empty_03.webp`
  }

  // Handle reroll orb recipes
  if (itemId === 'orb_reroll_basic_1') {
    return `/orbs/orb_basic_empty_01.webp`
  }
  if (itemId === 'orb_reroll_basic_2') {
    return `/orbs/orb_basic_empty_02.webp`
  }
  if (itemId === 'orb_reroll_basic_3') {
    return `/orbs/orb_basic_empty_03.webp`
  }
  if (itemId === 'orb_reroll_special_1') {
    return `/orbs/orb_special_empty_01.webp`
  }
  if (itemId === 'orb_reroll_special_2') {
    return `/orbs/orb_special_empty_02.webp`
  }
  if (itemId === 'orb_reroll_special_3') {
    return `/orbs/orb_special_empty_03.webp`
  }

  if (itemId.startsWith('orb_basic_')) {
    return `/orbs/basic/${itemId}.webp`
  }

  if (itemId.startsWith('orb_special_')) {
    if (SPECIAL_ORB_TEXTURE_BLACKLIST.has(itemId)) {
      return null
    }
    return `/orbs/special/${itemId}.webp`
  }

  if (itemId.startsWith('Charm_')) {
    // Charm_*_97/98/99 (более редкие уровни бустеров) были добавлены позже и лежат
    // как оригинальные PascalCase .png, а не lowercase .webp как остальные уровни.
    if (/_9[789]$/.test(itemId)) {
      return `/boosters/${itemId}.png`
    }
    return `/boosters/${itemId.toLowerCase()}.webp`
  }

  return null
}

const CRAFT_OR_WORD: Record<Locale, string> = {
  ru: 'или',
  en: 'or',
  es: 'o',
  fr: 'ou',
  de: 'oder',
  pt: 'ou',
  it: 'o',
  tr: 'veya',
  nl: 'of',
}

export function describeIngredientRegex(regex: string, locale: Locale = 'ru'): string {
  const complexRu = COMPLEX_REGEX_DESCRIPTIONS[regex]
  if (complexRu) {
    if (locale === 'ru') return complexRu
    return craftI18n.regex[regex]?.[locale] ?? complexRu
  }

  if (
    !regex.includes('|') &&
    !regex.includes('[') &&
    !regex.includes('(') &&
    !regex.includes('.')
  ) {
    return getCraftItemLabel(regex, locale)
  }

  const parts = regex
    .split('|')
    .map((part) => part.replace(/[()]/g, '').replace(/\.\*/g, '').trim())
    .filter(Boolean)

  if (parts.length > 1) {
    const unique = Array.from(new Set(parts))
    const translated = unique.map((part) => getCraftItemLabel(part, locale))
    return translated.join(` ${CRAFT_OR_WORD[locale]} `)
  }

  return regex
}

export function calculateIncentiveChance(
  recipe: CraftRecipe,
  incentive: IncentiveReward | null,
): number {
  if (!incentive || recipe.bonusPer1000 <= 0) {
    return 0
  }

  return (recipe.bonusPer1000 / 1000) * (incentive.per1000 / 1000)
}

export function simulateRecipe(
  recipe: CraftRecipe,
  crafts: number,
  incentive: IncentiveReward | null,
  rng: () => number = Math.random,
): DetailedSimulationResult {
  const totalOdds = recipe.rewards.reduce((sum, reward) => sum + reward.odds, 0)
  const mainRewards: Record<string, number> = {}
  const incentiveRewardsResult: Record<string, number> = {}
  const log: string[] = []

  if (crafts < 1) {
    return {
      crafts: 0,
      mainRewards,
      incentiveRewards: incentiveRewardsResult,
      rewardDetails: [],
      incentiveDetails: [],
      expectedIncentiveChance: 0,
      log,
    }
  }

  const expectedIncentiveChance = calculateIncentiveChance(recipe, incentive)

  for (let i = 0; i < crafts; i += 1) {
    if (totalOdds > 0 && recipe.rewards.length > 0) {
      const roll = Math.floor(rng() * totalOdds) + 1
      let current = 0
      for (const reward of recipe.rewards) {
        current += reward.odds
        if (roll <= current) {
          mainRewards[reward.id] = (mainRewards[reward.id] ?? 0) + reward.amount
          break
        }
      }
    }

    if (incentive && expectedIncentiveChance > 0) {
      if (rng() < expectedIncentiveChance) {
        incentiveRewardsResult[incentive.id] = (incentiveRewardsResult[incentive.id] ?? 0) + 1
      }
    }
  }

  const rewardDetails = Object.entries(mainRewards)
    .map(([id, amount]) => ({
      id,
      amount,
      perCraft: crafts > 0 ? amount / crafts : 0,
      share: 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  const totalMain = rewardDetails.reduce((sum, item) => sum + item.amount, 0)
  const totalIncentive = Object.values(incentiveRewardsResult).reduce(
    (sum, amount) => sum + amount,
    0,
  )

  if (totalMain > 0) {
    for (const item of rewardDetails) {
      item.share = item.amount / totalMain
    }
  }

  const incentiveDetails: IncentiveSummary[] = Object.entries(incentiveRewardsResult)
    .map(([id, amount]) => ({
      id,
      amount,
      perCraft: crafts > 0 ? amount / crafts : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  log.push(`🎯 Результаты ${crafts} крафтов`)
  const recipeName = recipe.rewards.length ? translateItemId(recipe.rewards[0].id) : recipe.id
  log.push(`📋 Рецепт: ${recipeName}`)

  if (expectedIncentiveChance > 0 && incentive) {
    log.push(`🎲 Шанс доп. награды: ${(expectedIncentiveChance * 100).toFixed(2)}%`)
  }

  log.push('🏆 Основные награды:')
  if (rewardDetails.length === 0) {
    log.push('  - Нет наград')
  } else {
    for (const detail of rewardDetails) {
      const chancePerCraft = detail.perCraft * 100
      const sharePercent = detail.share * 100
      log.push(
        `  - ${translateItemId(detail.id)}: ${detail.amount} шт. (${chancePerCraft.toFixed(1)}% за крафт, ${sharePercent.toFixed(
          1,
        )}% от всех наград)`,
      )
    }
  }

  if (incentive) {
    if (incentiveDetails.length > 0) {
      log.push(`✨ Дополнительные награды (${translateItemId(incentive.id)}):`)
      for (const detail of incentiveDetails) {
        const actualChance = detail.perCraft * 100
        const expectedPercent = expectedIncentiveChance * 100
        log.push(
          `  - ${translateItemId(detail.id)}: ${detail.amount} шт. (ожидалось: ${expectedPercent.toFixed(1)}%, получено: ${actualChance.toFixed(
            1,
          )}%)`,
        )
      }
    } else {
      log.push(`✨ Дополнительные награды (${translateItemId(incentive.id)}) не выпали.`)
    }
  }

  log.push('📊 Статистика:')
  log.push(`  - Всего основных наград: ${totalMain}`)
  log.push(`  - Всего дополнительных наград: ${totalIncentive}`)
  log.push(`  - Общее количество наград: ${totalMain + totalIncentive}`)

  return {
    crafts,
    mainRewards,
    incentiveRewards: incentiveRewardsResult,
    rewardDetails,
    incentiveDetails,
    expectedIncentiveChance,
    log,
  }
}

export function getRewardChance(reward: CraftReward, recipe: CraftRecipe): number {
  const totalOdds = recipe.rewards.reduce((sum, item) => sum + item.odds, 0)
  if (!totalOdds) return 0
  return reward.odds / totalOdds
}

// Короткие единицы длительности - не игровые данные, обычная UI-обвязка
// (как STAR_LABEL/TIER_ADJ_TO_KEY), поэтому переведено напрямую, без
// официального источника Kobojo (для длительности его и нет).
const DURATION_UNITS: Record<Locale, { instant: string; day: string; hour: string; min: string }> =
  {
    ru: { instant: 'мгновенно', day: 'д', hour: 'ч', min: 'мин' },
    en: { instant: 'instant', day: 'd', hour: 'h', min: 'min' },
    es: { instant: 'instantáneo', day: 'd', hour: 'h', min: 'min' },
    fr: { instant: 'instantané', day: 'j', hour: 'h', min: 'min' },
    de: { instant: 'sofort', day: 'T', hour: 'Std', min: 'Min' },
    pt: { instant: 'instantâneo', day: 'd', hour: 'h', min: 'min' },
    it: { instant: 'istantaneo', day: 'g', hour: 'h', min: 'min' },
    tr: { instant: 'anlık', day: 'g', hour: 's', min: 'dk' },
    nl: { instant: 'direct', day: 'd', hour: 'u', min: 'min' },
  }

export function formatDurationMinutes(minutes: number, locale: Locale = 'ru'): string {
  const units = DURATION_UNITS[locale] ?? DURATION_UNITS.ru
  if (minutes <= 0) {
    return units.instant
  }

  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  const mins = minutes % 60

  const parts: string[] = []
  if (days) parts.push(`${days} ${units.day}`)
  if (hours) parts.push(`${hours} ${units.hour}`)
  if (mins) parts.push(`${mins} ${units.min}`)

  return parts.join(' ') || units.instant
}

export function getBonusRange(recipes: CraftRecipe[]): { min: number; max: number } {
  if (!recipes.length) {
    return { min: 0, max: 0 }
  }
  const bonuses = recipes.map((recipe) => recipe.bonusPer1000)
  return {
    min: Math.min(...bonuses),
    max: Math.max(...bonuses),
  }
}

export function getOkhcRange(recipes: CraftRecipe[]): { min: number; max: number } | null {
  const values = recipes
    .map((recipe) => recipe.okHC)
    .filter((value) => typeof value === 'number' && value > 0)
  if (!values.length) {
    return null
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

export function getFeaturedRewardIds(recipes: CraftRecipe[], limit = 5): string[] {
  const seen = new Set<string>()
  const featured: string[] = []

  for (const recipe of recipes) {
    for (const reward of recipe.rewards) {
      if (!seen.has(reward.id)) {
        seen.add(reward.id)
        featured.push(reward.id)
        if (featured.length >= limit) {
          return featured
        }
      }
    }
  }

  return featured
}
