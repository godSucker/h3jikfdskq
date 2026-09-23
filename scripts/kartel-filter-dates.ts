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

export interface LiveSnapshotMeta {
  requestedCount?: number
  returnedCount?: number
  failedSources?: string[]
}

// full - все источники имён фильтров скачались, ответу можно доверять целиком.
// partial - файл есть, но часть источников имён упала (fetch-filters.py пишет
//   их в meta.failedSources): для этих фильтров даты не запрашивались, и их
//   null в ответе - "не спрашивали", а не "окна нет".
// missing - файла нет / он битый / фильтров в нём ноль (шаг не запускался или
//   упал целиком, локальная разработка).
export type LiveSnapshotStatus = 'full' | 'partial' | 'missing'

export interface LiveSnapshot {
  status: LiveSnapshotStatus
  filters: Record<string, FilterDateRange>
  meta: LiveSnapshotMeta | null
}

let snapshotCache: LiveSnapshot | null = null

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  if (snapshotCache) return snapshotCache
  let filters: Record<string, FilterDateRange> = {}
  let meta: LiveSnapshotMeta | null = null
  try {
    const raw = await fs.readFile(LIVE_FILTER_DATES_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as {
      filters?: Record<string, FilterDateRange>
      meta?: LiveSnapshotMeta
    }
    filters = parsed.filters ?? {}
    meta = parsed.meta ?? null
  } catch {
    // файла нет или он битый - status ниже станет 'missing'
  }
  snapshotCache = { status: classifySnapshot(filters, meta), filters, meta }
  return snapshotCache
}

export function classifySnapshot(
  filters: Record<string, FilterDateRange>,
  meta: LiveSnapshotMeta | null,
): LiveSnapshotStatus {
  if (Object.keys(filters).length === 0) return 'missing'
  if ((meta?.failedSources?.length ?? 0) > 0 || meta?.requestedCount === 0) return 'partial'
  // Файл без meta (старый формат, локальный файл) - как раньше, по непустоте.
  return 'full'
}

export async function loadFilterDates(): Promise<Record<string, FilterDateRange>> {
  return (await getLiveSnapshot()).filters
}

// НАЙДЕНО 2026-09-09: "тихий фоллбек на {}" в loadFilterDates() - именно то,
// что позволило finish-pending.yml молча стереть все уже известные даты
// спринта, когда шаг fetch-filters.py вообще не был подключён (см. коммит
// 52abe5f99). Сам фоллбек оставляем (легитимный для локальной разработки), но
// даём вызывающей стороне (merge-логика build-announcements.ts::main(),
// build-event-quests.ts, update-obtain-last-seen.ts) способ отличить "живым
// данным можно доверять целиком" от всего остального.
//
// НАЙДЕНО (Opus 5.5 audit, 2026-09-22): раньше здесь проверялась только
// непустота файла. Но при сбое скачивания имён фильтров сервер всё равно
// отдаёт ~9 записей своего авто-набора - файл непустой, guard говорил "данные
// есть", и мерж стирал уже известные даты. Теперь "есть данные" = только
// полный снимок (status 'full'); 'partial' защищается так же, как 'missing'.
export async function hasLiveFilterData(): Promise<boolean> {
  return (await getLiveSnapshot()).status === 'full'
}

export function pickFilterDateRange(
  dates: Record<string, FilterDateRange>,
  filterName: string | null | undefined,
): FilterDateRange | null {
  if (!filterName) return null
  return dates[filterName] ?? null
}

// Постоянный журнал подтверждённых дат (scripts/kartel/update-date-ledger.ts
// копит его каждый час, append-only) - в отличие от loadFilterDates() выше
// (транзиентный снэпшот текущего прогона, живой горизонт kartel ~7 дней),
// этот файл коммитится в git и растёт бессрочно. detect-shop-forecast.ts
// подмешивает его в "подтверждённые" якоря для ближайшего соседа - чем
// длиннее история, тем плотнее сетка якорей внутри пула dailyoffer.
const DATE_LEDGER_PATH = path.join(process.cwd(), 'scripts/kartel/date-ledger.json')

let ledgerCache: Record<string, string> | null = null

export async function loadDateLedger(): Promise<Record<string, string>> {
  if (ledgerCache) return ledgerCache
  try {
    const raw = await fs.readFile(DATE_LEDGER_PATH, 'utf-8')
    ledgerCache = JSON.parse(raw) as Record<string, string>
  } catch {
    ledgerCache = {}
  }
  return ledgerCache
}
