// "Доделыватель" для .локал-флоу (Фаза 2 авто-анонсов). Триггерится через
// GitHub Actions workflow_dispatch из telegram-webhook.ts после того, как
// пользователь ответил `.локал reactor:<id> "Имя"` или `.локал dungeon:<id>
// "Имя"`. Сам вебхук (serverless, без rclone/aws-кредов) только записал имя
// в scripts/resolved-names-cache.json - вся реальная работа (арт/CDN/запись
// данных) здесь, в CI, где есть полные креды.
//
// Публикацию анонса делает НЕ этот скрипт, а build-announcements.ts (уже
// подключён в конце этого же workflow) - он видит новый id в gacha.json/
// raids.json/special-ladders.json как обычный diff, без дублирования логики
// резолвинга иконок. См. память auto-announcements-architecture.

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import { parseGachaXml, type ParsedGacha } from './detect-new-reactors'
import { parseDungeonsXml } from './detect-new-dungeons'

const ROOT = process.cwd()

const GACHA_XML_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gacha.xml'
const DUNGEONS_XML_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dungeon/dungeons.xml'
const DUNGEON_XML_URL = (id: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/dungeon/dungeon_${id}.xml`
const GACHA_COVER_URL = (id: string) =>
  `https://s-beta.kobojo.com/mutants/assets/gachacontent/btn_gacha_${id}-ru.png`

const GACHA_JSON_PATH = path.join(ROOT, 'src/data/simulators/reactor/gacha.json')
const GACHA_NAME_RU_PATH = path.join(ROOT, 'src/data/simulators/reactor/gacha-name-ru.json')
const GACHA_COVERS_PATH = path.join(ROOT, 'src/data/simulators/reactor/gacha-covers.json')
const PRIORITY_GACHAS_PATH = path.join(ROOT, 'src/data/simulators/reactor/priority-gachas.json')
const RAIDS_PATH = path.join(ROOT, 'src/data/guides/raids.json')
const SPECIAL_LADDERS_PATH = path.join(ROOT, 'src/data/guides/special-ladders.json')
const OBTAIN_PATH = path.join(ROOT, 'src/data/mutants/obtain.json')
const MUTANTS_PATH = path.join(ROOT, 'src/data/mutants/mutants.json')
const RESOLVED_NAMES_PATH = path.join(ROOT, 'scripts/resolved-names-cache.json')
const PENDING_PATH = path.join(ROOT, 'scripts/pending-names-cache.json')
// Батч 11 (3), Bucket 4: опциональный EN-перевод из ".локал ... en:\"...\""
// (telegram-webhook.ts). Отдельный файл, RESOLVED_NAMES_PATH/PENDING_PATH не
// трогаются - format/поведение старого RU-only пути идентичны прежним.
const RESOLVED_NAMES_EN_PATH = path.join(ROOT, 'scripts/resolved-names-en-cache.json')
const GACHA_EVENT_I18N_PATH = path.join(ROOT, 'src/data/mutants/gacha-event-i18n.json')

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return fallback
  }
}

async function saveJson(p: string, data: unknown) {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

async function sendTelegramMessage(text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    console.log(
      '[FINISH-PENDING] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы, сообщение не отправлено',
    )
    return
  }
  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  })
}

interface MutantLite {
  id: string
  name: string
}

