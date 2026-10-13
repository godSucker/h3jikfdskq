import { describe, it, expect } from 'vitest'
import { resolveHit, effectiveCritChance, rollCrit } from './damage'

describe('hit damage: integer pipeline of FightUtils::fillAttackModel', () => {
  it("game's own unit test (FightTests::testRegen): 414 with +25% type is 517, not 518", () => {
    // B attacking A: +25% in the type table; 414 + trunc(414*25/100 = 103.5) = 517
    const hit = resolveHit({ baseDamage: 414, attackerGene: 'B', targetGene: 'A', crit: false })
    expect(hit.typeModPct).toBe(25)
    expect(hit.totalDamage).toBe(517)
  })

  it('crit adds +100% first, type applies to the critted value', () => {
    const hit = resolveHit({ baseDamage: 414, attackerGene: 'B', targetGene: 'A', crit: true })
    // 414 + 414 = 828; 828 + trunc(828*25/100 = 207) = 1035
    expect(hit.totalDamage).toBe(1035)
  })

  it('negative modifiers truncate toward zero (C++ int division), not floor', () => {
    // 7 with -25%: 7 + trunc(-1.75) = 7 - 1 = 6 (Math.floor would give 5)
    const hit = resolveHit({ baseDamage: 7, attackerGene: 'A', targetGene: 'B', crit: false })
    expect(hit.typeModPct).toBe(-25)
    expect(hit.totalDamage).toBe(6)
  })

  it('buff is a separate branch from the same base: documented 10000 example gives 35000', () => {
    const hit = resolveHit({
      baseDamage: 10000, attackerGene: 'B', targetGene: 'A', crit: true, buffPct: 40,
    })
    expect(hit.mainDamage).toBe(25000)
    expect(hit.buffDamage).toBe(10000)
    expect(hit.totalDamage).toBe(35000)
  })

  it('weaken (negative buff) subtracts and never goes below zero', () => {
    const hit = resolveHit({
      baseDamage: 10000, attackerGene: 'B', targetGene: 'A', crit: true, buffPct: -20,
    })
    expect(hit.buffDamage).toBe(-5000)
    expect(hit.totalDamage).toBe(20000)
    const zero = resolveHit({ baseDamage: 10, attackerGene: 'neutro', targetGene: 'A', crit: false, buffPct: -500 })
    expect(zero.totalDamage).toBe(0)
  })

  it('neutral attacks have no type modifier', () => {
    const hit = resolveHit({ baseDamage: 999, attackerGene: 'neutro', targetGene: 'A', crit: false })
    expect(hit.typeModPct).toBe(0)
    expect(hit.totalDamage).toBe(999)
  })
})

describe('crit chance: integer, rounded UP like the client', () => {
  it('5% base', () => expect(effectiveCritChance(0, 0)).toBe(5))
  it('+10 -> 6 (5.5 rounds up)', () => expect(effectiveCritChance(10, 0)).toBe(6))
  it('+25 -> 7 (6.25 rounds up; Math.round would give 6)', () => expect(effectiveCritChance(25, 0)).toBe(7))
  it('anticrit of the target lowers it', () => expect(effectiveCritChance(0, -20)).toBe(4))
  it('crit roll is 0..99 below the chance', () => {
    expect(rollCrit(5, () => 0.049)).toBe(true) // roll 4
    expect(rollCrit(5, () => 0.05)).toBe(false) // roll 5
  })
})
