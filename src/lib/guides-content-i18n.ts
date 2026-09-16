// Локализация авторского прозового контента /guides, который слишком
// объёмный для плоских ключей src/i18n/*.json (фермеры, лор локаций
// дивизионов) - см. память guides-i18n-plan-2026-08-15. Квесты отсюда ушли
// 2026-09-17: build-quests.ts кладёт их тексты сразу на 9 языках из
// официальной локализации Kobojo.
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
  dungeonNames: Record<string, Partial<Record<Locale, string>>>
  specialOfferNames: Record<string, Partial<Record<Locale, string>>>
}

const data = contentI18n as ContentI18n

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

// dungeonId для special-ladders включает группу-префикс ("experiment/..."
// / "challenge/..."), чтобы избежать коллизий id между experiment и
// challenge (ключи в исходных json пересекаются, напр. jungle_bells_1).
export function getDungeonName(dungeonId: string, locale: Locale, fallback: string): string {
  if (locale === 'ru') return fallback
  return data.dungeonNames[dungeonId]?.[locale] ?? fallback
}

// Официальные игровые названия (localisation_{lang}.txt на CDN Kobojo),
// не куратор-текст - извлечены напрямую скриптом, не LLM.
export function getSpecialOfferName(offerId: string, locale: Locale, fallback: string): string {
  if (locale === 'ru') return fallback
  return data.specialOfferNames[offerId]?.[locale] ?? fallback
}

