import { describe, expect, it } from 'vitest'
import { resolveFilterDate } from './date-resolver'

const DAY = 86_400_000
const now = Date.parse('2026-09-23T12:00:00Z')
const r = (start: string, end: string | null = null) => ({ start, end })

describe('resolveFilterDate: выбирает окно под ожидание потребителя', () => {
  // Спринт 257: 19 сент - 2 окт, окно проверки +-3 дня.
  const sprint = {
    kind: 'sprint' as const,
    startMs: Date.parse('2026-09-16T10:00:00Z'),
    endMs: Date.parse('2026-10-06T10:00:00Z'),
  }

  it('переиспользованное имя: берёт окно внутри нужного спринта, а не "ближайшее к сейчас" из прошлого', () => {
    // Модель кейса LuckyBox_Research_IX: у имени два окна - давнее прошлое
    // (его и выбрал pick_current, в filters) и окно внутри целевого спринта.
    const snap = {
      filters: { LuckyBox_Research_IX: r('2026-08-05T10:00:00Z', '2026-08-06T10:00:00Z') },
      occurrences: {
        LuckyBox_Research_IX: [
          r('2026-08-05T10:00:00Z', '2026-08-06T10:00:00Z'),
          r('2026-09-25T10:00:00Z', '2026-09-27T10:00:00Z'),
        ],
      },
    }
    expect(resolveFilterDate(snap, 'LuckyBox_Research_IX', sprint, now)?.start).toBe(
      '2026-09-25T10:00:00Z',
    )
  })

  it('ни одно окно не в спринте - null (как старая отбраковка)', () => {
    const snap = { filters: { X: r('2026-08-05T10:00:00Z') }, occurrences: {} }
    expect(resolveFilterDate(snap, 'X', sprint, now)).toBeNull()
  })

  it('одно окно без occurrences - работает как раньше', () => {
    const snap = {
      filters: { X: r('2026-09-24T10:00:00Z', '2026-09-26T10:00:00Z') },
      occurrences: {},
    }
    expect(resolveFilterDate(snap, 'X', sprint, now)).toEqual(
      r('2026-09-24T10:00:00Z', '2026-09-26T10:00:00Z'),
    )
  })

  it('несколько подходящих - приоритет pick_current: активное сейчас важнее ближайшего', () => {
    const snap = {
      filters: {},
      occurrences: {
        X: [
          r('2026-09-24T10:00:00Z', '2026-09-26T10:00:00Z'),
          r('2026-09-22T10:00:00Z', '2026-09-25T10:00:00Z'),
        ],
      },
    }
    expect(resolveFilterDate(snap, 'X', sprint, now)?.start).toBe('2026-09-22T10:00:00Z')
  })

  it('fresh: протухшее (старт >30 дней назад) и давно закончившееся (>3 дней) отбраковываются', () => {
    const fresh = { kind: 'fresh' as const, nowMs: now }
    const stale = { filters: { X: r(new Date(now - 31 * DAY).toISOString()) }, occurrences: {} }
    expect(resolveFilterDate(stale, 'X', fresh, now)).toBeNull()
    const ended = {
      filters: {
        X: r(new Date(now - 20 * DAY).toISOString(), new Date(now - 4 * DAY).toISOString()),
      },
      occurrences: {},
    }
    expect(resolveFilterDate(ended, 'X', fresh, now)).toBeNull()
    const ok = {
      filters: {},
      occurrences: {
        X: [
          r(new Date(now - 40 * DAY).toISOString()),
          r(new Date(now + 5 * DAY).toISOString(), new Date(now + 9 * DAY).toISOString()),
        ],
      },
    }
    expect(resolveFilterDate(ok, 'X', fresh, now)?.start).toBe(
      new Date(now + 5 * DAY).toISOString(),
    )
  })

  it('нет имени / нет данных - null', () => {
    const snap = { filters: {}, occurrences: {} }
    expect(resolveFilterDate(snap, undefined, sprint, now)).toBeNull()
    expect(resolveFilterDate(snap, 'nope', sprint, now)).toBeNull()
  })
})
