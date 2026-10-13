/**
 * Точный порт FightContext::computeTurns (Ghidra, сборка 817: 0x0075a700) и компаратора
 * orderBySpeed, вписанного в __introsort (0x0075d464). Тай-брейк найден 2026-10-14.
 *
 * Скорость - ИГРОВАЯ сырая (целое spX100, МЕНЬШЕ = БЫСТРЕЕ, уже со сферами скорости:
 * floor(spX100 * 100 / (100 + %)), см. CombatUnit.speedRaw). Алгоритм:
 *
 * 1) Предсортировка всех бойцов обеих команд по ключу orderBySpeed:
 *      a. speedRaw по возрастанию (быстрее ходит раньше);
 *      b. при равенстве - УРОВЕНЬ ПО УБЫВАНИЮ (поле ISpecimenModel+0xb4 = level);
 *      c. при равенстве - FightContext::getSpecimenTeamSide по возрастанию
 *         (0 = список this+0x50, 1 = this+0x58). this+0x50 = ПЕРВАЯ команда
 *         FightContext::reset(Team&, Team&); FightFlowController::onStartFightAnswer
 *         передаёт в FightController::startFight первой команду *(this+0x70) - ту, к
 *         которой привязан помощник-тандем (useAsAssist) и чьим id помечается старт боя,
 *         то есть КОМАНДУ ИГРОКА (в JSON старта боя это LeftPlayerData). Поэтому
 *         mine = 0, enemy = 1;
 *      дальше порядок игрой не определён (introsort нестабилен) - оставляем исходный.
 * 2) Времена ходов - кратные speedRaw. В окне [f*(r+1), f*(r+2)), где f - speedRaw самого
 *    быстрого, каждый боец берёт первое кратное своей скорости >= f*(r+1), и входит в
 *    окно, если оно < f*(r+2).
 * 3) Внутри окна СТАБИЛЬНАЯ сортировка по времени (в игре пузырьковая со строгим "<"):
 *    при равных временах порядок предсортировки сохраняется. Мёртвые пропускаются
 *    (isDead) - здесь это забота fight-engine, он скипает умерших до своего хода.
 *
 * Это объясняет прежнее "противоречие" PvE-тестов 2026-08-18: рейд-босс Колосс (~250
 * уровень) выше уровнем колосса игрока и ходит первым на равной скорости (5/5), а в
 * обычной PvE при равных уровнях решает сторона (игрок первым).
 *
 * Раньше тут стоял равновероятный Fisher-Yates (конвенция сайта, не формула игры) -
 * параметр rng сохранён для совместимости вызовов, но больше не используется.
 */

import type { CombatUnit } from './battle-profile'

/** Игровая сырая скорость бойца (целое, меньше = быстрее). */
function rawSpeed(u: CombatUnit): number {
  if (Number.isFinite(u.speedRaw) && u.speedRaw > 0) return u.speedRaw
  // Запасной путь для бойцов без speedRaw: обратный перевод сайтовой конвенции (больше =
  // быстрее) в игровую сырую.
  return Math.max(1, Math.round(1000 / u.speedX100))
}

const sideKey = (u: CombatUnit) => (u.side === 'mine' ? 0 : 1)

/** orderBySpeed: скорость asc, уровень desc, сторона asc. */
function orderBySpeed(a: CombatUnit, b: CombatUnit): number {
  return rawSpeed(a) - rawSpeed(b) || (b.level ?? 0) - (a.level ?? 0) || sideKey(a) - sideKey(b)
}

export function computeTurnQueue(
  units: CombatUnit[],
  turnsNeeded: number,
  _rng?: () => number,
): CombatUnit[] {
  const living = units.filter((u) => u.isAlive && rawSpeed(u) > 0)
  if (living.length === 0) return []

  // Array.prototype.sort стабилен - при полном равенстве ключа остаётся исходный порядок.
  const sorted = [...living].sort(orderBySpeed)
  const fastest = rawSpeed(sorted[0])
  const queue: CombatUnit[] = []

  let round = 0
  // Защита от бесконечного цикла (не должна сработать при живых юнитах и fastest>0)
  const roundCap = turnsNeeded * living.length + 1000

  while (queue.length < turnsNeeded && round < roundCap) {
    const low = fastest * (round + 1)
    const high = fastest * (round + 2)

    const window: { unit: CombatUnit; tick: number }[] = []
    for (const unit of sorted) {
      const s = rawSpeed(unit)
      const tick = Math.ceil(low / s) * s
      if (tick < high) window.push({ unit, tick })
    }
    // Стабильная сортировка по времени: равные времена сохраняют порядок предсортировки.
    window.sort((a, b) => a.tick - b.tick)

    for (const { unit } of window) {
      if (queue.length >= turnsNeeded) break
      queue.push(unit)
    }
    round += 1
  }

  return queue
}
