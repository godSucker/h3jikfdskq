import type { APIRoute } from 'astro'
import { getBrowser, forceRelaunch, isBrowserDiedError } from '@/lib/headless-browser'

export const GET: APIRoute = async ({ url }) => {
  const stateParam = url.searchParams.get('state')
  if (!stateParam) {
    return new Response('Missing state param', { status: 400 })
  }

  // Locale - для скриншота на языке, на котором пользователь реально сидел
  // на сайте (раньше игнорировался, /panel-render всегда рендерил RU
  // независимо от locale - см. память i18n-final-audit-2026-08-16). Whitelist
  // валидация, не просто passthrough - это попадает прямо в URL, который наш
  // headless Chromium открывает.
  const LOCALES = ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl']
  const localeParam = url.searchParams.get('locale')
  const locale = LOCALES.includes(localeParam ?? '') ? localeParam : 'ru'

  // Хардкод, не url.origin: origin из запроса управляется заголовком Host,
  // подмена которого заставила бы наш же headless Chromium уйти по
  // произвольному URL (SSRF через собственный скриншот-эндпоинт).
  const renderUrl = `https://archivist-library.com/panel-render?state=${encodeURIComponent(stateParam)}&locale=${locale}`

  for (let attempt = 0; attempt < 2; attempt++) {
    let page
    try {
      const browser = await getBrowser()
      page = await browser.newPage({
        deviceScaleFactor: 2,
        viewport: { width: 1400, height: 900 },
      })

      // Step 1: Load HTML + JS (no networkidle — it hangs on Vercel serverless)
      await page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

      // Step 2: Wait for Svelte to render .panel + fonts ready (parallel)
      await Promise.all([
        page.waitForSelector('.panel', { timeout: 12000 }),
        page.evaluate(() => document.fonts.ready),
      ])

      // Step 3: Wait for CDN images to load (up to 5s, exits early if all done)
      await page
        .waitForFunction(
          () => {
            const imgs = Array.from(document.querySelectorAll('.panel img'))
            return imgs.length === 0 || imgs.every((i) => (i as HTMLImageElement).complete)
          },
          { timeout: 5000 },
        )
        .catch(() => {})

      await page.waitForTimeout(200)

      const isCompareMode =
        stateParam.includes('"compare":true') || stateParam.includes('"compare": true')
      if (isCompareMode) {
        await page
          .waitForFunction(() => document.querySelectorAll('.panel').length >= 2, { timeout: 5000 })
          .catch(() => {})
        await page.waitForTimeout(400)
      }

      await page.evaluate(() => {
        document
          .querySelectorAll('.tool-btn, .header-tools-row, .header-left, .catalog')
          .forEach((el) => ((el as HTMLElement).style.display = 'none'))
        document
          .querySelectorAll('.compare-search-wrap')
          .forEach((el) => ((el as HTMLElement).style.display = 'none'))
        document
          .querySelectorAll('.orbing-presets')
          .forEach((el) => ((el as HTMLElement).style.display = 'none'))
        document
          .querySelectorAll('.slot .x')
          .forEach((el) => ((el as HTMLElement).style.display = 'none'))
        document.querySelectorAll('.panel-header').forEach((el) => {
          const h = el as HTMLElement
          h.style.margin = '0'
          h.style.padding = '4px 0 0 0'
          h.style.minHeight = '0'
        })
        document.querySelectorAll('.hero-genes').forEach((el) => {
          ;(el as HTMLElement).style.marginBottom = '4px'
        })
        document
          .querySelectorAll('.atk-mult-btns')
          .forEach((el) => ((el as HTMLElement).style.display = 'none'))
        document.documentElement.style.setProperty('--orb-size-container-large', '52px')
        document.querySelectorAll('.slot-btn').forEach((el) => {
          ;(el as HTMLElement).style.overflow = 'hidden'
        })
        document.querySelectorAll('.orb').forEach((el) => {
          const h = el as HTMLElement
          h.style.width = '48px'
          h.style.height = '48px'
          h.style.objectFit = 'contain'
        })
        document.querySelectorAll('.attack-row').forEach((el) => {
          ;(el as HTMLElement).style.overflow = 'hidden'
        })
        document.querySelectorAll('.effect-row').forEach((el) => {
          ;(el as HTMLElement).style.paddingLeft = '0'
          ;(el as HTMLElement).style.paddingRight = '0'
        })

        const panels = document.querySelectorAll('.panel')
        panels.forEach((panel) => {
          const wm = document.createElement('div')
          wm.innerText = 'ARCHIVIST-LIBRARY.COM'
          Object.assign(wm.style, {
            textAlign: 'center',
            fontSize: '11px',
            color: '#637083',
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid #3a475a',
            fontWeight: '700',
            letterSpacing: '2px',
            fontFamily: 'sans-serif',
          })
          panel.appendChild(wm)
        })
      })
      await page.waitForTimeout(50)

      const isCompare = await page.evaluate(() => document.querySelectorAll('.panel').length > 1)
      let buffer: Buffer
      if (isCompare) {
        const statsPage = await page.$('.stats-page')
        if (!statsPage) {
          return new Response('Stats page not found', { status: 500 })
        }
        buffer = (await statsPage.screenshot({ type: 'png' })) as Buffer
      } else {
        const panel = await page.$('.panel')
        if (!panel) {
          return new Response('Panel not found', { status: 500 })
        }
        buffer = (await panel.screenshot({ type: 'png' })) as Buffer
      }

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Shared warm browser can die mid-request from an unrelated concurrent
      // page crash (single-process Chromium). Force a relaunch and retry once
      // before giving up.
      if (isBrowserDiedError(message) && attempt === 0) {
        forceRelaunch()
        continue
      }
      console.error('[Screenshot]', message)
      return new Response(`Screenshot error: ${message}`, { status: 500 })
    } finally {
      try {
        await page?.close()
      } catch {}
    }
  }
  return new Response('Screenshot error: browser unavailable after retry', { status: 500 })
}
