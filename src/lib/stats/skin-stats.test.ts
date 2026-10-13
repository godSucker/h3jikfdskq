import { describe, it, expect } from 'vitest'
import mutantsRaw from '@/data/mutants/mutants.json'
import { calculateSkinStats, skinBaseHp, skinEffectiveHpBase } from './skin-stats'
import { skinsForMutant } from './skin-catalog'

const MUTANTS = new Map((mutantsRaw as any[]).map((m) => [String(m.id).toLowerCase(), m]))

function baseOf(id: string) {
  const m = MUTANTS.get(id)
  if (!m) throw new Error(`no mutant ${id}`)
  const b = m.base_stats
  return {
    hp_base: b.hp_base,
    atk1_base: b.atk1_base,
    atk1p_base: b.atk1p_base,
    atk2_base: b.atk2_base,
    atk2p_base: b.atk2p_base,
  }
}

function skinOf(id: string, code: string) {
  const s = skinsForMutant(id).find((x) => x.skin === code)
  if (!s) throw new Error(`no skin ${code} for ${id}`)
  return s
}

describe('skin HP against real in-game records', () => {
  // [mutant, skin, level, lifePoint] - undamaged specimens from captured
  // account dumps (4443/mgg_dump). lifePoint is the game's own max HP.
  const REAL: Array<[string, string, number, number]> = [
    ['specimen_a_01', 'japan', 1, 2546],
    ['specimen_de_08', 'winter', 6, 2685],
    ['specimen_b_12', 'easter', 11, 6048],
    ['specimen_fc_02', 'heroes', 13, 7961],
    ['specimen_eb_02', 'elements', 15, 3729],
    ['specimen_cf_01', 'girl', 18, 6931],
    ['specimen_ad_08', 'winter', 19, 7918],
    ['specimen_dc_10', 'winter', 21, 11082],
    ['specimen_a_01', 'japan', 22, 7894],
    ['specimen_fd_01', 'gothic', 23, 6751],
    ['specimen_fc_02', 'heroes', 26, 12666],
    ['specimen_ef_10', 'halloween', 28, 10068],
    ['specimen_e_01', 'gothic', 29, 3986],
    ['specimen_fd_07', 'easter', 30, 12972],
    ['specimen_fd_02', 'valentines', 32, 9018],
    ['specimen_cc_02', 'movies', 33, 20235],
    ['specimen_eb_05', 'elements', 34, 13196],
    ['specimen_fc_05', 'fantasy', 50, 18443],
  ]
  for (const [id, code, level, lifePoint] of REAL) {
    it(`${id} ${code} lvl ${level} = ${lifePoint}`, () => {
      const skin = skinOf(id, code)
      expect(calculateSkinStats(baseOf(id), skin, level).hp).toBe(lifePoint)
    })
  }
})

describe('skin stats against hand-written game values', () => {
  it('Робот japan (серебро, bonus -10): lvl1 2546/320/642', () => {
    const s = calculateSkinStats(baseOf('specimen_a_01'), skinOf('specimen_a_01', 'japan'), 1)
    expect([s.hp, s.atk1, s.atk2]).toEqual([2546, 320, 642])
  })

  it('Охотник за головами winter (золото, bonus 0): lvl1 3363/901/530', () => {
    const s = calculateSkinStats(baseOf('specimen_a_05'), skinOf('specimen_a_05', 'winter'), 1)
    expect([s.hp, s.atk1, s.atk2]).toEqual([3363, 901, 530])
  })

  it('Робот japan lvl30: one floor at the end (9931/1884), not the old lvl1-scaled 9929/1881', () => {
    const s = calculateSkinStats(baseOf('specimen_a_01'), skinOf('specimen_a_01', 'japan'), 30)
    expect(s.hp).toBe(9931)
    expect(s.atk1).toBe(1884)
  })

  it('Андроид girl (0 звёзд, bonus 10) lvl30: 5440/2226', () => {
    const s = calculateSkinStats(baseOf('specimen_aa_01'), skinOf('specimen_aa_01', 'girl'), 30)
    expect(s.hp).toBe(5440)
    expect(s.atk1).toBe(2226)
  })
})

describe('skin formula mechanics', () => {
  const base = {
    hp_base: 1001,
    atk1_base: 300,
    atk1p_base: 1001,
    atk2_base: 200,
    atk2p_base: 900,
  }

  it('floors instead of rounding', () => {
    // 1001 * 100 * 165 / 10000 = 1651.65
    expect(skinBaseHp(1001, { stars: 3, bonus: 10 }, 1)).toBe(1651)
    expect(skinEffectiveHpBase(1001, { stars: 3, bonus: 10 })).toBe(1651)
  })

  it('orb HP is a second floor applied after the base floor', () => {
    const hp0 = skinBaseHp(1001, { stars: 3, bonus: 10 }, 1)
    const s = calculateSkinStats(base, { stars: 3, bonus: 10 }, 1, { hpPct: 7 })
    expect(s.hp).toBe(Math.floor((107 * hp0) / 100))
  })

  it('orb attack percent sits inside the single floor', () => {
    const s = calculateSkinStats(base, { stars: 0, bonus: 0 }, 10, { atk1Pct: 5 })
    expect(s.atk1).toBe(Math.floor((105 * 100 * 19 * 1001 * 100) / 1e7))
  })

  it('attack upgrades to the "p" value at level 10 (atk1) and 15 (atk2)', () => {
    const at = (level: number) =>
      calculateSkinStats(base, { stars: 0, bonus: 0 }, level)
    expect(at(9).atk1).toBe(Math.floor((100 * 100 * 18 * 300 * 100) / 1e7))
    expect(at(10).atk1).toBe(Math.floor((100 * 100 * 19 * 1001 * 100) / 1e7))
    expect(at(14).atk2).toBe(Math.floor((100 * 100 * 23 * 200 * 100) / 1e7))
    expect(at(15).atk2).toBe(Math.floor((100 * 100 * 24 * 900 * 100) / 1e7))
  })

  it('stays exact at troll levels (beyond 2^53 in plain numbers) and saturates like the game', () => {
    const huge = calculateSkinStats(
      { ...base, atk1p_base: 3000 },
      { stars: 4, bonus: 20 },
      10_000_000,
    )
    expect(huge.atk1).toBe(2147483647)
    expect(Number.isInteger(huge.atk1)).toBe(true)
  })

  it('never returns less than 1 HP with orbs', () => {
    expect(calculateSkinStats({ ...base, hp_base: 0 }, { stars: 0, bonus: 0 }, 1, { hpPct: 5 }).hp)
      .toBe(1)
  })
})
