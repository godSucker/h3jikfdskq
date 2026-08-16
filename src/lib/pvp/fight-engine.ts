/**
 * Оркестратор боя - пошаговая сессия по образцу craft-simulator.ts (чистая логика,
 * инжектируемый rng), но с сессионным API вместо "прогнать всё за один вызов":
 * ход может требовать реального ввода пользователя (ручной режим), поэтому вызывающий
 * код (UI) вызывает currentTurn()/resolveTurn() по одному ходу за раз. Обе стороны
 * получают независимый режим manual/ai - "моя команда" не обязана быть всегда ручной.
 */

import type { CombatUnit } from './battle-profile'
import { computeTurnQueue } from './turn-order'
import { chooseBestAttack } from './ai'
import { applyAttack } from './resolve-attack'
import { tickSlash } from './abilities'
import { t, type Locale } from '@/lib/i18n'

export type FighterMode = 'manual' | 'ai'

export interface ValidAction {
  attack: 'atk1' | 'atk2'
  isAOE: boolean
  targets: CombatUnit[] // для AOE - все живые враги (информационно, цель выбирать не нужно)
}

export interface CurrentTurnInfo {
  turnNumber: number
  unit: CombatUnit
  needsInput: boolean
  validActions: ValidAction[]
}

export interface BattleStepHit {
  targetId: string
  targetName: string
  damage: number
  crit: boolean
  shieldAbsorbed: number
  died: boolean
  baseDamage: number
  typeModPct: number
  buffDamage: number
  buffPct?: number
}

export interface BattleStep {
  turnNumber: number
  attackerId: string
  attackerName: string
  attack: 'atk1' | 'atk2'
  hits: BattleStepHit[]
  retaliateHits: BattleStepHit[]
  /** Тик slash (Effect slash_01, counter="0" - тикает каждый ход поражённого юнита
   *  до конца боя), если у атакующего есть активный slashDot. 0 = не сработал. */
  slashTick: number
  slashTickDied: boolean
}

export interface TurnChoice {
  attack: 'atk1' | 'atk2'
  targetId?: string
}

/** Один ход, сгруппированный для UI (BattleView) - вместо плоского списка строк,
 *  чтобы визуально отделять ходы друг от друга (иначе лог выглядит "сплошным"). */
export interface TurnLogGroup {
  turnNumber: number
  attackerName: string
  attackerSide: 'mine' | 'enemy'
  lines: string[]
}

const QUEUE_BATCH = 60

export class BattleSession {
  private units: CombatUnit[]
  private myMode: FighterMode
  private enemyMode: FighterMode
  private rng: () => number
  private locale: Locale
  private queue: CombatUnit[] = []
  private queuePos = 0
  private turnNumber = 0
  public readonly turnLog: TurnLogGroup[] = []

  constructor(
    myTeam: CombatUnit[],
    enemyTeam: CombatUnit[],
    myMode: FighterMode,
    enemyMode: FighterMode,
    rng: () => number = Math.random,
    locale: Locale = 'ru',
  ) {
    this.units = [...myTeam, ...enemyTeam]
    this.myMode = myMode
    this.enemyMode = enemyMode
    this.rng = rng
    this.locale = locale
  }

  private modeFor(unit: CombatUnit): FighterMode {
    return unit.side === 'mine' ? this.myMode : this.enemyMode
  }

  private byId(id: string): CombatUnit {
    const u = this.units.find((x) => x.instanceId === id)
    if (!u) throw new Error(`Unknown unit: ${id}`)
    return u
  }

  private ensureQueue() {
    while (this.queuePos >= this.queue.length && !this.isFinished()) {
      const more = computeTurnQueue(this.units, QUEUE_BATCH, this.rng)
      if (more.length === 0) break // некому больше ходить (не должно случиться при isFinished()===false)
      this.queue.push(...more)
    }
  }

  getUnits(): CombatUnit[] {
    return this.units
  }

  /** Превью ближайших N ходов очереди (для шкалы ходов в UI) - лучшая доступная оценка,
   *  не гарантия: если в этом окне кто-то умрёт раньше своего хода, реальный порядок
   *  может немного разъехаться (та же причина, по которой currentTurn() скипает мёртвых
   *  "на лету", а не пересчитывает очередь заранее). Юниты резолвятся через byId(), т.к.
   *  сама очередь хранит ссылки на снапшоты units с МОМЕНТА computeTurnQueue - после
   *  каждого resolveTurn() this.units целиком заменяется (см. cloneUnits в resolve-attack.ts). */
  upcomingQueue(n: number): CombatUnit[] {
    this.ensureQueue()
    const result: CombatUnit[] = []
    for (let i = this.queuePos; i < this.queue.length && result.length < n; i += 1) {
      const u = this.byId(this.queue[i].instanceId)
      if (u.isAlive) result.push(u)
    }
    return result
  }

