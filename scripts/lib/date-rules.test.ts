import { describe, expect, it } from 'vitest'
import { snapToNearestWeekday, weekendWindow, WEEKEND_FILTER_RE } from './date-rules'

const iso = (ms: number) => new Date(ms).toISOString()

describe('snapToNearestWeekday', () => {
  it('Thursday 15 Oct -> Friday 16 Oct 10:00 UTC (the Madness case)', () => {
    expect(iso(snapToNearestWeekday(Date.UTC(2026, 9, 15, 10), 5, 10))).toBe(
      '2026-10-16T10:00:00.000Z',
    )
  })

  it('a Friday stays on that Friday, whatever the hour', () => {
    expect(iso(snapToNearestWeekday(Date.UTC(2026, 9, 16, 0), 5, 10))).toBe(
      '2026-10-16T10:00:00.000Z',
    )
    expect(iso(snapToNearestWeekday(Date.UTC(2026, 9, 16, 23), 5, 10))).toBe(
      '2026-10-16T10:00:00.000Z',
    )
  })

  it('picks the nearest Friday, backwards when it is closer', () => {
    // Sunday 18 Oct is 2 days after Fri 16 and 5 before Fri 23
    expect(iso(snapToNearestWeekday(Date.UTC(2026, 9, 18, 10), 5, 10))).toBe(
      '2026-10-16T10:00:00.000Z',
    )
    // Monday 19 Oct 10:00 -> Fri 16 (3 days) vs Fri 23 (4 days)
    expect(iso(snapToNearestWeekday(Date.UTC(2026, 9, 19, 10), 5, 10))).toBe(
      '2026-10-16T10:00:00.000Z',
    )
  })

  it('works across a month boundary', () => {
    expect(iso(snapToNearestWeekday(Date.UTC(2026, 9, 30, 10), 5, 10))).toBe(
      '2026-10-30T10:00:00.000Z',
    )
    expect(iso(snapToNearestWeekday(Date.UTC(2026, 10, 1, 10), 5, 10))).toBe(
      '2026-10-30T10:00:00.000Z',
    )
  })
})

describe('weekendWindow', () => {
  it('is Friday 10:00 UTC to Monday 10:00 UTC', () => {
    const w = weekendWindow(Date.UTC(2026, 9, 15, 10))
    expect(iso(w.startMs)).toBe('2026-10-16T10:00:00.000Z')
    expect(iso(w.endMs)).toBe('2026-10-19T10:00:00.000Z')
  })

  it('matches both known windows (11.09 and 16.10)', () => {
    expect(iso(weekendWindow(Date.UTC(2026, 8, 10, 10)).startMs)).toBe('2026-09-11T10:00:00.000Z')
  })
})

describe('WEEKEND_FILTER_RE', () => {
  it('matches the madness weekend filters only', () => {
    expect(WEEKEND_FILTER_RE.test('daily_news_jackpot_madness_weekend_25jt')).toBe(true)
    expect(WEEKEND_FILTER_RE.test('Daily_news_tech_V2')).toBe(false)
  })
})
