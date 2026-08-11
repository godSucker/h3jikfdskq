import type { APIRoute } from 'astro'

const ALLOWED_PREFIXES = [
  'https://cdn.archivist-library.com/',
  'https://s-ak.kobojo.com/',
  'https://s-beta.kobojo.com/',
]

export const GET: APIRoute = async ({ url }) => {
  const targetUrl = url.searchParams.get('url')
  if (!targetUrl) {
    return new Response('Missing url param', { status: 400 })
  }

  if (!ALLOWED_PREFIXES.some((p) => targetUrl.startsWith(p))) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    // Referer обязателен: бакет CDN отдаёт объекты только по allowlist рефереров
    // (защита от перебора). Серверный fetch по умолчанию Referer не шлёт -> 403.
    // redirect: 'manual' - fetch по умолчанию сам идёт по 3xx, а конечный URL
    // после редиректа уже не проверяется ALLOWED_PREFIXES (SSRF-обход
    // allowlist через редирект с разрешённого хоста на произвольный).
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://archivist-library.com/',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    })
    if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
      return new Response('Redirects not allowed', { status: 502 })
    }
    if (!resp.ok) {
      return new Response(`Upstream ${resp.status}`, { status: resp.status })
    }

    const contentType = resp.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      return new Response('Upstream did not return an image', { status: 502 })
    }

    const data = await resp.arrayBuffer()

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response('Proxy error', { status: 502 })
  }
}
