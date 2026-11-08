import type { BotApi, ChatId } from './telegram-api'
import { planJoin, type GuardConfig, type JoinPlan, type LolsVerdict } from './policy'
import type { SpamCheck } from './spam-db'
import type { GuardStore } from './store'

// Не чаще раза в 5 минут (на экземпляр функции) перепроверяем тех, кому пора, и не
// больше стольких за раз: бот работает по вебхуку, своего таймера у него нет, поэтому
// перепроверка идёт попутно, пока в чате есть движение.
const SWEEP_EVERY_SEC = 300
const SWEEP_BATCH = 10
// Вместе с баном стираем все сообщения человека только если он вошёл не позже суток
// назад: так выглядят свежие бот-аккаунты, а у давнего участника история остаётся
// админам (стирание необратимо, а база может ошибиться).
const REVOKE_WITHIN_SEC = 86400

export interface GuardDeps {
  api: BotApi
  spamDb: (userId: number) => Promise<SpamCheck>
  cfg: GuardConfig
  // Чаты, где бот вообще работает. Пусто/нет = не делает ничего (fail-closed).
  allowedChats: Set<string>
  // Чаты, где рубильник ban действует. null = во всех разрешённых; иначе в
  // остальных разрешённых чатах бот только пишет журнал (боевой чат в логе, тест на
  // отдельной группе).
  enforceChats: Set<string> | null
  // Куда писать журнал решений (чат, группа или личка админа - писать можно нескольким).
  // Без получателей бот молча работает по правилам.
  logChatIds: ChatId[]
  nowSec: () => number
  // Память о недавних входах (перепроверка). Нет = только проверка на входе.
  store?: GuardStore | null
  // Общий на процесс счётчик "когда последний раз перепроверяли".
  sweepGate?: { last: number }
}

export type GuardResult = 'join' | 'command' | 'recheck' | 'ignored'

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

// Короткая подпись для объявления в чат: имя и username без id; чужой текст, поэтому
// без переводов строк и с ограничением длины.
const publicLabel = (u: TgUser) => {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const short = name.length > 40 ? `${name.slice(0, 40)}…` : name
  const who = short || 'Без имени'
  return u.username ? `${who} (@${u.username})` : who
}

const LOLS_RU: Record<LolsVerdict, string> = {
  banned: 'в базе спамеров',
  clean: 'чист',
  unknown: 'нет ответа',
}

// Вход нового участника: был вне чата (вышел/кикнут/заявка не одобрена), стал внутри.
// Наш же бан тоже даёт chat_member-апдейт, но это не вход, а переход member -> kicked,
// поэтому петли нет.
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

// Любой сбой хранилища не должен ронять бота: перепроверка просто пропускается.
async function safe<T>(fn: () => Promise<T> | undefined, fallback: T): Promise<T> {
  try {
    return (await fn()) ?? fallback
  } catch (err) {
    console.error('guard-bot: хранилище недоступно:', err instanceof Error ? err.message : err)
    return fallback
  }
}

const isEnforced = (deps: GuardDeps, chatId: number | string) =>
  deps.enforceChats === null || deps.enforceChats.has(String(chatId))

