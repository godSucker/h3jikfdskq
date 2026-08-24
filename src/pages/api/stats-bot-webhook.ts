import type { APIRoute } from 'astro'
import {
  parseMessage,
  parseCompareMessage,
  resolveMutantByExactName,
  FORMAT_HELP,
  ADMIN_FORMAT_HELP,
  type ParsedConfig,
} from '@/lib/stats/bot-parser'
import { buildPanelData } from '@/lib/stats/panel-data'
import {
  renderStatsCard,
  renderComparePair,
  renderCompareMulti,
  type CardInput,
} from '@/lib/stats/telegram-card-render'
import {
  checkRateLimit,
  type RateLimitResult,
  getCachedCard,
  setCachedCard,
  recordRequest,
  recordError,
  getTodayStats,
  getAliasOverlay,
  addAliasOverlay,
  setRateLimitOverride,
  clearRateLimitOverride,
  setBan,
  clearBan,
  isBanned,
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

// Same shape as STATS_BOT_ALLOWED_CHATS, but for Telegram *user* ids, not
// chat ids - ".добавить"/".лимит" are typed inside a group, so gating on
// chat.id (like isAdminChat below, meant for the owner's private DM) would
// either lock every admin out of the group or let every group member
// through. An explicit id list (the owner pastes ids in, not
// getChatAdministrators) matches how ADMIN_CHAT_ID is already managed.
function parseAdminUserIds(raw: string | undefined): Set<string> | null {
  if (!raw?.trim()) return null
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

function rateLimitMessage(rl: RateLimitResult): string {
  if (rl.reason === 'override' && rl.override) {
    return `На тебя наложены ограничения: не больше ${rl.override.max} запрос(ов) за ${rl.override.window}с. Попробуй через ~${rl.retryAfterSeconds}с.`
  }
  return `Слишком часто - подожди ~${rl.retryAfterSeconds ?? 10}с и повтори.`
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
  // STATS_BOT_ADMIN_CHAT_ID stays a single value for the failed-parse DM
  // target below (picking one place to send those is enough), but can now
  // hold a comma-separated list too - same parser as STATS_BOT_ALLOWED_CHATS
  // - so a second private chat (e.g. the owner's wife) gets the same
  // admin-DM privileges (isAdminChat below, /admin, /stats) without being
  // added to STATS_BOT_ADMIN_USER_IDS (which additionally grants
  // .добавить/.лимит/.бан execution rights in group chats).
  const ADMIN_CHAT_ID_RAW = import.meta.env.STATS_BOT_ADMIN_CHAT_ID as string | undefined
  const adminChatIds = parseAllowedChats(ADMIN_CHAT_ID_RAW)
  const ADMIN_CHAT_ID = ADMIN_CHAT_ID_RAW?.split(',')[0]?.trim() || undefined
  const allowedChats = parseAllowedChats(import.meta.env.STATS_BOT_ALLOWED_CHATS)
  const adminUserIds = parseAdminUserIds(import.meta.env.STATS_BOT_ADMIN_USER_IDS)

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

    const isAdminChat = Boolean(adminChatIds) && adminChatIds!.has(String(chatId))
    const fromUserId = body.message?.from?.id as number | undefined
    const isAdminUser =
      Boolean(adminUserIds) && fromUserId != null && adminUserIds!.has(String(fromUserId))

    // Unlisted chat -> ignore entirely, same as an unaddressed message.
    // No allowlist configured means unrestricted (opt-in feature). Both an
    // admin chat AND an admin user always get through regardless - an
    // admin in STATS_BOT_ADMIN_USER_IDS but not STATS_BOT_ADMIN_CHAT_ID
    // still needs their own DM to reach /admin, otherwise it's silently
    // dropped right here before that check ever runs (this was a real bug -
    // caught live when an admin's /admin got no reply).
    if (allowedChats && !allowedChats.has(String(chatId)) && !isAdminChat && !isAdminUser) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Full ban (see .бан below) - checked before anything else a user could
    // type, including /format. Doesn't apply to admins (an admin banning
    // themselves would be a self-lockout with no way back short of editing
    // Redis directly).
    if (!isAdminChat && !isAdminUser && fromUserId != null && (await isBanned(fromUserId))) {
      await sendTelegramMessage(BOT_TOKEN, chatId, 'Ты забанен в этом боте.', messageId)
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

    // /admin - private-chat only, allowlisted senders only (admin chat(s) or
    // STATS_BOT_ADMIN_USER_IDS) - sends the ".добавить"/".лимит"/".бан" etc.
    // syntax reference. Silent (not even "Отказано") for anyone else, same
    // as how /stats already behaves for a non-admin chat - it's a
    // discoverability command for people who already know it exists, not
    // meant to advertise itself.
    if (
      text === '/admin' &&
      (isAdminChat || isAdminUser) &&
      body.message?.chat?.type === 'private'
    ) {
      await sendTelegramMessage(BOT_TOKEN, chatId, ADMIN_FORMAT_HELP, messageId)
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

    // ".добавить "Ориг Имя" - "сокращение"" (or "specimen_xx_00" instead of
    // the name, needed for the 2 duplicate-name pairs in the data - see
    // resolveMutantByExactName) - admin-only, writes into the Redis alias
    // overlay (see getAliasOverlay/addAliasOverlay in bot-store.ts).
    // Deliberately NOT auto-generating candidate nicknames itself - this
    // only persists what the admin typed, one at a time
    // (see [[feedback-no-llm-authored-names]]).
    const addAliasMatch = text
      .slice(1)
      .match(/^добавить\s*[«"']([^»"']+)[»"']\s*-\s*[«"']([^»"']+)[»"']\s*$/i)
    if (addAliasMatch) {
      // Same 8/60s cap as everything else in this handler - without it, a
      // non-admin spamming ".добавить" would get an instant "Отказано." for
      // free every time, no cost gate at all.
      if (!(await checkRateLimit(fromUserId ?? chatId)).allowed) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (!isAdminUser) {
        await sendTelegramMessage(BOT_TOKEN, chatId, 'Отказано.', messageId)
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const [, origInput, aliasInput] = addAliasMatch
      const resolved = resolveMutantByExactName(origInput.trim())
      if (resolved.kind === 'none') {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `Не нашёл мутанта "${origInput.trim()}" - имя должно быть точным (с учётом регистра) или укажи id.`,
          messageId,
        )
      } else if (resolved.kind === 'ambiguous') {
        const list = resolved.candidates.map((c) => `${c.name} (id: ${c.id})`).join(', ')
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `Несколько мутантов с именем "${origInput.trim()}" - укажи id вместо имени: ${list}`,
          messageId,
        )
      } else {
        const alias = aliasInput.trim()
        const saved = await addAliasOverlay(alias, resolved.mutant.id)
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          saved
            ? `Добавил: "${alias}" -> ${resolved.mutant.name} (${resolved.mutant.id})`
            : 'Не получилось сохранить (Redis недоступен) - попробуй позже.',
          messageId,
        )
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ".лимит N/M [T]" в ответ на сообщение юзера - ставит персональный
    // рейт-лимит (N запросов за M секунд), активный T минут (по умолчанию
    // 1440 = сутки). Приоритетнее дефолтного 8/60с - см. checkRateLimit в
    // bot-store.ts. ".снять_лимит" в ответ на сообщение - снимает раньше
    // срока.
    const limitMatch = text
      .slice(1)
      .match(/^лимит\s+(\d{1,3})\s*\/\s*(\d{1,4})(?:\s+(\d{1,5}))?\s*$/i)
    const clearLimitMatch = text.slice(1).match(/^снять_лимит\s*$/i)
    if (limitMatch || clearLimitMatch) {
      if (!(await checkRateLimit(fromUserId ?? chatId)).allowed) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (!isAdminUser) {
        await sendTelegramMessage(BOT_TOKEN, chatId, 'Отказано.', messageId)
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const targetId = body.message?.reply_to_message?.from?.id as number | undefined
      if (targetId == null) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          'Ответь этой командой на сообщение того, кому ставишь/снимаешь лимит.',
          messageId,
        )
      } else if (limitMatch) {
        const max = Number(limitMatch[1])
        const windowSec = Number(limitMatch[2])
        const durationMin = limitMatch[3] ? Number(limitMatch[3]) : 1440
        const saved = await setRateLimitOverride(targetId, max, windowSec, durationMin * 60)
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          saved
            ? `Лимит для ${targetId}: ${max} запрос(ов) / ${windowSec}с, активен ${durationMin} мин.`
            : 'Не получилось сохранить (Redis недоступен) - попробуй позже.',
          messageId,
        )
      } else {
        const cleared = await clearRateLimitOverride(targetId)
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          cleared ? `Лимит для ${targetId} снят.` : 'Не получилось (Redis недоступен).',
          messageId,
        )
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ".бан"/".разбан" в ответ на сообщение юзера - полная блокировка
    // (isBanned check выше, до /format) в отличие от ".лимит" выше, который
    // просто throttles. Постоянно, без TTL - см. setBan/clearBan.
    const banMatch = text.slice(1).match(/^бан\s*$/i)
    const unbanMatch = text.slice(1).match(/^разбан\s*$/i)
    if (banMatch || unbanMatch) {
      if (!(await checkRateLimit(fromUserId ?? chatId)).allowed) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (!isAdminUser) {
        await sendTelegramMessage(BOT_TOKEN, chatId, 'Отказано.', messageId)
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const targetId = body.message?.reply_to_message?.from?.id as number | undefined
      if (targetId == null) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          'Ответь этой командой на сообщение того, кого баните/разбаните.',
          messageId,
        )
      } else if (banMatch) {
        const saved = await setBan(targetId)
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          saved ? `Юзер ${targetId} забанен.` : 'Не получилось (Redis недоступен).',
          messageId,
        )
      } else {
        const cleared = await clearBan(targetId)
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          cleared ? `Юзер ${targetId} разбанен.` : 'Не получилось (Redis недоступен).',
          messageId,
        )
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Live-added aliases (see getAliasOverlay) - a normal message never pays
    // a fresh Redis round-trip for this, only the first one after the
    // in-module cache goes stale (see ALIAS_OVERLAY_TTL_MS).
    const aliasOverlay = await getAliasOverlay()

    // ".сравнение <a> vs <b> vs ... vs <e>" - up to 5-way, same "vs"/"против"
    // separator as the regular 2-way card but routed to its own parser (see
    // parseCompareMessage) and a wider render, so a plain ".vs" message
    // never accidentally has to handle more than 2 segments.
    const compareCommandMatch = text.slice(1).match(/^сравнение(?![a-zа-яё0-9])\s*/i)
    if (compareCommandMatch) {
      const rest = text.slice(1 + compareCommandMatch[0].length)
      const compareResult = parseCompareMessage(rest, aliasOverlay)
      if (!compareResult.ok) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `Не понял: ${compareResult.error}\n\nСм. /format`,
          messageId,
        )
        if (ADMIN_CHAT_ID) {
          await sendTelegramMessage(
            BOT_TOKEN,
            ADMIN_CHAT_ID,
            `Не разобрал запрос .сравнение (чат ${chatId}):\n"${text}"\n\n${compareResult.error}`,
          )
        }
        await recordError()
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const cacheKey = compareResult.configs.map(cacheKeyFor).join('#multi#')
      let photo = await getCachedCard(cacheKey)

      if (!photo) {
        const userId = body.message?.from?.id ?? chatId
        const rl = await checkRateLimit(userId)
        if (!rl.allowed) {
          await sendTelegramMessage(BOT_TOKEN, chatId, rateLimitMessage(rl), messageId)
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        photo = await renderCompareMulti(compareResult.configs.map(toCardInput))
        await setCachedCard(cacheKey, photo)
      }

      await sendTelegramPhoto(BOT_TOKEN, chatId, photo, messageId)
      for (const config of compareResult.configs) await recordRequest(config.mutantName)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = parseMessage(text.slice(1), aliasOverlay)
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
      const rl = await checkRateLimit(userId)
      if (!rl.allowed) {
        await sendTelegramMessage(BOT_TOKEN, chatId, rateLimitMessage(rl), messageId)
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
