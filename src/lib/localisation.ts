import localisationRu from '@/data/localisation_ru.txt'
import skinsI18n from '@/data/mutants/skins-i18n.json'
import type { Locale } from './i18n'

// skins.json хранит slug скина на английском (napr. "girl", "japan") - тот
// же ключ, что используется в игровой локализации, поэтому переводить можно
// прямым поиском по localisation_ru.txt ("girl;Хищницы").
const localisationDict: Record<string, string> = {}
for (const line of localisationRu.split('\n')) {
  const idx = line.indexOf(';')
  if (idx === -1) continue
  const key = line.slice(0, idx).trim().replace(/^﻿/, '')
  const value = line.slice(idx + 1).trim()
  if (key) localisationDict[key] = value
}

// Локализованное имя скина на 9 языках, см. scripts/sync-skin-names.ts.
// 31/61 слагов имеют официальный ключ (skins-i18n.json), остальные 30 -
// без источника перевода (не придуманы, см. память
// feedback-no-llm-authored-names) - для них возвращается null, вызывающий
// код падает на голый slug.
const SKINS_I18N = skinsI18n as Record<string, Partial<Record<Locale, string>>>

export function getSkinName(slug: string | null | undefined, locale: Locale): string | null {
  if (!slug) return null
  const dict = SKINS_I18N[slug]
  if (!dict) return null
  return dict[locale] ?? dict.en ?? dict.ru ?? null
}

// Прямой поиск по ключу игровой локализации (Building_*, Habitat_* и т.д.
// не покрыты словарём craft-simulator.ts, но есть тут как есть в игре).
export function getLocalisedName(key: string): string | null {
  return localisationDict[key] ?? null
}
