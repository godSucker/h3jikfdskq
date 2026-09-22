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
import {
  currentSprint,
  sprintRangeLabel,
  sprintStartDate,
  formatExactRangeRu,
  formatDateRu,
} from '../src/lib/sprint-calendar'
import { parseOfferRibbon, parseRealPriceUSD, type OfferRibbon } from './shop-offer-tags'
import { loadFilterDates, pickFilterDateRange } from './kartel-filter-dates'
import { loadPromoPercents } from './kartel-promo-percents'
import { getSprintDayMap, fetchShopForecast } from './detect-shop-forecast'
import { fetchGameXml } from './game-xml-cache'

// Баннер "BACK FOR 24H ONLY" - см. сдвиг дат и подмену блока в конце fetch.
const BANNER_24H_RE = /^Daily_news_shop_24h_/i
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
  exactDateStart: string | null
  // См. AnnouncementItem в build-announcements.ts: страница анонсов собирает
  // подпись даты на языке посетителя по ISO-датам, а не по русской строке.
  exactDateEnd: string | null
  exactDateApprox?: boolean
  // Живой процент скидки (ABGetExperiments, см. kartel-promo-percents.ts) -
  // сейчас только для баннера тех-центра (TECH_CENTER_DISCOUNT_FILTERS ниже).
  // null, если живых данных нет или акции сейчас нет (эксперимент на "Default").
  discountPercent?: number | null
}

// Единственный баннер dailypopup.xml, для которого мы знаем связку с
// экспериментами промо-процентов (см. память auto-announcements-architecture,
// "скидка на эво датируется на день позже" - тот же разбор вскрыл и это).
// HC (золото) и SC (серебро) - независимо настраиваемые панели, на практике
// пока всегда совпадали, но структурно могут разойтись - тогда показываем
// меньший (не завышаем скидку, если по факту она разная для двух валют).
const TECH_CENTER_DISCOUNT_FILTERS: Record<string, [string, string]> = {
  Daily_news_tech_V2: ['Mutants-Promo-TechCenter-HC', 'Mutants-Promo-TechCenter-SC'],
}

