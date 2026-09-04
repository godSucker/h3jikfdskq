// Авто-публикация анонсов на /announcements. Механизм пришёл на замену ручному
// ".анонс" (форвард поста из офиц. канала + reply в telegram-webhook.ts) для
// контента, который и так синкается автоматически - его появление детектируется
// напрямую по игровым данным, а не ждёт, пока кто-то увидит пост в канале.
// См. память auto-announcements-architecture: Фаза 1 покрывает только типы,
// где RU-имя уже есть в данных (не нужен ни LLM, ни .локал-алерт) - мутанты,
// скины, бинго-доски, боксы, обменники, ребаланс. Реакторы/лесенки - Фаза 2.
//
// Механизм ledger'а (scripts/announced-ids-cache.json, коммитится в репо):
// на каждом прогоне сравниваем текущий набор id по каждому типу с тем, что
// уже было объявлено. Новые id -> одна запись в announcements.json на тип
// за прогон (не по записи на каждый id - иначе разовая партия из 20 новых
// мутантов даст 20 постов подряд). Бутстрап: если ledger ещё не существует,
// сохраняем текущее состояние КАК ЕСТЬ и ничего не публикуем - иначе первый
// запуск объявит все 554 мутанта разом.

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import { fetchShopForecast } from './detect-shop-forecast'
import { fetchDailyNewsForecast } from './detect-daily-news'
import { crossPostAnnouncement, postShopAndDailyNews } from './telegram-cross-post'
import type { OfferRibbon } from './shop-offer-tags'

const ROOT = process.cwd()
// НЕ scripts/.cache/ - та папка в .gitignore и не переживает между прогонами
// CI (свежий checkout каждый раз = вечный бутстрап без единой публикации).
// Тот же приём, что у scripts/missing-textures-cache.json.
const LEDGER_PATH = path.join(ROOT, 'scripts/announced-ids-cache.json')
const ANNOUNCEMENTS_PATH = path.join(ROOT, 'src/data/announcements.json')

interface AnnouncementItem {
  id: string
  name: string
  image?: string | null
  category?: string | null
  // Только для bingo: если задано - это НЕ новая доска, а список мутантов,
  // добавленных в уже существующую (см. detectBingo).
  addedNames?: string[]
  // Только для shopForecast/dailyNews.
  price?: { amount: number; type: 'hardcurrency' | 'softcurrency' | 'usd' } | null
  // Только для shopForecast/dailyNews - лента с настоящего offerTag игры
  // (legendary/limited/new/discount-N/...), см. scripts/shop-offer-tags.ts.
  ribbon?: OfferRibbon | null
  // Только для shopForecast/dailyNews - точный диапазон ЭТОГО оффера из
  // живого kartel-запроса (см. scripts/kartel-filter-dates.ts). null, если
  // live-данных для него нет - страница падает на sprintRangeLabel(sprint).
  exactDateLabel?: string | null
}

interface Announcement {
  id: string
  date: string
  category: string
  title: string
  text?: string | null
  items: AnnouncementItem[]
  link?: string | null
  // Только shopForecast/dailyNews - номер спринта этой записи. Нужен, чтобы
  // на следующих часовых прогонах находить УЖЕ опубликованную запись и
  // дозаполнять её items свежими exactDateLabel (часть офферов узнают точную
  // дату не сразу, а ближе к своему старту) - без этого поля пришлось бы
  // парсить id первого item'а, хрупко.
  sprintKey?: string
}

interface Ledger {
  mutant: string[]
  skin: string[]
  bingo: string[]
  box: string[]
  exchange: string[]
  rebalance: string[]
  raid: string[]
  ladder: string[]
  token: string[]
  reactor: string[]
  shopForecast: string[]
  dailyNews: string[]
}

const EMPTY_LEDGER: Ledger = {
  mutant: [],
  skin: [],
  bingo: [],
  box: [],
  exchange: [],
  rebalance: [],
  raid: [],
  ladder: [],
  token: [],
  reactor: [],
  shopForecast: [],
  dailyNews: [],
}

