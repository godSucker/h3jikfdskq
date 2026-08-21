import type { APIRoute } from 'astro'
import { parseMessage, FORMAT_HELP, type ParsedConfig } from '@/lib/stats/bot-parser'
import { buildPanelData } from '@/lib/stats/panel-data'
import {
  renderStatsCard,
  renderComparePair,
  type CardInput,
} from '@/lib/stats/telegram-card-render'

// Separate bot/token from telegram-webhook.ts on purpose (see memory
// telegram-stats-bot-todo): that one is a private admin bot, allowlisted to
// a single user/chat, that commits straight to main. This one is meant to
// be used in a public/group chat by anyone - different trust perimeter, so
// it gets its own token and, deliberately, NO user/chat allowlist. It also
// only ever reads mutants.json + renders an image; it can't write anything.

async function sendTelegramMessage(botToken: string, chatId: number | string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch {
    // best effort - don't crash the handler over a failed reply
  }
}

async function sendTelegramPhoto(
  botToken: string,
  chatId: number | string,
  photo: Buffer,
  caption?: string,
) {
  const form = new FormData()
  form.set('chat_id', String(chatId))
  if (caption) form.set('caption', caption)
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

  try {
    const body = JSON.parse(await request.text())
    chatId = body.message?.chat?.id ?? null
    const text: string = body.message?.text ?? ''

    if (chatId == null || !text) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (text === '/start' || text === '/help' || text === '/format') {
      await sendTelegramMessage(BOT_TOKEN, chatId, FORMAT_HELP)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = parseMessage(text)
    if (!result.ok) {
      await sendTelegramMessage(BOT_TOKEN, chatId, `Не понял: ${result.error}\n\nСм. /format`)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const primary = toCardInput(result.primary)
    const photo = result.secondary
      ? await renderComparePair(primary, toCardInput(result.secondary))
      : await renderStatsCard(primary)

    await sendTelegramPhoto(BOT_TOKEN, chatId, photo)
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
      )
    }
    // 200, not 500 - avoids a Telegram retry storm on a transient failure.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
