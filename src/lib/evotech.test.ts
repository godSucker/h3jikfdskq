import { describe, expect, it } from 'vitest'
import rows from '../data/evotech-data.js'
import {
  CONST_FROM_LEVEL,
  applyDiscount,
  createEvoModel,
  mergeRanges,
  solveForward,
  solveReverse,
  subtractRanges,
  type Discounts,
  type EvoRow,
} from './evotech'

const table = rows as (EvoRow | null)[]
const model = (d: Discounts = { silver: 0, gold: 0 }) => createEvoModel(table, d)

describe('applyDiscount', () => {
  it('округляет вверх и ограничивает 0..100', () => {
    expect(applyDiscount(100n, 70)).toBe(30n)
    expect(applyDiscount(5n, 80)).toBe(1n) // 5 * 0.2 = 1
    expect(applyDiscount(7n, 70)).toBe(3n) // 2.1 -> 3
    expect(applyDiscount(100n, -5)).toBe(100n)
    expect(applyDiscount(100n, 150)).toBe(0n)
  })
})

describe('ranges', () => {
  it('склеивает соседние и вычитает', () => {
    expect(
      mergeRanges([
        [6, 8],
        [9, 12],
        [20, 22],
      ]),
    ).toEqual([
      [6, 12],
      [20, 22],
    ])
    expect(
      subtractRanges(
        [6, 30],
        [
          [6, 12],
          [20, 22],
        ],
      ),
    ).toEqual([
      [13, 19],
      [23, 30],
    ])
    expect(subtractRanges([6, 30], [])).toEqual([[6, 30]])
    expect(subtractRanges([6, 10], [[1, 20]])).toEqual([])
  })
})

describe('таблица цен', () => {
  it('допущения алгоритма выполняются на реальных данных', () => {
    for (const d of [0, 50, 60, 70, 80]) {
      const m = model({ silver: d, gold: d })
      expect(m.silverMonotonic).toBe(true)
      expect(m.flatFrom).toBe(30) // золото упирается в потолок с 30-го уровня
      expect(m.badConstPrice).toBe(false)
    }
  })
  it('суммы совпадают с прямым суммированием, в том числе после 328', () => {
    const m = model({ silver: 70, gold: 50 })
    let s = 0n
    let g = 0n
    for (let l = 11; l <= CONST_FROM_LEVEL + 40; l++) {
      s += m.costS(l)
      g += m.costG(l)
    }
    expect(m.sumS(10, CONST_FROM_LEVEL + 40)).toBe(s)
    expect(m.sumG(10, CONST_FROM_LEVEL + 40)).toBe(g)
  })
  it('скидки на серебро и золото независимы', () => {
    const m = model({ silver: 50, gold: 70 })
    const base = model()
    expect(m.costS(100)).toBe(applyDiscount(base.costS(100), 50))
    expect(m.costG(100)).toBe(applyDiscount(base.costG(100), 70))
  })
})

// ---- Эталонный перебор на малых диапазонах ----
function brute(m: ReturnType<typeof model>, a: number, N: number, S: bigint, G: bigint) {
  const n = N - a
  let minGold: bigint | null = null // мин. золото при серебре <= S
  let minSilver: bigint | null = null // мин. серебро при золоте <= G
  let feasible = false
  for (let mask = 0; mask < 1 << n; mask++) {
    let s = 0n
    let g = 0n
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) s += m.costS(a + 1 + i)
      else g += m.costG(a + 1 + i)
    }
    if (s <= S && (minGold === null || g < minGold)) minGold = g
    if (g <= G && (minSilver === null || s < minSilver)) minSilver = s
    if (s <= S && g <= G) feasible = true
  }
  return { minGold, minSilver, feasible }
}

// Детерминированный ГПСЧ, чтобы тест воспроизводился.
function rng(seed: number) {
  let x = seed
  return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296
}

describe('оптимизатор против перебора', () => {
  const rand = rng(12345)
  const discountSets: Discounts[] = [
    { silver: 0, gold: 0 },
    { silver: 50, gold: 70 },
    { silver: 80, gold: 80 },
  ]
  for (const d of discountSets) {
    it(`минимум золота/серебра и достижимость, скидки ${d.silver}/${d.gold}`, () => {
      const m = model(d)
      for (const a of [5, 8, 15, 22, 26, 29, 30, 34]) {
        for (let trial = 0; trial < 12; trial++) {
          const N = a + 1 + Math.floor(rand() * 11)
          const full = m.sumS(a, N)
          const S = BigInt(Math.floor(Number(full) * rand()))
          const fullG = m.sumG(a, N)
          const G = BigInt(Math.floor(Number(fullG) * rand()))
          const b = brute(m, a, N, S, G)
          expect(m.minGoldNeeded(a, N, S)).toBe(b.minGold)
          expect(m.minSilverNeeded(a, N, G)).toBe(b.minSilver)
          expect(m.minGoldNeeded(a, N, S) <= G).toBe(b.feasible)
        }
      }
    })
  }

  it('solveForward даёт максимальный достижимый уровень', () => {
    const m = model({ silver: 60, gold: 60 })
    for (const a of [5, 12, 20, 27, 30, 31]) {
      for (let trial = 0; trial < 10; trial++) {
        const cap = a + 12
        const S = BigInt(Math.floor(Number(m.sumS(a, cap)) * rand()))
        const G = BigInt(Math.floor(Number(m.sumG(a, cap)) * rand()))
        let best = a
        for (let N = a + 1; N <= cap; N++) if (brute(m, a, N, S, G).feasible) best = N
        const r = solveForward(m, a, S, G, cap)
        expect(r.endLevel).toBe(best)
      }
    }
  })
})

