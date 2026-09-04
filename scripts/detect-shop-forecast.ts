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
import { currentSprint, sprintRangeLabel } from '../src/lib/sprint-calendar'
import { parseOfferRibbon, parseRealPriceUSD, type OfferRibbon } from './shop-offer-tags'

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const THUMB_BASE = 'https://s-beta.kobojo.com/mutants/assets/thumbnails/'

function balanceQuotes(name: string): string {
  const open = (name.match(/«/g) ?? []).length
  const close = (name.match(/»/g) ?? []).length
  return open > close ? name + '»'.repeat(open - close) : name
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
}

export interface ShopForecast {
  sprint: number
  dateRangeLabel: string
  items: ForecastItem[]
}

export async function fetchShopForecast(): Promise<ShopForecast | null> {
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

  const target = currentSprint() + 1
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

  const items: ForecastItem[] = []
  for (const itemXml of block.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    const hidden = itemXml.match(/hidden="([^"]+)"/)?.[1]
    const picture = itemXml.match(/picture="([^"]+)"/)?.[1]
    const caption = itemXml.match(/caption="([^"]+)"/)?.[1]
    if (!itemId || hidden === 'true') continue
    const costMatch = itemXml.match(/<Cost amount="(\d+)" type="(hardcurrency|softcurrency)"\s*\/>/)
    const usd = costMatch ? null : parseRealPriceUSD(itemXml)
    const offerTag = itemXml.match(/offerTag="([^"]+)"/)?.[1]
    items.push({
      itemId,
      name: resolveName(itemId, caption),
      image: picture ? `${THUMB_BASE}${picture.replace(/\$\$$/, '')}.png` : null,
      price: costMatch
        ? { amount: Number(costMatch[1]), type: costMatch[2] as 'hardcurrency' | 'softcurrency' }
        : usd !== null
          ? { amount: usd, type: 'usd' }
          : null,
      ribbon: parseOfferRibbon(offerTag),
    })
  }

  return { sprint: target, dateRangeLabel: sprintRangeLabel(target), items }
}
