/**
 * Main Breeding Calculator - MGG Game Rules Implementation
 *
 * This module orchestrates the breeding calculation by:
 * 1. Generating possible gene combinations (core-algorithm.ts)
 * 2. Finding matching mutants in the database
 * 3. Filtering by type availability rules (type-filters.ts)
 * 4. Handling secret recipes
 * 5. Calculating odds (weight = (chance + levelBonus) × LengthOut)
 * 6. Calculating breeding duration
 */

import { calculatePossibleOffspring, normalizeGeneCode, canBreedChild } from './core-algorithm'
import {
  canBreedByType,
  getBreedingTag,
  isUnbreedableType,
  UNBREEDABLE_TYPES,
} from './type-filters'
import { secretCombos } from '@/lib/secretCombos'
import { normalizeSearch as normalizeName } from '@/lib/search-normalize'

// --- 1. Types ---

export type BuildingLevel = 1 | 2 | 3
export type StarLevel = 0 | 1 | 2 | 3 | 4 // 0=none, 1=bronze, 2=silver, 3=gold, 4=platinum

export interface Mutant {
  id: string
  name: string
  genes: string | string[]
  chance: number
  type?: string
  incub_time?: number
  image?: string | string[]
}

export interface BreedingResult {
  child: Mutant
  isSecret?: boolean
  tag?: string
  probability: number
  weight: number
  duration: number // seconds
}

export interface ParentPair {
  p1: Mutant
  p2: Mutant
  isSecret: boolean
  duration: number
  probability: number
}

// --- 2. LengthOut Table (from breedingsettings_decoded.xml) ---

// Key: "allele1Len,allele2Len" -> { one, two }
// one = weight multiplier for single-gene offspring (A, B, C...)
// two = weight multiplier for double-gene offspring (AA, AB, AC...)
// three = dead field (no triple-gene mutants exist)
const LENGTH_OUT: Record<string, { one: number; two: number }> = {
  '1,1': { one: 1, two: 4 },
  '1,2': { one: 1, two: 18 },
  '1,3': { one: 1, two: 15 },
  '2,1': { one: 1, two: 18 },
  '2,2': { one: 0, two: 1 },
  '2,3': { one: 0, two: 1 },
  '3,1': { one: 1, two: 15 },
  '3,2': { one: 0, two: 1 },
  '3,3': { one: 0, two: 0 },
}

// --- 3. Level Bonus Tables (from XML <Hybridization>) ---

const LEVEL_BONUS_ODDS: Record<BuildingLevel, number> = {
  1: 0,
  2: 50,
  3: 200,
}

const LEVEL_BONUS_ODDS_RECIPE: Record<BuildingLevel, number> = {
  1: 0,
  2: 1,
  3: 4,
}

// --- 4. Breeding Speed (from decompiled game client) ---

const BUILDING_SPEED: Record<BuildingLevel, number> = {
  1: 0.99,
  2: 0.66,
  3: 0.33,
}

// Star timer multiplier: 1 + timerMalus/100
// Platinum has timerMalus=0 but useFusionRules=true (separate mechanic)
const STAR_TIMER_MULTIPLIER: Record<StarLevel, number> = {
  0: 1.0,
  1: 1.5, // Bronze: timerMalus=50
  2: 2.0, // Silver: timerMalus=100
  3: 3.0, // Gold: timerMalus=200
  4: 1.0, // Platinum: timerMalus=0 (fusion rules apply)
}

// --- 5. Helpers ---

function getGeneStr(genes: string | string[]): string {
  const str = Array.isArray(genes) ? genes.join('') : genes
  return str ? str.toUpperCase().trim() : ''
}

function dnaLength(geneCode: string): number {
  return geneCode.length
}

function getLengthOut(p1Genes: string, p2Genes: string): { one: number; two: number } {
  const len1 = dnaLength(p1Genes)
  const len2 = dnaLength(p2Genes)
  const key = `${len1},${len2}`
  return LENGTH_OUT[key] ?? { one: 0, two: 0 }
}

