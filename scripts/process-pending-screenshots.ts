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
  skin: '/mutants',
  box: '/boxes',
  raid: '/guides',
  ladder: '/guides',
  bingo: '/bingo',
  reactor: '/simulators/reactor',
  token: '/materials',
  shopForecast: '/announcements',
  dailyNews: '/announcements',
}

// mutant/skin - ТОЛЬКО содержимое (модалка), без карточки анонса вообще:
// модалка несёт полную статкарту + плашку даты (?date=), карточка анонса -
// только имя+иконку, избыточна рядом с модалкой.
// box - один скрин с карточки анонса (/announcements/render/[id]): дизайн
// там подтянут 1-в-1 к /boxes + добавлена плашка даты, отдельный скрин
// модалки /boxes больше не шлём (решение юзера 2026-09-05).
const CONTENT_ONLY_CATEGORIES = new Set(['mutant', 'skin'])

function contentUrlFor(category: string, itemId: string, date?: string): string {
  const dateParam = date ? `&date=${encodeURIComponent(date)}` : ''
  if (category === 'mutant')
    return `${SITE}/api/screenshot-mutant?id=${encodeURIComponent(itemId)}${dateParam}`
  if (category === 'skin')
    return `${SITE}/api/screenshot-skin?id=${encodeURIComponent(itemId)}${dateParam}`
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
    // 100с, не 30: скриншот-эндпоинты на ХОЛОДНОМ @sparticuz/chromium
    // (первый вызов после редеплоя/простоя) реально отвечают 60-90с - на
    // живом прогоне bingo/token отдавали 62-65с и не укладывались в 30с ->
    // задачи вечно висели в ретрае (фидбек 2026-09-05). Тёплый контейнер -
    // 8-12с, кап нужен только для реально зависшего вызова.
    const res = await fetch(url, { signal: AbortSignal.timeout(100_000) })
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
    // ПОСЛЕДОВАТЕЛЬНО, не Promise.all: каждый скрин модалки поднимает свой
    // headless-Chromium на проде, два-три параллельно на одном тёплом
    // Vercel-контейнере упираются в ERR_INSUFFICIENT_RESOURCES и оба падают
    // (анонс "Новые мутанты: 2" клал очередь в ретрай навсегда, фидбек
    // 2026-09-05). Медленнее, зато надёжно.
    const cappedIds = job.itemIds.slice(0, 4)
    const buffers: { buffer: Buffer; itemId: string }[] = []
    for (const itemId of cappedIds) {
      const r = await fetchPhoto(contentUrlFor(job.category, itemId, job.date))
      if (r.ok) buffers.push({ buffer: r.buffer, itemId })
    }

    // Готово НЕ всё содержимое (напр. один из двух скринов модалки упал на
    // холодном старте) - ретраим целиком на следующем тике, ПОКА есть запас
    // попыток. Иначе бот слал бы неполный альбом ("Новые мутанты: 2", а фото
    // одно - фидбек 2026-09-05). На последней попытке шлём что есть - лучше
    // неполно, чем никак.
    const isLastAttempt = job.attempts >= MAX_ATTEMPTS - 1
    if (buffers.length < cappedIds.length && !isLastAttempt) return 'retry'
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

  // Все остальные категории (box/raid/ladder/reactor/token/shopForecast/
  // dailyNews) шлют ОДИН скрин карточки с /announcements/render/[id]:
  // - box: карточка несёт полный дизайн /boxes + дату (юзер, 2026-09-05);
  // - raid/ladder: карточка уже расписывает данж (имя/мутант/бои/награды/
  //   валюта), отдельный скрин из /guides был дублем (юзер, 2026-09-05);
  // - reactor/token/forecast: у них и так одна карточка.
  // screenshot-dungeon.ts / screenshot-box.ts остаются рабочими, просто не
  // зовутся отсюда.
  const primary = await fetchPhoto(
    `${SITE}/api/screenshot-announcement?id=${encodeURIComponent(job.id)}`,
  )
  if (!primary.ok) return 'retry'
  return (await sendAdminPhoto(primary.buffer, caption, `${job.category}-${job.id}.png`))
    ? 'sent'
    : 'retry'
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
