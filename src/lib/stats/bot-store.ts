/**
 * Upstash Redis-backed bits for the stats bot: per-user rate limiting, a
 * short-lived render cache, and daily usage counters for /stats. All reads
 * of the store are best-effort - a Redis hiccup should degrade to "render
 * anyway" / "no stats", never break the bot.
 */
import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

function getRedis(): Redis | null {
  const url = import.meta.env.KV_REST_API_URL as string | undefined
  const token = import.meta.env.KV_REST_API_TOKEN as string | undefined
  if (!url || !token) return null
  return new Redis({ url, token })
}

let ratelimit: Ratelimit | null | undefined
function getRatelimit(): Ratelimit | null {
  if (ratelimit !== undefined) return ratelimit
  const redis = getRedis()
  ratelimit = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(8, '60 s'),
        prefix: 'statsbot:ratelimit',
      })
    : null
  return ratelimit
}

// Guards only the expensive step (an actual Satori/resvg render) - a cache
// hit or a failed parse never touches this, so repeating the same query
// isn't penalized and typos aren't either.
export async function checkRateLimit(userId: string | number): Promise<boolean> {
  const rl = getRatelimit()
  if (!rl) return true
  try {
    const { success } = await rl.limit(String(userId))
    return success
  } catch {
    return true
  }
}

export async function getCachedCard(key: string): Promise<Buffer | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const b64 = await redis.get<string>(`statsbot:cache:${key}`)
    return b64 ? Buffer.from(b64, 'base64') : null
  } catch {
    return null
  }
}

export async function setCachedCard(key: string, photo: Buffer, ttlSeconds = 120): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(`statsbot:cache:${key}`, photo.toString('base64'), { ex: ttlSeconds })
  } catch {
    // best effort - a failed cache write just means the next identical
    // request re-renders instead of hitting cache
  }
}

const STATS_TTL_SECONDS = 8 * 24 * 60 * 60 // 8 days - only /stats for "today" is used, keep a short buffer

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function recordRequest(mutantName: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const date = today()
  try {
    await Promise.all([
      redis.incr(`statsbot:total:${date}`).then(() => redis.expire(`statsbot:total:${date}`, STATS_TTL_SECONDS)),
      redis
        .hincrby(`statsbot:mutants:${date}`, mutantName, 1)
        .then(() => redis.expire(`statsbot:mutants:${date}`, STATS_TTL_SECONDS)),
    ])
  } catch {
    // best effort - stats are informational, never block a reply over this
  }
}

export async function recordError(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const date = today()
  try {
    await redis
      .incr(`statsbot:errors:${date}`)
      .then(() => redis.expire(`statsbot:errors:${date}`, STATS_TTL_SECONDS))
  } catch {
    // best effort
  }
}

export interface DailyStats {
  total: number
  errors: number
  topMutants: Array<[string, number]>
}

export async function getTodayStats(): Promise<DailyStats | null> {
  const redis = getRedis()
  if (!redis) return null
  const date = today()
  try {
    const [total, errors, mutants] = await Promise.all([
      redis.get<number>(`statsbot:total:${date}`),
      redis.get<number>(`statsbot:errors:${date}`),
      redis.hgetall<Record<string, number>>(`statsbot:mutants:${date}`),
    ])
    const topMutants = Object.entries(mutants ?? {})
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 10)
      .map(([name, count]) => [name, Number(count)] as [string, number])
    return { total: Number(total ?? 0), errors: Number(errors ?? 0), topMutants }
  } catch {
    return null
  }
}
