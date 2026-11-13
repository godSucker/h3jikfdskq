// Расчёт эво-калькулятора (EvotechCalculator.svelte): цены апгрейдов со скидкой и подбор
// оплаты серебром/золотом. Чистые функции без DOM, покрыты тестами (evotech.test.ts).
//
// Модель игры: каждый апгрейд уровня стоит ЛИБО серебро, ЛИБО золото (альтернативные
// цены одного апа, не сумма). Скидки на серебро и золото независимы (в игре это разные
// эксперименты Mutants-Promo-TechCenter-SC / -HC). Цена после скидки округляется вверх.
//
// Структура таблицы цен (src/data/evotech-data.js, уровни 1..400):
//  - серебро растёт до 328-го уровня, дальше постоянно (калькулятор тянет эту цену до MAX_LEVEL);
//  - золото растёт только на ранних уровнях и с 30-го уровня упирается в потолок (3000).
// Из этого следует точный алгоритм без перебора всех способов оплаты:
//  - "плоские" уровни (золото одинаковое): серебром выгодно платить за самые дешёвые по
//    серебру, то есть за самые ранние - это префикс;
//  - "ранние" уровни (золото разное, их меньше 30): выбор подмножества точным рюкзаком
//    по значению золота (сумма золота за ранние уровни - десятки тысяч, это дёшево).

export interface EvoRow {
  id: number
  gold: number
  silver: number
}

export const MIN_LEVEL = 5
export const MAX_LEVEL = 1_000_000
export const CONST_FROM_LEVEL = 328

export interface Discounts {
  silver: number // проценты 0..100
  gold: number
}

export type EvoError = 'minLevel' | 'targetLessThanStart' | 'maxLevel' | 'badConstPrice'
export type Range = [number, number] // включительно

// Цена после скидки, округление вверх (как было в калькуляторе с самого начала).
export function applyDiscount(x: bigint, pct: number): bigint {
  const p = BigInt(Math.max(0, Math.min(100, Math.round(Number(pct) || 0))))
  return (x * (100n - p) + 99n) / 100n
}

export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0])
  const out: Range[] = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

// full минус remove (remove - отсортированные непересекающиеся диапазоны).
export function subtractRanges(full: Range, remove: Range[]): Range[] {
  const out: Range[] = []
  let cur = full[0]
  for (const [a, b] of mergeRanges(remove)) {
    if (b < cur) continue
    if (a > full[1]) break
    if (a > cur) out.push([cur, a - 1])
    cur = Math.max(cur, b + 1)
  }
  if (cur <= full[1]) out.push([cur, full[1]])
  return out
}

const bmin = (a: bigint, b: bigint) => (a < b ? a : b)

