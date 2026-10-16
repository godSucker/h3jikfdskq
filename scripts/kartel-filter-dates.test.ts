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

import { isYearTaggedEventFilter, pickManualFilterDate } from './kartel-filter-dates'

describe('isYearTaggedEventFilter', () => {
  it('ловит событийные имена с тегом года', () => {
    expect(isYearTaggedEventFilter('filter_dungeon_halloween26', 26)).toBe(true)
    expect(isYearTaggedEventFilter('Shop_bank_halloween26_mutants', 26)).toBe(true)
    expect(isYearTaggedEventFilter('Shop_Mystery_Halloween26', 26)).toBe(true)
    expect(isYearTaggedEventFilter('filter_missions_anniversary26_2', 26)).toBe(true)
  })

  it('не ловит чужой год, обычные имена и номера с числом 26', () => {
    expect(isYearTaggedEventFilter('filter_dungeon_halloween25', 26)).toBe(false)
    expect(isYearTaggedEventFilter('PayWall_Bank_Halloween', 26)).toBe(false)
    expect(isYearTaggedEventFilter('Daily_news_tech_V2', 26)).toBe(false)
    expect(isYearTaggedEventFilter('Daily_news_shop_24h_2026_260a', 26)).toBe(false)
    expect(isYearTaggedEventFilter('Shop_bundle_orbs_attack_5_26', 26)).toBe(false)
  })
})

describe('pickManualFilterDate', () => {
  const dates = { shop_x: { start: '2026-10-22T10:00:00+00:00', approx: true } }

  it('ищет без учёта регистра', () => {
    expect(pickManualFilterDate(dates, 'Shop_X')?.approx).toBe(true)
  })

  it('пусто для неизвестного и пустого имени', () => {
    expect(pickManualFilterDate(dates, 'Shop_Y')).toBeNull()
    expect(pickManualFilterDate(dates, null)).toBeNull()
  })
})
