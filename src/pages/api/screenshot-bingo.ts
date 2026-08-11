import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'

// НЕ держим browser-singleton между запросами - см. подробное объяснение в
// screenshot-announcement.ts (тот же паттерн раньше был и тут). На живом
// прогоне 2026-08-07 singleton копил свежий user-data-dir на каждый запуск
// без переиспользования тёплого браузера и без удаления профиля - за
// несколько прогонов забил /tmp контейнера до 0 байт, все скриншот-эндпоинты
// в контейнере начали падать разом. Полный launch+close на запрос медленнее
// на холодный старт, но не копит мусор между вызовами.
export const GET: APIRoute = async ({ url }) => {
  const boardId = url.searchParams.get('board')
  if (!boardId) {
    return new Response('Missing board param', { status: 400 })
  }

  // Хардкод, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const pageUrl = `https://archivist-library.com/bingo?board=${encodeURIComponent(boardId)}`

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await cleanupStalePlaywrightProfiles()
    const Chromium = (await import('@sparticuz/chromium')).default
    const execPath = await Chromium.executablePath()
    browser = await chromium.launch({
      executablePath: execPath,
      args: Chromium.args,
    })
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { width: 1200, height: 1000 },
    })

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    const selector = `.bingo-panel[data-bingo-id="${boardId}"] .bingo-card`
    await Promise.all([
      page.waitForSelector(selector, { timeout: 12000, state: 'visible' }),
      page.evaluate(() => document.fonts.ready),
    ])

    // .mutant-img использует loading="lazy" (нужен для реальных посетителей,
    // не трогаем разметку) - без scroll/intersection браузер их не грузит
    // вообще, скриншот ловил пустые ячейки. Форсим eager именно для захвата.
    await page.evaluate((sel) => {
      document
        .querySelectorAll(`${sel} img[loading="lazy"]`)
        .forEach((img) => img.setAttribute('loading', 'eager'))
    }, selector)

    // .complete у <img> становится true и при ОШИБКЕ загрузки - проверка
    // только на complete раньше пропускала битые головы мутантов в готовый
    // скриншот молча (регрессия 2026-08-07, вызвана нехваткой ресурсов
    // контейнера под нагрузкой, не самой этой функцией - но раз уж чиним
    // соседний эндпоинт по этой же причине, чиним и тут).
    const check = (sel: string) => {
      const imgs = Array.from(document.querySelectorAll(`${sel} img`))
      return (
        imgs.length === 0 ||
        imgs.every((i) => {
          const img = i as HTMLImageElement
          if (!img.getAttribute('src')) return true
          return img.complete && img.naturalWidth > 0
        })
      )
    }
    const allLoaded = await page
      .waitForFunction(check, selector, { timeout: 12000 })
      .then(() => true)
      .catch(() => false)

    if (!allLoaded) {
      await page.evaluate((sel) => {
        document.querySelectorAll(`${sel} img`).forEach((i) => {
          const img = i as HTMLImageElement
          if (img.getAttribute('src') && (!img.complete || img.naturalWidth === 0)) {
            const src = img.src
            img.src = ''
            img.src = src
          }
        })
      }, selector)
      await page.waitForFunction(check, selector, { timeout: 6000 }).catch(() => {})
    }

    // Vercel Toolbar (виджет фидбека, инжектится скриптом с vercel.live
    // независимо от нашего кода) рисуется fixed-элементом поверх низа
    // страницы - в скриншот попадали его пиксели (фидбек 2026-08-08). Он
    // JS-инжектится не сразу, поэтому убираем ПРЯМО перед снимком, не раньше.
    await page.evaluate(() => {
      document
        .querySelectorAll('[id*="vercel" i], [class*="vercel" i], iframe[src*="vercel.live"]')
        .forEach((el) => el.remove())
    })

    await page.waitForTimeout(200)

    const card = await page.$(selector)
    if (!card) {
      return new Response('Bingo card not found', { status: 404 })
    }
    const buffer = (await card.screenshot({ type: 'png' })) as Buffer

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Встраивается как обычная <img> на /announcements - без кэша
        // каждый визит гонял бы Chromium заново. Доска меняется редко.
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot-Bingo]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
