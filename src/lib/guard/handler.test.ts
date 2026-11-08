import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGuardUpdate, type GuardDeps } from './handler'
import type { BotApi } from './telegram-api'
import { parseGuardConfig, type LolsVerdict } from './policy'

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
  } = {},
): GuardDeps {
  return {
    api: api as unknown as BotApi,
    lols: async () => over.lols ?? 'clean',
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
    expect(sent[1]).toContain('в базе спамеров - забанен')
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
    expect(api.sendText).not.toHaveBeenCalled()
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
