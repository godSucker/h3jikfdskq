import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'
import { ruDate, injectDateBadge } from '@/lib/screenshot-date-badge'

// Скриншот модалки ОДНОГО мутанта (MutantModal.svelte) для бот-скриншотера в
// админ-чат - юзер попросил модалку вместо сухой карточки анонса (та несёт
// только имя+иконку, модалка - полную статкарту). Переиспользует уже
// существующий ?mutant=<id> deep-link /mutants (см. MutantsBrowser.svelte,
// тот же приём, что даёт сайтовый поиск - строить отдельную render-страницу
// не нужно, модалка и так открывается по URL). ?date= рисует плашку с датой
// анонса прямо на скрине (см. src/lib/screenshot-date-badge.ts).

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id')
  if (!id) {
    return new Response('Missing id param', { status: 400 })
  }
  const dateLabel = ruDate(url.searchParams.get('date') ?? '')

  // Хардкод, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const pageUrl = `https://archivist-library.com/mutants?mutant=${encodeURIComponent(id)}`

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
      viewport: { width: 1100, height: 1600 },
    })

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    // aria-labelledby, не .modal-2k (Tailwind-класс) - устойчивее к правкам
    // вёрстки, id="mutant-title" уникален на странице только внутри модалки.
    const selector = '[role="dialog"][aria-labelledby="mutant-title"]'
    await Promise.all([
      page.waitForSelector(selector, { timeout: 12000, state: 'visible' }),
      page.evaluate(() => document.fonts.ready),
    ])

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

    await injectDateBadge(page, selector, dateLabel)

    await page.waitForTimeout(150)

    const dialog = await page.$(selector)
    if (!dialog) {
      // Мутант не найден на живом проде (данные ещё не задеплоились) -
      // процессор очереди трактует 404 как "повторить позже".
      return new Response('Mutant not found', { status: 404 })
    }
    // animations:'disabled' - Playwright замораживает CSS-анимации/переходы и
    // НЕ ждёт "element stable" из-за них. Без этого инъекция плашки даты
    // (микро-reflow при подгрузке шрифта плашки) держала проверку
    // стабильности незавершённой -> Timeout 30000ms. page.screenshot({clip})
    // тут не годится - ждёт стабилизации ВСЕЙ страницы (фон /mutants с сотнями
    // lazy-картинок за модалкой никогда не "устаканивается").
    const buffer = (await dialog.screenshot({
      type: 'png',
      animations: 'disabled',
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
    console.error('[Screenshot-Mutant]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