async function loadJson<T>(relPath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, relPath), 'utf-8'))
  } catch {
    return fallback
  }
}

async function loadLedger(): Promise<{ ledger: Ledger; isBootstrap: boolean }> {
  try {
    const raw = await fs.readFile(LEDGER_PATH, 'utf-8')
    return { ledger: JSON.parse(raw), isBootstrap: false }
  } catch {
    return { ledger: structuredClone(EMPTY_LEDGER), isBootstrap: true }
  }
}

async function saveLedger(ledger: Ledger) {
  await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true })
  await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf-8')
}

// GACHA_NAME_RU дублировать импортом из .svelte-соседнего lib нельзя (там же
// Svelte-специфичные вещи), поэтому короткий локальный список только для
// того, что реально встречается в skins.json - расхождение не страшно,
// worst case skin объявится под сырым id вместо RU-названия.
const SKIN_NAME_RU: Record<string, string> = {
  western: 'Вестерн',
  gachaboss: 'Большой босс',
  japan: 'Япония',
  fantasy: 'Темное фентези',
  lucha: "Мучачо's",
  olympians: 'Боги арены',
  music: 'Диско',
  villains: 'Супер злодеи',
  starwars: 'Космические войны',
  beach: 'Тропическое лето',
  heroes: 'Супергерои',
  soldiers: 'Патруль времени',
  gothic: 'Готика',
  movies: 'Кино',
  elements: 'Команда элементалей',
  steampunk: 'Стимпанк',
  vegetal: 'Фотосинтез',
  girl: 'Хищницы',
  hexcity: 'Hex City',
  gemstones: 'Самоцветы',
  chess: 'Шахматы',
}

interface DetectResult {
  newIds: string[]
  items: AnnouncementItem[]
  // Только shopForecast/dailyNews - спринт уже опубликован (seen), но офферы
  // могли получить/уточнить exactDateLabel с прошлого прогона (см.
  // Announcement.sprintKey) - патчим существующую запись НА МЕСТЕ, без
  // нового поста/id/даты/алерта.
  updateExisting?: { sprintKey: string; items: AnnouncementItem[] }
  // Только shopForecast/dailyNews, только при СОЗДАНИИ новой записи (items
  // непустой, updateExisting не задан) - записывается в Announcement.sprintKey.
  sprintKey?: string
}

type StarsMap = Record<string, { images?: string[] }>

// GACHA/HEROIC мутанты хранят только один star-элемент (часто platinum, не
// normal) - см. память unified mutants.json. Берём первую попавшуюся картинку
// из любого доступного star вместо жёсткого stars.normal.
function firstMutantImage(stars: StarsMap | undefined): string | null {
  if (!stars) return null
  for (const key of ['normal', 'bronze', 'silver', 'gold', 'platinum']) {
    const img = stars[key]?.images?.[0]
    if (img) return img
  }
  const anyKey = Object.keys(stars)[0]
  return anyKey ? (stars[anyKey]?.images?.[0] ?? null) : null
}

// Готовая промо-карточка мутанта с Kobojo CDN (найдено 2026-08-07 в присланных
// пользователем ссылках) - лучше сырого спрайта из firstMutantImage() для
// карточки анонса "новый мутант". Не гарантирована для 100% id (не проверяли
// на GACHA/HEROIC), поэтому HEAD-проверка с фоллбеком, не слепая подстановка.
async function opengraphObtainImage(id: string): Promise<string | null> {
  const url = `https://s-beta.kobojo.com/mutants/assets/opengraph/${id.toLowerCase()}_obtain.jpg`
  try {
    const res = await axios.head(url, {
      timeout: 8000,
      validateStatus: (s) => s === 200 || s === 404,
    })
    return res.status === 200 ? url : null
  } catch {
    return null
  }
}