async function finishReactor(id: string, name: string, enName?: string) {
  const xmlRes = await axios.get(GACHA_XML_URL, { timeout: 20000 })
  const active = parseGachaXml(xmlRes.data)
  const gacha = active.find((g) => g.id === id)
  if (!gacha) {
    throw new Error(`Реактор "${id}" не найден в живом gacha.xml (мог протухнуть/переехать)`)
  }

  const toStored = (s: ParsedGacha['basicElements'][number]) => ({
    specimen: s.specimen,
    stars: s.stars,
    odds: s.odds,
    bonus: s.bonus,
  })

  const gachaJson = await loadJson<Record<string, unknown>>(GACHA_JSON_PATH, {})
  gachaJson[id] = {
    token_cost: gacha.tokenCost,
    hc_cost: gacha.hcCost,
    filter: gacha.filter,
    basic_elements: gacha.basicElements.map(toStored),
    completion_reward: gacha.completionReward ? toStored(gacha.completionReward) : null,
  }
  await saveJson(GACHA_JSON_PATH, gachaJson)

  const nameRu = await loadJson<Record<string, string>>(GACHA_NAME_RU_PATH, {})
  nameRu[id] = name
  await saveJson(GACHA_NAME_RU_PATH, nameRu)

  const covers = await loadJson<Record<string, string>>(GACHA_COVERS_PATH, {})
  try {
    const coverRes = await axios.get(GACHA_COVER_URL(id), {
      responseType: 'arraybuffer',
      timeout: 20000,
      validateStatus: (s) => s === 200,
    })
    const coverPath = path.join(ROOT, 'public/reactor', `${id}.png`)
    await fs.mkdir(path.dirname(coverPath), { recursive: true })
    await fs.writeFile(coverPath, coverRes.data)
    covers[id] = `/reactor/${id}.png`
    await saveJson(GACHA_COVERS_PATH, covers)
  } catch {
    console.log(
      `[FINISH-PENDING] Обложка реактора "${id}" не найдена на CDN (btn_gacha_${id}-ru.png) - оставлена без обложки`,
    )
  }

  // priority-gachas.json (2026-08-07: вынесен из .astro в JSON именно ради
  // этого места - строковый regex-патч .astro-файла был хрупким, prettier
  // мог сломать формат и патч молча перестал бы применяться). Новый релиз -
  // первым в списке (тот же приём, что раньше при ручном добавлении "Самоцветов").
  const priority = await loadJson<string[]>(PRIORITY_GACHAS_PATH, [])
  if (!priority.includes(name)) {
    priority.unshift(name)
    await saveJson(PRIORITY_GACHAS_PATH, priority)
  }

  const specimens = [
    ...gacha.basicElements,
    ...(gacha.completionReward ? [gacha.completionReward] : []),
  ]
  await appendObtain(
    specimens.map((s) => s.specimen),
    'gacha',
    `Реактор — ${name}`,
  )
  if (enName) await appendGachaEventI18n(name, enName)

  return { specimenCount: specimens.length, hasCover: Boolean(covers[id]) }
}

// Батч 11 (3), Bucket 4: EN-перевод кураторского имени реактора/данжа -
// пишет в сайдкар по RU-имени как ключу (тот же ключ, что obtain.json's
// "where" использует после "Реактор — "/"Рейд: "/"Лесенки: ", см.
// src/lib/obtain-render.ts GACHA_NAME_DICT/RAID_NAME_DICT). Аддитивно -
// только добавляет/обновляет одну запись, не трогает остальные.
async function appendGachaEventI18n(ruName: string, enName: string) {
  const data = await loadJson<Record<string, { en?: string }>>(GACHA_EVENT_I18N_PATH, {})
  data[ruName] = { ...data[ruName], en: enName }
  await saveJson(GACHA_EVENT_I18N_PATH, data)
}

async function appendObtain(specimenIds: string[], type: string, where: string) {
  const obtain = await loadJson<Record<string, { type: string; where: string }[]>>(OBTAIN_PATH, {})
  for (const specimen of specimenIds) {
    const key = specimen.toLowerCase()
    const entries = obtain[key] ?? []
    if (!entries.some((e) => e.type === type && e.where === where)) {
      entries.push({ type, where })
    }
    obtain[key] = entries
  }
  await saveJson(OBTAIN_PATH, obtain)
}

interface DungeonRaw {
  id: string
  name: string
  nameAuthored: boolean
  mutantId: string | null
  fightCount: number
  bossCount: number
  rewards: {
    currency: { softcurrency: number; hardcurrency: number; experience: number }
    items: { id: string; amount: number }[]
  }
}

