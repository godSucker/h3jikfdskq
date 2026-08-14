import ru from '@/i18n/ru.json'
import en from '@/i18n/en.json'
import es from '@/i18n/es.json'
import fr from '@/i18n/fr.json'

export const LOCALES = ['ru', 'en', 'es', 'fr'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'

const DICTS: Record<Locale, Record<string, string>> = { ru, en, es, fr }

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value)
}

// Ключ отсутствует в языке -> fallback на RU + громкое предупреждение при билде
// (см. Батч 11: "определённое поведение при отсутствующем ключе, не молчаливая дыра").
export function t(key: string, locale: Locale): string {
  const value = DICTS[locale]?.[key]
  if (value !== undefined) return value
  if (locale !== DEFAULT_LOCALE) {
    console.warn(`[i18n] отсутствует ключ "${key}" в локали "${locale}", используется RU-фолбэк`)
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
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return t('mutants.count.few', locale)
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
