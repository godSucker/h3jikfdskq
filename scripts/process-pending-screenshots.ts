// Разбирает очередь scripts/pending-screenshots.json (см. pending-
// screenshots.ts) и шлёт скриншоты новых анонсов в личный админ-чат.
// Запускается отдельным workflow (.github/workflows/admin-screenshot-bot.yml)
// каждые 5 минут - НЕ внутри build-announcements.ts, чтобы не спать/жечь
// минуты CI одного прогона в ожидании Vercel-редеплоя. См. память
// auto-announcements-architecture.md ("бот-скриншотер в админ-чат").
import fs from 'fs/promises'
import { QUEUE_PATH, type PendingScreenshotJob } from './pending-screenshots'
import {
  sendAdminPhoto,
  sendAdminMediaGroup,
  sendAdminText,
  type AdminPhoto,
} from './telegram-admin-bot'

const SITE = 'https://archivist-library.com'
const MIN_AGE_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 6 // при 5-мин cron и MIN_AGE_MS=5мин - до ~30 мин жизни задачи

const CATEGORY_ICON: Record<string, string> = {
  mutant: '🧬',
  skin: '🎨',
  bingo: '🎲',
  box: '📦',
  raid: '⚔️',
  ladder: '🪜',
  token: '🪙',
  reactor: '🎰',
  shopForecast: '🛒',
  dailyNews: '📰',
}

const CATEGORY_LINK: Record<string, string> = {
  mutant: '/mutants',
  box: '/boxes',
  raid: '/guides',
  ladder: '/guides',
  bingo: '/bingo',
  reactor: '/simulators/reactor',
  token: '/materials',
  shopForecast: '/announcements',
  dailyNews: '/announcements',
}

// mutant - ТОЛЬКО содержимое (модалка), без карточки анонса вообще: модалка
// мутанта несёт полную статкарту, карточка анонса - только имя+иконку,
// избыточна рядом с модалкой. box ТОЖЕ обсуждался (юзер просил убрать
// карточку и там), но решение отложено ("надо обдумать") - box пока
// остаётся в старой ветке ниже (карточка анонса + до 4 фото содержимого),
// не трогать без отдельного разговора.
const CONTENT_ONLY_CATEGORIES = new Set(['mutant'])

function contentUrlFor(category: string, itemId: string): string {
  if (category === 'box') return `${SITE}/api/screenshot-box?itemId=${encodeURIComponent(itemId)}`
  if (category === 'mutant') return `${SITE}/api/screenshot-mutant?id=${encodeURIComponent(itemId)}`
  return `${SITE}/api/screenshot-dungeon?id=${encodeURIComponent(itemId)}`
}

async function loadQueue(): Promise<PendingScreenshotJob[]> {
  try {
    return JSON.parse(await fs.readFile(QUEUE_PATH, 'utf-8'))
  } catch {
    return []
  }
}

async function saveQueue(queue: PendingScreenshotJob[]): Promise<void> {
  await fs.writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf-8')
}

type FetchResult = { ok: true; buffer: Buffer } | { ok: false }

// 404 у screenshot-*.ts - это буквально "контент ещё не отрендерился на
// проде" (карточка/бокс/данж не найдены на живой странице - деплой ещё не
// доехал), 500 - реальная поломка эндпоинта. Оба трактуем одинаково
// (повторить позже, до MAX_ATTEMPTS) - различать их поведением тут незачем,
// разница видна в логе Vercel, если понадобится расследовать.
async function fetchPhoto(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return { ok: false }
    return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) }
  } catch {
    return { ok: false }
  }
}

