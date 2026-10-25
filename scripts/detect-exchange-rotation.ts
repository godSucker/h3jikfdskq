import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { runMain } from './lib/run-main'
import { pluralize } from '../src/lib/utils'

// Джекпот- и ивент-обменник (Building_Tokens_Jackpot / Building_Event_1 в
// gamedefinitions.xml) - это фиксированные 25 + 9 "слотов", чьё содержимое
// ПЕРЕЗАПИСЫВАЕТСЯ при каждой новой ротации (не накапливается на CDN) - см.
// память re-binary-formulas-plan. Единственный способ не терять историю - ловить
// новые связки (жетон, сумма, мутант) в день, когда они появились в живом XML,
// пока их не затёрла следующая ротация.
//
// Анализатор тайн (Building_Mystery, добавлен 2026-09) - третий обменник, не
// ротирующийся по времени (фиксированный каталог из 6 слотов), но с наградой
// в виде конкретных звезды+скина, а не голого мутанта - отдельная ветка
// парсинга (parseMysteryContracts), см. ниже.
//
// В отличие от detect-missing-obtain.ts (тот НИКОГДА не пишет - там нет
// источника, откуда взять способ получения), этот скрипт умеет построить
// ПОЛНОСТЬЮ готовую и самодостаточную запись {type, where} прямо из XML для
// известных жетонов (TOKEN_PHRASES/FIXED_PHRASES) - такие пишутся в obtain.json
// автоматически, additive-only (только новые связки specimen+type+where,
// существующие записи не трогаются и не удаляются). Неизвестный жетон (нет
// русской фразы) - по-прежнему только репортится, туда нужна ручная калибровка.

const GAME_DEFS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gamedefinitions.xml'

const OBTAIN_PATH = path.join(process.cwd(), 'src/data/mutants/obtain.json')
const SUMMARY_PATH = path.join(process.cwd(), 'scripts/.cache/exchange-summary.md')
// Жетоны, о которых уже слали Telegram-алерт (коммитится: джоба часовая,
// без дедупа одно и то же сообщение уходило бы 9 раз в день).
const ALERTED_PATH = path.join(process.cwd(), 'scripts/exchange-unknown-alerted.json')
const MATERIALS_DIR = path.join(process.cwd(), 'public/materials')

interface ObtainEntry {
  type: string
  where: string
  icon?: string
}

interface Phrase {
  one: string
  few: string
  many: string
}

// Словарь жетон -> русская фраза, выведен из уже прокураченных записей obtain.json
// (jackpot_hall/event_hall). Новый жетон, которого тут нет, просто репортится
// с сырым id - куратор сам решает как его назвать по-русски.
const TOKEN_PHRASES: Record<string, Phrase> = {
  Material_Jackpot_Token: {
    one: 'жетон джекпота',
    few: 'жетона джекпота',
    many: 'жетонов джекпота',
  },
  Material_Hexcity_Token: { one: 'жетон Hexcity', few: 'жетона Hexcity', many: 'жетонов Hexcity' },
  Material_Event_Token: { one: 'жетон ивента', few: 'жетона ивента', many: 'жетонов ивента' },
  Material_Xmas25_Token: {
    one: 'новогодний жетон 2025',
    few: 'новогодних жетона 2025',
    many: 'новогодних жетонов 2025',
  },
  Material_Xmas24_Token: {
    one: 'новогодний жетон 2024',
    few: 'новогодних жетона 2024',
    many: 'новогодних жетонов 2024',
  },
  Material_Easter26_Token: {
    one: 'пасхальный жетон 2026',
    few: 'пасхальных жетона 2026',
    many: 'пасхальных жетонов 2026',
  },
  Material_Capsule_Token: { one: 'жетон капсул', few: 'жетона капсул', many: 'жетонов капсул' },
  Material_Toybox_Token: { one: 'жетон игрушек', few: 'жетона игрушек', many: 'жетонов игрушек' },
  Material_Winter_Orange: {
    one: 'зимний апельсин',
    few: 'зимних апельсина',
    many: 'зимних апельсинов',
  },
  Material_Halloween26_Token: {
    one: 'жетон Селенита',
    few: 'жетона Селенита',
    many: 'жетонов Селенита',
  },
  Material_Mystery25_Token: {
    one: 'таинственный жетон 2025',
    few: 'таинственных жетона 2025',
    many: 'таинственных жетонов 2025',
  },
  Material_Mystery26_Token: {
    one: 'таинственный жетон 2026',
    few: 'таинственных жетона 2026',
    many: 'таинственных жетонов 2026',
  },
}
// Массовые существительные (не склоняются по числу) - фиксированная фраза.
const FIXED_PHRASES: Record<string, string> = {
  Material_Winter_Coal: 'зимнего угля',
}

