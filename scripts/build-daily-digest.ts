// Ежедневный дайджест обновлений в публичный Telegram-канал - заменяет
// поштучный кросс-пост (удалён, см. комментарий в build-announcements.ts).
// Один пост в день, картинками, не текстом - через /api/screenshot-announcement
// (тот же AnnouncementCard.astro, что живая лента), дайджест просто собирает
// готовые картинки в один Telegram-альбом, вместо того чтобы изобретать второй
// текстовый формат (юзер 2026-11-22: "чисто текстом полная хуйня, нужен
// именно визуал - по сути большинство уже есть же").
//
// Область (юзер 2026-11-25, после фидбека Жени): ТОЛЬКО 'todayShop' (срез
// сегодняшних офферов шопа) + pvp + evoDiscount + madnessDiscount. Раньше
// сюда же шли mutant/skin/token/bingo/box/exchange/reactor/raid/ladder/
// eventLadder/eventQuests - убраны целиком: mutant/skin и так уже в
// announcements.json и на /announcements, а бинго-скрин дублировал ту же
// карточку мутанта ВНУТРИ одного поста (Женя: "скрины бинго в целом лишнее").
//
// Источник - announcements.json (поле date = когда пайплайн увидел запись,
// это уже и есть "сегодня" в нужном смысле). Ничего не детектит заново -
// чистая агрегация того, что часовые детекторы и так насобирали за день.
// rebalance никогда не попадает (человек ведёт вручную, как и раньше).
//
// Тайминг: часовой воркфлоу ходит 10:00-15:00 МСК - этот скрипт гоняется на
// КАЖДОМ прогоне, но реально отправляет только на прогоне, где МСК-час >= 15
// (последний в окне), и только один раз за календарный МСК-день (маркер
// scripts/digest-last-sent.json). Если именно этот прогон упадёт/пропустится
// платформой - дайджест за день теряется без дожима на завтра (та же
// философия, что у остальных необогащающих шагов пайплайна - не критический
// путь). --dry-run печатает, что было бы отправлено, не шлёт и не трогает
// маркер - для ручной проверки формата перед первым боевым включением.
import fs from 'node:fs/promises'
import path from 'node:path'
import { runMain } from './lib/run-main'
import { selectTodayShopItems, shopOfferSpecimenId } from '../src/lib/today-shop-items'

const ROOT = process.cwd()
// DIGEST_SITE_ORIGIN - только для ручных тестов вне CI: archivist-library.com
// идёт через гео-сплит-DNS на relay, недоступный из некоторых песочниц/сетей,
// тот же деплой на *.vercel.app отвечает напрямую. В реальном воркфлоу не
// задаётся - там всегда прод-домен.
const SITE_ORIGIN = process.env.DIGEST_SITE_ORIGIN ?? 'https://archivist-library.com'
const MARKER_PATH = path.join(ROOT, 'scripts/digest-last-sent.json')
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const MAX_ALBUM_SIZE = 10
const SEND_AT_MSK_HOUR = 15

