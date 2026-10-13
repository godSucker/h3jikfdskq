/**
 * Формула удара - точный порт FightUtils::fillAttackModel (Ghidra), ВСЯ арифметика
 * целочисленная int32 с отбрасыванием дробной части к нулю (так делит C++), а не float
 * с округлением:
 *
 *   d1 = base + base * crit% / 100            (crit% = 100 при крите, иначе 0)
 *   d2 = d1   + d1   * typeMod% / 100         (typeMod: +-25/+-50 из таблицы типов)
 *   бафф (strengthen/weaken) - ОТДЕЛЬНАЯ ветка с теми же шагами от той же базы:
 *   b1 = base + base * crit% / 100;  b2 = b1 + b1 * typeMod% / 100
 *   вклад баффа = b2 * бафф% / 100
 *   итог = max(0, d2 + вклад баффа)
 *
 * Оракул - юнит-тесты самой игры (FightTests::testRegen): атака 414, тип +25% даёт 517
 * (414 + trunc(103.5)), а не 518 как у Math.round.
 *
 * Шанс крита (целое): (5 * (чармы + сферы + 100) + 99) / 100 - ПОТОЛОК, бросок
 * random(0..99) < шанса. Константы 5 и 100 - randomValueForCritical и
 * damagesPercentForCritical из fightsettings.xml.
 */

import { getTypeModifier, type Gene } from './type-table'

/** randomValueForCritical (fightsettings.xml): базовый шанс крита, %. */
export const CRIT_BASE_CHANCE = 5
/** damagesPercentForCritical (fightsettings.xml): прибавка урона при крите, %. */
export const CRIT_DAMAGE_PCT = 100

/** Эффективный крит-шанс атакующего против конкретной цели: свой крит-чарм/орбы + антикрит-чарм
 *  цели. Целое, с округлением ВВЕРХ - ровно как считает клиент игры. */
export function effectiveCritChance(
  attackerCritBonusPct: number,
  targetAnticritBonusPct: number,
): number {
  return Math.trunc(
    (CRIT_BASE_CHANCE * (attackerCritBonusPct + targetAnticritBonusPct + 100) + 99) / 100,
  )
}

export function rollCrit(critChancePct: number, rng: () => number): boolean {
  const roll = Math.floor(rng() * 100)
  return roll < critChancePct
}

/** C-style `value * percent / 100` in int32: truncates toward zero. */
function pctOf(value: number, percent: number): number {
  return Math.trunc((value * percent) / 100)
}

/** base -> crit -> type, the way one branch of fillAttackModel does it. */
function critThenType(base: number, critPct: number, typeModPct: number): number {
  const afterCrit = base + pctOf(base, critPct)
  return afterCrit + pctOf(afterCrit, typeModPct)
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
  const typeModPct = getTypeModifier(input.attackerGene, input.targetGene)
  const critPct = input.crit ? CRIT_DAMAGE_PCT : 0
  const mainDamage = critThenType(input.baseDamage, critPct, typeModPct)
  // Ветка баффа стартует от той же базы, что и основная (в игре может быть унаследованное
  // значение прошлого хода - здесь не моделируется), поэтому её b2 == mainDamage.
  const buffDamage = input.buffPct ? pctOf(mainDamage, input.buffPct) : 0
  return {
    baseDamage: input.baseDamage,
    mainDamage,
    buffDamage,
    totalDamage: Math.max(0, mainDamage + buffDamage),
    crit: input.crit,
    typeModPct,
    buffPct: input.buffPct,
  }
}