async function detectMutants(seen: string[]): Promise<DetectResult> {
  const mutants = await loadJson<{ id: string; name: string; stars?: StarsMap }[]>(
    'src/data/mutants/mutants.json',
    [],
  )
  const seenSet = new Set(seen)
  const fresh = mutants.filter((m) => !seenSet.has(m.id))
  return {
    newIds: mutants.map((m) => m.id),
    items: await Promise.all(
      fresh.map(async (m) => ({
        id: m.id,
        name: m.name,
        image: (await opengraphObtainImage(m.id)) ?? firstMutantImage(m.stars),
      })),
    ),
  }
}

async function detectSkins(seen: string[]): Promise<DetectResult> {
  const data = await loadJson<{
    specimens: { id: string; name: string; skin: string; image?: string[] }[]
  }>('src/data/mutants/skins.json', { specimens: [] })
  const seenSet = new Set(seen)
  const byKey = new Map<string, { id: string; name: string; skin: string; image?: string[] }>()
  for (const s of data.specimens) {
    if (!s.skin || s.skin === '_any' || s.skin === 'none') continue
    byKey.set(`${s.id}|${s.skin}`, s)
  }
  const allKeys = [...byKey.keys()]
  const fresh = allKeys.filter((k) => !seenSet.has(k))
  return {
    newIds: allKeys,
    items: fresh.map((k) => {
      const s = byKey.get(k)!
      const skinName = SKIN_NAME_RU[s.skin] ?? s.skin
      return {
        id: k,
        name: `${s.name} — ${skinName}`,
        image: s.image?.[0] ?? null,
      }
    }),
  }
}

// Ledger хранит ключ НЕ по доске целиком, а "boardId|specimenId" на каждого
// мутанта в доске (тот же приём, что у detectSkins/detectExchange) - иначе
// добавление 1-2 мутантов в УЖЕ анонсированную доску (доска не новая, id уже
// в seen) осталось бы незамеченным навсегда. isNewBoard = все ключи доски
// свежие сразу (доска только что появилась целиком), иначе - "добавили
// участников" в существующую.
async function detectBingo(seen: string[]): Promise<DetectResult> {
  const [bingos, mutantNames] = await Promise.all([
    loadJson<{ id: string; title: string; mutants: { specimenId: string }[] }[]>(
      'src/data/bingos.json',
      [],
    ),
    loadJson<Record<string, string>>('src/data/mutant_names.json', {}),
  ])
  const seenSet = new Set(seen)
  const allKeys: string[] = []
  const items: AnnouncementItem[] = []

  for (const b of bingos) {
    const boardKeys = b.mutants.map((m) => `${b.id}|${m.specimenId}`)
    allKeys.push(...boardKeys)
    const freshKeys = boardKeys.filter((k) => !seenSet.has(k))
    if (freshKeys.length === 0) continue

    const isNewBoard = freshKeys.length === boardKeys.length
    const addedNames = freshKeys.map((k) => {
      const specimenId = k.slice(b.id.length + 1)
      return mutantNames[specimenId] ?? specimenId
    })
    items.push({
      id: b.id,
      name: isNewBoard ? b.title : `${b.title}: добавлен(ы) ${addedNames.join(', ')}`,
      image: null,
      addedNames: isNewBoard ? undefined : addedNames,
    })
  }

  return { newIds: allKeys, items }
}

async function detectBoxes(seen: string[]): Promise<DetectResult> {
  const boxes = await loadJson<{ itemId: string; name: string; icon?: string }[]>(
    'src/data/boxes.json',
    [],
  )
  const seenSet = new Set(seen)
  const fresh = boxes.filter((b) => !seenSet.has(b.itemId))
  return {
    newIds: boxes.map((b) => b.itemId),
    items: fresh.map((b) => ({ id: b.itemId, name: b.name, image: b.icon ?? null })),
  }
}

