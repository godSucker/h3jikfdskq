import type { LolsVerdict } from './policy'

// Публичная база спамеров LOLS. Проверено 2026-10-25: ключ не нужен,
// GET /account?id=<tg id> -> {"ok":true,"user_id":..,"banned":false}.
// CAS (api.cas.chat) теперь требует API-ключ, SpamWatch с нашей стороны не отвечал.
// Любой сбой (таймаут, не-JSON, неожиданная форма) - 'unknown': решение о бане
// никогда не принимается "по умолчанию", только по явному banned:true.
const LOLS_URL = 'https://api.lols.bot/account'

export async function checkLols(
  userId: number,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LolsVerdict> {
  const { fetchImpl = fetch, timeoutMs = 3000 } = opts
  try {
    const res = await fetchImpl(`${LOLS_URL}?id=${encodeURIComponent(String(userId))}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return 'unknown'
    const body = (await res.json()) as { ok?: unknown; banned?: unknown }
    if (body.ok !== true || typeof body.banned !== 'boolean') return 'unknown'
    return body.banned ? 'banned' : 'clean'
  } catch {
    return 'unknown'
  }
}
