// Локализация авторского прозового контента /guides, который слишком
// объёмный для плоских ключей src/i18n/*.json (297 квестов, фермеры,
// лор локаций дивизионов) - см. память guides-i18n-plan-2026-08-15.
// Квесты сведены к шаблонам (число -> {0},{1},...), чтобы не дублировать
// перевод 297 раз при 168 уникальных формулировках подписи.
import contentI18n from '@/data/guides/content-i18n.json'
import type { Locale } from './i18n'

interface FarmerText {
  price: string
  verdict: string
}

interface LocationText {
  name: string
  lore: string
}

interface ContentI18n {
  farmers: Record<string, Partial<Record<Locale, FarmerText>>>
  locations: Record<string, Partial<Record<Locale, LocationText>>>
  questTitles: Record<string, Partial<Record<Locale, string>>>
  questCaptionTemplates: Record<string, Partial<Record<Locale, string>>>
}

const data = contentI18n as ContentI18n

// Совпадает с логикой extract_quest_templates.py: любой прогон цифр (с
// пробелами/запятыми/точками внутри, напр. "2 147 483 647" или "1,5")
// заменяется на позиционный плейсхолдер.
const NUMBER_RUN = /\d[\d\s,.]*\d|\d/g

export function templatizeCaption(caption: string): { template: string; numbers: string[] } {
  const numbers: string[] = []
  const template = caption.replace(NUMBER_RUN, (m) => {
    numbers.push(m.trim())
    return `{${numbers.length - 1}}`
  })
  return { template, numbers }
}

export function getFarmerText(firstId: string, locale: Locale, fallback: FarmerText): FarmerText {
  if (locale === 'ru') return fallback
  return data.farmers[firstId]?.[locale] ?? fallback
}

export function getLocationText(
  mapId: string,
  locale: Locale,
  fallback: LocationText,
): LocationText {
  if (locale === 'ru') return fallback
  return data.locations[mapId]?.[locale] ?? fallback
}

export function getQuestText(
  title: string,
  caption: string,
  locale: Locale,
): { title: string; caption: string } {
  if (locale === 'ru') return { title, caption }
  const tTitle = data.questTitles[title]?.[locale] ?? title
  const { template, numbers } = templatizeCaption(caption)
  const tTemplate = data.questCaptionTemplates[template]?.[locale]
  if (!tTemplate) return { title: tTitle, caption }
  const tCaption = numbers.reduce((acc, n, i) => acc.replace(`{${i}}`, n), tTemplate)
  return { title: tTitle, caption: tCaption }
}
