import { describe, expect, it } from 'vitest'
import { dropOutliers, isWedgedRerun } from './detect-shop-forecast'

const DAY = 24 * 60 * 60 * 1000
const d = (iso: string) => new Date(iso).getTime()

// Лестница: позиция p -> 4 окт + (13 - p) дней, то есть база (дата + позиция) постоянна.
const ladderPoint = (p: number) => ({
  position: p,
  dayMs: d('2026-10-04T10:00:00Z') + (13 - p) * DAY,
})

describe('dropOutliers', () => {
  const clean = [10, 11, 12, 13, 14, 15, 16].map(ladderPoint)

  it('точка на лестнице - не выброс', () => {
    const r = dropOutliers(clean)
    expect(r.outlierPositions.size).toBe(0)
  })

  it('повторное включение на позиции 63 с живой датой 5 окт - выброс с большим сдвигом', () => {
    const rerun = { position: 63, dayMs: d('2026-10-05T10:00:00Z') }
    const nearby = [60, 61, 62, 64, 65, 66].map(ladderPoint)
    const r = dropOutliers([...clean, ...nearby, rerun])
    expect(r.outlierPositions.has(63)).toBe(true)
    expect(r.outlierShiftMs.get(63)!).toBeGreaterThan(7 * DAY)
  })

  it('сдвиг на 2 дня (случай Specimen_BB_08) - выброс, но с малым сдвигом', () => {
    const shifted = { position: 13, dayMs: d('2026-10-04T10:00:00Z') + 2 * DAY }
    const r = dropOutliers([...clean.filter((p) => p.position !== 13), shifted])
    expect(r.outlierPositions.has(13)).toBe(true)
    expect(r.outlierShiftMs.get(13)!).toBeLessThan(7 * DAY)
  })
})

describe('isWedgedRerun', () => {
  const winStart = d('2026-10-03T00:00:00Z')
  const winEnd = d('2026-10-17T00:00:00Z')

  it('большой сдвиг и живая дата внутри окна спринта - настоящее повторное включение', () => {
    expect(isWedgedRerun(d('2026-10-05T10:00:00Z'), 50 * DAY, winStart, winEnd)).toBe(true)
  })

  it('малый сдвиг (1-3 дня, эхо Filter-тега) - не повторное включение', () => {
    expect(isWedgedRerun(d('2026-10-05T10:00:00Z'), 2 * DAY, winStart, winEnd)).toBe(false)
  })

  it('большой сдвиг, но дата вне окна спринта - эхо прошлого включения, не доверяем', () => {
    expect(isWedgedRerun(d('2026-08-15T10:00:00Z'), 50 * DAY, winStart, winEnd)).toBe(false)
  })

  it('не выброс (нет сдвига) или битая дата - false', () => {
    expect(isWedgedRerun(d('2026-10-05T10:00:00Z'), undefined, winStart, winEnd)).toBe(false)
    expect(isWedgedRerun(NaN, 50 * DAY, winStart, winEnd)).toBe(false)
  })
})