interface AnnouncementItemLike {
  id: string
  name?: string
  exactDateStart?: string | null
  pvpRewardTiers?: { tier: number; items: { amount: number; id: string }[] }[]
}
interface AnnouncementLike {
  id: string
  date: string
  category: string
  title: string
  items: AnnouncementItemLike[]
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

const mskDate = (d: Date) => new Date(d.getTime() + MSK_OFFSET_MS)
const mskDateKey = (d: Date) => mskDate(d).toISOString().slice(0, 10)
const mskHour = (d: Date) => mskDate(d).getUTCHours()

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
const ruDateLabel = (d: Date) => {
  const m = mskDate(d)
  return `${m.getUTCDate()} ${RU_MONTHS[m.getUTCMonth()]}`
}

// Порядок карточек в альбоме - todayShop первым (Женя 2026-11-25: "последний
// скрин в посте по сути должен быть первым" - раньше был последним).
const CATEGORY_ORDER = ['todayShop', 'pvp', 'evoDiscount', 'madnessDiscount']
const CATEGORY_ICON: Record<string, string> = {
  pvp: '🥊',
  evoDiscount: '🧪',
  madnessDiscount: '🎡',
  todayShop: '🛒',
}
const CATEGORY_LABEL: Record<string, string> = {
  pvp: 'ПвП',
  evoDiscount: 'Скидка на эво',
  madnessDiscount: 'Скидка на рулетку',
  todayShop: 'Сегодня в магазине',
}
// Хэштег на категорию, виден в подписи внизу поста - для поиска по каналу
// (юзер 2026-11-23, по образцу его же канала mutants_mgg_fb: там один тег на
// пост; у нас один пост = много категорий, поэтому список тегов, не один).
const CATEGORY_HASHTAG: Record<string, string> = {
  pvp: '#MGGPvP',
  evoDiscount: '#MGGdiscount',
  madnessDiscount: '#MGGdiscount',
  todayShop: '#MGGshop',
}

// --- Вердикт-движок подписи (юзер 2026-11-23, брейншторм по образцу его
// собственного канала mutants_mgg_fb - он там админ, вердикты - его реальные
// игровые правила, не придуманные):
// т1/т2 - берём 100%; т3 - "подойдёт новичкам, но слабее остальных"; т4 или
// тира на сайте нет - неиграбелен, не берём; плюс отдельно - "кроет
// плав/кузню" (мутант нужен для Златокузни/Золотоплавильни, см.
// computeGoldCoverage - порт того же алгоритма, что уже считает это на
// /bingo, BingoPage.astro::getBingoLayout/goldSources).
interface MutantLite {
  name: string
  tier: string | null
}
let mutantsById: Map<string, MutantLite> = new Map()
let goldCoverage: Set<string> = new Set()
let boxIds: Set<string> = new Set()

async function loadVerdictData(): Promise<void> {
  const mutants = await readJson<{ id: string; name: string; tier?: string | null }[]>(
    'src/data/mutants/mutants.json',
    [],
  )
  mutantsById = new Map(
    mutants.map((m) => [m.id.toLowerCase(), { name: m.name, tier: m.tier ?? null }]),
  )

  interface BingoLike {
    mutants: { specimenId: string }[]
    rewards: { name: string; amount: number; type: string }[]
    columns?: number
  }
  const bingos = await readJson<BingoLike[]>('src/data/bingos.json', [])
  const GOLD_BUILDING_IDS = ['Building_HC_2', 'Building_HC_1']
  const covering = new Set<string>()
  for (const b of bingos) {
    const count = b.mutants.length
    let cols = b.columns || Math.ceil(Math.sqrt(count))
    if (count === 12 && !b.columns) cols = 4
    const rows = Math.ceil(count / cols)
    const expectedWithCompletion = rows + cols + 1
    const expectedNoCompletion = rows + cols
    const hasCompletion = b.rewards.length === expectedWithCompletion
    const hasLineRewards = hasCompletion || b.rewards.length === expectedNoCompletion
    if (!hasLineRewards) continue
    const rowRewards = b.rewards.slice(0, rows)
    const colRewards = b.rewards.slice(rows, rows + cols)
    const completionReward = hasCompletion ? b.rewards[b.rewards.length - 1] : null
    rowRewards.forEach((rw, r) => {
      if (GOLD_BUILDING_IDS.includes(rw.name)) {
        b.mutants
          .slice(r * cols, (r + 1) * cols)
          .forEach((m) => covering.add(m.specimenId.toLowerCase()))
      }
    })
    colRewards.forEach((rw, c) => {
      if (GOLD_BUILDING_IDS.includes(rw.name)) {
        b.mutants
          .filter((_, i) => i % cols === c)
          .forEach((m) => covering.add(m.specimenId.toLowerCase()))
      }
    })
    if (completionReward && GOLD_BUILDING_IDS.includes(completionReward.name)) {
      b.mutants.forEach((m) => covering.add(m.specimenId.toLowerCase()))
    }
  }
  goldCoverage = covering

  // boxIds - для todayShop: сундуки/паки лежат в том же дневном пуле шопа, что
  // и специмены (найдено 2026-11-25: "Mystery_Cyberweek_2026" подтверждён в
  // shopForecast с exactDateStart 29.11 - попадёт в "Сегодня в магазине" как
  // обычный оффер) - без этой проверки "скам"-предостережение (раньше жившее
  // только в отдельной категории 'box', теперь убранной из дайджеста) для них
  // тихо пропадало бы.
  const boxes = await readJson<{ itemId: string }[]>('src/data/boxes.json', [])
  boxIds = new Set(boxes.map((b) => b.itemId.toLowerCase()))
}

function tierBucket(tier: string | null | undefined): '12' | '3' | '4none' {
  if (!tier) return '4none'
  if (tier.startsWith('1') || tier.startsWith('2')) return '12'
  if (tier.startsWith('3')) return '3'
  return '4none'
}

function tierVerdictText(bucket: '12' | '3' | '4none'): string {
  if (bucket === '12') return 'играбелен, берём'
  if (bucket === '3') return 'подойдёт новичкам, но слабее остальных'
  return 'неиграбелен, не берём'
}

// specimenId - lowercase id мутанта. Возвращает null, только если id не дан
// (например, награда ещё не резолвится) - сам факт отсутствия тира на сайте
// это ВАЛИДНЫЙ вердикт ("неиграбелен"), не повод пропустить оценку.
function mutantVerdict(specimenId: string | null | undefined): string | null {
  if (!specimenId) return null
  const id = specimenId.toLowerCase()
  const m = mutantsById.get(id)
  let text = tierVerdictText(tierBucket(m?.tier))
  if (goldCoverage.has(id)) text += ', кроет плав/кузню'
  return text
}

// shopOfferSpecimenId/selectTodayShopItems - общий модуль с
// render-today-shop.astro, см. комментарий в today-shop-items.ts.

// Топ-тир (CTID-награда конца сезона) - specimen-награда с максимальным tier.
function pvpTopRewardSpecimenId(tiers: AnnouncementItemLike['pvpRewardTiers']): string | null {
  if (!tiers || tiers.length === 0) return null
  const top = tiers.reduce((best, t) => (t.tier > best.tier ? t : best))
  const specimen = top.items.find((it) => /^specimen_/i.test(it.id))
  return specimen ? specimen.id.toLowerCase() : null
}

// specimenId БЕЗ суффикса варианта - для вердикта. boxIds - "скам"-оговорка
// для сундуков/паков, которые приезжают в todayShop из того же дневного пула,
// что и специмены (см. комментарий у boxIds в loadVerdictData).
function isBoxOffer(rawId: string): boolean {
  const afterSprint = rawId.includes('|') ? rawId.slice(rawId.indexOf('|') + 1) : rawId
  const withoutShopPrefix = afterSprint.replace(/^shop_/i, '')
  return boxIds.has(afterSprint.toLowerCase()) || boxIds.has(withoutShopPrefix.toLowerCase())
}

// Основная строка подписи для ОДНОЙ записи дайджеста (область сузена до
// todayShop/pvp/evoDiscount/madnessDiscount, юзер 2026-11-25):
// todayShop - по 1 офферу в строку (Женя: "чуть другой формат... по 1
// предложению в строку"), специмены с тир-вердиктом, сундуки/паки с
// "покупать не советуем", остальное без вердикта; pvp-награда - тир-вердикт;
// эво-скидка - "скип", если меньше 80%; маднесс - без вердикта, просто факт.
function captionLineFor(a: AnnouncementLike): string {
  const icon = CATEGORY_ICON[a.category] ?? '🔔'
  const it = a.items[0]
  if (a.category === 'pvp') {
    const verdict = mutantVerdict(pvpTopRewardSpecimenId(it?.pvpRewardTiers))
    return `${icon} ${a.title}${verdict ? ` — награда: ${verdict}` : ''}`
  }
  if (a.category === 'todayShop') {
    const parts = a.items.map((x) => {
      const specimenId = shopOfferSpecimenId(x.id)
      if (specimenId) {
        const verdict = mutantVerdict(specimenId)
        return verdict ? `${x.name ?? x.id} (${verdict})` : (x.name ?? x.id)
      }
      if (isBoxOffer(x.id)) return `${x.name ?? x.id} (покупать не советуем)`
      return x.name ?? x.id
    })
    return `${icon} ${a.title}:\n${parts.join(',\n')}`
  }
  if (a.category === 'evoDiscount') {
    const goldPct = /золото (\d+)%/.exec(a.title)?.[1]
    const silverPct = /серебро (\d+)%/.exec(a.title)?.[1]
    const min = Math.min(
      goldPct ? Number(goldPct) : Infinity,
      silverPct ? Number(silverPct) : Infinity,
    )
    return `${icon} ${a.title}${Number.isFinite(min) && min < 80 ? ' — скип, ждём повыгоднее' : ''}`
  }
  return `${icon} ${a.title}`
}

interface ImageJob {
  announcement: AnnouncementLike
  url: string
}

// todayShop - синтетическая запись (см. main()), страница сама вычисляет
// "сегодня" и сама фильтрует shopForecast/dailyNews, id/date ей не нужны.
// pvp/evoDiscount/madnessDiscount - обычный живой рендер карточки анонса
// (тот же AnnouncementCard.astro, что на /announcements).
async function resolveImageUrl(a: AnnouncementLike): Promise<string> {
  if (a.category === 'todayShop') {
    return `${SITE_ORIGIN}/api/screenshot-today-shop`
  }
  return `${SITE_ORIGIN}/api/screenshot-announcement?id=${encodeURIComponent(a.id)}`
}

function getCreds(): { botToken: string; channelId: string } | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  if (!botToken || !channelId) {
    console.log('[digest] TELEGRAM_BOT_TOKEN/TELEGRAM_CHANNEL_ID не заданы - best-effort пропуск')
    return null
  }
  return { botToken, channelId }
}

