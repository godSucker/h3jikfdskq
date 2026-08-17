// Геттер локализованного имени бокса для /boxes. RU остаётся как есть (raw
// name из boxes.json) - здесь только резолв для остальных 8 языков через
// официальную локализацию Kobojo (itemId - ключ, тот же приём, что
// resolveName() в scripts/build-boxes.ts). См. scripts/build-boxes-i18n.ts.
import boxesI18nRaw from '@/data/boxes-i18n.json'

type BoxI18n = Partial<Record<string, Partial<Record<string, string>>>>
const boxesI18n = boxesI18nRaw as BoxI18n

export function getBoxName(itemId: string, locale: string, ruFallback: string): string {
  if (locale === 'ru') return ruFallback
  return boxesI18n[itemId]?.[locale] ?? boxesI18n[itemId]?.en ?? ruFallback
}
