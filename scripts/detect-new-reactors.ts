// Сторож новых генераторов реактора (Фаза 2 авто-анонсов). Живой gacha.xml -
// источник правды по тому, какие генераторы вообще существуют в игре;
// skinnnedStarHack="false" + реальные tokenCost/hcCost - надёжный признак
// "активен прямо сейчас" (отличает живые паки от исторических retired-
// заглушек с tokenCost="999"). Найдено и проверено вручную 2026-08-06 при
// добавлении "Самоцветов".
//
// В отличие от Фазы 1 (мутанты/скины/...), тут официального RU-имени в игре
// НЕТ (см. память auto-announcements-architecture - проверено на живых
// данных, 0 совпадений в локализации). Поэтому этот скрипт НИЧЕГО не пишет
// в данные сайта - только шлёт алерт в Telegram с полным контекстом и просьбой
// ответить ".локал reactor:<id> \"Имя\"". Вебхук (telegram-webhook.ts) пишет
// имя в scripts/resolved-names-cache.json и триггерит workflow
// finish-pending.yml, который и делает всю реальную работу (арт/CDN/запись).
//
// pending-ledger (scripts/pending-names-cache.json) не даёт слать одно и то
// же уведомление каждый день, пока имя не появится.

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'

const ROOT = process.cwd()
const GACHA_XML_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gacha.xml'
const GACHA_JSON_PATH = path.join(ROOT, 'src/data/simulators/reactor/gacha.json')
const GACHA_NAME_RU_PATH = path.join(ROOT, 'src/data/simulators/reactor/gacha-name-ru.json')
const MUTANT_NAMES_PATH = path.join(ROOT, 'src/data/simulators/reactor/mutant_names.json')
const PENDING_PATH = path.join(ROOT, 'scripts/pending-names-cache.json')

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return fallback
  }
}

export interface GachaSpecimen {
  specimen: string
  stars: number
  odds: number
  bonus: number
}

export interface ParsedGacha {
  id: string
  tokenCost: number
  hcCost: number
  promo: string
  filter: string
  basicElements: GachaSpecimen[]
  completionReward: GachaSpecimen | null
}

// Экспортируется для finish-pending.ts - тот же парсер, чтобы не разъезжаться
// с детектором при изменении формата gacha.xml.
export function parseGachaXml(xml: string): ParsedGacha[] {
  const result: ParsedGacha[] = []
  const gachaBlocks = xml.match(/<Gacha\b[^>]*>[\s\S]*?<\/Gacha>/g) ?? []
  for (const block of gachaBlocks) {
    const idMatch = block.match(/id="([^"]+)"/)
    const hackMatch = block.match(/skinnnedStarHack="([^"]+)"/)
    const tokenMatch = block.match(/tokenCost="([^"]+)"/)
    const hcMatch = block.match(/hcCost="([^"]+)"/)
    const promoMatch = block.match(/promo="([^"]*)"/)
    const filterMatch = block.match(/filter="([^"]*)"/)
    if (!idMatch || hackMatch?.[1] !== 'false') continue

    // Атрибуты GachaSpecimen идут в непостоянном порядке (иногда id= перед
    // specimen=) - ищем specimen/stars/odds/bonus по всему тегу, а не по позиции.
    const parseSpecimenTag = (tag: string): GachaSpecimen | null => {
      const specimen = tag.match(/specimen="([^"]+)"/)?.[1]
      const stars = tag.match(/stars="(\d+)"/)?.[1]
      if (!specimen || !stars) return null
      const odds = tag.match(/odds="(\d+)"/)?.[1] ?? '0'
      const bonus = tag.match(/bonus="(\d+)"/)?.[1] ?? '0'
      return { specimen, stars: Number(stars), odds: Number(odds), bonus: Number(bonus) }
    }

    const basicElements: GachaSpecimen[] = []
    const basicBlock = block.match(/<BasicElements>([\s\S]*?)<\/BasicElements>/)?.[1] ?? ''
    for (const tag of basicBlock.match(/<GachaSpecimen\b[^>]*\/>/g) ?? []) {
      const parsed = parseSpecimenTag(tag)
      if (parsed) basicElements.push(parsed)
    }
    const completionBlock =
      block.match(/<CompletionReward>([\s\S]*?)<\/CompletionReward>/)?.[1] ?? ''
    const completionTag = completionBlock.match(/<GachaSpecimen\b[^>]*\/>/)?.[0] ?? ''
    const completionReward = completionTag ? parseSpecimenTag(completionTag) : null

    result.push({
      id: idMatch[1],
      tokenCost: Number(tokenMatch?.[1] ?? 0),
      hcCost: Number(hcMatch?.[1] ?? 0),
      promo: promoMatch?.[1] ?? '',
      filter: filterMatch?.[1] ?? '',
      basicElements,
      completionReward,
    })
  }
  return result
}