async function detectExchange(seen: string[]): Promise<DetectResult> {
  const obtain = await loadJson<Record<string, { type: string; where: string }[]>>(
    'src/data/mutants/obtain.json',
    {},
  )
  const mutants = await loadJson<{ id: string; name: string; stars?: StarsMap }[]>(
    'src/data/mutants/mutants.json',
    [],
  )
  const nameById = new Map(mutants.map((m) => [m.id, m]))
  const seenSet = new Set(seen)
  const allKeys: string[] = []
  const fresh: { key: string; specimenId: string; where: string }[] = []
  // detect-exchange-rotation.ts пишет ОБА обменника (jackpot_hall для
  // Building_Tokens_Jackpot, event_hall для Building_Event_1) - раньше тут
  // фильтровался только jackpot_hall, и ротация ивент-обменника никогда не
  // анонсировалась (см. код-ревью 2026-08-08, найдено при аудите анонс-пайплайна).
  const EXCHANGE_TYPES = new Set(['jackpot_hall', 'event_hall'])
  for (const [specimenId, entries] of Object.entries(obtain)) {
    for (const e of entries) {
      if (!EXCHANGE_TYPES.has(e.type)) continue
      const key = `${specimenId}|${e.where}`
      allKeys.push(key)
      if (!seenSet.has(key)) fresh.push({ key, specimenId, where: e.where })
    }
  }
  return {
    newIds: allKeys,
    items: fresh.map((f) => {
      const m = nameById.get(f.specimenId)
      return {
        id: f.key,
        name: m ? `${m.name} — ${f.where}` : `${f.specimenId} — ${f.where}`,
        image: firstMutantImage(m?.stars),
      }
    }),
  }
}

// Полноценный resolveReward из src/lib/guides-resolve.ts требует craft-simulator.ts/
// localisation.ts, которые тянут `?raw`-txt и `@/`-алиасы - это Vite-фичи, недоступные
// в голом tsx-скрипте вне Astro/Vite-пайплайна (детектор запускается через `npx tsx`
// напрямую в CI). Поэтому здесь - упрощённый резолвер только через material.json
// (обычный JSON, грузится как все остальные детекторы) + mutants.json. Награды рейдов/
// лесенок на практике это звёзды/материалы/орбы/жетоны/валюта/мутант - всё это material.json
// покрывает; для остального (тот же fallback, что у SKIN_NAME_RU) - сырой id.
async function dungeonItemName(
  id: string,
  materialsById: Map<string, { name?: string; texture?: string }>,
  mutantsById: Map<string, { name: string; stars?: StarsMap }>,
): Promise<{ label: string; image: string | null }> {
  if (id.startsWith('Specimen_')) {
    const m = mutantsById.get(id.toLowerCase())
    return { label: m?.name ?? id, image: firstMutantImage(m?.stars) }
  }
  const mat = materialsById.get(id)
  return { label: mat?.name ?? id, image: mat?.texture ?? null }
}

interface DungeonRawShape {
  id: string
  name: string
  mutantId: string | null
  fightCount: number
  rewards: {
    currency: { softcurrency: number; hardcurrency: number }
    items: { id: string; amount: number }[]
  }
}

async function detectDungeons(
  seen: string[],
  entries: DungeonRawShape[],
  linePrefix: string,
): Promise<DetectResult> {
  const [materials, mutants] = await Promise.all([
    loadJson<{ id: string; name?: string; texture?: string }[]>(
      'src/data/materials/material.json',
      [],
    ),
    loadJson<{ id: string; name: string; stars?: StarsMap }[]>('src/data/mutants/mutants.json', []),
  ])
  const materialsById = new Map(materials.map((m) => [m.id, m]))
  const mutantsById = new Map(mutants.map((m) => [m.id, m]))

  const seenSet = new Set(seen)
  const fresh = entries.filter((d) => !seenSet.has(d.id))

  const items = await Promise.all(
    fresh.map(async (d) => {
      // finish-pending.ts качает титульный баннер (title_<id>-ru.png) в
      // public/dungeon-covers/ при доделке - если он есть, он лучше сырой
      // иконки мутанта/материала для карточки анонса.
      const coverPath = path.join(ROOT, 'public/dungeon-covers', `${d.id}.png`)
      const hasCover = await fs
        .access(coverPath)
        .then(() => true)
        .catch(() => false)
      const image = hasCover
        ? `/dungeon-covers/${d.id}.png`
        : d.mutantId
          ? (await dungeonItemName(d.mutantId, materialsById, mutantsById)).image
          : d.rewards.items[0]
            ? (await dungeonItemName(d.rewards.items[0].id, materialsById, mutantsById)).image
            : null
      return {
        id: d.id,
        name: `${linePrefix} «${d.name}» (${d.fightCount} боёв)`,
        image,
      }
    }),
  )

  return { newIds: entries.map((d) => d.id), items }
}

