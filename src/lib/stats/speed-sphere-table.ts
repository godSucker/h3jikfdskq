/**
 * SPEED SPHERE LOOKUP TABLE
 * ========================
 * The game uses an irregular lookup table for Speed Sphere calculations instead of
 * standard percentage math. This table contains the exact values for each base speed
 * at sphere levels 3, 4, and 5 (+10%, +15%, +20% respectively).
 */

export const SPEED_SPHERE_TABLE = {
  "3.13": { "lvl3": 3.60, "lvl4": 3.69, "lvl5": 3.76 },
  "3.23": { "lvl3": 3.72, "lvl4": 3.82, "lvl5": 3.88 },
  "3.33": { "lvl3": 3.85, "lvl4": 3.94, "lvl5": 4.00 },
  "3.39": { "lvl3": 3.91, "lvl4": 4.00, "lvl5": 4.08 },
  "3.45": { "lvl3": 3.97, "lvl4": 4.08, "lvl5": 4.15 },
  "3.51": { "lvl3": 4.05, "lvl4": 4.15, "lvl5": 4.22 },
  "3.57": { "lvl3": 4.12, "lvl4": 4.22, "lvl5": 4.29 },
  "3.64": { "lvl3": 4.18, "lvl4": 4.29, "lvl5": 4.37 },
  "3.70": { "lvl3": 4.27, "lvl4": 4.39, "lvl5": 4.44 },
  "3.77": { "lvl3": 4.35, "lvl4": 4.46, "lvl5": 4.55 },
  "3.85": { "lvl3": 4.42, "lvl4": 4.55, "lvl5": 4.63 },
  "3.92": { "lvl3": 4.52, "lvl4": 4.63, "lvl5": 4.72 },
  "4.00": { "lvl3": 4.61, "lvl4": 4.74, "lvl5": 4.81 },
  "4.08": { "lvl3": 4.69, "lvl4": 4.83, "lvl5": 4.90 },
  "4.17": { "lvl3": 4.81, "lvl4": 4.93, "lvl5": 5.00 },
  "4.26": { "lvl3": 4.90, "lvl4": 5.03, "lvl5": 5.13 },
  "4.35": { "lvl3": 5.00, "lvl4": 5.15, "lvl5": 5.24 },
  "4.44": { "lvl3": 5.13, "lvl4": 5.26, "lvl5": 5.35 },
  "4.55": { "lvl3": 5.24, "lvl4": 5.38, "lvl5": 5.46 },
  "4.65": { "lvl3": 5.38, "lvl4": 5.49, "lvl5": 5.59 },
  "4.76": { "lvl3": 5.49, "lvl4": 5.65, "lvl5": 5.71 },
  "5.00": { "lvl3": 5.78, "lvl4": 5.92, "lvl5": 6.02 },
  "5.13": { "lvl3": 5.92, "lvl4": 6.06, "lvl5": 6.17 },
  "5.26": { "lvl3": 6.06, "lvl4": 6.21, "lvl5": 6.33 },
  "5.41": { "lvl3": 6.25, "lvl4": 6.41, "lvl5": 6.49 },
  "5.56": { "lvl3": 6.41, "lvl4": 6.58, "lvl5": 6.67 },
  "5.71": { "lvl3": 6.58, "lvl4": 6.76, "lvl5": 6.90 },
  "5.88": { "lvl3": 6.80, "lvl4": 6.94, "lvl5": 7.09 },
  "5.99": { "lvl3": 6.90, "lvl4": 7.09, "lvl5": 7.19 },
  "6.06": { "lvl3": 6.99, "lvl4": 7.19, "lvl5": 7.30 },
  "6.25": { "lvl3": 7.19, "lvl4": 7.41, "lvl5": 7.52 },
  "6.33": { "lvl3": 7.30, "lvl4": 7.52, "lvl5": 7.63 },
  "6.45": { "lvl3": 7.46, "lvl4": 7.63, "lvl5": 7.75 },
  "6.67": { "lvl3": 7.69, "lvl4": 7.87, "lvl5": 8.00 },
  "6.90": { "lvl3": 7.94, "lvl4": 8.20, "lvl5": 8.33 },
  "7.14": { "lvl3": 8.26, "lvl4": 8.47, "lvl5": 8.62 },
  "7.41": { "lvl3": 8.55, "lvl4": 8.77, "lvl5": 8.93 },
  "7.69": { "lvl3": 8.85, "lvl4": 9.09, "lvl5": 9.26 },
  "8.00": { "lvl3": 9.26, "lvl4": 9.52, "lvl5": 9.62 },
  "8.33": { "lvl3": 9.62, "lvl4": 9.90, "lvl5": 10.00 },
  "8.70": { "lvl3": 10.00, "lvl4": 10.31, "lvl5": 10.53 },
  "8.85": { "lvl3": 10.20, "lvl4": 10.53, "lvl5": 10.64 },
  "9.09": { "lvl3": 10.53, "lvl4": 10.75, "lvl5": 10.99 },
  "9.52": { "lvl3": 10.99, "lvl4": 11.36, "lvl5": 11.49 },
  "10.00": { "lvl3": 11.63, "lvl4": 11.90, "lvl5": 12.05 },
  "10.53": { "lvl3": 12.20, "lvl4": 12.50, "lvl5": 12.66 },
  "11.11": { "lvl3": 12.82, "lvl4": 13.16, "lvl5": 13.33 },
  "11.76": { "lvl3": 13.70, "lvl4": 13.89, "lvl5": 14.29 },
  "12.50": { "lvl3": 14.49, "lvl4": 14.93, "lvl5": 15.15 },
  "12.66": { "lvl3": 14.71, "lvl4": 15.15, "lvl5": 15.38 }
} as const;

