import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'

// Chromium's screenshot capture is backed by a single GPU texture with a hard
// max dimension (~16384 device px). At deviceScaleFactor=2 that's ~8192 CSS px
// tall - a single-column table of 50+ mutants blows past that and the capture
// comes back corrupted/looping (confirmed on a real 65-mutant run). Fix: cut
// the page into vertical strips that each stay comfortably under the limit,
// screenshot each strip separately (cuts snapped to row boundaries so no row
// is ever sliced in half), then compose the strips side by side into one
// wide-but-short image with sharp.
const SINGLE_SHOT_MAX_HEIGHT = 4000 // CSS px - below this, no splitting needed at all
const DATA_STRIP_HEIGHT = 1800 // CSS px per data column once we do split - smaller
// columns read better than 1-2 huge ones for a 60+ mutant run

export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin
  const renderUrl = `${origin}/rebalance`
  const targetDate = url.searchParams.get('date') // null/absent = вся история, как раньше

  let browser
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
      viewport: { width: 1000, height: 900 },
    })

    await page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    await Promise.all([
      page.waitForSelector('.rebalance-page', { timeout: 12000 }),
      page.evaluate(() => document.fonts.ready),
    ])

    // All mutant head images use loading="lazy" (site-wide convention). The
    // browser's native lazy-loader only fetches images near the current
    // *viewport* scroll position - with 60+ mutants the ones further down
    // the (much taller than the viewport) page never even start downloading.
    // Force-eager them before waiting, or nothing past roughly one
    // viewport's worth of rows ever loads (this is exactly what was
    // happening - images went blank starting partway through the list).
    await page.evaluate(() => {
      document.querySelectorAll('.rebalance-page img').forEach((img) => {
        ;(img as HTMLImageElement).loading = 'eager'
      })
    })

    await page
      .waitForFunction(
        () => {
          const imgs = Array.from(document.querySelectorAll('.rebalance-page img'))
          return imgs.length === 0 || imgs.every((i) => (i as HTMLImageElement).complete)
        },
        { timeout: 20000 },
      )
      .catch(() => {})

    await page.evaluate((targetDate: string | null) => {
      const runs = Array.from(document.querySelectorAll('.rebalance-page details.run'))
      if (targetDate) {
        // Один конкретный прогон: убираем остальные из кадра, раскрываем нужный.
        runs.forEach((el) => {
          const details = el as HTMLDetailsElement
          if (details.dataset.date === targetDate) {
            details.open = true
          } else {
            details.remove()
          }
        })
      } else {
        // Вся история (старое поведение) - раскрываем все прогоны.
        runs.forEach((el) => {
          ;(el as HTMLDetailsElement).open = true
        })
      }

      // Sticky header, футер и панель экспорта (выбор даты/кнопка) не должны
      // попадать в скачиваемую картинку. h1/.intro тоже скрываем ВЕЗДЕ (а не
      // только в первой колонке) - при мультиколоночном экспорте каждая
      // колонка рендерится отдельным полным скриншотом одного и того же
      // элемента, и чтобы они гарантированно совпадали по верхней границе
      // без всякой сложной математики смещений, все колонки должны начинаться
      // с ОДНОГО и того же блока (дата+счётчик, затем шапка таблицы).
      // Водяной знак внизу уже подписывает картинку, отдельный h1 не нужен.
      document.querySelectorAll('header, footer, .export-bar, h1, .intro').forEach((el) => {
        ;(el as HTMLElement).style.display = 'none'
      })
      // Astro's dev-mode toolbar (invisible in prod builds) can float over
      // the captured area during local testing.
      document.querySelector('astro-dev-toolbar')?.remove()

      const page = document.querySelector('.rebalance-page') as HTMLElement | null
      if (page) {
        page.style.maxWidth = 'none'
        page.style.padding = '1.5rem'
        page.style.background = '#0d1117'
      }

      const wm = document.createElement('div')
      wm.className = 'rb-watermark'
      wm.innerText = 'ARCHIVIST-LIBRARY.COM'
      Object.assign(wm.style, {
        textAlign: 'center',
        fontSize: '12px',
        color: '#637083',
        marginTop: '20px',
        paddingTop: '14px',
        borderTop: '1px solid #3a475a',
        fontWeight: '700',
        letterSpacing: '2px',
        fontFamily: 'sans-serif',
      })
      page?.appendChild(wm)
    }, targetDate)
    await page.waitForTimeout(100)

    const target = await page.$('.rebalance-page')
    if (!target) {
      return new Response('Rebalance page not found', { status: 500 })
    }

    const box = await target.boundingBox()
    if (!box) {
      return new Response('Rebalance page has no layout box', { status: 500 })
    }

    // Fast path: fits in one shot, no need to touch sharp at all.
    if (box.height <= SINGLE_SHOT_MAX_HEIGHT) {
      const buffer = (await target.screenshot({ type: 'png' })) as Buffer
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      })
    }

    // Splitting via clip+scroll produced a visible seam no matter how the
    // offsets were computed: two independent scrollTo+clip captures never
    // reliably land on the same device pixel. Instead: render the WHOLE
    // table N times, each time hiding every data row except the ones that
    // belong in that column, and take a normal elementHandle.screenshot()
    // (the same reliable full-element capture the fast path above already
    // uses). Every resulting image is "title + summary + header + its own
    // rows" from the exact same layout with the exact same origin, so
    // stacking them left to right at top:0 needs no offset math at all -
    // alignment is guaranteed by construction, not computed.
    const dataRowOffsets = (await page.evaluate((pageTop: number) => {
      const rows = Array.from(document.querySelectorAll('.rebalance-page .rb-row:not(.rb-head)'))
      return rows.map((r) => r.getBoundingClientRect().top - pageTop)
    }, box.y)) as number[]

    // First pass: figure out how many columns are actually needed, greedily
    // cutting whenever the next row would push a column past the height
    // budget.
    let chunkIndex = 0
    let chunkStart = dataRowOffsets.length > 0 ? dataRowOffsets[0] : 0
    for (const offset of dataRowOffsets) {
      if (offset - chunkStart > DATA_STRIP_HEIGHT) {
        chunkIndex++
        chunkStart = offset
      }
    }
    const numChunks = chunkIndex + 1

    // Second pass: with that column COUNT fixed, spread rows evenly by
    // index instead of greedily filling each column to the budget. Greedy
    // filling left a near-empty trailing column whenever the last chunk of
    // rows didn't happen to add up to a full budget - a short last column
    // whose bottom edge didn't line up with the others. Row heights are
    // fairly uniform, so an even row-count split gives an even bottom edge.
    const rowsPerChunk = Math.ceil(dataRowOffsets.length / numChunks) || 1
    const rowChunk = dataRowOffsets.map((_, idx) =>
      Math.min(numChunks - 1, Math.floor(idx / rowsPerChunk)),
    )

    const lastChunk = numChunks - 1
    const stripBuffers: Buffer[] = []
    for (let i = 0; i < numChunks; i++) {
      await page.evaluate(
        (args: { assignment: number[]; current: number; lastChunk: number }) => {
          const rows = Array.from(
            document.querySelectorAll('.rebalance-page .rb-row:not(.rb-head)'),
          ) as HTMLElement[]
          for (let idx = 0; idx < rows.length; idx++) {
            rows[idx].style.display = args.assignment[idx] === args.current ? '' : 'none'
          }
          const watermark = document.querySelector('.rb-watermark') as HTMLElement | null
          if (watermark) {
            watermark.style.display = args.current === args.lastChunk ? '' : 'none'
          }
        },
        { assignment: rowChunk, current: i, lastChunk },
      )
      stripBuffers.push((await target.screenshot({ type: 'png' })) as Buffer)
    }

    // Each capture is the WHOLE .rebalance-page element, including its own
    // 1.5rem (24 CSS px / 48 device px at deviceScaleFactor=2) padding on
    // both sides. Placed edge to edge, two "flush" columns actually carried
    // a right-padding + left-padding gap between them. Trim the padding off
    // every INNER edge (keep it on the outer left/right of the whole
    // composite) so columns touch with zero space.
    const pagePaddingDevicePx = Math.round(24 * 2)
    const metas = await Promise.all(stripBuffers.map((b) => sharp(b).metadata()))
    const trimmedBuffers = await Promise.all(
      stripBuffers.map((buf, i) => {
        const w = metas[i].width || 0
        const h = metas[i].height || 0
        const trimLeft = i === 0 ? 0 : pagePaddingDevicePx
        const trimRight = i === stripBuffers.length - 1 ? 0 : pagePaddingDevicePx
        return sharp(buf)
          .extract({ left: trimLeft, top: 0, width: w - trimLeft - trimRight, height: h })
          .toBuffer()
      }),
    )
    const trimmedMetas = await Promise.all(trimmedBuffers.map((b) => sharp(b).metadata()))
    const heights = trimmedMetas.map((m) => m.height || 0)
    const widths = trimmedMetas.map((m) => m.width || 0)
    const totalWidth = widths.reduce((sum, w) => sum + w, 0)
    const totalHeight = Math.max(...heights)

    let left = 0
    const composites = trimmedBuffers.map((buf, i) => {
      const entry = { input: buf, left, top: 0 }
      left += widths[i]
      return entry
    })

    const finalBuffer = await sharp({
      create: {
        width: totalWidth,
        height: totalHeight,
        channels: 3,
        background: { r: 13, g: 17, b: 23 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer()

    return new Response(new Uint8Array(finalBuffer), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Screenshot Rebalance]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
