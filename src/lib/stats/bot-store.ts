/**
 * Upstash Redis-backed bits for the stats bot: per-user rate limiting, a
 * short-lived render cache, and daily usage counters for /stats. All reads
 * of the store are best-effort - a Redis hiccup should degrade to "render
 * anyway" / "no stats", never break the bot.
 */
import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import type { AliasOverlayEntry } from './bot-parser'

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

export interface RateLimitResult {
  allowed: boolean
  // 'override' = an admin-set per-user limit (setRateLimitOverride) is what
  // blocked this request - the caller shows a different message for that
  // than for the ambient default, since it's a deliberate restriction, not
  // generic "you're going too fast" throttling.
  reason: 'ok' | 'default' | 'override'
  retryAfterSeconds?: number
  override?: { max: number; window: number }
}

// Guards only the expensive step (an actual Satori/resvg render) - a cache
// hit or a failed parse never touches this, so repeating the same query
// isn't penalized and typos aren't either.
export async function checkRateLimit(userId: string | number): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) return { allowed: true, reason: 'ok' }

  // An admin-set per-user override (see setRateLimitOverride) takes
  // priority over the default 8/60s - used to throttle one specific
  // troublesome user harder without touching everyone else. Separate
  // Ratelimit prefix from the default limiter below, otherwise both would
  // share sliding-window state under the same key and corrupt each other's
  // counts.
  try {
    // Upstash's client auto-deserializes a JSON-shaped stored value on read
    // (confirmed live - storing via JSON.stringify still comes back as an
    // object, not the string) - typing the .get() call directly and NOT
    // re-parsing it is required. An extra JSON.parse() here used to throw
    // (parsing an already-parsed object stringifies to "[object Object]",
    // invalid JSON), silently caught below, which made the override branch
    // dead code - it always fell through to the default limiter regardless
    // of what was set. Caught by a live Redis test, not by inspection.
    const parsed = await redis.get<{ max: number; window: number }>(
      `statsbot:ratelimit:override:${userId}`,
    )
    if (parsed) {
      const overrideLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(parsed.max, `${parsed.window} s`),
        prefix: 'statsbot:ratelimit:custom',
      })
      const { success, reset } = await overrideLimiter.limit(String(userId))
      if (!success) {
        return {
          allowed: false,
          reason: 'override',
          retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
          override: parsed,
        }
      }
      return { allowed: true, reason: 'ok' }
    }
  } catch {
    // fall through to the default limiter
  }

  const rl = getRatelimit()
  if (!rl) return { allowed: true, reason: 'ok' }
  try {
    const { success, reset } = await rl.limit(String(userId))
    if (!success) {
      return {
        allowed: false,
        reason: 'default',
        retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
      }
    }
    return { allowed: true, reason: 'ok' }
  } catch {
    return { allowed: true, reason: 'ok' }
  }
}

// Duration is how long the override itself stays active (Redis TTL, no
// manual cleanup needed) - independent of the window inside it (how the
// N-requests-per-M-seconds throttle is measured while it's active).
export async function setRateLimitOverride(
  userId: string | number,
  maxRequests: number,
  windowSeconds: number,
  durationSeconds: number,
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.set(
      `statsbot:ratelimit:override:${userId}`,
      { max: maxRequests, window: windowSeconds },
      { ex: durationSeconds },
    )
    return true
  } catch {
    return false
  }
}

export async function clearRateLimitOverride(userId: string | number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.del(`statsbot:ratelimit:override:${userId}`)
    return true
  } catch {
    return false
  }
}

// A full ban, not a throttle - blocks the user from getting any card
// rendered at all, regardless of rate. Redis SET, no TTL: unlike the
// rate-limit override above (which is meant to self-expire), a ban is
// meant to persist until an admin explicitly lifts it with clearBan.
export async function setBan(userId: string | number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.sadd('statsbot:banned', String(userId))
    return true
  } catch {
    return false
  }
}

export async function clearBan(userId: string | number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.srem('statsbot:banned', String(userId))
    return true
  } catch {
    return false
  }
}

// Best-effort like everything else here: a Redis hiccup must never turn
// into "nobody can use the bot" - fail open (not banned) on error.
export async function isBanned(userId: string | number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    return Boolean(await redis.sismember('statsbot:banned', String(userId)))
  } catch {
    return false
  }
}

// Admin-curated nickname overlay (alias -> mutant id), on top of the
// build-time nickname-aliases.json - see AliasOverlayEntry in bot-parser.ts
// for why this has to be id-keyed and why it can't just be written back
// into that static file (Vercel's filesystem is read-only/frozen at
// runtime for a warm instance). Memoized in module scope so a normal
// message doesn't pay a Redis round-trip on every single request - a
// freshly-added alias can take up to ALIAS_OVERLAY_TTL_MS to reach OTHER
// warm instances, but addAliasOverlay below reflects it in THIS one
// immediately.
const ALIAS_OVERLAY_TTL_MS = 60_000
let aliasOverlayCache: { entries: AliasOverlayEntry[]; fetchedAt: number } | null = null

export async function getAliasOverlay(): Promise<AliasOverlayEntry[]> {
  if (aliasOverlayCache && Date.now() - aliasOverlayCache.fetchedAt < ALIAS_OVERLAY_TTL_MS) {
    return aliasOverlayCache.entries
  }
  const redis = getRedis()
  if (!redis) return aliasOverlayCache?.entries ?? []
  try {
    const raw = await redis.hgetall<Record<string, string>>('statsbot:aliases')
    const entries = Object.entries(raw ?? {}).map(([alias, mutantId]) => ({ alias, mutantId }))
    aliasOverlayCache = { entries, fetchedAt: Date.now() }
    return entries
  } catch {
    // Redis hiccup - serve the last good copy rather than losing every
    // live-added alias for this instance until the next successful fetch.
    return aliasOverlayCache?.entries ?? []
  }
}

export async function addAliasOverlay(alias: string, mutantId: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.hset('statsbot:aliases', { [alias]: mutantId })
    const existing = aliasOverlayCache?.entries.filter((e) => e.alias !== alias) ?? []
    aliasOverlayCache = { entries: [...existing, { alias, mutantId }], fetchedAt: Date.now() }
    return true
  } catch {
    return false
  }
}

// Exact match first; case-insensitive fallback against the live overlay so
// an admin who doesn't remember the exact casing they typed into
// ".добавить" isn't forced to run ".сокращения" first just to copy it back.
export async function removeAliasOverlay(
  alias: string,
): Promise<'removed' | 'not_found' | 'error'> {
  const redis = getRedis()
  if (!redis) return 'error'
  try {
    const entries = await getAliasOverlay()
    const target =
      entries.find((e) => e.alias === alias) ??
      entries.find((e) => e.alias.toLowerCase() === alias.toLowerCase())
    if (!target) return 'not_found'
    await redis.hdel('statsbot:aliases', target.alias)
    aliasOverlayCache = {
      entries: entries.filter((e) => e.alias !== target.alias),
      fetchedAt: Date.now(),
    }
    return 'removed'
  } catch {
    return 'error'
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
      redis
        .incr(`statsbot:total:${date}`)
        .then(() => redis.expire(`statsbot:total:${date}`, STATS_TTL_SECONDS)),
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