function getWeightMultiplier(childGenes: string, lo: { one: number; two: number }): number {
  const len = dnaLength(childGenes)
  if (len === 1) return lo.one
  if (len === 2) return lo.two
  return 0
}

function matchesOffspringGenes(childGenes: string, possibleOffspring: string[]): boolean {
  const normalized = normalizeGeneCode(childGenes)
  return possibleOffspring.includes(normalized)
}

// Вынесено на уровень модуля из calculateBreeding, чтобы findParentsFor
// (реверс-поиск родителей) считал вес КАНДИДАТА той же самой формулой -
// раньше у findParentsFor не было доступа к этой логике и он аппроксимировал
// через один "представительный" вызов calculateBreeding на всю категорию
// генов, что давало неточный знаменатель (см. STEP 5 ниже и комментарий у
// probCache в findParentsFor).
function computeCandidateWeight(
  m: Mutant,
  lo: { one: number; two: number },
  buildingLevel: BuildingLevel,
): number {
  const multiplier = getWeightMultiplier(getGeneStr(m.genes), lo)
  if (multiplier <= 0) return 0
  const isRecipeType = (m.type || '').toLowerCase() === 'recipe'
  const baseChance = Number(m.chance) || 0
  const levelBonus = isRecipeType
    ? LEVEL_BONUS_ODDS[buildingLevel] + LEVEL_BONUS_ODDS_RECIPE[buildingLevel]
    : LEVEL_BONUS_ODDS[buildingLevel]
  return (baseChance + levelBonus) * multiplier
}

// --- 6. Main Breeding Calculator ---