async function detectRaids(seen: string[]): Promise<DetectResult> {
  const raids = await loadJson<DungeonRawShape[]>('src/data/guides/raids.json', [])
  return detectDungeons(seen, raids, 'Рейд')
}

async function detectLadders(seen: string[]): Promise<DetectResult> {
  const special = await loadJson<{ experiment: DungeonRawShape[]; challenge: DungeonRawShape[] }>(
    'src/data/guides/special-ladders.json',
    { experiment: [], challenge: [] },
  )
  return detectDungeons(seen, [...special.experiment, ...special.challenge], 'Лесенка')
}

// Жетоны сами в material.json пишет scripts/detect-tokens.ts (Phase-1-детектор
// с сетевым фетчем game-defs) - здесь только diff уже-записанных данных, тот
// же приём, что у остальных Phase-1-детекторов (никакого XML тут не трогаем).
async function detectTokens(seen: string[]): Promise<DetectResult> {
  const materials = await loadJson<{ id: string; name: string; texture?: string | null }[]>(
    'src/data/materials/material.json',
    [],
  )
  const tokens = materials.filter((m) => /token/i.test(m.id))
  const seenSet = new Set(seen)
  const fresh = tokens.filter((m) => !seenSet.has(m.id))
  return {
    newIds: tokens.map((m) => m.id),
    items: fresh.map((m) => ({ id: m.id, name: m.name, image: m.texture ?? null })),
  }
}

// Реакторы - раньше публиковались только "в теории" (комментарий в
// finish-pending.ts обещал, что build-announcements.ts их подхватит), но
// детектора для них тут не было вообще - реальный пробел, найден и закрыт
// 2026-08-07 при разработке кросс-постинга в Telegram-канал.
async function detectReactors(seen: string[]): Promise<DetectResult> {
  const [names, covers] = await Promise.all([
    loadJson<Record<string, string>>('src/data/simulators/reactor/gacha-name-ru.json', {}),
    loadJson<Record<string, string>>('src/data/simulators/reactor/gacha-covers.json', {}),
  ])
  const ids = Object.keys(names)
  const seenSet = new Set(seen)
  const fresh = ids.filter((id) => !seenSet.has(id))
  return {
    newIds: ids,
    items: fresh.map((id) => ({ id, name: names[id], image: covers[id] ?? null })),
  }
}

// Прогноз магазина/daily_news (Фаза 3, задачи A/B) - ledger ключ тут не id, а
// номер спринта: одна публикация на спринт, не на каждый оффер внутри.
// Раньше сворачивали весь спринт в ОДИН summary-item (просто число "N
// предложений") - карточка не могла показать сетку офферов, т.к. данные о
// них терялись. Теперь каждый оффер - отдельный AnnouncementItem с
// id="<sprint>|<itemId>" (префикс спринта нужен странице, чтобы вытащить
// диапазон дат через sprintRangeLabel() без повторного похода в игровые
// файлы). Announcement остаётся ОДИН на спринт (ledger-ключ не меняется).
async function detectShopForecast(seen: string[]): Promise<DetectResult> {
  const forecast = await fetchShopForecast()
  if (!forecast) return { newIds: seen, items: [] }
  const key = String(forecast.sprint)
  const items = forecast.items.map((it) => ({
    id: `${key}|${it.itemId}`,
    name: it.name,
    image: it.image,
    price: it.price,
    ribbon: it.ribbon,
    exactDateLabel: it.exactDateLabel,
  }))
  // Спринт уже опубликован раньше - не новый пост, а дозаполнение exactDateLabel
  // на месте (часть офферов узнают точную дату не в момент первой публикации
  // прогноза, а ближе к своему старту, см. память auto-announcements-architecture).
  if (seen.includes(key)) return { newIds: seen, items: [], updateExisting: { sprintKey: key, items } }
  return { newIds: [...seen, key], items, sprintKey: key }
}

