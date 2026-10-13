/**
 * Exact stat formula for reactor/event SKIN specimens - a thin wrapper over the
 * shared game formula in stat-formula.ts (stars index -> LF, gacha bonus).
 * Deliberately NOT calculateFinalStats() with a star multiplier: a skin's star
 * factor and bonus are one integer formula, not a multiplier on top.
 */
import {
  calculateExactStats,
  exactBaseHp,
  exactHpAtLevelOne,
  lfForStars,
  type ExactBase,
  type ExactOrbPercents,
} from './stat-formula'

export { LEVEL_FACTOR_BY_STARS as SKIN_LEVEL_FACTOR } from './stat-formula'

export type SkinBaseStats = ExactBase
export type SkinOrbPercents = ExactOrbPercents

export interface SkinParams {
  stars: number
  bonus: number
}

export interface SkinStats {
  hp: number
  atk1: number
  atk2: number
  atk2Unlocked: boolean
}

/** HP before orbs - what the game's SpecimenDefinitionHelper::getMaxLife returns. */
export function skinBaseHp(hpBase: number, skin: SkinParams, level: number): number {
  return exactBaseHp(hpBase, { lf: lfForStars(skin.stars), bonus: skin.bonus }, level)
}

/** HP at level 1 with no orbs - what skins.json calls lvl1.hp. */
export function skinEffectiveHpBase(hpBase: number, skin: SkinParams): number {
  return exactHpAtLevelOne(hpBase, { lf: lfForStars(skin.stars), bonus: skin.bonus })
}

export function calculateSkinStats(
  base: SkinBaseStats,
  skin: SkinParams,
  level: number,
  orbs: SkinOrbPercents = {},
): SkinStats {
  return calculateExactStats(base, { lf: lfForStars(skin.stars), bonus: skin.bonus }, level, orbs)
}
