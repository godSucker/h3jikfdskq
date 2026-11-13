// Текущая скидка на эво (тех-центр) для калькулятора: src/data/evo-discount.json.
// Скидка раздаётся через A/B-эксперименты (см. kartel-promo-percents.ts): HC - золото,
// SC - серебро, настраиваются независимо (10.2026 была 70% золото / 50% серебро).
// null = акции сейчас нет ("Default"). Файл переписывается ТОЛЬКО при смене значений:
// он лежит в src/, и каждое изменение - это деплой сайта, а не просто коммит данных.
//
// Нет живых промо-данных (шаг kartel упал / локальная разработка) - файл не трогаем:
// "не спрашивали" не то же самое, что "спросили и скидки нет" (см. hasLivePromoData).
import fs from 'node:fs/promises'
import path from 'node:path'
import { hasLivePromoData, loadPromoPercents } from './kartel-promo-percents'
import { runMain } from './lib/run-main'

const OUT_PATH = path.join(process.cwd(), 'src/data/evo-discount.json')
const GOLD_KEY = 'Mutants-Promo-TechCenter-HC'
const SILVER_KEY = 'Mutants-Promo-TechCenter-SC'

interface EvoDiscount {
  gold: number | null
  silver: number | null
  // Когда пайплайн впервые увидел ЭТО сочетание значений.
  since: string
}

async function main() {
  if (!(await hasLivePromoData())) {
    console.log('[evo-discount] нет живых промо-данных - файл не трогаем')
    return
  }
  const promos = await loadPromoPercents()
  const gold = promos[GOLD_KEY] ?? null
  const silver = promos[SILVER_KEY] ?? null
  let prev: EvoDiscount | null = null
  try {
    prev = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8'))
  } catch {
    // файла ещё нет
  }
  if (prev && prev.gold === gold && prev.silver === silver) {
    console.log(`[evo-discount] без изменений: золото ${gold ?? '-'}, серебро ${silver ?? '-'}`)
    return
  }
  const next: EvoDiscount = { gold, silver, since: new Date().toISOString() }
  await fs.writeFile(OUT_PATH, JSON.stringify(next, null, 2) + '\n')
  console.log(
    `[evo-discount] обновлено: золото ${prev?.gold ?? '-'} -> ${gold ?? '-'}, серебро ${prev?.silver ?? '-'} -> ${silver ?? '-'}`,
  )
}

runMain(import.meta.url, 'evo-discount', main)