/**
 * Map sphere level percentage to lookup key
 * Speed Orb Levels:
 *   Level 3 Orb = +15% -> lvl3
 *   Level 4 Orb = +18% -> lvl4
 *   Level 5 Orb = +20% -> lvl5
 */
function getSphereLevelKey(speedPct: number): 'lvl3' | 'lvl4' | 'lvl5' | null {
  if (speedPct >= 19.5 && speedPct <= 20.5) return 'lvl5'; // +20%
  if (speedPct >= 17.5 && speedPct <= 18.5) return 'lvl4'; // +18%
  if (speedPct >= 14.5 && speedPct <= 15.5) return 'lvl3'; // +15%
  return null;
}

/**
 * Exact game rule (ISpecimenModel::getSpeedX100, Ghidra):
 *   speedX100' = floor(spX100 * 100 / (100 + sum of speed-orb %)), minimum 1
 *   displayed speed = 1000 / speedX100'
 * This reproduces every cell of SPEED_SPHERE_TABLE (verified 150/150 by
 * speed-sphere-table.test.ts) and also handles any base speed and any SUM of
 * speed orbs, which the table cannot.
 *
 * @param spX100 raw integer `spX100` tag of the mutant when known (exact);
 *   otherwise it is estimated from the displayed speed (1000/speed), which can
 *   be off by one for a few speeds (e.g. 3.13 is both 319 and 320).
 */
export function applySpeedSphereExact(
  baseSpeed: number,
  speedPct: number,
  spX100?: number | null,
): number {
  const raw =
    spX100 && spX100 > 0 ? Math.round(spX100) : Math.max(1, Math.round(1000 / baseSpeed))
  const reduced = Math.max(1, Math.floor((raw * 100) / (100 + speedPct)))
  return Math.round((1000 / reduced) * 100) / 100
}

/**
 * Calculate speed with Speed Orb(s): the lookup table stays the primary source
 * (single orb of level 3/4/5 on a base speed that is in the table); everything
 * else - other bases, several orbs at once, other percentages - uses the exact
 * integer rule above instead of the old naive `speed * (1 + pct/100)`.
 * @param baseSpeed - The mutant's base speed
 * @param speedPct - Total percentage bonus from speed orbs
 * @param spX100 - raw integer spX100 of the mutant, when known
 */
export function applySpeedSphere(
  baseSpeed: number,
  speedPct: number,
  spX100?: number | null,
): number {
  const levelKey = getSphereLevelKey(speedPct)
  if (levelKey) {
    const baseSpeedKey = baseSpeed.toFixed(2)
    const tableEntry = SPEED_SPHERE_TABLE[baseSpeedKey as keyof typeof SPEED_SPHERE_TABLE]
    if (tableEntry) return tableEntry[levelKey]
  }
  return applySpeedSphereExact(baseSpeed, speedPct, spX100)
}
