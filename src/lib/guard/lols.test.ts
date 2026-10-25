import { describe, expect, it, vi } from 'vitest'
import { checkLols } from './lols'

const respond = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

describe('checkLols', () => {
  it('maps banned true/false', async () => {
    expect(await checkLols(1, { fetchImpl: respond({ ok: true, user_id: 1, banned: true }) })).toBe(
      'banned',
    )
    expect(
      await checkLols(1, { fetchImpl: respond({ ok: true, user_id: 1, banned: false }) }),
    ).toBe('clean')
  })

  it('asks for the right user id', async () => {
    const f = respond({ ok: true, banned: false })
    await checkLols(5241626494, { fetchImpl: f })
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe(
      'https://api.lols.bot/account?id=5241626494',
    )
  })

  it('anything unexpected is unknown, never a ban', async () => {
    expect(await checkLols(1, { fetchImpl: respond({ ok: false, banned: true }) })).toBe('unknown')
    expect(await checkLols(1, { fetchImpl: respond({ ok: true }) })).toBe('unknown')
    expect(await checkLols(1, { fetchImpl: respond({ ok: true, banned: 'yes' }) })).toBe('unknown')
    expect(await checkLols(1, { fetchImpl: respond({ error: 'x' }, 500) })).toBe('unknown')
    expect(await checkLols(1, { fetchImpl: vi.fn(() => Promise.reject(new Error('down'))) })).toBe(
      'unknown',
    )
    expect(
      await checkLols(1, {
        fetchImpl: vi.fn(() => Promise.resolve(new Response('<html>', { status: 200 }))),
      }),
    ).toBe('unknown')
  })
})