function techCenterDiscount(filter: string, promoPercents: Record<string, number>): number | null {
  const pair = TECH_CENTER_DISCOUNT_FILTERS[filter]
  if (!pair) return null
  const values = pair.map((name) => promoPercents[name]).filter((v): v is number => v != null)
  return values.length > 0 ? Math.min(...values) : null
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
  const [xml, locRaw] = await Promise.all([fetchGameXml(SHOPITEMS_URL), fetchGameXml(LOC_RU_URL)])

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

// sprintOverride - см. detect-shop-forecast.ts::fetchShopForecast, тот же
// разовый бэкафилл-параметр, часовой пайплайн его не передаёт.
export async function fetchDailyNewsForecast(
  sprintOverride?: number,
  // false - служебный вызов за ПРОШЛЫЙ блок: вернуть его офферы как есть, без
  // повторного подтягивания баннеров (иначе рекурсия на всю историю спринтов).
  pullPrevBanners = true,
): Promise<DailyNewsForecast | null> {
  const [{ data: xml }, shopIndex] = await Promise.all([
    axios.get<string>(DAILYPOPUP_URL, { responseType: 'text', timeout: 20000 }),
    buildShopItemIndex(),
  ])

  const target = sprintOverride ?? currentSprint() + 1
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
  const promoPercents = await loadPromoPercents()

  // См. detect-shop-forecast.ts::fetchShopForecast - тот же фикс "чужая
  // дата по переиспользованному generic Filter-тегу" (LuckyBox_Research_IX
  // регрессия 2026-09-08). Окно того же спринта +- 3 дня на границы.
  const DAY_MS = 86_400_000
  const sprintWindowStart = sprintStartDate(target).getTime() - 3 * DAY_MS
  const sprintWindowEnd = sprintStartDate(target + 1).getTime() + 3 * DAY_MS

  // У <Offer> в dailypopup.xml дат нет в принципе - только принадлежность к
  // спринту. Но 17 из 22 несут <Tag key="entity"> со ссылкой на shopitem, а
  // тем даты уже посчитаны (specimen-якоря + наследование по дневным группам,
  // см. detect-shop-forecast.ts). Берём день оттуда, когда живого kartel-окна
  // на сам баннер нет - иначе весь блок "Скоро в игре" на новый спринт стоит
  // без дат, пока kartel до него не дотянется (спринт 257: было 0 из 22).
  // Карту дней считает fetchShopForecast. Раньше тут был просто
  // getSprintDayMap(target) в расчёте на то, что детектор shopForecast в
  // build-announcements.ts стоит РАНЬШЕ dailyNews - переставили бы местами, и
  // даты молча пропали бы. Теперь зависимость явная: если карты нет, считаем
  // её сами. Повторный вызов дешёвый - shopitems.xml и локализация лежат в
  // кеше прогона (game-xml-cache.ts), сеть не трогается.
  let dayMap = getSprintDayMap(target)
  if (!dayMap) {
    await fetchShopForecast(target).catch(() => null)
    dayMap = getSprintDayMap(target)
  }

  const items: DailyNewsItem[] = []
  for (const it of rawItems) {
    const image = it.imageRaw ? await resolveOfferBanner(it.imageRaw) : null
    const shopInfo = it.entity ? shopIndex.get(it.entity.toLowerCase()) : undefined
    const rawExactRange = pickFilterDateRange(filterDates, it.filter)
    const exactRange =
      rawExactRange &&
      new Date(rawExactRange.start).getTime() >= sprintWindowStart &&
      new Date(rawExactRange.start).getTime() < sprintWindowEnd
        ? rawExactRange
        : null
    const inheritedMs =
      !exactRange && it.entity ? (dayMap?.get(it.entity.toLowerCase()) ?? null) : null
    items.push({
      filter: it.filter,
      name: shopInfo?.name ?? prettifyFilter(it.filter),
      category: it.category,
      image,
      price: shopInfo?.price ?? null,
      ribbon: shopInfo?.ribbon ?? null,
      discountPercent: techCenterDiscount(it.filter, promoPercents),
      exactDateLabel: exactRange
        ? formatExactRangeRu(
            new Date(exactRange.start),
            exactRange.end ? new Date(exactRange.end) : null,
          )
        : inheritedMs != null
          ? `≈ ${formatDateRu(new Date(inheritedMs))}`
          : null,
      exactDateStart:
        exactRange?.start ?? (inheritedMs != null ? new Date(inheritedMs).toISOString() : null),
      exactDateEnd: exactRange?.end ?? null,
      exactDateApprox: !exactRange && inheritedMs != null,
    })
  }

  // Офферы БЕЗ entity - это чистые ивент-анонсы (смена зала обмена, 24h-
  // баннер, будущая скидка на эво и т.п.), у них связи с shopitems нет вообще.
  // Датируем по соседям: блок dailypopup идёт той же обратной хронологией, что
  // и спринт-блок shopitems (проверено сверкой порядка с внешней хронологией -
  // совпал 1-в-1). Берём ближайший по позиции датированный оффер, при равном
  // расстоянии сверху/снизу - середину, округляя к более поздней дате.
  // На спринте 257 таких офферов 6 (зал обмена, оба 24h-баннера, tech, зодиак-
  // мутант, paywall) - все 6 легли день-в-день против внешней хронологии.
  const known = items.map((it) =>
    it.exactDateStart ? new Date(it.exactDateStart).getTime() : null,
  )
  for (let i = 0; i < items.length; i++) {
    if (known[i] != null) continue
    let up: { dist: number; ms: number } | null = null
    for (let j = i - 1; j >= 0; j--) {
      if (known[j] != null) {
        up = { dist: i - j, ms: known[j]! }
        break
      }
    }
    let down: { dist: number; ms: number } | null = null
    for (let j = i + 1; j < items.length; j++) {
      if (known[j] != null) {
        down = { dist: j - i, ms: known[j]! }
        break
      }
    }
    let ms: number | null = null
    if (up && down) {
      if (up.dist === down.dist) {
        const diffDays = Math.round((up.ms - down.ms) / DAY_MS)
        ms = down.ms + Math.ceil(diffDays / 2) * DAY_MS
      } else {
        ms = up.dist < down.dist ? up.ms : down.ms
      }
    } else {
      ms = up?.ms ?? down?.ms ?? null
    }
    if (ms == null || ms < sprintWindowStart || ms >= sprintWindowEnd) continue
    items[i].exactDateLabel = `≈ ${formatDateRu(new Date(ms))}`
    items[i].exactDateStart = new Date(ms).toISOString()
    items[i].exactDateEnd = null
    items[i].exactDateApprox = true
  }

  // Баннер "BACK FOR 24H ONLY" (Daily_news_shop_24h_*) - единственный оффер
  // dailypopup, у которого окно показа НЕ совпадает с тем, что на картинке.
  // kartel честно отдаёт неделю показа самого баннера (у 257a это 19-26
  // сентября - ровно СБ-ПТ и ровно 7 суточных офферов магазина той недели),
  // но семёрка мутантов, нарисованная на баннере, относится к неделе на
  // спринт позже. Юзер сверил живьём 2026-09-18: картинка 257a - это 3-10
  // октября, 257b - 10-17 октября. Карточка показывает именно картинку,
  // поэтому подпись двигаем к ней (+2 недели), а не наоборот.
  //
  // Сдвиг обязан идти ПОСЛЕ интерполяции по соседям выше: там бездатные
  // офферы датируются по ближайшему датированному соседу, и сдвинутый баннер
  // утащил бы за собой чужие даты на те же +2 недели.
  const BANNER_24H_SHIFT_MS = 14 * DAY_MS

  // Баннеры одного блока - соседние недели одного спринта (суффикс a = первая,
  // b = вторая), поэтому окно одного восстанавливается из окна другого ровно
  // через 7 дней. Нужно, когда kartel отдал окно только одному из двух: второй
  // иначе остаётся на "≈ дате по соседям" из интерполяции выше, хотя его
  // неделя известна точно (живой пример 2026-09-18: у 256b окно есть, у 256a
  // нет, и карточка спринта 257 показывала "≈ 19 сентября" вместо "19-26").
  const blockBanners = items
    .filter((it) => BANNER_24H_RE.test(it.filter))
    .map((it) => ({
      it,
      week: /_(\d+)([ab])$/i.exec(it.filter)?.[2]?.toLowerCase() === 'b' ? 1 : 0,
    }))
  const anchor = blockBanners.find((b) => b.it.exactDateStart && !b.it.exactDateApprox)
  if (anchor) {
    const anchorMs = new Date(anchor.it.exactDateStart!).getTime()
    for (const b of blockBanners) {
      if (b === anchor || (b.it.exactDateStart && !b.it.exactDateApprox)) continue
      const startMs = anchorMs + (b.week - anchor.week) * 7 * DAY_MS
      b.it.exactDateStart = new Date(startMs).toISOString()
      b.it.exactDateEnd = new Date(startMs + 7 * DAY_MS).toISOString()
      b.it.exactDateApprox = false
    }
  }

  for (const it of items) {
    if (!BANNER_24H_RE.test(it.filter) || !it.exactDateStart) continue
    const startMs = new Date(it.exactDateStart).getTime() + BANNER_24H_SHIFT_MS
    const start = new Date(startMs)
    // Баннер по построению покрывает ровно неделю - семь клеток СБ..ПТ. У
    // части старых записей сервер отдаёт мусорный конец (у 255a это "22
    // августа -> 29 сентября", у 255b и вовсе конец РАНЬШЕ начала), и такой
    // диапазон после сдвига превращался в "12 сентября - 19 августа".
    // Доверяем только концу, который реально отстоит от начала на неделю,
    // иначе считаем его сами.
    const rawEndMs = it.exactDateEnd
      ? new Date(it.exactDateEnd).getTime() + BANNER_24H_SHIFT_MS
      : null
    const weekMs = 7 * DAY_MS
    const sane =
      rawEndMs != null && Math.abs(rawEndMs - startMs - weekMs) <= DAY_MS
        ? rawEndMs
        : startMs + weekMs
    const end = it.exactDateApprox ? null : new Date(sane)
    it.exactDateStart = start.toISOString()
    it.exactDateEnd = end ? end.toISOString() : null
    it.exactDateLabel = it.exactDateApprox
      ? `≈ ${formatDateRu(start)}`
      : formatExactRangeRu(start, end)
  }

  // ...и поэтому баннер этого блока описывает НЕ этот спринт, а следующий:
  // после сдвига его недели уезжают за правую границу окна спринта. Карточка
  // "Скоро в игре" должна описывать только свой спринт целиком, поэтому свой
  // баннер отдаём следующему спринту, а себе забираем баннер ПРЕДЫДУЩЕГО
  // блока - после того же сдвига его недели ложатся ровно на две недели
  // этого спринта (у спринта 257 это 256a = 19-26 сентября и 256b = 26
  // сентября - 3 октября). Так в текущем анонсе всегда висят баннеры,
  // совпадающие по времени с самим анонсом (просьба юзера 2026-09-18).
  if (pullPrevBanners) {
    const prev = await fetchDailyNewsForecast(target - 1, false).catch(() => null)
    const prevBanners = (prev?.items ?? []).filter((it) => BANNER_24H_RE.test(it.filter))
    const own = items.filter((it) => !BANNER_24H_RE.test(it.filter))
    items.length = 0
    items.push(...own, ...prevBanners)
  }

  const year = sprintStartDate(target).getUTCFullYear()
  const coverImage = items.find((it) => it.image)?.image ?? (await findCoverImage(target, year))

  return { sprint: target, dateRangeLabel: sprintRangeLabel(target), items, coverImage }
}
