import { describe, it, expect } from 'vitest'
import { parseMessage } from './bot-parser'

function ok(text: string) {
  const r = parseMessage(text)
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`)
  return r
}

function err(text: string) {
  const r = parseMessage(text)
  if (r.ok) throw new Error(`expected error, got: ${JSON.stringify(r.primary)}`)
  return r.error
}

describe('mutant name matching', () => {
  it('matches an exact name', () => {
    expect(ok('робот 20ур').primary.mutantName).toBe('Робот')
  })

  it('rejects unknown names', () => {
    expect(err('асдфгхйкл 20ур')).toMatch(/не нашёл мутанта/)
  })

  it('resolves a curated nickname alias before fuzzy fallback', () => {
    expect(ok('борода 20ур').primary.mutantName).toBe('Капитан Черная Борода')
  })

  it('fuzzy-matches a close typo of a real name', () => {
    expect(ok('азимв 20ур').primary.mutantName).toBe('Азимов')
  })

  it('flags fuzzy ties between two similarly-close names as ambiguous, not a guess', () => {
    expect(err('роб 10ур')).toMatch(/не понял, какого мутанта/)
  })

  it('flags an equal-length exact-name collision as ambiguous, not array-order luck', () => {
    // "Тор" and "Гор" are both real, both exactly 3 letters - a message
    // containing both as substrings must not silently pick whichever
    // happens to come first in mutants.json.
    expect(err('тор гор 10ур')).toMatch(/не понял, какого мутанта/)
  })
})

describe('level', () => {
  it('defaults to 30 when omitted', () => {
    expect(ok('азимов').primary.level).toBe(30)
  })

  it('parses an explicit level', () => {
    expect(ok('робот 45ур').primary.level).toBe(45)
  })

  it('accepts levels beyond the old 3-digit cap', () => {
    expect(ok('робот 1488ур').primary.level).toBe(1488)
  })

  it('clamps a troll-level input to the HP-overflow ceiling, same as the live calculator', () => {
    const level = ok('риф 999999ур').primary.level
    expect(level).toBeLessThan(999999)
    expect(level).toBeGreaterThan(1000)
  })
})

describe('star tier', () => {
  it('defaults to the mutant\'s highest available tier when unspecified', () => {
    expect(ok('робот 20ур').primary.starIndex).toBe(4)
  })

  it('respects an explicit star keyword', () => {
    expect(ok('робот 20ур серебро').primary.starIndex).toBe(2)
  })

  it('falls back to the only tier a single-tier mutant actually has', () => {
    // Риф only exists at platinum - the default must not silently claim
    // "normal" for a tier that was never real for this mutant.
    expect(ok('риф 20ур').primary.starIndex).toBe(4)
  })
})

describe('orb mentions', () => {
  it('matches a basic orb by percent', () => {
    const cfg = ok('робот 20ур щит 22%').primary
    expect(cfg.basicOrbIds).toContain('orb_basic_shield_04')
  })

  it('matches an orb by sphere level, not percent, when no "%" is given', () => {
    const cfg = ok('зверь 20ур спец скорость 5').primary
    expect(cfg.specialOrbId).toBe('orb_special_speed_05')
  })

  it('routes to the special slot only when "спец" is present', () => {
    const cfg = ok('робот 20ур спец щит 20%').primary
    expect(cfg.specialOrbId).toBe('orb_special_addshield_03')
    expect(cfg.basicOrbIds.every((id) => id === null)).toBe(true)
  })

  it('recognizes a colloquial category abbreviation', () => {
    const cfg = ok('робот 20ур критшанс 15%').primary
    expect(cfg.basicOrbIds).toContain('orb_basic_critical_04')
  })
})

describe('damage multipliers', () => {
  it('parses a multiplier tagged to the first attack', () => {
    expect(ok('робот 20ур +25% на первую атаку').primary.atkMultipliers[1]).toBe(25)
  })

  it('parses a multiplier tagged to the second attack', () => {
    expect(ok('андроид 20ур -50% вторая атака').primary.atkMultipliers[2]).toBe(-50)
  })

  it('silently drops a multiplier on a neutro-gene attack - the live page never offers one there', () => {
    // Робот's second attack is neutro-gene.
    expect(ok('робот 20ур -50% вторая атака').primary.atkMultipliers[2]).toBe(0)
  })

  it('ignores an out-of-range multiplier value instead of erroring', () => {
    expect(ok('робот 20ур +30% на первую атаку').primary.atkMultipliers[1]).toBe(0)
  })
})

describe('compare mode', () => {
  it('splits on "vs" into primary/secondary', () => {
    const r = ok('робот 20ур vs зомби 30ур')
    expect(r.primary.mutantName).toBe('Робот')
    expect(r.secondary?.mutantName).toBe('Зомби')
  })

  it('splits on "против" too', () => {
    const r = ok('робот 20ур против зомби 30ур')
    expect(r.secondary?.mutantName).toBe('Зомби')
  })

  it('rejects more than one separator', () => {
    expect(err('робот 20ур vs зомби 30ур vs воин 10ур')).toMatch(/больше одного разделителя/)
  })
})

describe('input edge cases', () => {
  it('rejects an empty message', () => {
    expect(err('')).toMatch(/пустое сообщение/)
  })
})