describe('solveForward', () => {
  it('траты и остатки согласованы с планом и бюджетом', () => {
    const m = model({ silver: 50, gold: 70 })
    for (const [a, S, G] of [
      [10, 50_000_000n, 5_000n],
      [28, 2_000_000_000n, 50_000n],
      [100, 10_000_000_000n, 40_000n],
      [400, 100_000_000_000n, 0n],
    ] as [number, bigint, bigint][]) {
      const r = solveForward(m, a, S, G)
      let s = 0n
      let g = 0n
      for (const [x, y] of r.silverRanges) for (let l = x; l <= y; l++) s += m.costS(l)
      for (const [x, y] of r.goldRanges) for (let l = x; l <= y; l++) g += m.costG(l)
      expect(r.spentSilver).toBe(s)
      expect(r.spentGold).toBe(g)
      expect(r.leftSilver).toBe(S - s)
      expect(r.leftGold).toBe(G - g)
      expect(r.leftSilver >= 0n && r.leftGold >= 0n).toBe(true)
      expect(r.upgrades).toBe(r.endLevel - a)
    }
  })
  it('на следующий уровень действительно не хватает', () => {
    const m = model({ silver: 70, gold: 70 })
    const r = solveForward(m, 50, 500_000_000n, 30_000n)
    expect(r.next).not.toBeNull()
    expect(r.next!.extraGold > 0n || r.next!.extraSilver > 0n).toBe(true)
    // доплата золотом возвращает возможность взять уровень
    const again = solveForward(m, 50, 500_000_000n, 30_000n + r.next!.extraGold)
    expect(again.endLevel).toBeGreaterThan(r.endLevel)
    // а на единицу меньше - нет
    if (r.next!.extraGold > 0n) {
      const less = solveForward(m, 50, 500_000_000n, 30_000n + r.next!.extraGold - 1n)
      expect(less.endLevel).toBe(r.endLevel)
    }
  })
  it('без ресурсов уровень не растёт, на капе next = null', () => {
    const m = model()
    expect(solveForward(m, 50, 0n, 0n).endLevel).toBe(50)
    const capped = solveForward(m, 999_990, 10n ** 30n, 10n ** 30n)
    expect(capped.endLevel).toBe(1_000_000)
    expect(capped.hitCap).toBe(true)
    expect(capped.next).toBeNull()
  })
  it('не хуже прежней жадности "сначала серебро, потом золото" на ранних уровнях', () => {
    const m = model({ silver: 60, gold: 60 })
    const greedy = (a: number, S: bigint, G: bigint) => {
      let lvl = a
      while (lvl < 120) {
        const n = lvl + 1
        if (m.costS(n) > 0n && S >= m.costS(n)) {
          S -= m.costS(n)
          lvl = n
        } else if (m.costG(n) > 0n && G >= m.costG(n)) {
          G -= m.costG(n)
          lvl = n
        } else break
      }
      return lvl
    }
    const rand2 = rng(777)
    for (let i = 0; i < 40; i++) {
      const a = 5 + Math.floor(rand2() * 30)
      const S = BigInt(Math.floor(rand2() * 3e8))
      const G = BigInt(Math.floor(rand2() * 60_000))
      expect(solveForward(m, a, S, G, 120).endLevel).toBeGreaterThanOrEqual(greedy(a, S, G))
    }
  })
})

describe('solveReverse', () => {
  it('без своих ресурсов даёт цену в одной валюте и недостачу целиком', () => {
    const m = model({ silver: 70, gold: 70 })
    const r = solveReverse(m, 30, 100, 0n, 0n)
    expect(r.allSilver).toBe(m.sumS(30, 100))
    expect(r.allGold).toBe(m.sumG(30, 100))
    expect(r.enough).toBe(false)
    expect(r.extraGold).toBe(r.allGold) // с нулевым серебром золота нужно столько же
    expect(r.extraSilver).toBe(r.allSilver)
  })
  it('ресурсов хватает - есть план, недостачи нет', () => {
    const m = model({ silver: 70, gold: 70 })
    const r = solveReverse(m, 30, 60, 10n ** 12n, 0n)
    expect(r.enough).toBe(true)
    expect(r.extraGold).toBe(0n)
    expect(r.silverRanges).toEqual([[31, 60]])
    expect(r.goldRanges).toEqual([])
  })
  it('смешанный бюджет: докупка золота делает цель достижимой', () => {
    const m = model({ silver: 50, gold: 70 })
    const S = m.sumS(30, 100) / 2n
    const r = solveReverse(m, 30, 100, S, 0n)
    expect(r.enough).toBe(false)
    expect(r.extraGold).toBeGreaterThan(0n)
    expect(r.extraGold).toBeLessThan(r.allGold)
    const ok = solveReverse(m, 30, 100, S, r.extraGold)
    expect(ok.enough).toBe(true)
    const almost = solveReverse(m, 30, 100, S, r.extraGold - 1n)
    expect(almost.enough).toBe(false)
  })
})
