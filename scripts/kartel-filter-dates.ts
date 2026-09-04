// Загрузчик точных дат офферов (см. scripts/kartel/fetch-filters.py и память
// auto-announcements-architecture.md, раздел "ПРОРЫВ: точные даты РЕШЕНЫ").
// Сам живой запрос к игре делает ОТДЕЛЬНЫЙ шаг workflow (python, один раз за
// прогон, не по разу на детектор) и пишет результат в
// scripts/live-filter-dates.json (гитигнорится - транзиентный, не история).
// Если файла нет (локальная разработка, шаг не запускали, живой запрос упал)
// - тихий фоллбек на пустую карту, detect-*.ts просто останутся на
// sprint-wide диапазоне (как было раньше), без падений.
import fs from 'fs/promises'
import path from 'path'

export interface FilterDateRange {
  start: string
  end: string | null
}

const LIVE_FILTER_DATES_PATH = path.join(process.cwd(), 'scripts/live-filter-dates.json')

let cache: Record<string, FilterDateRange> | null = null

export async function loadFilterDates(): Promise<Record<string, FilterDateRange>> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(LIVE_FILTER_DATES_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as { filters?: Record<string, FilterDateRange> }
    cache = parsed.filters ?? {}
  } catch {
    cache = {}
  }
  return cache
}

export function pickFilterDateRange(
  dates: Record<string, FilterDateRange>,
  filterName: string | null | undefined,
): FilterDateRange | null {
  if (!filterName) return null
  return dates[filterName] ?? null
}
