// i18n-пилот (Батч 11): генерирует сиблинг-файлы names.{en,es,fr}.json рядом
// с mutants.json (RU-канон, не трогается). Не модифицирует sync-mutants.ts -
// отдельный, изолированный скрипт по тому же паттерну, что sync-bingo.ts/
// download-skins.ts. Ключи локализации Kobojo проверены на 100% покрытие
// (0 пропущенных ключей среди реально используемых, см. Батч 11 в Obsidian).
//
// Запуск: npx tsx scripts/sync-mutant-names.ts

import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'

const LOCALES = ['en', 'es', 'fr'] as const
const LOC_URL = (locale: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/localisation_${locale}.txt`
const DATA_DIR = path.join(process.cwd(), 'src/data/mutants')
const TEMP_DIR = path.join(process.cwd(), 'temp')

async function loadLocMap(locale: string): Promise<Map<string, string>> {
  await fs.mkdir(TEMP_DIR, { recursive: true })
  const txtPath = path.join(TEMP_DIR, `localisation_${locale}.txt`)
  const res = await axios.get(LOC_URL(locale), { responseType: 'text' })
  await fs.writeFile(txtPath, res.data)

  const locMap = new Map<string, string>()
  String(res.data)
    .split(/\r?\n/)
    .forEach((line) => {
      const parts = line.split(';')
      if (parts.length >= 2) {
        locMap.set(parts[0].trim().toLowerCase(), parts.slice(1).join(';').trim())
      }
    })
  return locMap
}

function findLocalizedText(locMap: Map<string, string>, id: string, suffix = ''): string {
  const mutantId = id.replace('Specimen_', '').replace('specimen_', '').toLowerCase()
  const key = `specimen_${mutantId}${suffix}`.toLowerCase()
  return locMap.get(key) || ''
}

async function main() {
  const mutantsRaw = await fs.readFile(path.join(DATA_DIR, 'mutants.json'), 'utf-8')
  const mutants: Array<{ id: string; name: string }> = JSON.parse(mutantsRaw)

  console.log(`[SETUP] ${mutants.length} мутантов, генерирую names.{${LOCALES.join(',')}}.json...`)

  for (const locale of LOCALES) {
    console.log(`[${locale}] Загрузка localisation_${locale}.txt...`)
    const locMap = await loadLocMap(locale)

    const names: Record<
      string,
      { name: string; lore: string; atk1Name: string; atk2Name: string }
    > = {}
    let missing = 0
    for (const m of mutants) {
      const name = findLocalizedText(locMap, m.id)
      const lore =
        locMap.get(`caption_${m.id.toLowerCase()}`) ||
        locMap.get(`desc_${m.id.toLowerCase()}`) ||
        findLocalizedText(locMap, m.id, '_description')
      const atk1Name = findLocalizedText(locMap, m.id, '_attack_1')
      const atk2Name = findLocalizedText(locMap, m.id, '_attack_2')

      if (!name) {
        missing++
        continue // нет перевода имени - на фронте останется RU-фолбэк из mutants.json
      }
      names[m.id] = { name, lore, atk1Name, atk2Name }
    }

    const outPath = path.join(DATA_DIR, `names.${locale}.json`)
    await fs.writeFile(outPath, JSON.stringify(names, null, 2), 'utf-8')
    console.log(
      `[${locale}] Записано ${Object.keys(names).length}/${mutants.length} (${missing} без перевода имени) -> ${outPath}`,
    )
  }

  console.log('[DONE]')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
