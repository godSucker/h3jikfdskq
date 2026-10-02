import localisationRu from '@/data/localisation_ru.txt'
export { getSkinName } from './skin-names'

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

// Прямой поиск по ключу игровой локализации (Building_*, Habitat_* и т.д.
// не покрыты словарём craft-simulator.ts, но есть тут как есть в игре).
export function getLocalisedName(key: string): string | null {
  return localisationDict[key] ?? null
}
