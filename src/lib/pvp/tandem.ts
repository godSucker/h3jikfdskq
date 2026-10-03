/**
 * Tandem ("call_assist" in the game's localisation: "Tandem" / "Tag Team") - a friend's
 * mutant joins the fight and hits once, in addition to the active unit's own attack.
 *
 * SITE CONVENTION, NOT RECOVERED GAME RULES. The decoded config dump has no damage rules for
 * the assist (fightsettings/pvpsettings only list NPC defaults and a commented-out flag), and
 * the live capture on reactivateAssist is contradictory (see re-binary-formulas-plan notes).
 * So the rules below are the site's own, chosen by the product owner:
 *  - the helper strikes ONCE per fight, after the active unit's attack, always single-target
 *    (even if the helper's own attack is AOE), using its atk1 value and atk1 gene;
 *  - damage goes through the same crit -> type pipeline and the target's shield as a normal
 *    hit; the helper has no abilities, no strengthen/weaken buff, no charms of its own;
 *  - the target does NOT react (no retaliate, no strengthen-on-defend, no slash), and the
 *    helper is never in the unit list: it cannot be targeted, queued or killed, and does not
 *    count for isFinished()/AI scoring.
 */

import mutantsRaw from '@/data/mutants/mutants.json'
import { buildBattleUnit, type CombatUnit } from './battle-profile'
import { resolveHit, rollCrit, effectiveCritChance } from './damage'
import { absorbWithShield } from './abilities'
import { cloneUnits } from './resolve-attack'
import { maxLevelForHp } from '@/lib/stats/unified-calculator'

export type TandemStar = 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'

export interface TandemConfig {
  mutantId: string
  level: number
  star: TandemStar
}

export interface TandemHitEvent {
  targetId: string
  damage: number
  crit: boolean
  shieldAbsorbed: number
  died: boolean
  baseDamage: number
  typeModPct: number
}

export interface TandemOutcome {
  units: CombatUnit[]
  event: TandemHitEvent | null
}

/** Best alive enemy to hit when the caller gave no (valid) target: the weakest by current HP. */
export function chooseTandemTarget(
  units: CombatUnit[],
  helperSide: 'mine' | 'enemy',
  preferredIds: (string | null | undefined)[],
): string | null {
  const enemies = units.filter((u) => u.side !== helperSide && u.isAlive)
  for (const id of preferredIds) {
    if (id && enemies.some((e) => e.instanceId === id)) return id
  }
  if (enemies.length === 0) return null
  return enemies.reduce((a, b) => (b.hp < a.hp ? b : a)).instanceId
}

/** One tandem strike. Pure: clones units, never mutates the input. */
export function applyTandemHit(
  allUnits: CombatUnit[],
  helper: CombatUnit,
  targetId: string,
  rng: (() => number) | null,
): TandemOutcome {
  const units = cloneUnits(allUnits)
  const target = units.find((u) => u.instanceId === targetId && u.side !== helper.side && u.isAlive)
  if (!target) return { units, event: null }

  const crit = rng ? rollCrit(effectiveCritChance(0, target.anticritBonusPct), rng) : false
  const hit = resolveHit({
    baseDamage: helper.atk1,
    attackerGene: helper.atk1Gene,
    targetGene: target.gene,
    crit,
  })
  const absorbed = absorbWithShield(target, hit.totalDamage)
  const damage = Math.max(0, hit.totalDamage - absorbed)
  target.hp = Math.max(0, target.hp - damage)
  const died = target.hp === 0
  if (died) target.isAlive = false

  return {
    units,
    event: {
      targetId: target.instanceId,
      damage,
      crit,
      shieldAbsorbed: absorbed,
      died,
      baseDamage: hit.baseDamage,
      typeModPct: hit.typeModPct,
    },
  }
}

const STAR_PRIORITY: TandemStar[] = ['platinum', 'gold', 'silver', 'bronze', 'normal']
// Level far above any cap: buildBattleUnit clamps to the mutant's own int32-HP ceiling.
const MAX_LEVEL_PROBE = 1_000_000_000

interface RawMutant {
  id: string
  stars?: Record<string, { multiplier?: number } | undefined>
  base_stats?: { hp_base?: number }
}

let strongestCache: TandemConfig | null = null

/**
 * "One-shot tandem": the mutant with the highest atk1 at its own maximum level and best star.
 * Ranked by raw atk1 - the type advantage depends on the target, which is unknown at pick time.
 */
export function strongestTandem(): TandemConfig {
  if (strongestCache) return strongestCache
  let best: { cfg: TandemConfig; atk: number } | null = null
  for (const m of mutantsRaw as unknown as RawMutant[]) {
    const star = STAR_PRIORITY.find((s) => m.stars?.[s]) ?? 'normal'
    const unit = buildBattleUnit(String(m.id), {
      level: MAX_LEVEL_PROBE,
      star,
      side: 'mine',
      instanceId: 'probe',
    })
    if (!best || unit.atk1 > best.atk) {
      const starMul = m.stars?.[star]?.multiplier ?? 1.0
      const level = maxLevelForHp((Number(m.base_stats?.hp_base) || 0) * starMul)
      best = { cfg: { mutantId: String(m.id), level, star }, atk: unit.atk1 }
    }
  }
  strongestCache = best!.cfg
  return strongestCache
}

/** Builds the helper CombatUnit (no orbs/charms). Level is clamped by buildBattleUnit. */
export function buildTandemUnit(
  cfg: TandemConfig,
  side: 'mine' | 'enemy',
  extra: Pick<Parameters<typeof buildBattleUnit>[1], 'locale' | 'names'> = {},
): CombatUnit {
  return buildBattleUnit(cfg.mutantId, {
    level: cfg.level,
    star: cfg.star,
    side,
    instanceId: `tandem-${side}`,
    ...extra,
  })
}
