import type { APIRoute } from 'astro'
import { parseMessage, FORMAT_HELP, type ParsedConfig } from '@/lib/stats/bot-parser'
import { buildPanelData } from '@/lib/stats/panel-data'
import {
  renderStatsCard,
  renderComparePair,
  type CardInput,
} from '@/lib/stats/telegram-card-render'
import {
  checkRateLimit,
  getCachedCard,
  setCachedCard,
  recordRequest,
  recordError,
  getTodayStats,
} from '@/lib/stats/bot-store'

// Separate bot/token from telegram-webhook.ts on purpose (see memory
// telegram-stats-bot-todo): that one is a private admin bot, allowlisted to
// a single user/chat, that commits straight to main. This one is meant to
// be used in a public/group chat by anyone - different trust perimeter. It
// only ever reads mutants.json + renders an image; it can't write anything.
// STATS_BOT_ALLOWED_CHATS restricts which chats it'll respond in (optional -
// unset means unrestricted, so it doesn't break existing deployments).
// STATS_BOT_ADMIN_CHAT_ID, if set, gets a DM for every failed parse - lets
// the owner see real misses to tune name/orb matching without digging
// through Vercel logs.

function parseAllowedChats(raw: string | undefined): Set<string> | null {
  if (!raw?.trim()) return null
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  replyToMessageId?: number,
) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
      }),
    })
  } catch {
    // best effort - don't crash the handler over a failed reply
  }
}

async function sendTelegramPhoto(
  botToken: string,
  chatId: number | string,
  photo: Buffer,
  replyToMessageId?: number,
  caption?: string,
) {
  const form = new FormData()
  form.set('chat_id', String(chatId))
  if (caption) form.set('caption', caption)
  if (replyToMessageId)
    form.set('reply_parameters', JSON.stringify({ message_id: replyToMessageId }))
  form.set('photo', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'card.png')
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`sendPhoto failed: ${res.status} ${body}`)
  }
}

function cacheKeyFor(config: ParsedConfig): string {
  return [
    config.mutant.id,
    config.level,
    config.starIndex,
    config.basicOrbIds.join(','),
    config.specialOrbId ?? '',
    config.atkMultipliers[1],
    config.atkMultipliers[2],
  ].join('|')
}

function toCardInput(config: ParsedConfig): CardInput {
  const atkMultipliers = {
    1: 1 + config.atkMultipliers[1] / 100,
    2: 1 + config.atkMultipliers[2] / 100,
  }
  const panel = buildPanelData(config.mutant, {
    level: config.level,
    starIndex: config.starIndex,
    basicOrbIds: config.basicOrbIds,
    specialOrbId: config.specialOrbId,
    atkMultipliers,
  })
  return { panel, level: config.level, starIndex: config.starIndex, atkMultipliers }
}

export const POST: APIRoute = async ({ request }) => {
  const BOT_TOKEN = import.meta.env.STATS_BOT_TOKEN
  const WEBHOOK_SECRET = import.meta.env.STATS_BOT_WEBHOOK_SECRET
  const ADMIN_CHAT_ID = import.meta.env.STATS_BOT_ADMIN_CHAT_ID as string | undefined
  const allowedChats = parseAllowedChats(import.meta.env.STATS_BOT_ALLOWED_CHATS)

  // Same fail-closed pattern as telegram-webhook.ts: an unconfigured secret
  // disables the endpoint outright rather than silently skipping the check.
  if (!WEBHOOK_SECRET || !BOT_TOKEN) {
    console.error('STATS_BOT_TOKEN/STATS_BOT_WEBHOOK_SECRET is not configured — webhook disabled')
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (secretToken !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let chatId: number | string | null = null
  let messageId: number | undefined

  try {
    const body = JSON.parse(await request.text())
    chatId = body.message?.chat?.id ?? null
    const text: string = body.message?.text ?? ''
    messageId = body.message?.message_id

    // Cheap, always-on: lets chat_id be recovered from Vercel runtime logs
    // instead of needing a Telegram-side lookup tool.
    if (chatId != null) {
      console.log(
        `stats-bot: chat ${chatId} (${body.message?.chat?.type ?? '?'}) msg: ${JSON.stringify(text)}`,
      )
    }

    if (chatId == null || !text) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Unlisted chat -> ignore entirely, same as an unaddressed message.
    // No allowlist configured means unrestricted (opt-in feature). The
    // admin's own DM always gets through regardless - it's a management
    // channel, not a public chat the allowlist is meant to gate.
    const isAdminChat = Boolean(ADMIN_CHAT_ID) && String(chatId) === ADMIN_CHAT_ID
    if (allowedChats && !allowedChats.has(String(chatId)) && !isAdminChat) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (text === '/start' || text === '/help' || text === '/format') {
      await sendTelegramMessage(BOT_TOKEN, chatId, FORMAT_HELP, messageId)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Admin-only, DM-only - matches how the owner said they'd manage this
    // bot (private chat, not group commands).
    if (text === '/stats' && isAdminChat) {
      const stats = await getTodayStats()
      const reply = stats
        ? `Сегодня: ${stats.total} запросов, ${stats.errors} не разобрано.\n\nТоп мутантов:\n${
            stats.topMutants.map(([name, count]) => `${name}: ${count}`).join('\n') || '—'
          }`
        : 'Статистика недоступна (Redis не настроен или недоступен).'
      await sendTelegramMessage(BOT_TOKEN, chatId, reply, messageId)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Same "." trigger convention as .тир/.сфера/.анонс/.локал in
    // telegram-webhook.ts - without it, a group chat with Privacy Mode
    // disabled would try to parse every single message as a stat-card
    // request. Anything not starting with "." is silently ignored (not
    // even a "не понял" reply) - it's not addressed to the bot.
    if (!text.startsWith('.')) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = parseMessage(text.slice(1))
    if (!result.ok) {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `Не понял: ${result.error}\n\nСм. /format`,
        messageId,
      )
      if (ADMIN_CHAT_ID) {
        await sendTelegramMessage(
          BOT_TOKEN,
          ADMIN_CHAT_ID,
          `Не разобрал запрос (чат ${chatId}):\n"${text}"\n\n${result.error}`,
        )
      }
      await recordError()
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Cache is keyed on the resolved config, not the raw text - "робот
    // 20ур" and "робот 20 ур" hit the same entry. A hit skips the rate
    // limiter entirely (serving a cached PNG costs ~nothing, so repeating
    // an identical query is never penalized).
    const cacheKey = [
      cacheKeyFor(result.primary),
      result.secondary ? cacheKeyFor(result.secondary) : '',
    ].join('#vs#')
    let photo = await getCachedCard(cacheKey)

    if (!photo) {
      const userId = body.message?.from?.id ?? chatId
      const allowed = await checkRateLimit(userId)
      if (!allowed) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          'Слишком часто - подожди немного и повтори.',
          messageId,
        )
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const primary = toCardInput(result.primary)
      photo = result.secondary
        ? await renderComparePair(primary, toCardInput(result.secondary))
        : await renderStatsCard(primary)
      await setCachedCard(cacheKey, photo)
    }

    await sendTelegramPhoto(BOT_TOKEN, chatId, photo, messageId)
    await recordRequest(result.primary.mutantName)
    if (result.secondary) await recordRequest(result.secondary.mutantName)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Stats bot webhook error:', error)
    if (chatId != null) {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        'Что-то сломалось при рендере карточки, попробуй ещё раз.',
        messageId,
      )
    }
    // 200, not 500 - avoids a Telegram retry storm on a transient failure.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