function aggregateDungeonFights(xml: string) {
  const fights = xml.match(/<Fight\b[^>]*>[\s\S]*?<\/Fight>/g) ?? []
  let bossCount = 0
  const currency = { softcurrency: 0, hardcurrency: 0, experience: 0 }
  const items = new Map<string, number>()

  for (const fight of fights) {
    bossCount += (fight.match(/boss="true"/g) ?? []).length
    for (const tag of fight.match(/<Reward\b[^>]*\/>/g) ?? []) {
      const type = tag.match(/type="([^"]+)"/)?.[1]
      const amount = Number(tag.match(/amount="([^"]+)"/)?.[1] ?? 0)
      if (type === 'softcurrency' || type === 'hardcurrency' || type === 'experience') {
        currency[type] += amount
      } else if (type === 'entity') {
        const id = tag.match(/id="([^"]+)"/)?.[1]
        if (id) items.set(id, (items.get(id) ?? 0) + (amount || 1))
      }
    }
  }

  return {
    fightCount: fights.length,
    bossCount,
    currency,
    items: Array.from(items, ([id, amount]) => ({ id, amount })),
  }
}

async function finishDungeon(
  id: string,
  name: string,
  dungeonType: 'raid' | 'experiment' | 'challenge',
  enName?: string,
) {
  const [dungeonsRes, fightsRes] = await Promise.all([
    axios.get(DUNGEONS_XML_URL, { timeout: 20000 }),
    axios.get(DUNGEON_XML_URL(id), { timeout: 20000 }),
  ])

  const master = parseDungeonsXml(dungeonsRes.data).find((d) => d.id === id)
  if (!master) {
    throw new Error(`Данж "${id}" не найден в живом dungeons.xml (мог протухнуть/переехать)`)
  }
  const mutantReward = master.rewards.find((r) => r.id.startsWith('Specimen_'))

  const agg = aggregateDungeonFights(fightsRes.data)
  const entry: DungeonRaw = {
    id,
    name,
    nameAuthored: true,
    mutantId: mutantReward?.id ?? null,
    fightCount: agg.fightCount,
    bossCount: agg.bossCount,
    rewards: { currency: agg.currency, items: agg.items },
  }

  if (dungeonType === 'raid') {
    const raids = await loadJson<DungeonRaw[]>(RAIDS_PATH, [])
    if (!raids.some((r) => r.id === id)) raids.push(entry)
    await saveJson(RAIDS_PATH, raids)
  } else {
    const specialLadders = await loadJson<{ experiment: DungeonRaw[]; challenge: DungeonRaw[] }>(
      SPECIAL_LADDERS_PATH,
      { experiment: [], challenge: [] },
    )
    const bucket = specialLadders[dungeonType]
    if (!bucket.some((r) => r.id === id)) bucket.push(entry)
    await saveJson(SPECIAL_LADDERS_PATH, specialLadders)
  }

  if (mutantReward) {
    const label = dungeonType === 'raid' ? `Рейд: ${name}` : `Лесенки: ${name}`
    await appendObtain([mutantReward.id], 'event_raid', label)
  }
  if (enName) await appendGachaEventI18n(name, enName)

  // Обложка для /guides (activity-hero background) и карточки анонса.
  // screen_<id>.jpg - реальный скриншот арены, предпочтителен для фона на
  // всю карточку; title_<id>-ru.png - логотип на прозрачном фоне, криво
  // растягивается под background-size:cover (найдено 2026-08-07 при разборе
  // фидбека по /guides), оставлен как фолбэк если screen_ не существует.
  const PVEEVENT_BASE = 'https://s-beta.kobojo.com/mutants/assets/pveeventcontent/'
  let coverBuffer: Buffer | null = null
  for (const url of [`${PVEEVENT_BASE}screen_${id}.jpg`, `${PVEEVENT_BASE}title_${id}-ru.png`]) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 20000,
        validateStatus: (s) => s === 200,
      })
      coverBuffer = res.data
      break
    } catch {
      // пробуем следующий вариант
    }
  }
  if (coverBuffer) {
    const coverPath = path.join(ROOT, 'public/dungeon-covers', `${id}.png`)
    await fs.mkdir(path.dirname(coverPath), { recursive: true })
    await fs.writeFile(coverPath, coverBuffer)
  } else {
    console.log(`[FINISH-PENDING] Обложка данжа "${id}" не найдена (ни screen_, ни title_)`)
  }

  return entry
}