async function detectDailyNews(seen: string[]): Promise<DetectResult> {
  const forecast = await fetchDailyNewsForecast()
  if (!forecast) return { newIds: seen, items: [] }
  const key = String(forecast.sprint)
  const items = forecast.items.map((it) => ({
    id: `${key}|${it.filter}`,
    name: it.name,
    image: it.image ?? forecast.coverImage,
    price: it.price,
    ribbon: it.ribbon,
    exactDateLabel: it.exactDateLabel,
  }))
  if (seen.includes(key)) return { newIds: seen, items: [], updateExisting: { sprintKey: key, items } }
  return { newIds: [...seen, key], items, sprintKey: key }
}

async function detectRebalance(seen: string[]): Promise<DetectResult> {
  const history = await loadJson<{ date: string; entries: { id: string; name: string }[] }[]>(
    'src/data/mutants/rebalance-history.json',
    [],
  )
  const seenSet = new Set(seen)
  const fresh = history.filter((h) => !seenSet.has(h.date))
  return {
    newIds: history.map((h) => h.date),
    items: fresh.map((h) => ({
      id: h.date,
      name: `Ребаланс от ${new Date(h.date).toLocaleDateString('ru-RU')}: ${h.entries.length} мутант(ов)`,
      image: null,
    })),
  }
}

const DETECTORS: {
  category: keyof Ledger
  title: string
  link: string
  run: typeof detectMutants
}[] = [
  { category: 'mutant', title: 'Новые мутанты', link: '/mutants', run: detectMutants },
  { category: 'skin', title: 'Новые скины', link: '/mutants', run: detectSkins },
  { category: 'bingo', title: 'Новые бинго-доски', link: '/bingo', run: detectBingo },
  { category: 'box', title: 'Новые боксы', link: '/boxes', run: detectBoxes },
  { category: 'exchange', title: 'Обновление зала обмена', link: '/mutants', run: detectExchange },
  { category: 'raid', title: 'Новые рейды', link: '/guides', run: detectRaids },
  { category: 'ladder', title: 'Новые лесенки', link: '/guides', run: detectLadders },
  { category: 'token', title: 'Новые жетоны', link: '/materials', run: detectTokens },
  {
    category: 'reactor',
    title: 'Новые реакторы',
    link: '/simulators/reactor',
    run: detectReactors,
  },
  {
    category: 'shopForecast',
    title: 'Прогноз магазина',
    link: '/materials',
    run: detectShopForecast,
  },
  { category: 'dailyNews', title: 'Скоро в игре', link: '/announcements', run: detectDailyNews },
  { category: 'rebalance', title: 'Ребаланс статов', link: '/rebalance', run: detectRebalance },
]

// Личный чат владельца (не публичный канал!) - для тревог о поломках детектора.
// Тот же ENV, что и у detect-new-reactors.ts/detect-new-dungeons.ts.
async function notifyDetectorFailure(category: string, err: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return // тихо, без падения - алертинг это best-effort
  const message = err instanceof Error ? err.message : String(err)
  const text = `🔴 build-announcements: детектор \`${category}\` упал\n\n${message.slice(0, 3500)}`
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'Markdown' },
      { timeout: 10_000 },
    )
  } catch (e) {
    console.error('[ANNOUNCE] Не удалось отправить алерт в Telegram:', e)
  }
}

