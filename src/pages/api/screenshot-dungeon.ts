import type { APIRoute } from 'astro'
import { withPage } from '@/lib/headless-browser'

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

  try {
    return await withPage({ width: 700, height: 700 }, async (page) => {
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

      // Липкая шапка сайта и фиксированные панели (нижняя плавающая) не должны
      // попасть в кадр: у длинных карточек (рейд на 300 этажей, ~1200px при
      // viewport 700px) element.screenshot прокручивает карточку под шапку, и та
      // закрывает арт. Те же приёмы - в screenshot-rebalance.ts.
      await page.evaluate((sel) => {
        const card = document.querySelector(sel)
        document.querySelectorAll('header, footer').forEach((el) => {
          ;(el as HTMLElement).style.display = 'none'
        })
        document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
          if (card && (card === el || card.contains(el))) return
          const pos = getComputedStyle(el).position
          if (pos === 'fixed' || pos === 'sticky') el.style.display = 'none'
        })
      }, selector)

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
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot-Dungeon]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  }
}
