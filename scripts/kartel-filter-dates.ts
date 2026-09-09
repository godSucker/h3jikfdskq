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

// НАЙДЕНО 2026-09-09: этот "тихий фоллбек на {}" - именно то, что позволило
// finish-pending.yml молча стереть все уже известные даты спринта, когда шаг
// fetch-filters.py вообще не был подключён (см. коммит 52abe5f99). Сам
// фоллбек оставляем (легитимный для локальной разработки), но даём вызывающей
// стороне (build-announcements.ts::main(), merge-логика) способ отличить
// "живых данных вообще не было в этом прогоне" от "живые данные были, просто
// для конкретного item'а окна нет" - это разные ситуации и должны по-разному
// мерджиться с уже известным старым значением.
export async function hasLiveFilterData(): Promise<boolean> {
  const dates = await loadFilterDates()
  return Object.keys(dates).length > 0
}

export function pickFilterDateRange(
  dates: Record<string, FilterDateRange>,
  filterName: string | null | undefined,
): FilterDateRange | null {
  if (!filterName) return null
  return dates[filterName] ?? null
}
