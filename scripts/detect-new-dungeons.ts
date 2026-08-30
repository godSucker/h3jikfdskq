// Сторож новых рейдов/лесенок/спец-лесенок (Фаза 2 авто-анонсов). Источник -
// dungeons.xml, мастер-реестр type=raid/experiment/challenge (см. коммит
// bd62996f3, где raids.json/event-ladders.json/special-ladders.json были
// впервые собраны). ВАЖНО: путь на CDN переехал с gameconfig/dungeons.xml
// на gameconfig/dungeon/dungeons.xml между 2026-08-01 и 2026-08-06 без
// предупреждения - если этот скрипт вдруг начнёт молчать (0 новых) при
// живом ощущении, что что-то должно быть, первым делом проверить, не
// переехал ли путь СНОВА (см. также scripts/detect-broken-paths.ts, Фаза 3).
//
// raid -> raids.json, experiment/challenge -> special-ladders.json[type].
// "event-ladders" (season_*/pve_event, отдельный источник данных вне
// dungeons.xml) сюда НЕ входит - источник этих данных не идентифицирован,
// см. память auto-announcements-architecture.
//
// Как и detect-new-reactors.ts - НЕ пишет данные (нет офиц. RU-имени),
// только алертит в Telegram и просит ".локал dungeon:<id> \"Имя\"".
//
// Для finish-pending.ts (ещё не написан): полная разбивка по волнам/боссам/
// наградам (fightCount/bossCount/currency/items, как в raids.json) НЕ в
// этом файле - это только финальная "витринная" награда. Реальный источник
// - gameconfig/dungeon/dungeon_<id>.xml (ЕДИНСТВЕННОЕ число, отдельный файл
// на каждый данж, подтверждено 2026-08-07: dungeon_architecture.xml даёт
// ровно 300 <Fight> = fightCount:300 в raids.json). Подробности подсчёта -
// в памяти auto-announcements-architecture.

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'

const ROOT = process.cwd()
const DUNGEONS_XML_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dungeon/dungeons.xml'
const RAIDS_PATH = path.join(ROOT, 'src/data/guides/raids.json')
const SPECIAL_LADDERS_PATH = path.join(ROOT, 'src/data/guides/special-ladders.json')
const MUTANT_NAMES_PATH = path.join(ROOT, 'src/data/mutant_names.json')
const PENDING_PATH = path.join(ROOT, 'scripts/pending-names-cache.json')

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return fallback
  }
}

export interface ParsedDungeon {
  id: string
  type: 'raid' | 'experiment' | 'challenge'
  rewards: { id: string; amount: string }[]
}

// Экспортируется для finish-pending.ts (нужен mutantId - витринная награда
// уровня <Dungeon>, её нет в per-fight dungeon_<id>.xml).
export function parseDungeonsXml(xml: string): ParsedDungeon[] {
  const result: ParsedDungeon[] = []
  const blocks = xml.match(/<Dungeon\b[^>]*>[\s\S]*?<\/Dungeon>/g) ?? []
  for (const block of blocks) {
    const idMatch = block.match(/<Dungeon id="([^"]+)"/)
    const typeMatch = block.match(/type="(raid|experiment|challenge)"/)
    if (!idMatch || !typeMatch) continue

    const rewards: { id: string; amount: string }[] = []
    for (const tag of block.match(/<Reward\b[^>]*\/>/g) ?? []) {
      const id = tag.match(/id="([^"]+)"/)?.[1]
      const amount = tag.match(/amount="([^"]+)"/)?.[1] ?? '0'
      if (id) rewards.push({ id, amount })
    }

    result.push({ id: idMatch[1], type: typeMatch[1] as ParsedDungeon['type'], rewards })
  }
  return result
}

async function sendTelegramMessage(text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    console.log('[DUNGEON-WATCH] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы, алерт не отправлен')
    return
  }
  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  })
}

const TYPE_LABEL: Record<ParsedDungeon['type'], string> = {
  raid: 'Рейд',
  experiment: 'Спец-лесенка (experiment)',
  challenge: 'Спец-лесенка (challenge)',
}

async function main() {
  const [xmlRes, raids, specialLadders, mutantNames, pending] = await Promise.all([
    axios.get(DUNGEONS_XML_URL, { timeout: 20000 }),
    loadJson<{ id: string }[]>(RAIDS_PATH, []),
    loadJson<{ experiment: { id: string }[]; challenge: { id: string }[] }>(SPECIAL_LADDERS_PATH, {
      experiment: [],
      challenge: [],
    }),
    loadJson<Record<string, string>>(MUTANT_NAMES_PATH, {}),
    loadJson<Record<string, unknown>>(PENDING_PATH, {}),
  ])

  const parsed = parseDungeonsXml(xmlRes.data)
  const known = new Set([
    ...raids.map((r) => r.id),
    ...specialLadders.experiment.map((r) => r.id),
    ...specialLadders.challenge.map((r) => r.id),
  ])
  const fresh = parsed.filter((d) => !known.has(d.id) && !(`dungeon:${d.id}` in pending))

  if (fresh.length === 0) {
    console.log('[DUNGEON-WATCH] Новых рейдов/лесенок не найдено.')
    return
  }

  for (const d of fresh) {
    const mutantReward = d.rewards.find((r) => r.id.startsWith('Specimen_'))
    const mutantName = mutantReward ? (mutantNames[mutantReward.id] ?? mutantReward.id) : null
    const rewardLines = d.rewards.map((r) => `${r.amount}× ${r.id}`).join(', ')

    const context = [
      `🆕 *Новый(ая) ${TYPE_LABEL[d.type]} в игре*: \`${d.id}\``,
      `Награды: \`${rewardLines || '—'}\``,
      mutantName ? `Мутант-награда: \`${mutantName}\`` : null,
      '',
      `Ответь: \`.локал dungeon:${d.id} "Имя"\``,
    ]
      .filter(Boolean)
      .join('\n')

    // try/catch ОБЯЗАТЕЛЕН: без него сбой одной отправки прерывает main() до
    // записи pending-кэша, и уже отправленные в этом же прогоне алерты
    // теряются из кэша - следующий прогон шлёт их повторно (дубли).
    try {
      await sendTelegramMessage(context)
      pending[`dungeon:${d.id}`] = {
        type: 'dungeon',
        id: d.id,
        dungeonType: d.type,
        alertedAt: new Date().toISOString(),
      }
      console.log(`[DUNGEON-WATCH] Алерт отправлен: ${d.id} (${d.type})`)
    } catch (err) {
      console.error(
        `[DUNGEON-WATCH] Не удалось отправить алерт по ${d.id}, попробуем в следующий прогон:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  await fs.mkdir(path.dirname(PENDING_PATH), { recursive: true })
  await fs.writeFile(PENDING_PATH, JSON.stringify(pending, null, 2) + '\n', 'utf-8')
}

// Только при прямом запуске - см. аналогичный комментарий в detect-new-reactors.ts.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[DUNGEON-WATCH] Ошибка:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
