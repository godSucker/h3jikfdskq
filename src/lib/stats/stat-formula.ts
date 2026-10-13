/**
 * THE exact stat formula of the game client - one implementation for base
 * mutants, GACHA mutants and skins (calculateFinalStats() and skin-stats.ts
 * both delegate here).
 *
 * Ported from libgame (Ghidra, SpecimenDefinitionHelper::getMaxLife /
 * getAttackDamages, ISpecimenModel::getMaxLife / getAttackDamages) and checked
 * against real in-game records and the game's own unit tests
 * (see Obsidian notes "Скины - формула статов, верификация 2026-10-14" and
 * "Декомпил - вопросы и хвосты").
 *
 *   HP  = floor(hpBase * (lvl*10+90) * (LF - bonus) / 10000)
 *         with orbs a SECOND floor: floor((100 + orbHp%) * HP / 100), min 1
 *   ATK = floor((100 + orbAtk%) * (bonus+100) * (lvl+9) * atk * LF / 10^7)
 *         one floor, orb percent inside it, saturates at INT32_MAX
 *
 * LF is the star factor x100 (0:100, 1:110, 2:130, 3:175, 4:200), `bonus` the
 * integer per-specimen bonus (0 for a plain mutant, the gacha line for a skin).
 * Everything is integer math with C truncation, i.e. floor for positive values.
 */

export const LEVEL_FACTOR_BY_STARS: Record<number, number> = {
  0: 100,
  1: 110,
  2: 130,
  3: 175,
  4: 200,
}

/** Star factor x100 for a star index. */
export function lfForStars(stars: number): number {
  return LEVEL_FACTOR_BY_STARS[stars] ?? 100
}

/**
 * Attack unlock levels. In the game they are a per-mutant tag
 * (`unlockAttack="1:1:a;2:5:neutre;1p:10:a;2p:15:neutre"`): 708 of 711 mutants
 * use 1 / 5 / 10 / 15, three (FD_07, DD_13, EA_99) have their own.
 */
export interface UnlockLevels {
  atk1: number
  atk2: number
  atk1p: number
  atk2p: number
}

export const DEFAULT_UNLOCK: UnlockLevels = { atk1: 1, atk2: 5, atk1p: 10, atk2p: 15 }

/** Ability unlock levels from miscsettings.xml (AbilitiesUnlockLevels). */
export const ABILITY_UNLOCK_LEVELS = { first: 4, second: 25 } as const

export function resolveUnlock(unlock?: Partial<UnlockLevels> | null): UnlockLevels {
  return { ...DEFAULT_UNLOCK, ...(unlock ?? {}) }
}

export interface ExactBase {
  hp_base: number
  atk1_base: number
  atk1p_base: number
  atk2_base: number
  atk2p_base: number
  unlock?: Partial<UnlockLevels> | null
}

export interface ExactParams {
  /** Star factor x100 (see lfForStars). */
  lf: number
  /** Integer per-specimen bonus. */
  bonus: number
}

export interface ExactOrbPercents {
  hpPct?: number
  atk1Pct?: number
  atk2Pct?: number
}

export interface ExactStats {
  hp: number
  atk1: number
  atk2: number
  /** false below the level where attack 2 appears in the game (default 5). */
  atk2Unlocked: boolean
}

const INT32_MAX = 2147483647n

/** HP before orbs - what SpecimenDefinitionHelper::getMaxLife returns. */
export function exactBaseHp(hpBase: number, params: ExactParams, level: number): number {
  return Math.floor((Math.round(hpBase) * (level * 10 + 90) * (params.lf - params.bonus)) / 10000)
}

/** HP at level 1 with no orbs. */
export function exactHpAtLevelOne(hpBase: number, params: ExactParams): number {
  return Math.floor((Math.round(hpBase) * (params.lf - params.bonus)) / 100)
}

export function exactAtk(
  atkBase: number,
  params: ExactParams,
  level: number,
  orbPct: number,
): number {
  // BigInt: at troll levels the product leaves the 2^53 safe-integer range.
  const product =
    BigInt(Math.round(100 + orbPct)) *
    BigInt(params.bonus + 100) *
    BigInt(level + 9) *
    BigInt(Math.round(atkBase)) *
    BigInt(params.lf)
  const value = product / 10_000_000n
  return Number(value > INT32_MAX ? INT32_MAX : value)
}

/** Which of atkN_base / atkNp_base is active at this level. */
export function activeAttackBase(base: ExactBase, slot: 1 | 2, level: number): number {
  const u = resolveUnlock(base.unlock)
  return slot === 1
    ? level >= u.atk1p
      ? base.atk1p_base
      : base.atk1_base
    : level >= u.atk2p
      ? base.atk2p_base
      : base.atk2_base
}

export function calculateExactStats(
  base: ExactBase,
  params: ExactParams,
  level: number,
  orbs: ExactOrbPercents = {},
): ExactStats {
  const hp0 = exactBaseHp(base.hp_base, params, level)
  const hpPct = orbs.hpPct ?? 0
  // ISpecimenModel::getMaxLife: (100 + orbs) * hp / 100, never below 1.
  const hp = hpPct ? Math.max(1, Math.floor(((100 + hpPct) * hp0) / 100)) : hp0
  return {
    hp,
    atk1: exactAtk(activeAttackBase(base, 1, level), params, level, orbs.atk1Pct ?? 0),
    atk2: exactAtk(activeAttackBase(base, 2, level), params, level, orbs.atk2Pct ?? 0),
    atk2Unlocked: level >= resolveUnlock(base.unlock).atk2,
  }
}
