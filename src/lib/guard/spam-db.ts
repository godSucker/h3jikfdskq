import { checkLols } from './lols'
import type { LolsVerdict } from './policy'

// Несколько баз спамеров под одним вердиктом. Сейчас всегда работает LOLS (ключ не
// нужен); SpamWatch включается, только если задан токен (SPAMWATCH_TOKEN). CAS без
// ключа отвечает 401 (проверено 2026-11-08), поэтому его здесь нет.
export interface SpamCheck {
  verdict: LolsVerdict
  // Какие базы участвовали ("LOLS", "LOLS+SpamWatch"), а при бане - какие нашли.
  source: string
}

interface Answer {
  name: string
  verdict: LolsVerdict
}

// Бан, если хоть одна база нашла; чист, только если ответили все и никто не нашёл;
// любое молчание (таймаут, ошибка) оставляет вердикт "нет ответа", а не "чист".
export function combineAnswers(answers: Answer[]): SpamCheck {
  const hit = answers.filter((a) => a.verdict === 'banned')
  if (hit.length) return { verdict: 'banned', source: hit.map((a) => a.name).join('+') }
  const source = answers.map((a) => a.name).join('+')
  if (answers.length && answers.every((a) => a.verdict === 'clean')) {
    return { verdict: 'clean', source }
  }
  return { verdict: 'unknown', source }
}

// SpamWatch: GET /banlist/<id> с Bearer-токеном. 200 + тот же id в теле = в базе,
// 404 = нет. Формат взят из документации SpamWatch и на живом токене НЕ проверялся,
// поэтому любое отклонение (другой id, не JSON, другой код) - "нет ответа", а не бан.
export async function checkSpamWatch(
  userId: number,
  token: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LolsVerdict> {
  const { fetchImpl = fetch, timeoutMs = 3000 } = opts
  try {
    const res = await fetchImpl(
      `https://api.spamwat.ch/banlist/${encodeURIComponent(String(userId))}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
    if (res.status === 404) return 'clean'
    if (!res.ok) return 'unknown'
    const body = (await res.json()) as { id?: unknown }
    return body.id === userId ? 'banned' : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function createSpamChecker(
  opts: { spamwatchToken?: string; fetchImpl?: typeof fetch } = {},
): (userId: number) => Promise<SpamCheck> {
  const { spamwatchToken, fetchImpl } = opts
  return async (userId) => {
    const jobs: Promise<Answer>[] = [
      checkLols(userId, { fetchImpl }).then((verdict) => ({ name: 'LOLS', verdict })),
    ]
    if (spamwatchToken) {
      jobs.push(
        checkSpamWatch(userId, spamwatchToken, { fetchImpl }).then((verdict) => ({
          name: 'SpamWatch',
          verdict,
        })),
      )
    }
    return combineAnswers(await Promise.all(jobs))
  }
}