  isFinished(): boolean {
    const mineAlive = this.units.some((u) => u.side === 'mine' && u.isAlive)
    const enemyAlive = this.units.some((u) => u.side === 'enemy' && u.isAlive)
    return !mineAlive || !enemyAlive
  }

  winner(): 'mine' | 'enemy' | null {
    if (!this.isFinished()) return null
    return this.units.some((u) => u.side === 'mine' && u.isAlive) ? 'mine' : 'enemy'
  }

  currentTurn(): CurrentTurnInfo | null {
    if (this.isFinished()) return null
    this.ensureQueue()

    // Пропускаем в очереди тех, кто умер до своего хода (как делает сам движок игры)
    while (this.queuePos < this.queue.length) {
      const candidate = this.byId(this.queue[this.queuePos].instanceId)
      if (candidate.isAlive) break
      this.queuePos += 1
      this.ensureQueue()
    }
    if (this.queuePos >= this.queue.length) return null

    const unit = this.byId(this.queue[this.queuePos].instanceId)
    const mode = this.modeFor(unit)
    const enemies = this.units.filter((u) => u.side !== unit.side && u.isAlive)
    const validActions: ValidAction[] = []
    const attacks: ('atk1' | 'atk2')[] = unit.atk2Available ? ['atk1', 'atk2'] : ['atk1']
    for (const attack of attacks) {
      const isAOE = attack === 'atk1' ? unit.atk1IsAOE : unit.atk2IsAOE
      validActions.push({ attack, isAOE, targets: isAOE ? enemies : enemies })
    }

    return {
      turnNumber: this.turnNumber + 1,
      unit,
      needsInput: mode === 'manual',
      validActions,
    }
  }

  /**
   * "Прогнать бой до конца" - явный запрос доиграть ВЕСЬ бой сразу, включая ходы
   * сторон в ручном режиме (для них выбор делает та же ИИ-эвристика, что и для
   * авто-стороны). Раньше кнопка звала resolveTurn() только пока needsInput===false
   * и молча останавливалась на первом же ручном ходе - с дефолтной зеркальной
   * сборкой (один и тот же мутант с обеих сторон = равные скорости) это выглядело
   * как "кнопка не работает", когда ручная сторона выигрывала тай-брейк первого хода.
   */
  playToEnd(turnGuard = 3000): void {
    let guard = 0
    while (!this.isFinished() && guard < turnGuard) {
      const info = this.currentTurn()
      if (!info) break
      if (info.needsInput) {
        const aiChoice = chooseBestAttack(this.units, info.unit.instanceId)
        this.resolveTurn({ attack: aiChoice.attack, targetId: aiChoice.targetId ?? undefined })
      } else {
        this.resolveTurn()
      }
      guard += 1
    }
  }

