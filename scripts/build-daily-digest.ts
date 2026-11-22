// Ежедневный дайджест обновлений в публичный Telegram-канал - заменяет
// поштучный кросс-пост (удалён, см. комментарий в build-announcements.ts).
// Один пост в день со всеми категориями за сутки разом, картинками, не
// текстом: у каждой категории уже есть рабочий рендер на сайте - большинство
// через /api/screenshot-announcement (тот же AnnouncementCard.astro, что живая
// лента), mutant/skin - через /api/screenshot-mutant и /api/screenshot-skin
// (полная модалка, см. resolveImageUrl) - дайджест просто собирает готовые
// картинки в один Telegram-альбом, вместо того чтобы изобретать второй
// текстовый формат (юзер 2026-11-22: "чисто текстом полная хуйня, нужен
// именно визуал - по сути большинство уже есть же").
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

const ROOT = process.cwd()
// DIGEST_SITE_ORIGIN - только для ручных тестов вне CI: archivist-library.com
// идёт через гео-сплит-DNS на relay, недоступный из некоторых песочниц/сетей,
// тот же деплой на *.vercel.app отвечает напрямую. В реальном воркфлоу не
// задаётся - там всегда прод-домен.
const SITE_ORIGIN = process.env.DIGEST_SITE_ORIGIN ?? 'https://archivist-library.com'
const CDN_BASE = 'https://cdn.archivist-library.com'
const MARKER_PATH = path.join(ROOT, 'scripts/digest-last-sent.json')
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const MAX_ALBUM_SIZE = 10
const SEND_AT_MSK_HOUR = 15

