// Геттеры локализованных данных для /materials. RU остаётся как есть в
// исходных json (raw name/description) - здесь только фолбэк-резолв для
// остальных 8 языков. См. scripts/build-materials-i18n.ts,
// build-sources-where-i18n.ts, build-zones-i18n.ts - как генерируются
// *-i18n.json файлы ниже.
import materialsI18nRaw from '@/data/materials/materials-i18n.json'
import sourcesWhereI18nRaw from '@/data/materials/sources-where-i18n.json'
import zonesI18nRaw from '@/data/materials/zones-i18n.json'

type ItemI18n = Partial<Record<string, Partial<Record<string, { name?: string; description?: string }>>>>
const materialsI18n = materialsI18nRaw as ItemI18n
const sourcesWhereI18n = sourcesWhereI18nRaw as Partial<Record<string, Record<string, string>>>
const zonesI18n = zonesI18nRaw as Partial<
  Record<string, Record<string, { name: string; description: string }>>
>

export function getItemName(id: string, locale: string, ruFallback: string): string {
  if (locale === 'ru') return ruFallback
  return materialsI18n[locale]?.[id]?.name ?? materialsI18n.en?.[id]?.name ?? ruFallback
}

export function getItemDescription(id: string, locale: string, ruFallback: string): string {
  if (locale === 'ru') return ruFallback
  return (
    materialsI18n[locale]?.[id]?.description ?? materialsI18n.en?.[id]?.description ?? ruFallback
  )
}

export function getSourceWhere(ruWhere: string, locale: string): string {
  if (locale === 'ru') return ruWhere
  return sourcesWhereI18n[locale]?.[ruWhere] ?? ruWhere
}

export function getZoneName(file: string, locale: string, ruFallback: string): string {
  if (locale === 'ru') return ruFallback
  return zonesI18n[locale]?.[file]?.name ?? ruFallback
}

export function getZoneDescription(file: string, locale: string, ruFallback: string): string {
  if (locale === 'ru') return ruFallback
  return zonesI18n[locale]?.[file]?.description ?? ruFallback
}
