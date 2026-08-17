// Батч 11 (3): резолвит названия bundle/box товаров (itemId, проставлен
// backfill-obtain-itemid.ts) на все 8 не-RU локалей через тот же приём, что
// build-boxes.ts/detect-shop-forecast.ts - itemId как ключ в
// localisation_{lang}.txt. RU не резолвится - obtain.json's "where" уже
// RU-канон (7 коммитов ручной курации), эта миграция его не трогает.
//
// Покрытие ключей itemId в localisation_{lang}.txt НЕ гарантировано таким же,
// как у мутантских ключей (sync-mutant-names.ts дал 100% для de/it/tr/nl) -
// это другое пространство ключей (товары шопа, не мутанты), отчёт печатается
// отдельно на каждую локаль.
//
// Запуск: npx tsx scripts/sync-obtain-names.ts

import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'

const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
const LOC_URL = (locale: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/localisation_${locale}.txt`
const OBTAIN_PATH = path.join(process.cwd(), 'src/data/mutants/obtain.json')
const MUTANTS_PATH = path.join(process.cwd(), 'src/data/mutants/mutants.json')
const NAMES_PATH = (locale: string) =>
  path.join(process.cwd(), `src/data/mutants/names.${locale}.json`)
const DATA_DIR = path.join(process.cwd(), 'src/data/mutants')

interface ObtainEntry {
  type: string
  where: string
  icon?: string
  itemId?: string
}

function balanceQuotes(name: string): string {
  const open = (name.match(/«/g) ?? []).length
  const close = (name.match(/»/g) ?? []).length
  return open > close ? name + '»'.repeat(open - close) : name
}

async function loadLocMap(
  locale: string,
): Promise<{ loc: Map<string, string>; locLower: Map<string, string> }> {
  const res = await axios.get<string>(LOC_URL(locale), { responseType: 'text' })
  const loc = new Map<string, string>()
  const locLower = new Map<string, string>()
  for (const rawLine of String(res.data).split(/\r?\n/)) {
    const i = rawLine.indexOf(';')
    if (i === -1) continue
    const key = rawLine.slice(0, i)
    const val = rawLine.slice(i + 1)
    loc.set(key, val)
    if (!locLower.has(key.toLowerCase())) locLower.set(key.toLowerCase(), val)
  }
  return { loc, locLower }
}

// Локализация регистро-непоследовательна относительно itemId в shopitems.xml
// (Pack_Bone в shopitems.xml/obtain.json, pack_bone в localisation_*.txt) -
// точный ключ предпочтителен, регистронезависимый - фолбэк (тот же приём,
// что build-boxes.ts's lookup()). Раньше здесь был баг: lowercase-варианты
// сливались В loc заранее, но loc.get(itemId) искал исходным регистром и
// никогда не попадал на слитый lowercase-ключ - фолбэк не работал.
function lookup(
  loc: Map<string, string>,
  locLower: Map<string, string>,
  key: string,
): string | undefined {
  return loc.get(key) ?? locLower.get(key.toLowerCase())
}

async function main() {
  const [obtainRaw, mutantsRaw] = await Promise.all([
    fs.readFile(OBTAIN_PATH, 'utf-8'),
    fs.readFile(MUTANTS_PATH, 'utf-8'),
  ])
  const obtain: Record<string, ObtainEntry[]> = JSON.parse(obtainRaw)
  const mutants: Array<{ id: string; name: string }> = JSON.parse(mutantsRaw)
  const mutantIdSet = new Set(mutants.map((m) => m.id))

  // Собираем все itemId, которые реально встречаются в obtain.json. Отдельно
  // выделяем category="specimen"-триггеры (itemId начинается с Specimen_) -
  // для них имя не в localisation, а "Спецпредложение «<имя мутанта>»"
  // (тот же спецкейс, что в backfill-obtain-itemid.ts).
  const itemIds = new Set<string>()
  for (const entries of Object.values(obtain)) {
    for (const e of entries) if (e.itemId) itemIds.add(e.itemId)
  }
  console.log(`[SETUP] ${itemIds.size} уникальных itemId в obtain.json`)

  for (const locale of LOCALES) {
    console.log(`[${locale}] Загрузка localisation_${locale}.txt...`)
    const [{ loc, locLower }, mutantNames] = await Promise.all([
      loadLocMap(locale),
      fs
        .readFile(NAMES_PATH(locale), 'utf-8')
        .then((t) => JSON.parse(t) as Record<string, { name: string }>)
        .catch(() => ({}) as Record<string, { name: string }>),
    ])

    const names: Record<string, string> = {}
    let missing = 0
    for (const itemId of itemIds) {
      // "Спецпредложение «X»" - фраза не переведена вручную на 8 языков (это
      // авторский UI-текст, не игровые данные). Пишем только в EN как звено
      // фолбэк-цепочки target->en->ru (см. src/lib/i18n.ts) - для остальных
      // локалей ключ отсутствует нарочно, рендер сам подставит EN.
      const specimenMatch = itemId.match(/^(Specimen_[A-Za-z]{2}_\d{2})/)
      if (locale === 'en' && specimenMatch && mutantIdSet.has(specimenMatch[1])) {
        const mutantName = mutantNames[specimenMatch[1]]?.name
        if (mutantName) {
          names[itemId] = `Special offer "${mutantName}"`
          continue
        }
      }
      const val = lookup(loc, locLower, itemId)
      if (val) {
        names[itemId] = balanceQuotes(val)
      } else {
        missing++
      }
    }

    const outPath = path.join(DATA_DIR, `obtain-names.${locale}.json`)
    await fs.writeFile(outPath, JSON.stringify(names, null, 2) + '\n', 'utf-8')
    console.log(
      `[${locale}] Записано ${Object.keys(names).length}/${itemIds.size} (${missing} без перевода) -> ${outPath}`,
    )
  }

  console.log('[DONE]')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
