import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROBATION_HOURS,
  parseGuardConfig,
  planJoin,
  probationPermissions,
  probationUntil,
  type GuardConfig,
} from './policy'

const cfg = (over: Partial<GuardConfig> = {}): GuardConfig => ({
  restrict: false,
  ban: false,
  probationHours: 24,
  ...over,
})

describe('parseGuardConfig', () => {
  it('everything is off by default: the bot only logs', () => {
    expect(parseGuardConfig({})).toEqual({
      restrict: false,
      ban: false,
      probationHours: DEFAULT_PROBATION_HOURS,
    })
  })

  it('reads the switches independently', () => {
    expect(parseGuardConfig({ GUARD_RESTRICT: '1' })).toMatchObject({ restrict: true, ban: false })
    expect(parseGuardConfig({ GUARD_BAN: 'true' })).toMatchObject({ restrict: false, ban: true })
    expect(parseGuardConfig({ GUARD_RESTRICT: 'no', GUARD_BAN: '0' })).toMatchObject({
      restrict: false,
      ban: false,
    })
  })

  it('keeps probation hours inside a sane range', () => {
    expect(parseGuardConfig({ GUARD_PROBATION_HOURS: '12' }).probationHours).toBe(12)
    expect(parseGuardConfig({ GUARD_PROBATION_HOURS: '0' }).probationHours).toBe(24)
    expect(parseGuardConfig({ GUARD_PROBATION_HOURS: '99999' }).probationHours).toBe(24)
    expect(parseGuardConfig({ GUARD_PROBATION_HOURS: 'abc' }).probationHours).toBe(24)
  })
})

describe('planJoin', () => {
  it('never touches bots', () => {
    expect(
      planJoin({ isBot: true, lols: 'banned' }, cfg({ restrict: true, ban: true })),
    ).toMatchObject({
      intent: 'skip',
      effective: 'none',
    })
  })

  it('log-only mode wants to act but does nothing', () => {
    expect(planJoin({ isBot: false, lols: 'clean' }, cfg())).toMatchObject({
      intent: 'restrict',
      effective: 'none',
    })
    expect(planJoin({ isBot: false, lols: 'banned' }, cfg())).toMatchObject({
      intent: 'ban',
      effective: 'none',
    })
  })

  it('restricts a clean newcomer when restriction is on', () => {
    expect(planJoin({ isBot: false, lols: 'clean' }, cfg({ restrict: true }))).toMatchObject({
      intent: 'restrict',
      effective: 'restrict',
    })
  })

  it('a database hit is banned only with the ban switch, otherwise falls back to restriction', () => {
    expect(planJoin({ isBot: false, lols: 'banned' }, cfg({ ban: true }))).toMatchObject({
      intent: 'ban',
      effective: 'ban',
    })
    expect(planJoin({ isBot: false, lols: 'banned' }, cfg({ restrict: true }))).toMatchObject({
      intent: 'ban',
      effective: 'restrict',
    })
  })

  it('an unanswered database is never a reason to ban', () => {
    const plan = planJoin({ isBot: false, lols: 'unknown' }, cfg({ restrict: true, ban: true }))
    expect(plan).toMatchObject({ intent: 'restrict', effective: 'restrict' })
  })
})

describe('probation permissions', () => {
  it('text only: no media of any kind', () => {
    const p = probationPermissions()
    expect(p.can_send_messages).toBe(true)
    for (const k of [
      'can_send_photos',
      'can_send_videos',
      'can_send_documents',
      'can_send_audios',
      'can_send_voice_notes',
      'can_send_video_notes',
      'can_send_other_messages',
      'can_send_polls',
      'can_add_web_page_previews',
    ] as const) {
      expect(p[k], k).toBe(false)
    }
  })

  it('the end date is an absolute unix time, always far past the 30s "forever" threshold', () => {
    expect(probationUntil(1_000_000, 24)).toBe(1_000_000 + 86_400)
    expect(probationUntil(1_000_000, 1)).toBeGreaterThan(1_000_000 + 30)
  })
})
