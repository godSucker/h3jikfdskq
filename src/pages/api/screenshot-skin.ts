import type { APIRoute } from 'astro'
import { chromium } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'
import { ruDate, freezePageForModalShot, injectDateBadge } from '@/lib/screenshot-date-badge'

// Скриншот модалки ОДНОГО скина (MutantModal.svelte с предвыбранным вариантом
// скина) для бот-скриншотера в админ-чат. Снимаем НЕ с живой /mutants
// (грид на сотни lazy-картинок + backdrop-filter оверлея не дают headless-
// Chromium дождаться "element stable" на холодном serverless - перепробовано
// animations:disabled / page.screenshot clip / заморозка фона), а с
// изолированной /mutants/skin-render/[id] - там MutantsBrowser рендерит ровно
// один мутант, всё лишнее скрыто CSS'ом. Диплинк /mutants?mutant=&skin= для
// людей (шаринг) остаётся, эндпоинт им просто не пользуется.
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
  // mutants.json хранит id в lowercase (skins.json - в CamelCase), а
  // MutantsBrowser резолвит ?mutant= против каталога мутантов -> нижний
  // регистр. skinKey как есть (matcher initialSkin регистр не учитывает).
  const baseId = raw.slice(0, sep).toLowerCase()
  const skinKey = raw.slice(sep + 1)
  const dateLabel = ruDate(url.searchParams.get('date') ?? '')

  // Хардкод хоста, не url.origin: см. комментарий в screenshot.ts (SSRF через
  // Host). ?mutant=&skin= в query - их читает MutantsBrowser::tryOpenFromUrl
  // на самой render-странице (путь /[id] только для резолва данных в
  // frontmatter).
  const pageUrl =
    `https://archivist-library.com/mutants/skin-render/${encodeURIComponent(raw)}` +
    `?mutant=${encodeURIComponent(baseId)}&skin=${encodeURIComponent(skinKey)}`

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

    // aria-labelledby, не .modal-2k (Tailwind-класс) - устойчивее к правкам
    // вёрстки, id="mutant-title" уникален на странице только внутри модалки.
    // Таймаут 25с (у screenshot-mutant хватает 12с): у скина лишний шаг -
    // модалка открывается на базовом мутанте, затем $effect initialSkin
    // подхватывает вариант; на холодном serverless-Chromium это заметно
    // дольше.
    const selector = '[role="dialog"][aria-labelledby="mutant-title"]'
    await Promise.all([
      page.waitForSelector(selector, { timeout: 25000, state: 'visible' }),
      page.evaluate(() => document.fonts.ready),
    ])

    // Явно тянем кастомный шрифт - см. комментарий в screenshot-mutant.ts.
    await page
      .evaluate(async () => {
        await Promise.all([
          document.fonts.load('700 16px "TT Supermolot Neue"'),
          document.fonts.load('400 16px "TT Supermolot Neue"'),
        ])
        await document.fonts.ready
      })
      .catch(() => {})

    // Скин выбирается реактивно в MutantModal (initialSkin -> $effect). Заголовок
    // модалки при выбранном скине - "<Имя> — <Имя скина>". Ждём появления " — "
    // как сигнала, что вариант применился, прежде чем ждать картинки (иначе
    // можем снять базового мутанта). Не критично при таймауте - скин мог
    // просто не найтись, тогда снимем базового (лучше, чем 500).
    await page
      .waitForFunction(
        (sel) =>
          (document.querySelector(`${sel} #mutant-title`)?.textContent ?? '').includes(' — '),
        selector,
        { timeout: 8000 },
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
    await freezePageForModalShot(page, selector)

    await page.waitForTimeout(400)

    const dialog = await page.$(selector)
    if (!dialog) {
      // Скин/мутант не найден на живом проде (данные ещё не задеплоились) -
      // процессор очереди трактует 404 как "повторить позже".
      return new Response('Skin not found', { status: 404 })
    }
    // animations:'disabled' - см. комментарий в screenshot-mutant.ts (инъекция
    // плашки даты ломала ожидание "element stable").
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
    console.error('[Screenshot-Skin]', message)
    return new Response(`Screenshot error: ${message}`, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
