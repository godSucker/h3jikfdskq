// Структурные правила дат для офферов, чей день недели задан самой природой
// акции. Используются, когда живого окна kartel ещё нет и дата считается по
// соседям (интерполяция по позиции в блоке даёт ошибку до суток).
//
// Weekend-акции (daily_news_jackpot_madness_weekend_*): обе известные начинаются
// в пятницу в 10:00 UTC и идут трое суток (11-14.09 и 16-19.10.2026, оба окна
// подтверждены kartel). Выборка из двух, но обе совпали и название говорит само
// за себя. Интерполяция давала ≈15.10 (четверг) вместо реальной пятницы 16.10.
export const DAY_MS = 86_400_000

export const WEEKEND_RULE = { weekdayUTC: 5, hourUTC: 10, durationDays: 3 } as const

export const WEEKEND_FILTER_RE = /weekend/i

// Ближайший к ms момент "день недели weekdayUTC, hourUTC:00 UTC" (по модулю
// расстояния, при равенстве - более поздний).
export function snapToNearestWeekday(ms: number, weekdayUTC: number, hourUTC: number): number {
  const d = new Date(ms)
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const delta = (weekdayUTC - d.getUTCDay() + 7) % 7 // 0..6 вперёд до нужного дня
  const forward = dayStart + delta * DAY_MS + hourUTC * 3_600_000
  const backward = forward - 7 * DAY_MS
  return Math.abs(forward - ms) <= Math.abs(ms - backward) ? forward : backward
}

export function weekendWindow(ms: number): { startMs: number; endMs: number } {
  const startMs = snapToNearestWeekday(ms, WEEKEND_RULE.weekdayUTC, WEEKEND_RULE.hourUTC)
  return { startMs, endMs: startMs + WEEKEND_RULE.durationDays * DAY_MS }
}
