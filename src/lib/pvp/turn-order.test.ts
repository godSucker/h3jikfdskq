import { describe, it, expect } from 'vitest'
import { computeTurnQueue } from './turn-order'
import type { CombatUnit } from './battle-profile'

function unit(id: string, speedRaw: number, level: number, side: 'mine' | 'enemy', isAlive = true) {
  return { instanceId: id, speedRaw, speedX100: 1000 / speedRaw, level, side, isAlive } as unknown as CombatUnit
}
const ids = (q: CombatUnit[]) => q.map((u) => u.instanceId)

describe('turn order: tie-break of FightContext::computeTurns', () => {
  it('a faster unit (smaller raw speed) goes first', () => {
    const q = computeTurnQueue([unit('slow', 300, 30, 'mine'), unit('fast', 200, 30, 'enemy')], 2)
    expect(ids(q)[0]).toBe('fast')
  })

  it('equal speed: the HIGHER LEVEL goes first (raid boss lvl 250 beats a lvl 180 player)', () => {
    const q = computeTurnQueue([unit('player', 351, 180, 'mine'), unit('boss', 351, 250, 'enemy')], 4)
    expect(ids(q)).toEqual(['boss', 'player', 'boss', 'player'])
  })

  it('equal speed and level: the side decides (mine first), whatever the array order', () => {
    const q = computeTurnQueue([unit('e', 250, 30, 'enemy'), unit('m', 250, 30, 'mine')], 4)
    expect(ids(q)).toEqual(['m', 'e', 'm', 'e'])
  })

  it('is deterministic - the rng argument no longer matters', () => {
    const us = [unit('a', 250, 30, 'mine'), unit('b', 250, 30, 'enemy'), unit('c', 250, 30, 'mine')]
    const first = ids(computeTurnQueue(us, 9, () => 0.1))
    const second = ids(computeTurnQueue(us, 9, () => 0.9))
    expect(first).toEqual(second)
  })

  it('time windows: speeds 100 and 250 interleave, a tie at t=500 keeps the pre-sort order', () => {
    const q = computeTurnQueue([unit('slow', 250, 30, 'mine'), unit('fast', 100, 30, 'enemy')], 7)
    expect(ids(q)).toEqual(['fast', 'fast', 'slow', 'fast', 'fast', 'fast', 'slow'])
  })

  it('dead units never appear', () => {
    const q = computeTurnQueue([unit('a', 250, 30, 'mine'), unit('dead', 100, 30, 'enemy', false)], 3)
    expect(ids(q)).toEqual(['a', 'a', 'a'])
  })
})
