// Журнал "последний раз видели" для источников мутантов: когда товар магазина,
// бокс или генератор последний раз был в продаже по живым датам kartel
// (scripts/live-filter-dates.json, шаг 9.5). Нужен на будущее - чтобы со
// временем отличать "давно нигде не появлялся" от "есть в ротации". Исторически
// такие даты взять неоткуда: в shopitems.xml нет ни одного маркера спринта,
// поэтому журнал копится только вперёд, с первого запуска.
//
// Отдельный файл, а не поле в записях obtain.json: дата обновляется каждый
// день, и часовой пайплайн переписывал бы obtain.json, который обязан
// оставаться append-only (autofill-obtain.ts, detect-exchange-rotation.ts).
//
// Ключи: itemId товара из shopitems.xml (Specimen_XX_YY_Gold, LuckyBox_...,
// bank_...) и "gacha:<id>" для генераторов. Значение - дата (UTC, YYYY-MM-DD)
// последнего прогона, в котором окно фильтра было открыто.
import fs from 'fs/promises'
import path from 'path'
import { fetchGameXml } from './game-xml-cache'
import { hasLiveFilterData, loadFilterDates } from './kartel-filter-dates'

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LAST_SEEN_PATH = path.join(process.cwd(), 'scripts/obtain-last-seen.json')

async function main() {
  // Без живого снэпшота (шаг 9.5 упал) молча выходим: пустая карта фильтров
  // не повод что-то менять.
  if (!(await hasLiveFilterData())) {
    console.log('[obtain-last-seen] нет живых дат kartel - пропуск')
    return
  }
  const filterDates = await loadFilterDates()
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const isOpen = (name: string): boolean => {
    const range = filterDates[name]
    if (!range?.start) return false
    const start = new Date(range.start).getTime()
    const end = range.end ? new Date(range.end).getTime() : Infinity
    return start <= now && now < end
  }

  // Filter -> itemId: один Filter может быть у нескольких товаров (тиры одного
  // оффера), поэтому помечаем все. Только товары с мутантом внутри (сам
  // мутант, бокс, набор) - здания и хабитаты журналу ни к чему.
  const shopXml = await fetchGameXml(SHOPITEMS_URL)
  const openKeys = new Set<string>()
  for (const item of shopXml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    if (!/Specimen_/i.test(item)) continue
    const itemId = item.match(/itemId="([^"]+)"/)?.[1]
    const filter = item.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    if (itemId && filter && isOpen(filter)) openKeys.add(itemId)
  }
  for (const name of Object.keys(filterDates)) {
    const gachaId = name.match(/^gacha_pack_(.+)$/)?.[1]
    if (gachaId && isOpen(name)) openKeys.add(`gacha:${gachaId}`)
  }

  let lastSeen: Record<string, string> = {}
  try {
    lastSeen = JSON.parse(await fs.readFile(LAST_SEEN_PATH, 'utf-8'))
  } catch {
    lastSeen = {}
  }
  let changed = 0
  for (const key of openKeys) {
    if (lastSeen[key] === today) continue
    lastSeen[key] = today
    changed++
  }
  if (changed > 0) {
    const sorted = Object.fromEntries(
      Object.entries(lastSeen).sort(([a], [b]) => a.localeCompare(b)),
    )
    await fs.writeFile(LAST_SEEN_PATH, JSON.stringify(sorted, null, 2) + '\n')
  }
  console.log(
    `[obtain-last-seen] открыто сейчас: ${openKeys.size}, обновлено: ${changed} (всего в журнале: ${Object.keys(lastSeen).length})`,
  )
}

main().catch((err) => {
  console.error('[obtain-last-seen] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
