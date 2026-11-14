import { describe, expect, it } from 'vitest'
import data from '../../src/data/evo-big-discounts.json'

describe('evo-big-discounts.json', () => {
  it('events are dated, ascending, at least 80% and point at a post', () => {
    const dates = data.events.map((e) => e.date)
    expect(dates).toEqual([...dates].sort())
    for (const e of data.events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(e.percent).toBeGreaterThanOrEqual(80)
      expect(e.post).toBeGreaterThan(0)
      expect(['birthday', 'newyear', 'other']).toContain(e.kind)
    }
  })
  it('every event of a known kind falls inside that kind window', () => {
    for (const w of data.windows) {
      const [fm, fd] = w.from.split('-').map(Number)
      const [tm, td] = w.to.split('-').map(Number)
      const key = (m: number, d: number) => m * 100 + d
      for (const e of data.events.filter((x) => x.kind === w.kind)) {
        const k = key(Number(e.date.slice(5, 7)), Number(e.date.slice(8, 10)))
        const inside =
          key(fm, fd) <= key(tm, td)
            ? k >= key(fm, fd) && k <= key(tm, td)
            : k >= key(fm, fd) || k <= key(tm, td) // окно через Новый год
        expect(inside, `${e.date} outside ${w.kind} window`).toBe(true)
      }
    }
  })
})
