// Анонс ближайших daily_news-баннеров (Фаза 3, задача B). dailypopup.xml
// размечен теми же SPRINT-метками, что shopitems.xml (см. src/lib/sprint-
// calendar.ts) - берём блок офферов под ближайшим ещё не наступившим спринтом
// и достаём баннер каждого.
//
// ИСПРАВЛЕНО 2026-08-07: у каждого <Offer> есть СВОЙ путь картинки
// (image="hud/daily_news/news_X$$.jpg") - баннер РЕАЛЬНО существует, просто
// нужен языковой суффикс (-ru.jpg/-en.jpg), который я раньше не добавлял и
// поэтому ловил 404 на голом "news_X.jpg". Пользователь прислал список
// подтверждённых рабочих URL той же схемы (news_release_shop_db_13-ru.jpg,
// news_adaptive_shield-ru.jpg и т.д.) - все 200 OK. Пробуем -ru, потом -en.
export const LANG_SUFFIXES = ['ru', 'en'] as const

import axios from 'axios'
import { currentSprint, sprintRangeLabel, sprintStartDate, formatExactRangeRu } from '../src/lib/sprint-calendar'
import { parseOfferRibbon, parseRealPriceUSD, type OfferRibbon } from './shop-offer-tags'
import { loadFilterDates, pickFilterDateRange } from './kartel-filter-dates'

const DAILYPOPUP_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dailypopup.xml'
const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const BANNER_BASE = 'https://s-beta.kobojo.com/mutants/assets/hud/daily_news/'
const ASSETS_BASE = 'https://s-beta.kobojo.com/mutants/assets/'

export interface DailyNewsPrice {
  amount: number
  type: 'hardcurrency' | 'softcurrency' | 'usd'
}
interface DailyNewsItem {
  filter: string
  name: string
  category: string | null
  image: string | null
  price: DailyNewsPrice | null
  ribbon: OfferRibbon | null
  // См. detect-shop-forecast.ts - тот же live-источник (kartel-filter-dates).
  exactDateLabel: string | null
}

function balanceQuotes(name: string): string {
  const open = (name.match(/«/g) ?? []).length
  const close = (name.match(/»/g) ?? []).length
  return open > close ? name + '»'.repeat(open - close) : name
}

