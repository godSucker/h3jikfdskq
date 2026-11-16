import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramApiError, telegramCall } from './telegram-send'

const init = { body: 'x' }
const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const withCode = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('telegramCall', () => {
  it('returns on success without retrying', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { ok: true }))
    vi.stubGlobal('fetch', f)
    await telegramCall('t', 'sendPhoto', init, 1000)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('logs failed attempts with elapsed time and detail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = vi.fn().mockResolvedValue(json(500, { ok: false }))
    vi.stubGlobal('fetch', f)
    await expect(telegramCall('t', 'sendPhoto', init, 1000, '450KB')).rejects.toThrow()
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /sendPhoto failed: status 500 after \d+ms, attempt 1\/3, retry false 450KB/,
      ),
    )
    warn.mockRestore()
  })

  it('asks for a fresh connection instead of a pooled one', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { ok: true }))
    vi.stubGlobal('fetch', f)
    await telegramCall('t', 'sendPhoto', { body: 'x', headers: { 'X-A': '1' } }, 1000)
    expect(f.mock.calls[0][1].headers).toEqual({ 'X-A': '1', connection: 'close' })
  })

  it('NEVER repeats after a timeout: the send may have gone through', async () => {
    const f = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    vi.stubGlobal('fetch', f)
    await expect(telegramCall('t', 'sendPhoto', init, 1000)).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('NEVER repeats after 5xx (504 may still have delivered the photo)', async () => {
    const f = vi.fn().mockResolvedValue(json(504, { ok: false, description: 'Gateway Timeout' }))
    vi.stubGlobal('fetch', f)
    await expect(telegramCall('t', 'sendPhoto', init, 1000)).rejects.toBeInstanceOf(
      TelegramApiError,
    )
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('does not repeat 4xx and flags a deleted reply target', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        json(400, { ok: false, description: 'Bad Request: message to be replied not found' }),
      )
    vi.stubGlobal('fetch', f)
    const err = await telegramCall('t', 'sendPhoto', init, 1000).catch((e) => e)
    expect(err).toBeInstanceOf(TelegramApiError)
    expect(err.replyTargetGone).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('repeats a short 429 (rejected, so nothing was sent)', async () => {
    vi.useFakeTimers()
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(429, { ok: false, parameters: { retry_after: 1 } }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    vi.stubGlobal('fetch', f)
    const p = telegramCall('t', 'sendMessage', init, 1000)
    await vi.advanceTimersByTimeAsync(1500)
    await p
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('does not wait out a long flood-wait', async () => {
    const f = vi.fn().mockResolvedValue(json(429, { ok: false, parameters: { retry_after: 30 } }))
    vi.stubGlobal('fetch', f)
    await expect(telegramCall('t', 'sendMessage', init, 1000)).rejects.toBeInstanceOf(
      TelegramApiError,
    )
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('repeats when the connection was never established, up to 3 attempts', async () => {
    vi.useFakeTimers()
    const f = vi.fn().mockRejectedValue(withCode('ECONNREFUSED'))
    vi.stubGlobal('fetch', f)
    const p = telegramCall('t', 'sendMessage', init, 1000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toBeInstanceOf(TypeError)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('does not repeat a connection reset mid-request (ambiguous)', async () => {
    const f = vi.fn().mockRejectedValue(withCode('ECONNRESET'))
    vi.stubGlobal('fetch', f)
    await expect(telegramCall('t', 'sendPhoto', init, 1000)).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
  })
})
