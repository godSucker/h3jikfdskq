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
 * Магнитуда shield/regen/slash/strengthen/weaken берётся из valueFrom="damageGiven"/
 * "damageTaken" - ФАКТИЧЕСКИЙ урон конкретного сработавшего удара (post-крит/тип/бафф),
 * не плоская константа atk1×pct - это из декодированного конфига, не предположение.
 *
 * retaliate - ИСКЛЮЧЕНИЕ, перепроверено живым Frida-захватом 2026-08-18 (PvE,
 * см. память retaliate-formula-confirmed-2026-08-18): магнитуда НЕ зависит от урона
 * входящего удара - при неизменной цели и способности она осталась той же (6333)
 * даже когда атакующий поднял уровень посреди сессии и его наносимый урон вырос.
 * Совпадает с def.atk1×pct (та же формула, что unified-calculator.ts использует для
 * generic "ability"-значения - см. схему value_atk1_lvlXX в mutants.json, отражение
 * из неё не исключение, shield/regen под неё тоже точно ложатся). decoded-XML
 * valueFrom="damageGiven" для retaliate, видимо, означает "как будто владелец только
 * что ударил своей атакой", а не "переиспользовать число уже случившегося удара" -
 * shield/regen/slash/strengthen/weaken НЕ перепроверялись живыми данными, оставлены
 * как есть.
 *
 * property="damage" (strengthen/weaken) - результат работает как % модификатор
 * СЛЕДУЮЩЕЙ атаки владельца заряда (через buffPct в damage.ts, формула которого не
 * меняется - см. damage.ts). property="life"/"shield" (regen/retaliate/shield/slash) -
 * результат - абсолютная магнитуда HP/щита, снэпшотится в момент триггера.
 */

import type { AbilityKind, CombatAbility, CombatUnit } from './battle-profile'
import { STRENGTHEN_STACK_MAX } from './battle-profile'

/** Юнит может иметь до 2 способностей одновременно (родная + спец-сфера add<kind>,
 *  гарантированно разных kind - см. battle-profile.ts) - все хелперы ниже ищут нужный
 *  kind в массиве вместо старой проверки unit.ability?.kind === X. */
function findAbility(unit: CombatUnit, kind: AbilityKind): CombatAbility | undefined {
  return unit.abilities.find((a) => a.kind === kind)
}

/** В начале собственного хода (перед атакой): расходует 1 заряд strengthen (+pct) и
 *  заряд weaken (-pct), если есть, возвращает net % для buffPct этой атаки. */
export function consumeAttackBuffPct(unit: CombatUnit): number | undefined {
  let pct = 0
  let any = false
  const strengthen = findAbility(unit, 'strengthen')
  if (unit.strengthenCharges > 0 && strengthen) {
    unit.strengthenCharges -= 1
    pct += Math.abs(strengthen.pct)
    any = true
  }
  if (unit.weakenCharge) {
    unit.weakenCharge = false
    pct -= Math.abs(unit.weakenPct)
    any = true
  }
  return any ? pct : undefined
}

/** Щит атакующего (trigger="attack", valueFrom="damageGiven") - считается от суммарного
 *  фактического урона, нанесённого этой атакой (все цели, если AOE). Разрешается ДО
 *  отражения цели (см. resolve-attack.ts) - в игре щит успевает встать до того, как
 *  отражение снимет с него часть. stackMax="1" - новое применение ЗАМЕНЯЕТ пул. */
export function applyOwnShield(attacker: CombatUnit, totalDamageDealt: number): void {
  const shield = findAbility(attacker, 'shield')
  if (shield) {
    attacker.shieldPool = Math.floor((totalDamageDealt * Math.abs(shield.pct)) / 100)
  }
}

/** Отхил + заряд усиления от собственной атаки - разрешаются ПОСЛЕ отражения (в игре
 *  лайфстил тикает уже после того, как отражение цели отняло HP), в отличие от щита выше. */
export function applyOwnRegenAndStrengthen(attacker: CombatUnit, totalDamageDealt: number): void {
  const regen = findAbility(attacker, 'regen')
  if (regen) {
    const heal = Math.floor((totalDamageDealt * Math.abs(regen.pct)) / 100)
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal)
  }
  const strengthen = findAbility(attacker, 'strengthen')
  if (strengthen && attacker.strengthenCharges < STRENGTHEN_STACK_MAX) {
    attacker.strengthenCharges += 1
  }
}

/** Владелец strengthen получает заряд и когда его атакуют (trigger="defend"), не
 *  только когда атакует сам. */
export function grantStrengthenOnDefend(defender: CombatUnit): void {
  const strengthen = findAbility(defender, 'strengthen')
  if (strengthen && defender.strengthenCharges < STRENGTHEN_STACK_MAX) {
    defender.strengthenCharges += 1
  }
}

/** Weaken атакующего (trigger="attack", applyOn="opponent") - вешает заряд на цель,
 *  сработает на ЕЁ следующей атаке. stackMax="0" = не стакуется, новое заменяет. */
export function grantWeakenOnHit(attacker: CombatUnit, target: CombatUnit): void {
  const weaken = findAbility(attacker, 'weaken')
  if (weaken) {
    target.weakenCharge = true
    target.weakenPct = Math.abs(weaken.pct)
  }
}

/** Slash атакующего - вешает на цель фиксированный тик-урон (% от урона, взятого В
 *  МОМЕНТ применения - снэпшот, дальше не пересчитывается), стакМакс=1 => заменяет. */
export function grantSlashOnHit(
  attacker: CombatUnit,
  target: CombatUnit,
  damageTakenThisHit: number,
): void {
  const slash = findAbility(attacker, 'slash')
  if (slash) {
    target.slashDot = Math.floor((damageTakenThisHit * Math.abs(slash.pct)) / 100)
  }
}

/** Retaliate (trigger="defend") - % от СОБСТВЕННОЙ атаки (atk1) юнита с отражением,
 *  не от урона входящего удара - см. разбор в шапке файла. */
export function retaliateDamage(defender: CombatUnit): number {
  const retaliate = findAbility(defender, 'retaliate')
  return retaliate ? Math.floor((defender.atk1 * Math.abs(retaliate.pct)) / 100) : 0
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