interface AnnouncementItemLike {
  id: string
  name?: string
  exactDateStart?: string | null
  addedNames?: string[]
  addedSpecimenIds?: string[]
  rewardMutantId?: string | null
  specimenId?: string | null
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

// Порядок категорий в альбоме - игровая логика (мутанты/скины вперёд,
// технические обновления магазина - в конец), не алфавит.
const CATEGORY_ORDER = [
  'mutant',
  'skin',
  'token',
  'bingo',
  'box',
  'exchange',
  'reactor',
  'raid',
  'ladder',
  'eventLadder',
  'pvp',
  'eventQuests',
  'evoDiscount',
  'madnessDiscount',
  'todayShop',
]
// shopForecast/dailyNews НЕ в дайджесте вовсе (юзер 2026-11-23: "спринты
// анонсятся другим механизмом") - их несёт отдельная синтетическая категория
// 'todayShop' (см. todayShopItems ниже), не announcements.json-запись.
const CATEGORY_ICON: Record<string, string> = {
  mutant: '🧬',
  skin: '🎨',
  token: '🪙',
  bingo: '🎲',
  box: '📦',
  exchange: '💱',
  reactor: '🎰',
  raid: '⚔️',
  ladder: '🪜',
  eventLadder: '🪜',
  pvp: '🥊',
  eventQuests: '📜',
  evoDiscount: '🧪',
  madnessDiscount: '🎡',
  todayShop: '🛒',
}
const CATEGORY_LABEL: Record<string, string> = {
  mutant: 'Мутанты',
  skin: 'Скины',
  token: 'Жетоны',
  bingo: 'Бинго',
  box: 'Боксы',
  exchange: 'Обменники',
  reactor: 'Реакторы',
  raid: 'Рейды',
  ladder: 'Лесенки',
  eventLadder: 'Ивент-лесенки',
  pvp: 'ПвП',
  eventQuests: 'Задания',
  evoDiscount: 'Скидка на эво',
  madnessDiscount: 'Скидка на рулетку',
  todayShop: 'Сегодня в магазине',
}
// Хэштег на категорию, виден в подписи внизу поста - для поиска по каналу
// (юзер 2026-11-23, по образцу его же канала mutants_mgg_fb: там один тег на
// пост; у нас один пост = много категорий, поэтому список тегов, не один).
const CATEGORY_HASHTAG: Record<string, string> = {
  mutant: '#MGGmutant',
  skin: '#MGGskin',
  token: '#MGGtoken',
  bingo: '#MGGbingo',
  box: '#MGGshop',
  exchange: '#MGGchange',
  reactor: '#MGGreactor',
  raid: '#MGGraid',
  ladder: '#MGGladder',
  eventLadder: '#MGGladder',
  pvp: '#MGGPvP',
  eventQuests: '#MGGquests',
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

// Прогноз/доска-магазин кладёт specimenId прямо в raw id оффера
// (shopitems.xml itemId), иногда с суффиксом звезды/варианта
// (Specimen_CD_02_Silver) - звезда тиру не важна, обрезаем. Пакеты/боксы/
// жетоны под этот паттерн не попадают - для них вердикта нет (юзер
// 2026-11-23: "сегодня в магазе, кроме мутов - без оценки").
function shopOfferSpecimenId(rawId: string): string | null {
  const afterSprint = rawId.includes('|') ? rawId.slice(rawId.indexOf('|') + 1) : rawId
  const m = /^(specimen_[a-z]+_\d+)/i.exec(afterSprint)
  return m ? m[1].toLowerCase() : null
}

// Топ-тир (CTID-награда конца сезона) - specimen-награда с максимальным tier.
function pvpTopRewardSpecimenId(tiers: AnnouncementItemLike['pvpRewardTiers']): string | null {
  if (!tiers || tiers.length === 0) return null
  const top = tiers.reduce((best, t) => (t.tier > best.tier ? t : best))
  const specimen = top.items.find((it) => /^specimen_/i.test(it.id))
  return specimen ? specimen.id.toLowerCase() : null
}

// Основная строка подписи для ОДНОЙ записи дайджеста - имя + вердикт, где он
// применим (юзер 2026-11-23, по категориям):
// мутант/скин/pvp-награда/рейд-лесенка-награда/реактор-награда - тир-вердикт;
// бокс - блан кет "скам"; бинго - тир-вердикт на КАЖДОГО добавленного
// мутанта; обменник - только "кроет плав/кузню", если есть; эво-скидка -
// "скип", если меньше 80%; остальное - без вердикта, просто факт.
function captionLineFor(a: AnnouncementLike): string {
  const icon = CATEGORY_ICON[a.category] ?? '🔔'
  const it = a.items[0]
  if (a.category === 'mutant') {
    const verdict = mutantVerdict(it?.id)
    return `${icon} ${it?.name ?? a.title}${verdict ? ` — ${verdict}` : ''}`
  }
  if (a.category === 'skin') {
    const baseId = it?.id.split('|')[0] ?? null
    const verdict = mutantVerdict(baseId)
    return `${icon} ${it?.name ?? a.title}${verdict ? ` — ${verdict}` : ''}`
  }
  if (a.category === 'raid' || a.category === 'ladder' || a.category === 'eventLadder') {
    const verdict = mutantVerdict(it?.rewardMutantId)
    return `${icon} ${a.title}${verdict ? ` — награда: ${verdict}` : ''}`
  }
  if (a.category === 'reactor') {
    const verdict = mutantVerdict(it?.rewardMutantId)
    return `${icon} ${a.title}${verdict ? ` — главная награда: ${verdict}` : ''}`
  }
  if (a.category === 'pvp') {
    const verdict = mutantVerdict(pvpTopRewardSpecimenId(it?.pvpRewardTiers))
    return `${icon} ${a.title}${verdict ? ` — награда: ${verdict}` : ''}`
  }
  if (a.category === 'box') {
    return `${icon} ${a.title} — покупать не советуем, скам`
  }
  if (a.category === 'bingo' && it?.addedSpecimenIds && it.addedSpecimenIds.length > 0) {
    const names = it.addedNames ?? []
    const parts = it.addedSpecimenIds.map((sid, i) => {
      const verdict = mutantVerdict(sid)
      return verdict ? `${names[i] ?? sid} (${verdict})` : (names[i] ?? sid)
    })
    const boardTitle = a.title.split(':')[0]
    return `${icon} ${boardTitle}: добавлен(ы) ${parts.join(', ')}`
  }
  if (a.category === 'exchange') {
    const covering = a.items
      .map((x) => x.specimenId)
      .filter((sid): sid is string => !!sid && goldCoverage.has(sid.toLowerCase()))
    const names = a.items
      .filter((x) => x.specimenId && covering.includes(x.specimenId))
      .map((x) => x.name ?? x.id)
    return `${icon} ${a.title}${names.length > 0 ? ` — кроет плав/кузню: ${names.join(', ')}` : ''}`
  }
  if (a.category === 'todayShop') {
    const parts = a.items.map((x) => {
      const specimenId = shopOfferSpecimenId(x.id)
      const verdict = mutantVerdict(specimenId)
      return verdict ? `${x.name ?? x.id} (${verdict})` : (x.name ?? x.id)
    })
    return `${icon} ${a.title}: ${parts.join(', ')}`
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

// bingo несёт готовый PNG (scripts/render-bingo-screenshots.ts), не живой
// рендер - тот же приём, что AnnouncementCard.astro (bingoShotFile): дешевле
// и не зависит от Chromium на момент отправки дайджеста.
//
// mutant/skin - скрин ПОЛНОЙ модалки (MutantModal.svelte: статы/абилки/
// источники получения), не карточки анонса - та несёт только имя+иконку,
// избыточна рядом с модалкой (юзер 2026-11-22: "мутантов и скины нужно слать
// скринами из их модальки"). Тот же приём, что у admin-бота
// (process-pending-screenshots.ts::contentUrlFor) - переиспользуем те же
// эндпоинты /api/screenshot-mutant и /api/screenshot-skin, не изобретаем
// второй рендер. item.id для mutant - specimen id, для skin -
// "<specimenId>|<skinKey>" (см. detectMutants/detectSkins). ?date= рисует
// плашку даты анонса прямо на скрине модалки.
async function resolveImageUrl(
  a: AnnouncementLike,
  bingoShots: Record<string, { file: string }>,
): Promise<string> {
  if (a.category === 'bingo' && a.items[0]) {
    const shot = bingoShots[a.items[0].id]
    if (shot?.file) return CDN_BASE + (shot.file.startsWith('/') ? shot.file : `/${shot.file}`)
  }
  const dateParam = `&date=${encodeURIComponent(a.date)}`
  if (a.category === 'mutant' && a.items[0]) {
    return `${SITE_ORIGIN}/api/screenshot-mutant?id=${encodeURIComponent(a.items[0].id)}${dateParam}`
  }
  if (a.category === 'skin' && a.items[0]) {
    return `${SITE_ORIGIN}/api/screenshot-skin?id=${encodeURIComponent(a.items[0].id)}${dateParam}`
  }
  // todayShop - синтетическая запись (см. main()), страница сама вычисляет
  // "сегодня" и сама фильтрует shopForecast/dailyNews, id/date ей не нужны.
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
  // shopForecast/dailyNews ИСКЛЮЧЕНЫ из обычной агрегации (юзер 2026-11-23:
  // доска спринта на 2 недели вперёд - не "что добавили сегодня", эти
  // категории анонсятся своим механизмом). Вместо них - todayShopItems ниже:
  // срез уже известных офферов из ЛЮБОЙ (не обязательно сегодняшней) записи
  // этих категорий, чей exactDateStart приходится именно на сегодня.
  const todays = announcements
    .filter(
      (a) =>
        a.category !== 'rebalance' &&
        a.category !== 'shopForecast' &&
        a.category !== 'dailyNews' &&
        mskDateKey(new Date(a.date)) === todayKey,
    )
    .sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a.category)
      const ib = CATEGORY_ORDER.indexOf(b.category)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })

  const latestByCategory = (category: string): AnnouncementLike | null => {
    const matches = announcements.filter((a) => a.category === category)
    return matches.length > 0 ? matches.reduce((best, a) => (a.date > best.date ? a : best)) : null
  }
  const todaysItemsOf = (a: AnnouncementLike | null): AnnouncementItemLike[] =>
    a
      ? a.items.filter(
          (it) => it.exactDateStart && mskDateKey(new Date(it.exactDateStart)) === todayKey,
        )
      : []
  const todayShopItems = [
    ...todaysItemsOf(latestByCategory('shopForecast')),
    ...todaysItemsOf(latestByCategory('dailyNews')),
  ]
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
  const caption = [
    `📅 Обновления за ${ruDateLabel(now)}`,
    '',
    ...contentLines,
    '',
    hashtags.join(' '),
    '',
    'Подробнее: archivist-library.com/announcements',
    'Что берём сегодня?',
  ].join('\n')

  const bingoShots = await readJson<Record<string, { file: string }>>(
    'src/data/bingo-screenshots.json',
    {},
  )
  const jobs: ImageJob[] = await Promise.all(
    todays.map(async (a) => ({ announcement: a, url: await resolveImageUrl(a, bingoShots) })),
  )

  if (dryRun) {
    console.log(
      `[digest] --dry-run: за ${todayKey} отправилось бы ${jobs.length} карточек (до ${Math.ceil(jobs.length / MAX_ALBUM_SIZE)} альбомов):`,
    )
    console.log(caption)
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
  // один и он целиком упал - текст ещё не ушёл ни разу, шлём отдельно, чтобы
  // день не остался совсем без дайджеста.
  const totalFailure = jobs.length > 0 && failedAll.length === jobs.length
  let textFallbackOk = false
  if (totalFailure) {
    textFallbackOk = await sendMessage(creds.botToken, creds.channelId, caption, false)
      .then(() => true)
      .catch((err) => {
        console.error('[digest] текстовый фолбэк тоже не ушёл:', err)
        return false
      })
  } else if (failedAll.length > 0) {
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