const BUILDINGS: { entityId: string; obtainType: 'jackpot_hall' | 'event_hall' }[] = [
  { entityId: 'Building_Tokens_Jackpot', obtainType: 'jackpot_hall' },
  { entityId: 'Building_Event_1', obtainType: 'event_hall' },
]

interface Contract {
  amount: number
  item: string
  working: string
}
function extractEntity(xml: string, entityId: string): string {
  const start = xml.indexOf(`<EntityDescriptor id="${entityId}"`)
  if (start < 0) throw new Error(`EntityDescriptor "${entityId}" не найден в gamedefinitions.xml`)
  const end = xml.indexOf('<EntityDescriptor', start + 10)
  return xml.slice(start, end < 0 ? undefined : end)
}

function parseContracts(block: string): Contract[] {
  const contracts: Contract[] = []
  const re =
    /<InteractiveAction[^>]*target="(WORKING_\d+)"[^>]*id="CONTRACT_\d+">\s*<Cost amount="(\d+)" type="entity" id="([^"]+)"\s*\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    contracts.push({ working: m[1], amount: Number(m[2]), item: m[3] })
  }
  return contracts
}

function parseWorkingToReady(block: string): Map<string, string> {
  const map = new Map<string, string>()
  const re =
    /<State[^>]*id="(WORKING_\d+)"[^>]*>\s*<TimeAction[^>]*target="(READY_\d+)" seconds="\d+"\s*\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) map.set(m[1], m[2])
  return map
}

interface ReadyReward {
  id: string
  stars: string | null
  skin: string | null
}

// Награда зала бывает с детьми-тегами (<Reward id="Specimen_X"><Tag key="stars"/>
// <Tag key="skin"/></Reward>) - это конкретные звезда+скин, а не голый мутант
// (Хэллоуин-2026: Specimen_CE_09 / Specimen_BA_04). Раньше теги отбрасывались.
function parseReadyRewards(block: string): Map<string, ReadyReward> {
  const map = new Map<string, ReadyReward>()
  for (const m of block.matchAll(/<State[^>]*id="(READY_\d+)"[^>]*>([\s\S]*?)<\/State>/g)) {
    const [, ready, body] = m
    const action = body.match(
      /<InteractiveAction[^>]*id="RECOLT"[^>]*>([\s\S]*?)<\/InteractiveAction>/,
    )
    if (!action) continue
    const reward = action[1].match(/<Reward\b([^>]*?)(\/>|>([\s\S]*?)<\/Reward>)/)
    if (!reward) continue
    const id = /\bid="([^"]+)"/.exec(reward[1])?.[1]
    if (!id) continue
    const inner = reward[3] ?? ''
    map.set(ready, {
      id,
      stars: inner.match(/<Tag key="stars" value="(\d+)"/)?.[1] ?? null,
      skin: inner.match(/<Tag key="skin" value="([^"]+)"/)?.[1] ?? null,
    })
  }
  return map
}

function expectedWhere(amount: number, item: string): string | null {
  const phrase = TOKEN_PHRASES[item]
  if (phrase)
    return `Зал обмена — ${amount} ${pluralize(amount, phrase.one, phrase.few, phrase.many)}`
  const fixed = FIXED_PHRASES[item]
  if (fixed) return `Зал обмена — ${amount} ${fixed}`
  return null
}

interface MysteryContract {
  specimenId: string
  amount: number
  item: string
  stars: string | null
  skin: string | null
}

// Анализатор тайн (Building_Mystery) - отдельная ветка, не встроена в
// BUILDINGS: тут награда - конкретные звезда+скин (Reward с детьми-тегами),
// а не голый specimenId самозакрывающимся тегом, как у jackpot/event. Тот же
// парсинг, что уже проверен в build-announcements.ts::fetchMysteryContracts.
function parseMysteryContracts(block: string): MysteryContract[] {
  const costByNum = new Map<string, { amount: number; item: string }>()
  for (const m of block.matchAll(
    /<InteractiveAction[^>]*target="WORKING_(\d+)"[^>]*id="CONTRACT_\d+">([\s\S]*?)<\/InteractiveAction>/g,
  )) {
    const [, num, body] = m
    const cost = body.match(/<Cost amount="(\d+)" type="entity" id="([^"]+)"/)
    if (cost) costByNum.set(num, { amount: Number(cost[1]), item: cost[2] })
  }
  const out: MysteryContract[] = []
  for (const m of block.matchAll(/<State[^>]*id="READY_(\d+)"[^>]*>([\s\S]*?)<\/State>/g)) {
    const [, num, body] = m
    const reward = body.match(/<Reward id="([^"]+)">([\s\S]*?)<\/Reward>/)
    if (!reward || !/^Specimen_/i.test(reward[1])) continue
    const cost = costByNum.get(num)
    if (!cost) continue
    out.push({
      specimenId: reward[1].toLowerCase(),
      amount: cost.amount,
      item: cost.item,
      stars: reward[2].match(/<Tag key="stars" value="(\d+)"/)?.[1] ?? null,
      skin: reward[2].match(/<Tag key="skin" value="([^"]+)"/)?.[1] ?? null,
    })
  }
  return out
}

