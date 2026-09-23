import { describe, expect, it } from 'vitest'
import { mergeLiveFields } from './build-announcements'
import type { AnnouncementItem } from '../src/lib/announcement-schema'

// Синтетические фикстуры, без сети/Telegram - проверяют ровно 2 бага,
// найденные при аудите Opus 5.5 (2026-09-22) и починенные в build-announcements.ts.
function item(overrides: Partial<AnnouncementItem>): AnnouncementItem {
  return { id: 'x', name: 'X', ...overrides }
}

describe('mergeLiveFields', () => {
  it('живые даты есть - доверяем fresh целиком (поведение не менялось)', () => {
    const old = item({ exactDateLabel: '1 сентября', discountPercent: 30 })
    const fresh = item({ exactDateLabel: '2 сентября', exactDateStart: '2026-09-02' })
    expect(mergeLiveFields(old, fresh, false, false)).toEqual(fresh)
  })

  it('liveDataMissing: восстанавливает ВСЮ группу exactDate*-полей, не только 3 из 6 (баг B)', () => {
    const old = item({
      exactDateLabel: '1 сентября - ?',
      exactDateStart: '2026-09-01',
      exactDateEnd: null,
      exactDateApprox: false,
      exactDateOpenEnd: true,
      featuredMutant: 'week',
    })
    const fresh = item({ exactDateLabel: null, featuredMutant: null })
    const merged = mergeLiveFields(old, fresh, true, false)
    expect(merged.exactDateLabel).toBe('1 сентября - ?')
    expect(merged.exactDateStart).toBe('2026-09-01')
    expect(merged.exactDateEnd).toBeNull()
    expect(merged.exactDateApprox).toBe(false)
    expect(merged.exactDateOpenEnd).toBe(true)
    expect(merged.featuredMutant).toBe('week')
  })

  it('liveDataMissing закрывает открытое окно, если kartel наконец отдал конец (не восстанавливает старое openEnd вслепую)', () => {
    // Это не должно случиться на практике (liveDataMissing=true означает
    // fresh.exactDateLabel=null для ВСЕХ офферов), но фиксируем инвариант:
    // guard срабатывает только когда fresh реально пуст.
    const old = item({ exactDateLabel: '1 сентября - ?', exactDateOpenEnd: true })
    const fresh = item({ exactDateLabel: '1 сентября - 10 сентября', exactDateOpenEnd: false })
    expect(mergeLiveFields(old, fresh, true, false)).toEqual(fresh)
  })

  it('promoDataMissing: сохраняет discountPercent независимо от liveDataMissing (баг C)', () => {
    const old = item({ discountPercent: 60 })
    const fresh = item({ discountPercent: null })
    expect(mergeLiveFields(old, fresh, false, true).discountPercent).toBe(60)
  })

  it('promoDataMissing не восстанавливает discountPercent, если fresh реально принёс новое значение', () => {
    const old = item({ discountPercent: 60 })
    const fresh = item({ discountPercent: 40 })
    expect(mergeLiveFields(old, fresh, false, true).discountPercent).toBe(40)
  })

  it('оба флага одновременно чинят оба поля независимо', () => {
    const old = item({ exactDateLabel: '1 сентября', discountPercent: 60 })
    const fresh = item({ exactDateLabel: null, discountPercent: null })
    const merged = mergeLiveFields(old, fresh, true, true)
    expect(merged.exactDateLabel).toBe('1 сентября')
    expect(merged.discountPercent).toBe(60)
  })

  it('liveDataMissing: приблизительная свежая дата не затирает известную точную (и мутанта недели)', () => {
    const old = item({
      exactDateLabel: '2 — 3 октября',
      exactDateStart: '2026-10-02T10:00:00+00:00',
      exactDateEnd: '2026-10-03T10:00:00+00:00',
      exactDateApprox: false,
      featuredMutant: 'week',
    })
    const fresh = item({
      exactDateLabel: '≈ 2 октября',
      exactDateStart: '2026-10-02T10:00:00.000Z',
      exactDateEnd: null,
      exactDateApprox: true,
      featuredMutant: null,
    })
    const merged = mergeLiveFields(old, fresh, true, false)
    expect(merged.exactDateLabel).toBe('2 — 3 октября')
    expect(merged.exactDateEnd).toBe('2026-10-03T10:00:00+00:00')
    expect(merged.exactDateApprox).toBe(false)
    expect(merged.featuredMutant).toBe('week')
  })

  it('liveDataMissing: старая приблизительная дата сохраняется, если свежей нет вовсе', () => {
    const old = item({ exactDateLabel: '≈ 5 октября', exactDateApprox: true })
    const fresh = item({ exactDateLabel: null })
    expect(mergeLiveFields(old, fresh, true, false).exactDateLabel).toBe('≈ 5 октября')
  })

  it('liveDataMissing: свежая приблизительная побеждает старую приблизительную (обе догадки)', () => {
    const old = item({ exactDateLabel: '≈ 5 октября', exactDateApprox: true })
    const fresh = item({ exactDateLabel: '≈ 6 октября', exactDateApprox: true })
    expect(mergeLiveFields(old, fresh, true, false).exactDateLabel).toBe('≈ 6 октября')
  })

  it('живые данные полные: приблизительная свежая дата побеждает (доверяем fresh, как раньше)', () => {
    const old = item({ exactDateLabel: '2 — 3 октября', exactDateApprox: false })
    const fresh = item({ exactDateLabel: '≈ 2 октября', exactDateApprox: true })
    expect(mergeLiveFields(old, fresh, false, false)).toEqual(fresh)
  })

  it('нет old (новый item внутри уже опубликованного спринта) - просто fresh, без падения', () => {
    const fresh = item({ exactDateLabel: null, discountPercent: null })
    expect(mergeLiveFields(undefined, fresh, true, true)).toEqual(fresh)
  })
})
