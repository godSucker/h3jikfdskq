/**
 * Общее ядро "применить одну атаку к снапшоту всех 6 юнитов", переиспользуемое
 * и AI-перебором (ai.ts, крит выключен - см. GuidesBrowser.svelte L890-895:
 * "во время этого перебора крит математически невозможен"), и реальным
 * разрешением хода (fight-engine.ts, крит кидается по-настоящему). Чистая
 * функция - клонирует юнитов, не мутирует вход.
 *
 * Эффекты способностей (abilities.ts) читают/пишут персистентный стейт юнита
 * (shieldPool/strengthenCharges/weakenCharge/slashDot) - раз функция клонирует
 * юниты на входе, это безопасно и для AI-оценки (мутации остаются в клоне).
 */

import type { CombatUnit } from './battle-profile'
import { resolveHit, rollCrit, effectiveCritChance } from './damage'
import {
  consumeAttackBuffPct,
  applyOwnShield,
  applyOwnRegenAndStrengthen,
  grantStrengthenOnDefend,
  grantWeakenOnHit,
  grantSlashOnHit,
  retaliateDamage,
  absorbWithShield,
} from './abilities'

export interface AttackEvent {
  attackerId: string
  targetId: string
  damage: number
  crit: boolean
  shieldAbsorbed: number
  died: boolean
  /** Разбивка урона (для UI/лога) - см. damage.ts HitResult. */
  baseDamage: number
  typeModPct: number
  buffDamage: number
  buffPct?: number
}

export interface AttackOutcome {
  units: CombatUnit[]
  events: AttackEvent[]
  retaliateEvents: AttackEvent[]
}

function cloneUnits(units: CombatUnit[]): CombatUnit[] {
  return units.map((u) => ({ ...u, abilities: u.abilities.map((a) => ({ ...a })) }))
}

/**
 * @param rng null => режим оценки ИИ, крит форсированно выключен для всех попаданий.
 *            иначе => реальное разрешение хода, крит кидается по-настоящему.
 */
export function applyAttack(
  allUnits: CombatUnit[],
  attackerId: string,
  attack: 'atk1' | 'atk2',
  targetId: string | null,
  rng: (() => number) | null,
): AttackOutcome {
  const units = cloneUnits(allUnits)
  const byId = new Map(units.map((u) => [u.instanceId, u]))
  const attacker = byId.get(attackerId)
  if (!attacker) throw new Error(`Unknown attacker: ${attackerId}`)

  const isAOE = attack === 'atk1' ? attacker.atk1IsAOE : attacker.atk2IsAOE
  const baseDamage = attack === 'atk1' ? attacker.atk1 : attacker.atk2
  const gene = attack === 'atk1' ? attacker.atk1Gene : attacker.atk2Gene
  // property="damage" (strengthen/weaken) - расходуется в момент атаки, модифицирует ЭТОТ удар.
  const buffPct = consumeAttackBuffPct(attacker)

  const enemySide = units.filter((u) => u.side !== attacker.side)
  const targets = isAOE
    ? enemySide.filter((u) => u.isAlive)
    : (() => {
        const t = targetId ? byId.get(targetId) : null
        return t && t.isAlive ? [t] : []
      })()

  const events: AttackEvent[] = []
  const retaliateEvents: AttackEvent[] = []
  let totalDamageGiven = 0
  // Копится отдельно от events - фаза 3 ниже проходит по целям ЕЩЁ РАЗ (для отражения),
  // после того как у атакующего уже мог встать щит (фаза 2).
  const pendingRetaliates: { target: CombatUnit; rawDamage: number; died: boolean }[] = []

  // Фаза 1: урон по всем целям (в игре порядок именно такой - см. заголовок файла).
  for (const target of targets) {
    const critChancePct = effectiveCritChance(attacker.critCharmBonusPct, target.anticritBonusPct)
    const crit = rng ? rollCrit(critChancePct, rng) : false
    const hit = resolveHit({
      baseDamage,
      attackerGene: gene,
      targetGene: target.gene,
      crit,
      buffPct,
    })
    const rawDamage = hit.totalDamage
    totalDamageGiven += rawDamage

    const absorbed = absorbWithShield(target, rawDamage)
    const finalDamage = Math.max(0, rawDamage - absorbed)

    target.hp = Math.max(0, target.hp - finalDamage)
    const died = target.hp === 0
    if (died) target.isAlive = false

    events.push({
      attackerId: attacker.instanceId,
      targetId: target.instanceId,
      damage: finalDamage,
      crit,
      shieldAbsorbed: absorbed,
      died,
      baseDamage: hit.baseDamage,
      typeModPct: hit.typeModPct,
      buffDamage: hit.buffDamage,
      buffPct: hit.buffPct,
    })

    pendingRetaliates.push({ target, rawDamage, died })

    if (!died) {
      grantStrengthenOnDefend(target)
      grantWeakenOnHit(attacker, target)
      // slash (valueFrom="damageTaken") - на то, что цель РЕАЛЬНО получила (после щита).
      grantSlashOnHit(attacker, target, finalDamage)
    }
  }

  // Фаза 2: щит атакующего от суммарного урона этой атаки (valueFrom="damageGiven") -
  // ДО отражения, чтобы отражение (фаза 3) уже могло его частично поглотить (см. заголовок
  // файла и abilities.ts::applyOwnShield - в игре щит успевает встать раньше отражения).
  if (attacker.isAlive) {
    applyOwnShield(attacker, totalDamageGiven)
  }

  // Фаза 3: отражение целей - теперь идёт ЧЕРЕЗ щит атакующего (absorbWithShield), не
  // напрямую в hp, раз щит из фазы 2 уже мог встать.
  for (const { target, rawDamage, died } of pendingRetaliates) {
    // retaliate (valueFrom="damageGiven" атакующего - на СЫРОЙ урон, не зависит от щита цели)
    const retaliate = retaliateDamage(target, rawDamage)
    if (retaliate > 0 && !died) {
      const absorbed = absorbWithShield(attacker, retaliate)
      const finalRetaliate = Math.max(0, retaliate - absorbed)
      attacker.hp = Math.max(0, attacker.hp - finalRetaliate)
      const attackerDied = attacker.hp === 0
      if (attackerDied) attacker.isAlive = false
      retaliateEvents.push({
        attackerId: target.instanceId,
        targetId: attacker.instanceId,
        damage: finalRetaliate,
        crit: false,
        shieldAbsorbed: absorbed,
        died: attackerDied,
        // retaliate - плоский % от rawDamage входящего удара, не проходит крит/тип/бафф.
        baseDamage: retaliate,
        typeModPct: 0,
        buffDamage: 0,
      })
    }
  }

  // Фаза 4: отхил + заряд усиления от своей атаки - ПОСЛЕ отражения (в игре лайфстил
  // тикает уже после того, как отражение отняло HP - в отличие от щита выше).
  if (attacker.isAlive) {
    applyOwnRegenAndStrengthen(attacker, totalDamageGiven)
  }

  return { units, events, retaliateEvents }
}
