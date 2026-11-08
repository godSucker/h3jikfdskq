// Тонкая обёртка над Bot API: ровно те методы, что нужны охране чата. Отдельно от
// стат-бота (другой токен, другой периметр доверия: этот умеет банить и удалять).

export type ChatId = number | string

export interface ChatMemberInfo {
  status: string
  is_member?: boolean
  user: {
    id: number
    is_bot?: boolean
    first_name?: string
    last_name?: string
    username?: string
  }
}

export interface BotApi {
  banMember(chatId: ChatId, userId: number): Promise<void>
  unbanMember(chatId: ChatId, userId: number): Promise<void>
  sendText(chatId: ChatId, text: string): Promise<void>
  getMemberStatus(chatId: ChatId, userId: number): Promise<string>
  getMember(chatId: ChatId, userId: number): Promise<ChatMemberInfo>
}

export function createBotApi(token: string, fetchImpl: typeof fetch = fetch): BotApi {
  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean
      result?: T
      description?: string
    } | null
    if (!body?.ok) throw new Error(`${method}: ${body?.description ?? `HTTP ${res.status}`}`)
    return body.result as T
  }

  return {
    async banMember(chatId, userId) {
      // revoke_messages: вместе с баном стираются все сообщения спамера в чате (на входе
      // сообщений ещё нет, при перепроверке это то самое спам-сообщение).
      await call('banChatMember', { chat_id: chatId, user_id: userId, revoke_messages: true })
    },
    async unbanMember(chatId, userId) {
      await call('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true })
    },
    async sendText(chatId, text) {
      // Без parse_mode: имена и username пользователей - чужой текст.
      await call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true })
    },
    async getMember(chatId, userId) {
      return call<ChatMemberInfo>('getChatMember', { chat_id: chatId, user_id: userId })
    },
    async getMemberStatus(chatId, userId) {
      return (await this.getMember(chatId, userId)).status
    },
  }
}
