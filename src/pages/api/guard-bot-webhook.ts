import type { APIRoute } from 'astro'
import { handleGuardUpdate } from '@/lib/guard/handler'
import { createSpamChecker } from '@/lib/guard/spam-db'
import { createRedisStore } from '@/lib/guard/store'
import { Redis } from '@upstash/redis'
import { parseGuardConfig } from '@/lib/guard/policy'
import { createBotApi } from '@/lib/guard/telegram-api'

// Охрана чата: отдельный бот и отдельный токен от стат-бота (этот умеет
// банить, у стат-бота периметр только на чтение). Что делает: на вход нового
// участника проверяет его по базе спамеров LOLS и пишет вердикт в журнал; бан по
// базе включается отдельно (GUARD_BAN), по умолчанию бот только пишет журнал в
// GUARD_BOT_LOG_CHAT_ID (один id или несколько через запятую; в личку бот пишет
// только тому, кто сам нажал у него Start). Webhook нужно ставить с
// allowed_updates=["message","chat_member"] (chat_member требует админа в чате).
// Перепроверка: вошедших за неделю запоминает в Redis и спрашивает базу ещё раз на
// их первом сообщении и попутно по расписанию (база узнаёт о спамерах с задержкой).
// SPAMWATCH_TOKEN (необязателен) подключает вторую базу.
// GUARD_BOT_ALLOWED_CHATS обязателен: без списка бот игнорирует все чаты.
// GUARD_BOT_ENFORCE_CHATS (необязателен): где бан реально действует; в остальных
// разрешённых чатах только журнал.

// Один на процесс: перепроверка не чаще раза в 5 минут на экземпляр функции.
const sweepGate = { last: 0 }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const csv = (raw: unknown) =>
  new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

// Память о недавних входах живёт в Upstash (те же KV_REST_API_*, что у стат-бота).
// Нет переменных - перепроверка выключена, остаётся проверка на входе.
function redisStore() {
  const url = import.meta.env.KV_REST_API_URL as string | undefined
  const token = import.meta.env.KV_REST_API_TOKEN as string | undefined
  return url && token ? createRedisStore(new Redis({ url, token })) : null
}

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
      spamDb: createSpamChecker({
        spamwatchToken: (import.meta.env.SPAMWATCH_TOKEN as string | undefined) || undefined,
      }),
      store: redisStore(),
      sweepGate,
      cfg: parseGuardConfig({
        GUARD_BAN: import.meta.env.GUARD_BAN,
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
