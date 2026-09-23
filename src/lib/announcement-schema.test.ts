// Ловит именно ту болезнь, из-за которой RIBBONS/CATEGORIES жили в 4 местах
// без единой проверки (Opus 5.5 audit, 2026-09-22): добавил ленту/категорию в
// announcement-schema.ts, забыл CSS-класс или i18n-ключ - тест красный, а не
// молчаливая дыра в рендере на проде.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  RIBBONS,
  CATEGORIES,
  CATEGORY_ICON,
  dedupeForecastOffers,
  forecastSprint,
  forecastWeekOf,
} from './announcement-schema'

describe('недели прогноза (карточка и скриншот-бот считают одинаково)', () => {
  const start = Date.UTC(2026, 8, 19)
  it('граница недели - ровно 7 суток от старта спринта', () => {
    expect(forecastWeekOf('2026-09-19T00:00:00Z', start)).toBe(1)
    expect(forecastWeekOf('2026-09-25T23:59:00Z', start)).toBe(1)
    expect(forecastWeekOf('2026-09-26T00:00:00Z', start)).toBe(2)
  })
  it('оффер без даты уходит в неделю 1 - поэтому бот не должен снимать пустую неделю 2', () => {
    expect(forecastWeekOf(null, start)).toBe(1)
    expect(forecastWeekOf(undefined, start)).toBe(1)
  })
  it('номер спринта - префикс id первого оффера', () => {
    expect(forecastSprint([{ id: '257|daily_news_x' }])).toBe(257)
    expect(forecastSprint([])).toBeNull()
    expect(forecastSprint([{ id: 'junk' }])).toBeNull()
  })
  it('дубли одной картинки схлопываются в первое вхождение, офферы без картинки не трогаются', () => {
    const items = [
      { id: 'a', image: 'x.png' },
      { id: 'b', image: 'x.png' },
      { id: 'c', image: null },
      { id: 'd', image: null },
    ]
    expect(dedupeForecastOffers(items).map((o) => o.id)).toEqual(['a', 'c', 'd'])
  })
})

const ROOT = path.join(import.meta.dirname, '../..')
const CARD_SOURCE = fs.readFileSync(
  path.join(ROOT, 'src/components/announcements/AnnouncementCard.astro'),
  'utf-8',
)
const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pt', 'ru', 'tr']
const I18N = Object.fromEntries(
  LOCALES.map((loc) => [
    loc,
    JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/${loc}.json`), 'utf-8')) as Record<
      string,
      string
    >,
  ]),
)

describe('announcement-schema: ribbon согласован с CSS и всеми локалями', () => {
  for (const ribbon of RIBBONS) {
    it(`.ribbon-${ribbon} есть в AnnouncementCard.astro`, () => {
      expect(CARD_SOURCE).toContain(`.ribbon-${ribbon}`)
    })
    for (const loc of LOCALES) {
      it(`announcements.ribbon.${ribbon} переведён на ${loc}`, () => {
        expect(I18N[loc][`announcements.ribbon.${ribbon}`]).toBeTruthy()
      })
    }
  }
})

describe('announcement-schema: category согласована с CATEGORY_ICON и всеми локалями', () => {
  for (const category of CATEGORIES) {
    it(`CATEGORY_ICON["${category}"] задан`, () => {
      expect(CATEGORY_ICON[category]).toBeTruthy()
    })
    for (const loc of LOCALES) {
      it(`announcements.category.${category} переведена на ${loc}`, () => {
        expect(I18N[loc][`announcements.category.${category}`]).toBeTruthy()
      })
    }
  }
})
