/**
 * Таблица преимуществ типов (StrengthsAndWeaknesses::getDamageModifier) и формула
 * крит-шанса. Значения продублированы из src/components/guides/GuidesBrowser.svelte
 * (строки ~150-172) - там это уже задокументировано и подтверждено RE, здесь просто
 * переиспользуется как источник истины для боевого движка. Строка = атакующий,
 * столбец = защищающийся, значение = модификатор урона в %.
 */

export type Gene = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'neutro'

export const GENE_LETTERS: Exclude<Gene, 'neutro'>[] = ['A', 'B', 'C', 'D', 'E', 'F']

export const GENE_LABEL: Record<Exclude<Gene, 'neutro'>, string> = {
  A: 'Киборг',
  B: 'Нежить',
  C: 'Рубака',
  D: 'Зверь',
  E: 'Галактик',
  F: 'Мифик',
}

export const TYPE_TABLE: Record<Exclude<Gene, 'neutro'>, Record<Exclude<Gene, 'neutro'>, number>> = {
  A: { A: 0, B: -25, C: 25, D: 50, E: -50, F: 0 },
  B: { A: 25, B: 0, C: -25, D: 0, E: 50, F: -50 },
  C: { A: -25, B: 25, C: 0, D: -50, E: 0, F: 50 },
  D: { A: -50, B: 0, C: 50, D: 0, E: -25, F: 25 },
  E: { A: 50, B: -50, C: 0, D: 25, E: 0, F: -25 },
  F: { A: 0, B: 50, C: -50, D: -25, E: 25, F: 0 },
}

/** Модификатор урона в % атакующего гена против гена цели. "neutro"-атаки (второй ген части атак) не имеют типа. */
export function getTypeModifier(attackerGene: Gene, targetGene: Gene): number {
  if (attackerGene === 'neutro' || targetGene === 'neutro') return 0
  return TYPE_TABLE[attackerGene][targetGene]
}

/** Крит-шанс = 5% × (100 + чармДан% + чармПолучен% + орбБонус%) / 100 */
export function critChance(bonusPct: number): number {
  return (5 * (100 + bonusPct)) / 100
}