// Суффикс "(N★, скин «X»)" - та же нотация числом+звёздочкой, что у box/bundle
// (см. TIER_STARS в autofill-obtain.ts / renderSuffix в obtain-render.ts) -
// НЕ словом тира ("золото"), а именно цифрой из тега stars.
function withRewardSuffix(base: string, stars: string | null, skin: string | null): string {
  if (skin) return `${base} (${stars ? `${stars}★, ` : ''}скин «${skin}»)`
  if (stars) return `${base} (${stars}★)`
  return base
}

function expectedMysteryWhere(c: MysteryContract): string | null {
  const base = expectedWhere(c.amount, c.item)
  return base === null ? null : withRewardSuffix(base, c.stars, c.skin)
}

// Иконка жетона - только если текстура реально лежит в public/materials
// (у старых записей зала иконка есть не везде, так что она опциональна).
async function tokenIcon(item: string): Promise<string | undefined> {
  try {
    await fs.access(path.join(MATERIALS_DIR, `${item}.png`))
    return `/materials/${item}.png`
  } catch {
    return undefined
  }
}

async function sendTelegramMessage(text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    console.log(
      '[EXCHANGE-WATCH] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы, алерт не отправлен',
    )
    return
  }
  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
  })
}

// Неизвестный жетон раньше только попадал в summary-файл, который никто не
// читает: 2026-10-02 четыре мутанта Хэллоуин-обменника (жетон Селенита) так и
// не попали на сайт. Теперь о каждом новом жетоне шлём алерт ОДИН раз.
async function alertUnknownTokens(
  unknownTokens: { specimenId: string; obtainType: string; amount: number; item: string }[],
) {
  let alerted: string[] = []
  try {
    alerted = JSON.parse(await fs.readFile(ALERTED_PATH, 'utf-8'))
  } catch {
    // нет файла - ещё ни о чём не алертили
  }
  const fresh = [...new Set(unknownTokens.map((u) => u.item))].filter((i) => !alerted.includes(i))
  if (fresh.length === 0) return
  const lines = fresh.map((item) => {
    const who = unknownTokens
      .filter((u) => u.item === item)
      .map((u) => `${u.specimenId} (${u.amount})`)
      .join(', ')
    return `- ${item}: ${who}`
  })
  try {
    await sendTelegramMessage(
      `⚠️ Обменник: жетон без русской фразы, мутанты НЕ попали в obtain.json\n${lines.join('\n')}\n` +
        'Нужно добавить жетон в TOKEN_PHRASES (scripts/detect-exchange-rotation.ts) и EXCHANGE_TOKEN_DESC (src/lib/obtain-render.ts).',
    )
  } catch (err) {
    console.error(
      '[EXCHANGE-WATCH] не удалось отправить алерт:',
      err instanceof Error ? err.message : err,
    )
    return // не помечаем как отправленное - повторим в следующий прогон
  }
  await fs.writeFile(ALERTED_PATH, JSON.stringify([...alerted, ...fresh], null, 2) + '\n', 'utf-8')
}

