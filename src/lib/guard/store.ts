import type { Redis } from '@upstash/redis'

// Память охраны чата: кто вошёл за последнюю неделю и когда его пора проверить
// заново. Нужна потому, что база спамеров узнаёт об аккаунте с задержкой (на
// практике от часов до суток и больше), а проверка на входе одна. Всё
// best-effort: если Redis недоступен, бот работает как раньше (проверка на входе).

export const RETENTION_SEC = 7 * 86400
const FIRST_DAY_EVERY_SEC = 3600
const LATER_EVERY_SEC = 6 * 3600
const MESSAGE_CHECK_EVERY_SEC = 600
const EXEMPT_SEC = 30 * 86400

// Первые сутки проверяем каждый час (там основной риск), дальше раз в 6 часов.
export function nextCheckAt(nowSec: number, joinedAtSec: number): number {
  return nowSec + (nowSec - joinedAtSec < 86400 ? FIRST_DAY_EVERY_SEC : LATER_EVERY_SEC)
}

export interface DueUser {
  userId: number
  joinedAt: number
}

export interface GuardStore {
  recordJoin(chatId: string, userId: number, joinedAtSec: number): Promise<void>
  joinedAt(chatId: string, userId: number): Promise<number | null>
  // Те, кому пора на проверку (не старше недели); просроченных стирает.
  due(chatId: string, nowSec: number, limit: number): Promise<DueUser[]>
  reschedule(chatId: string, userId: number, nowSec: number, joinedAtSec: number): Promise<void>
  // true, если запись была и теперь удалена: кто удалил, тот и действует (защита от
  // двойного бана и двойного объявления при параллельных вызовах).
  forget(chatId: string, userId: number): Promise<boolean>
  // true не чаще раза в 10 минут на человека: чтобы болтливый новичок не дёргал базу
  // на каждое сообщение.
  claimMessageCheck(chatId: string, userId: number): Promise<boolean>
  // Админ сказал ".разбан": этого человека перепроверка и повторный вход больше не банят.
  exempt(userId: number): Promise<void>
  isExempt(userId: number): Promise<boolean>
}

export function createRedisStore(redis: Redis): GuardStore {
  const joined = (chat: string) => `guard:joined:${chat}`
  const dueKey = (chat: string) => `guard:due:${chat}`
  return {
    async recordJoin(chat, userId, ts) {
      await redis.hset(joined(chat), { [userId]: ts })
      await redis.zadd(dueKey(chat), { score: nextCheckAt(ts, ts), member: String(userId) })
    },
    async joinedAt(chat, userId) {
      const v = await redis.hget<number>(joined(chat), String(userId))
      return typeof v === 'number' ? v : null
    },
    async due(chat, nowSec, limit) {
      const ids = await redis.zrange<string[]>(dueKey(chat), 0, nowSec, {
        byScore: true,
        offset: 0,
        count: limit,
      })
      if (!ids.length) return []
      const times = (await redis.hmget<Record<string, number>>(joined(chat), ...ids)) ?? {}
      const out: DueUser[] = []
      for (const id of ids) {
        const t = times[id]
        if (typeof t !== 'number' || nowSec - t > RETENTION_SEC) {
          await redis.zrem(dueKey(chat), id)
          await redis.hdel(joined(chat), id)
          continue
        }
        out.push({ userId: Number(id), joinedAt: t })
      }
      return out
    },
    async reschedule(chat, userId, nowSec, joinedAtSec) {
      await redis.zadd(dueKey(chat), {
        score: nextCheckAt(nowSec, joinedAtSec),
        member: String(userId),
      })
    },
    async forget(chat, userId) {
      const removed = await redis.hdel(joined(chat), String(userId))
      await redis.zrem(dueKey(chat), String(userId))
      return removed > 0
    },
    async claimMessageCheck(chat, userId) {
      const r = await redis.set(`guard:msg:${chat}:${userId}`, 1, {
        nx: true,
        ex: MESSAGE_CHECK_EVERY_SEC,
      })
      return r === 'OK'
    },
    async exempt(userId) {
      await redis.set(`guard:exempt:${userId}`, 1, { ex: EXEMPT_SEC })
    },
    async isExempt(userId) {
      return (await redis.exists(`guard:exempt:${userId}`)) > 0
    },
  }
}

// Для тестов: то же поведение в памяти.
export function createMemoryStore(): GuardStore & { _joined: Map<string, number> } {
  const joinedMap = new Map<string, number>()
  const dueMap = new Map<string, number>()
  const claims = new Set<string>()
  const exempts = new Set<number>()
  const k = (c: string, u: number | string) => `${c}|${u}`
  return {
    _joined: joinedMap,
    async recordJoin(c, u, ts) {
      joinedMap.set(k(c, u), ts)
      dueMap.set(k(c, u), nextCheckAt(ts, ts))
    },
    async joinedAt(c, u) {
      return joinedMap.get(k(c, u)) ?? null
    },
    async due(c, now, limit) {
      const out: DueUser[] = []
      for (const [key, score] of [...dueMap.entries()].sort((a, b) => a[1] - b[1])) {
        if (!key.startsWith(`${c}|`) || score > now || out.length >= limit) continue
        const t = joinedMap.get(key)
        if (t === undefined || now - t > RETENTION_SEC) {
          dueMap.delete(key)
          joinedMap.delete(key)
          continue
        }
        out.push({ userId: Number(key.split('|')[1]), joinedAt: t })
      }
      return out
    },
    async reschedule(c, u, now, joinedAt) {
      dueMap.set(k(c, u), nextCheckAt(now, joinedAt))
    },
    async forget(c, u) {
      dueMap.delete(k(c, u))
      return joinedMap.delete(k(c, u))
    },
    async claimMessageCheck(c, u) {
      if (claims.has(k(c, u))) return false
      claims.add(k(c, u))
      return true
    },
    async exempt(u) {
      exempts.add(u)
    },
    async isExempt(u) {
      return exempts.has(u)
    },
  }
}
