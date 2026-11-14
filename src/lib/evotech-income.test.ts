import { describe, expect, it } from 'vitest'
import rows from '../data/evotech-data.js'
import type { EvoRow } from './evotech'
import {
  ZONE_TYPES,
  zoneKindForGene,
  bestSectorGene,
  sectorGeneChoices,
  compareSpend,
  evaluateSpend,
  groupIncome,
  levelAt,
  nextBigWindow,
  type IncomeGroup,
  type SpendParams,
} from './evotech-income'

const table = rows as (EvoRow | null)[]
const HUGE = 1e15 // лимит, который не достигается: режим без насыщения

// Пример Влада: на 80% с 30 до 60 нужно 380,7 млн серебра. Накопление за половину срока
// 190,35 млн, посередине скидка 70%.
function vlad(cap: number, extra: Partial<SpendParams> = {}): SpendParams {
  const group: IncomeGroup = {
    mutants: 1,
    bankPerLevel: 26437.5, // подобрано: на уровне 30 это ровно 190,35 млн за 10 суток
    level: 30,
    zones: [{ cap, slots: 4, count: 1 }],
  }
  return {
    rows: table,
    evo: 30,
    silver: 190_350_000n,
    gold: 0n,
    nowDiscount: { silver: 70, gold: 70 },
    bigDiscount: 80,
    days: 10,
    collectsPerDay: 24, // сбор каждый час: интервал 1 ч
    follow: 1,
    groups: [group],
    ...extra,
  }
}

describe('levelAt', () => {
  it('на капе уровень равен эво, с отставанием тянется частично, выше капа не бывает', () => {
    expect(levelAt(30, 30, 60, 1)).toBe(60)
    expect(levelAt(30, 30, 60, 0.5)).toBe(45)
    expect(levelAt(30, 30, 60, 0)).toBe(30)
    expect(levelAt(20, 30, 40, 1)).toBe(30) // 20 + 10, не выше уровня-ориентира (капа 40 нет)
    expect(levelAt(30, 30, 40, 5)).toBe(40) // follow режется до 1, потолок - эво
  })
})

describe('groupIncome', () => {
  it('сбор ограничен лимитом зоны', () => {
    // 4 мидаса на 120 уровне, ставка 105: 50 400 в час. За 6 часов 302 400 > лимита 160 000
    const g = groupIncome(
      { mutants: 4, bankPerLevel: 105, level: 120, zones: [{ cap: 160_000, slots: 4, count: 1 }] },
      120,
      6,
    )
    expect(g.perCycle).toBe(160_000)
    expect(g.potentialPerCycle).toBe(302_400)
    expect(g.minFillHours).toBeCloseTo(3.17, 2)
  })
  it('без насыщения доход линейно зависит от уровня', () => {
    const grp: IncomeGroup = {
      mutants: 2,
      bankPerLevel: 105,
      level: 30,
      zones: [{ cap: HUGE, slots: 4, count: 1 }],
    }
    expect(groupIncome(grp, 60, 1).perCycle).toBe(2 * groupIncome(grp, 30, 1).perCycle)
  })
  it('сначала заполняет самые вместительные зоны, лишние мутанты не размещены', () => {
    const g = groupIncome(
      {
        mutants: 7,
        bankPerLevel: 100,
        level: 10,
        zones: [
          { cap: 1_000, slots: 2, count: 1 },
          { cap: 9_000, slots: 4, count: 1 },
        ],
      },
      10,
      1,
    )
    // 4 в большую (4000 < 9000), 2 в малую (2000 > 1000 -> 1000), 1 мутант без зоны
    expect(g.placed).toBe(6)
    expect(g.unplaced).toBe(1)
    expect(g.perCycle).toBe(4000 + 1000)
  })
})

describe('evaluateSpend / compareSpend', () => {
  it('доля 0 - это "ждать", результат стабилен', () => {
    const w = evaluateSpend(vlad(HUGE), 0)
    expect(w.midLevel).toBe(30)
    expect(w.finalLevel).toBe(60) // 190,35 + 190,35 = 380,7 млн ровно до 60-го на 80%
  })
  it('пример Влада без насыщения: потратить всё на 70% даёт +1 уровень', () => {
    const all = evaluateSpend(vlad(HUGE), 1)
    expect(all.midLevel).toBe(45)
    expect(all.finalLevel).toBe(61)
    const cmp = compareSpend(vlad(HUGE))
    expect(cmp.wait.finalLevel).toBe(60)
    expect(cmp.best.finalLevel).toBeGreaterThanOrEqual(61)
  })
  it('при забитых зонах доход от эво не растёт и трата на 70% проигрывает ожиданию', () => {
    const p = vlad(1_000) // лимит крошечный: любой сбор упирается в него
    const cmp = compareSpend(p)
    expect(cmp.all.incomePerDayAfter).toBe(cmp.all.incomePerDayBefore)
    expect(cmp.all.finalLevel).toBeLessThan(cmp.wait.finalLevel)
    expect(cmp.best.fraction).toBe(0)
    expect(cmp.best.finalLevel).toBe(cmp.wait.finalLevel)
  })
  it('follow = 0: мутанты не растут, значит эво не влияет на доход', () => {
    const o = evaluateSpend(vlad(HUGE, { follow: 0 }), 1)
    expect(o.incomePerDayAfter).toBe(o.incomePerDayBefore)
  })
  it('золото тратится только на большой скидке и не пропадает', () => {
    const a = evaluateSpend(vlad(HUGE, { gold: 0n }), 0)
    const b = evaluateSpend(vlad(HUGE, { gold: 50_000n }), 0)
    expect(b.finalLevel).toBeGreaterThan(a.finalLevel)
  })
  it('нулевой срок: большая скидка сразу, ждать нечего', () => {
    const o = evaluateSpend(vlad(HUGE, { days: 0 }), 0)
    expect(o.finalLevel).toBeGreaterThanOrEqual(30)
  })
})

