import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'

// Генерирует скриншот ОДНОЙ карточки анонса через изолированную страницу
// /announcements/render/[id] (не живую /announcements) - карточка там
// единственный элемент на странице, без ленты/фильтров/reflow от соседних
// lazy-картинок. Раньше скриншотили карточку прямо в ленте - под нагрузкой
// на проде соседние карточки догружались, пока Chromium скроллил целевую в
// viewport, и сдвигали её ПОСЛЕ того, как Playwright уже вычислил
// прямоугольник для скриншота -> обрезанные/съехавшие кадры (фидбек
// 2026-08-07). Разметка /announcements/render/[id] переиспользует ТОТ ЖЕ
// компонент AnnouncementCard.astro, что и живая лента - карточка на сайте и
// в боте не расходятся.
export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id')
  if (!id) {
    return new Response('Missing id param', { status: 400 })
  }

  // Хардкод, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const pageUrl = `https://archivist-library.com/announcements/render/${encodeURIComponent(id)}`

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
      viewport: { width: 800, height: 1000 },
    })

    // Бинго-карточка сама встраивает <img src="/api/screenshot-bingo"> - на
    // практике crossPostAnnouncement никогда не зовёт этот эндпоинт для
    // категории bingo (у неё свой путь через postBingo), но обрезаем запрос
    // защитно, чтобы прямой вызов с id бинго-анонса не поймал
    // Chromium-в-Chromium.
    await page.route('**/api/screenshot-bingo*', (route) => route.abort())

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    const selector = 'article.card'
    await page.waitForSelector(selector, { timeout: 12000, state: 'attached' })
    await page.evaluate(() => document.fonts.ready)

    // Страница рендерит только эту карточку (не живая лента) - можно смело
    // форсить eager на ВСЕ картинки, не только внутри selector.
    await page.evaluate(() => {
      document
        .querySelectorAll('img[loading="lazy"]')
        .forEach((img) => img.setAttribute('loading', 'eager'))
    })

    // .complete у <img> становится true и при ОШИБКЕ загрузки, не только при
    // успехе - проверка только на complete раньше пропускала битые картинки
    // в готовый скриншот молча (фидбек 2026-08-07: незагруженные иконки на
    // проде). Ждём complete + naturalWidth>0 (успешная отрисовка) для КАЖДОЙ
    // картинки с непустым src.
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
      // Одна фактическая попытка реанимировать зависшие картинки - сброс src
      // форсит повторный запрос к CDN (частая причина - холодный кэш, не
      // настоящая 404), затем короткое повторное ожидание.
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

    // Vercel Toolbar (виджет фидбека, инжектится скриптом с vercel.live
    // независимо от нашего кода) рисуется fixed-элементом поверх низа
    // страницы - в скриншот бинго попадали его пиксели (фидбек 2026-08-08).
    await page.evaluate(() => {
      document
        .querySelectorAll('[id*="vercel" i], [class*="vercel" i], iframe[src*="vercel.live"]')
        .forEach((el) => el.remove())
    })

    await page.waitForTimeout(150)

    const card = await page.$(selector)
    if (!card) {
      return new Response('Announcement card not found', { status: 404 })
    }
    // page.screenshot({clip}) вместо card.screenshot() (ElementHandle.screenshot
    // не принимает clip вообще) - клипуем по высоте, чтобы огромная карточка
    // (box-дроплист на сотни мутантов, board-грид daily_news на 24 тайла) не
    // дала абсурдно вытянутый PNG, который Telegram отклонит по соотношению
    // сторон. 2600 CSS-px x deviceScaleFactor:2 = 5200px - с запасом в лимитах
    // (сумма сторон <= 10000, соотношение <= 20). Тот же приём, что в
    // screenshot-box.ts.
    const bbox = await card.boundingBox()
    if (!bbox) {
      return new Response('Announcement card has no layout box', { status: 500 })
    }
    const buffer = (await page.screenshot({
      type: 'png',
      clip: {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: Math.min(bbox.height, 2600),
      },
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
    console.error('[Screenshot-Announcement]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