export function calculateBreeding(
  p1: Mutant,
  p2: Mutant,
  allMutants: Mutant[],
  buildingLevel: BuildingLevel = 3,
  star1: StarLevel = 0,
  star2: StarLevel = 0,
): BreedingResult[] {
  if (!p1 || !p2) return []

  const seenIds = new Set<string>()

  const p1Name = normalizeName(p1.name)
  const p2Name = normalizeName(p2.name)
  const p1Id = String(p1.id)
  const p2Id = String(p2.id)

  // ========================================
  // STEP 1: SECRET RECIPES (Highest Priority)
  // ========================================
  // "Секрет" - это не гарантированный (100%) результат, а исключение из правила
  // canBreedByType: этого потомка в принципе НЕЛЬЗЯ получить ни от какой другой
  // пары (тип заблокирован для всех, кроме указанной здесь пары), но раз уж пара
  // верная - шанс считается по тем же формулам веса, что и у обычных кандидатов
  // (см. STEP 3/4), и делит один пул вероятностей с ними. Раньше секрет жёстко
  // получал 100% В ДОПОЛНЕНИЕ к обычным кандидатам, которые сами суммировались
  // в свои 100% - итого пользователю показывалось ~200% на одну пару родителей.
  const secretMatch = secretCombos.find((combo) => {
    const cP1 = normalizeName(combo.parents[0])
    const cP2 = normalizeName(combo.parents[1])
    return (cP1 === p1Name && cP2 === p2Name) || (cP1 === p2Name && cP2 === p1Name)
  })

  const secretChild = secretMatch
    ? allMutants.find((m) => normalizeName(m.name) === normalizeName(secretMatch.childName))
    : undefined
  if (secretChild) seenIds.add(String(secretChild.id))

  // Calculate duration for secrets
  const pairDuration = calculateDuration(p1, p2, buildingLevel, star1, star2)

  // ========================================
  // STEP 1.5: PLATINUM FUSION (Guaranteed Result)
  // ========================================
  if (star1 === 4 && star2 === 4 && p1Id === p2Id) {
    const fusionDuration = calculateDuration(p1, p2, buildingLevel, 4, 4)
    return [
      {
        child: p1,
        isSecret: false,
        tag: 'ПЛАТИНА',
        probability: 100,
        weight: 0,
        duration: fusionDuration,
      },
    ]
  }

  // ========================================
  // STEP 2: CALCULATE POSSIBLE GENE COMBINATIONS
  // ========================================
  const p1Genes = getGeneStr(p1.genes)
  const p2Genes = getGeneStr(p2.genes)

  const possibleOffspring = calculatePossibleOffspring(p1Genes, p2Genes)
  const lo = getLengthOut(p1Genes, p2Genes)

  function computeWeight(m: Mutant): number {
    return computeCandidateWeight(m, lo, buildingLevel)
  }

  // ========================================
  // STEP 3 & 4: FIND MATCHING MUTANTS AND FILTER BY TYPE
  // ========================================
  const rawCandidates: BreedingResult[] = []

  // Секретный потомок делит один пул вероятностей с обычными кандидатами (см.
  // комментарий у STEP 1) - его вес считается по той же формуле, но БЕЗ
  // проверок matchesOffspringGenes/canBreedByType: секрет по определению
  // нарушает обычные правила скрещивания (иначе он не был бы "секретом", а
  // просто обычным кандидатом с этой парой родителей).
  if (secretChild) {
    rawCandidates.push({
      child: secretChild,
      isSecret: true,
      tag: 'РЕЦЕПТ',
      probability: 0,
      weight: computeWeight(secretChild),
      duration: pairDuration,
    })
  }

  for (const m of allMutants) {
    const mId = String(m.id)
    if (seenIds.has(mId)) continue

    const mGenes = getGeneStr(m.genes)

    if (!matchesOffspringGenes(mGenes, possibleOffspring)) {
      continue
    }

    if (!canBreedByType(m, p1Id, p2Id)) {
      continue
    }

    const tag = getBreedingTag(m, p1Id, p2Id)
    const weight = computeWeight(m)

    if (weight <= 0) continue

    rawCandidates.push({
      child: m,
      isSecret: false,
      tag,
      probability: 0,
      weight,
      duration: pairDuration,
    })
    seenIds.add(mId)
  }

  // ========================================
  // STEP 5: CALCULATE PROBABILITIES
  // ========================================
  const totalWeight = rawCandidates.reduce((sum, c) => sum + c.weight, 0)
  for (const c of rawCandidates) {
    c.probability = totalWeight > 0 ? (c.weight / totalWeight) * 100 : 0
  }

  // ========================================
  // STEP 6: SORT RESULTS
  // ========================================
  return rawCandidates.sort((a, b) => {
    if (a.isSecret !== b.isSecret) return a.isSecret ? -1 : 1
    if (a.tag === 'КОПИЯ' && b.tag !== 'КОПИЯ') return -1
    if (b.tag === 'КОПИЯ' && a.tag !== 'КОПИЯ') return 1
    return b.probability - a.probability
  })
}

// --- 7. Breeding Duration Calculation ---

export function calculateDuration(
  p1: Mutant,
  p2: Mutant,
  buildingLevel: BuildingLevel = 3,
  star1: StarLevel = 0,
  star2: StarLevel = 0,
): number {
  const baseTime1 = Number(p1.incub_time) || 0
  const baseTime2 = Number(p2.incub_time) || 0
  const sumMinutes = baseTime1 + baseTime2

  const speed = BUILDING_SPEED[buildingLevel]

  // Star multiplier uses the higher star of the two parents (heuristic = min(star1, star2))
  // But for timer, the game uses the result star's timerMalus
  // For breeding (no star result), star multiplier = 1.0
  // For star fusion, use the target star's multiplier
  // We use min(star1, star2) as the "result star level"
  const minStar = Math.min(star1, star2) as StarLevel
  const starMult = STAR_TIMER_MULTIPLIER[minStar]

  // Platinum fusion: timerMalus=0, so starMult=1.0 (same as no star)
  const durationSeconds = Math.round(sumMinutes * 60 * speed * starMult)

  return durationSeconds
}

