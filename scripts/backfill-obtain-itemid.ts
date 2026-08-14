// Батч 11 (3): бэкафилл itemId для obtain.json bundle/box записей - ТОЛЬКО
// ДОБАВЛЯЕТ поле itemId рядом с where, никогда не трогает where (7 коммитов
// ручной курации - см. память obtain-trigger-offer-names-fixed). Если diff
// после запуска показывает удаления в obtain.json - что-то не так, откатить.
//
// Логика повторяет resolveName() из build-boxes.ts (itemId -> localisation_ru.txt,
// с учётом регистронезависимости и снятия caption-суффиксов) + спецкейс
// category="specimen" из памяти obtain-trigger-offer-names-fixed (10 из 47
// офферов были триггерами на мутанта, правильное имя - "Спецпредложение «X»").
//
// Запуск: npx tsx scripts/backfill-obtain-itemid.ts

import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const OBTAIN_PATH = path.join(process.cwd(), 'src/data/mutants/obtain.json')
const MUTANTS_PATH = path.join(process.cwd(), 'src/data/mutants/mutants.json')

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

async function main() {
  const [{ data: xml }, { data: locRaw }, mutantsRaw] = await Promise.all([
    axios.get<string>(SHOPITEMS_URL, { responseType: 'text' }),
    axios.get<string>(LOC_RU_URL, { responseType: 'text' }),
    fs.readFile(MUTANTS_PATH, 'utf-8'),
  ])
  const mutants: Array<{ id: string; name: string }> = JSON.parse(mutantsRaw)
  const mutantNameById = new Map(mutants.map((m) => [m.id.toLowerCase(), m.name]))

  const loc = new Map<string, string>()
  const locLower = new Map<string, string>()
  for (const rawLine of locRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const i = line.indexOf(';')
    if (i === -1) continue
    const key = line.slice(0, i)
    const val = line.slice(i + 1)
    loc.set(key, val)
    if (!locLower.has(key.toLowerCase())) locLower.set(key.toLowerCase(), val)
  }
  function lookup(key: string): string | undefined {
    return loc.get(key) ?? locLower.get(key.toLowerCase())
  }

  function resolveName(itemId: string, caption: string | undefined, category: string | undefined): string {
    // Спецпредложение на конкретного мутанта (category="specimen", itemId
    // содержит Specimen_XX_NN[_Star][_sc]) - правильное имя не в локализации,
    // а "Спецпредложение «<имя мутанта>»" (см. obtain-trigger-offer-names-fixed).
    if (category === 'specimen') {
      const baseId = itemId.match(/^(Specimen_[A-Za-z]{2}_\d{2})/)?.[1]
      const mutantName = baseId ? mutantNameById.get(baseId.toLowerCase()) : undefined
      if (mutantName) return balanceQuotes(`Спецпредложение «${mutantName}»`)
    }

    const byItemId = lookup(itemId)
    if (byItemId) return balanceQuotes(byItemId)

    const withoutTrailingDigits = itemId.replace(/\d+$/, '')
    if (withoutTrailingDigits !== itemId) {
      const byStripped = lookup(withoutTrailingDigits)
      if (byStripped) return balanceQuotes(byStripped)
    }

    if (caption) {
      const strippedKey = caption
        .replace(/^\$/, '')
        .replace(/_description$/, '')
        .replace(/_payment_text$/, '')
        .replace(/_tooltip$/, '')
      const byCaption = lookup(strippedKey) ?? lookup(caption)
      if (byCaption && byCaption.length <= 80) return balanceQuotes(byCaption)
    }

    // Триггер-обёртки (#levelUp-262-LuckyBox_Tank и т.п.) - снимаем префикс.
    return itemId
      .replace(/^#\w+-\d+-/, '')
      .replace(/^#/, '')
      .replace(/_/g, ' ')
      .trim()
  }

  const itemBlocks = xml.match(/<ShopItem\b[^>]*>/g) ?? []
  console.log(`[SETUP] ${itemBlocks.length} <ShopItem> тегов в live shopitems.xml`)

  const resolved = new Map<string, string>()
  for (const tag of itemBlocks) {
    const itemId = tag.match(/itemId="([^"]+)"/)?.[1]
    const captionMatch = tag.match(/caption="([^"]*)"/)
    const categoryMatch = tag.match(/category="([^"]*)"/)
    if (!itemId) continue
    resolved.set(itemId, resolveName(itemId, captionMatch?.[1], categoryMatch?.[1]))
  }

  // Обратный индекс: нормализованное имя -> itemId[]. Коллизии (>1 itemId на
  // одно имя, напр. "Легендарный киберконтейнер" легитимно переиспользуется
  // игрой для разных продуктов, см. комментарий в build-boxes.ts) исключаем -
  // лучше не привязать itemId, чем привязать неправильный.
  const byName = new Map<string, string[]>()
  for (const [id, name] of resolved) {
    const norm = name.trim().toLowerCase()
    if (!byName.has(norm)) byName.set(norm, [])
    byName.get(norm)!.push(id)
  }

  function extractPayload(where: string): string {
    let x = where.replace(/^(Набор|Лаки-бокс|Мистери-бокс):\s*/, '')
    // Хвостовая скобочная группа - либо цена ("N золота/серебра", "от $N.NN"),
    // либо у box - метаданные конкретного дропа (звезда/скин/тир), не часть
    // названия товара. В обоих случаях это НЕ часть itemId-имени в шопе -
    // снимаем последнюю скобочную группу целиком (без вложенных скобок).
    x = x.replace(/\s*\([^()]*\)\s*$/, '')
    return x.trim()
  }

  const obtainRaw = await fs.readFile(OBTAIN_PATH, 'utf-8')
  const obtain: Record<string, ObtainEntry[]> = JSON.parse(obtainRaw)

  let totalBundleBox = 0
  let matched = 0
  let ambiguous = 0
  let noMatch = 0
  const matchedNameSet = new Set<string>()
  const ambiguousExamples: string[] = []
  const noMatchExamples: string[] = []

  for (const entries of Object.values(obtain)) {
    for (const e of entries) {
      if (e.type !== 'bundle' && e.type !== 'box') continue
      totalBundleBox++
      const payload = extractPayload(e.where).toLowerCase()
      const candidates = byName.get(payload)
      if (!candidates) {
        noMatch++
        if (noMatchExamples.length < 10) noMatchExamples.push(e.where)
        continue
      }
      if (candidates.length > 1) {
        ambiguous++
        if (ambiguousExamples.length < 10) ambiguousExamples.push(`${e.where} -> [${candidates.join(', ')}]`)
        continue
      }
      e.itemId = candidates[0]
      matched++
      matchedNameSet.add(payload)
    }
  }

  console.log(`\n[РЕЗУЛЬТАТ]`)
  console.log(`Всего bundle+box entries (не уникальных): ${totalBundleBox}`)
  console.log(`Проставлен itemId: ${matched}`)
  console.log(`Неоднозначно (>1 itemId на имя, пропущено): ${ambiguous}`)
  console.log(`Не найдено вообще: ${noMatch}`)
  console.log(`\nПримеры неоднозначных:`)
  ambiguousExamples.forEach((s) => console.log('  ', s))
  console.log(`\nПримеры не найденных (вероятно retired):`)
  noMatchExamples.forEach((s) => console.log('  ', s))

  await fs.writeFile(OBTAIN_PATH, JSON.stringify(obtain, null, 2) + '\n', 'utf-8')
  console.log(`\n[DONE] obtain.json обновлён (itemId добавлен, where не тронут)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