async function sendTelegramMessage(text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    console.log('[REACTOR-WATCH] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы, алерт не отправлен')
    return
  }
  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  })
}

interface StoredGacha {
  basic_elements?: { specimen: string }[]
  completion_reward?: { specimen: string } | null
}

// Kobojo периодически переименовывает id живого генератора, не трогая его
// содержимое (checkmate -> chess, подтверждено 2026-08-06) - сверка ТОЛЬКО
// по id даёт ложное "новый реактор" на каждый такой переезд. Состав
// specimen'ов (basic + completion) - куда более надёжный отпечаток,
// см. память про тот же приём в sync-bingo.ts.
function fingerprint(
  basicElements: { specimen: string }[],
  completion: { specimen: string } | null,
): string {
  const ids = [...basicElements.map((s) => s.specimen), completion?.specimen ?? '']
    .map((s) => s.toLowerCase())
    .sort()
  return ids.join('|')
}

async function main() {
  const [xmlRes, gachaJson, nameRu, mutantNames, pending] = await Promise.all([
    axios.get(GACHA_XML_URL, { timeout: 20000 }),
    loadJson<Record<string, StoredGacha>>(GACHA_JSON_PATH, {}),
    loadJson<Record<string, string>>(GACHA_NAME_RU_PATH, {}),
    loadJson<Record<string, string>>(MUTANT_NAMES_PATH, {}),
    loadJson<Record<string, unknown>>(PENDING_PATH, {}),
  ])

  const active = parseGachaXml(xmlRes.data)
  const known = new Set([...Object.keys(gachaJson), ...Object.keys(nameRu)])
  const knownFingerprints = new Set(
    Object.values(gachaJson).map((g) =>
      fingerprint(g.basic_elements ?? [], g.completion_reward ?? null),
    ),
  )
  const fresh = active.filter(
    (g) =>
      !known.has(g.id) &&
      !(`reactor:${g.id}` in pending) &&
      !knownFingerprints.has(fingerprint(g.basicElements, g.completionReward)),
  )

  if (fresh.length === 0) {
    console.log('[REACTOR-WATCH] Новых активных генераторов не найдено.')
    return
  }

  for (const g of fresh) {
    const resolveName = (specimenId: string) =>
      mutantNames[specimenId] ?? mutantNames[specimenId.replace(/^Specimen_/, '')] ?? specimenId
    const basicList = g.basicElements
      .map((s) => `${resolveName(s.specimen)} (${s.stars}★)`)
      .join(', ')
    const completion = g.completionReward
      ? `${resolveName(g.completionReward.specimen)} (${g.completionReward.stars}★)`
      : '—'

    const context = [
      `🆕 *Новый реактор в игре*: \`${g.id}\``,
      `Цена прокрута: ${g.tokenCost} жетонов / ${g.hcCost} HC`,
      `Промо: ${g.promo || '—'}`,
      `Базовые: ${basicList || '—'}`,
      `Награда за коллекцию: ${completion}`,
      '',
      `Ответь: \`.локал reactor:${g.id} "Имя"\``,
    ].join('\n')

    // try/catch ОБЯЗАТЕЛЕН: без него сбой отправки одного алерта (сетевой
    // сбой/лимит Telegram API) прерывает main() ДО записи pending-кэша, и уже
    // успешно отправленные алерты из этого же прогона теряются из кэша -
    // следующий часовой прогон шлёт их повторно (дубли в личном чате).
    try {
      await sendTelegramMessage(context)
      pending[`reactor:${g.id}`] = {
        type: 'reactor',
        id: g.id,
        alertedAt: new Date().toISOString(),
      }
      console.log(`[REACTOR-WATCH] Алерт отправлен: ${g.id}`)
    } catch (err) {
      console.error(
        `[REACTOR-WATCH] Не удалось отправить алерт по ${g.id}, попробуем в следующий прогон:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  await fs.mkdir(path.dirname(PENDING_PATH), { recursive: true })
  await fs.writeFile(PENDING_PATH, JSON.stringify(pending, null, 2) + '\n', 'utf-8')
}

// Только при прямом запуске (`tsx detect-new-reactors.ts`) - finish-pending.ts
// импортирует parseGachaXml из этого модуля и не должен попутно триггерить
// полный прогон детектора с алертами.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[REACTOR-WATCH] Ошибка:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
