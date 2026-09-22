import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { runMain } from './lib/run-main'
import { BINGO_RU } from '../src/lib/mutant-dicts'

// Авто-обновление obtain.json из механически однозначных игровых данных.
// Additive-only: существующие записи никогда не переписываются и не удаляются.
//
// Источники и ключ записи:
//   - магазин (shopitems.xml, Specimen_XX_YY[_Gold/...] с <Cost>): gold_shop /
//     credits_shop, одна запись на (мутант, тип, версия-звезда);
//   - боксы (src/data/boxes.json, собирается шагом 5): запись на каждый дроп,
//     с itemId бокса;
//   - награда бинго (src/data/bingos.json): запись на (мутант, bingoId);
//   - PvP-релиз (dailypopup.xml, News_release_pvp_XX_YY): одна pvp-запись.
//
// Зачем база уже виденных itemId (obtain-autofill-seen.json): obtain.json от
// 31.07.2026 калибровали руками, и тот же оффер там часто лежит под другой
// формулировкой (сезонные боксы как "Набор: Mystery Valentines", зодиаки как
// "Набор: Либраро"), а названия боксов повторяются из года в год. Ни текст,
// ни название не годятся в ключ дедупа, поэтому авто-запись идёт только для
// itemId, появившихся ПОСЛЕ базы. Всё, что было в базе, остаётся кураторским.
// Мутант совсем без записей по-прежнему получает все листинги магазина.
//
// Наборы, донат-паки, рейды, лесенки, квесты, кампания и кроссоверы остаются
// ручными: формулировки там подобраны под конкретный пак (detect-missing-obtain.ts).

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const DAILYPOPUP_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dailypopup.xml'

const OBTAIN_PATH = path.join(process.cwd(), 'src/data/mutants/obtain.json')
const MUTANTS_PATH = path.join(process.cwd(), 'src/data/mutants/mutants.json')
const SEEN_PATH = path.join(process.cwd(), 'scripts/obtain-autofill-seen.json')
const BOXES_PATH = path.join(process.cwd(), 'src/data/boxes.json')
const BINGOS_PATH = path.join(process.cwd(), 'src/data/bingos.json')
const SUMMARY_PATH = path.join(process.cwd(), 'scripts/.cache/obtain-autofill-summary.md')

interface ObtainEntry {
  type: string
  where: string
  icon?: string
  itemId?: string
  bingoId?: string
  archived?: boolean
}

interface SeenSources {
  shop: string[]
  box: string[]
}

interface BoxDrop {
  id: string
  tier: string | null
  skin: string | null
}

interface Box {
  itemId: string
  icon: string | null
  category: string
  name: string
  groups: { mutants: BoxDrop[] }[]
}

interface Bingo {
  id: string
  rewards?: { name?: string; type?: string }[]
}

// Тир дропа бокса -> звёзды, как в сгенерированных записях "(3★, скин «autumn»)".
const WEAK_MUTANTS = new Set(['specimen_a_02', 'specimen_b_02', 'specimen_c_02'])

const TIER_STARS: Record<string, number> = {
  бронза: 1,
  серебро: 2,
  золото: 3,
  платина: 4,
}

// Та же формулировка, что у сгенерированных box-записей: "(золото)" для
// звёздного дропа, "(3★, скин «autumn»)" для скина, без скобок для базового.
function boxWhere(box: Box, drop: BoxDrop): string {
  const name = box.name.replace(/\s+/g, ' ').trim()
  const stars = drop.tier ? TIER_STARS[drop.tier] : undefined
  let suffix = ''
  if (drop.skin) suffix = stars ? ` (${stars}★, скин «${drop.skin}»)` : ` (скин «${drop.skin}»)`
  else if (drop.tier) suffix = ` (${drop.tier})`
  return `${box.category}: ${name}${suffix}`
}

