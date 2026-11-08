import { describe, expect, it, vi } from 'vitest'
import { checkSpamWatch, combineAnswers, createSpamChecker } from './spam-db'

const respond = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

describe('combineAnswers', () => {
  it('any hit is a ban and names the databases that found it', () => {
    expect(
      combineAnswers([
        { name: 'LOLS', verdict: 'clean' },
        { name: 'SpamWatch', verdict: 'banned' },
      ]),
    ).toEqual({ verdict: 'banned', source: 'SpamWatch' })
  })

  it('clean only when everyone answered and nobody found; silence is unknown, not clean', () => {
    expect(
      combineAnswers([
        { name: 'LOLS', verdict: 'clean' },
        { name: 'SpamWatch', verdict: 'clean' },
      ]),
    ).toEqual({ verdict: 'clean', source: 'LOLS+SpamWatch' })
    expect(
      combineAnswers([
        { name: 'LOLS', verdict: 'clean' },
        { name: 'SpamWatch', verdict: 'unknown' },
      ]).verdict,
    ).toBe('unknown')
  })
})

describe('checkSpamWatch', () => {
  it('404 is clean, 200 with the same id is banned', async () => {
    expect(await checkSpamWatch(5, 't', { fetchImpl: respond({}, 404) })).toBe('clean')
    expect(await checkSpamWatch(5, 't', { fetchImpl: respond({ id: 5, reason: 'spam' }) })).toBe(
      'banned',
    )
  })

  it('anything else is unknown, never a ban', async () => {
    expect(await checkSpamWatch(5, 't', { fetchImpl: respond({ id: 6 }) })).toBe('unknown')
    expect(await checkSpamWatch(5, 't', { fetchImpl: respond({}) })).toBe('unknown')
    expect(await checkSpamWatch(5, 't', { fetchImpl: respond({}, 401) })).toBe('unknown')
    expect(
      await checkSpamWatch(5, 't', { fetchImpl: vi.fn(() => Promise.reject(new Error('x'))) }),
    ).toBe('unknown')
  })

  it('sends the token as a bearer header', async () => {
    const f = respond({}, 404)
    await checkSpamWatch(5, 'secret', { fetchImpl: f })
    const init = (f.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> }
    expect(init.headers.Authorization).toBe('Bearer secret')
  })
})

describe('createSpamChecker', () => {
  const lols = (banned: boolean) =>
    vi.fn((url: unknown) =>
      Promise.resolve(
        new Response(
          JSON.stringify(String(url).includes('lols') ? { ok: true, banned } : { id: 5 }),
          { status: String(url).includes('lols') ? 200 : 200 },
        ),
      ),
    )

  it('LOLS only without a token', async () => {
    const f = lols(false)
    expect(await createSpamChecker({ fetchImpl: f })(5)).toEqual({
      verdict: 'clean',
      source: 'LOLS',
    })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('SpamWatch joins in when a token is set', async () => {
    const f = lols(false)
    const r = await createSpamChecker({ spamwatchToken: 't', fetchImpl: f })(5)
    expect(r).toEqual({ verdict: 'banned', source: 'SpamWatch' })
  })
})
