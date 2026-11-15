import { describe, expect, it } from 'vitest'
import mutants from '@/data/mutants/mutants.json'
import bingos from '@/data/bingos.json'
import {
  appearancesFor,
  appearancesSignature,
  bingoChipsFor,
  buildAppearances,
  goldBuildingsOnBoard,
  pickRecentOffers,
  type BingoBoardData,
} from './appearances'

// 2x2 board: rewards = row0, row1, col0, col1, whole board.
const board = (rewards: string[]): BingoBoardData => ({
  id: 'b',
  columns: 2,
  rewards: rewards.map((name) => ({ name })),
  mutants: ['a', 'b', 'c', 'd'].map((s) => ({ specimenId: `Specimen_${s}` })),
})

describe('goldBuildingsOnBoard', () => {
  const none = 'orb_basic_xp_04'
  it('counts only the row/column/board the mutant actually sits on', () => {
    const b = board([none, none, none, 'Building_HC_1', none]) // forge on column 1
    expect(goldBuildingsOnBoard(b, 'specimen_b')).toEqual(['forge']) // row0,col1
    expect(goldBuildingsOnBoard(b, 'specimen_d')).toEqual(['forge']) // row1,col1
    expect(goldBuildingsOnBoard(b, 'specimen_a')).toEqual([]) // col0
  })
  it('the prize for the whole board covers everyone, both buildings can stack', () => {
    const b = board(['Building_HC_2', none, none, none, 'Building_HC_1'])
    expect(goldBuildingsOnBoard(b, 'specimen_a').sort()).toEqual(['forge', 'smelter'])
    expect(goldBuildingsOnBoard(b, 'specimen_d')).toEqual(['forge'])
  })
  it('ignores boards without a line-reward layout and unknown mutants', () => {
    expect(goldBuildingsOnBoard(board(['Building_HC_1']), 'specimen_a')).toEqual([])
    expect(
      goldBuildingsOnBoard(board([none, none, none, none, 'Building_HC_1']), 'specimen_zz'),
    ).toEqual([])
  })
})

describe('bingoChipsFor', () => {
  it('puts forge/smelter boards first, keeps the site order for the rest', () => {
    const gold = { ...board(['Building_HC_2', 'x', 'x', 'x', 'x']), id: 'reactor' }
    const plain = { ...board(['x', 'x', 'x', 'x', 'x']), id: 'research_1' }
    const label = (id: string) => id
    const chips = bingoChipsFor('specimen_a', ['research_1', 'reactor'], [plain, gold], label)
    expect(chips.map((c) => c.label)).toEqual(['reactor', 'research_1'])
    expect(chips[0].gold).toEqual(['smelter'])
  })
})

describe('pickRecentOffers', () => {
  const obtain = [{ type: 'pvp', where: 'PVP: Сезон 1', itemId: undefined }]
  it('drops future windows, collapses duplicates, falls back to the shop label', () => {
    const list: [string, string, ([string, number][] | null)?][] = [
      ['2030-01-01', 'pvp|PVP: Сезон 1'],
      ['2026-05-01', 'pvp|PVP: Сезон 1', [['g', 5]]],
      ['2026-05-01', 'pvp|PVP: Сезон 1'],
      ['2026-04-01', 'Specimen_A_01'],
      ['2026-03-01', 'unknown-ref'],
    ]
    const out = pickRecentOffers(list, obtain, '2026-11-15', 5)
    expect(out.map((o) => [o.date, o.label])).toEqual([
      ['2026-05-01', 'PVP: Сезон 1'],
      ['2026-04-01', 'Магазин'],
    ])
    expect(out[0].price).toEqual([['g', 5]])
  })
  it('respects max', () => {
    const list = ['2026-05-03', '2026-05-02', '2026-05-01'].map(
      (d) => [d, 'pvp|PVP: Сезон 1'] as [string, string],
    )
    // same label on three dates: three distinct date|label keys
    expect(pickRecentOffers(list, obtain, '2026-11-15', 2)).toHaveLength(2)
  })
})

describe('buildAppearances states', () => {
  const data = { bingoKeys: [], boards: [], obtain: {} }
  it('distinguishes "no data" from "only low-chance boxes"', () => {
    expect(
      buildAppearances('specimen_a_01', '2026-11-15', { ...data, offerHistory: {} }).offersState,
    ).toBe('none')
    expect(
      buildAppearances('specimen_a_01', '2026-11-15', {
        ...data,
        offerHistory: { specimen_a_01: [] },
      }).offersState,
    ).toBe('onlyLowChance')
  })
})

describe('real data', () => {
  const list = mutants as { id: string }[]
  it('builds for every mutant without throwing and with sane shapes', () => {
    for (const m of list) {
      const a = appearancesFor(m.id, '2026-11-15')
      expect(a.bingo.every((c) => c.label.length > 0)).toBe(true)
      expect(a.offers.length).toBeLessThanOrEqual(3)
      expect(a.offers.every((o) => o.label.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(o.date))).toBe(
        true,
      )
      expect(appearancesSignature(a).length).toBeGreaterThan(0)
    }
  })
  it('every gold chip is backed by a board whose line really pays out', () => {
    const boards = bingos as unknown as BingoBoardData[]
    for (const m of list) {
      const a = appearancesFor(m.id, '2026-11-15')
      for (const chip of a.bingo.filter((c) => c.gold.length)) {
        const ok = boards.some((b) => goldBuildingsOnBoard(b, m.id).length > 0)
        expect(ok, `${m.id} ${chip.label}`).toBe(true)
      }
    }
  })
  it('gold boards come first in every chip list', () => {
    for (const m of list) {
      const chips = appearancesFor(m.id).bingo
      const firstPlain = chips.findIndex((c) => !c.gold.length)
      if (firstPlain >= 0) expect(chips.slice(firstPlain).every((c) => !c.gold.length)).toBe(true)
    }
  })
})
