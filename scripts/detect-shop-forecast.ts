// Анонс "что появится в магазине через 1-2 недели" (Фаза 3, задача A). Референс
// по стилю подачи - MUTODEX (pokradex.org), еженедельные посты с датами. НЕ
// полный магазин с архивом - только витрина ближайшего будущего спринта.
//
// КЛЮЧЕВАЯ находка 2026-08-07: beta и прод дают ОДИНАКОВЫЙ набор SPRINT-меток в
// shopitems.xml (проверено - max одинаков на обоих хостах) - "опережение" тут
// не про beta vs прод (тот трюк не работает, см. память beta-cdn-plain-watch
// про prod==beta ловушку). Игра просто публикует данные СЛЕДУЮЩЕГО спринта в
// файл чуть раньше, чем включает его игрокам. Поэтому "скоро" определяем через
// src/lib/sprint-calendar.ts: currentSprint(сегодня) - расчётный номер "живого"
// спринта, всё что СТРОГО больше - ещё не наступило, но уже видно в файле.
//
// Иконки НЕ качаем на свой CDN (в отличие от build-boxes.ts/build-special-
// offers.ts, которые формируют постоянный каталог) - просто хотлинк на Kobojo
// CDN thumbnail, textureUrl() пропускает http-абсолютные пути как есть. Если
// итоговый предмет позже реально попадёт на сайт (через build-boxes.ts/
// build-special-offers.ts), у него появится свой постоянный арт - здесь нужен
// только превью на 1-2 недели, отдельно грузить его на свой CDN избыточно.

import axios from 'axios'
import {
  currentSprint,
  sprintRangeLabel,
  sprintStartDate,
  formatExactRangeRu,
} from '../src/lib/sprint-calendar'
import { parseOfferRibbon, parseRealPriceUSD, type OfferRibbon } from './shop-offer-tags'
import { loadFilterDates, pickFilterDateRange, type FilterDateRange } from './kartel-filter-dates'

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const THUMB_BASE = 'https://s-beta.kobojo.com/mutants/assets/thumbnails/'

// Часть picture-атрибутов несёт "$$" - тот же плейсхолдер локали, что у
// баннеров daily_news (resolveOfferBanner в detect-daily-news.ts). Найдено
// 2026-09-04 на живом баге ("Жизни пакет" 404) - слепое вырезание "$$" (как
// было раньше) даёт несуществующий URL, нужна подстановка -ru/-en. 141 запись
// в истории shopitems.xml так размечена - не единичный случай. У большинства
// picture БЕЗ "$$" - для них ничего не меняется, прямой URL как раньше.
async function resolveThumbnailUrl(picture: string): Promise<string | null> {
  if (!picture.includes('$$')) return `${THUMB_BASE}${picture}.png`
  for (const lang of ['ru', 'en']) {
    const url = `${THUMB_BASE}${picture.replace('$$', `-${lang}`)}.png`
    try {
      const res = await axios.head(url, {
        timeout: 8000,
        validateStatus: (s) => s === 200 || s === 404,
      })
      if (res.status === 200) return url
    } catch {
      // сеть упала - пробуем следующий суффикс, ниже общий null-фоллбек
    }
  }
  return null
}

function balanceQuotes(name: string): string {
  const open = (name.match(/«/g) ?? []).length
  const close = (name.match(/»/g) ?? []).length
  return open > close ? name + '»'.repeat(open - close) : name
}

