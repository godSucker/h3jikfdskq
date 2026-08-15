// Резолвит name/description для material.json/charms.json/orbs.json на 8
// не-RU языков через официальную localisation_{lang}.txt (тот же приём, что
// sync-obtain-names.ts/sync-skin-names.ts - id/itemId как ключ, {loc,
// locLower} + регистронезависимый фолбэк).
//
// Charms/orbs: name = id, description = id(+suffix)_tooltip (подтверждено
// вручную: Charm_Critical_1 / charm_critical_1_tooltip).
// Material: name = id напрямую; description почти никогда не имеет
// официального ключа (это RU-курация сайта, не игровые данные) - переводится
// только там, где официальный _tooltip реально существует (11/78).
// "Эфемерные" (заряд-N) orb-варианты не имеют собственного ключа - составлены
// из orb_ephemeral_tooltip + attack_only (проверено: description идентичен
// для всех 30 записей). orb_basic_attack_08/09 не имеют базовой записи вообще
// ни в одном языке (включая RU) - имя собрано по формату соседних тиров
// ("{Attack word} +{N}%" - подтверждено на 01-07 во всех 8 языках) с
// реальным процентом из orbs.json.
//
// Запуск: npx tsx scripts/build-materials-i18n.ts

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'

const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
type Locale = (typeof LOCALES)[number]

