/**
 * UNIFIED STATS CALCULATOR
 * Single source of truth for all mutant stat calculations
 */

import { ABILITY_UNLOCK_LEVELS, calculateExactStats, type UnlockLevels } from './stat-formula'

export interface BaseStatsInput {
  /** Per-mutant attack unlock levels (tag unlockAttack); default 1/5/10/15. */
  unlock?: Partial<UnlockLevels> | null
  /** Integer per-specimen bonus (0 for a plain mutant). */
  bonus?: number
  /**
   * GACHA mutants: raw (unadjusted) bases plus the gacha "passport" bonus. The
   * plain hp_base/atk*_base of such a mutant have the bonus baked in with
   * rounding (kept for rebalance diffs); with passport the exact game formula
   * is used instead (HP ~ LF - bonus, ATK ~ bonus + 100).
   */
  passport?: {
    bonus: number
    hp_base: number
    atk1_base: number
    atk1p_base: number
    atk2_base: number
    atk2p_base: number
  } | null
  hp?: number
  atk1?: number
  atk1r?: number
  atk2?: number
  atk2r?: number
  speed?: number
  spd?: number
  silver?: number
  abilityPct1?: number
  abilityPct2?: number
  hp_base?: number
  atk1_base?: number
  atk1p_base?: number
  atk2_base?: number
  atk2p_base?: number
  speed_base?: number
  bank_base?: number
  lvl1?: { spd?: number }
  lvl30?: { spd?: number }
}

export interface CalculatedStats {
  /** false below the level where attack 2 appears in the game (default 5). */
  atk2Unlocked?: boolean
  hp: number
  atk1: number
  atk2: number
  ability: number
  speed: number
  silver: number
}

/**
 * Calculate final stats.
 *
 * Delegates to the exact game formula in stat-formula.ts (integer math, one
 * floor, see there). The star multiplier is converted to the game's star factor
 * LF = round(multiplier * 100); `bonus` is the per-specimen integer bonus
 * (0 for a plain mutant) and `unlock` the mutant's own attack unlock levels
 * (default 1/5/10/15).
 *
 * @param baseStats Base stat values (supports both naming conventions)
 * @param level Current level (1-30)
 * @param starMultiplier Star rating multiplier (1.0, 1.1, 1.3, 1.75, 2.0)
 */
export function calculateFinalStats(
  baseStats: BaseStatsInput,
  level: number,
  starMultiplier?: number,
): CalculatedStats {
  const multiplier = starMultiplier || 1

  // GACHA passport: use the raw bases + integer bonus instead of the adjusted ones.
  const passport = baseStats.passport
  const bonus = passport ? passport.bonus : (baseStats.bonus ?? 0)

  // Normalize input - support both naming conventions
  const hp = passport ? passport.hp_base : (baseStats.hp ?? baseStats.hp_base ?? 0)
  const atk1 = passport ? passport.atk1_base : (baseStats.atk1 ?? baseStats.atk1_base ?? 0)
  const atk1r = passport
    ? passport.atk1p_base
    : (baseStats.atk1r ?? baseStats.atk1p_base ?? atk1)
  const atk2 = passport ? passport.atk2_base : (baseStats.atk2 ?? baseStats.atk2_base ?? 0)
  const atk2r = passport
    ? passport.atk2p_base
    : (baseStats.atk2r ?? baseStats.atk2p_base ?? atk2)

  const speed =
    baseStats.speed ??
    baseStats.speed_base ??
    baseStats.spd ??
    baseStats.lvl1?.spd ??
    baseStats.lvl30?.spd ??
    0

  const silver = baseStats.silver ?? baseStats.bank_base ?? 42
  const abilityPct1 = baseStats.abilityPct1 ?? 0
  const abilityPct2 = baseStats.abilityPct2 ?? 0

  const exact = calculateExactStats(
    {
      hp_base: hp,
      atk1_base: atk1,
      atk1p_base: atk1r,
      atk2_base: atk2,
      atk2p_base: atk2r,
      unlock: baseStats.unlock,
    },
    { lf: Math.round(multiplier * 100), bonus },
    level,
  )

  // Ability: switches at level 25. Nominal value = pct of the first attack;
  // in a fight the game takes the same share of the damage actually dealt,
  // always floored (FightTests::testShield/testRegen).
  const abilityPercent = level < ABILITY_UNLOCK_LEVELS.second ? abilityPct1 : abilityPct2
  const abilityValue = Math.floor((exact.atk1 * Math.abs(abilityPercent)) / 100)

  return {
    hp: exact.hp,
    atk1: exact.atk1,
    atk2: exact.atk2,
    ability: abilityValue,
    speed,
    // Silver per hour = bank x level (HabitatController::getCurrencyFromSpecimen).
    silver: Math.round(silver * level),
    atk2Unlocked: exact.atk2Unlocked,
  }
}

/**
 * Get star multiplier by tier
 */
export function getStarMultiplier(starTier: number): number {
  const multipliers = {
    0: 1.0, // normal
    1: 1.1, // bronze
    2: 1.3, // silver
    3: 1.75, // gold
    4: 2.0, // platinum
  }
  return multipliers[starTier as keyof typeof multipliers] ?? 1.0
}

/**
 * Реального лимита уровня в игре нет ("Уровень эво/мутанта/игрока - без лимита",
 * /guides "Скрытые лимиты чисел") - единственный настоящий потолок это int32-баг:
 * итоговое HP мутанта, посчитанное по формуле роста (base × star × (level/10+0.9)),
 * переполняется и уходит в минус выше ≈21 474 836 (≈2^31/100 - хранится как
 * fixed-point ×100), причём HP-сферы опускают порог ещё ниже. Порог считается
 * индивидуально на мутанта (влияют hp_base, звезда, HP-орбы). Используется и PvP-
 * калькулятором (fight-engine), и StatsCalculator - единый источник, чтобы не
 * разъезжались две копии одной и той же игровой константы.
 */
export const HP_OVERFLOW_THRESHOLD = 21_474_836

/** Наибольший уровень, при котором итоговое HP ещё не переполняется (см. выше).
 *  hpAtBaseLevelScale - hp_base × starMultiplier × (1 + hpOrbPct/100), т.е. HP при
 *  levelScale=1 (до применения роста по уровню) - инверсия формулы `level/10+0.9`. */
export function maxLevelForHp(hpAtBaseLevelScale: number): number {
  if (!(hpAtBaseLevelScale > 0)) return 1
  const level = 10 * (HP_OVERFLOW_THRESHOLD / hpAtBaseLevelScale - 0.9)
  return Math.max(1, Math.floor(level))
}
