import ru from '@/i18n/ru.json'
import en from '@/i18n/en.json'
import es from '@/i18n/es.json'
import fr from '@/i18n/fr.json'

// Батч 11 (2): инфраструктура расширена на все 9 доступных на CDN Kobojo
// локалей игровых данных. Собственные UI-словари (src/i18n/{locale}.json)
// для de/pt/it/tr/nl ещё не написаны - это отдельный, дорогой этап перевода
// авторского текста. До этого страницы на этих локалях рендерятся через
// fallback-цепочку target -> en -> ru (см. FALLBACK_LOCALE ниже).
export const LOCALES = ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'
const FALLBACK_LOCALE: Locale = 'en'

const DICTS: Partial<Record<Locale, Record<string, string>>> = { ru, en, es, fr }

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value)
}

// Ключ/словарь отсутствует в языке -> fallback EN -> RU + громкое предупреждение
// при билде (см. Батч 11: "определённое поведение при отсутствующем ключе, не
// молчаливая дыра"). EN выбран промежуточным звеном цепочки осознанно: русская
// строка на немецкой/турецкой странице хуже английской.
export function t(key: string, locale: Locale): string {
  const value = DICTS[locale]?.[key]
  if (value !== undefined) return value
  if (locale !== DEFAULT_LOCALE) {
    console.warn(`[i18n] отсутствует ключ "${key}" в локали "${locale}", используется фолбэк`)
  }
  if (locale !== FALLBACK_LOCALE) {
    const enValue = DICTS[FALLBACK_LOCALE]?.[key]
    if (enValue !== undefined) return enValue
  }
  const fallback = DICTS[DEFAULT_LOCALE]?.[key]
  if (fallback === undefined) {
    console.warn(`[i18n] отсутствует ключ "${key}" даже в RU-словаре`)
    return key
  }
  return fallback
}

// RU: один/пять форм (один мутант/два мутантА/пять мутантОВ), EN/ES/FR: singular/plural.
export function pluralizeCount(n: number, locale: Locale): string {
  if (locale === 'ru') {
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 === 1 && mod100 !== 11) return t('mutants.count.one', locale)
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
      return t('mutants.count.few', locale)
    return t('mutants.count.many', locale)
  }
  return n === 1 ? t('mutants.count.one', locale) : t('mutants.count.other', locale)
}

// Локаль текущей страницы для .astro (Astro.currentLocale) и Svelte-компонентов
// (передаётся пропом сверху, т.к. Svelte-острова не видят Astro.currentLocale напрямую).
export function localeFromAstro(astroCurrentLocale: string | undefined): Locale {
  return isLocale(astroCurrentLocale) ? astroCurrentLocale : DEFAULT_LOCALE
}

export function localePrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`
}

// Единый источник правды (Батч 11 (2)): какие пути реально переведены и на
// какие локали у них есть АВТОРСКИЙ UI-словарь (не EN-фолбэк). Читается
// middleware.ts (авторедирект), BaseLayout.astro (hreflang/og:locale/
// переключатель в шапке). Расширять оба списка синхронно при переводе новой
// страницы/локали - раздельные копии этого списка исторически расходились.
export const TRANSLATED_PATHS = ['/', '/mutants'] as const

// Локали с собственным src/i18n/{locale}.json (не через FALLBACK_LOCALE).
// de/pt/it/tr/nl уже маршрутизируются (страницы существуют, см. src/pages/{locale}/),
// но рендерятся через EN-фолбэк - не рекламируем их поисковикам как отдельный
// язык, пока авторский текст не написан.
export const TRANSLATED_UI_LOCALES: readonly Locale[] = ['ru', 'en', 'es', 'fr']

// Цели авторедиректа middleware.ts по Accept-Language: все не-RU локали, для
// которых физически существуют страницы (см. src/pages/{locale}/) - даже те,
// что рендерятся через EN-фолбэк. Для читателя это лучше, чем остаться на RU.
export const REDIRECT_LOCALES: readonly Locale[] = LOCALES.filter((l) => l !== 'ru')