// --- 8. Reverse Breeding (Find Parents) ---

// Кэш привязан к конкретному массиву мутантов: другой массив -> другой кэш
// (раньше модульный кэш строился один раз и молча игнорировал новые данные).
const geneCodeCaches = new WeakMap<Mutant[], Map<string, Mutant[]>>()

function getGeneCodeMap(allMutants: Mutant[]): Map<string, Mutant[]> {
  const cached = geneCodeCaches.get(allMutants)
  if (cached) return cached
  const map = new Map<string, Mutant[]>()
  for (const m of allMutants) {
    const code = getGeneStr(m.genes)
    if (!map.has(code)) map.set(code, [])
    map.get(code)!.push(m)
  }
  geneCodeCaches.set(allMutants, map)
  return map
}

export function recommendedScore(probability: number, durationSec: number, W = 3): number {
  if (durationSec <= 0 || probability <= 0) return 0
  const p = probability / 100
  return Math.pow(p, W) * (3600 / durationSec)
}

function canBeStarParent(m: Mutant, star1: StarLevel, star2: StarLevel): boolean {
  const usesSilverOrGold = star1 >= 2 || star2 >= 2
  if (!usesSilverOrGold) return true
  const t = (m.type || 'default').toLowerCase()
  return !UNBREEDABLE_TYPES.has(t)
}

