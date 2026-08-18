// SSR (не prerender) - нужен реальный Host запроса, чтобы отличить канонический
// домен от дублей. У проекта в Vercel привязаны archivist-library.com,
// www.archivist-library.com и preview.archivist-library.com - все три отвечали
// одинаковым "Allow: /" (см. GSC: 33 страницы "canonical mismatch" - Google
// индексировал www/preview как отдельные копии сайта). Разрешаем индексацию
// только на каноническом apex-домене, остальные хосты получают Disallow: /.
export const prerender = false

const CANONICAL_HOST = 'archivist-library.com'

export async function GET({ url }: { url: URL }) {
  const isCanonical = url.hostname === CANONICAL_HOST
  const body = isCanonical
    ? [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /panel-render',
        '',
        `Sitemap: https://${CANONICAL_HOST}/sitemap-index.xml`,
        '',
      ].join('\n')
    : ['User-agent: *', 'Disallow: /', ''].join('\n')

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
