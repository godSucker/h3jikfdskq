import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAsset } from './telegram-card-render'

const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'TimeoutError')),
    )
  })

afterEach(() => vi.unstubAllGlobals())

describe('fetchAsset: CDN and site origin are asked at once', () => {
  it('a silent CDN does not delay the answer from the site origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url.startsWith('https://cdn.') ? hang(init) : Promise.resolve(new Response('font-bytes')),
      ),
    )
    const t0 = Date.now()
    const res = await fetchAsset('/fonts/tt-supermolot-neue/TTSupermolotNeue-Bold.ttf')
    expect(await res.text()).toBe('font-bytes')
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('a 404 on the site origin is ignored while the CDN answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.startsWith('https://cdn.') ? new Response('ok') : new Response('', { status: 404 }),
        ),
      ),
    )
    expect(await (await fetchAsset('/stars/star_gold.webp')).text()).toBe('ok')
  })

  it('retries once, then reports both origins in the error', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('', { status: 503 })))
    vi.stubGlobal('fetch', f)
    await expect(fetchAsset('/x.webp', 2)).rejects.toThrow(
      /fetch failed \/x\.webp: 503 https:\/\/cdn\..*503 https:\/\/archivist-library\.com/,
    )
    expect(f).toHaveBeenCalledTimes(4)
  })
})
