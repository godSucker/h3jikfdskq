/**
 * Цвет по гену - переиспользует существующую палитру TierList.svelte (GENE_COLORS,
 * ~L75-82) для консистентности с /tier-list, а не изобретает новую. В остальном
 * сайте гены различаются только иконками (mutant-icons.ts) - эта палитра единственная
 * найденная в кодовой базе, где гену сопоставлен именно цвет.
 */

import type { Gene } from './type-table'

export const GENE_HEX: Record<Gene, string> = {
  A: '#c8a200',
  B: '#5a7a1a',
  C: '#a04040',
  D: '#a07228',
  E: '#3a6aa8',
  F: '#7b4fa0',
  neutro: '#555555',
}

/** Общий статический класс (цвет идёт через style, см. geneButtonStyle) -
 *  динамическая Tailwind-арбитрари `bg-[${hex}]` не будет подхвачена сборщиком,
 *  т.к. сканер ищет буквальные классы в исходниках, а не то, что склеится в рантайме. */
export const GENE_BUTTON_BASE_CLASS = 'text-white hover:brightness-125 transition-[filter]'

export function geneBgHex(gene: Gene | string | undefined): string {
  const g = String(gene || '').toUpperCase()
  return GENE_HEX[g in GENE_HEX ? (g as Gene) : 'neutro']
}

/**
 * Приглушённый стиль по гену для кнопок атак - тот же принцип, что у бейджа
 * тира в TeamBuilder.svelte (полупрозрачная заливка + цветное кольцо, а не
 * сплошная "едкая" заливка), но с белым текстом (не цветным, как у тира) -
 * это кликабельная кнопка действия, а не пассивный бейдж, читаемость важнее
 * точного попадания в тот же паттерн. `1e`/`99` - hex-альфа (~12%/~60%).
 */
export function geneButtonStyle(gene: Gene | string | undefined): string {
  const hex = geneBgHex(gene)
  return `background-color:${hex}1e; box-shadow: inset 0 0 0 1.5px ${hex}99;`
}
