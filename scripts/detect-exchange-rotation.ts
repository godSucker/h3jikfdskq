import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { pluralize } from '../src/lib/utils'

// Джекпот- и ивент-обменник (Building_Tokens_Jackpot / Building_Event_1 в
// gamedefinitions.xml) - это фиксированные 25 + 9 "слотов", чьё содержимое
// ПЕРЕЗАПИСЫВАЕТСЯ при каждой новой ротации (не накапливается на CDN) - см.
// память re-binary-formulas-plan. Единственный способ не терять историю - ловить
// новые связки (жетон, сумма, мутант) в день, когда они появились в живом XML,
// пока их не затёрла следующая ротация.
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

function parseReadyRewards(block: string): Map<string, string> {
  const map = new Map<string, string>()
  const re =
    /<State[^>]*id="(READY_\d+)"[^>]*>\s*<InteractiveAction[^>]*id="RECOLT"[^>]*>\s*<Reward\b([^/>]*)\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    const idMatch = /id="([^"]+)"/.exec(m[2])
    if (idMatch) map.set(m[1], idMatch[1])
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

async function main() {
  const { data: xml } = await axios.get<string>(GAME_DEFS_URL, { responseType: 'text' })
  const obtain: Record<string, ObtainEntry[]> = JSON.parse(await fs.readFile(OBTAIN_PATH, 'utf-8'))

  const missing: { specimenId: string; obtainType: string; where: string }[] = []
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
      if (!reward || !/^Specimen_/i.test(reward)) continue // obtain.json - только про мутантов

      const specimenId = reward.toLowerCase()
      const where = expectedWhere(c.amount, c.item)

      if (where === null) {
        unknownTokens.push({ specimenId, obtainType, amount: c.amount, item: c.item })
        continue
      }

      const entries = obtain[specimenId] ?? []
      const alreadyCovered = entries.some((e) => e.type === obtainType && e.where === where)
      if (!alreadyCovered) missing.push({ specimenId, obtainType, where })
    }
  }

  let written: typeof missing = []
  if (missing.length > 0) {
    for (const m of missing) {
      const entries = obtain[m.specimenId] ?? []
      entries.push({ type: m.obtainType, where: m.where })
      obtain[m.specimenId] = entries
    }
    written = missing
    await fs.writeFile(OBTAIN_PATH, JSON.stringify(obtain, null, 2) + '\n', 'utf-8')
  }

  const lines: string[] = ['### Ротация обменников (джекпот/ивент)']
  if (written.length === 0 && unknownTokens.length === 0) {
    lines.push('✅ Текущая ротация обоих обменников полностью отражена в obtain.json')
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

main().catch((err) => {
  console.error('[EXCHANGE-DETECT] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
