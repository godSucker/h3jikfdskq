// Локальный рендер постеров рейдов/лесенок/ивент-лесенок (/dungeon-poster) в PNG.
// Запуск: npm run dev (порт 4399), затем
//   npx tsx scripts/render-dungeon-posters.ts --out ~/dungeon-posters abyss ...
//   npx tsx scripts/render-dungeon-posters.ts --out ~/dungeon-posters --all
// Вывод кладём ВНЕ репозитория (репо публичный, PNG тяжёлые) и на CDN не льём.
// Комментарии без длинного тире: tsx спотыкается на нём (Gotchas в CLAUDE.md).
//
// Масштаб: Telegram хранит фото с длинной стороной не больше 2560px (режим HD),
// поэтому постер рендерится так, чтобы длинная сторона была ровно 2560px - выше
// смысла нет, ниже теряется резкость. Постеры выше 2560 css-px (боксы на 100+
// вариантов) в фото не влезают, их помечаем как document (слать файлом).
// Масштаб задаётся контекстом браузера (deviceScaleFactor), а не через CDP:
// подмена метрик через CDP element.screenshot() не масштабирует.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { chromium, type BrowserContext } from 'playwright-core'

const BASE = process.env.POSTER_BASE ?? 'http://localhost:4399'
const CDN = 'https://cdn.archivist-library.com'
const PUBLIC_DIR = path.join(process.cwd(), 'public')
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
const POSTER_W = 1700
const TG_PHOTO_MAX_SIDE = 2560
const MAX_SCALE = 3
const DOC_SCALE_MAX = 2

const args = process.argv.slice(2)
let outDir = path.join(os.homedir(), 'dungeon-posters')
let all = false
const ids: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = args[++i].replace(/^~/, os.homedir())
  else if (args[i] === '--all') all = true
  else ids.push(args[i])
}

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

// Картинки с CDN берём из локального public/, если файл там есть, иначе
// идут в сеть. Так рендер быстрее и не зависит от доступности CDN.
async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, scale: number) {
  const context = await browser.newContext({
    viewport: { width: POSTER_W, height: 1200 },
    deviceScaleFactor: scale,
  })
  await context.route(`${CDN}/**`, async (route) => {
    const url = new URL(route.request().url())
    const local = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname))
    if (local.startsWith(PUBLIC_DIR)) {
      try {
        const body = await fs.readFile(local)
        return route.fulfill({
          status: 200,
          body,
          contentType: MIME[path.extname(local).toLowerCase()] ?? 'application/octet-stream',
        })
      } catch {
        // нет локального файла - в сеть
      }
    }
    return route.continue()
  })
  return context
}

async function openPoster(context: BrowserContext, id: string) {
  const page = await context.newPage()
  await page.goto(`${BASE}/dungeon-poster?id=${encodeURIComponent(id)}`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  })
  await page.waitForSelector('.poster[data-dungeon-id]', { timeout: 15_000 })
  // Плавающая панель Astro dev-toolbar попадает в кадр на dev-сервере.
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important }' })
  await page.evaluate(() => document.fonts.ready)

  const fontOk = await page.evaluate(() => document.fonts.check('700 16px "TT Supermolot Neue"'))
  if (!fontOk) throw new Error('шрифт TT Supermolot Neue не загрузился')

  const broken = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.poster img'))
      .filter((i) => {
        const img = i as HTMLImageElement
        return !img.complete || img.naturalWidth === 0
      })
      .map((i) => (i as HTMLImageElement).src),
  )
  if (broken.length) throw new Error(`битые картинки (${broken.length}): ${broken.slice(0, 3).join(' , ')}`)
  return page
}

function pickScale(height: number): { scale: number; asDocument: boolean } {
  const longSide = Math.max(POSTER_W, height)
  if (longSide <= TG_PHOTO_MAX_SIDE) {
    const scale = Math.floor(Math.min(MAX_SCALE, TG_PHOTO_MAX_SIDE / longSide) * 100) / 100
    return { scale, asDocument: false }
  }
  // Не влезает в фото: рендерим в x2 (или меньше, если упираемся в w+h 10000) и шлём файлом.
  const scale = Math.floor(Math.min(DOC_SCALE_MAX, 9900 / (POSTER_W + height)) * 100) / 100
  return { scale, asDocument: true }
}

async function main() {
  const details = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'src/data/guides/dungeon-details.json'), 'utf-8'),
  ) as { dungeons: Record<string, unknown>; events: Record<string, unknown> }
  const targets = all ? [...Object.keys(details.dungeons), ...Object.keys(details.events)] : ids
  if (targets.length === 0) throw new Error('Нет id: укажите их или --all')
  await fs.mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  const measureCtx = await newContext(browser, 1)
  const scaleCtx = new Map<number, BrowserContext>()

  const manifest: Record<string, { width: number; height: number; scale: number; document: boolean }> = {}
  const failed: string[] = []
  let done = 0
  for (const id of targets) {
    try {
      // Проход 1: узнаём высоту постера в css-пикселях.
      const mPage = await openPoster(measureCtx, id)
      const bb1 = await (await mPage.$('.poster'))!.boundingBox()
      await mPage.close()
      if (!bb1) throw new Error('нет bounding box у .poster')

      const { scale, asDocument } = pickScale(bb1.height)
      let ctx = scaleCtx.get(scale)
      if (!ctx) {
        ctx = await newContext(browser, scale)
        scaleCtx.set(scale, ctx)
      }

      // Проход 2: настоящий рендер в нужном масштабе.
      const page = await openPoster(ctx, id)
      const poster = await page.$('.poster')
      const file = path.join(outDir, `${id}.png`)
      await poster!.screenshot({ path: file, type: 'png' })
      await page.close()

      const hdr = (await fs.readFile(file)).subarray(16, 24)
      const outW = hdr.readUInt32BE(0)
      const outH = hdr.readUInt32BE(4)
      if (Math.abs(outW - Math.round(POSTER_W * scale)) > 2)
        throw new Error(`размер ${outW}x${outH} не соответствует масштабу ${scale}`)
      manifest[id] = { width: outW, height: outH, scale, document: asDocument }
      done++
      console.log(
        `ok  ${id}  ${Math.round(bb1.width)}x${Math.round(bb1.height)} @${scale}x -> ${outW}x${outH}${asDocument ? ' [file]' : ''}`,
      )
    } catch (e) {
      failed.push(id)
      console.error(`ERR ${id}: ${e instanceof Error ? e.message : e}`)
    }
  }
  await browser.close()
  await fs.writeFile(path.join(outDir, '..', 'dungeon-posters-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nготово: ${done}/${targets.length}, ошибок: ${failed.length}${failed.length ? ' -> ' + failed.join(', ') : ''}`)
  if (failed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
