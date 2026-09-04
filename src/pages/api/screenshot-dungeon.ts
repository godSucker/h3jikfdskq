import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'

// Скриншот ОДНОЙ карточки рейда/лесенки (activity-card в GuidesBrowser.svelte)
// для бот-скриншотера в админ-чат - см. память auto-announcements-
// architecture.md. GuidesBrowser сам находит нужную вкладку/секцию по
// ?dungeon=<id> (resolveDungeonDeepLink) - тут только ждём готовую карточку
// и снимаем именно её, не всю вкладку целиком.
export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id')
  if (!id) {
    return new Response('Missing id param', { status: 400 })
  }

  // Хардкод, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const pageUrl = `https://archivist-library.com/guides?dungeon=${encodeURIComponent(id)}`

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
      viewport: { width: 700, height: 700 },
    })

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    // state:'attached' (не 'visible') - неактивные вкладки GuidesBrowser не
    // рендерят соседние {#if activeTab === ...} ветки в DOM вообще, только
    // выбранная присутствует, так что 'attached' уже достаточно точен.
    const selector = `.activity-card[data-dungeon-id="${id}"]`
    await Promise.all([
      page.waitForSelector(selector, { timeout: 12000, state: 'attached' }),
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

    await page.waitForTimeout(150)

    const card = await page.$(selector)
    if (!card) {
      // Карточка не найдена (dungeon-covers/данные ещё не задеплоились) -
      // процессор очереди трактует 404 как "повторить позже".
      return new Response('Dungeon card not found', { status: 404 })
    }
    const buffer = (await card.screenshot({ type: 'png' })) as Buffer

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot-Dungeon]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
