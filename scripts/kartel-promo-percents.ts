// Загрузчик активных процентов промо-акций (см. scripts/kartel/fetch-promo-percents.py
// и память auto-announcements-architecture.md, раздел про ABGetExperiments).
//
// Процент скидки (тех-центр и т.п.) не хранится ни в одном статичном XML, ни
// в date-фильтрах - игра раздаёт его через инфраструктуру A/B-экспериментов.
// Сам живой запрос делает ОТДЕЛЬНЫЙ шаг workflow (тот же принцип, что у
// kartel-filter-dates.ts) и пишет результат в scripts/live-promo-percents.json
// (гитигнорится - транзиентный снэпшот текущего прогона). Файла может не быть
// (шаг упал, локальная разработка) - тихий фоллбек на пустую карту, вызывающая
// сторона просто не покажет процент (как и раньше, до этой фичи).
//
// Ключ - имя эксперимента как есть ("Mutants-Promo-TechCenter-HC"), значение -
// число (0-100). Экспериментов в ответе ~85, из них большинство - вообще не
// проценты скидок (стартовое золото, пороги уровней и т.п.) - см. комментарий
// в fetch-promo-percents.py. Что делать с конкретным именем решает вызывающая
// сторона (см. TECH_CENTER_DISCOUNT_EXPERIMENTS в detect-daily-news.ts).
import fs from 'fs/promises'
import path from 'path'

const LIVE_PROMO_PERCENTS_PATH = path.join(process.cwd(), 'scripts/live-promo-percents.json')

let cache: Record<string, number> | null = null

export async function loadPromoPercents(): Promise<Record<string, number>> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(LIVE_PROMO_PERCENTS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as { promos?: Record<string, number> }
    cache = parsed.promos ?? {}
  } catch {
    cache = {}
  }
  return cache
}
