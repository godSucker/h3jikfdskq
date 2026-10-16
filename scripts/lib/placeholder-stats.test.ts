import { describe, expect, it } from 'vitest'
import {
  isPlaceholderStats,
  isProvisionalOrPlaceholder,
  keepProvisionalLocale,
  keepProvisionalStats,
} from './placeholder-stats'

const placeholder = {
  hp_base: 1130,
  atk1_base: 312,
  atk1p_base: 468,
  atk2_base: 312,
  atk2p_base: 468,
  speed_base: 5,
}

describe('isPlaceholderStats', () => {
  it('detects the template Kobojo ships before real stats exist', () => {
    expect(isPlaceholderStats({ base_stats: placeholder })).toBe(true)
  })

  it('does not match real stats that share one value (ff_14 has hp 1130)', () => {
    const ff14 = {
      ...placeholder,
      atk1_base: 814,
      atk1p_base: 3017,
      atk2_base: 1331,
      atk2p_base: 2024,
      speed_base: 3.64,
    }
    expect(isPlaceholderStats({ base_stats: ff14 })).toBe(false)
  })

  it('does not match when a single field differs', () => {
    expect(isPlaceholderStats({ base_stats: { ...placeholder, speed_base: 4.55 } })).toBe(false)
  })

  it('is false for missing entries and entries without base_stats', () => {
    expect(isPlaceholderStats(undefined)).toBe(false)
    expect(isPlaceholderStats(null)).toBe(false)
    expect(isPlaceholderStats({})).toBe(false)
    expect(isPlaceholderStats({ base_stats: null })).toBe(false)
  })
})

describe('keepProvisionalStats', () => {
  const manual = { ...placeholder, hp_base: 854, speed_base: 11.76, atk1_base: 436 }
  const make = (base: object, extra: object = {}) => ({
    base_stats: base,
    abilities: [{ name: 'x', pct: base === manual ? 15 : 25 }],
    name: 'n',
    ...extra,
  })

  it('keeps hand-entered stats when XML still ships the placeholder', () => {
    const existing = make(manual, { provisionalStats: true })
    const incoming = make(placeholder, { name: 'localized' })
    expect(keepProvisionalStats(existing, incoming)).toBe(true)
    expect(incoming.base_stats).toBe(existing.base_stats)
    expect(incoming.abilities).toBe(existing.abilities)
    expect((incoming as any).provisionalStats).toBe(true)
    expect(incoming.name).toBe('localized')
  })

  it('lets official stats replace the provisional ones and drops the flag', () => {
    const existing = make(manual, { provisionalStats: true })
    const official = { ...placeholder, hp_base: 860, speed_base: 11.76 }
    const incoming = make(official)
    expect(keepProvisionalStats(existing, incoming)).toBe(false)
    expect(incoming.base_stats).toBe(official)
    expect((incoming as any).provisionalStats).toBeUndefined()
  })

  it('does nothing for entries not marked provisional', () => {
    const existing = make(manual)
    const incoming = make(placeholder)
    expect(keepProvisionalStats(existing, incoming)).toBe(false)
    expect(incoming.base_stats).toBe(placeholder)
  })
})

describe('isProvisionalOrPlaceholder', () => {
  it('is true for the flag or the template, false for plain real stats', () => {
    expect(isProvisionalOrPlaceholder({ provisionalStats: true, base_stats: { hp_base: 1 } })).toBe(
      true,
    )
    expect(isProvisionalOrPlaceholder({ base_stats: placeholder })).toBe(true)
    expect(isProvisionalOrPlaceholder({ base_stats: { ...placeholder, hp_base: 854 } })).toBe(false)
    expect(isProvisionalOrPlaceholder(undefined)).toBe(false)
  })
})

describe('keepProvisionalLocale', () => {
  const manual = {
    provisionalLocale: true,
    name: 'Формула смерти',
    name_attack1: 'Смертельный дрифт',
    name_attack2: 'Втягивание душ',
  }

  it('keeps the manual Russian text while the incoming text is an untranslated fallback', () => {
    const incoming: any = {
      name: 'Ölüm Formülü',
      name_attack1: 'Ölümcül Drift',
      name_attack2: 'Ruh Arayışı',
    }
    expect(keepProvisionalLocale(manual, incoming)).toBe(true)
    expect(incoming).toMatchObject({
      name: 'Формула смерти',
      name_attack1: 'Смертельный дрифт',
      name_attack2: 'Втягивание душ',
      provisionalLocale: true,
    })
  })

  it('takes official Russian text and drops the flag once every field is translated', () => {
    const incoming: any = {
      name: 'Формула Смерти',
      name_attack1: 'Роковой дрифт',
      name_attack2: 'Охота за душами',
    }
    expect(keepProvisionalLocale(manual, incoming)).toBe(false)
    expect(incoming.name).toBe('Формула Смерти')
    expect(incoming.provisionalLocale).toBeUndefined()
  })

  it('mixes per field: official name arrives first, attacks stay manual and flagged', () => {
    const incoming: any = {
      name: 'Формула Смерти',
      name_attack1: 'Ölümcül Drift',
      name_attack2: 'Ruh Arayışı',
    }
    expect(keepProvisionalLocale(manual, incoming)).toBe(true)
    expect(incoming.name).toBe('Формула Смерти')
    expect(incoming.name_attack1).toBe('Смертельный дрифт')
    expect(incoming.provisionalLocale).toBe(true)
  })

  it('does nothing for entries not marked provisionalLocale', () => {
    const incoming: any = { name: 'Ölüm Formülü', name_attack1: 'x', name_attack2: 'y' }
    expect(keepProvisionalLocale({ ...manual, provisionalLocale: undefined }, incoming)).toBe(false)
    expect(incoming.name).toBe('Ölüm Formülü')
  })

  it('never overwrites with an empty or non-Cyrillic manual value', () => {
    const incoming: any = { name: 'Ölüm Formülü', name_attack1: '', name_attack2: '' }
    const weak = {
      provisionalLocale: true,
      name: 'Formula Death',
      name_attack1: '',
      name_attack2: '',
    }
    expect(keepProvisionalLocale(weak, incoming)).toBe(false)
    expect(incoming.name).toBe('Ölüm Formülü')
  })
})