function agoRu(sec: number): string {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} мин`
  if (sec < 86400) return `${Math.round(sec / 3600)} ч`
  return `${Math.round(sec / 86400)} сут.`
}

async function onJoin(update: TgChatMemberUpdate, deps: GuardDeps): Promise<void> {
  const chat = update.chat
  const user: TgUser = update.new_chat_member!.user
  const check: SpamCheck = user.is_bot
    ? { verdict: 'unknown', source: 'LOLS' }
    : await deps.spamDb(user.id)
  // Админ уже говорил ".разбан" про этого человека: база не повод банить снова.
  const exempt =
    check.verdict === 'banned' && (await safe(() => deps.store?.isExempt(user.id), false))
  const lols: LolsVerdict = exempt ? 'clean' : check.verdict
  const cfg = isEnforced(deps, chat.id) ? deps.cfg : { ...deps.cfg, ban: false }
  const plan: JoinPlan = planJoin({ isBot: Boolean(user.is_bot), lols }, cfg)

  let error = ''
  try {
    if (plan.effective === 'ban') await deps.api.banMember(chat.id, user.id)
  } catch (err) {
    error = `\n⚠️ Ошибка применения: ${err instanceof Error ? err.message : String(err)}`
  }

  if (plan.intent === 'skip') return // боты и прочее - не шумим в журнале
  // Не забаненных запоминаем: база может узнать о них позже, тогда сработает перепроверка.
  if (plan.intent === 'pass') {
    await safe(() => deps.store?.recordJoin(String(chat.id), user.id, deps.nowSec()), undefined)
  }
  // Одна строка вердикта: что нашла база и что сделано. Чистые входы тоже пишем -
  // по журналу видно, сколько народу пришло и кого база пропустила.
  const verdict =
    plan.intent === 'ban'
      ? plan.effective === 'ban'
        ? 'забанен навсегда'
        : 'был бы забанен, но бан выключен (ничего не сделано)'
      : exempt
        ? 'в базе, но исключён командой .разбан'
        : plan.reason
  // Бан применён - сообщаем в сам чат, чтобы участники и админы видели, что произошло.
  if (plan.effective === 'ban' && !error) {
    await deps.api
      .sendText(chat.id, `🚫 ${publicLabel(user)} забанен навсегда: найден в базе спамеров.`)
      .catch((err) => {
        error = `\n⚠️ Объявление в чат не отправлено: ${err instanceof Error ? err.message : String(err)}`
      })
  }
  await log(
    deps,
    `${plan.intent === 'ban' ? '🚫' : '👤'} Вход в «${chat.title ?? chat.id}»: ${userLabel(user)}\n` +
      `${check.source}: ${LOLS_RU[check.verdict]} - ${verdict}${error}`,
  )
}

// База узнала о человеке уже после входа (проверка на первом сообщении или по расписанию).
async function onFlagged(
  chat: TgChat,
  userId: number,
  via: string,
  joinedAt: number,
  check: SpamCheck,
  deps: GuardDeps,
): Promise<void> {
  const store = deps.store
  if (!store) return
  const chatKey = String(chat.id)
  if (await safe(() => store.isExempt(userId), false)) {
    await safe(() => store.forget(chatKey, userId), false)
    return
  }
  // Ушёл сам, уже забанен или админ: действовать не над кем.
  const member = await deps.api.getMember(chat.id, userId).catch(() => null)
  const inChat =
    member && (member.status === 'member' || (member.status === 'restricted' && member.is_member))
  if (!member || !inChat) {
    await safe(() => store.forget(chatKey, userId), false)
    return
  }
  // Кто успел удалить запись, тот и действует: два параллельных вызова не забанят дважды.
  if (!(await safe(() => store.forget(chatKey, userId), false))) return

  const user = member.user
  const enforced = isEnforced(deps, chat.id) && deps.cfg.ban
  let error = ''
  if (enforced) {
    try {
      await deps.api.banMember(chat.id, userId, {
        revokeMessages: deps.nowSec() - joinedAt < REVOKE_WITHIN_SEC,
      })
    } catch (err) {
      error = `\n⚠️ Ошибка применения: ${err instanceof Error ? err.message : String(err)}`
    }
    if (!error) {
      await deps.api
        .sendText(chat.id, `🚫 ${publicLabel(user)} забанен навсегда: найден в базе спамеров.`)
        .catch((err) => {
          error = `\n⚠️ Объявление в чат не отправлено: ${err instanceof Error ? err.message : String(err)}`
        })
    }
  }
  const verdict = enforced ? 'забанен навсегда' : 'был бы забанен, но бан выключен'
  await log(
    deps,
    `🚫 Перепроверка в «${chat.title ?? chat.id}» (${via}): ${userLabel(user)}\n` +
      `${check.source}: в базе спамеров. Вошёл ${agoRu(deps.nowSec() - joinedAt)} назад, при входе в базе не было - ${verdict}${error}`,
  )
}

// Сообщение от недавно вошедшего: спрашиваем базу ещё раз, но не чаще раза в 10 минут.
async function onMessage(msg: TgMessage, deps: GuardDeps): Promise<boolean> {
  const store = deps.store
  if (!store || !msg.from || msg.from.is_bot) return false
  const chatKey = String(msg.chat.id)
  const joinedAt = await safe(() => store.joinedAt(chatKey, msg.from!.id), null)
  if (joinedAt === null) return false
  if (!(await safe(() => store.claimMessageCheck(chatKey, msg.from!.id), false))) return false
  const check = await deps.spamDb(msg.from.id)
  if (check.verdict === 'banned') {
    await onFlagged(msg.chat, msg.from.id, 'первое сообщение', joinedAt, check, deps)
  }
  return true
}

// Перепроверка по расписанию: берём тех, кому пора, и спрашиваем базу ещё раз.
async function sweep(chat: TgChat, deps: GuardDeps): Promise<void> {
  const store = deps.store
  if (!store) return
  const now = deps.nowSec()
  if (deps.sweepGate) {
    if (now - deps.sweepGate.last < SWEEP_EVERY_SEC) return
    deps.sweepGate.last = now
  }
  const due = await safe(() => store.due(String(chat.id), now, SWEEP_BATCH), [])
  await Promise.all(
    due.map(async ({ userId, joinedAt }) => {
      const check = await deps.spamDb(userId)
      if (check.verdict === 'banned') {
        await onFlagged(chat, userId, 'по расписанию', joinedAt, check, deps)
      } else {
        await safe(() => store.reschedule(String(chat.id), userId, now, joinedAt), undefined)
      }
    }),
  )
}

// ".разбан" (ответом на сообщение или с id) - снять бан, если база ошиблась.
// Только для админов чата.
const COMMAND = /^\.разбан(?:\s+(\d{5,}))?\s*$/i

async function onCommand(msg: TgMessage, deps: GuardDeps): Promise<boolean> {
  const m = COMMAND.exec(String(msg.text ?? '').trim())
  if (!m || !msg.from) return false
  const chatId = msg.chat.id
  const status = await deps.api.getMemberStatus(chatId, msg.from.id).catch(() => '')
  if (status !== 'creator' && status !== 'administrator') return true // молча: не админ

  const targetId = m[1] ? Number(m[1]) : msg.reply_to_message?.from?.id
  if (!targetId) {
    await log(deps, '⚠️ .разбан: нужен ответ на сообщение человека или его id')
    return true
  }
  try {
    await deps.api.unbanMember(chatId, targetId)
    // Админ решил, что база ошиблась: ни перепроверка, ни повторный вход его не баны.
    await safe(async () => {
      await deps.store?.forget(String(chatId), targetId)
      await deps.store?.exempt(targetId)
    }, undefined)
    await log(deps, `✅ .разбан: id ${targetId} разбанен (${userLabel(msg.from)})`)
  } catch (err) {
    await log(
      deps,
      `⚠️ .разбан id ${targetId}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return true
}

export async function handleGuardUpdate(update: TgUpdate, deps: GuardDeps): Promise<GuardResult> {
  const cm = update.chat_member
  if (cm && deps.allowedChats.has(String(cm.chat?.id)) && isJoin(cm)) {
    await onJoin(cm, deps)
    await sweep(cm.chat, deps)
    return 'join'
  }
  const msg = update.message
  if (msg && deps.allowedChats.has(String(msg.chat?.id))) {
    if (typeof msg.text === 'string' && (await onCommand(msg, deps))) return 'command'
    const checked = await onMessage(msg, deps)
    await sweep(msg.chat, deps)
    return checked ? 'recheck' : 'ignored'
  }
  return 'ignored'
}
