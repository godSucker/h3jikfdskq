// Текущая скидка на рулетку "Mutants Madness" (Джекпот): src/data/madness-discount.json.
// Скидка раздаётся через A/B-эксперименты (см. kartel-promo-percents.ts), найдено
// реверсом 2026-11-23 (строки 02_strings_categorized.json, связка "Jackpot" =
// внутриигровое имя рулетки Mutants Madness подтверждена через
// can_play_jackpot_for_free_message_mutants в localisation_ru.txt): HC - скидка
// на золото, Token - скидка на жетоны джекпота. В отличие от TechCenter (HC/SC -
// симметричная пара золото/серебро) здесь пара несимметричная: нет SC-варианта.
// null = акции сейчас нет ("Default"). Файл переписывается ТОЛЬКО при смене
// значений: он лежит в src/, и каждое изменение - это деплой сайта, а не просто
// коммит данных.
//
// Нет живых промо-данных (шаг kartel упал / локальная разработка) - файл не трогаем:
// "не спрашивали" не то же самое, что "спросили и скидки нет" (см. hasLivePromoData).
import fs from 'node:fs/promises'
import path from 'node:path'
import { hasLivePromoData, loadPromoPercents } from './kartel-promo-percents'
import { runMain } from './lib/run-main'

const OUT_PATH = path.join(process.cwd(), 'src/data/madness-discount.json')
const GOLD_KEY = 'Mutants-Promo-Jackpot-HC'
const TOKEN_KEY = 'Mutants-Promo-Jackpot-Token'

interface MadnessDiscount {
  gold: number | null
  token: number | null
  // Когда пайплайн впервые увидел ЭТО сочетание значений.
  since: string
}

async function main() {
  if (!(await hasLivePromoData())) {
    console.log('[madness-discount] нет живых промо-данных - файл не трогаем')
    return
  }
  const promos = await loadPromoPercents()
  const gold = promos[GOLD_KEY] ?? null
  const token = promos[TOKEN_KEY] ?? null
  let prev: MadnessDiscount | null = null
  try {
    prev = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8'))
  } catch {
    // файла ещё нет
  }
  if (prev && prev.gold === gold && prev.token === token) {
    console.log(`[madness-discount] без изменений: золото ${gold ?? '-'}, жетоны ${token ?? '-'}`)
    return
  }
  const next: MadnessDiscount = { gold, token, since: new Date().toISOString() }
  await fs.writeFile(OUT_PATH, JSON.stringify(next, null, 2) + '\n')
  console.log(
    `[madness-discount] обновлено: золото ${prev?.gold ?? '-'} -> ${gold ?? '-'}, жетоны ${prev?.token ?? '-'} -> ${token ?? '-'}`,
  )
}

runMain(import.meta.url, 'madness-discount', main)
