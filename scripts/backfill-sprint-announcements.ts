// Разовый ручной бэкафилл (запуск по явной просьбе юзера 2026-09-04) - НЕ
// часовой автоматический скрипт, не подключён ни к одному workflow. Чистит
// /announcements от тестовых записей (simulate-announcements-page-data.ts,
// id начинается с "test-") и от старых shopForecast/dailyNews-записей
// (опубликованных ДО ленты/точных дат/USD-цены - старая схема), затем
// публикует "текущий" спринт (currentSprint(), уже живой в игре) и "прошлый"
// (currentSprint()-1) через ТУ ЖЕ схему Announcement, что использует
// build-announcements.ts::main() - неотличимо от органической публикации.
//
// "Следующий" спринт (currentSprint()+1, forecast) НЕ трогаем - это
// территория штатного часового пайплайна, он сам его опубликует, как
// только currentSprint() продвинется и "+1" станет новым номером (ledger
// уже помнит currentSprint() и currentSprint()-1 как "seen" после этого
// прогона - коллизий не будет).
//
// Запуск: npx tsx scripts/backfill-sprint-announcements.ts
import fs from 'fs/promises'
import path from 'path'
import { fetchShopForecast } from './detect-shop-forecast'
import { fetchDailyNewsForecast } from './detect-daily-news'
import { currentSprint } from '../src/lib/sprint-calendar'

const ROOT = process.cwd()
const ANNOUNCEMENTS_PATH = path.join(ROOT, 'src/data/announcements.json')
const LEDGER_PATH = path.join(ROOT, 'scripts/announced-ids-cache.json')

interface AnnouncementItem {
  id: string
  name: string
  image?: string | null
  price?: { amount: number; type: 'hardcurrency' | 'softcurrency' | 'usd' } | null
  ribbon?: string | null
  exactDateLabel?: string | null
}

interface Announcement {
  id: string
  date: string
  category: string
  title: string
  items: AnnouncementItem[]
  link?: string | null
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return fallback
  }
}

async function main() {
  // Опциональные CLI-аргументы (npx tsx scripts/backfill-sprint-announcements.ts 256 255) -
  // ручной выбор спринтов, раз "прошлый" по строгому календарю (currentSprint()-1)
  // может оказаться УЖЕ завершившимся (live-фильтры для него истекли, exactDateLabel
  // выйдет пустым у всех офферов - проверено 2026-09-04) - тогда осмысленнее взять
  // currentSprint()+1 (следующий, ещё живые точные даты) вместо currentSprint().
  const argTargets = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n))
  const targets = argTargets.length === 2 ? argTargets : [currentSprint(), currentSprint() - 1]
  console.log(`[BACKFILL] Спринты: ${targets[0]}, ${targets[1]}`)

  const announcements = await loadJson<Announcement[]>(ANNOUNCEMENTS_PATH, [])
  const ledger = await loadJson<Record<string, string[]>>(LEDGER_PATH, {})

  const cleaned = announcements.filter((a) => {
    if (a.id.startsWith('test-')) return false
    if (a.category === 'shopForecast' || a.category === 'dailyNews') return false
    return true
  })
  console.log(`[BACKFILL] Убрано записей: ${announcements.length - cleaned.length}`)

  const now = new Date().toISOString()
  const fresh: Announcement[] = []

  for (const sprint of targets) {
    const forecast = await fetchShopForecast(sprint)
    if (forecast && forecast.items.length > 0) {
      fresh.push({
        id: `shopForecast-${Date.now()}-${sprint}`,
        date: now,
        category: 'shopForecast',
        title: `Прогноз магазина (${forecast.dateRangeLabel})`,
        items: forecast.items.map((it) => ({
          id: `${sprint}|${it.itemId}`,
          name: it.name,
          image: it.image,
          price: it.price,
          ribbon: it.ribbon,
          exactDateLabel: it.exactDateLabel,
        })),
        link: '/materials',
      })
    } else {
      console.log(`[BACKFILL] shopForecast: спринт ${sprint} не найден в shopitems.xml, пропуск`)
    }

    const dailyNews = await fetchDailyNewsForecast(sprint)
    if (dailyNews && dailyNews.items.length > 0) {
      fresh.push({
        id: `dailyNews-${Date.now()}-${sprint}`,
        date: now,
        category: 'dailyNews',
        title: `Скоро в игре (${dailyNews.dateRangeLabel})`,
        items: dailyNews.items.map((it) => ({
          id: `${sprint}|${it.filter}`,
          name: it.name,
          image: it.image ?? dailyNews.coverImage,
          price: it.price,
          ribbon: it.ribbon,
          exactDateLabel: it.exactDateLabel,
        })),
        link: '/announcements',
      })
    } else {
      console.log(`[BACKFILL] dailyNews: спринт ${sprint} не найден в dailypopup.xml, пропуск`)
    }
  }

  await fs.writeFile(
    ANNOUNCEMENTS_PATH,
    JSON.stringify([...cleaned, ...fresh], null, 2) + '\n',
    'utf-8',
  )

  ledger.shopForecast = [...new Set([...(ledger.shopForecast ?? []), ...targets.map(String)])]
  ledger.dailyNews = [...new Set([...(ledger.dailyNews ?? []), ...targets.map(String)])]
  await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf-8')

  console.log(`[BACKFILL] Готово. Опубликовано записей: ${fresh.length}`)
}

main().catch((err) => {
  console.error('[BACKFILL] Упал:', err)
  process.exit(1)
})
