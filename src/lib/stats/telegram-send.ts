// Thin Telegram Bot API caller for the stats bot.
//
// Sending is NOT idempotent: if a request timed out or came back 5xx, Telegram
// may well have processed it anyway (live-caught 2026-11-15: sendPhoto answered
// slower than our timeout, the retries delivered the card three times). So a
// call is repeated only when it provably never reached Telegram's handlers:
//   - 429: explicitly rejected, with a (short) retry_after;
//   - the connection was never established (refused / DNS / connect timeout).
// Timeouts, resets and 5xx are thrown at once - the caller tells the user to
// try again, which costs a click instead of a duplicate.

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} failed: ${status} ${body}`)
  }

  // The message we reply to was deleted while the card was rendering.
  get replyTargetGone(): boolean {
    return this.status === 400 && /message to be replied not found/i.test(this.body)
  }
}

const ATTEMPTS = 3
const SLOW_CALL_MS = 5000
const RETRY_DELAY_MS = 600
const MAX_RETRY_AFTER_S = 2
const NEVER_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
])

function neverReachedTelegram(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null)?.code ?? ''
  return (
    NEVER_SENT_CODES.has(code(err)) ||
    NEVER_SENT_CODES.has(code((err as { cause?: unknown })?.cause))
  )
}

export async function telegramCall(
  botToken: string,
  method: string,
  init: { body: BodyInit; headers?: Record<string, string> },
  timeoutMs: number,
  detail = '',
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    let delayMs = RETRY_DELAY_MS * attempt
    let failure: unknown
    let safeToRetry = false
    const started = Date.now()
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        ...init,
        // Fresh connection per call: a warm Vercel instance may hold a pooled
        // socket Telegram dropped long ago, and a POST on it hangs silently
        // until our timeout (suspected 2026-11-16: 98-144KB sendPhoto stalled
        // the full 30s and the card never arrived). Costs one TLS handshake.
        headers: { ...init.headers, connection: 'close' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) {
        const ms = Date.now() - started
        if (ms > SLOW_CALL_MS) console.warn(`telegram ${method} slow: ${ms}ms ${detail}`.trim())
        return
      }
      const body = await res.text().catch(() => '')
      failure = new TelegramApiError(method, res.status, body)
      if (res.status === 429) {
        const wait = Number(/"retry_after":\s*(\d+)/.exec(body)?.[1])
        if (!(wait > MAX_RETRY_AFTER_S)) {
          safeToRetry = true
          if (wait) delayMs = wait * 1000
        }
      }
    } catch (err) {
      failure = err
      safeToRetry = neverReachedTelegram(err)
    }
    // One line per failed attempt: how fast Telegram answered (a 250ms 500 and a
    // 30s timeout are different incidents) and how big the upload was.
    const reason =
      failure instanceof TelegramApiError
        ? `status ${failure.status}`
        : `${(failure as Error)?.name ?? 'error'} ${(failure as { cause?: { code?: string } })?.cause?.code ?? ''}`.trim()
    console.warn(
      `telegram ${method} failed: ${reason} after ${Date.now() - started}ms, attempt ${attempt}/${ATTEMPTS}, retry ${safeToRetry} ${detail}`.trim(),
    )
    if (!safeToRetry || attempt >= ATTEMPTS) throw failure
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}
