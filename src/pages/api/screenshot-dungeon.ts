import type { APIRoute } from 'astro'
import { withPage } from '@/lib/headless-browser'

// Постер ОДНОГО рейда / лесенки / ивент-лесенки (/dungeon-poster) для
// бот-скриншотера в админ-чат - см. память auto-announcements-architecture.md.
// ?id=<id>[&from=<ISO>&to=<ISO>]: from/to - окно события, рисуются датами в
// левом верхнем углу (без них даты не показываются). Снимаем в css-пикселях
// (1700px по ширине): Telegram всё равно ужимает обычное фото, а PNG в x2
// у длинного рейда (300 этажей) приближается к лимиту 10 МБ.
export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id')
  if (!id) {
    return new Response('Missing id param', { status: 400 })
  }

  // Хардкод, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const params = new URLSearchParams({ id })
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key)
    if (value) params.set(key, value)
  }
  const pageUrl = `https://archivist-library.com/dungeon-poster?${params}`

  try {
    return await withPage({ width: 1700, height: 1100 }, async (page) => {
      const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
      // 404 = данных по этому id ещё нет на проде (деплой не доехал) - процессор
      // очереди трактует это как "повторить позже".
      if (response?.status() === 404) {
        return new Response('Dungeon poster not found', { status: 404 })
      }

      const selector = '.poster[data-dungeon-id]'
      await Promise.all([
        page.waitForSelector(selector, { timeout: 12000, state: 'attached' }),
        page.evaluate(() => document.fonts.ready),
      ])

      const allLoaded = await page
        .waitForFunction(
          () =>
            Array.from(document.querySelectorAll('.poster img')).every((i) => {
              const img = i as HTMLImageElement
              return !img.getAttribute('src') || (img.complete && img.naturalWidth > 0)
            }),
          undefined,
          { timeout: 15000 },
        )
        .then(() => true)
        .catch(() => false)
      if (!allLoaded) {
        // Одна перезагрузка зависших картинок (холодный CDN), как в других screenshot-*.
        await page.evaluate(() => {
          document.querySelectorAll('.poster img').forEach((i) => {
            const img = i as HTMLImageElement
            if (img.getAttribute('src') && (!img.complete || img.naturalWidth === 0)) {
              const src = img.src
              img.src = ''
              img.src = src
            }
          })
        })
        await page
          .waitForFunction(
            () =>
              Array.from(document.querySelectorAll('.poster img')).every((i) => {
                const img = i as HTMLImageElement
                return !img.getAttribute('src') || (img.complete && img.naturalWidth > 0)
              }),
            undefined,
            { timeout: 6000 },
          )
          .catch(() => {})
      }

      await page.evaluate(() => {
        document
          .querySelectorAll('[id*="vercel" i], [class*="vercel" i], iframe[src*="vercel.live"]')
          .forEach((el) => el.remove())
      })

      const poster = await page.$(selector)
      if (!poster) return new Response('Dungeon poster not found', { status: 404 })
      const buffer = (await poster.screenshot({ type: 'png', scale: 'css' })) as Buffer

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot-Dungeon]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  }
}
