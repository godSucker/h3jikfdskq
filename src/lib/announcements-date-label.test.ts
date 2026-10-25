import { describe, expect, it } from 'vitest'
import { exactDateLabelIn } from './announcements-render'

const base = {
  exactDateLabel: '≈ 22 октября — 5 ноября',
  exactDateStart: '2026-10-22T10:00:00+00:00',
  exactDateEnd: '2026-11-05T10:00:00+00:00',
  exactDateApprox: true,
}

describe('exactDateLabelIn: manual placeholder with an event window', () => {
  it('Russian keeps the stored label', () => {
    expect(exactDateLabelIn({ ...base, exactDateSource: 'manual' }, 'ru')).toBe(base.exactDateLabel)
  })

  it('other locales show the whole event window, not just the start', () => {
    const en = exactDateLabelIn({ ...base, exactDateSource: 'manual' }, 'en')!
    expect(en.startsWith('≈ ')).toBe(true)
    expect(en).toMatch(/22/)
    expect(en).toMatch(/5/)
    expect(en).not.toBe(
      exactDateLabelIn({ ...base, exactDateEnd: null, exactDateSource: 'manual' }, 'en'),
    )
  })

  it('a placeholder without an end is still just "≈ start"', () => {
    const en = exactDateLabelIn({ ...base, exactDateEnd: null, exactDateSource: 'manual' }, 'en')!
    expect(en.startsWith('≈ ')).toBe(true)
    expect(en).not.toContain('—')
  })

  it('other approximate sources are unchanged (the end is not shown)', () => {
    const inherit = exactDateLabelIn({ ...base, exactDateSource: 'inherit' }, 'en')!
    expect(inherit).toBe(
      exactDateLabelIn({ ...base, exactDateEnd: null, exactDateSource: 'inherit' }, 'en'),
    )
  })
})
