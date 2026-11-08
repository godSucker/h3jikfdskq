import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGuardUpdate, type GuardDeps } from './handler'
import type { BotApi } from './telegram-api'
import { parseGuardConfig, type LolsVerdict } from './policy'
import { createMemoryStore, type GuardStore } from './store'

const CHAT = -1001541478618
const LOG = -1003079055796

let api: { [K in keyof BotApi]: ReturnType<typeof vi.fn> }
let sent: string[]

function deps(
  over: {
    lols?: LolsVerdict
    ban?: boolean
    allowed?: string[]
    enforce?: string[]
    logTo?: number[]
    store?: GuardStore
  } = {},
): GuardDeps {
  return {
    api: api as unknown as BotApi,
    spamDb: async () => ({ verdict: over.lols ?? 'clean', source: 'LOLS' }),
    store: over.store ?? null,
    cfg: parseGuardConfig({ GUARD_BAN: over.ban ? '1' : '' }),
    allowedChats: new Set(over.allowed ?? [String(CHAT)]),
    enforceChats: over.enforce ? new Set(over.enforce) : null,
    logChatIds: over.logTo ?? [LOG],
    nowSec: () => 1_000_000,
  }
}

const join = (user: Record<string, unknown> = {}, chatId = CHAT) => ({
  chat_member: {
    chat: { id: chatId, title: 'Чат' },
    old_chat_member: { status: 'left', user: { id: 7 } },
    new_chat_member: {
      status: 'member',
      user: { id: 7, first_name: 'Вася', username: 'vasya', ...user },
    },
  },
})

beforeEach(() => {
  sent = []
  api = {
    banMember: vi.fn(async () => {}),
    unbanMember: vi.fn(async () => {}),
    sendText: vi.fn(async (_c: unknown, t: string) => void sent.push(t)),
    getMemberStatus: vi.fn(async () => 'administrator'),
    getMember: vi.fn(async (_c: unknown, id: number) => ({
      status: 'member',
      user: { id, first_name: 'Вася', username: 'vasya' },
    })),
  }
})

