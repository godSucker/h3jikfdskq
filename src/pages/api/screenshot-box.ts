import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'

// Скриншот содержимого ОДНОГО бокса (модалка BoxModal.svelte) для
// бот-скриншотера в админ-чат - см. память auto-announcements-architecture.md
// ("бот-скриншотер"). Открывает живую /boxes?box=<itemId> (та же ?board=
// конвенция, что у screenshot-bingo.ts) вместо отдельной изолированной
// render-страницы - модалка и так уже открывается по клику на карточку,
// проще переиспользовать готовый deep-link (BoxesPage.astro), чем
// дублировать её разметку статикой.
export const GET: APIRoute = async ({ url }) => {
  const itemId = url.searchParams.get('itemId')
  if (!itemId) {
    return new Response('Missing itemId param', { status: 400 })
  }

  // Хардкод, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const pageUrl = `https://archivist-library.com/boxes?box=${encodeURIComponent(itemId)}`

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
      viewport: { width: 900, height: 1000 },
    })

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    const selector = '.modal-panel'
    await Promise.all([
      page.waitForSelector(selector, { timeout: 12000, state: 'visible' }),
      page.evaluate(() => document.fonts.ready),
    ])

    // .mutant-grid ограничен max-height:50vh/overflow-y:auto для живых
    // посетителей (прокрутка внутри модалки) - element.screenshot() снимает
    // только видимый прямоугольник, боксы с большим пулом обрезались бы
    // на скриншоте (боксы с сотнями мутантов в пуле - не редкость, см.
    // groupedOutcomes в BoxModal.svelte). Снимаем ограничение ТОЛЬКО для
    // захвата, не трогаем живую вёрстку.
    await page.evaluate((sel) => {
      const grid = document.querySelector(`${sel} .mutant-grid`)
      if (grid instanceof HTMLElement) {
        grid.style.maxHeight = 'none'
        grid.style.overflow = 'visible'
      }
    }, selector)

    await page.evaluate((sel) => {
      document
        .querySelectorAll(`${sel} img[loading="lazy"]`)
        .forEach((img) => img.setAttribute('loading', 'eager'))
    }, selector)

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

    await page.evaluate(() => {
      document
        .querySelectorAll('[id*="vercel" i], [class*="vercel" i], iframe[src*="vercel.live"]')
        .forEach((el) => el.remove())
    })

    await page.waitForTimeout(200)

    const panel = await page.$(selector)
    if (!panel) {
      // itemId не найден в boxes.json на ЖИВОМ проде (данные ещё не
      // задеплоились после коммита build-announcements.ts) - процессор
      // очереди (scripts/process-pending-screenshots.ts) трактует 404 как
      // "повторить позже", не как окончательный сбой.
      return new Response('Box not found', { status: 404 })
    }
    const box = await panel.boundingBox()
    if (!box) {
      return new Response('Box panel has no layout box', { status: 500 })
    }
    // page.screenshot({clip}) - не panel.screenshot() (ElementHandle.screenshot
    // не принимает clip вообще) - клиппим по высоте, чтобы раскрытый
    // (max-height:none) mutant-grid огромного бокса не дал абсурдно
    // вытянутый PNG, который Telegram может отклонить как медиа (лимит
    // соотношения сторон).
    const buffer = (await page.screenshot({
      type: 'png',
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 2600) },
    })) as Buffer

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot-Box]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
