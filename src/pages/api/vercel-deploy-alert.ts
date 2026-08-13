import type { APIRoute } from 'astro'

// Vercel Webhooks (Account Settings -> Webhooks, НЕ то же самое, что Deploy
// Hooks) шлёт events типа "deployment.succeeded"/"deployment.error" на этот
// URL, подписывая тело HMAC-SHA1 секретом, который задаётся при создании
// вебхука в Vercel. Пересылаем результат в тот же Telegram-бот, что и
// остальные алерты (uptime-alert.ts, spend-alert.ts). Шлём алерты и для
// прода, и для превью-деплоев (веток) - с явной пометкой в тексте, чтобы
// не перепутать по одному только сообщению.
export const POST: APIRoute = async ({ request }) => {
  const BOT_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN
  const CHAT_ID = import.meta.env.TELEGRAM_CHAT_ID
  const WEBHOOK_SECRET = import.meta.env.VERCEL_WEBHOOK_SECRET

  if (!WEBHOOK_SECRET) {
    console.error('VERCEL_WEBHOOK_SECRET is not configured — endpoint disabled')
    return new Response('Not configured', { status: 503 })
  }
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured')
    return new Response('Not configured', { status: 503 })
  }

  const rawBody = await request.text()

  const signature = request.headers.get('x-vercel-signature') ?? ''
  const crypto = await import('node:crypto')
  const expected = crypto.createHmac('sha1', WEBHOOK_SECRET).update(rawBody).digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)
  if (!valid) {
    return new Response('Forbidden', { status: 403 })
  }

  let payload: {
    type?: string
    payload?: { target?: string | null }
  } = {}
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const type = payload.type ?? ''
  if (type !== 'deployment.succeeded' && type !== 'deployment.error') {
    return new Response('OK (ignored event type)', { status: 200 })
  }

  // target лежит прямо в payload.payload.target, а НЕ в payload.payload.deployment.target.
  // Vercel отдаёт "production" для прод-деплоев и null для всех остальных
  // (превью на любую другую ветку/PR) - проверено на реальном деплое ветки
  // preview. Раньше всё не-production молча игнорировалось (без уведомления);
  // теперь шлём и то, и то, но с явной пометкой среды. Без ссылки/ветки в тексте
  // по запросу — только короткий статус.
  const isProd = payload.payload?.target === 'production'
  const envLabel = isProd ? 'прод' : 'превью'
  const verb = type === 'deployment.succeeded' ? 'прошёл успешно' : 'упал с ошибкой'

  const text = `Деплой на ${envLabel} ${verb}`

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  })

  return new Response('OK', { status: 200 })
}
