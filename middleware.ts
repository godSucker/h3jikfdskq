// i18n-пилот (Батч 11): Vercel Routing Middleware (платформенный уровень, НЕ
// Astro middleware) - определяет язык на первом визите по Accept-Language и
// редиректит на /en /es /fr (RU остаётся без префикса, defaultLocale).
// Осознанно принятое архитектурное решение: единственный несатический
// компонент в иначе полностью статическом (prerender=true) сайте - см.
// разбор trade-off'ов в Батче 11 (Obsidian).
//
// Cookie "preferred_locale" ставится один раз при первом редиректе и потом
// навсегда отключает повторные проверки для этого браузера - чтобы ручной
// выбор языка через переключатель в шапке не перебивался повторным
// Accept-Language-редиректом на следующий визит.
//
// REDIRECT_LOCALES/TRANSLATED_PATHS импортируются из src/lib/i18n.ts - единый
// источник правды (Батч 11 (2)), общий с BaseLayout.astro. Раздельные копии
// этого списка исторически расходились.

import { REDIRECT_LOCALES, TRANSLATED_PATHS, type Locale } from './src/lib/i18n'

const COOKIE_NAME = 'preferred_locale'

function detectLocale(acceptLanguage: string): Locale | null {
  const lower = acceptLanguage.toLowerCase()
  // Простое сопоставление по первому подходящему языку в заголовке (без веса q) -
  // ищем по порядку в заголовке.
  const langs = lower.split(',').map((part) => part.split(';')[0].trim().slice(0, 2))
  for (const lang of langs) {
    if ((REDIRECT_LOCALES as readonly string[]).includes(lang)) return lang as Locale
  }
  return null
}

export default function middleware(request: Request): Response | undefined {
  const url = new URL(request.url)
  const { pathname } = url

  if (!(TRANSLATED_PATHS as readonly string[]).includes(pathname)) return undefined // остальной сайт пока RU-only

  const cookieHeader = request.headers.get('cookie') || ''
  if (cookieHeader.includes(`${COOKIE_NAME}=`)) return undefined // решение уже было принято

  const preferred = detectLocale(request.headers.get('accept-language') || '')
  if (!preferred) return undefined // RU или неизвестный язык - остаёмся на RU

  const redirectUrl = new URL(`/${preferred}${pathname === '/' ? '' : pathname}${url.search}`, url)
  const response = Response.redirect(redirectUrl, 307)
  response.headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${preferred}; Path=/; Max-Age=31536000; SameSite=Lax`,
  )
  return response
}

export const config = {
  matcher: ['/', '/mutants'],
}