export function findParentsFor(
  target: Mutant,
  allMutants: Mutant[],
  buildingLevel: BuildingLevel = 3,
  star1: StarLevel = 0,
  star2: StarLevel = 0,
): ParentPair[] {
  const tName = normalizeName(target.name)
  const tType = (target.type || 'default').toLowerCase()
  const tGenes = getGeneStr(target.genes)
  const tId = String(target.id)

  // Platinum: always target × target
  if (star1 === 4 && star2 === 4) {
    return [
      {
        p1: target,
        p2: target,
        isSecret: false,
        probability: 100,
        duration: calculateDuration(target, target, buildingLevel, 4, 4),
      },
    ]
  }

  const secretRecipes = secretCombos.filter((s) => normalizeName(s.childName) === tName)
  if (secretRecipes.length > 0) {
    const results: ParentPair[] = []
    secretRecipes.forEach((r) => {
      const p1 = allMutants.find((m) => normalizeName(m.name) === normalizeName(r.parents[0]))
      const p2 = allMutants.find((m) => normalizeName(m.name) === normalizeName(r.parents[1]))
      if (p1 && p2) {
        // Тот же реальный шанс, что и в прямом калькуляторе (calculateBreeding),
        // а не жёсткие 100% - секрет делит вероятность с обычными кандидатами
        // этой же пары родителей.
        const match = calculateBreeding(p1, p2, allMutants, buildingLevel, star1, star2).find(
          (res) => normalizeName(res.child.name) === tName,
        )
        results.push({
          p1,
          p2,
          isSecret: true,
          probability: match?.probability ?? 0,
          duration: calculateDuration(p1, p2, buildingLevel, star1, star2),
        })
      }
    })
    return results
  }

  if (isUnbreedableType(tType)) {
    return []
  }

  const byGeneCode = getGeneCodeMap(allMutants)
  const targetGenePool = tGenes.split('').filter((g, i, arr) => arr.indexOf(g) === i)

  const relevantCodes = [...byGeneCode.keys()].filter((code) =>
    targetGenePool.some((g) => code.includes(g)),
  )

  const validCategoryPairs: [string, string][] = []
  for (let i = 0; i < relevantCodes.length; i++) {
    for (let j = i; j < relevantCodes.length; j++) {
      if (canBreedChild(tGenes, relevantCodes[i], relevantCodes[j])) {
        validCategoryPairs.push([relevantCodes[i], relevantCodes[j]])
      }
    }
  }

  const needsInheritance = !canBreedByType(target, 'none', 'none')

  // Раньше здесь брали ОДНУ "представительную" пару родителей на всю
  // категорию генов (c1,c2) и её вероятность (из calculateBreeding)
  // применяли ко ВСЕМ реальным парам в этой категории. Баг: totalWeight
  // (знаменатель) в calculateBreeding зависит не только от категории, а и
  // от КОНКРЕТНЫХ p1/p2 - heroic/pvp-мутанты и легендарки не из
  // BREEDABLE_LEGENDS допускаются в пул кандидатов-потомков, только когда
  // сами являются одним из родителей (canBreedByType, правило "пара
  // возвращает себя"). У разных конкретных пар внутри одной категории этот
  // "самодопуск" разный - представительная пара давала неточный (до ×1.5)
  // результат. Найдено код-ревью 2026-08-11.
  //
  // Фикс: totalWeight(p1,p2) = baseWeight(c1,c2) [не зависит от конкретных
  // p1/p2 - вес "всегда доступных" кандидатов, кэшируется по категории один
  // раз через canBreedByType(m,'none','none') - сентинел-id никогда не
  // совпадёт с реальным родителем, поэтому proходят только обычные типы и
  // BREEDABLE_LEGENDS] + extraWeightIfParent(p1) + extraWeightIfParent(p2)
  // [добавка от самодопуска, если p1/p2 сам special-type и подходит по
  // генам - O(1) на родителя]. Даёт точный результат за тот же проход по
  // allMutants на категорию, что и раньше - без пересчёта calculateBreeding
  // на каждую из потенциально десятков тысяч конкретных пар.
  interface CategoryPool {
    possibleOffspring: string[]
    lo: { one: number; two: number }
    targetWeight: number
    baseWeight: number
  }
  const poolCache = new Map<string, CategoryPool>()
  function getCategoryPool(c1: string, c2: string): CategoryPool {
    const key = `${c1}|${c2}`
    const cached = poolCache.get(key)
    if (cached) return cached

    const possibleOffspring = calculatePossibleOffspring(c1, c2)
    const lo = getLengthOut(c1, c2)
    const targetWeight = matchesOffspringGenes(tGenes, possibleOffspring)
      ? computeCandidateWeight(target, lo, buildingLevel)
      : 0

    let baseWeight = 0
    for (const m of allMutants) {
      if (!matchesOffspringGenes(getGeneStr(m.genes), possibleOffspring)) continue
      if (!canBreedByType(m, 'none', 'none')) continue
      baseWeight += computeCandidateWeight(m, lo, buildingLevel)
    }

    const pool: CategoryPool = { possibleOffspring, lo, targetWeight, baseWeight }
    poolCache.set(key, pool)
    return pool
  }

  function extraWeightIfParent(p: Mutant, pool: CategoryPool): number {
    if (!matchesOffspringGenes(getGeneStr(p.genes), pool.possibleOffspring)) return 0
    if (canBreedByType(p, 'none', 'none')) return 0 // уже учтён в baseWeight
    if (!canBreedByType(p, p.id, p.id)) return 0 // не допускается даже как свой родитель
    return computeCandidateWeight(p, pool.lo, buildingLevel)
  }

  // Секретный ребёнок делит один пул вероятностей с обычными кандидатами
  // ТОЙ КОНКРЕТНОЙ пары родителей, что указана в secretCombos (см. STEP 1 в
  // calculateBreeding) - если случайная пара (p1,p2), рассматриваемая здесь
  // для СОВСЕМ ДРУГОЙ цели, совпадает с чьей-то секретной комбинацией, её
  // totalWeight в реальности больше на вес этого секретного ребёнка. baseWeight/
  // extraWeightIfParent выше этого не ловят (это не про категорию генов и не
  // про тип p1/p2, а про точное совпадение конкретной пары) - секретов мало
  // (~20), считаем отдельной map по паре id, без изменения асимптотики.
  // Обнаружено верификацией фикса 2026-08-11 (пара Драконежить×Рептоид - и
  // валидные родители для "Киска Кайдзю", и секретная пара для "Страхолюдочка").
  const secretPairExtraWeight = new Map<string, number>()
  for (const combo of secretCombos) {
    const sp1 = allMutants.find((m) => normalizeName(m.name) === normalizeName(combo.parents[0]))
    const sp2 = allMutants.find((m) => normalizeName(m.name) === normalizeName(combo.parents[1]))
    const schild = allMutants.find(
      (m) => normalizeName(m.name) === normalizeName(combo.childName),
    )
    if (!sp1 || !sp2 || !schild) continue
    const lo = getLengthOut(getGeneStr(sp1.genes), getGeneStr(sp2.genes))
    const w = computeCandidateWeight(schild, lo, buildingLevel)
    if (w <= 0) continue
    const key = [sp1.id, sp2.id].sort().join('|')
    secretPairExtraWeight.set(key, (secretPairExtraWeight.get(key) ?? 0) + w)
  }
  function secretExtraWeight(p1: Mutant, p2: Mutant): number {
    return secretPairExtraWeight.get([p1.id, p2.id].sort().join('|')) ?? 0
  }

  const results: ParentPair[] = []
  const selfBreedCache = new Map<string, number>()

  function getSelfBreedProb(mutant: Mutant): number {
    const key = mutant.id
    if (selfBreedCache.has(key)) return selfBreedCache.get(key)!
    const res = calculateBreeding(mutant, mutant, allMutants, buildingLevel, star1, star2)
    const match = res.find((r) => normalizeName(r.child.name) === tName)
    const prob = match ? match.probability : 0
    selfBreedCache.set(key, prob)
    return prob
  }

  for (const [c1, c2] of validCategoryPairs) {
    const pool = getCategoryPool(c1, c2)
    if (pool.targetWeight <= 0) continue

    const group1 = byGeneCode.get(c1)!
    const group2 = c1 === c2 ? group1 : byGeneCode.get(c2)!

    // extraWeight считается один раз НА МУТАНТА (не на пару) - иначе
    // внутренний двойной цикл станет на порядок дороже без выигрыша в
    // точности (extraWeightIfParent не зависит от второго родителя).
    const extra1 = new Map<string, number>()
    for (const p1 of group1) extra1.set(p1.id, extraWeightIfParent(p1, pool))
    const extra2 =
      c1 === c2
        ? extra1
        : new Map(group2.map((p2) => [p2.id, extraWeightIfParent(p2, pool)] as const))

    for (const p1 of group1) {
      if (!canBeStarParent(p1, star1, star2)) continue
      for (const p2 of group2) {
        if (!canBeStarParent(p2, star1, star2)) continue
        if (needsInheritance && p1.id !== target.id && p2.id !== target.id) continue
        // Дедуп-guard нужен только внутри одной категории (c1===c2) -
        // когда категории разные, validCategoryPairs уже перечисляет каждую
        // пару категорий ровно один раз (i<=j при построении), и здесь
        // фильтровать нечего - раньше guard был безусловным и совпадал с
        // верным поведением только благодаря случайности (id кодирует
        // ген-код в текущих данных), см. код-ревью 2026-08-11.
        if (c1 === c2 && p1.id > p2.id) continue
        const totalWeight =
          pool.baseWeight +
          (extra1.get(p1.id) ?? 0) +
          (extra2.get(p2.id) ?? 0) +
          secretExtraWeight(p1, p2)
        const prob =
          p1.id === p2.id
            ? getSelfBreedProb(p1)
            : totalWeight > 0
              ? (pool.targetWeight / totalWeight) * 100
              : 0
        if (prob <= 0) continue
        results.push({
          p1,
          p2,
          isSecret: false,
          probability: prob,
          duration: calculateDuration(p1, p2, buildingLevel, star1, star2),
        })
      }
    }
  }

  return results
}