const LOC_URL = (locale: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/localisation_${locale}.txt`
const RU_LOC_PATH = path.join(process.cwd(), 'src/data/localisation_ru.txt')

interface LocMap {
  loc: Map<string, string>
  locLower: Map<string, string>
}

function parseLoc(raw: string): LocMap {
  const loc = new Map<string, string>()
  const locLower = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(';')
    if (i === -1) continue
    const key = line.slice(0, i)
    const val = line.slice(i + 1).trim()
    loc.set(key, val)
    if (!locLower.has(key.toLowerCase())) locLower.set(key.toLowerCase(), val)
  }
  return { loc, locLower }
}

function lookup(m: LocMap, key: string): string | undefined {
  return m.loc.get(key) ?? m.locLower.get(key.toLowerCase())
}

async function loadAllLocs(): Promise<Record<string, LocMap>> {
  const ruRaw = await fs.readFile(RU_LOC_PATH, 'utf-8')
  const maps: Record<string, LocMap> = { ru: parseLoc(ruRaw) }
  for (const locale of LOCALES) {
    const res = await axios.get<string>(LOC_URL(locale), { responseType: 'text' })
    maps[locale] = parseLoc(String(res.data))
    console.log(`[build-materials-i18n] loaded ${locale}: ${maps[locale].loc.size} keys`)
  }
  return maps
}

type NameDescMap = Partial<
  Record<Locale, Partial<Record<string, { name?: string; description?: string }>>>
>

async function main() {
  const maps = await loadAllLocs()

  const material = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'src/data/materials/material.json'), 'utf-8'),
  ) as { id: string; name: string; description: string }[]
  const charms = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'src/data/materials/charms.json'), 'utf-8'),
  ) as { id: string; name: string; description: string }[]
  const orbs = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'src/data/materials/orbs.json'), 'utf-8'),
  ) as { id: string; name: string; percent: string; description: string }[]

  const out: NameDescMap = {}
  for (const locale of LOCALES) out[locale] = {}

  const unresolvedMaterialNames: string[] = []
  const materialDescResolved: string[] = []

  // material.json: name напрямую, description только если есть _tooltip
  for (const m of material) {
    let anyNameResolved = false
    let anyDescResolved = false
    for (const locale of LOCALES) {
      const name = lookup(maps[locale], m.id)
      const desc =
        lookup(maps[locale], m.id + '_Description') ??
        lookup(maps[locale], m.id + '_tooltip') ??
        lookup(maps[locale], m.id + '_text')
      const entry: { name?: string; description?: string } = {}
      if (name !== undefined) {
        entry.name = name
        anyNameResolved = true
      }
      if (desc !== undefined) {
        entry.description = desc
        anyDescResolved = true
      }
      if (entry.name || entry.description) {
        out[locale]![m.id] = entry
      }
    }
    if (!anyNameResolved) unresolvedMaterialNames.push(m.id)
    if (anyDescResolved) materialDescResolved.push(m.id)
  }

  // charms.json: name + description(_tooltip), оба должны резолвиться
  const unresolvedCharms: string[] = []
  for (const c of charms) {
    let ok = true
    for (const locale of LOCALES) {
      const name = lookup(maps[locale], c.id)
      const desc = lookup(maps[locale], c.id + '_tooltip')
      if (name === undefined || desc === undefined) ok = false
      const entry: { name?: string; description?: string } = {}
      if (name !== undefined) entry.name = name
      if (desc !== undefined) entry.description = desc
      if (entry.name || entry.description) out[locale]![c.id] = entry
    }
    if (!ok) unresolvedCharms.push(c.id)
  }

  // orbs.json: name + description(_tooltip); эфемерные варианты составляются
  const ephemeralRe = /^(.*)_ephemeral_(\d+)$/
  const unresolvedOrbs: string[] = []
  for (const o of orbs) {
    const ephMatch = o.id.match(ephemeralRe)
    for (const locale of LOCALES) {
      let name: string | undefined
      let desc: string | undefined
      if (ephMatch) {
        const baseId = ephMatch[1]
        const charge = ephMatch[2]
        let baseName = lookup(maps[locale], baseId)
        if (baseName === undefined) {
          // orb_basic_attack_08/09: нет базовой записи ни в одном языке -
          // берём процент-шаблон соседнего тира того же префикса и заменяем
          // число (единственное вхождение цифр в строке) на реальный %,
          // не пытаясь разбирать словопорядок/формат по языкам вручную
          const prefixMatch = baseId.match(/^(.*?)(_\d+)?$/)
          const prefix = prefixMatch ? prefixMatch[1] : baseId
          let template: string | undefined
          for (let i = 1; i <= 9; i++) {
            const siblingVal = lookup(maps[locale], `${prefix}_0${i}`)
            if (siblingVal !== undefined) {
              template = siblingVal
              break
            }
          }
          if (template === undefined) template = lookup(maps[locale], prefix)
          if (template !== undefined) {
            baseName = template.replace(/\d+/, String(o.percent))
          }
        }
        const ephemeralWord = lookup(maps[locale], 'ephemeral')
        const ephTooltip = lookup(maps[locale], 'orb_ephemeral_tooltip')
        const attackOnly = lookup(maps[locale], 'attack_only')
        if (baseName !== undefined && ephemeralWord !== undefined) {
          name = `${baseName} (${ephemeralWord}: ${charge})`
        }
        if (ephTooltip !== undefined && attackOnly !== undefined) {
          desc = `${ephTooltip} ${attackOnly}`
        }
      } else {
        name = lookup(maps[locale], o.id)
        desc = lookup(maps[locale], o.id + '_tooltip')
      }
      const entry: { name?: string; description?: string } = {}
      if (name !== undefined) entry.name = name
      if (desc !== undefined) entry.description = desc
      if (entry.name || entry.description) out[locale]![o.id] = entry
      if (name === undefined) {
        if (!unresolvedOrbs.includes(o.id)) unresolvedOrbs.push(o.id)
      }
    }
  }

  const outPath = path.join(process.cwd(), 'src/data/materials/materials-i18n.json')
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8')

  console.log('\n=== Отчёт ===')
  console.log(
    'material.json:',
    material.length,
    'записей;',
    unresolvedMaterialNames.length,
    'без имени ни на одном языке:',
    unresolvedMaterialNames,
  )
  console.log(
    'material.json: description официально резолвлен для',
    materialDescResolved.length,
    '/',
    material.length,
  )
  console.log(
    'charms.json:',
    charms.length,
    'записей;',
    unresolvedCharms.length,
    'с неполным покрытием (хотя бы 1 язык):',
    unresolvedCharms,
  )
  console.log(
    'orbs.json:',
    orbs.length,
    'записей;',
    unresolvedOrbs.length,
    'без имени ни на одном языке:',
    unresolvedOrbs,
  )
  console.log('Записано в', outPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