async function main() {
  const { data: xml } = await axios.get<string>(GAME_DEFS_URL, { responseType: 'text' })
  const obtain: Record<string, ObtainEntry[]> = JSON.parse(await fs.readFile(OBTAIN_PATH, 'utf-8'))

  const missing: { specimenId: string; obtainType: string; where: string; icon?: string }[] = []
  const unknownTokens: { specimenId: string; obtainType: string; amount: number; item: string }[] =
    []

  for (const { entityId, obtainType } of BUILDINGS) {
    // try/catch ОБЯЗАТЕЛЕН: Kobojo уже переименовывала EntityDescriptor'ы
    // без предупреждения в других XML (см. detect-new-dungeons.ts). Без
    // защиты один переименованный/удалённый обменник роняет ВЕСЬ детектор
    // (оба обменника, а не только сломанный) без единой строчки прогресса
    // (найдено код-ревью 2026-08-08).
    let block: string
    try {
      block = extractEntity(xml, entityId)
    } catch (err) {
      console.error(
        `[EXCHANGE-WATCH] ${entityId} не найден в gamedefinitions.xml (переименовали/убрали?), пропуск:`,
        err instanceof Error ? err.message : err,
      )
      continue
    }
    const contracts = parseContracts(block)
    const workingToReady = parseWorkingToReady(block)
    const readyRewards = parseReadyRewards(block)

    for (const c of contracts) {
      const ready = workingToReady.get(c.working)
      if (!ready) continue
      const reward = readyRewards.get(ready)
      if (!reward || !/^Specimen_/i.test(reward.id)) continue // obtain.json - только про мутантов

      const specimenId = reward.id.toLowerCase()
      const base = expectedWhere(c.amount, c.item)

      if (base === null) {
        unknownTokens.push({ specimenId, obtainType, amount: c.amount, item: c.item })
        continue
      }

      // Звезда+скин в where - только для НОВЫХ записей. Старые записи зала
      // писались без суффикса (парсер теги не читал), поэтому голый base
      // считается покрытием: иначе каждая историческая награда со скином
      // дублировалась бы вторым вариантом записи.
      const where = withRewardSuffix(base, reward.stars, reward.skin)
      const entries = obtain[specimenId] ?? []
      const alreadyCovered = entries.some(
        (e) => e.type === obtainType && (e.where === where || e.where === base),
      )
      if (!alreadyCovered)
        missing.push({ specimenId, obtainType, where, icon: await tokenIcon(c.item) })
    }
  }

  // Анализатор тайн (Building_Mystery) - см. parseMysteryContracts. Не
  // ротация по датам как у двух других залов, а фиксированный каталог из 6
  // слотов, который просто РАСТЁТ (или меняется), когда Kobojo его обновит -
  // additive-only так же, как остальные, никакого особого случая для записи.
  try {
    const mysteryBlock = extractEntity(xml, 'Building_Mystery')
    for (const c of parseMysteryContracts(mysteryBlock)) {
      const where = expectedMysteryWhere(c)
      if (where === null) {
        unknownTokens.push({
          specimenId: c.specimenId,
          obtainType: 'mystery_hall',
          amount: c.amount,
          item: c.item,
        })
        continue
      }
      const entries = obtain[c.specimenId] ?? []
      const alreadyCovered = entries.some((e) => e.type === 'mystery_hall' && e.where === where)
      if (!alreadyCovered)
        missing.push({
          specimenId: c.specimenId,
          obtainType: 'mystery_hall',
          where,
          icon: await tokenIcon(c.item),
        })
    }
  } catch (err) {
    console.error(
      '[EXCHANGE-WATCH] Building_Mystery не найден в gamedefinitions.xml (переименовали/убрали?), пропуск:',
      err instanceof Error ? err.message : err,
    )
  }

  let written: typeof missing = []
  if (missing.length > 0) {
    for (const m of missing) {
      const entries = obtain[m.specimenId] ?? []
      entries.push({ type: m.obtainType, where: m.where, ...(m.icon ? { icon: m.icon } : {}) })
      obtain[m.specimenId] = entries
    }
    written = missing
    await fs.writeFile(OBTAIN_PATH, JSON.stringify(obtain, null, 2) + '\n', 'utf-8')
  }

  if (unknownTokens.length > 0) await alertUnknownTokens(unknownTokens)

  const lines: string[] = ['### Ротация обменников (джекпот/ивент/анализатор тайн)']
  if (written.length === 0 && unknownTokens.length === 0) {
    lines.push('✅ Текущее содержимое всех 3 обменников полностью отражено в obtain.json')
  } else {
    if (written.length > 0) {
      lines.push(`✅ Записано в obtain.json (${written.length}):`)
      for (const m of written) {
        lines.push(`- \`${m.specimenId}\`: \`{"type": "${m.obtainType}", "where": "${m.where}"}\``)
      }
    }
    if (unknownTokens.length > 0) {
      lines.push(
        `⚠️ Неизвестный жетон - нужна русская фраза в TOKEN_PHRASES (${unknownTokens.length}):`,
      )
      for (const u of unknownTokens) {
        lines.push(`- \`${u.specimenId}\` (${u.obtainType}): ${u.amount} × \`${u.item}\``)
      }
      lines.push('')
      lines.push(
        'Для этих строк нет русской фразы для жетона - obtain.json не трогается, ' +
          'нужно вручную добавить жетон в TOKEN_PHRASES/FIXED_PHRASES, пока их не ' +
          'затёрла следующая ротация обменника (см. память re-binary-formulas-plan).',
      )
    }
  }

  const cacheDir = path.join(process.cwd(), 'scripts/.cache')
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(SUMMARY_PATH, lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

runMain(import.meta.url, 'EXCHANGE-DETECT', main)