// Дайджест в ЛИЧНЫЙ чат владельца (TELEGRAM_CHAT_ID, НЕ публичный канал -
// см. notifyDetectorFailure выше и комментарий про CROSS_POST_ENABLED ниже)
// после прогона sync-cron.yml/announcements-hourly.yml, ТОЛЬКО если что-то
// реально нашлось - на "пустых" прогонах (подавляющее большинство часовых
// тиков) молчит, чтобы не спамить. Не зависит от публичного кросс-поста
// (CROSS_POST_ENABLED) - тот сейчас выключен, этот дайджест продолжает
// работать как отдельный операторский сигнал "зайди проверь".
const CATEGORY_ICON: Record<string, string> = {
  mutant: '🧬',
  skin: '🎨',
  bingo: '🎲',
  box: '📦',
  exchange: '🔁',
  raid: '⚔️',
  ladder: '🪜',
  token: '🪙',
  reactor: '🎰',
  shopForecast: '🛒',
  dailyNews: '📰',
  rebalance: '⚖️',
}

async function notifyRunSummary(newlyAdded: Announcement[]): Promise<void> {
  if (newlyAdded.length === 0) return
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return // тихо, best-effort - как и остальные личные алерты

  const lines = newlyAdded.map((a) => {
    const icon = CATEGORY_ICON[a.category] ?? '🔔'
    const count = a.items.length
    return `${icon} ${a.title}${count > 1 ? ` (${count})` : ''}`
  })
  const text = [
    `📋 *Найдено за этот прогон:*`,
    ...lines,
    '',
    `[Открыть /announcements](${'https://archivist-library.com'}/announcements)`,
  ].join('\n')

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'Markdown' },
      { timeout: 10_000 },
    )
  } catch (e) {
    console.error('[ANNOUNCE] Не удалось отправить саммери-дайджест в Telegram:', e)
  }
}

