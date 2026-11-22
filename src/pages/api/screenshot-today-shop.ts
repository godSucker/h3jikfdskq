import type { APIRoute } from 'astro'
import { withPage } from '@/lib/headless-browser'
import { renderLocale } from '@/lib/render-locale'

// Скриншот "Сегодня в магазине" (render-today-shop.astro) для ежедневного
// дайджеста - срез уже известных офферов shopForecast/dailyNews, чей
// exactDateStart приходится на сегодня (МСК), не вся доска спринта целиком
// (юзер 2026-11-23: спринты из дайджеста убраны, нужен разрез по дням). Без
// id-параметра: страница сама читает announcements.json и сама решает,
// какой день "сегодня" - вызывающая сторона (build-daily-digest.ts) должна
// звать этот эндпоинт только когда заранее убедилась, что сегодня есть хотя
// бы один подходящий оффер (та же фильтрация дублируется в скрипте), иначе
// получит валидный, но пустой кадр "Сегодня новых офферов нет".
export const GET: APIRoute = async ({ url }) => {
  const lang = renderLocale(url.searchParams.get('lang'))

  // Хардкод хоста, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const pageUrl =
    `https://archivist-library.com/announcements/render-today-shop` +
    (lang !== 'ru' ? `?lang=${lang}` : '')

  try {
    return await withPage({ width: 940, height: 1800 }, async (page) => {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

      const selector = '#today-shop-card'
      await page.waitForSelector(selector, { timeout: 12000, state: 'attached' })
      await page.evaluate(() => document.fonts.ready)

      await page.evaluate(() => {
        document
          .querySelectorAll('img[loading="lazy"]')
          .forEach((img) => img.setAttribute('loading', 'eager'))
      })

      const allLoaded = await page
        .waitForFunction(
          () => {
            const imgs = Array.from(document.querySelectorAll('img'))
            return imgs.every((i) => {
              const img = i as HTMLImageElement
              if (!img.getAttribute('src')) return true
              return img.complete && img.naturalWidth > 0
            })
          },
          { timeout: 15000 },
        )
        .then(() => true)
        .catch(() => false)

      if (!allLoaded) {
        await page.evaluate(() => {
          document.querySelectorAll('img').forEach((img) => {
            const el = img as HTMLImageElement
            if (el.getAttribute('src') && (!el.complete || el.naturalWidth === 0)) {
              const src = el.src
              el.src = ''
              el.src = src
            }
          })
        })
        await page
          .waitForFunction(
            () => {
              const imgs = Array.from(document.querySelectorAll('img'))
              return imgs.every((i) => {
                const img = i as HTMLImageElement
                if (!img.getAttribute('src')) return true
                return img.complete && img.naturalWidth > 0
              })
            },
            { timeout: 8000 },
          )
          .catch(() => {})
      }

      await page.evaluate(() => {
        document
          .querySelectorAll('[id*="vercel" i], [class*="vercel" i], iframe[src*="vercel.live"]')
          .forEach((el) => el.remove())
      })

      await page.waitForTimeout(150)

      const card = await page.$(selector)
      if (!card) {
        return new Response('Today-shop card not found', { status: 404 })
      }
      const bbox = await card.boundingBox()
      if (!bbox) {
        return new Response('Today-shop card has no layout box', { status: 500 })
      }
      const buffer = (await page.screenshot({
        type: 'png',
        clip: {
          x: bbox.x,
          y: bbox.y,
          width: Math.min(bbox.width, 940 - bbox.x),
          height: Math.min(bbox.height, 1800 - bbox.y),
        },
      })) as Buffer

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=1800, s-maxage=1800',
        },
      })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot-TodayShop]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  }
}