describe('joins', () => {
  it('a clean newcomer is only logged, nobody is touched', async () => {
    expect(await handleGuardUpdate(join(), deps({ ban: true }))).toBe('join')
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Вася (@vasya, id 7)')
    expect(sent[0]).toContain('LOLS: чист - нет в базе спамеров')
    expect(sent[0]).not.toContain('24')
  })

  it('database hit: logged as "would be banned" in log mode, banned only when the ban switch is on', async () => {
    await handleGuardUpdate(join(), deps({ lols: 'banned' }))
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent[0]).toContain('в базе спамеров - был бы забанен, но бан выключен')

    await handleGuardUpdate(join(), deps({ lols: 'banned', ban: true }))
    expect(api.banMember).toHaveBeenCalledWith(CHAT, 7)
    expect(sent.filter((t) => t.startsWith('🚫 Вход в'))[1]).toContain(
      'в базе спамеров - забанен навсегда',
    )
  })

  it('an applied ban is announced in the chat itself, a would-be ban is not', async () => {
    const chatTexts = () => api.sendText.mock.calls.filter((c) => c[0] === CHAT).map((c) => c[1])
    await handleGuardUpdate(join(), deps({ lols: 'banned' }))
    expect(chatTexts()).toEqual([])

    await handleGuardUpdate(
      join({ first_name: 'Вася', last_name: 'Спамов' }),
      deps({ lols: 'banned', ban: true }),
    )
    expect(chatTexts()).toEqual([
      '🚫 Вася Спамов (@vasya) забанен навсегда: найден в базе спамеров.',
    ])
  })

  it('the chat announcement has no id, no line breaks and a bounded name', async () => {
    await handleGuardUpdate(
      join({ first_name: 'A\nB'.padEnd(80, 'x'), username: undefined }),
      deps({ lols: 'banned', ban: true }),
    )
    const text = api.sendText.mock.calls.find((c) => c[0] === CHAT)![1] as string
    expect(text).not.toContain('\n')
    expect(text).not.toContain('id 7')
    expect(text.length).toBeLessThan(120)
  })

  it('a failed ban is not announced; a failed announcement does not hide the ban', async () => {
    api.banMember.mockRejectedValueOnce(new Error('banChatMember: not enough rights'))
    await handleGuardUpdate(join(), deps({ lols: 'banned', ban: true }))
    expect(api.sendText.mock.calls.some((c) => c[0] === CHAT)).toBe(false)

    api.sendText.mockImplementation(async (c: number, t: string) => {
      if (c === CHAT) throw new Error('sendMessage: not enough rights')
      sent.push(t)
    })
    await expect(handleGuardUpdate(join(), deps({ lols: 'banned', ban: true }))).resolves.toBe(
      'join',
    )
    expect(api.banMember).toHaveBeenCalledTimes(2)
    expect(sent[sent.length - 1]).toContain('Объявление в чат не отправлено')
  })

  it('an unanswered database is logged and nobody is banned', async () => {
    await handleGuardUpdate(join(), deps({ lols: 'unknown', ban: true }))
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent[0]).toContain('нет ответа')
  })

  it('an API failure is reported in the log and never throws', async () => {
    api.banMember.mockRejectedValueOnce(new Error('banChatMember: not enough rights'))
    await expect(handleGuardUpdate(join(), deps({ lols: 'banned', ban: true }))).resolves.toBe(
      'join',
    )
    expect(sent[0]).toContain('Ошибка применения: banChatMember: not enough rights')
  })

  it('enforcement can be limited to some chats: the others stay log-only', async () => {
    const both = [String(CHAT), '-100777']
    await handleGuardUpdate(
      join(),
      deps({ lols: 'banned', ban: true, allowed: both, enforce: ['-100777'] }),
    )
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent[0]).toContain('бан выключен')

    await handleGuardUpdate(
      join({}, -100777),
      deps({ lols: 'banned', ban: true, allowed: both, enforce: ['-100777'] }),
    )
    expect(api.banMember).toHaveBeenCalledTimes(1)
  })

  it('the log goes to every recipient, and one unreachable recipient does not silence the rest', async () => {
    const calls: number[] = []
    api.sendText.mockImplementation(async (c: number) => {
      calls.push(c)
      if (c === 111)
        throw new Error("sendMessage: Forbidden: bot can't initiate conversation with a user")
    })
    await expect(handleGuardUpdate(join(), deps({ logTo: [111, 222] }))).resolves.toBe('join')
    expect(calls.sort()).toEqual([111, 222])
  })

  it('works with no log recipients at all', async () => {
    await handleGuardUpdate(join(), deps({ lols: 'banned', ban: true, logTo: [] }))
    expect(api.banMember).toHaveBeenCalledTimes(1)
    // the only message is the announcement in the chat itself, nothing goes to a log
    expect(api.sendText.mock.calls.map((c) => c[0])).toEqual([CHAT])
  })

  it('ignores bots entirely (no log, no action)', async () => {
    await handleGuardUpdate(join({ is_bot: true }), deps({ lols: 'banned', ban: true }))
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('ignores chats that are not in the allowlist, and an empty allowlist means "nothing"', async () => {
    expect(await handleGuardUpdate(join({}, -100999), deps({ ban: true }))).toBe('ignored')
    expect(await handleGuardUpdate(join(), deps({ ban: true, allowed: [] }))).toBe('ignored')
    expect(sent).toHaveLength(0)
  })

  it('does not treat a restriction (member -> restricted) or a leave as a join', async () => {
    const restricted = {
      chat_member: {
        chat: { id: CHAT },
        old_chat_member: { status: 'member', user: { id: 7 } },
        new_chat_member: { status: 'restricted', is_member: true, user: { id: 7 } },
      },
    }
    const leave = {
      chat_member: {
        chat: { id: CHAT },
        old_chat_member: { status: 'member', user: { id: 7 } },
        new_chat_member: { status: 'left', user: { id: 7 } },
      },
    }
    expect(await handleGuardUpdate(restricted, deps())).toBe('ignored')
    expect(await handleGuardUpdate(leave, deps())).toBe('ignored')
    expect(sent).toHaveLength(0)
  })

  it('rejoin after leaving while restricted counts as a join', async () => {
    const rejoin = {
      chat_member: {
        chat: { id: CHAT },
        old_chat_member: { status: 'restricted', is_member: false, user: { id: 7 } },
        new_chat_member: { status: 'member', user: { id: 7 } },
      },
    }
    expect(await handleGuardUpdate(rejoin, deps())).toBe('join')
  })
})

