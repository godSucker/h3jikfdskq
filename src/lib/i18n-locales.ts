// Батч 11 (2): список локалей/путей вынесен в отдельный файл БЕЗ JSON-импортов
// и без "@/"-алиаса намеренно. middleware.ts (Vercel Routing Middleware) -
// это Edge Function, собирается отдельным строгим Node ESM (nodenext)
// бандлером, который не резолвит "@/"-алиас Vite/Astro и падает на прямом
// импорте JSON без import-атрибута (см. ошибку деплоя: "referencing
// unsupported modules: @/i18n/*.json"). i18n.ts (со словарями, зависит от
// JSON) и middleware.ts оба читают этот файл - единый источник правды без
// протаскивания JSON в Edge-бандл.

export const LOCALES = ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'

// Какие пути реально переведены (используется middleware.ts для авторедиректа
// и BaseLayout.astro для hreflang/og:locale/переключателя в шапке).
export const TRANSLATED_PATHS = ['/', '/mutants'] as const

// Локали с собственным src/i18n/{locale}.json (не через EN-фолбэк).
// de/pt/it/tr/nl уже маршрутизируются (страницы существуют, см. src/pages/{locale}/),
// но рендерятся через фолбэк - не рекламируем их поисковикам как отдельный
// язык, пока авторский текст не написан.
export const TRANSLATED_UI_LOCALES: readonly Locale[] = ['ru', 'en', 'es', 'fr']

// Цели авторедиректа middleware.ts по Accept-Language: все не-RU локали, для
// которых физически существуют страницы - даже те, что рендерятся через
// EN-фолбэк. Для читателя это лучше, чем остаться на RU.
export const REDIRECT_LOCALES: readonly Locale[] = LOCALES.filter((l) => l !== DEFAULT_LOCALE)
