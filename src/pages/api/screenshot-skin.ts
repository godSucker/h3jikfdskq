import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'
import { ruDate, injectDateBadge } from '@/lib/screenshot-date-badge'

// Скриншот модалки ОДНОГО скина (MutantModal.svelte с предвыбранным вариантом
// скина) для бот-скриншотера в админ-чат - как screenshot-mutant.ts, но
// открывает конкретный скин через диплинк /mutants?mutant=<base>&skin=<key>
// (см. MutantsBrowser.svelte::tryOpenFromUrl + MutantModal.svelte initialSkin).
//
// id = полный item.id анонса скина, формат "<SpecimenId>|<skinKey>" (см.
// detectSkins в scripts/build-announcements.ts). Делим по "|".
// ?date= рисует плашку с датой анонса на скрине (screenshot-date-badge.ts).
export const GET: APIRoute = async ({ url }) => {
  const raw = url.searchParams.get('id')
  if (!raw) {
    return new Response('Missing id param', { status: 400 })
  }
  const sep = raw.indexOf('|')
  if (sep <= 0 || sep === raw.length - 1) {
    return new Response('id must be "<specimenId>|<skinKey>"', { status: 400 })
  }
  const baseId = raw.slice(0, sep)
  const skinKey = raw.slice(sep + 1)
  const dateLabel = ruDate(url.searchParams.get('date') ?? '')

  // Хардкод, не url.origin: см. комментарий в screenshot.ts (SSRF через Host).
  const pageUrl = `https://archivist-library.com/mutants?mutant=${encodeURIComponent(
    baseId,
  )}&skin=${encodeURIComponent(skinKey)}`

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
      viewport: { width: 1100, height: 1000 },
    })

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    // aria-labelledby, не .modal-2k (Tailwind-класс) - устойчивее к правкам
    // вёрстки, id="mutant-title" уникален на странице только внутри модалки.
    const selector = '[role="dialog"][aria-labelledby="mutant-title"]'
    await Promise.all([
      page.waitForSelector(selector, { timeout: 12000, state: 'visible' }),
      page.evaluate(() => document.fonts.ready),
    ])

    // Скин выбирается реактивно в MutantModal (initialSkin -> $effect). Заголовок
    // модалки при выбранном скине - "<Имя> — <Имя скина>". Ждём появления " — "
    // как сигнала, что вариант применился, прежде чем ждать картинки (иначе
    // можем снять базового мутанта). Не критично при таймауте - скин мог
    // просто не найтись, тогда снимем базового (лучше, чем 500).
    await page
      .waitForFunction(
        (sel) => (document.querySelector(`${sel} #mutant-title`)?.textContent ?? '').includes(' — '),
        selector,
        { timeout: 4000 },
      )
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

    await page.waitForTimeout(150)

    const dialog = await page.$(selector)
    if (!dialog) {
      // Скин/мутант не найден на живом проде (данные ещё не задеплоились) -
      // процессор очереди трактует 404 как "повторить позже".
      return new Response('Skin not found', { status: 404 })
    }
    const buffer = (await dialog.screenshot({ type: 'png' })) as Buffer

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot-Skin]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