describe('admin commands', () => {
  const msg = (text: string, extra: Record<string, unknown> = {}) => ({
    message: { chat: { id: CHAT }, from: { id: 1, first_name: 'Админ' }, text, ...extra },
  })

  it('.разбан takes an id', async () => {
    expect(await handleGuardUpdate(msg('.разбан 123456789'), deps())).toBe('command')
    expect(api.unbanMember).toHaveBeenCalledWith(CHAT, 123456789)
  })

  it('.разбан as a reply unbans the author of the replied message', async () => {
    await handleGuardUpdate(msg('.разбан', { reply_to_message: { from: { id: 7 } } }), deps())
    expect(api.unbanMember).toHaveBeenCalledWith(CHAT, 7)
  })

  it('non-admins are silently ignored', async () => {
    api.getMemberStatus.mockResolvedValue('member')
    await handleGuardUpdate(msg('.разбан 123456789'), deps())
    expect(api.unbanMember).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('a command without a target explains what is needed', async () => {
    await handleGuardUpdate(msg('.разбан'), deps())
    expect(api.unbanMember).not.toHaveBeenCalled()
    expect(sent[0]).toContain('нужен ответ на сообщение')
  })

  it('the removed .довер command is no longer a command', async () => {
    expect(await handleGuardUpdate(msg('.довер 123456789'), deps())).toBe('ignored')
    expect(api.getMemberStatus).not.toHaveBeenCalled()
  })

  it('ordinary chat messages are not even looked at', async () => {
    expect(await handleGuardUpdate(msg('привет всем'), deps())).toBe('ignored')
    expect(api.getMemberStatus).not.toHaveBeenCalled()
  })
})

describe('rechecking people who joined recently', () => {
  const NOW = 1_000_000
  const msgFrom = (id: number, extra: Record<string, unknown> = {}) => ({
    message: { chat: { id: CHAT, title: 'Чат' }, from: { id, first_name: 'Вася' }, ...extra },
  })
  // база отвечает по-разному в разное время: сначала чист, потом нашла
  function flippingDeps(store: GuardStore, now: { t: number }, over: { ban?: boolean } = {}) {
    const verdicts = { value: 'clean' as LolsVerdict }
    const d = deps({ ban: over.ban ?? true, store })
    d.spamDb = async () => ({ verdict: verdicts.value, source: 'LOLS' })
    d.nowSec = () => now.t
    d.sweepGate = { last: 0 }
    return { d, verdicts }
  }
  const chatTexts = () => api.sendText.mock.calls.filter((c) => c[0] === CHAT).map((c) => c[1])

  it('a clean join is remembered; a would-be-banned one is not', async () => {
    const store = createMemoryStore()
    await handleGuardUpdate(join(), deps({ store }))
    expect(await store.joinedAt(String(CHAT), 7)).not.toBeNull()
    await handleGuardUpdate(join({ id: 8 }), deps({ store, lols: 'banned' }))
    expect(await store.joinedAt(String(CHAT), 8)).toBeNull()
  })

  it("the newcomer's first message is checked again and bans once the database has caught up", async () => {
    const store = createMemoryStore()
    const now = { t: NOW }
    const { d, verdicts } = flippingDeps(store, now)
    await handleGuardUpdate(join(), d)
    api.sendText.mockClear()

    now.t += 600
    verdicts.value = 'banned'
    expect(await handleGuardUpdate(msgFrom(7), d)).toBe('recheck')
    expect(api.banMember).toHaveBeenCalledWith(CHAT, 7)
    expect(chatTexts()).toEqual(['🚫 Вася (@vasya) забанен навсегда: найден в базе спамеров.'])
    expect(
      sent.some((t) => t.includes('Перепроверка') && t.includes('при входе в базе не было')),
    ).toBe(true)
    expect(await store.joinedAt(String(CHAT), 7)).toBeNull()
  })

  it('a message from someone who did not just join costs nothing: no database call', async () => {
    const store = createMemoryStore()
    const d = deps({ store })
    const spy = vi.fn(async () => ({ verdict: 'clean' as LolsVerdict, source: 'LOLS' }))
    d.spamDb = spy
    expect(await handleGuardUpdate(msgFrom(99), d)).toBe('ignored')
    expect(spy).not.toHaveBeenCalled()
  })

  it('a chatty newcomer is checked at most once per claim window', async () => {
    const store = createMemoryStore()
    const d = deps({ store })
    await handleGuardUpdate(join(), d)
    const spy = vi.fn(async () => ({ verdict: 'clean' as LolsVerdict, source: 'LOLS' }))
    d.spamDb = spy
    await handleGuardUpdate(msgFrom(7), d)
    await handleGuardUpdate(msgFrom(7), d)
    await handleGuardUpdate(msgFrom(7), d)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a schedule sweep (triggered by any chat activity) bans a latecomer from the database', async () => {
    const store = createMemoryStore()
    const now = { t: NOW }
    const { d, verdicts } = flippingDeps(store, now)
    await handleGuardUpdate(join(), d)

    now.t += 3700 // it is time for the hourly check
    verdicts.value = 'banned'
    await handleGuardUpdate(msgFrom(99), d) // somebody else writes; the sweep rides along
    expect(api.banMember).toHaveBeenCalledWith(CHAT, 7)
    expect(sent.some((t) => t.includes('по расписанию'))).toBe(true)
  })

  it('the sweep runs at most once per gate window and not before a check is due', async () => {
    const store = createMemoryStore()
    const now = { t: NOW }
    const { d, verdicts } = flippingDeps(store, now)
    await handleGuardUpdate(join(), d)
    verdicts.value = 'banned'
    now.t += 60 // not due yet (due in 1h)
    await handleGuardUpdate(msgFrom(99), d)
    expect(api.banMember).not.toHaveBeenCalled()
  })

  it('log-only mode logs "would be banned" once and stops asking about that person', async () => {
    const store = createMemoryStore()
    const now = { t: NOW }
    const { d, verdicts } = flippingDeps(store, now, { ban: false })
    await handleGuardUpdate(join(), d)
    now.t += 3700
    verdicts.value = 'banned'
    await handleGuardUpdate(msgFrom(99), d)
    expect(api.banMember).not.toHaveBeenCalled()
    expect(
      sent.filter((t) => t.includes('Перепроверка') && t.includes('бан выключен')),
    ).toHaveLength(1)
    expect(await store.joinedAt(String(CHAT), 7)).toBeNull()
  })

  it('does nothing about someone who already left, is already banned, or is an admin', async () => {
    for (const status of ['left', 'kicked', 'administrator']) {
      sent.length = 0
      api.banMember.mockClear()
      const store = createMemoryStore()
      const now = { t: NOW }
      const { d, verdicts } = flippingDeps(store, now)
      await handleGuardUpdate(join(), d)
      api.getMember.mockResolvedValueOnce({ status, user: { id: 7 } })
      now.t += 600
      verdicts.value = 'banned'
      await handleGuardUpdate(msgFrom(7), d)
      expect(api.banMember, status).not.toHaveBeenCalled()
      expect(await store.joinedAt(String(CHAT), 7), status).toBeNull()
    }
  })

  it('two parallel sweeps of the same person ban and announce only once', async () => {
    const store = createMemoryStore()
    const now = { t: NOW }
    const { d, verdicts } = flippingDeps(store, now)
    await handleGuardUpdate(join(), d)
    api.sendText.mockClear()
    now.t += 3700
    verdicts.value = 'banned'
    // two function instances, each with its own gate, both see the same due record:
    // the one that deletes it first acts, the other backs off
    const d2 = { ...d, sweepGate: { last: 0 } }
    await Promise.all([handleGuardUpdate(msgFrom(99), d), handleGuardUpdate(msgFrom(98), d2)])
    expect(api.banMember).toHaveBeenCalledTimes(1)
    expect(chatTexts()).toHaveLength(1)
  })

  it('.разбан exempts the person: no recheck ban and no ban on a later database hit', async () => {
    const store = createMemoryStore()
    const now = { t: NOW }
    const { d, verdicts } = flippingDeps(store, now)
    await handleGuardUpdate(join(), d)
    await handleGuardUpdate(
      {
        message: {
          chat: { id: CHAT },
          from: { id: 1, first_name: 'Админ' },
          text: '.разбан 7000000',
        },
      },
      d,
    )
    await store.recordJoin(String(CHAT), 7000000, NOW)
    now.t += 600
    verdicts.value = 'banned'
    await handleGuardUpdate(msgFrom(7000000), d)
    expect(api.banMember).not.toHaveBeenCalled()
    api.sendText.mockClear()
    await handleGuardUpdate(join({ id: 7000000 }), d)
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent.some((t) => t.includes('исключён командой .разбан'))).toBe(true)
  })

  it('a broken store never breaks the bot: joins are still checked and logged', async () => {
    const broken = createMemoryStore()
    for (const k of Object.keys(broken) as (keyof GuardStore)[]) {
      if (typeof broken[k] === 'function') {
        ;(broken as unknown as Record<string, unknown>)[k] = async () => {
          throw new Error('redis down')
        }
      }
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(handleGuardUpdate(join(), deps({ store: broken }))).resolves.toBe('join')
    expect(sent[0]).toContain('нет в базе спамеров')
    await expect(handleGuardUpdate(msgFrom(7), deps({ store: broken }))).resolves.toBe('ignored')
    err.mockRestore()
  })
})
