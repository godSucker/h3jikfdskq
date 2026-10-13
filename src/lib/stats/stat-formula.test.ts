import { describe, it, expect } from 'vitest'
import fixture from './__fixtures__/real-hp-base-mutants.json'
import { calculateFinalStats } from './unified-calculator'
import { calculateExactStats, lfForStars, DEFAULT_UNLOCK } from './stat-formula'

const STAR_MUL = [1.0, 1.1, 1.3, 1.75, 2.0]

describe('exact HP against real in-game records (base mutants)', () => {
  const rows = (fixture as unknown as { rows: Array<[string, number, number, number, number, number]> }).rows

  it('has a meaningful number of discriminating records', () => {
    expect(rows.length).toBeGreaterThan(200)
  })

  it('floors: every real lifePoint equals the exact formula (and the old rounded one would miss)', () => {
    let oldRoundMisses = 0
    for (const [, hpBase, stars, bonus, level, lifePoint] of rows) {
      const exact = calculateExactStats(
        { hp_base: hpBase, atk1_base: 0, atk1p_base: 0, atk2_base: 0, atk2p_base: 0 },
        { lf: lfForStars(stars), bonus },
        level,
      )
      expect(exact.hp, `hp_base ${hpBase} stars ${stars} bonus ${bonus} lvl ${level}`).toBe(lifePoint)
      const oldRound = Math.round(
        (hpBase * STAR_MUL[stars] * (level / 10 + 0.9) * (lfForStars(stars) - bonus)) /
          lfForStars(stars),
      )
      if (oldRound !== lifePoint) oldRoundMisses++
    }
    expect(oldRoundMisses).toBeGreaterThan(rows.length * 0.4)
  })
})

describe('calculateFinalStats (bonus 0) is the exact formula', () => {
  const base = { hp_base: 1819, atk1_base: 274, atk1p_base: 413, atk2_base: 549, atk2p_base: 825 }

  it('Робот gold lvl 30: HP/ATK are floored', () => {
    const s = calculateFinalStats(base, 30, 1.75)
    expect(s.hp).toBe(Math.floor((1819 * 390 * 175) / 10000))
    expect(s.atk1).toBe(Math.floor((413 * 390 * 100 * 175) / 1_000_000))
    expect(s.atk2).toBe(Math.floor((825 * 390 * 100 * 175) / 1_000_000))
  })

  it('attack upgrade levels follow the unlock tag; defaults are 10 and 15', () => {
    expect(DEFAULT_UNLOCK).toEqual({ atk1: 1, atk2: 5, atk1p: 10, atk2p: 15 })
    const at = (level: number, unlock?: object) => calculateFinalStats({ ...base, unlock }, level, 1)
    expect(at(9).atk1).toBeLessThan(at(10).atk1 / 1.5)
    // EA_99: atk1p only from 30
    expect(at(10, { atk1p: 30 }).atk1).toBe(at(9, { atk1p: 30 }).atk1 * 0 + at(10, { atk1p: 30 }).atk1)
    expect(at(10, { atk1p: 30 }).atk1).toBeLessThan(at(30, { atk1p: 30 }).atk1 / 1.5)
  })

  it('attack 2 is flagged as locked below level 5', () => {
    expect(calculateFinalStats(base, 4, 1).atk2Unlocked).toBe(false)
    expect(calculateFinalStats(base, 5, 1).atk2Unlocked).toBe(true)
  })

  it('silver is bank x level (per hour)', () => {
    expect(calculateFinalStats({ ...base, bank_base: 42 }, 30, 1).silver).toBe(1260)
  })
})
