// zones.json - зоны обитания (habitat), полностью шаблонные name/description
// ("Зона {слово} · вместимость {N}", "Ген: {слово} • Вместимость: {N}").
// ВАЖНО: слова зон ("Робот"/"Зомби"/"Рубака"/"Зверь"/"Галактик"/"Мифик" в
// description, но "Киборг"/"Зомби"/... в name) НЕ совпадают 1:1 с канонич.
// GENE_RU (A=Киборг, B=Нежить) - это отдельный, уже существующий разнобой в
// исходных RU-данных самого сайта. Не нормализуем его молча (см. правило
// "показывать данные как есть"), просто переводим оба варианта слов по
// отдельности через свой словарь, сохраняя ту же (уже имеющуюся)
// несогласованность name/description на всех языках.
//
// Запуск: npx tsx scripts/build-zones-i18n.ts

import fs from 'fs/promises'
import path from 'path'

const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
type Locale = (typeof LOCALES)[number]

const ZONE_WORD: Record<Locale, string> = {
  en: 'Zone', es: 'Zona', fr: 'Zone', de: 'Zone', pt: 'Zona', it: 'Zona', tr: 'Bölge', nl: 'Zone',
}
const LUXE_WORD: Record<Locale, string> = {
  en: 'Luxe', es: 'Lujo', fr: 'Luxe', de: 'Luxus', pt: 'Luxo', it: 'Lusso', tr: 'Lüks', nl: 'Luxe',
}
const CAPACITY_WORD: Record<Locale, string> = {
  en: 'capacity', es: 'capacidad', fr: 'capacité', de: 'Kapazität', pt: 'capacidade', it: 'capacità', tr: 'kapasite', nl: 'capaciteit',
}
const GENE_LABEL: Record<Locale, string> = {
  en: 'Gene', es: 'Gen', fr: 'Gène', de: 'Gen', pt: 'Gene', it: 'Gene', tr: 'Gen', nl: 'Gen',
}
const ANY_GENES: Record<Locale, string> = {
  en: 'Any genes', es: 'Cualquier gen', fr: "N'importe quel gène", de: 'Beliebige Gene',
  pt: 'Qualquer gene', it: 'Qualsiasi gene', tr: 'Herhangi bir gen', nl: 'Elk gen',
}
const UNIVERSAL_ZONE: Record<Locale, string> = {
  en: 'Universal zone', es: 'Zona universal', fr: 'Zone universelle', de: 'Universalzone',
  pt: 'Zona universal', it: 'Zona universale', tr: 'Evrensel bölge', nl: 'Universele zone',
}
// "name" зон использует другие слова, чем "description" (см. коммент выше) -
// отдельный словарь, 1:1 с реальными словами, встречающимися в name-полях
const NAME_GENE_WORD: Record<string, Record<Locale, string>> = {
  Киборг: { en: 'Cyborg', es: 'Cíborg', fr: 'Cyborg', de: 'Cyborg', pt: 'Ciborgue', it: 'Cyborg', tr: 'Siborg', nl: 'Cyborg' },
  Зомби: { en: 'Zombie', es: 'Zombi', fr: 'Zombie', de: 'Zombie', pt: 'Zumbi', it: 'Zombie', tr: 'Zombi', nl: 'Zombie' },
  Рубака: { en: 'Brawler', es: 'Luchador', fr: 'Bagarreur', de: 'Schläger', pt: 'Brigão', it: 'Attaccabrighe', tr: 'Kavgacı', nl: 'Vechtersbaas' },
  Зверь: { en: 'Beast', es: 'Bestia', fr: 'Bête', de: 'Bestie', pt: 'Fera', it: 'Bestia', tr: 'Canavar', nl: 'Beest' },
  Галактик: { en: 'Galactic', es: 'Galáctico', fr: 'Galactique', de: 'Galaktisch', pt: 'Galáctico', it: 'Galattico', tr: 'Galaktik', nl: 'Galactisch' },
  Мифик: { en: 'Mythic', es: 'Mítico', fr: 'Mythique', de: 'Mythisch', pt: 'Mítico', it: 'Mitico', tr: 'Mitik', nl: 'Mythisch' },
}
// "description" зон использует "Робот"/"Зомби"/"Рубака"/"Зверь"/"Галактик"/"Мифик"
const DESC_GENE_WORD: Record<string, Record<Locale, string>> = {
  Робот: { en: 'Robot', es: 'Robot', fr: 'Robot', de: 'Roboter', pt: 'Robô', it: 'Robot', tr: 'Robot', nl: 'Robot' },
  Зомби: NAME_GENE_WORD.Зомби,
  Рубака: NAME_GENE_WORD.Рубака,
  Зверь: NAME_GENE_WORD.Зверь,
  Галактик: NAME_GENE_WORD.Галактик,
  Мифик: NAME_GENE_WORD.Мифик,
}

