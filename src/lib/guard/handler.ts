import type { BotApi, ChatId } from './telegram-api'
import {
  planJoin,
  probationPermissions,
  probationUntil,
  type GuardConfig,
  type JoinPlan,
  type LolsVerdict,
} from './policy'

export interface GuardDeps {
  api: BotApi
  lols: (userId: number) => Promise<LolsVerdict>
  cfg: GuardConfig
  // Чаты, где бот вообще работает. Пусто/нет = не делает ничего (fail-closed).
  allowedChats: Set<string>
  // Чаты, где рубильники restrict/ban действуют. null = во всех разрешённых; иначе в
  // остальных разрешённых чатах бот только пишет журнал (боевой чат в логе, тест на
  // отдельной группе).
  enforceChats: Set<string> | null
  // Куда писать журнал решений (чат, группа или личка админа - писать можно нескольким).
  // Без получателей бот молча работает по правилам.
  logChatIds: ChatId[]
  nowSec: () => number
}

export type GuardResult = 'join' | 'command' | 'ignored'

interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
}

// Только те поля апдейта, что бот реально читает.
interface TgMember {
  status: string
  is_member?: boolean
  user: TgUser
}
interface TgChat {
  id: number
  title?: string
}
interface TgChatMemberUpdate {
  chat: TgChat
  old_chat_member?: TgMember
  new_chat_member?: TgMember
}
interface TgMessage {
  chat: TgChat
  from?: TgUser
  text?: string
  reply_to_message?: { from?: TgUser }
}
export interface TgUpdate {
  chat_member?: TgChatMemberUpdate
  message?: TgMessage
}

const userLabel = (u: TgUser) => {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'без имени'
  return `${name} (${u.username ? '@' + u.username : 'без username'}, id ${u.id})`
}

const LOLS_RU: Record<LolsVerdict, string> = {
  banned: 'в базе спамеров',
  clean: 'чист',
  unknown: 'нет ответа',
}
const INTENT_RU = { skip: 'пропуск', restrict: 'только текст на срок', ban: 'бан' } as const
const EFFECT_RU = { none: 'ничего (режим лога)', restrict: 'ограничение', ban: 'бан' } as const

// Вход нового участника: был вне чата (вышел/кикнут/заявка не одобрена), стал внутри.
// Наше же ограничение/бан тоже даёт chat_member-апдейт, но это не вход, а переход
// member -> restricted/kicked, поэтому петли нет.
function isJoin(update: TgChatMemberUpdate): boolean {
  const o = update.old_chat_member
  const n = update.new_chat_member
  if (!o || !n) return false
  const wasOut =
    o.status === 'left' ||
    o.status === 'kicked' ||
    (o.status === 'restricted' && o.is_member === false)
  const nowIn = n.status === 'member' || (n.status === 'restricted' && n.is_member === true)
  return wasOut && nowIn
}

async function log(deps: GuardDeps, text: string) {
  console.log(`guard-bot: ${text.replace(/\n/g, ' | ')}`)
  // Каждому получателю отдельно: недоступный (не нажал Start, заблокировал бота) не
  // должен лишать журнала остальных.
  await Promise.all(
    deps.logChatIds.map((id) =>
      deps.api.sendText(id, text).catch((err) => {
        console.error(
          `guard-bot: журнал в ${id} не отправлен:`,
          err instanceof Error ? err.message : err,
        )
      }),
    ),
  )
}

async function onJoin(update: TgChatMemberUpdate, deps: GuardDeps): Promise<void> {
  const chat = update.chat
  const user: TgUser = update.new_chat_member!.user
  const lols = user.is_bot ? 'unknown' : await deps.lols(user.id)
  const enforced = deps.enforceChats === null || deps.enforceChats.has(String(chat.id))
  const cfg = enforced ? deps.cfg : { ...deps.cfg, restrict: false, ban: false }
  const plan: JoinPlan = planJoin({ isBot: Boolean(user.is_bot), lols }, cfg)

  let error = ''
  try {
    if (plan.effective === 'restrict') {
      await deps.api.restrictMember(
        chat.id,
        user.id,
        probationPermissions(),
        probationUntil(deps.nowSec(), deps.cfg.probationHours),
      )
    } else if (plan.effective === 'ban') {
      await deps.api.banMember(chat.id, user.id)
    }
  } catch (err) {
    error = `\n⚠️ Ошибка применения: ${err instanceof Error ? err.message : String(err)}`
  }

  if (plan.intent === 'skip') return // боты и прочее - не шумим в журнале
  const fallback =
    plan.intent === 'ban' && plan.effective === 'restrict'
      ? ' (бан выключен, вместо него ограничение)'
      : ''
  const hours =
    plan.intent === 'restrict' || plan.effective === 'restrict'
      ? ` ${deps.cfg.probationHours} ч`
      : ''
  await log(
    deps,
    `👤 Вход в «${chat.title ?? chat.id}»: ${userLabel(user)}\n` +
      `LOLS: ${LOLS_RU[lols]}. Причина: ${plan.reason}\n` +
      `Политика: ${INTENT_RU[plan.intent]}${hours}. Применено: ${EFFECT_RU[plan.effective]}${fallback}${error}`,
  )
}

// ".довер" (ответом на сообщение или с id) - досрочно снять ограничение новичка.
// ".разбан" - снять бан (если база ошиблась). Только для админов чата.
const COMMAND = /^\.(довер|разбан)(?:\s+(\d{5,}))?\s*$/i

async function onCommand(msg: TgMessage, deps: GuardDeps): Promise<boolean> {
  const m = COMMAND.exec(String(msg.text ?? '').trim())
  if (!m || !msg.from) return false
  const chatId = msg.chat.id
  const status = await deps.api.getMemberStatus(chatId, msg.from.id).catch(() => '')
  if (status !== 'creator' && status !== 'administrator') return true // молча: не админ

  const cmd = m[1].toLowerCase()
  const targetId = m[2] ? Number(m[2]) : msg.reply_to_message?.from?.id
  if (!targetId) {
    await log(deps, `⚠️ .${cmd}: нужен ответ на сообщение человека или его id`)
    return true
  }
  try {
    if (cmd === 'довер') {
      // Вернуть права чата по умолчанию как личные права участника.
      const defaults = await deps.api.getChatPermissions(chatId)
      await deps.api.restrictMember(chatId, targetId, defaults)
      await log(deps, `✅ .довер: ограничение снято с id ${targetId} (${userLabel(msg.from)})`)
    } else {
      await deps.api.unbanMember(chatId, targetId)
      await log(deps, `✅ .разбан: id ${targetId} разбанен (${userLabel(msg.from)})`)
    }
  } catch (err) {
    await log(
      deps,
      `⚠️ .${cmd} id ${targetId}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return true
}

export async function handleGuardUpdate(update: TgUpdate, deps: GuardDeps): Promise<GuardResult> {
  const cm = update.chat_member
  if (cm && deps.allowedChats.has(String(cm.chat?.id)) && isJoin(cm)) {
    await onJoin(cm, deps)
    return 'join'
  }
  const msg = update.message
  if (msg && deps.allowedChats.has(String(msg.chat?.id)) && typeof msg.text === 'string') {
    if (await onCommand(msg, deps)) return 'command'
  }
  return 'ignored'
}
