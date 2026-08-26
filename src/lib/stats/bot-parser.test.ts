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

function okOverlay(text: string, overlay: { alias: string; mutantId: string }[]) {
  const r = parseMessage(text, overlay)
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`)
  return r
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

  it('an overlay alias wins a length tie against a static curated alias for the same text', () => {
    // nickname-aliases.json already maps "оса" -> "Бензиновая оса" (static,
    // curated at build time). Live-caught bug: adding ".добавить" for
    // "Апиархия" - "оса" via the Redis overlay tied at the same match
    // length as that static entry and the pair reported ambiguous instead
    // of the overlay winning - even though the overlay exists specifically
    // to override a stale static nickname without a deploy.
    const overlay = [{ alias: 'оса', mutantId: 'specimen_d_14' }]
    expect(okOverlay('оса 20ур', overlay).primary.mutantName).toBe('Апиархия')
  })

  it('does not let a short alias steal a match by landing mid-word in an unrelated name', () => {
    // Live-caught bug: nickname-aliases.json maps "ирия"/"фигуристка" ->
    // "Фигуристка Ирия", and an admin also added the overlay alias "ира" for
    // the same mutant. Since normalizeSearch used to strip spaces entirely,
    // "ира" matched as a bare substring inside "жираф" (жИРАф) - stealing
    // the giraffe's own ".добавить"-ed alias before the boundary fix below.
    const overlay = [
      { alias: 'ира', mutantId: 'specimen_cf_14' },
      { alias: 'жираф', mutantId: 'specimen_da_15' },
    ]
    expect(okOverlay('жираф 20ур', overlay).primary.mutantName).toBe('Флипфлоп, морфическая жираф')
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
  it("defaults to the mutant's highest available tier when unspecified", () => {
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

  it('rejects an explicit star tier the mutant never had in-game', () => {
    // Риф only exists at platinum - "бронза" was never a real tier for it.
    expect(err('риф 20ур бронза')).toMatch(/нет такой звезды/)
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

  it('keeps a level-form sphere mention when a "%" attack multiplier appears later in the message', () => {
    // Regression: the percent/level decision used to scan a wide window
    // around the keyword, so a later "+50% на первую атаку" could leak its
    // "%" into that window and flip "скорость 5" (sphere LEVEL 5) onto the
    // percent branch, matching no orb (none has speed=5%) and silently
    // dropping it.
    const cfg = ok('зверь 20ур спец скорость 5 +50% на первую атаку').primary
    expect(cfg.specialOrbId).toBe('orb_special_speed_05')
    expect(cfg.atkMultipliers[1]).toBe(50)
  })

  it('fills basic slots in the order orbs were typed, not by category priority', () => {
    // Regression, caught live in the test chat: findOrbMentions used to
    // collect mentions by walking CATEGORIES in its own fixed order
    // (здоровье before усиление), so a message asking for more basic-slot
    // orbs than the mutant has slots for would always keep whichever
    // category happened to sit earlier in that list - regardless of what
    // the user actually typed first. "Орбитальный Нексус" has exactly 3
    // basic slots.
    const cfg = ok('нексус 30ур платина хп5 усил5 усил4 хп5').primary
    expect(cfg.basicOrbIds).toEqual([
      'orb_basic_life_05',
      'orb_basic_strengthen_05',
      'orb_basic_strengthen_04',
    ])
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