async function attemptDeliver(job: PendingScreenshotJob): Promise<'sent' | 'retry'> {
  const icon = CATEGORY_ICON[job.category] ?? '🔔'
  const link = CATEGORY_LINK[job.category] ?? '/announcements'
  const caption = `${icon} ${job.title}\n\n${SITE}${link}`

  if (job.category === 'bingo') {
    const primary = await fetchPhoto(
      `${SITE}/api/screenshot-bingo?board=${encodeURIComponent(job.itemIds[0])}`,
    )
    if (!primary.ok) return 'retry'
    return (await sendAdminPhoto(primary.buffer, caption, `bingo-${job.id}.png`)) ? 'sent' : 'retry'
  }

  if (CONTENT_ONLY_CATEGORIES.has(job.category)) {
    // Никакой карточки анонса вообще - только модалка/содержимое (см.
    // комментарий у CONTENT_ONLY_CATEGORIES выше). Капаем на 4 - альбом
    // Telegram допускает 2-10 элементов.
    const cappedIds = job.itemIds.slice(0, 4)
    const results = await Promise.all(
      cappedIds.map((itemId) => fetchPhoto(contentUrlFor(job.category, itemId))),
    )
    const buffers = results
      .map((r, i) => (r.ok ? { buffer: r.buffer, itemId: cappedIds[i] } : null))
      .filter((x): x is { buffer: Buffer; itemId: string } => x !== null)

    // Ничего не готово - ждём следующий тик (нет "карточки анонса" как
    // резервного фолбэка у этих категорий - если содержимое не готово,
    // отправлять просто нечего).
    if (buffers.length === 0) return 'retry'

    const photos: AdminPhoto[] = buffers.map((b) => ({
      buffer: b.buffer,
      filename: `${job.category}-content-${b.itemId}.png`,
    }))
    if (photos.length === 1) {
      return (await sendAdminPhoto(photos[0].buffer, caption, photos[0].filename))
        ? 'sent'
        : 'retry'
    }
    return (await sendAdminMediaGroup(photos, caption)) ? 'sent' : 'retry'
  }

  // Все остальные категории имеют карточку на /announcements/render/[id] -
  // тот же скриншот, что уже умеет отдавать api/screenshot-announcement.ts.
  const primary = await fetchPhoto(
    `${SITE}/api/screenshot-announcement?id=${encodeURIComponent(job.id)}`,
  )
  if (!primary.ok) return 'retry'

  const needsContent =
    job.category === 'box' || job.category === 'raid' || job.category === 'ladder'
  if (!needsContent) {
    return (await sendAdminPhoto(primary.buffer, caption, `${job.category}-${job.id}.png`))
      ? 'sent'
      : 'retry'
  }

  // Капаем на 4 - альбом Telegram допускает 2-10 элементов, 1 карточка + 4
  // содержимого держит пост читаемым даже когда за один часовой прогон
  // нашлось сразу несколько новых рейдов/лесенок.
  const cappedIds = job.itemIds.slice(0, 4)
  const contentResults = await Promise.all(
    cappedIds.map((itemId) => fetchPhoto(contentUrlFor(job.category, itemId))),
  )
  const contentBuffers = contentResults
    .map((r, i) => (r.ok ? { buffer: r.buffer, itemId: cappedIds[i] } : null))
    .filter((x): x is { buffer: Buffer; itemId: string } => x !== null)

  // Контент ещё не готов (0 из ожидаемых) - ждём следующий тик, ЕСЛИ ещё
  // остался запас попыток. На последней попытке шлём что есть (пусть даже
  // только карточку анонса) - лучше неполный альбом, чем анонс без фото
  // вообще из-за одного упрямого содержимого.
  const isLastAttempt = job.attempts >= MAX_ATTEMPTS - 1
  if (contentBuffers.length === 0 && cappedIds.length > 0 && !isLastAttempt) {
    return 'retry'
  }

  const photos: AdminPhoto[] = [
    { buffer: primary.buffer, filename: `${job.category}-${job.id}.png` },
    ...contentBuffers.map((c) => ({
      buffer: c.buffer,
      filename: `${job.category}-content-${c.itemId}.png`,
    })),
  ]
  if (photos.length === 1) {
    return (await sendAdminPhoto(photos[0].buffer, caption, photos[0].filename)) ? 'sent' : 'retry'
  }
  return (await sendAdminMediaGroup(photos, caption)) ? 'sent' : 'retry'
}

async function main() {
  const queue = await loadQueue()
  if (queue.length === 0) {
    console.log('[ADMIN-BOT] Очередь пуста')
    return
  }

  const now = Date.now()
  const remaining: PendingScreenshotJob[] = []
  let changed = false
  let sent = 0

  for (const job of queue) {
    const age = now - new Date(job.createdAt).getTime()
    if (age < MIN_AGE_MS) {
      remaining.push(job)
      continue
    }

    const result = await attemptDeliver(job)
    changed = true
    if (result === 'sent') {
      sent++
      continue
    }

    job.attempts++
    if (job.attempts >= MAX_ATTEMPTS) {
      await sendAdminText(
        `⚠️ Не удалось получить скриншот для «${job.title}» после ${job.attempts} попыток — анонс уже опубликован на сайте, скриншот пропущен.`,
      )
      continue
    }
    remaining.push(job)
  }

  if (changed) {
    await saveQueue(remaining)
    console.log(`[ADMIN-BOT] Отправлено: ${sent}, осталось в очереди: ${remaining.length}`)
  } else {
    console.log(`[ADMIN-BOT] Все ${queue.length} задач(и) моложе 5 минут, ждём следующий тик`)
  }
}

main().catch((err) => {
  console.error('[ADMIN-BOT] Упал:', err)
  process.exit(1)
})