// Бокс, у которого имя - это просто itemId ("mystery box xmas22 2"), ещё без
// русской локализации: ждём её, а не пишем сырой id.
function hasLocalisedName(box: Box): boolean {
  const name = box.name.replace(/\s+/g, ' ').trim().toLowerCase()
  return name !== '' && name !== box.itemId.replace(/_/g, ' ').toLowerCase()
}

function shopVersion(where: string): string | null {
  return where.match(/\(версия: ([^)]+)\)$/)?.[1] ?? null
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
  const boxes: Box[] = JSON.parse(await fs.readFile(BOXES_PATH, 'utf-8'))
  const bingos: Bingo[] = JSON.parse(await fs.readFile(BINGOS_PATH, 'utf-8'))
  const known = new Set(mutants.map((m) => m.id.toLowerCase()))

  // Мутант без единой записи получает все листинги магазина (старое поведение).
  const empty = new Set([...known].filter((id) => (obtain[id]?.length ?? 0) === 0))

  const shopItems: { itemId: string; base: string; tier: string; entry: ObtainEntry }[] = []
  for (const itemXml of shopXml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    if (!itemId) continue
    const parsed = parseSpecimenItemId(itemId)
    if (!parsed) continue
    // Без Filter или со скрывающим (Hidden_Old_Items) товар в магазине не
    // показывается - это архив, а не способ получения.
    const filter = itemXml.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    if (!filter || /^hidden/i.test(filter)) continue
    const cost = itemXml.match(/<Cost amount="(\d+)" type="(hardcurrency|softcurrency)"\s*\/>/)
    if (!cost) continue // донат-паки ($USD) курируются руками
    const amount = Number(cost[1])
    const currency = cost[2] as 'hardcurrency' | 'softcurrency'
    shopItems.push({
      itemId,
      base: parsed.base,
      tier: parsed.tier,
      entry: {
        type: currency === 'hardcurrency' ? 'gold_shop' : 'credits_shop',
        where: shopWhere(amount, currency, parsed.tier),
      },
    })
  }

  // Первый запуск: всё, что уже есть в игровых данных, - кураторская база.
  let seen: SeenSources
  let bootstrap = false
  try {
    seen = JSON.parse(await fs.readFile(SEEN_PATH, 'utf-8'))
  } catch {
    bootstrap = true
    seen = {
      shop: [...new Set(shopItems.map((s) => s.itemId))],
      box: boxes.map((b) => b.itemId),
    }
  }
  const seenShop = new Set(seen.shop)
  const seenBox = new Set(seen.box)

  const written: { id: string; entry: ObtainEntry }[] = []
  const skipped: string[] = []
  const add = (id: string, entry: ObtainEntry) => {
    const list = obtain[id] ?? []
    const dup = list.some(
      (e) =>
        e.type === entry.type &&
        e.where === entry.where &&
        (e.itemId ?? null) === (entry.itemId ?? null),
    )
    if (dup) return
    list.push(entry)
    obtain[id] = list
    written.push({ id, entry })
  }

  // 1. Магазин
  for (const item of shopItems) {
    if (!known.has(item.base)) continue // мутант ещё не распарсен - в следующий прогон
    const isNew = !seenShop.has(item.itemId)
    if (empty.has(item.base) || isNew) {
      const hasVersion = (obtain[item.base] ?? []).some(
        (e) => e.type === item.entry.type && shopVersion(e.where) === item.tier,
      )
      if (!hasVersion) add(item.base, item.entry)
    }
    if (isNew) seenShop.add(item.itemId)
  }

  // 2. Боксы
  for (const box of boxes) {
    if (seenBox.has(box.itemId)) continue
    if (!box.category || !hasLocalisedName(box)) {
      skipped.push(`box \`${box.itemId}\` (“${box.name}”): нет категории или русского имени`)
      continue
    }
    // Слабых мутантов (Specimen_A/B/C_02) в obtain.json не пишем никогда -
    // их нет в mutants.json, но ждать их бессмысленно.
    const drops = box.groups.flatMap((g) => g.mutants).filter((d) => !WEAK_MUTANTS.has(d.id))
    if (drops.some((d) => !known.has(d.id))) {
      skipped.push(`box \`${box.itemId}\`: в дропе мутант, который ещё не распарсен`)
      continue
    }
    for (const drop of drops) {
      add(drop.id, {
        type: 'box',
        where: boxWhere(box, drop),
        ...(box.icon ? { icon: box.icon } : {}),
        itemId: box.itemId,
      })
    }
    seenBox.add(box.itemId)
  }

  // 3. Награды за бинго
  for (const board of bingos) {
    for (const reward of board.rewards ?? []) {
      const id = reward.name?.match(/^Specimen_[A-Za-z]{1,2}_\d{1,2}$/i)?.[0]?.toLowerCase()
      if (!id || !known.has(id)) continue
      if ((obtain[id] ?? []).some((e) => e.type === 'bingo' && e.bingoId === board.id)) continue
      const title = BINGO_RU[board.id]
      if (!title) {
        skipped.push(`bingo \`${board.id}\` rewards \`${id}\`: нет русского имени доски в BINGO_RU`)
        continue
      }
      add(id, {
        type: 'bingo',
        where: `Награда за бинго «${title}»`,
        bingoId: board.id,
        archived: false,
      })
    }
  }

  // 4. PvP-релиз: <Filter>News_release_pvp_bb_14</Filter>
  for (const rel of dailyXml.match(/News_release_pvp_([A-Za-z]{1,2}_\d{1,2})/gi) ?? []) {
    const id = `specimen_${rel.replace(/^News_release_pvp_/i, '').toLowerCase()}`
    if (!known.has(id)) continue
    if ((obtain[id] ?? []).some((e) => e.type === 'pvp')) continue
    add(id, { type: 'pvp', where: 'Награда за прогресс в ПВП/арене' })
  }

  if (written.length > 0) {
    await fs.writeFile(OBTAIN_PATH, JSON.stringify(obtain, null, 2) + '\n', 'utf-8')
  }
  const nextSeen: SeenSources = {
    shop: [...seenShop].sort(),
    box: [...seenBox].sort(),
  }
  if (
    bootstrap ||
    nextSeen.shop.length !== seen.shop.length ||
    nextSeen.box.length !== seen.box.length
  ) {
    await fs.writeFile(SEEN_PATH, JSON.stringify(nextSeen, null, 2) + '\n', 'utf-8')
  }

  const lines = ['### Авто-дополнение obtain.json']
  if (bootstrap) {
    lines.push(
      `ℹ️ Первый запуск: ${nextSeen.shop.length} товаров магазина и ${nextSeen.box.length} боксов записаны как уже известные (кураторская база)`,
    )
  }
  if (written.length > 0) {
    lines.push(`✅ Записано (${written.length}):`)
    for (const w of written) {
      lines.push(`- \`${w.id}\`: \`{"type": "${w.entry.type}", "where": "${w.entry.where}"}\``)
    }
  } else {
    lines.push('✅ Новых источников нет')
  }
  if (skipped.length > 0) {
    lines.push('')
    lines.push(`⏳ Отложено до следующего прогона (${skipped.length}):`)
    for (const s of skipped) lines.push(`- ${s}`)
  }
  const stillEmpty = [...known].filter((id) => (obtain[id]?.length ?? 0) === 0).sort()
  if (stillEmpty.length > 0) {
    lines.push('')
    lines.push(
      `ℹ️ «Источник неизвестен» (${stillEmpty.length}): ${stillEmpty.map((id) => `\`${id}\``).join(', ')}`,
    )
  }
  await writeSummary(lines)
}

async function writeSummary(lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(SUMMARY_PATH), { recursive: true })
  await fs.writeFile(SUMMARY_PATH, lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

runMain(import.meta.url, 'OBTAIN-AUTOFILL', main)
