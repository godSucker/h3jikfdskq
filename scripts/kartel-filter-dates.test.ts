import { describe, expect, it } from 'vitest'
import { classifySnapshot } from './kartel-filter-dates'

const someDates = { Shop_Specimen_A: { start: '2026-09-20T00:00:00.000Z', end: null } }

describe('classifySnapshot', () => {
  it('нет фильтров - missing, даже если meta чистая', () => {
    expect(classifySnapshot({}, { requestedCount: 4450, failedSources: [] })).toBe('missing')
    expect(classifySnapshot({}, null)).toBe('missing')
  })

  it('упал хоть один источник имён - partial, хотя фильтры в ответе есть (баг A аудита)', () => {
    expect(classifySnapshot(someDates, { requestedCount: 4384, failedSources: ['dungeons'] })).toBe(
      'partial',
    )
  })

  it('имён не запрошено вовсе - partial: это авто-набор сервера, а не ответ на наш запрос', () => {
    expect(classifySnapshot(someDates, { requestedCount: 0, failedSources: [] })).toBe('partial')
  })

  it('все источники живы - full', () => {
    expect(classifySnapshot(someDates, { requestedCount: 4450, failedSources: [] })).toBe('full')
  })

  it('старый формат без meta - как раньше, по непустоте', () => {
    expect(classifySnapshot(someDates, null)).toBe('full')
  })
})
