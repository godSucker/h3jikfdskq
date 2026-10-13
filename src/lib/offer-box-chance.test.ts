import { describe, it, expect } from 'vitest'
import {
  MIN_BOX_CHANCE_PCT,
  buildBoxChanceIndex,
  isLowChanceBoxAppearance,
  type BoxLike,
} from './offer-box-chance'
import boxesRaw from '@/data/boxes.json'

const boxes: BoxLike[] = [
  {
    itemId: 'big_lucky',
    groups: [
      { chance: 1.5, mutants: [{ id: 'specimen_a_01' }] },
      { chance: 1.0, mutants: [{ id: 'SPECIMEN_A_01' }] }, // same mutant, other tier: chances add up
      { chance: 40, mutants: [{ id: 'specimen_b_01' }] },
    ],
  },
  { itemId: 'skin_box', groups: [{ chance: 25, mutants: [{ id: 'specimen_a_01' }] }] },
]
const index = buildBoxChanceIndex(boxes)

describe('low-chance box appearances', () => {
  it('threshold is 10%', () => expect(MIN_BOX_CHANCE_PCT).toBe(10))

  it('hides a box where the mutant is a long shot (tiers add up: 1.5 + 1.0 = 2.5%)', () => {
    expect(isLowChanceBoxAppearance(index, 'specimen_a_01', 'big_lucky')).toBe(true)
  })

  it('keeps a box where the mutant is likely (skin-style boxes, 25%)', () => {
    expect(isLowChanceBoxAppearance(index, 'specimen_a_01', 'skin_box')).toBe(false)
    expect(isLowChanceBoxAppearance(index, 'specimen_b_01', 'big_lucky')).toBe(false)
  })

  it('fails open: unknown box, unknown mutant or an obtain-entry ref is always kept', () => {
    expect(isLowChanceBoxAppearance(index, 'specimen_a_01', 'not_a_box')).toBe(false)
    expect(isLowChanceBoxAppearance(index, 'specimen_zz_99', 'big_lucky')).toBe(false)
    expect(isLowChanceBoxAppearance(index, 'specimen_a_01', 'gacha|Реактор — Япония')).toBe(false)
  })

  it('matches the screenshot from the feedback: all three boxes are below 10% for that mutant', () => {
    const real = buildBoxChanceIndex(boxesRaw as unknown as BoxLike[])
    for (const box of ['LuckyBox_Research_IX', 'Mysterybox_Ability_Retaliate', 'LuckyBox_Saber_Elite']) {
      expect(isLowChanceBoxAppearance(real, 'specimen_cc_10', box), box).toBe(true)
    }
  })
})