// Вебхук дёргает finish-pending.yml через простой workflow_dispatch БЕЗ
// inputs (webhook - serverless, не хранит состояние между вызовами и не
// знает, не обгонит ли его собственный дальнейший запрос). Поэтому вместо
// "обработай вот этот один ключ" скрипт сам разбирает ВСЕ накопленные записи
// в resolved-names-cache.json за один прогон - переживает и гонку (два
// .локал подряд до того, как отработает предыдущий workflow_dispatch), и
// ручной повторный запуск.
async function processOne(
  key: string,
  name: string,
  pending: Record<string, { dungeonType?: string }>,
  enName?: string,
) {
  const [type, id] = key.split(':')
  if (!type || !id) throw new Error(`Некорректный ключ: "${key}"`)

  if (type === 'reactor') {
    const r = await finishReactor(id, name, enName)
    return [
      `✅ *Реактор "${name}" (${id}) добавлен*`,
      `Мутантов в пуле: ${r.specimenCount}`,
      r.hasCover
        ? 'Обложка: загружена с CDN'
        : 'Обложка: НЕ найдена, добавь вручную в public/reactor/',
      enName ? `EN: "${enName}"` : '⚠️ EN-имя не задано - на сайте покажется RU',
    ].join('\n')
  }
  if (type === 'dungeon') {
    const dungeonType = (pending[key]?.dungeonType ?? 'raid') as 'raid' | 'experiment' | 'challenge'
    const entry = await finishDungeon(id, name, dungeonType, enName)
    return [
      `✅ *${dungeonType === 'raid' ? 'Рейд' : 'Лесенка'} "${name}" (${id}) добавлен(а)*`,
      `Боёв: ${entry.fightCount}, боссов: ${entry.bossCount}`,
      entry.mutantId
        ? `Мутант-награда: ${entry.mutantId}`
        : 'Мутант-награда: не найдена в dungeons.xml',
      enName ? `EN: "${enName}"` : '⚠️ EN-имя не задано - на сайте покажется RU',
    ].join('\n')
  }
  throw new Error(`Неизвестный тип ключа: "${key}"`)
}

async function main() {
  const resolved = await loadJson<Record<string, string>>(RESOLVED_NAMES_PATH, {})
  const resolvedEn = await loadJson<Record<string, string>>(RESOLVED_NAMES_EN_PATH, {})
  const pending = await loadJson<Record<string, { dungeonType?: string }>>(PENDING_PATH, {})
  const keys = Object.keys(resolved)

  if (keys.length === 0) {
    console.log('[FINISH-PENDING] resolved-names-cache.json пуст, обрабатывать нечего')
    return
  }

  for (const key of keys) {
    const name = resolved[key]
    try {
      const resultText = await processOne(key, name, pending, resolvedEn[key])
      delete resolved[key]
      delete resolvedEn[key]
      delete pending[key]
      await sendTelegramMessage(resultText)
      console.log(`[FINISH-PENDING] ${resultText.replace(/\*/g, '')}`)
    } catch (err) {
      // Один упавший ключ не должен блокировать остальные (и не должен
      // оставаться навечно "потерянным" - оставляем его в resolved-names-cache
      // на следующий прогон, только сообщаем об ошибке).
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[FINISH-PENDING] "${key}" упал:`, message)
      await sendTelegramMessage(`🔴 *finish-pending упал на "${key}"*\n${message}`)
    }
  }

  await saveJson(RESOLVED_NAMES_PATH, resolved)
  await saveJson(RESOLVED_NAMES_EN_PATH, resolvedEn)
  await saveJson(PENDING_PATH, pending)
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[FINISH-PENDING] Ошибка:', message)
  await sendTelegramMessage(`🔴 *finish-pending: общий сбой*\n${message}`)
  process.exit(1)
})
