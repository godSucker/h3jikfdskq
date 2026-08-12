/**
 * Порт AIPlayerAttackController::chooseAttack/chooseBestAttack/getFightStateScore
 * (Ghidra, 0x0070e474 и соседние адреса, см. re-binary-formulas-plan.md). Тот же
 * алгоритм ведёт и ПВЕ-ботов, и защиту/оппонента в PvP (подтверждено дважды - живыми
 * данными в GuidesBrowser.svelte L879-895, и конструктором FightFlowController
 * (0x00703000) в этой сессии, который создаёт AIPlayerAttackController одинаково
 * для любого режима боя).
 *
 * randomIaValue по умолчанию = 100 (жёстко задаётся в FightFlowController::
 * FightFlowController) => roll(0..99) < 100 всегда истинно => PvP-ИИ ВСЕГДА играет
 * оптимально (chooseBestAttack), случайная ветка ниже оставлена для полноты порта,
 * но в PvP-калькуляторе фактически не используется.
 */

import type { CombatUnit } from './battle-profile'
import { applyAttack } from './resolve-attack'

export const DEFAULT_RANDOM_IA_VALUE = 100

export interface AiChoice {
  attack: 'atk1' | 'atk2'
  targetId: string | null // null для AOE (бьёт всех живых врагов)
}

function scoreOf(units: CombatUnit[], mySide: 'mine' | 'enemy'): number {
  let myHp = 0
  let enemyHp = 0
  let myAlive = false
  let enemyAlive = false
  for (const u of units) {
    if (u.side === mySide) {
      myHp += u.hp
      if (u.isAlive) myAlive = true
    } else {
      enemyHp += u.hp
      if (u.isAlive) enemyAlive = true
    }
  }
  if (!enemyAlive) return Number.POSITIVE_INFINITY
  if (!myAlive) return Number.NEGATIVE_INFINITY
  return myHp - enemyHp
}

function validAttacks(unit: CombatUnit): ('atk1' | 'atk2')[] {
  return unit.atk2Available ? ['atk1', 'atk2'] : ['atk1']
}

/** Жадный перебор всех пар (атака, цель), крит форсированно выключен (см. заголовок файла). */
export function chooseBestAttack(units: CombatUnit[], attackerId: string): AiChoice {
  const attacker = units.find((u) => u.instanceId === attackerId)
  if (!attacker) throw new Error(`Unknown attacker: ${attackerId}`)

  const enemies = units.filter((u) => u.side !== attacker.side && u.isAlive)
  let best: { choice: AiChoice; score: number } | null = null

  for (const attack of validAttacks(attacker)) {
    const isAOE = attack === 'atk1' ? attacker.atk1IsAOE : attacker.atk2IsAOE
    const candidateTargets = isAOE ? [null] : enemies.map((e) => e.instanceId)

    for (const targetId of candidateTargets) {
      const outcome = applyAttack(units, attackerId, attack, targetId, null)
      const score = scoreOf(outcome.units, attacker.side)
      if (!best || score > best.score) {
        best = { choice: { attack, targetId }, score }
      }
    }
  }

  if (!best) {
    // теоретически недостижимо, пока есть живые враги - защитный фоллбэк
    return { attack: 'atk1', targetId: enemies[0]?.instanceId ?? null }
  }
  return best.choice
}

/** Полный порт с учётом randomIaValue - для PvP не нужен (см. заголовок), оставлен для полноты. */
export function chooseAttack(
  units: CombatUnit[],
  attackerId: string,
  rng: () => number,
  randomIaValue: number = DEFAULT_RANDOM_IA_VALUE,
): AiChoice {
  const attacker = units.find((u) => u.instanceId === attackerId)!
  const roll = Math.floor(rng() * 100)
  if (roll >= randomIaValue) {
    const enemies = units.filter((u) => u.side !== attacker.side && u.isAlive)
    const attacks = validAttacks(attacker)
    const attack = attacks[Math.floor(rng() * attacks.length)]
    const target = enemies[Math.floor(rng() * enemies.length)]
    return { attack, targetId: target?.instanceId ?? null }
  }
  return chooseBestAttack(units, attackerId)
}
