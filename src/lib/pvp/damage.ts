/**
 * Формула урона - 1:1 с "Формула урона" на src/components/guides/GuidesBrowser.svelte
 * (L788-803), которая сама уже документирует FightUtils::fillAttackModel (RE):
 *
 *   1) базовый урон → крит (если сработал, ×2) → тип (±25%/±50%)
 *   2) отдельно: та же база → тот же крит → тот же тип → берётся % баффа от результата
 *   3) итог = результат (1) + результат (2)
 *
 * Пример с сайта: атака 10000, крит ×2, тип +25%, бафф +40%.
 * Ветка 1: 10000 → 20000 → 25000. Ветка 2: 10000 → 20000 → 25000 → ×40% = 10000.
 * Итог 35000 (не наивные 25000×1.4 "по счастливой случайности одинаковых чисел" -
 * при разных базах урона и баффа веерная формула даёт другой результат, чем
 * плоское умножение готового числа на процент).
 */

import { getTypeModifier, critChance, type Gene } from './type-table'

/** Эффективный крит-шанс атакующего против конкретной цели: свой крит-чарм/орбы + антикрит-чарм цели.
 *  Округляется до целого - rollCrit ниже сравнивает с ЦЕЛЫМ броском (Math.floor(rng()*100)),
 *  так что дробная часть формулы (см. GuidesBrowser.svelte, где она показана с 2 знаками для
 *  документации) всё равно не даёт более тонкой гранулярности броска - целое здесь честнее
 *  показывает, что реально влияет на исход. */
export function effectiveCritChance(
  attackerCritBonusPct: number,
  targetAnticritBonusPct: number,
): number {
  return Math.round(critChance(attackerCritBonusPct + targetAnticritBonusPct))
}

export function rollCrit(critChancePct: number, rng: () => number): boolean {
  const roll = Math.floor(rng() * 100)
  return roll < critChancePct
}

function applyCritAndType(
  base: number,
  crit: boolean,
  attackerGene: Gene,
  targetGene: Gene,
): { result: number; typeModPct: number } {
  const afterCrit = crit ? base * 2 : base
  const typeModPct = getTypeModifier(attackerGene, targetGene)
  return { result: afterCrit * (1 + typeModPct / 100), typeModPct }
}

export interface HitInput {
  baseDamage: number
  attackerGene: Gene
  targetGene: Gene
  crit: boolean
  /** % баффа strengthen/weaken атакующего на этот удар, если активен (см. CombatAbility.pct). */
  buffPct?: number
}

export interface HitResult {
  baseDamage: number
  mainDamage: number
  buffDamage: number
  totalDamage: number
  crit: boolean
  typeModPct: number
  /** % баффа, реально применённого к этому удару (undefined/0 если не активен) - для лога. */
  buffPct?: number
}

export function resolveHit(input: HitInput): HitResult {
  const { result: mainDamage, typeModPct } = applyCritAndType(
    input.baseDamage,
    input.crit,
    input.attackerGene,
    input.targetGene,
  )
  const buffDamage = input.buffPct ? mainDamage * (input.buffPct / 100) : 0
  return {
    baseDamage: input.baseDamage,
    mainDamage: Math.round(mainDamage),
    buffDamage: Math.round(buffDamage),
    totalDamage: Math.round(mainDamage + buffDamage),
    crit: input.crit,
    typeModPct,
    buffPct: input.buffPct,
  }
}
