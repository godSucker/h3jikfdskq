import { describe, expect, it } from 'vitest'
import { exactDateLabelIn } from './announcements-render'

const base = {
  exactDateLabel: '≈ 9 — 11 ноября',
  exactDateStart: '2026-11-10T10:00:00+00:00',
  exactDateApprox: true,
}

describe('exactDateLabelIn with exactDateUncertainDays', () => {
  it('keeps the stored Russian label for ru', () => {
    expect(exactDateLabelIn({ ...base, exactDateUncertainDays: 1 }, 'ru')).toBe('≈ 9 — 11 ноября')
  })

  it('renders a +-N day range in other locales', () => {
    const en = exactDateLabelIn({ ...base, exactDateUncertainDays: 1 }, 'en')
    expect(en).toMatch(/^≈ /)
    expect(en).toMatch(/9/)
    expect(en).toMatch(/11/)
  })

  it('without the field an approximate date stays a single day', () => {
    const en = exactDateLabelIn({ ...base }, 'en')
    expect(en).toMatch(/10/)
    expect(en).not.toMatch(/9.*11/)
  })

  it('exact windows ignore the field', () => {
    const exact = {
      exactDateLabel: '22 — 24 сентября',
      exactDateStart: '2026-09-22T10:00:00+00:00',
      exactDateEnd: '2026-09-24T10:00:00+00:00',
      exactDateApprox: false,
      exactDateUncertainDays: 1,
    }
    expect(exactDateLabelIn(exact, 'en')).not.toMatch(/^≈/)
  })
})
