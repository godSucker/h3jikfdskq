import type { Locale } from './i18n-locales'

// Тот же приём, что INTL_LOCALE в GuidesPage.astro/EvotechCalculator.svelte/
// MutantModal.svelte (дублировался по файлам) - единый источник тут, раз
// formatNumber() теперь locale-aware и используется в нескольких симуляторах.
export const INTL_LOCALE: Record<Locale, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  it: 'it-IT',
  tr: 'tr-TR',
  nl: 'nl-NL',
}

// Раньше был захардкожен на 'ru-RU' независимо от локали (найдено
// систематическим i18n-аудитом 2026-08-17) - числа в Cash/Lucky/Madness
// рулетках рендерились с русской группировкой разрядов на всех 9 языках.
export function formatNumber(value: number, locale: Locale = 'ru'): string {
  return Math.floor(value).toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU')
}

export function pluralize(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const lastDigit = abs % 10
  if (abs > 10 && abs < 20) return many
  if (lastDigit > 1 && lastDigit < 5) return few
  if (lastDigit === 1) return one
  return many
}

/**
 * Базовый id мутанта: нижний регистр, срезан суффикс звезды и всё после него.
 * 'specimen_a_01_platinum' -> 'specimen_a_01'; префикс specimen_ сохраняется.
 * Единая замена локальным baseId()-копиям в компонентах.
 */
export function baseMutantId(id: unknown): string {
  return String(id ?? '')
    .toLowerCase()
    .replace(/_+(?:normal|bronze|silver|gold|platinum|plat).*$/i, '')
}

/**
 * Группирует записи skins.json по базовому id мутанта.
 * Общий хелпер для всех мест, монтирующих MutantModal (skins-проп).
 */
export function buildSkinLookup(skins: unknown[]): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>()
  for (const skin of Array.isArray(skins) ? skins : []) {
    const key = baseMutantId((skin as { id?: unknown })?.id)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(skin)
  }
  return map
}

export function normalizeMutantId(specimenId: string): {
  folder: string
  fileId: string
  baseId: string
} {
  if (!specimenId) return { folder: '', fileId: '', baseId: '' }

  let cleaned = specimenId.replace(/^Specimen_/i, '')
  cleaned = cleaned.replace(/_(normal|bronze|silver|gold|platinum)$/i, '')

  if (!cleaned) return { folder: '', fileId: '', baseId: '' }

  const baseId = cleaned
  const folder = cleaned.toLowerCase()
  const fileId = cleaned.toLowerCase()
  return { folder, fileId, baseId }
}