  resolveTurn(choice?: TurnChoice): BattleStep {
    const info = this.currentTurn()
    if (!info) throw new Error('No active turn (fight already finished)')
    const unit = info.unit

    let attack: 'atk1' | 'atk2'
    let targetId: string | null

    if (info.needsInput) {
      if (!choice) throw new Error(`Turn for ${unit.name} requires a choice (manual mode)`)
      attack = choice.attack
      const isAOE = attack === 'atk1' ? unit.atk1IsAOE : unit.atk2IsAOE
      targetId = isAOE ? null : (choice.targetId ?? null)
      if (!isAOE && !targetId) throw new Error('Target required for single-target attack')
    } else {
      const aiChoice = chooseBestAttack(this.units, unit.instanceId)
      attack = aiChoice.attack
      targetId = aiChoice.targetId
    }

    this.turnNumber += 1
    const outcome = applyAttack(this.units, unit.instanceId, attack, targetId, this.rng)
    this.units = outcome.units

    // slash - тикает в конце хода поражённого юнита (здесь: атакующего этого хода,
    // раз именно сейчас его ход подошёл к концу), фикс. магнитуда, не расходуется.
    let slashTick = 0
    let slashTickDied = false
    const live = this.byId(unit.instanceId)
    if (live.isAlive) {
      slashTick = tickSlash(live)
      if (slashTick > 0) {
        live.hp = Math.max(0, live.hp - slashTick)
        if (live.hp === 0) {
          live.isAlive = false
          slashTickDied = true
        }
      }
    }

    const nameOf = (id: string) => this.byId(id).name
    const hits: BattleStepHit[] = outcome.events.map((e) => ({
      targetId: e.targetId,
      targetName: nameOf(e.targetId),
      damage: e.damage,
      crit: e.crit,
      shieldAbsorbed: e.shieldAbsorbed,
      died: e.died,
      baseDamage: e.baseDamage,
      typeModPct: e.typeModPct,
      buffDamage: e.buffDamage,
      buffPct: e.buffPct,
    }))
    // targetName здесь - имя юнита, СОВЕРШАЮЩЕГО контратаку (e.attackerId), не того,
    // кто её получает (e.targetId === unit.instanceId, исходный атакующий этого хода) -
    // иначе лог "${targetName} контратакует ${unit.name}" показывал одно и то же имя
    // дважды (баг: раньше нейминг ошибочно копировался из обычных hits, где семантика
    // targetId обратная - там это цель атаки, а не автор контратаки).
    const retaliateHits: BattleStepHit[] = outcome.retaliateEvents.map((e) => ({
      targetId: e.attackerId,
      targetName: nameOf(e.attackerId),
      damage: e.damage,
      crit: false,
      shieldAbsorbed: e.shieldAbsorbed,
      died: e.died,
      baseDamage: e.baseDamage,
      typeModPct: 0,
      buffDamage: 0,
    }))

    // Разбивка вида "база 10000 × крит2 × тип+25% + бафф+40%" - только реально
    // сработавшие множители (не захламляем строку "×1"/"+0%" когда они нейтральны).
    const loc = this.locale
    function breakdown(h: BattleStepHit): string {
      const parts: string[] = [t('pvp.log.base', loc).replace('{n}', String(h.baseDamage))]
      if (h.crit) parts.push(t('pvp.log.critMultiplier', loc))
      if (h.typeModPct)
        parts.push(
          t('pvp.log.typeMod', loc).replace('{sign}', h.typeModPct > 0 ? '+' : '').replace('{pct}', String(h.typeModPct)),
        )
      if (h.buffPct)
        parts.push(
          t('pvp.log.buffMod', loc)
            .replace('{sign}', h.buffPct > 0 ? '+' : '')
            .replace('{pct}', String(h.buffPct))
            .replace('{dmg}', String(h.buffDamage)),
        )
      return parts.length > 1 ? ` [${parts.join(', ')}]` : ''
    }

    // Имена дублей внутри ОДНОЙ стороны уже разведены нумерацией (PvpSimulator.svelte
    // disambiguateNames, "Робот I/II/III"), но на зеркальном матчапе обе стороны
    // нумеруются НЕЗАВИСИМО - "моя Робот I" и "вражья Робот I" совпадают текстом,
    // и в строке лога это снова читалось бы как самоатака. Цель/контратакующий тут
    // ВСЕГДА на противоположной стороне от unit (атаки бьют только по врагу) - если
    // имя всё равно совпало с unit.name, помечаем сторону явно. Тег читается с точки
    // зрения читателя лога ("моя команда"/"оппонент" - те же слова, что в остальном
    // UI), а не с точки зрения unit: если unit - враг, а совпавшая по имени цель раз
    // атаки всегда межсторонние - значит на МОЕЙ стороне, это "(моя команда)", не
    // "(союзник)" - у unit'а тут в принципе нет союзников, слово вводило в заблуждение.
    function sideTag(otherName: string): string {
      if (otherName !== unit.name) return ''
      return unit.side === 'mine' ? t('pvp.log.enemyTag', loc) : t('pvp.log.mineTag', loc)
    }
    const shieldSuffix = (n: number) => (n ? t('pvp.log.shieldAbsorbed', loc).replace('{n}', String(n)) : '')
    const diedSuffix = (died: boolean) => (died ? t('pvp.log.died', loc) : '')

    const turnLines: string[] = []
    for (const h of hits) {
      turnLines.push(
        t('pvp.log.hit', loc)
          .replace('{attacker}', unit.name)
          .replace('{target}', h.targetName)
          .replace('{tag}', sideTag(h.targetName))
          .replace('{damage}', String(h.damage))
          .replace('{breakdown}', breakdown(h))
          .replace('{shield}', shieldSuffix(h.shieldAbsorbed))
          .replace('{died}', diedSuffix(h.died)),
      )
    }
    for (const r of retaliateHits) {
      turnLines.push(
        t('pvp.log.retaliate', loc)
          .replace('{target}', r.targetName)
          .replace('{tag}', sideTag(r.targetName))
          .replace('{attacker}', unit.name)
          .replace('{damage}', String(r.damage))
          .replace('{shield}', shieldSuffix(r.shieldAbsorbed))
          .replace('{died}', diedSuffix(r.died)),
      )
    }
    if (slashTick > 0) {
      turnLines.push(
        t('pvp.log.slashTick', loc)
          .replace('{attacker}', unit.name)
          .replace('{n}', String(slashTick))
          .replace('{died}', diedSuffix(slashTickDied)),
      )
    }
    this.turnLog.push({
      turnNumber: this.turnNumber,
      attackerName: unit.name,
      attackerSide: unit.side,
      lines: turnLines,
    })

    this.queuePos += 1

    return {
      turnNumber: this.turnNumber,
      attackerId: unit.instanceId,
      attackerName: unit.name,
      attack,
      hits,
      retaliateHits,
      slashTick,
      slashTickDied,
    }
  }
}

export function createBattleSession(
  myTeam: CombatUnit[],
  enemyTeam: CombatUnit[],
  myMode: FighterMode,
  enemyMode: FighterMode,
  rng: () => number = Math.random,
  locale: Locale = 'ru',
): BattleSession {
  return new BattleSession(myTeam, enemyTeam, myMode, enemyMode, rng, locale)
}