async function sendMessage(
  botToken: string,
  channelId: string,
  text: string,
  markdown = true,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: channelId,
      text,
      ...(markdown ? { parse_mode: 'Markdown' } : {}),
    }),
  })
  if (!res.ok) throw new Error(`sendMessage ${res.status}: ${await res.text()}`)
}

// Фото скачиваем сами и шлём байтами (attach://), не ссылкой - Telegram
// должен не только резолвить наш домен, но и дождаться live-рендера
// Chromium на холодном Vercel-контейнере (до ~15 c), ссылкой это ненадёжно.
async function sendAlbum(
  botToken: string,
  channelId: string,
  jobs: ImageJob[],
  caption: string | null,
): Promise<{ sent: ImageJob[]; failed: ImageJob[] }> {
  const sent: ImageJob[] = []
  const failed: ImageJob[] = []
  const form = new FormData()
  const media: Record<string, unknown>[] = []

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      const field = `file${i}`
      form.append(field, new Blob([buffer]), `${field}.png`)
      // БЕЗ parse_mode: подпись с 2026-11-23 несёт настоящие игровые имена
      // (мутант/бокс/бинго-доска) - те несут "_"/"*"/"[" (реальные примеры,
      // см. тот же класс бага в telegram-admin-bot.ts), Markdown-парсинг на
      // них падает 400-кой.
      const entry: Record<string, unknown> = { type: 'photo', media: `attach://${field}` }
      if (i === 0 && caption) {
        entry.caption = caption
      }
      media.push(entry)
      sent.push(job)
    } catch (err) {
      console.error(`[digest] скриншот ${job.announcement.id} не удался:`, err)
      failed.push(job)
    }
  }

  if (media.length === 0) return { sent, failed }
  form.append('chat_id', channelId)
  form.append('media', JSON.stringify(media))

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMediaGroup`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`sendMediaGroup ${res.status}: ${await res.text()}`)
  return { sent, failed }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  // --force-send - ручной тест живой отправки вне окна 15:00 МСК (см. --dry-run
  // чуть выше): маркер и альбом ведут себя как в бою, просто не ждём часа.
  const forceSend = process.argv.includes('--force-send')
  const now = new Date()
  const todayKey = mskDateKey(now)

  const marker = await readJson<{ date: string } | null>(MARKER_PATH, null)
  if (marker?.date === todayKey) {
    console.log(`[digest] за ${todayKey} уже отправлено - пропуск`)
    return
  }
  if (!dryRun && !forceSend && mskHour(now) < SEND_AT_MSK_HOUR) {
    console.log(
      `[digest] МСК-час ${mskHour(now)} < ${SEND_AT_MSK_HOUR} - рано, ждём прогона под конец окна`,
    )
    return
  }

  const announcements = await readJson<AnnouncementLike[]>('src/data/announcements.json', [])
  // Область дайджеста - ТОЛЬКО pvp/evoDiscount/madnessDiscount из обычных
  // announcements.json-категорий (юзер 2026-11-25, после фидбека Жени - см.
  // докстринг файла). shopForecast/dailyNews тоже не отсюда - их несёт
  // отдельная синтетическая категория 'todayShop' (todayShopItems ниже):
  // срез уже известных офферов из ЛЮБОЙ (не обязательно сегодняшней) записи
  // этих категорий, чей exactDateStart приходится именно на сегодня.
  const DIGEST_CATEGORIES = new Set(['pvp', 'evoDiscount', 'madnessDiscount'])
  const todays = announcements
    .filter((a) => DIGEST_CATEGORIES.has(a.category) && mskDateKey(new Date(a.date)) === todayKey)
    .sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a.category)
      const ib = CATEGORY_ORDER.indexOf(b.category)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })

  // selectTodayShopItems сканирует ВСЕ записи категории, не только последнюю
  // (найдено 2026-11-25: подтверждённый kartel-датой оффер из прошлого
  // спринта "потерялся", когда детектор перекатился на новый - см.
  // комментарий в today-shop-items.ts) и дедупит shopForecast/dailyNews между
  // собой без схлопывания настоящих разных вариантов (Gold/rc/Bronze).
  const todayShopItems = selectTodayShopItems(announcements, todayKey)
  if (todayShopItems.length > 0) {
    todays.push({
      id: `todayShop-${todayKey}`,
      date: now.toISOString(),
      category: 'todayShop',
      title: 'Сегодня в магазине',
      items: todayShopItems,
    })
  }

  if (todays.length === 0) {
    console.log(`[digest] за ${todayKey} новых записей нет - пост не нужен`)
    if (!dryRun) {
      await fs.writeFile(MARKER_PATH, JSON.stringify({ date: todayKey }) + '\n', 'utf-8')
    }
    return
  }

  await loadVerdictData()
  const contentLines = todays.map(captionLineFor)
  const hashtags = [...new Set(todays.map((a) => CATEGORY_HASHTAG[a.category]).filter(Boolean))]
  const fullText = [
    `📅 Обновления за ${ruDateLabel(now)}`,
    '',
    ...contentLines,
    '',
    hashtags.join(' '),
    '',
    'Подробнее: archivist-library.com/announcements',
    'Что берём сегодня?',
  ].join('\n')

  // Telegram кэпит caption sendMediaGroup/sendPhoto в 1024 символа (не 4096,
  // как у обычного sendMessage) - НАЙДЕНО на живом тесте 2026-11-23: с
  // вердиктами на каждую карточку подпись из 14 записей вышла за лимит, и
  // sendMediaGroup упал ЦЕЛИКОМ 400-кой ("caption is too long"). Юзер
  // 2026-11-23 попросил одну подпись, не две сообщения - обычный день
  // (1-3 категории) укладывается в лимит легко, caption = fullText как есть.
  // Усечение - только страховка на редкий очень насыщенный день: тогда
  // целиком текст уходит ДОПОЛНИТЕЛЬНО отдельным сообщением (ничего не
  // теряем молча), а на фото - подпись, обрезанная по границе строки.
  const TELEGRAM_CAPTION_LIMIT = 1024
  const truncated = fullText.length > TELEGRAM_CAPTION_LIMIT
  const caption = truncated
    ? fullText.slice(0, TELEGRAM_CAPTION_LIMIT - 20).replace(/\n[^\n]*$/, '') + '\n…см. ниже'
    : fullText

  const jobs: ImageJob[] = await Promise.all(
    todays.map(async (a) => ({ announcement: a, url: await resolveImageUrl(a) })),
  )

  if (dryRun) {
    console.log(
      `[digest] --dry-run: за ${todayKey} отправилось бы ${jobs.length} карточек (до ${Math.ceil(jobs.length / MAX_ALBUM_SIZE)} альбомов):`,
    )
    console.log(caption)
    if (truncated) {
      console.log(
        `--- (подпись обрезана, ${fullText.length} > ${TELEGRAM_CAPTION_LIMIT}, полный текст уйдёт отдельным сообщением) ---`,
      )
      console.log(fullText)
    }
    for (const j of jobs)
      console.log(`  - [${j.announcement.category}] ${j.announcement.title} -> ${j.url}`)
    return
  }

  const creds = getCreds()
  if (!creds) return

  const failedAll: ImageJob[] = []
  for (let i = 0; i < jobs.length; i += MAX_ALBUM_SIZE) {
    const chunk = jobs.slice(i, i + MAX_ALBUM_SIZE)
    const { failed } = await sendAlbum(
      creds.botToken,
      creds.channelId,
      chunk,
      i === 0 ? caption : null,
    )
    failedAll.push(...failed)
  }
  // Подпись - только на первом фото первого альбома. Если альбом был ровно
  // один и он целиком упал - текст ещё не ушёл ни разу, шлём fullText
  // отдельным сообщением, чтобы день не остался совсем без дайджеста. Если
  // подпись пришлось обрезать (редкий насыщенный день) - полный текст уходит
  // ДОПОЛНИТЕЛЬНО, после фото (best-effort, не гейтит delivered). В обычный
  // день (подпись не обрезана) второе сообщение не нужно - юзер 2026-11-23
  // явно попросил одну подпись, не две.
  const totalFailure = jobs.length > 0 && failedAll.length === jobs.length
  let textFallbackOk = false
  if (totalFailure) {
    textFallbackOk = await sendMessage(creds.botToken, creds.channelId, fullText, false)
      .then(() => true)
      .catch((err) => {
        console.error('[digest] текстовый фолбэк тоже не ушёл:', err)
        return false
      })
  } else if (truncated) {
    await sendMessage(creds.botToken, creds.channelId, fullText, false).catch((err) =>
      console.error('[digest] полный текст (после обрезанной подписи) не ушёл (best-effort):', err),
    )
  }
  if (failedAll.length > 0 && !totalFailure) {
    // markdown=false: title - настоящее игровое имя, может содержать _*[ (реальные
    // примеры) и ломает Markdown-парсинг Telegram 400-кой (см. комментарий в
    // telegram-admin-bot.ts про тот же класс багов).
    const lines = failedAll.map((j) => `⚠️ ${j.announcement.title} - скриншот не удался`)
    await sendMessage(creds.botToken, creds.channelId, lines.join('\n'), false).catch((err) =>
      console.error('[digest] алерт про упавшие скриншоты не ушёл:', err),
    )
  }

  // Маркер пишем, только если реально хоть что-то ушло (картинка или текстовый
  // фолбэк) - иначе полный провал (например, скриншот-эндпоинт недоступен
  // весь день) тихо съедает сегодняшний дайджест насовсем, без шанса на повтор
  // следующим часовым прогоном (НАЙДЕНО на живом тесте 2026-11-22: сетевой
  // таймаут до всех 5 скриншотов разом всё равно писал маркер "отправлено").
  const delivered = jobs.length - failedAll.length > 0 || textFallbackOk
  if (delivered) {
    await fs.writeFile(MARKER_PATH, JSON.stringify({ date: todayKey }) + '\n', 'utf-8')
  } else {
    console.error(
      `[digest] за ${todayKey} НИЧЕГО не ушло - маркер не пишем, следующий прогон повторит`,
    )
  }
  console.log(
    `[digest] за ${todayKey} отправлено ${jobs.length - failedAll.length}/${jobs.length} карточек`,
  )
}

runMain(import.meta.url, 'digest', main)
