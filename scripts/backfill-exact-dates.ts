// Разовый ручной бэкафилл (запуск по явной просьбе юзера 2026-09-04) - НЕ
// часовой автоматический скрипт. Проставляет exactDateLabel/exactDateStart
// на УЖЕ опубликованные raid/ladder/box/shopForecast/dailyNews записи
// (обычный часовой пайплайн это делает только для НОВЫХ находок - у
// существующих на сайте карточек дат никогда не было). ТОЛЬКО ДОБАВЛЯЕТ:
// если у оффера уже есть exactDateLabel - не трогает; если свежих
// live-данных для конкретного id нет - оставляет как было (null остаётся
// null, ничего не стирает).
//
// Запуск: сначала python3 scripts/kartel/fetch-filters.py > scripts/live-filter-dates.json,
// потом npx tsx scripts/backfill-exact-dates.ts
import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import { loadFilterDates, pickFilterDateRange } from './kartel-filter-dates'
import { formatExactRangeRu } from '../src/lib/sprint-calendar'

const ROOT = process.cwd()
const ANNOUNCEMENTS_PATH = path.join(ROOT, 'src/data/announcements.json')

interface AnnouncementItem {
  id: string
  name: string
  exactDateLabel?: string | null
  exactDateStart?: string | null
  [key: string]: unknown
}
interface Announcement {
  id: string
  category: string
  items: AnnouncementItem[]
  [key: string]: unknown
}

async function buildShopFilterMap(): Promise<Map<string, string>> {
  const { data: xml } = await axios.get<string>(
    'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml',
    { responseType: 'text', timeout: 20000 },
  )
  const map = new Map<string, string>()
  for (const itemXml of xml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    const filter = itemXml.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    if (itemId && filter) map.set(itemId, filter)
  }
  return map
}

async function buildDungeonFilterMap(): Promise<Map<string, string>> {
  const { data: xml } = await axios.get<string>(
    'https://s-beta.kobojo.com/mutants/gameconfig/dungeon/dungeons.xml',
    { responseType: 'text', timeout: 20000 },
  )
  const map = new Map<string, string>()
  for (const m of xml.matchAll(
    /<Dungeon id="([^"]+)"[^>]*>[\s\S]{0,200}?<Filter>([^<]*)<\/Filter>/g,
  )) {
    map.set(m[1], m[2])
  }
  return map
}

async function main() {
  const announcements = await loadJson<Announcement[]>(ANNOUNCEMENTS_PATH, [])
  const filterDates = await loadFilterDates()
  if (Object.keys(filterDates).length === 0) {
    console.error(
      '[BACKFILL-DATES] scripts/live-filter-dates.json пуст/не найден - сначала запусти fetch-filters.py',
    )
    process.exit(1)
  }

  const shopFilterMap = await buildShopFilterMap()
  const dungeonFilterMap = await buildDungeonFilterMap()

  let patched = 0
  for (const a of announcements) {
    let filterMap: Map<string, string> | null = null
    // shopForecast/dailyNews item.id = "<sprint>|<filter-или-itemId>" - для
    // shopForecast это буквально itemId (после |), для dailyNews - уже сам
    // Filter (детекторы кладут it.filter напрямую, см. detect-daily-news.ts).
    if (a.category === 'raid' || a.category === 'ladder') filterMap = dungeonFilterMap
    else if (a.category === 'box') filterMap = shopFilterMap
    else if (a.category === 'shopForecast' || a.category === 'dailyNews') filterMap = null // особый случай ниже

    for (const it of a.items) {
      if (it.exactDateLabel) continue // уже есть - не трогаем
      let filterName: string | undefined
      if (filterMap) {
        filterName = filterMap.get(it.id)
      } else if (a.category === 'shopForecast') {
        const itemId = it.id.includes('|') ? it.id.split('|')[1] : it.id
        filterName = shopFilterMap.get(itemId)
      } else if (a.category === 'dailyNews') {
        filterName = it.id.includes('|') ? it.id.split('|')[1] : it.id
      }
      if (!filterName) continue
      const range = pickFilterDateRange(filterDates, filterName)
      if (!range) continue
      it.exactDateLabel = formatExactRangeRu(
        new Date(range.start),
        range.end ? new Date(range.end) : null,
      )
      it.exactDateStart = range.start
      patched++
    }
  }

  await fs.writeFile(ANNOUNCEMENTS_PATH, JSON.stringify(announcements, null, 2) + '\n', 'utf-8')
  console.log(`[BACKFILL-DATES] Проставлено дат: ${patched}`)
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return fallback
  }
}

main().catch((err) => {
  console.error('[BACKFILL-DATES] Упал:', err)
  process.exit(1)
})
