import { describe, expect, it } from 'vitest'
import { parseGuardConfig, planJoin, type GuardConfig } from './policy'

const cfg = (over: Partial<GuardConfig> = {}): GuardConfig => ({ ban: false, ...over })

describe('parseGuardConfig', () => {
  it('everything is off by default: the bot only logs', () => {
    expect(parseGuardConfig({})).toEqual({ ban: false })
  })

  it('reads the ban switch', () => {
    expect(parseGuardConfig({ GUARD_BAN: '1' })).toEqual({ ban: true })
    expect(parseGuardConfig({ GUARD_BAN: 'true' })).toEqual({ ban: true })
    expect(parseGuardConfig({ GUARD_BAN: 'no' })).toEqual({ ban: false })
    expect(parseGuardConfig({ GUARD_BAN: '0' })).toEqual({ ban: false })
  })
})

describe('planJoin', () => {
  it('never touches bots', () => {
    expect(planJoin({ isBot: true, lols: 'banned' }, cfg({ ban: true }))).toMatchObject({
      intent: 'skip',
      effective: 'none',
    })
  })

  it('a database hit: banned only with the ban switch, otherwise just logged', () => {
    expect(planJoin({ isBot: false, lols: 'banned' }, cfg())).toMatchObject({
      intent: 'ban',
      effective: 'none',
    })
    expect(planJoin({ isBot: false, lols: 'banned' }, cfg({ ban: true }))).toMatchObject({
      intent: 'ban',
      effective: 'ban',
    })
  })

  it('a newcomer who is not in the database is let through, with or without the switch', () => {
    for (const ban of [false, true]) {
      expect(planJoin({ isBot: false, lols: 'clean' }, cfg({ ban }))).toMatchObject({
        intent: 'pass',
        effective: 'none',
      })
    }
  })

  it('an unanswered database is never a reason to ban', () => {
    const plan = planJoin({ isBot: false, lols: 'unknown' }, cfg({ ban: true }))
    expect(plan).toMatchObject({ intent: 'pass', effective: 'none' })
    expect(plan.reason).toContain('не ответила')
  })
})