export function createEvoModel(rows: readonly (EvoRow | null)[], discounts: Discounts) {
  const validRow = (r: EvoRow | null | undefined): r is EvoRow =>
    !!r && typeof r.gold === 'number' && typeof r.silver === 'number'
  const rowAt = (level: number): EvoRow | null => {
    if (validRow(rows[level])) return rows[level]
    for (let l = Math.min(level, rows.length - 1); l >= 1; l--) {
      if (validRow(rows[l])) return rows[l]
    }
    return null
  }
  const pairAt = (level: number) => {
    const r = rowAt(level)
    if (!r) return { s: 0n, g: 0n }
    return {
      s: applyDiscount(BigInt(Math.max(0, Math.floor(r.silver || 0))), discounts.silver),
      g: applyDiscount(BigInt(Math.max(0, Math.floor(r.gold || 0))), discounts.gold),
    }
  }

  // Цены по строкам таблицы до CONST_FROM_LEVEL включительно + префиксные суммы.
  const S: bigint[] = [0n]
  const G: bigint[] = [0n]
  const PS: bigint[] = [0n]
  const PG: bigint[] = [0n]
  for (let l = 1; l <= CONST_FROM_LEVEL; l++) {
    const { s, g } = pairAt(l)
    S.push(s)
    G.push(g)
    PS.push(PS[l - 1] + s)
    PG.push(PG[l - 1] + g)
  }
  // Постоянная цена после CONST_FROM_LEVEL: цена самой строки, а если там нули - ближайшая
  // ненулевая ниже (как и раньше).
  let sC = S[CONST_FROM_LEVEL]
  let gC = G[CONST_FROM_LEVEL]
  if (sC === 0n && gC === 0n) {
    for (let l = CONST_FROM_LEVEL - 1; l >= MIN_LEVEL + 1; l--) {
      if (S[l] > 0n || G[l] > 0n) {
        sC = S[l]
        gC = G[l]
        break
      }
    }
  }
  const badConstPrice = sC === 0n && gC === 0n

  const costS = (l: number) => (l <= CONST_FROM_LEVEL ? S[l] : sC)
  const costG = (l: number) => (l <= CONST_FROM_LEVEL ? G[l] : gC)
  const prefS = (x: number) =>
    x <= CONST_FROM_LEVEL ? PS[x] : PS[CONST_FROM_LEVEL] + BigInt(x - CONST_FROM_LEVEL) * sC
  const prefG = (x: number) =>
    x <= CONST_FROM_LEVEL ? PG[x] : PG[CONST_FROM_LEVEL] + BigInt(x - CONST_FROM_LEVEL) * gC
  // Сумма цен уровней (a, b].
  const sumS = (a: number, b: number) => prefS(b) - prefS(a)
  const sumG = (a: number, b: number) => prefG(b) - prefG(a)

  // Первый уровень "плоского" хвоста по золоту: дальше золото постоянно (= gC).
  let flatFrom = CONST_FROM_LEVEL
  while (flatFrom > 1 && G[flatFrom - 1] === gC) flatFrom--
  // Серебро в плоском хвосте должно не убывать, иначе "префикс = самые дешёвые" неверен.
  let silverMonotonic = true
  for (let l = Math.max(flatFrom, 2); l <= CONST_FROM_LEVEL; l++) {
    if (S[l] < S[l - 1]) silverMonotonic = false
  }
  if (sC < S[CONST_FROM_LEVEL]) silverMonotonic = false

  // ---- Рюкзак по ранним уровням (a, min(N, flatFrom-1)] ----
  interface EarlyDp {
    levels: number[]
    gTotal: number
    // Серебро-платящий вариант: dpMinSilver[v] = минимум серебра, чтобы набрать v золота экономии.
    minSilver: Float64Array
    take: Uint8Array // take[i * (gTotal + 1) + v] = 1, если i-й уровень взят на этапе i
    pareto: number[] // значения v, недоминируемые по (больше v, меньше серебра)
  }
  const dpCache = new Map<string, EarlyDp>()
  const earlyDp = (lo: number, hi: number): EarlyDp => {
    const key = `${lo}|${hi}`
    const cached = dpCache.get(key)
    if (cached) return cached
    const levels: number[] = []
    for (let l = lo; l <= hi; l++) levels.push(l)
    const gv = levels.map((l) => Number(costG(l)))
    const sw = levels.map((l) => Number(costS(l)))
    const gTotal = gv.reduce((x, y) => x + y, 0)
    const width = gTotal + 1
    const minSilver = new Float64Array(width).fill(Infinity)
    minSilver[0] = 0
    const take = new Uint8Array(levels.length * width)
    levels.forEach((_, i) => {
      for (let v = gTotal; v >= gv[i]; v--) {
        const cand = minSilver[v - gv[i]] + sw[i]
        if (cand < minSilver[v]) {
          minSilver[v] = cand
          take[i * width + v] = 1
        }
      }
    })
    const pareto: number[] = []
    let best = Infinity
    for (let v = gTotal; v >= 0; v--) {
      if (minSilver[v] < best) {
        pareto.push(v)
        best = minSilver[v]
      }
    }
    const dp = { levels, gTotal, minSilver, take, pareto }
    dpCache.set(key, dp)
    return dp
  }

  interface Saved {
    saved: bigint // сколько золота сэкономлено (оплачено серебром)
    silverSpent: bigint
    silverRanges: Range[]
  }

  // Максимум золота, которое можно НЕ тратить на уровни (a, N] при серебряном бюджете budget.
  function maxGoldSaved(a: number, N: number, budget: bigint): Saved {
    if (N <= a) return { saved: 0n, silverSpent: 0n, silverRanges: [] }
    const lo = a + 1
    const hi = Math.min(N, flatFrom - 1)
    const dp = hi >= lo ? earlyDp(lo, hi) : null
    const flatStart = Math.max(lo, flatFrom)
    const m = N >= flatStart ? N - flatStart + 1 : 0
    const flatCost = (k: number) => sumS(flatStart - 1, flatStart - 1 + k)
    const kMax = (R: bigint): number => {
      if (m === 0 || R < 0n) return 0
      if (flatCost(m) <= R) return m
      let l = 0
      let h = m
      while (l < h) {
        const mid = Math.ceil((l + h) / 2)
        if (flatCost(mid) <= R) l = mid
        else h = mid - 1
      }
      return l
    }

    let bestTotal = -1n
    let bestSilver = 0n
    let bestV = 0
    let bestK = 0
    const candidates = dp ? dp.pareto : [0]
    for (const v of candidates) {
      const w = dp ? dp.minSilver[v] : 0
      const wB = BigInt(w)
      if (wB > budget) continue
      const k = kMax(budget - wB)
      const total = BigInt(v) + BigInt(k) * gC
      const spent = wB + flatCost(k)
      if (total > bestTotal || (total === bestTotal && spent < bestSilver)) {
        bestTotal = total
        bestSilver = spent
        bestV = v
        bestK = k
      }
    }
    // Восстановление набора ранних уровней.
    const ranges: Range[] = []
    if (dp) {
      const width = dp.gTotal + 1
      let v = bestV
      for (let i = dp.levels.length - 1; i >= 0; i--) {
        if (dp.take[i * width + v]) {
          ranges.push([dp.levels[i], dp.levels[i]])
          v -= Number(costG(dp.levels[i]))
        }
      }
    }
    if (bestK > 0) ranges.push([flatStart, flatStart + bestK - 1])
    return {
      saved: bestTotal < 0n ? 0n : bestTotal,
      silverSpent: bestSilver,
      silverRanges: mergeRanges(ranges),
    }
  }

  // Максимум серебра, которое можно НЕ тратить на уровни (a, N] при золотом бюджете budget
  // (то есть за эти уровни платим золотом). Зеркало maxGoldSaved.
  function maxSilverSaved(a: number, N: number, budget: bigint): bigint {
    if (N <= a) return 0n
    const lo = a + 1
    const hi = Math.min(N, flatFrom - 1)
    const levels: number[] = []
    for (let l = lo; l <= hi; l++) levels.push(l)
    const gw = levels.map((l) => Number(costG(l)))
    const sv = levels.map((l) => Number(costS(l)))
    const gTotal = gw.reduce((x, y) => x + y, 0)
    const best = new Float64Array(gTotal + 1).fill(-Infinity)
    best[0] = 0
    levels.forEach((_, i) => {
      for (let w = gTotal; w >= gw[i]; w--) {
        const cand = best[w - gw[i]] + sv[i]
        if (cand > best[w]) best[w] = cand
      }
    })
    const flatStart = Math.max(lo, flatFrom)
    const m = N >= flatStart ? N - flatStart + 1 : 0
    const flatCost = (k: number) => sumS(flatStart - 1, flatStart - 1 + k)
    let result = 0n
    for (let w = 0; w <= gTotal; w++) {
      if (best[w] === -Infinity) continue
      const wB = BigInt(w)
      if (wB > budget) break
      const left = budget - wB
      const j = gC > 0n ? Number(bmin(BigInt(m), left / gC)) : m
      const total = BigInt(best[w]) + (flatCost(m) - flatCost(m - j))
      if (total > result) result = total
    }
    return result
  }

  // Минимальное золото на уровни (a, N] при серебряном бюджете S.
  const minGoldNeeded = (a: number, N: number, silver: bigint) =>
    sumG(a, N) - maxGoldSaved(a, N, silver).saved
  // Минимальное серебро на уровни (a, N] при золотом бюджете G.
  const minSilverNeeded = (a: number, N: number, gold: bigint) =>
    sumS(a, N) - maxSilverSaved(a, N, gold)

  return {
    badConstPrice,
    silverMonotonic,
    flatFrom,
    costS,
    costG,
    sumS,
    sumG,
    maxGoldSaved,
    maxSilverSaved,
    minGoldNeeded,
    minSilverNeeded,
  }
}

