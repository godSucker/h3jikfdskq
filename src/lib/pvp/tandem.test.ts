import { describe, expect, it } from 'vitest'
import { buildBattleUnit } from './battle-profile'
import { createBattleSession } from './fight-engine'
import { simulateBatch } from './simulate-batch'
import { buildTandemUnit, strongestTandem } from './tandem'

const noCrit = () => 0.99
const mk = (id: string, side: 'mine' | 'enemy', level: number, n: string) =>
  buildBattleUnit(id, { level, star: 'normal', side, instanceId: `${side}-${n}` })

describe('tandem', () => {
  it('strikes once, stays out of the unit list and the queue', () => {
    const helper = buildTandemUnit({ mutantId: 'specimen_a_01', level: 30, star: 'normal' }, 'mine')
    const s = createBattleSession(
      [mk('specimen_a_01', 'mine', 30, '0')],
      [mk('specimen_a_01', 'enemy', 300, '0')],
      'manual',
      'ai',
      noCrit,
      'ru',
      { mine: helper },
    )
    // whoever is first: play until it is my turn
    let guard = 0
    while (s.currentTurn()?.unit.side !== 'mine' && guard++ < 5) s.resolveTurn()
    const before = s.getUnits().find((u) => u.side === 'enemy')!.hp
    const step = s.resolveTurn({
      attack: 'atk1',
      targetId: 'enemy-0',
      tandem: true,
    })
    expect(step.tandemHit).toBeDefined()
    expect(step.tandemHit!.damage).toBeGreaterThan(0)
    expect(s.getUnits().some((u) => u.instanceId.startsWith('tandem'))).toBe(false)
    expect(s.upcomingQueue(20).some((u) => u.instanceId.startsWith('tandem'))).toBe(false)
    expect(s.getTandem('mine')).toBeNull() // spent
    const after = s.getUnits().find((u) => u.side === 'enemy')!.hp
    expect(before - after).toBeGreaterThan(step.hits[0].damage) // main hit + tandem

    // second request is a no-op
    let second: ReturnType<typeof s.resolveTurn> | undefined
    guard = 0
    while (!s.isFinished() && guard++ < 20) {
      const turn = s.currentTurn()
      if (turn?.unit.side === 'mine') {
        second = s.resolveTurn({ attack: 'atk1', targetId: 'enemy-0', tandem: true })
        break
      }
      s.resolveTurn()
    }
    if (second) expect(second.tandemHit).toBeUndefined()
  })

  it('is not spent when the main attack already ended the fight', () => {
    const helper = buildTandemUnit({ mutantId: 'specimen_a_01', level: 30, star: 'normal' }, 'mine')
    const s = createBattleSession(
      [mk('specimen_a_01', 'mine', 5000, '0')],
      [mk('specimen_a_01', 'enemy', 1, '0')],
      'manual',
      'ai',
      noCrit,
      'ru',
      { mine: helper },
    )
    let guard = 0
    while (s.currentTurn()?.unit.side !== 'mine' && guard++ < 5) s.resolveTurn()
    const step = s.resolveTurn({ attack: 'atk1', targetId: 'enemy-0', tandem: true })
    expect(s.isFinished()).toBe(true)
    expect(step.tandemHit).toBeUndefined()
    expect(s.getTandem('mine')).not.toBeNull()
  })

  it('strongest tandem is a real mutant with a clamped level and sane atk', () => {
    const cfg = strongestTandem()
    const unit = buildTandemUnit(cfg, 'mine')
    expect(unit.atk1).toBeGreaterThan(1_000_000)
    expect(Number.isFinite(unit.atk1)).toBe(true)
    expect(cfg.level).toBeLessThan(1_000_000_000)
    expect(cfg.level).toBeGreaterThan(30)
  })

  it('batch win rate rises with the one-shot tandem', () => {
    const buildMine = () => [mk('specimen_a_01', 'mine', 100, '0')]
    const buildEnemy = () => [mk('specimen_a_01', 'enemy', 100, '0')]
    const without = simulateBatch(buildMine, buildEnemy, 200)
    const cfg = strongestTandem()
    const with1 = simulateBatch(buildMine, buildEnemy, 200, Math.random, () => ({
      mine: buildTandemUnit(cfg, 'mine'),
    }))
    expect(with1.mineWinRatePct).toBeGreaterThan(without.mineWinRatePct)
    expect(with1.mineWinRatePct).toBeGreaterThan(95)
  })
})