// dailypopup.xml хранит только внутренний Filter-тег ("Shop_Mystery_Anniversary26_2",
// "filter_dungeon_hexcity_2") без готового названия - но большинство офферов
// (17/24 на живой проверке 2026-08-07) несут Tag key="entity" со ссылкой на
// РЕАЛЬНЫЙ itemId из shopitems.xml (тот же продукт, что продаётся в магазине) -
// резолвим его имя через ту же локализацию, что build-boxes.ts/
// detect-shop-forecast.ts. Офферы БЕЗ entity (чистые ивент-анонсы вроде
// "скоро данж hexcity_2", банк-фичи) остаются на причёсанном id - для них
// localisation-ключа просто не существует.
function prettifyFilter(filter: string): string {
  return filter
    .replace(/^(shop_|filter_dungeon_|filter_)/i, '')
    .replace(/_/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

export interface DailyNewsForecast {
  sprint: number
  dateRangeLabel: string
  items: DailyNewsItem[]
  coverImage: string | null
}

// Подтверждённый рабочий паттерн (подсказка коллеги, 2026-08-07): "24-часовой"
// флеш-сейл баннер, публикуется на КАЖДУЮ половину спринта. Используем как
// общую обложку блока анонса, раз у отдельных офферов своих картинок нет.
async function findCoverImage(sprint: number, year: number): Promise<string | null> {
  for (const half of ['a', 'b'] as const) {
    const url = `${BANNER_BASE}news_shop_24h_${year}_${sprint}${half}-ru.jpg`
    if (await bannerExists(url)) return url
  }
  return null
}

async function bannerExists(url: string): Promise<boolean> {
  try {
    const res = await axios.head(url, {
      timeout: 8000,
      validateStatus: (s) => s === 200 || s === 404,
    })
    return res.status === 200
  } catch {
    return false
  }
}

// image="hud/daily_news/news_X$$.jpg" - путь УЖЕ содержит "hud/daily_news/",
// поэтому база - ASSETS_BASE (общий assets/), не BANNER_BASE. "$$" убираем,
// дальше пробуем оба языковых суффикса по очереди.
async function resolveOfferBanner(imageRaw: string): Promise<string | null> {
  const base = imageRaw.replace(/\$\$/g, '').replace(/\.jpg$/i, '')
  for (const lang of LANG_SUFFIXES) {
    const url = `${ASSETS_BASE}${base}-${lang}.jpg`
    if (await bannerExists(url)) return url
  }
  return null
}

interface ShopItemInfo {
  name: string
  price: DailyNewsPrice | null
  ribbon: OfferRibbon | null
}

async function buildShopItemIndex(): Promise<Map<string, ShopItemInfo>> {
  const [{ data: xml }, { data: locRaw }] = await Promise.all([
    axios.get<string>(SHOPITEMS_URL, { responseType: 'text', timeout: 20000 }),
    axios.get<string>(LOC_RU_URL, { responseType: 'text', timeout: 20000 }),
  ])

  const loc = new Map<string, string>()
  const locLower = new Map<string, string>()
  for (const rawLine of locRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const i = line.indexOf(';')
    if (i === -1) continue
    const key = line.slice(0, i)
    const val = line.slice(i + 1)
    loc.set(key, val)
    if (!locLower.has(key.toLowerCase())) locLower.set(key.toLowerCase(), val)
  }
  const lookup = (key: string) => loc.get(key) ?? locLower.get(key.toLowerCase())

  function resolveName(itemId: string, caption: string | undefined): string {
    const byItemId = lookup(itemId)
    if (byItemId) return balanceQuotes(byItemId)
    const withoutTrailingDigits = itemId.replace(/\d+$/, '')
    if (withoutTrailingDigits !== itemId) {
      const byStripped = lookup(withoutTrailingDigits)
      if (byStripped) return balanceQuotes(byStripped)
    }
    if (caption) {
      const strippedKey = caption
        .replace(/^\$/, '')
        .replace(/_(description|payment_text|tooltip)$/, '')
      const byCaption = lookup(strippedKey) ?? lookup(caption)
      if (byCaption && byCaption.length <= 80) return balanceQuotes(byCaption)
    }
    return itemId
      .replace(/^#\w+-\d+-/, '')
      .replace(/^#/, '')
      .replace(/_/g, ' ')
      .trim()
  }

  const index = new Map<string, ShopItemInfo>()
  for (const itemXml of xml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    if (!itemId) continue
    const caption = itemXml.match(/caption="([^"]+)"/)?.[1]
    const costMatch = itemXml.match(/<Cost amount="(\d+)" type="(hardcurrency|softcurrency)"\s*\/>/)
    const usd = costMatch ? null : parseRealPriceUSD(itemXml)
    const offerTag = itemXml.match(/offerTag="([^"]+)"/)?.[1]
    index.set(itemId.toLowerCase(), {
      name: resolveName(itemId, caption),
      price: costMatch
        ? { amount: Number(costMatch[1]), type: costMatch[2] as 'hardcurrency' | 'softcurrency' }
        : usd !== null
          ? { amount: usd, type: 'usd' }
          : null,
      ribbon: parseOfferRibbon(offerTag),
    })
  }
  return index
}

export async function fetchDailyNewsForecast(): Promise<DailyNewsForecast | null> {
  const [{ data: xml }, shopIndex] = await Promise.all([
    axios.get<string>(DAILYPOPUP_URL, { responseType: 'text', timeout: 20000 }),
    buildShopItemIndex(),
  ])

  const target = currentSprint() + 1
  const markerRe = new RegExp(`<!--\\s*DEBUT SPRINT ${target}\\s*-->`)
  const markerMatch = xml.match(markerRe)
  if (!markerMatch || markerMatch.index === undefined) return null

  const startIdx = markerMatch.index + markerMatch[0].length
  const nextMarkerIdx = xml.indexOf('<!-- DEBUT SPRINT', startIdx)
  const block = xml.slice(startIdx, nextMarkerIdx === -1 ? undefined : nextMarkerIdx)

  const rawItems: {
    filter: string
    category: string | null
    imageRaw: string | null
    entity: string | null
  }[] = []
  for (const offerXml of block.match(/<Offer\b[^>]*>[\s\S]*?<\/Offer>/g) ?? []) {
    const filter = offerXml.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    const category = offerXml.match(/category="([^"]*)"/)?.[1] ?? null
    const imageRaw = offerXml.match(/image="([^"]+)"/)?.[1] ?? null
    const entity = offerXml.match(/<Tag key="entity" value="([^"]*)"\s*\/>/)?.[1] ?? null
    if (filter) rawItems.push({ filter, category, imageRaw, entity })
  }

  const filterDates = await loadFilterDates()

  const items: DailyNewsItem[] = []
  for (const it of rawItems) {
    const image = it.imageRaw ? await resolveOfferBanner(it.imageRaw) : null
    const shopInfo = it.entity ? shopIndex.get(it.entity.toLowerCase()) : undefined
    const exactRange = pickFilterDateRange(filterDates, it.filter)
    items.push({
      filter: it.filter,
      name: shopInfo?.name ?? prettifyFilter(it.filter),
      category: it.category,
      image,
      price: shopInfo?.price ?? null,
      ribbon: shopInfo?.ribbon ?? null,
      exactDateLabel: exactRange
        ? formatExactRangeRu(new Date(exactRange.start), exactRange.end ? new Date(exactRange.end) : null)
        : null,
    })
  }

  const year = sprintStartDate(target).getUTCFullYear()
  const coverImage = items.find((it) => it.image)?.image ?? (await findCoverImage(target, year))

  return { sprint: target, dateRangeLabel: sprintRangeLabel(target), items, coverImage }
}
