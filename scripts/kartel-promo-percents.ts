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

// НАЙДЕНО (Opus 5.5 audit, 2026-09-22): в отличие от hasLiveFilterData()
// (kartel-filter-dates.ts), у discountPercent не было вообще никакого guard'а
// в build-announcements.ts::main() - "живых промо-данных не было в этом
// прогоне" (шаг fetch-promo-percents.py не подключён к workflow, как у
// finish-pending.yml/sync-cron.yml/parser-rebalance.yml, которые вызывают
// main() без него) и "живые данные были, но сейчас нет активной акции"
// схлопывались в одно и то же {} - merge-логика доверяла fresh целиком и
// молча обнуляла discountPercent на уже опубликованной карточке каждый раз,
// когда main() запускался не из hourly. Тот же принцип, что и
// hasLiveFilterData - различаем "не спрашивали" от "спросили и там пусто".
export async function hasLivePromoData(): Promise<boolean> {
  const promos = await loadPromoPercents()
  return Object.keys(promos).length > 0
}