export type EvoModel = ReturnType<typeof createEvoModel>

export interface ForwardResult {
  endLevel: number
  upgrades: number
  spentSilver: bigint
  spentGold: bigint
  leftSilver: bigint
  leftGold: bigint
  hitCap: boolean
  silverRanges: Range[]
  goldRanges: Range[]
  // Что нужно докупить, чтобы поднять ещё один уровень (null на капе).
  next: { level: number; extraGold: bigint; extraSilver: bigint } | null
}

// Максимальный уровень при заданных ресурсах: оплата подбирается так, чтобы дойти как
// можно выше и при этом потратить минимум золота (оно дороже серебра).
export function solveForward(
  model: EvoModel,
  start: number,
  silver: bigint,
  gold: bigint,
  maxLevel = MAX_LEVEL,
): ForwardResult {
  const feasible = (N: number) => model.minGoldNeeded(start, N, silver) <= gold
  let lo = start
  let hi = maxLevel
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (feasible(mid)) lo = mid
    else hi = mid - 1
  }
  const N = lo
  const { saved, silverSpent, silverRanges } = model.maxGoldSaved(start, N, silver)
  const spentGold = model.sumG(start, N) - saved
  const goldRanges = N > start ? subtractRanges([start + 1, N], silverRanges) : []
  const next =
    N >= maxLevel
      ? null
      : {
          level: N + 1,
          extraGold: bigMax(0n, model.minGoldNeeded(start, N + 1, silver) - gold),
          extraSilver: bigMax(0n, model.minSilverNeeded(start, N + 1, gold) - silver),
        }
  return {
    endLevel: N,
    upgrades: N - start,
    spentSilver: silverSpent,
    spentGold,
    leftSilver: silver - silverSpent,
    leftGold: gold - spentGold,
    hitCap: N >= maxLevel,
    silverRanges,
    goldRanges,
    next,
  }
}