describe('nextBigWindow', () => {
  const windows = [
    { kind: 'birthday', from: '08-09', to: '08-30' },
    { kind: 'newyear', from: '12-25', to: '01-17' },
  ]
  it('после дня рождения ближайшее окно - Новый год', () => {
    const w = nextBigWindow(windows, new Date('2026-11-14T10:00:00Z'))!
    expect(w.kind).toBe('newyear')
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-12-25')
    expect(w.end.toISOString().slice(0, 10)).toBe('2027-01-17')
    expect(w.daysToStart).toBe(41)
  })
  it('внутри окна через Новый год остаток считается от сегодня', () => {
    const w = nextBigWindow(windows, new Date('2027-01-05T10:00:00Z'))!
    expect(w.kind).toBe('newyear')
    expect(w.daysToStart).toBe(0)
    expect(w.daysToEnd).toBe(12)
  })
  it('после Нового года ближайшее - день рождения', () => {
    const w = nextBigWindow(windows, new Date('2027-02-01T10:00:00Z'))!
    expect(w.kind).toBe('birthday')
    expect(w.start.toISOString().slice(0, 10)).toBe('2027-08-09')
  })
})

describe('данные зон', () => {
  it('лимиты зон растут с уровнем и люкс-зоны вместительнее', () => {
    for (const kind of ['low', 'beast', 'galactic', 'mythic'] as const) {
      const z = ZONE_TYPES[kind]
      expect(z[0].cap).toBeLessThan(z[1].cap)
      expect(z[1].cap).toBeLessThan(z[2].cap)
      expect(z[3].cap).toBeGreaterThan(z[2].cap === 160_000 ? 160_000 : 0)
    }
  })
})

describe('zoneKindForGene', () => {
  it('A/B/C - общие низкие лимиты, D/E/F - свои', () => {
    expect(['A', 'B', 'C'].map((g) => zoneKindForGene(g))).toEqual(['low', 'low', 'low'])
    expect(zoneKindForGene('d')).toBe('beast')
    expect(zoneKindForGene('E')).toBe('galactic')
    expect(zoneKindForGene('F')).toBe('mythic')
    expect(zoneKindForGene(undefined)).toBe('low')
  })
  it('значения лимитов совпадают с игровыми', () => {
    expect(ZONE_TYPES.mythic.map((z) => z.cap)).toEqual([
      25_000, 80_000, 160_000, 200_000, 320_000, 320_000, 400_000,
    ])
    expect(ZONE_TYPES.low.map((z) => z.cap)).toEqual([
      500, 2_500, 9_000, 200_000, 320_000, 320_000, 400_000,
    ])
    expect(ZONE_TYPES.beast[2].cap).toBe(30_000)
    expect(ZONE_TYPES.galactic[2].cap).toBe(80_000)
  })
})

describe('сектор двуногенного мутанта', () => {
  it('берётся ген с самым вместительным сектором, а не просто первый', () => {
    expect(bestSectorGene(['F', 'C'])).toBe('F') // Мидас: мифик вместительнее
    expect(bestSectorGene(['C', 'F'])).toBe('F') // порядок генов не важен
    expect(bestSectorGene(['C', 'A'])).toBe('C') // Большой бо$$: оба низкие, остаётся первый
    expect(bestSectorGene(['A'])).toBe('A') // Охотник: выбора нет
    expect(bestSectorGene(['D', 'E'])).toBe('E')
  })
  it('выбор показываем только если гены дают разные семейства секторов', () => {
    expect(sectorGeneChoices(['F', 'C'])).toEqual(['F', 'C'])
    expect(sectorGeneChoices(['A', 'B'])).toEqual(['A']) // оба низкие
    expect(sectorGeneChoices(['F', 'F'])).toEqual(['F'])
    expect(sectorGeneChoices(['A'])).toEqual(['A'])
  })
  it('универсальные люкс-сектора есть у любого семейства', () => {
    for (const k of ['low', 'beast', 'galactic', 'mythic'] as const) {
      expect(ZONE_TYPES[k].find((z) => z.id === 'u3')?.cap).toBe(400_000)
      expect(ZONE_TYPES[k].find((z) => z.id === 'u2')?.cap).toBe(320_000)
    }
  })
})
