import { describe, it, expect } from 'vitest'
import { retaliateDamage } from './abilities'
import { applyAttack } from './resolve-attack'
import type { CombatUnit } from './battle-profile'
import type { Gene } from './type-table'

function unit(over: Partial<CombatUnit>): CombatUnit {
  return {
    instanceId: 'u',
    mutantId: 'm',
    name: 'm',
    side: 'mine',
    gene: 'A',
    portraitUrl: '',
    hp: 100000,
    maxHp: 100000,
    atk1: 1000,
    atk1Gene: 'A',
    atk1IsAOE: false,
    atk2: 1000,
    atk2Gene: 'A',
    atk2IsAOE: false,
    abilities: [],
    isAlive: true,
    shieldPool: 0,
    strengthenCharges: 0,
    weakenCharge: false,
    weakenPct: 0,
    slashDot: 0,
    critCharmBonusPct: 0,
    anticritBonusPct: 0,
    ...over,
  } as unknown as CombatUnit
}

const retaliator = (atk1Gene: Gene) =>
  unit({
    instanceId: 'def',
    side: 'enemy',
    atk1: 10000,
    atk1Gene,
    abilities: [{ kind: 'retaliate', pct: 20 }] as unknown as CombatUnit['abilities'],
  })

describe('retaliate applies the gene type modifier', () => {
  // A attacks D: +50 in the type table; here the REFLECTING unit hits with its own atk1 gene.
  it('+50% when the owner gene beats the attacker gene (A vs D)', () => {
    const r = retaliateDamage(retaliator('A'), unit({ gene: 'D' }))
    expect(r.typeModPct).toBe(50)
    expect(r.damage).toBe(3000) // 10000 * 1.5 * 20%
    expect(r.baseDamage).toBe(2000)
  })

  it('-50% when the attacker gene resists (A vs E)', () => {
    const r = retaliateDamage(retaliator('A'), unit({ gene: 'E' }))
    expect(r.typeModPct).toBe(-50)
    expect(r.damage).toBe(1000)
  })

  it('+25 / -25 and neutral', () => {
    expect(retaliateDamage(retaliator('A'), unit({ gene: 'C' })).damage).toBe(2500)
    expect(retaliateDamage(retaliator('A'), unit({ gene: 'B' })).damage).toBe(1500)
    expect(retaliateDamage(retaliator('A'), unit({ gene: 'A' })).damage).toBe(2000)
  })

  it('flows through applyAttack into the retaliate event and the attacker hp', () => {
    const attacker = unit({ instanceId: 'att', gene: 'D', atk1: 1, atk1Gene: 'neutro' })
    const out = applyAttack([attacker, retaliator('A')], 'att', 'atk1', 'def', null)
    expect(out.retaliateEvents).toHaveLength(1)
    expect(out.retaliateEvents[0].typeModPct).toBe(50)
    expect(out.retaliateEvents[0].damage).toBe(3000)
    expect(out.units.find((u) => u.instanceId === 'att')!.hp).toBe(100000 - 3000)
  })
})