const bigMax = (a: bigint, b: bigint) => (a > b ? a : b)

export interface ReverseResult {
  allSilver: bigint // если платить только серебром
  allGold: bigint // если платить только золотом
  // Есть ли у игрока ресурсы (если ввёл) и чего не хватает: либо золота, либо серебра.
  enough: boolean
  extraGold: bigint
  extraSilver: bigint
  silverRanges: Range[]
  goldRanges: Range[]
}

export function solveReverse(
  model: EvoModel,
  start: number,
  target: number,
  silver: bigint,
  gold: bigint,
): ReverseResult {
  const allSilver = model.sumS(start, target)
  const allGold = model.sumG(start, target)
  const needGold = model.minGoldNeeded(start, target, silver)
  const needSilver = model.minSilverNeeded(start, target, gold)
  const enough = needGold <= gold
  let silverRanges: Range[] = []
  let goldRanges: Range[] = []
  if (enough) {
    silverRanges = model.maxGoldSaved(start, target, silver).silverRanges
    goldRanges = subtractRanges([start + 1, target], silverRanges)
  }
  return {
    allSilver,
    allGold,
    enough,
    extraGold: bigMax(0n, needGold - gold),
    extraSilver: bigMax(0n, needSilver - silver),
    silverRanges,
    goldRanges,
  }
}

export function validateLevels(start: number, target: number | null): EvoError | null {
  if (!Number.isFinite(start) || start < MIN_LEVEL) return 'minLevel'
  if (target !== null) {
    if (!Number.isFinite(target) || target <= start) return 'targetLessThanStart'
    if (target > MAX_LEVEL) return 'maxLevel'
  }
  return null
}