// "Мутанта недели"/"мутанта месяца" определяем по длине живого окна оффера
// (kartel filters[].startDate/endDate, см. scripts/kartel-filter-dates.ts):
// обычный мутант-оффер держится 1-2 дня, недельный - ровно ~7, месячный -
// ~28-31 (проверено на спринтах 255-256: Скарамуш 7-14 сент = 7 дней;
// Виргон 23 авг - 23 сент = 31; Флипфлоп 2-30 сент = 28). Между 2 и 7 днями
// у мутант-офферов пусто - пороги с запасом. Гейт по Specimen_ обязателен:
// 7-дневные и 30-дневные окна бывают и у контейнеров/банков/обменников.
export function classifyFeaturedMutant(
  itemId: string,
  start: string | null,
  end: string | null,
): 'week' | 'month' | null {
  if (!start || !end) return null
  if (!/^-*#?specimen_/i.test(itemId)) return null
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000
  if (days >= 6 && days <= 9) return 'week'
  if (days >= 25 && days <= 33) return 'month'
  return null
}

export interface ForecastPrice {
  amount: number
  type: 'hardcurrency' | 'softcurrency' | 'usd'
}
interface ForecastItem {
  itemId: string
  name: string
  image: string | null
  price: ForecastPrice | null
  ribbon: OfferRibbon | null
  // Точный диапазон ЭТОГО оффера (не всего спринта), из живого kartel-запроса
  // - см. scripts/kartel-filter-dates.ts. null, если live-данных нет (шаг не
  // запускался/оффер не нашёлся среди фильтров) - card.astro в этом случае
  // падает обратно на sprintRangeLabel(sprint), как было раньше.
  exactDateLabel: string | null
  // ISO-дата начала (не форматированная) - нужна для хронологической
  // сортировки офферов на странице (ближайшие сверху), formatExactRangeRu()
  // теряет сортируемость (текст с названием месяца).
  exactDateStart: string | null
  // 'week'/'month', если это мутант-оффер с окном ~7 или ~28-31 день - см.
  // classifyFeaturedMutant. 'day' - оффер из пула daily-offer (см.
  // fetchDailyMutantOffers), проставляется напрямую, не через
  // classifyFeaturedMutant (там окно 1-2 дня для ОБЫЧНОГО спринтового
  // оффера ничего не значит - тут источник уже точно известен по Path).
  // null для не-мутантов и обычных коротких окон.
  featuredMutant: 'day' | 'week' | 'month' | null
}

export interface ShopForecast {
  sprint: number
  dateRangeLabel: string
  items: ForecastItem[]
}

// sprintOverride - только для разового ручного бэкафилла (см.
// scripts/backfill-sprint-announcements.ts) - публикует уже прошедшие/живые
// спринты через тот же парсер, не только "следующий" (по умолчанию). Часовой
// автоматический пайплайн (build-announcements.ts) его не передаёт - там
// всегда currentSprint()+1, как было.
export async function fetchShopForecast(sprintOverride?: number): Promise<ShopForecast | null> {
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

  const target = sprintOverride ?? currentSprint() + 1
  const marker = `----------------------------// SPRINT ${target} \\\\----------------------------`
  const startIdx = xml.indexOf(`itemId="${marker}"`)
  if (startIdx === -1) return null

  // Файл идёт от новых спринтов к старым - следующий маркер после нашего
  // (любой "SPRINT N") обозначает конец блока текущего спринта.
  const afterMarkerTag = xml.indexOf('</ShopItem>', startIdx) + '</ShopItem>'.length
  const nextMarkerIdx = xml.indexOf('SPRINT', afterMarkerTag)
  const block = xml.slice(
    afterMarkerTag,
    nextMarkerIdx === -1 ? undefined : xml.lastIndexOf('<ShopItem', nextMarkerIdx),
  )

  const filterDates = await loadFilterDates()

  // Общий разбор одного <ShopItem> - используется и для спринтового блока
  // (ниже), и для пула daily-offer (fetchDailyMutantOffers). forceFeatured
  // проставляет featuredMutant напрямую (для daily-offer источник уже точно
  // известен по Path, classifyFeaturedMutant по длине окна тут не нужен и
  // была бы неверна - у daily-оффера окно 1-2 дня, а не 7/28-31).
  async function buildItem(
    itemXml: string,
    forceFeatured?: 'day',
  ): Promise<{ item: ForecastItem; exactRange: FilterDateRange | null } | null> {
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    const hidden = itemXml.match(/hidden="([^"]+)"/)?.[1]
    const picture = itemXml.match(/picture="([^"]+)"/)?.[1]
    const caption = itemXml.match(/caption="([^"]+)"/)?.[1]
    if (!itemId || hidden === 'true') return null
    const costMatch = itemXml.match(/<Cost amount="(\d+)" type="(hardcurrency|softcurrency)"\s*\/>/)
    const usd = costMatch ? null : parseRealPriceUSD(itemXml)
    const offerTag = itemXml.match(/offerTag="([^"]+)"/)?.[1]
    const filterTag = itemXml.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    const exactRange = pickFilterDateRange(filterDates, filterTag)
    return {
      exactRange,
      item: {
        itemId,
        name: resolveName(itemId, caption),
        image: picture ? await resolveThumbnailUrl(picture) : null,
        price: costMatch
          ? { amount: Number(costMatch[1]), type: costMatch[2] as 'hardcurrency' | 'softcurrency' }
          : usd !== null
            ? { amount: usd, type: 'usd' }
            : null,
        ribbon: parseOfferRibbon(offerTag),
        exactDateLabel: exactRange
          ? formatExactRangeRu(
              new Date(exactRange.start),
              exactRange.end ? new Date(exactRange.end) : null,
            )
          : null,
        exactDateStart: exactRange?.start ?? null,
        featuredMutant:
          forceFeatured ??
          classifyFeaturedMutant(itemId, exactRange?.start ?? null, exactRange?.end ?? null),
      },
    }
  }

  const items: ForecastItem[] = []
  for (const itemXml of block.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const built = await buildItem(itemXml)
    if (built) items.push(built.item)
  }

  // "Дневной мутант" (запрошено юзером 2026-09-08, пост @KaiserZ с недельным
  // календарём - t.me/mutants_mgg_fb/9483) - пул daily-offer (Path
  // cat="special" subCat="dailyoffer", category="specimen", 1157 записей на
  // 2026-09-08) физически лежит ВНЕ спринтовых маркеров, но несёт тот же
  // <Filter>Shop_<itemId></Filter>, что и обычные офферы - джойн по kartel
  // работает 1-в-1. Скоуп по [sprintStart, nextSprintStart) - без него один
  // и тот же daily-оффер мог бы попасть и в fetchShopForecast(cs), и в
  // fetchShopForecast(cs+1) (оба вызова парсят один и тот же xml целиком).
  const beforeDaily = items.length
  await appendDailyMutantOffers(xml, target, buildItem, items)
  console.log(
    `[forecast] shopForecast спринт ${target}: дневных мутантов ${items.length - beforeDaily}`,
  )

  return { sprint: target, dateRangeLabel: sprintRangeLabel(target), items }
}

async function appendDailyMutantOffers(
  xml: string,
  sprint: number,
  buildItem: (
    itemXml: string,
    forceFeatured?: 'day',
  ) => Promise<{ item: ForecastItem; exactRange: FilterDateRange | null } | null>,
  items: ForecastItem[],
): Promise<void> {
  const windowStart = sprintStartDate(sprint).getTime()
  const windowEnd = sprintStartDate(sprint + 1).getTime()
  for (const itemXml of xml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    if (!itemXml.includes('subCat="dailyoffer"') || !itemXml.includes('category="specimen"')) {
      continue
    }
    const built = await buildItem(itemXml, 'day')
    if (!built?.exactRange?.start) continue
    const startMs = new Date(built.exactRange.start).getTime()
    if (Number.isNaN(startMs) || startMs < windowStart || startMs >= windowEnd) continue
    items.push(built.item)
  }
}
