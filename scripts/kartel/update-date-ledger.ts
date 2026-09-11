// Постоянный журнал подтверждённых дат офферов (в отличие от
// scripts/live-filter-dates.json - тот транзиентный, живёт один прогон).
// Идея: kartel отдаёт точные даты только на ~7 дней вперёд (см. память
// auto-announcements-architecture.md), но раз подтверждённая дата уже не
// меняется - копим её здесь НАВСЕГДА. appendDailyMutantOffers в
// detect-shop-forecast.ts использует этот журнал как доп. источник "якорей"
// для ближайшего соседа - чем длиннее история, тем плотнее сетка якорей и
// тем реже прогноз проваливается за MAX_NEIGHBOR_DISTANCE.
//
// Только ДОБАВЛЯЕТ ключи (append-only, никогда не перезаписывает
// существующий - см. память feedback-show-data-as-is-no-silent-dedup, тот же
// принцип: не трогать то, что уже есть). Тот же 3-дневный "однозначное окно"
// гейт, что использует appendDailyMutantOffers/classifyFeaturedMutant для
// пометки даты как "подтверждённая" (а не диапазон спринта).
import fs from 'fs/promises'
import path from 'path'
import { loadFilterDates } from '../kartel-filter-dates'

const LEDGER_PATH = path.join(process.cwd(), 'scripts/kartel/date-ledger.json')
const DAY_MS = 24 * 60 * 60 * 1000

async function main() {
  const filterDates = await loadFilterDates()

  let ledger: Record<string, string> = {}
  try {
    ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf-8'))
  } catch {
    ledger = {}
  }

  let added = 0
  for (const [filterName, range] of Object.entries(filterDates)) {
    if (filterName in ledger) continue
    if (!range?.start || !range.end) continue
    const startMs = new Date(range.start).getTime()
    const endMs = new Date(range.end).getTime()
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue
    if ((endMs - startMs) / DAY_MS > 3) continue
    ledger[filterName] = range.start
    added++
  }

  if (added > 0) {
    const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)))
    await fs.writeFile(LEDGER_PATH, JSON.stringify(sorted, null, 2) + '\n')
  }
  console.log(
    `[date-ledger] +${added} новых записей (всего в журнале: ${Object.keys(ledger).length})`,
  )
}

main()
