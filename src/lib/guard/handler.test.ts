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
    restrict?: boolean
    ban?: boolean
    allowed?: string[]
    enforce?: string[]
    logTo?: number[]
  } = {},
): GuardDeps {
  return {
    api: api as unknown as BotApi,
    lols: async () => over.lols ?? 'clean',
    cfg: parseGuardConfig({
      GUARD_RESTRICT: over.restrict ? '1' : '',
      GUARD_BAN: over.ban ? '1' : '',
    }),
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
    restrictMember: vi.fn(async () => {}),
    banMember: vi.fn(async () => {}),
    unbanMember: vi.fn(async () => {}),
    sendText: vi.fn(async (_c: unknown, t: string) => void sent.push(t)),
    getChatPermissions: vi.fn(async () => ({ can_send_messages: true, can_send_photos: true })),
    getMemberStatus: vi.fn(async () => 'administrator'),
  }
})

describe('joins', () => {
  it('log-only mode (default): logs the verdict, touches nobody', async () => {
    expect(await handleGuardUpdate(join(), deps())).toBe('join')
    expect(api.restrictMember).not.toHaveBeenCalled()
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Вася (@vasya, id 7)')
    expect(sent[0]).toContain('ничего (режим лога)')
  })

  it('restriction on: text-only until now + 24h', async () => {
    await handleGuardUpdate(join(), deps({ restrict: true }))
    expect(api.restrictMember).toHaveBeenCalledTimes(1)
    const [chat, user, perms, until] = api.restrictMember.mock.calls[0]
    expect([chat, user, until]).toEqual([CHAT, 7, 1_000_000 + 86_400])
    expect(perms.can_send_photos).toBe(false)
    expect(perms.can_send_messages).toBe(true)
    expect(sent[0]).toContain('Применено: ограничение')
  })

  it('database hit: logged as ban in log mode, banned only when the ban switch is on', async () => {
    await handleGuardUpdate(join(), deps({ lols: 'banned' }))
    expect(api.banMember).not.toHaveBeenCalled()
    expect(sent[0]).toContain('в базе спамеров')

    await handleGuardUpdate(join(), deps({ lols: 'banned', ban: true }))
    expect(api.banMember).toHaveBeenCalledWith(CHAT, 7)
  })

  it('database hit with ban off but restriction on falls back to restriction and says so', async () => {
    await handleGuardUpdate(join(), deps({ lols: 'banned', restrict: true }))
    expect(api.banMember).not.toHaveBeenCalled()
    expect(api.restrictMember).toHaveBeenCalledTimes(1)
    expect(sent[0]).toContain('бан выключен')
  })

  it('an API failure is reported in the log and never throws', async () => {
    api.restrictMember.mockRejectedValueOnce(new Error('restrictChatMember: not enough rights'))
    await expect(handleGuardUpdate(join(), deps({ restrict: true }))).resolves.toBe('join')
    expect(sent[0]).toContain('Ошибка применения: restrictChatMember: not enough rights')
  })

  it('enforcement can be limited to some chats: the others stay log-only', async () => {
    const both = [String(CHAT), '-100777']
    await handleGuardUpdate(
      join(),
      deps({ restrict: true, ban: true, allowed: both, enforce: ['-100777'] }),
    )
    expect(api.restrictMember).not.toHaveBeenCalled()
    expect(sent[0]).toContain('ничего (режим лога)')

    await handleGuardUpdate(
      join({}, -100777),
      deps({ restrict: true, allowed: both, enforce: ['-100777'] }),
    )
    expect(api.restrictMember).toHaveBeenCalledTimes(1)
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
    await handleGuardUpdate(join(), deps({ restrict: true, logTo: [] }))
    expect(api.restrictMember).toHaveBeenCalledTimes(1)
    expect(api.sendText).not.toHaveBeenCalled()
  })

  it('ignores bots entirely (no log, no action)', async () => {
    await handleGuardUpdate(join({ is_bot: true }), deps({ restrict: true, ban: true }))
    expect(api.restrictMember).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('ignores chats that are not in the allowlist, and an empty allowlist means "nothing"', async () => {
    expect(await handleGuardUpdate(join({}, -100999), deps({ restrict: true }))).toBe('ignored')
    expect(await handleGuardUpdate(join(), deps({ restrict: true, allowed: [] }))).toBe('ignored')
    expect(api.restrictMember).not.toHaveBeenCalled()
  })

  it('does not treat its own restriction (member -> restricted) or a leave as a join', async () => {
    const own = {
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
    expect(await handleGuardUpdate(own, deps({ restrict: true }))).toBe('ignored')
    expect(await handleGuardUpdate(leave, deps({ restrict: true }))).toBe('ignored')
    expect(api.restrictMember).not.toHaveBeenCalled()
  })

  it('rejoin after leaving while restricted counts as a join', async () => {
    const rejoin = {
      chat_member: {
        chat: { id: CHAT },
        old_chat_member: { status: 'restricted', is_member: false, user: { id: 7 } },
        new_chat_member: { status: 'member', user: { id: 7 } },
      },
    }
    expect(await handleGuardUpdate(rejoin, deps({ restrict: true }))).toBe('join')
  })
})

describe('admin commands', () => {
  const msg = (text: string, extra: Record<string, unknown> = {}) => ({
    message: { chat: { id: CHAT }, from: { id: 1, first_name: 'Админ' }, text, ...extra },
  })

  it('.довер as a reply restores the chat default permissions of the target', async () => {
    const r = await handleGuardUpdate(
      msg('.довер', { reply_to_message: { from: { id: 7 } } }),
      deps(),
    )
    expect(r).toBe('command')
    expect(api.restrictMember).toHaveBeenCalledWith(CHAT, 7, {
      can_send_messages: true,
      can_send_photos: true,
    })
    expect(sent[0]).toContain('ограничение снято с id 7')
  })

  it('.разбан takes an id', async () => {
    await handleGuardUpdate(msg('.разбан 123456789'), deps())
    expect(api.unbanMember).toHaveBeenCalledWith(CHAT, 123456789)
  })

  it('non-admins are silently ignored', async () => {
    api.getMemberStatus.mockResolvedValue('member')
    await handleGuardUpdate(msg('.довер 123456789'), deps())
    expect(api.restrictMember).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('a command without a target explains what is needed', async () => {
    await handleGuardUpdate(msg('.довер'), deps())
    expect(api.restrictMember).not.toHaveBeenCalled()
    expect(sent[0]).toContain('нужен ответ на сообщение')
  })

  it('ordinary chat messages are not even looked at', async () => {
    expect(await handleGuardUpdate(msg('привет всем'), deps())).toBe('ignored')
    expect(api.getMemberStatus).not.toHaveBeenCalled()
  })
})
