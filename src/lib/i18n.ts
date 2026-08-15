import ru from '@/i18n/ru.json'
import en from '@/i18n/en.json'
import es from '@/i18n/es.json'
import fr from '@/i18n/fr.json'
import de from '@/i18n/de.json'
import pt from '@/i18n/pt.json'
import it from '@/i18n/it.json'
import tr from '@/i18n/tr.json'
import nl from '@/i18n/nl.json'
import {
  LOCALES,
  type Locale,
  DEFAULT_LOCALE,
  TRANSLATED_PATHS,
  TRANSLATED_UI_LOCALES,
  REDIRECT_LOCALES,
  isTranslatedPath,
} from './i18n-locales'

// Батч 11 (2): инфраструктура расширена на все 9 доступных на CDN Kobojo
// локалей игровых данных. Собственные UI-словари (src/i18n/{locale}.json)
// для de/pt/it/tr/nl написаны 2026-08-15 (см. память
// i18n-next-session-plan-2026-08-15) - до этого рендерились через
// fallback-цепочку target -> en -> ru (см. FALLBACK_LOCALE ниже), теперь
// это только фолбэк для непереведённых страниц вне Главной/mutants.
// LOCALES/DEFAULT_LOCALE/TRANSLATED_PATHS/TRANSLATED_UI_LOCALES/REDIRECT_LOCALES
// переэкспортируются из i18n-locales.ts (единый источник, читает и middleware.ts).
export {
  LOCALES,
  type Locale,
  DEFAULT_LOCALE,
  TRANSLATED_PATHS,
  TRANSLATED_UI_LOCALES,
  REDIRECT_LOCALES,
  isTranslatedPath,
}
const FALLBACK_LOCALE: Locale = 'en'

const DICTS: Partial<Record<Locale, Record<string, string>>> = {
  ru,
  en,
  es,
  fr,
  de,
  pt,
  it,
  tr,
  nl,
}

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

// Путь префиксуется локалью ТОЛЬКО если у него реально есть per-locale
// страница (TRANSLATED_PATHS) - иначе переход с /de/... на, скажем,
// /materials сбросит пользователя на RU (страницы /de/materials не
// существует). Общий хелпер для BaseLayout.astro и любых других мест,
// где строится ссылка на один из известных путей сайта (см. коммит
// 986395357, баг с /mutants без префикса, больше не чинить точечно).
export function translatedHref(path: string, locale: Locale): string {
  return isTranslatedPath(path) ? `${localePrefix(locale)}${path}` : path
}
