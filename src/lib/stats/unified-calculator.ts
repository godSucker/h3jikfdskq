/**
 * UNIFIED STATS CALCULATOR
 * Single source of truth for all mutant stat calculations
 */

export interface BaseStatsInput {
  hp?: number;
  atk1?: number;
  atk1r?: number;
  atk2?: number;
  atk2r?: number;
  speed?: number;
  spd?: number;
  silver?: number;
  abilityPct1?: number;
  abilityPct2?: number;
  hp_base?: number;
  atk1_base?: number;
  atk1p_base?: number;
  atk2_base?: number;
  atk2p_base?: number;
  speed_base?: number;
  bank_base?: number;
  lvl1?: { spd?: number };
  lvl30?: { spd?: number };
}

export interface CalculatedStats {
  hp: number;
  atk1: number;
  atk2: number;
  ability: number;
  speed: number;
  silver: number;
}

/**
 * Calculate final stats
 * @param baseStats Base stat values (supports both naming conventions)
 * @param level Current level (1-30)
 * @param starMultiplier Star rating multiplier (1.0, 1.1, 1.3, 1.75, 2.0)
 */
export function calculateFinalStats(
  baseStats: BaseStatsInput,
  level: number,
  starMultiplier?: number
): CalculatedStats {
  const multiplier = starMultiplier || 1;

  // Normalize input - support both naming conventions
  const hp = baseStats.hp ?? baseStats.hp_base ?? 0;
  const atk1 = baseStats.atk1 ?? baseStats.atk1_base ?? 0;
  const atk1r = baseStats.atk1r ?? baseStats.atk1p_base ?? atk1;
  const atk2 = baseStats.atk2 ?? baseStats.atk2_base ?? 0;
  const atk2r = baseStats.atk2r ?? baseStats.atk2p_base ?? atk2;

  const speed = baseStats.speed ?? baseStats.speed_base ??
                baseStats.spd ??
                baseStats.lvl1?.spd ??
                baseStats.lvl30?.spd ?? 0;

  const silver = baseStats.silver ?? baseStats.bank_base ?? 42;
  const abilityPct1 = baseStats.abilityPct1 ?? 0;
  const abilityPct2 = baseStats.abilityPct2 ?? 0;

  // Apply star multiplier to base stats
  const finalBaseHp = hp * multiplier;
  const finalBaseAtk1 = atk1 * multiplier;
  const finalBaseAtk1r = atk1r * multiplier;
  const finalBaseAtk2 = atk2 * multiplier;
  const finalBaseAtk2r = atk2r * multiplier;

  // Level scaling
  const levelScale = level / 10 + 0.9;

  const finalHp = finalBaseHp * levelScale;

  // ATK1: upgrades at level 10
  const activeBaseAtk1 = level < 10 ? finalBaseAtk1 : finalBaseAtk1r;
  const finalAtk1 = activeBaseAtk1 * levelScale;

  // ATK2: upgrades at level 15
  const activeBaseAtk2 = level < 15 ? finalBaseAtk2 : finalBaseAtk2r;
  const finalAtk2 = activeBaseAtk2 * levelScale;

  // Ability: switches at level 25
  const abilityPercent = level < 25 ? abilityPct1 : abilityPct2;
  const abilityValue = finalAtk1 * (Math.abs(abilityPercent) / 100);

  const finalSpeed = speed;
  const finalSilver = silver * level;

  return {
    hp: Math.round(finalHp),
    atk1: Math.round(finalAtk1),
    atk2: Math.round(finalAtk2),
    ability: Math.round(abilityValue),
    speed: finalSpeed,
    silver: Math.round(finalSilver),
  };
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
  };
  return multipliers[starTier as keyof typeof multipliers] ?? 1.0;
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
export const HP_OVERFLOW_THRESHOLD = 21_474_836;

/** Наибольший уровень, при котором итоговое HP ещё не переполняется (см. выше).
 *  hpAtBaseLevelScale - hp_base × starMultiplier × (1 + hpOrbPct/100), т.е. HP при
 *  levelScale=1 (до применения роста по уровню) - инверсия формулы `level/10+0.9`. */
export function maxLevelForHp(hpAtBaseLevelScale: number): number {
  if (!(hpAtBaseLevelScale > 0)) return 1;
  const level = 10 * (HP_OVERFLOW_THRESHOLD / hpAtBaseLevelScale - 0.9);
  return Math.max(1, Math.floor(level));
}
