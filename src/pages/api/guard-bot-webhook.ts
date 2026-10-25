import type { APIRoute } from 'astro'
import { handleGuardUpdate } from '@/lib/guard/handler'
import { checkLols } from '@/lib/guard/lols'
import { parseGuardConfig } from '@/lib/guard/policy'
import { createBotApi } from '@/lib/guard/telegram-api'

// Охрана чата: отдельный бот и отдельный токен от стат-бота (этот умеет
// ограничивать и банить, у стат-бота периметр только на чтение). Что делает:
// на вход нового участника проверяет его по базе спамеров LOLS и ограничивает
// новичка "только текст" на срок (Telegram снимает ограничение сам). Оба действия
// включаются отдельно (GUARD_RESTRICT, GUARD_BAN), по умолчанию бот только пишет
// журнал в GUARD_BOT_LOG_CHAT_ID (один id или несколько через запятую; в личку бот пишет
// только тому, кто сам нажал у него Start). Webhook нужно ставить с
// allowed_updates=["message","chat_member"] (chat_member требует админа в чате).
// GUARD_BOT_ALLOWED_CHATS обязателен: без списка бот игнорирует все чаты.
// GUARD_BOT_ENFORCE_CHATS (необязателен): где рубильники реально действуют; в остальных
// разрешённых чатах только журнал.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const csv = (raw: string | undefined) =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

export const POST: APIRoute = async ({ request }) => {
  const token = import.meta.env.GUARD_BOT_TOKEN as string | undefined
  const secret = import.meta.env.GUARD_BOT_WEBHOOK_SECRET as string | undefined
  if (!token || !secret) {
    console.error('GUARD_BOT_TOKEN/GUARD_BOT_WEBHOOK_SECRET is not configured - webhook disabled')
    return json(503, { error: 'Webhook not configured' })
  }
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return json(403, { error: 'Forbidden' })
  }

  try {
    const update = JSON.parse(await request.text())
    await handleGuardUpdate(update, {
      api: createBotApi(token),
      lols: (id) => checkLols(id),
      cfg: parseGuardConfig({
        GUARD_RESTRICT: import.meta.env.GUARD_RESTRICT,
        GUARD_BAN: import.meta.env.GUARD_BAN,
        GUARD_PROBATION_HOURS: import.meta.env.GUARD_PROBATION_HOURS,
      }),
      allowedChats: csv(import.meta.env.GUARD_BOT_ALLOWED_CHATS),
      enforceChats: import.meta.env.GUARD_BOT_ENFORCE_CHATS
        ? csv(import.meta.env.GUARD_BOT_ENFORCE_CHATS)
        : null,
      logChatIds: [...csv(import.meta.env.GUARD_BOT_LOG_CHAT_ID)],
      nowSec: () => Math.floor(Date.now() / 1000),
    })
  } catch (err) {
    // Всегда 200: иначе Telegram будет повторять тот же апдейт часами.
    console.error('guard-bot webhook error:', err instanceof Error ? err.message : err)
  }
  return json(200, { ok: true })
}
