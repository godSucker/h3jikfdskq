import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'
import { ruDate, freezePageForModalShot, injectDateBadge } from '@/lib/screenshot-date-badge'

// Скриншот модалки ОДНОГО мутанта (MutantModal.svelte) для бот-скриншотера в
// админ-чат. Снимаем с изолированной /mutants/skin-render/[id] (та же, что для
// скинов - MutantsBrowser рендерит ровно один мутант, всё лишнее скрыто CSS),
// НЕ с живой /mutants: там грид каталога на сотни lazy-картинок + битые
// иконки в модалке у части мутантов не дают headless-Chromium дождаться
// "element stable" -> Timeout 30000ms (Флипфлоп da_15 стабильно падал,
// фидбек 2026-09-05). Диплинк /mutants?mutant= для людей не тронут.
//
// id = specimen id мутанта (из detectMutants, уже lowercase). ?date= рисует
// плашку с датой анонса (screenshot-date-badge.ts).
export const GET: APIRoute = async ({ url }) => {
  const rawId = url.searchParams.get('id')
  if (!rawId) {
    return new Response('Missing id param', { status: 400 })
  }
  const id = rawId.toLowerCase()
  const dateLabel = ruDate(url.searchParams.get('date') ?? '')

  // Хардкод хоста, не url.origin: см. комментарий в screenshot.ts (SSRF через
  // Host). ?mutant= в query читает MutantsBrowser::tryOpenFromUrl на самой
  // render-странице (путь /[id] - для резолва данных во frontmatter).
  const pageUrl =
    `https://archivist-library.com/mutants/skin-render/${encodeURIComponent(id)}` +
    `?mutant=${encodeURIComponent(id)}`

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

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })

    const selector = '[role="dialog"][aria-labelledby="mutant-title"]'
    await Promise.all([
      page.waitForSelector(selector, { timeout: 25000, state: 'visible' }),
      page.evaluate(() => document.fonts.ready),
    ])

    // У мутанта на скрине всегда выбираем МАКСИМАЛЬНУЮ доступную звезду -
    // .star-switch-btn в MutantModal рендерятся по возрастанию
    // (normal→bronze→silver→gold→platinum), кликаем последнюю. Нет ряда звёзд
    // (одна звезда) - кликать нечего, и так максимум.
    await page
      .evaluate((sel) => {
        const btns = document.querySelectorAll<HTMLButtonElement>(`${sel} .star-switch-btn`)
        if (btns.length > 1) btns[btns.length - 1].click()
      }, selector)
      .catch(() => {})

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
    await freezePageForModalShot(page, selector)

    await page.waitForTimeout(400)

    const dialog = await page.$(selector)
    if (!dialog) {
      // Мутант не найден на живом проде (данные ещё не задеплоились) -
      // процессор очереди трактует 404 как "повторить позже".
      return new Response('Mutant not found', { status: 404 })
    }
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
