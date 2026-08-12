/**
 * Модель 6 именных способностей (shield/regen/retaliate/slash/strengthen/weaken) -
 * ПОДТВЕРЖДЕНО дешифровкой игрового конфига (4443/mgg_dump/abilitydefinitions_decoded.xml,
 * оригинальные dev-комментарии игры, не догадка/RE-инференс). Никакой способности НЕ
 * присуще понятие "длится N ходов" - жизненный цикл целиком описан четырьмя полями
 * Effect-узла: trigger/property/counter/stackMax.
 *
 *   trigger="immediate" (retaliate/regen/shield) - разрешаются мгновенно в момент
 *     срабатывающего удара, ничего не остаётся "висеть" на юните как статус.
 *   без trigger, но с icon (weaken/strengthen/slash) - персистентный статус, реально
 *     виден на юните между ходами.
 *   counter - число срабатываний, НЕ ходов: "1" = разовое использование (даже если
 *     заряд забанкован и ждёт), "0" = не расходуется, тикает бесконечно (slash:
 *     "repeated until the end of the fight" - дословно из комментария игры).
 *   stackMax - потолок забаненных зарядов (strengthen=2), НЕ длительность.
 *
 * Магнитуда всех шести берётся из valueFrom="damageGiven"/"damageTaken" -
 * ФАКТИЧЕСКИЙ урон конкретного сработавшего удара (post-крит/тип/бафф), а не
 * плоская константа atk1×pct - это тоже из декодированного конфига, не предположение.
 *
 * property="damage" (strengthen/weaken) - результат работает как % модификатор
 * СЛЕДУЮЩЕЙ атаки владельца заряда (через buffPct в damage.ts, формула которого не
 * меняется - см. damage.ts). property="life"/"shield" (regen/retaliate/shield/slash) -
 * результат - абсолютная магнитуда HP/щита, снэпшотится в момент триггера.
 */

import type { CombatUnit } from './battle-profile'
import { STRENGTHEN_STACK_MAX } from './battle-profile'

/** В начале собственного хода (перед атакой): расходует 1 заряд strengthen (+pct) и
 *  заряд weaken (-pct), если есть, возвращает net % для buffPct этой атаки. */
export function consumeAttackBuffPct(unit: CombatUnit): number | undefined {
  let pct = 0
  let any = false
  if (unit.strengthenCharges > 0 && unit.ability?.kind === 'strengthen') {
    unit.strengthenCharges -= 1
    pct += Math.abs(unit.ability.pct)
    any = true
  }
  if (unit.weakenCharge) {
    unit.weakenCharge = false
    pct -= Math.abs(unit.weakenPct)
    any = true
  }
  return any ? pct : undefined
}

/** После разрешения атаки: shield/regen (оба trigger="attack", valueFrom="damageGiven") -
 *  считаются от суммарного фактического урона, нанесённого этой атакой (все цели, если AOE). */
export function applyOwnAttackEffects(attacker: CombatUnit, totalDamageDealt: number): void {
  if (attacker.ability?.kind === 'shield') {
    // stackMax="1" - новое применение ЗАМЕНЯЕТ пул, не складывает.
    attacker.shieldPool = Math.floor((totalDamageDealt * Math.abs(attacker.ability.pct)) / 100)
  }
  if (attacker.ability?.kind === 'regen') {
    const heal = Math.floor((totalDamageDealt * Math.abs(attacker.ability.pct)) / 100)
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal)
  }
  if (
    attacker.ability?.kind === 'strengthen' &&
    attacker.strengthenCharges < STRENGTHEN_STACK_MAX
  ) {
    attacker.strengthenCharges += 1
  }
}

/** Владелец strengthen получает заряд и когда его атакуют (trigger="defend"), не
 *  только когда атакует сам. */
export function grantStrengthenOnDefend(defender: CombatUnit): void {
  if (
    defender.ability?.kind === 'strengthen' &&
    defender.strengthenCharges < STRENGTHEN_STACK_MAX
  ) {
    defender.strengthenCharges += 1
  }
}

/** Weaken атакующего (trigger="attack", applyOn="opponent") - вешает заряд на цель,
 *  сработает на ЕЁ следующей атаке. stackMax="0" = не стакуется, новое заменяет. */
export function grantWeakenOnHit(attacker: CombatUnit, target: CombatUnit): void {
  if (attacker.ability?.kind === 'weaken') {
    target.weakenCharge = true
    target.weakenPct = Math.abs(attacker.ability.pct)
  }
}

/** Slash атакующего - вешает на цель фиксированный тик-урон (% от урона, взятого В
 *  МОМЕНТ применения - снэпшот, дальше не пересчитывается), стакМакс=1 => заменяет. */
export function grantSlashOnHit(
  attacker: CombatUnit,
  target: CombatUnit,
  damageTakenThisHit: number,
): void {
  if (attacker.ability?.kind === 'slash') {
    target.slashDot = Math.floor((damageTakenThisHit * Math.abs(attacker.ability.pct)) / 100)
  }
}

/** Retaliate (trigger="defend", valueFrom="damageGiven" атакующего) - % от урона,
 *  который атакующий только что нанёс этим ударом. */
export function retaliateDamage(defender: CombatUnit, incomingHitDamage: number): number {
  return defender.ability?.kind === 'retaliate'
    ? Math.floor((incomingHitDamage * Math.abs(defender.ability.pct)) / 100)
    : 0
}

/** Поглощение входящего урона персистентным пулом щита - истощается (не сбрасывается
 *  за ход), пока не иссякнет. */
export function absorbWithShield(target: CombatUnit, rawDamage: number): number {
  const absorbed = Math.min(target.shieldPool, rawDamage)
  target.shieldPool -= absorbed
  return absorbed
}

/** Тик slash в конце хода поражённого юнита - фиксированная магнитуда, counter="0" =>
 *  не расходуется, повторяется до конца боя. */
export function tickSlash(unit: CombatUnit): number {
  return unit.slashDot
}
