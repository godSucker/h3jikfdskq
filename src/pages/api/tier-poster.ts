import type { APIRoute } from 'astro'
import type { Page } from 'playwright-core'
import { getBrowser, forceRelaunch, isBrowserDiedError } from '@/lib/headless-browser'
import { LOCALES } from '@/lib/i18n-locales'

export const GET: APIRoute = async ({ url }) => {
  const stateParam = url.searchParams.get('state')
  if (!stateParam) {
    return new Response('Missing state param', { status: 400 })
  }

  // Whitelist-валидация, не passthrough - это попадает прямо в URL, который
  // наш же headless-браузер открывает (см. тот же приём в api/screenshot.ts).
  const localeParam = url.searchParams.get('locale')
  const locale = (LOCALES as readonly string[]).includes(localeParam ?? '') ? localeParam : 'ru'

  const origin = url.origin
  const renderUrl = `${origin}/tier-poster-render?state=${encodeURIComponent(stateParam)}&locale=${locale}`

  for (let attempt = 0; attempt < 2; attempt++) {
    let page: Page | undefined
    try {
      const browser = await getBrowser()
      page = await browser.newPage()
      await page.setViewportSize({ width: 1140, height: 800 })

      // Превью-деплои закрыты Vercel SSO Protection - без bypass-заголовка
      // headless-браузер попадает на стену авторизации вместо /tier-poster-render
      // и .poster никогда не появляется (см. TierPoster timeout в логах).
      const bypassSecret = import.meta.env.VERCEL_AUTOMATION_BYPASS_SECRET
      if (bypassSecret) {
        await page.setExtraHTTPHeaders({
          'x-vercel-protection-bypass': bypassSecret,
          'x-vercel-set-bypass-cookie': 'true',
        })
      }

      await page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await Promise.all([
        page.waitForSelector('.poster', { timeout: 12000 }),
        page.evaluate(() => document.fonts.ready),
      ])
      // Up to ~556 mutant icons in one poster (tier-table.json is currently
      // fully tiered), all fetched in parallel - on a cold CDN edge that
      // routinely didn't finish inside the old 8s budget, and the silent
      // .catch() meant the screenshot was taken anyway with whichever icons
      // hadn't loaded yet rendering blank. 25s covers a cold burst at this
      // volume (stats-panel's screenshot.ts stays at 5s - it's ~10-20 images,
      // a different scale entirely); the warn below at least surfaces it in
      // logs if some request still doesn't make it, instead of failing silent.
      const openPage = page
      const incompleteImageCount = await openPage
        .waitForFunction(
          () => {
            const imgs = Array.from(document.querySelectorAll('.poster img'))
            return imgs.length === 0 || imgs.every((i) => (i as HTMLImageElement).complete)
          },
          { timeout: 25000 },
        )
        .then(() => 0)
        .catch(() =>
          openPage.evaluate(
            () =>
              Array.from(document.querySelectorAll('.poster img')).filter(
                (i) => !(i as HTMLImageElement).complete,
              ).length,
          ),
        )
      if (incompleteImageCount > 0) {
        console.warn(
          `[TierPoster] ${incompleteImageCount} icon(s) still loading after wait - poster will show them blank`,
        )
      }
      await page.waitForTimeout(100)

      const poster = await page.$('.poster')
      if (!poster) {
        return new Response('Poster not found', { status: 500 })
      }
      const buffer = (await poster.screenshot({ type: 'png' })) as Buffer

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="tier-poster.png"',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isBrowserDiedError(message) && attempt === 0) {
        forceRelaunch()
        continue
      }
      console.error('[TierPoster]', message)
      return new Response(`Tier poster error: ${message}`, { status: 500 })
    } finally {
      try {
        await page?.close()
      } catch {}
    }
  }
  return new Response('Tier poster error: browser unavailable after retry', { status: 500 })
}
