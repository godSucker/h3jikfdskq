import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'

// Имена боксов на 8 не-RU языках - тот же приём, что resolveName() в
// build-boxes.ts (itemId - ключ в официальной локализации Kobojo), просто
// прогнанный по localisation_{lang}.txt вместо localisation_ru.txt. boxes.json
// сам НЕ трогаем (см. комментарий в build-boxes.ts про изолированный
// пайплайн) - пишем отдельный src/data/boxes-i18n.json, читается через
// src/lib/boxes-i18n.ts::getBoxName().

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LOC_URL = (lang: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/localisation_${lang}.txt`

const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const

const BOXES_PATH = path.join(process.cwd(), 'src/data/boxes.json')
const OUT_PATH = path.join(process.cwd(), 'src/data/boxes-i18n.json')

interface BoxEntry {
  itemId: string
  name: string
}

function balanceQuotes(name: string): string {
  const open = (name.match(/«/g) ?? []).length
  const close = (name.match(/»/g) ?? []).length
  return open > close ? name + '»'.repeat(open - close) : name
}

function loadLocMap(raw: string): { exact: Map<string, string>; lower: Map<string, string> } {
  const exact = new Map<string, string>()
  const lower = new Map<string, string>()
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const i = line.indexOf(';')
    if (i === -1) continue
    const key = line.slice(0, i)
    const val = line.slice(i + 1)
    if (!val) continue
    exact.set(key, val)
    if (!lower.has(key.toLowerCase())) lower.set(key.toLowerCase(), val)
  }
  return { exact, lower }
}

async function main() {
  const [{ data: xml }, boxesRaw] = await Promise.all([
    axios.get<string>(SHOPITEMS_URL, { responseType: 'text' }),
    fs.readFile(BOXES_PATH, 'utf-8'),
  ])
  const boxes = JSON.parse(boxesRaw) as BoxEntry[]

  // caption у каждого itemId - минимальный повторный проход по shopitems.xml,
  // нужен только как fallback (та же логика, что resolveName в build-boxes.ts).
  const captionByItemId = new Map<string, string>()
  const shopItemRe = /<ShopItem\b([^>]*)>/g
  let sm: RegExpExecArray | null
  while ((sm = shopItemRe.exec(xml))) {
    const idMatch = sm[1].match(/itemId="([^"]*)"/)
    const capMatch = sm[1].match(/caption="([^"]*)"/)
    if (idMatch?.[1] && capMatch?.[1]) captionByItemId.set(idMatch[1], capMatch[1])
  }

  const out: Record<string, Partial<Record<(typeof LOCALES)[number], string>>> = {}

  for (const lang of LOCALES) {
    console.log(`[BOXES-I18N] ${lang}...`)
    const { data: locRaw } = await axios.get<string>(LOC_URL(lang), { responseType: 'text' })
    const { exact, lower } = loadLocMap(locRaw)
    const lookup = (key: string): string | undefined =>
      exact.get(key) ?? lower.get(key.toLowerCase())

    let resolved = 0
    for (const box of boxes) {
      const itemId = box.itemId
      let name: string | undefined = lookup(itemId)

      if (!name) {
        const withoutTrailingDigits = itemId.replace(/\d+$/, '')
        if (withoutTrailingDigits !== itemId) name = lookup(withoutTrailingDigits)
      }

      if (!name) {
        const caption = captionByItemId.get(itemId)
        if (caption) {
          const strippedKey = caption
            .replace(/^\$/, '')
            .replace(/_description$/, '')
            .replace(/_payment_text$/, '')
            .replace(/_tooltip$/, '')
          const byCaption = lookup(strippedKey) ?? lookup(caption)
          if (byCaption && byCaption.length <= 80) name = byCaption
        }
      }

      if (name) {
        if (!out[itemId]) out[itemId] = {}
        out[itemId][lang] = balanceQuotes(name)
        resolved++
      }
    }
    console.log(`[BOXES-I18N] ${lang}: ${resolved}/${boxes.length} резолвлено`)
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  console.log(`[BOXES-I18N] Записано в ${OUT_PATH}`)
}

main().catch((err) => {
  console.error('[BUILD-BOXES-I18N] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
