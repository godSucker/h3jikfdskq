import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'

// Авто-дополнение obtain.json для НОВЫХ мутантов из механически однозначных
// источников. Тот же принцип, что detect-exchange-rotation.ts: строит
// полностью готовую запись {type, where} прямо из игрового XML, additive-only
// (трогает ТОЛЬКО мутантов, у которых в obtain.json нет НИ ОДНОЙ записи -
// существующие кураторские данные не перезаписываются и не удаляются).
//
// Заполняются только два типа, где нет места трактовке:
//   - магазин (shopitems.xml): Specimen_XX_YY[_Gold/_Silver/_Bronze/_Platinum]
//     с <Cost hardcurrency> -> gold_shop, <Cost softcurrency> -> credits_shop;
//   - PvP-релиз (dailypopup.xml): <Filter>News_release_pvp_XX_YY</Filter> -> pvp.
//
// Всё остальное (скрещивание, бинго, квест, кампания, реактор, рейд, донат-
// паки со своей кураторской формулировкой) по-прежнему только репортится через
// detect-missing-obtain.ts - там нужен человек. Донат-паки ($USD) сознательно
// НЕ трогаем: существующие формулировки ("Донат - стартовый набор (от $X)")
// привязаны к конкретным наборам, авто-фраза была бы неточной.

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const DAILYPOPUP_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dailypopup.xml'

const OBTAIN_PATH = path.join(process.cwd(), 'src/data/mutants/obtain.json')
const MUTANTS_PATH = path.join(process.cwd(), 'src/data/mutants/mutants.json')
const SUMMARY_PATH = path.join(process.cwd(), 'scripts/.cache/obtain-autofill-summary.md')

interface ObtainEntry {
  type: string
  where: string
}

// Суффикс itemId в магазине -> русская "версия" (как в уже прокураченных
// gold_shop/credits_shop записях: "версия: золотой/обычный/бронзовый/...").
const TIER_SUFFIX: Record<string, string> = {
  gold: 'золотой',
  silver: 'серебряный',
  bronze: 'бронзовый',
  platinum: 'платиновый',
}

// Неразрывный пробел как разделитель тысяч - так же, как в существующих
// записях obtain.json ("Магазин за 2 800 золота").
function formatAmount(n: number): string {
  // U+00A0 (неразрывный пробел) каждые 3 разряда - как в obtain.json
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
}

function shopWhere(
  amount: number,
  currency: 'hardcurrency' | 'softcurrency',
  tier: string,
): string {
  const version = ` (версия: ${tier})`
  return currency === 'hardcurrency'
    ? `Магазин за ${formatAmount(amount)} золота${version}`
    : `Магазин за ${formatAmount(amount)} серебра/кредитов${version}`
}

// "Specimen_DA_15", "Specimen_DA_15_Gold", "specimen_da_15_bronze" ->
// { base: "specimen_da_15", tier: "золотой" }. Возвращает null, если это не
// чистый мутант-itemId (пакеты вида "Specimen_DA_15_rc" с реал-ценой,
// "..._sc" и т.п. - не наш случай, их отсекаем).
function parseSpecimenItemId(itemId: string): { base: string; tier: string } | null {
  const m = /^Specimen_([A-Za-z]{1,2}_\d{1,2})(?:_(Gold|Silver|Bronze|Platinum))?$/i.exec(itemId)
  if (!m) return null
  const base = `specimen_${m[1].toLowerCase()}`
  const tier = m[2] ? (TIER_SUFFIX[m[2].toLowerCase()] ?? 'обычный') : 'обычный'
  return { base, tier }
}

async function main(): Promise<void> {
  const [{ data: shopXml }, { data: dailyXml }] = await Promise.all([
    axios.get<string>(SHOPITEMS_URL, { responseType: 'text', timeout: 20000 }),
    axios.get<string>(DAILYPOPUP_URL, { responseType: 'text', timeout: 20000 }),
  ])

  const obtain: Record<string, ObtainEntry[]> = JSON.parse(await fs.readFile(OBTAIN_PATH, 'utf-8'))
  const mutants: { id: string }[] = JSON.parse(await fs.readFile(MUTANTS_PATH, 'utf-8'))

  // Кандидаты - только мутанты БЕЗ единой записи в obtain.json.
  const needObtain = new Set(
    mutants.map((m) => m.id).filter((id) => !(id in obtain) || (obtain[id]?.length ?? 0) === 0),
  )
  if (needObtain.size === 0) {
    await writeSummary(['### Авто-дополнение obtain.json', '✅ Все мутанты имеют obtain-данные'])
    return
  }

  // candidate -> предлагаемые записи (дедуп по type|where)
  const proposed = new Map<string, ObtainEntry[]>()
  const pushEntry = (id: string, entry: ObtainEntry) => {
    if (!needObtain.has(id)) return
    const list = proposed.get(id) ?? []
    if (!list.some((e) => e.type === entry.type && e.where === entry.where)) list.push(entry)
    proposed.set(id, list)
  }

  // 1. Магазин
  for (const itemXml of shopXml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    if (!itemId) continue
    const parsed = parseSpecimenItemId(itemId)
    if (!parsed || !needObtain.has(parsed.base)) continue
    const cost = itemXml.match(/<Cost amount="(\d+)" type="(hardcurrency|softcurrency)"\s*\/>/)
    if (!cost) continue // донат-паки ($USD) и прочее - не наш случай, репортит detect-missing-obtain
    const amount = Number(cost[1])
    const currency = cost[2] as 'hardcurrency' | 'softcurrency'
    pushEntry(parsed.base, {
      type: currency === 'hardcurrency' ? 'gold_shop' : 'credits_shop',
      where: shopWhere(amount, currency, parsed.tier),
    })
  }

  // 2. PvP-релиз: <Filter>News_release_pvp_bb_14</Filter>
  for (const rel of dailyXml.match(/News_release_pvp_([A-Za-z]{1,2}_\d{1,2})/gi) ?? []) {
    const suffix = rel.replace(/^News_release_pvp_/i, '').toLowerCase()
    pushEntry(`specimen_${suffix}`, {
      type: 'pvp',
      where: 'Награда за прогресс в ПВП/арене',
    })
  }

  // Запись (additive - только у тех, кто реально пуст)
  const written: { id: string; entry: ObtainEntry }[] = []
  for (const [id, entries] of proposed) {
    if (!needObtain.has(id) || entries.length === 0) continue
    obtain[id] = entries
    for (const e of entries) written.push({ id, entry: e })
  }
  if (written.length > 0) {
    await fs.writeFile(OBTAIN_PATH, JSON.stringify(obtain, null, 2) + '\n', 'utf-8')
  }

  const stillMissing = [...needObtain].filter((id) => !proposed.has(id)).sort()
  const lines = ['### Авто-дополнение obtain.json']
  if (written.length > 0) {
    lines.push(`✅ Записано (${written.length}):`)
    for (const w of written) {
      lines.push(`- \`${w.id}\`: \`{"type": "${w.entry.type}", "where": "${w.entry.where}"}\``)
    }
  } else {
    lines.push('✅ Новых мутантов с механически определяемым источником нет')
  }
  if (stillMissing.length > 0) {
    lines.push('')
    lines.push(
      `ℹ️ Без механического источника (${stillMissing.length}) - остаются на detect-missing-obtain.ts / ручную калибровку:`,
    )
    for (const id of stillMissing) lines.push(`- \`${id}\``)
  }
  await writeSummary(lines)
}

async function writeSummary(lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(SUMMARY_PATH), { recursive: true })
  await fs.writeFile(SUMMARY_PATH, lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error('[OBTAIN-AUTOFILL] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
