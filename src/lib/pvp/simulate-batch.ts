/**
 * Батч-прогон N боёв (ИИ vs ИИ) для оценки win-rate% матчапа - в отличие от одного
 * ручного/авто-боя, единичный результат которого сильно шумит (крит-роллы,
 * тай-брейки очереди ходов при равных спидах), агрегат по многим прогонам даёт
 * то же самое "реальные шансы", что и остальные симуляторы сайта (крафт/рулетки).
 *
 * Юниты нужно строить ЗАНОВО на каждый прогон (buildMine/buildEnemy - фабрики,
 * не готовые массивы) - CombatUnit мутируется внутри боя (hp/shieldPool/заряды),
 * переиспользование одних и тех же объектов между прогонами испортило бы вход.
 */

import { createBattleSession } from './fight-engine'
import type { CombatUnit } from './battle-profile'

export interface BatchResult {
  runs: number
  mineWins: number
  enemyWins: number
  mineWinRatePct: number
  avgTurns: number
  /** Средний % оставшегося HP команды-победителя в боях, которые она выиграла - 0, если ни разу не выигрывала. */
  avgMineHpPctOnWin: number
  avgEnemyHpPctOnWin: number
}

const TURN_GUARD = 3000

function hpPct(units: CombatUnit[], side: 'mine' | 'enemy'): number {
  const sideUnits = units.filter((u) => u.side === side)
  const hp = sideUnits.reduce((s, u) => s + u.hp, 0)
  const maxHp = sideUnits.reduce((s, u) => s + u.maxHp, 0)
  return maxHp > 0 ? (hp / maxHp) * 100 : 0
}

export function simulateBatch(
  buildMine: () => CombatUnit[],
  buildEnemy: () => CombatUnit[],
  runs: number,
  rng: () => number = Math.random,
): BatchResult {
  let mineWins = 0
  let enemyWins = 0
  let totalTurns = 0
  let mineHpSumOnWin = 0
  let enemyHpSumOnWin = 0

  for (let i = 0; i < runs; i++) {
    const session = createBattleSession(buildMine(), buildEnemy(), 'ai', 'ai', rng)
    let turns = 0
    while (!session.isFinished() && turns < TURN_GUARD) {
      session.resolveTurn()
      turns += 1
    }
    totalTurns += turns

    const winner = session.winner()
    if (winner === 'mine') {
      mineWins += 1
      mineHpSumOnWin += hpPct(session.getUnits(), 'mine')
    } else if (winner === 'enemy') {
      enemyWins += 1
      enemyHpSumOnWin += hpPct(session.getUnits(), 'enemy')
    }
  }

  return {
    runs,
    mineWins,
    enemyWins,
    mineWinRatePct: runs > 0 ? Math.round((mineWins / runs) * 1000) / 10 : 0,
    avgTurns: runs > 0 ? Math.round((totalTurns / runs) * 10) / 10 : 0,
    avgMineHpPctOnWin: mineWins > 0 ? Math.round(mineHpSumOnWin / mineWins) : 0,
    avgEnemyHpPctOnWin: enemyWins > 0 ? Math.round(enemyHpSumOnWin / enemyWins) : 0,
  }
}