async function main() {
  const { ledger, isBootstrap } = await loadLedger()
  const announcements = await loadJson<Announcement[]>('src/data/announcements.json', [])

  if (isBootstrap) {
    console.log(
      '[ANNOUNCE] Ledger не найден - бутстрап без публикации (сохраняем текущее состояние).',
    )
    // В бутстрапе ЛЮБОЕ падение детектора = отказ сохранять ledger целиком.
    // Иначе категория залетит в ledger пустой, а на следующем прогоне (когда
    // сеть/файл починятся) выстрелит "новыми" пачкой в сотни id разом.
    let bootstrapOk = true
    for (const d of DETECTORS) {
      try {
        const { newIds } = await d.run(ledger[d.category])
        ledger[d.category] = newIds
      } catch (err) {
        bootstrapOk = false
        console.error(`[ANNOUNCE] Бутстрап-детектор ${d.category} упал:`, err)
        await notifyDetectorFailure(`${d.category} (bootstrap)`, err)
      }
    }
    if (bootstrapOk) {
      await saveLedger(ledger)
    } else {
      console.error('[ANNOUNCE] Бутстрап неполный - ledger НЕ сохранён, повтор на след. прогоне.')
    }
    return
  }

  const now = new Date().toISOString()
  const published: string[] = []
  const failed: string[] = []
  const newlyAdded: Announcement[] = []

  for (const d of DETECTORS) {
    try {
      const { newIds, items, updateExisting, sprintKey } = await d.run(ledger[d.category])
      if (items.length > 0) {
        const a: Announcement = {
          id: `${d.category}-${Date.now()}`,
          date: now,
          category: d.category,
          title: items.length === 1 ? items[0].name : `${d.title}: ${items.length}`,
          items,
          link: d.link,
          sprintKey,
        }
        announcements.push(a)
        newlyAdded.push(a)
        published.push(`${d.category} (${items.length})`)
      } else if (updateExisting) {
        // Спринт уже опубликован - не новый пост, а дозаполнение items
        // (exactDateLabel) в УЖЕ существующей записи. Не трогает id/date/
        // title - на ленте это не выглядит как новый анонс, notifyRunSummary/
        // кросс-пост не триггерятся (announcements/newlyAdded не пополняются).
        const existing = announcements.find(
          (a2) => a2.category === d.category && a2.sprintKey === updateExisting.sprintKey,
        )
        if (existing) existing.items = updateExisting.items
      }
      // Ledger обновляется ТОЛЬКО при успехе: если детектор упал, оставляем
      // старое значение - на следующем прогоне попробуем ещё раз, ничего не
      // потеряется.
      ledger[d.category] = newIds
    } catch (err) {
      failed.push(d.category)
      console.error(`[ANNOUNCE] Детектор ${d.category} упал:`, err)
      await notifyDetectorFailure(d.category, err)
    }
  }

  await saveLedger(ledger)
  await fs.writeFile(ANNOUNCEMENTS_PATH, JSON.stringify(announcements, null, 2) + '\n', 'utf-8')

  // Кросс-пост в Telegram-канал ОТКЛЮЧЁН 2026-08-08 (юзер: "пока надо
  // отключить" - после нескольких раундов нестабильности скриншот-эндпоинта
  // на холодном Vercel-контейнере решил не постить в ПУБЛИЧНЫЙ канал, пока
  // не решили, оставлять ли картиночный кросс-пост вообще или заменить на
  // текстовый алерт "на сайте что-то новое"). Код ниже рабочий и не удалён -
  // просто выключен флагом, чтобы включить обратно было одной правкой.
  const CROSS_POST_ENABLED = false
  if (CROSS_POST_ENABLED) {
    // shopForecast/dailyNews объединяются в один пост (юзер: "dailyNews можно
    // засунуть в прогноз магазина"), rebalance никогда не кросс-постится
    // (юзер: "уже есть человек, который делает это вручную").
    const shopForecastPost = newlyAdded.find((a) => a.category === 'shopForecast') ?? null
    const dailyNewsPost = newlyAdded.find((a) => a.category === 'dailyNews') ?? null
    if (shopForecastPost || dailyNewsPost) {
      await postShopAndDailyNews(shopForecastPost, dailyNewsPost).catch((err) =>
        console.error('[CROSS-POST] shopForecast/dailyNews:', err),
      )
    }
    // Пауза между постами - несколько скриншот-эндпоинтов подряд без неё на
    // живом прогоне 2026-08-07 упирались в исчерпание /tmp одного тёплого
    // Vercel-контейнера (см. cleanupStalePlaywrightProfiles в
    // src/lib/chromium-tmp-cleanup.ts - подметает мусор, но не резиновое место).
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    for (const a of newlyAdded) {
      if (
        a.category === 'rebalance' ||
        a.category === 'shopForecast' ||
        a.category === 'dailyNews'
      ) {
        continue
      }
      await crossPostAnnouncement(a).catch((err) =>
        console.error(`[CROSS-POST] ${a.category}:`, err),
      )
      await sleep(5000)
    }
  } else if (newlyAdded.length > 0) {
    console.log(
      `[CROSS-POST] Отключён (CROSS_POST_ENABLED=false) - ${newlyAdded.length} новых записей не отправлены в канал.`,
    )
  }

  await notifyRunSummary(newlyAdded)

  const cacheDir = path.join(ROOT, 'scripts/.cache')
  await fs.mkdir(cacheDir, { recursive: true })
  const parts: string[] = ['### Авто-анонсы']
  if (published.length > 0) parts.push(`✅ Опубликовано: ${published.join(', ')}`)
  else parts.push('ℹ️ Новых записей нет')
  if (failed.length > 0) parts.push(`🔴 Упали детекторы: ${failed.join(', ')}`)
  const summary = parts.join('\n')
  await fs.writeFile(path.join(cacheDir, 'announcements-summary.md'), summary + '\n', 'utf-8')
  console.log(summary)
}

main().catch((err) => {
  console.error('[ANNOUNCE] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
