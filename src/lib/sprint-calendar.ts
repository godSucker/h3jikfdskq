// Календарь "спринтов" (двухнедельная ротация контента Kobojo - shopitems.xml/
// dailypopup.xml оба размечены `SPRINT N`/`DEBUT SPRINT N`). Нужен для анонсов
// "что появится через 1-2 недели" (Фаза 3, задачи A/B - shopitems.xml/daily_news).
//
// ВАЖНО: beta и прод НЕ различаются по набору спринтов (проверено 2026-08-07,
// max(SPRINT) одинаков на обоих хостах) - "опережение" тут не про beta vs прод,
// а про то, что игровые файлы публикуют СЛЕДУЮЩИЙ спринт чуть раньше, чем он
// реально включается игрокам. Поэтому "скоро" = SPRINT-маркер СТРОГО больше
// текущего расчётного спринта на сегодня, а не разница между хостами.
//
// Калибровка (2026-08-07): ТОЧНЫЙ якорь - пользователь прислал список рабочих
// URL daily_news-баннеров, среди них два с явно указанными датами (из
// собственных архивных заметок): news_shop_24h_2024_208a-en.jpg = 02.11.2024
// - 08.11.2024, news_shop_24h_2024_208b-en.jpg = 09.11.2024 - 15.11.2024.
// Оба URL подтверждены живыми (200 OK) 2026-08-07. Значит "sprint N" = 14 дней,
// a-половина = первые 7 дней, b-половина = вторые 7 дней. Независимая оценка
// по совпадению контента (DEBUT SPRINT 254 в dailypopup.xml на 2026-08-06/07
// соответствует Telegram-скрину "08.08.26-21.08.26") давала 254=2026-08-08 -
// расхождение с этим якорем всего ~2 дня, что подтверждает каданс. Таблица
// год<->диапазон спринтов от коллеги (~26 спринтов/год) - грубая, для старых
// лет как перекрёстная проверка, не как первичный источник.
export const SPRINT_ANCHOR = { sprint: 208, startDate: '2024-11-02' } // 208a start
export const DAYS_PER_SPRINT = 14
export const DAYS_PER_HALF = 7

function addDays(iso: string, days: number): Date {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function sprintStartDate(sprint: number): Date {
  return addDays(SPRINT_ANCHOR.startDate, (sprint - SPRINT_ANCHOR.sprint) * DAYS_PER_SPRINT)
}

export function sprintEndDate(sprint: number): Date {
  return addDays(
    SPRINT_ANCHOR.startDate,
    (sprint - SPRINT_ANCHOR.sprint) * DAYS_PER_SPRINT + DAYS_PER_SPRINT - 1,
  )
}

// "a"/"b" - предположительно две недельные половины одного 2-недельного
// спринта (объясняет, почему в таблице коллеги "a"-диапазон на 1 короче
// "b"-диапазона на границах годов - половины сдвинуты друг относительно
// друга). Не проверено на 100%, но достаточно для дневной точности анонса.
export function halfStartDate(sprint: number, half: 'a' | 'b'): Date {
  const base = sprintStartDate(sprint)
  return half === 'b' ? addDays(base.toISOString().slice(0, 10), DAYS_PER_HALF) : base
}

export function currentSprint(now: Date = new Date()): number {
  const anchor = new Date(`${SPRINT_ANCHOR.startDate}T00:00:00Z`)
  const diffDays = Math.floor((now.getTime() - anchor.getTime()) / 86400000)
  return SPRINT_ANCHOR.sprint + Math.floor(diffDays / DAYS_PER_SPRINT)
}

export function formatDateRu(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

export function sprintRangeLabel(sprint: number): string {
  return `${formatDateRu(sprintStartDate(sprint))} — ${formatDateRu(sprintEndDate(sprint))}`
}

// Точный диапазон ОДНОГО оффера (не всего спринта) - из живого kartel-запроса
// (getuser + acceptFuturFilters=true, см. scripts/kartel/), не из статичных
// XML-файлов (там точных дат нет в принципе, см. память
// auto-announcements-architecture). end опционален - часть фильтров (долгие
// "фичи", не ротации) endDate не несут вообще (-1 в живых данных).
export function formatExactRangeRu(start: Date, end: Date | null): string {
  if (!end) return formatDateRu(start)
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()
  const startLabel = sameMonth
    ? start.toLocaleDateString('ru-RU', { day: 'numeric', timeZone: 'UTC' })
    : formatDateRu(start)
  return `${startLabel} — ${formatDateRu(end)}`
}
