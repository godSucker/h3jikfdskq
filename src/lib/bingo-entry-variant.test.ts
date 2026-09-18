import { describe, expect, it } from 'vitest'
import bingos from '@/data/bingos.json'
import { bingoEntryVariant, STAR_TIERS } from './bingo-entry-variant'

interface Board {
  id: string
  mutants: { specimenId: string; skin: string }[]
}
const boards = bingos as Board[]

describe('bingoEntryVariant', () => {
  it('"_any" и пустое значение не навязывают ни скин, ни звезду', () => {
    expect(bingoEntryVariant('_any')).toEqual({ star: null, skin: null })
    expect(bingoEntryVariant('')).toEqual({ star: null, skin: null })
    expect(bingoEntryVariant(undefined)).toEqual({ star: null, skin: null })
  })

  it('звёздность распознаётся как звезда, остальное - как скин', () => {
    for (const tier of STAR_TIERS) expect(bingoEntryVariant(tier)).toEqual({ star: tier, skin: null })
    expect(bingoEntryVariant('halloween')).toEqual({ star: null, skin: 'halloween' })
    expect(bingoEntryVariant('GachaBoss')).toEqual({ star: null, skin: 'gachaboss' })
  })
})

describe('звёздность досок берётся из данных, а не из id', () => {
  // Регрессия на баг 2026-09-18 (нашёл Иван Веприк): звезда подбиралась по
  // подстроке в id доски, из-за чего "Исследование 1-4" красились в бронзу/
  // серебро/золото/платину, "Исследование 10/11" ловились подстрокой research_1,
  // а "Амазонки" (в данных silver) оставались без звезды.
  const starsOf = (board: Board) =>
    new Set(board.mutants.map((m) => bingoEntryVariant(m.skin).star).filter(Boolean))

  it('доски "Исследование" не требуют звёздности (в morphology_season_*.xml везде skin="_any")', () => {
    const research = boards.filter((b) => b.id.startsWith('research_'))
    expect(research.length).toBeGreaterThan(10)
    for (const board of research) expect([...starsOf(board)]).toEqual([])
  })

  it('доска реактора не требует звёздности - только скины', () => {
    const reactor = boards.find((b) => b.id === 'reactor')!
    expect([...starsOf(reactor)]).toEqual([])
    expect(reactor.mutants.some((m) => bingoEntryVariant(m.skin).skin)).toBe(true)
  })

  it('звёздные доски отдают свою звезду, включая те, у которых её нет в id', () => {
    const expected: Record<string, string> = {
      bingo_bronze: 'bronze',
      bingo_silver: 'silver',
      bingo_gold: 'gold',
      bingo_plat: 'platinum',
      starter_plat: 'platinum',
      zodiac_silver: 'silver',
      // id не содержит "silver", раньше звезда терялась
      amazons: 'silver',
    }
    for (const [id, star] of Object.entries(expected)) {
      const board = boards.find((b) => b.id === id)
      expect(board, `доска ${id} есть в bingos.json`).toBeTruthy()
      expect([...starsOf(board!)], `звезда доски ${id}`).toEqual([star])
    }
  })
})
