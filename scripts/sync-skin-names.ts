// i18n: генерирует src/data/mutants/skins-i18n.json - словарь "slug скина ->
// имя на 9 локалях" (ru + 8 остальных). Тот же приём, что itemId в
// obtain.json: skin.skin ("japan", "girl", ...) - это тот же ключ, что
// используется в игровой локализации Kobojo (localisation_{lang}.txt),
// поэтому резолвится прямым поиском, без единого LLM-слова.
//
// Не все 61 уникальных слага скина резолвятся так (см. отчёт [MISSING] в
// конце) - для них нет официального ключа ни на одном языке (RU включая),
// значит источника перевода нет и придумывать его нельзя (см. память
// feedback-no-llm-authored-names). Такие остаются на голом slug в UI, как
// и сейчас.
//
// Запуск: npx tsx scripts/sync-skin-names.ts

import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'

const LOCALES = ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
const LOC_URL = (locale: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/localisation_${locale}.txt`
const DATA_DIR = path.join(process.cwd(), 'src/data/mutants')
const OUT_PATH = path.join(DATA_DIR, 'skins-i18n.json')

async function loadLocMap(locale: string): Promise<Map<string, string>> {
  // RU уже лежит локально (src/data/localisation_ru.txt), остальные качаем.
  let raw: string
  if (locale === 'ru') {
    raw = await fs.readFile(path.join(process.cwd(), 'src/data/localisation_ru.txt'), 'utf-8')
  } else {
    const res = await axios.get(LOC_URL(locale), { responseType: 'text', timeout: 30000 })
    raw = String(res.data)
  }
  const map = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(';')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().replace(/^﻿/, '').toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key) map.set(key, value)
  }
  return map
}

async function main() {
  const skinsRaw = await fs.readFile(path.join(DATA_DIR, 'skins.json'), 'utf-8')
  const { specimens } = JSON.parse(skinsRaw) as { specimens: Array<{ skin: string }> }
  const slugs = [...new Set(specimens.map((s) => s.skin))].sort()

  console.log(
    `[SETUP] ${slugs.length} уникальных слагов скинов, резолвлю на ${LOCALES.length} локалях...`,
  )

  const dicts: Record<string, Map<string, string>> = {}
  for (const locale of LOCALES) {
    console.log(`[${locale}] загрузка localisation_${locale}.txt...`)
    dicts[locale] = await loadLocMap(locale)
  }

  const out: Record<string, Partial<Record<(typeof LOCALES)[number], string>>> = {}
  const missingEverywhere: string[] = []

  for (const slug of slugs) {
    const entry: Partial<Record<(typeof LOCALES)[number], string>> = {}
    let any = false
    for (const locale of LOCALES) {
      const val = dicts[locale].get(slug.toLowerCase())
      if (val) {
        entry[locale] = val
        any = true
      }
    }
    if (any) out[slug] = entry
    else missingEverywhere.push(slug)
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  console.log(
    `\n[write] ${Object.keys(out).length}/${slugs.length} слагов резолвлено -> ${OUT_PATH}`,
  )

  if (missingEverywhere.length) {
    console.log(
      `\n[MISSING] ${missingEverywhere.length} слагов без официального ключа ни на одном языке (нужна ручная авторизация, не LLM):`,
    )
    for (const s of missingEverywhere) console.log(`  - ${s}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