interface ZoneEntry {
  file: string
  name: string
  description: string
}

function translateName(ru: string, locale: Locale): string | null {
  let m = ru.match(/^Зона (.+?) · вместимость (\d+)$/)
  if (m) {
    const word = NAME_GENE_WORD[m[1]]?.[locale]
    if (!word) return null
    return `${ZONE_WORD[locale]} ${word} · ${CAPACITY_WORD[locale]} ${m[2]}`
  }
  m = ru.match(/^Люкс · Универсальная зона · вместимость (\d+)$/)
  if (m) return `${LUXE_WORD[locale]} · ${UNIVERSAL_ZONE[locale]} · ${CAPACITY_WORD[locale]} ${m[1]}`
  m = ru.match(/^Люкс · (.+?) · вместимость (\d+)$/)
  if (m) {
    const word = NAME_GENE_WORD[m[1]]?.[locale]
    if (!word) return null
    return `${LUXE_WORD[locale]} · ${word} · ${CAPACITY_WORD[locale]} ${m[2]}`
  }
  return null
}

function translateDescription(ru: string, locale: Locale): string | null {
  let m = ru.match(/^Ген: (.+?) • Вместимость: (\d+)$/)
  if (m) {
    const word = DESC_GENE_WORD[m[1]]?.[locale]
    if (!word) return null
    return `${GENE_LABEL[locale]}: ${word} • ${CAPACITY_WORD[locale][0].toUpperCase()}${CAPACITY_WORD[locale].slice(1)}: ${m[2]}`
  }
  m = ru.match(/^Люкс-зона\. Ген: (.+?) • Вместимость: (\d+)$/)
  if (m) {
    const word = DESC_GENE_WORD[m[1]]?.[locale]
    if (!word) return null
    return `${LUXE_WORD[locale]} ${ZONE_WORD[locale].toLowerCase()}. ${GENE_LABEL[locale]}: ${word} • ${CAPACITY_WORD[locale][0].toUpperCase()}${CAPACITY_WORD[locale].slice(1)}: ${m[2]}`
  }
  m = ru.match(/^Любые гены • Вместимость: (\d+)$/)
  if (m) return `${ANY_GENES[locale]} • ${CAPACITY_WORD[locale][0].toUpperCase()}${CAPACITY_WORD[locale].slice(1)}: ${m[1]}`
  return null
}

async function main() {
  const zones = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'src/data/materials/zones.json'), 'utf-8'),
  ) as { normal: ZoneEntry[]; luxe: ZoneEntry[] }

  const allEntries = [...zones.normal, ...zones.luxe]
  const out: Partial<Record<Locale, Record<string, { name: string; description: string }>>> = {}
  const unresolved: string[] = []

  for (const locale of LOCALES) {
    out[locale] = {}
    for (const entry of allEntries) {
      const name = translateName(entry.name, locale)
      const description = translateDescription(entry.description, locale)
      if (name && description) {
        out[locale]![entry.file] = { name, description }
      } else if (!unresolved.includes(entry.file)) {
        unresolved.push(entry.file)
      }
    }
  }

  const outPath = path.join(process.cwd(), 'src/data/materials/zones-i18n.json')
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  console.log('Всего зон:', allEntries.length, 'Не резолвлено:', unresolved)
  console.log('Записано в', outPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
