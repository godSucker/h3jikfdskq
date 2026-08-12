/**
 * Собирает выбор игрока (мутант + уровень + звезда + орбы + чармы) в готовый
 * боевой профиль для PvP-движка. Переиспользует calculateFinalStats/applySpeedSphere
 * как единственный источник правды по масштабированию статов - здесь только
 * добавляется то, чего в них нет (орб-модификаторы, крит%, способность).
 *
 * Логика орбов/абилок продублирована (не импортирована) из StatsCalculator.svelte
 * (orbEffectsFromId/calcOrbModifiers/calcAbilityRows, ~L334-1019) - тот компонент
 * не экспортирует эти функции, а трогать рабочий 3000-строчный файл ради экспорта
 * не оправдано. Дублирование минимальное и однонаправленное: если формулы там
 * поменяются, это не обязано ломать PvP (и наоборот).
 */

import mutantsRaw from '@/data/mutants/mutants.json'
import orbsRaw from '@/data/materials/orbs.json'
import charmsRaw from '@/data/materials/charms.json'
import { calculateFinalStats } from '@/lib/stats/unified-calculator'
import { applySpeedSphere } from '@/lib/stats/speed-sphere-table'
import type { Gene } from './type-table'

export type AbilityKind = 'shield' | 'regen' | 'retaliate' | 'slash' | 'strengthen' | 'weaken'

const ATK2_UNLOCK_LEVEL = 5

/** Макс. заряды strengthen (Effect strengthen_01 stackMax="2" в abilitydefinitions_decoded.xml). */
export const STRENGTHEN_STACK_MAX = 2

/**
 * Реального лимита уровня в игре нет ("Уровень эво/мутанта/игрока - без лимита",
 * /guides "Скрытые лимиты чисел") - единственный настоящий потолок это int32-баг:
 * итоговое HP мутанта, посчитанное по формуле роста (base × star × (level/10+0.9)),
 * переполняется и уходит в минус выше ≈21 474 836 (≈2^31/100 - хранится как
 * fixed-point ×100), причём HP-сферы опускают порог ещё ниже. 30 - произвольная
 * заглушка предыдущей версии калькулятора, не игровое ограничение; теперь порог
 * считается индивидуально на мутанта (влияют hp_base, звезда, HP-орбы).
 */
export const HP_OVERFLOW_THRESHOLD = 21_474_836

/** Наибольший уровень, при котором итоговое HP ещё не переполняется (см. выше).
 *  hpAtBaseLevelScale - hp_base × starMultiplier × (1 + hpOrbPct/100), т.е. HP при
 *  levelScale=1 (до применения роста по уровню) - инверсия формулы `level/10+0.9`. */
export function maxLevelForHp(hpAtBaseLevelScale: number): number {
  if (!(hpAtBaseLevelScale > 0)) return 1
  const level = 10 * (HP_OVERFLOW_THRESHOLD / hpAtBaseLevelScale - 0.9)
  return Math.max(1, Math.floor(level))
}

export interface CombatAbility {
  kind: AbilityKind
  /** Сырой % способности из данных мутанта - магнитуда всегда считается от
   *  ФАКТИЧЕСКОГО урона конкретного удара (damageGiven/damageTaken), не от
   *  этого поля напрямую - см. abilities.ts. */
  pct: number
}

export interface CombatUnit {
  instanceId: string
  mutantId: string
  name: string
  side: 'mine' | 'enemy'
  /** Собственный ген мутанта (защитный - используется как targetGene в type-modifier). */
  gene: Gene
  /** Второй ген мутанта, если есть (только для отображения - на модификатор урона
   *  не влияет, боевая математика везде использует один, первый/защитный ген). */
  gene2?: Gene
  /** Относительный путь текстуры (stars[star].images[0]) - оборачивать textureUrl() при рендере. */
  portraitUrl: string
  hp: number
  maxHp: number
  atk1: number
  atk1Gene: Gene
  atk1IsAOE: boolean
  /** РУ-название атаки 1 (mutant.name_attack1) - для UI вместо родового "Атака 1". */
  attack1Name: string
  atk2: number
  atk2Gene: Gene
  atk2IsAOE: boolean
  /** РУ-название атаки 2 (mutant.name_attack2) - для UI вместо родового "Атака 2". */
  attack2Name: string
  /** Атака 2 анлочится на 5 уровне (gamedefinitions.xml, Tag unlockAttack="1:1:..;2:5:..;1p:10:..;2p:15:..").
   *  Универсально для 708/711 мутантов; 3 уникальных/легендарных исключения (разный
   *  уровень анлока/переключения тира вплоть до 50) не моделируются - та же степень
   *  точности, что уже принята в unified-calculator.ts для порогов 10/15. */
  atk2Available: boolean
  speedX100: number
  /** Свой крит-чарм + крит-орбы - повышает МОЙ шанс крита при атаке. */
  critCharmBonusPct: number
  /** Свой антикрит-чарм - снижает шанс крита ПРОТИВНИКА, когда он бьёт меня (не свой крит!). */
  anticritBonusPct: number
  ability: CombatAbility | null
  isAlive: boolean

  /** Персистентный стейт эффектов способностей (abilitydefinitions_decoded.xml,
   *  см. src/lib/pvp/abilities.ts) - не мгновенные, переживают между ходами. */
  /** Пул щита (Effect shield_01, property="shield") - поглощает будущий входящий
   *  урон, пока не иссякнет. Новое применение ЗАМЕНЯЕТ пул (stackMax="1"), не складывает. */
  shieldPool: number
  /** Забаненные заряды strengthen (Effect strengthen_01, stackMax="2") - каждый
   *  даёт +ability.pct% к СЛЕДУЮЩЕЙ собственной атаке владельца, расходуется по 1. */
  strengthenCharges: number
  /** Заряд weaken, полученный от чужой способности (Effect weaken_01, stackMax="0" -
   *  трактуем как "не стакуется", новое применение заменяет). weakenPct - % источника,
   *  т.к. может прийти от разных врагов. */
  weakenCharge: boolean
  weakenPct: number
  /** Фиксированный урон/ход от slash (Effect slash_01, counter="0" - "repeated until
   *  the end of the fight"). Снэпшотится в момент удара (% от damageTaken тогда),
   *  тикает в конце каждого хода поражённого юнита. 0 = не активен. */
  slashDot: number
}

export interface OrbSelection {
  basicOrbIds: (string | null)[]
  specialOrbId: string | null
}

export interface BuildUnitOptions {
  level: number
  star: 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
  side: 'mine' | 'enemy'
  orbs?: OrbSelection
  critCharmActive?: boolean
  anticritCharmActive?: boolean
  instanceId?: string
}

interface RawOrb {
  id: string
  percent?: number | string
  pct?: number | string
}

interface OrbEffects {
  hpPct: number
  atk1Pct: number
  atk2Pct: number
  speedPct: number
  critPct: number
  abilityBonus: { kind: AbilityKind; pct: number } | null
}

const ORB_MAP: Map<string, RawOrb> = new Map(
  (Array.isArray(orbsRaw) ? (orbsRaw as RawOrb[]) : []).map((o) => [String(o.id || '').trim(), o]),
)

// mutants.json - JSON-массив (не объект, ключи по id!), см. src/data/mutants/mutants.json.
// Индекс строится один раз при загрузке модуля для O(1) поиска по id.
const MUTANT_MAP: Map<string, any> = new Map(
  (Array.isArray(mutantsRaw) ? (mutantsRaw as any[]) : []).map((m) => [String(m.id || ''), m]),
)

function abilityKindFromCode(code: string): AbilityKind | null {
  const normalized = String(code || '').toLowerCase()
  if (normalized.includes('regenerate') || normalized.includes('regen')) return 'regen'
  if (normalized.includes('retaliate')) return 'retaliate'
  if (normalized.includes('shield')) return 'shield'
  if (normalized.includes('slash')) return 'slash'
  if (normalized.includes('strengthen')) return 'strengthen'
  if (normalized.includes('weaken')) return 'weaken'
  return null
}

/** Эффекты одной сферы. Дублирует orbEffectsFromId, + добавляет отсутствующую в
 *  StatsCalculator.svelte crit-ветку (crit-орбы там каталогизируются, но ни на что
 *  не влияют - известный пробел, см. план). */
function orbEffects(orb: RawOrb | undefined): Partial<OrbEffects> {
  if (!orb) return {}
  const id = String(orb.id || '').toLowerCase()
  const pct = Number(orb.percent ?? orb.pct ?? 0)
  if (!Number.isFinite(pct)) return {}
  if (id.includes('critical')) return { critPct: pct }
  if (id.includes('attack')) return { atk1Pct: pct, atk2Pct: pct }
  if (id.includes('health') || id.includes('_hp') || id.includes('life')) return { hpPct: pct }
  if (id.includes('speed')) return { speedPct: pct }
  // orb_special_add<ability> - спец-орб, выдаёт/усиливает именную способность
  const addMatch = id.match(/^orb_special_add([a-z_]+)/)
  const kind = addMatch ? abilityKindFromCode(addMatch[1]) : abilityKindFromCode(id)
  if (kind) return { abilityBonus: { kind, pct: Math.abs(pct) } }
  return {}
}

/** Только HP% от выбранных орбов - для UI-подсказки макс. уровня в TeamBuilder
 *  (полный расчёт см. collectOrbModifiers, не экспортируется целиком чтобы не тащить
 *  наружу внутренний тип OrbEffects). */
export function orbHpBonusPct(orbs: OrbSelection | undefined): number {
  return collectOrbModifiers(orbs).hpPct
}

function collectOrbModifiers(orbs: OrbSelection | undefined): OrbEffects {
  const mods: OrbEffects = {
    hpPct: 0,
    atk1Pct: 0,
    atk2Pct: 0,
    speedPct: 0,
    critPct: 0,
    abilityBonus: null,
  }
  if (!orbs) return mods
  const ids = [...(orbs.basicOrbIds || []), orbs.specialOrbId].filter((id): id is string =>
    Boolean(id),
  )
  for (const id of ids) {
    const effects = orbEffects(ORB_MAP.get(id))
    if (effects.hpPct) mods.hpPct += effects.hpPct
    if (effects.atk1Pct) mods.atk1Pct += effects.atk1Pct
    if (effects.atk2Pct) mods.atk2Pct += effects.atk2Pct
    if (effects.speedPct) mods.speedPct += effects.speedPct
    if (effects.critPct) mods.critPct += effects.critPct
    if (effects.abilityBonus) mods.abilityBonus = effects.abilityBonus // спец-слот один, перезаписывать некому
  }
  return mods
}

function charmCritBonus(
  active: boolean | undefined,
  idPrefix: 'Charm_Critical' | 'Charm_Anticritical',
): number {
  if (!active) return 0
  const charms = Array.isArray(charmsRaw) ? (charmsRaw as { id: string; percent: string }[]) : []
  const charm = charms.find((c) => String(c.id || '').startsWith(idPrefix))
  const pct = Number(charm?.percent ?? 0)
  return Number.isFinite(pct) ? (idPrefix === 'Charm_Anticritical' ? -pct : pct) : 0
}

const GENE_SET = new Set(['A', 'B', 'C', 'D', 'E', 'F'])

function normalizeGene(raw: string | undefined): Gene {
  if (!raw) return 'neutro'
  const upper = String(raw).toUpperCase()
  return GENE_SET.has(upper) ? (upper as Gene) : 'neutro'
}

export function buildBattleUnit(mutantId: string, opts: BuildUnitOptions): CombatUnit {
  const mutant = MUTANT_MAP.get(mutantId)
  if (!mutant) throw new Error(`Unknown mutant id: ${mutantId}`)

  const starMul = mutant.stars?.[opts.star]?.multiplier ?? 1.0
  const bs = mutant.base_stats || {}
  const lvl1 = bs.lvl1 || {}
  const mods = collectOrbModifiers(opts.orbs)

  const maxLevel = maxLevelForHp((bs.hp_base ?? 0) * starMul * (1 + mods.hpPct / 100))
  const level = Math.max(1, Math.min(maxLevel, Math.floor(opts.level)))

  const baseResult = calculateFinalStats(
    {
      hp_base: bs.hp_base,
      atk1_base: bs.atk1_base,
      atk1p_base: bs.atk1p_base,
      atk2_base: bs.atk2_base,
      atk2p_base: bs.atk2p_base,
      speed_base: bs.speed_base,
      bank_base: bs.bank_base,
      abilityPct1: bs.abilityPct1,
      abilityPct2: bs.abilityPct2,
    },
    level,
    starMul,
  )

  const hp = Math.round(baseResult.hp * (1 + mods.hpPct / 100))
  const atk1 = Math.round(baseResult.atk1 * (1 + mods.atk1Pct / 100))
  const atk2 = Math.round(baseResult.atk2 * (1 + mods.atk2Pct / 100))
  const speedX100 = mods.speedPct
    ? applySpeedSphere(baseResult.speed, mods.speedPct)
    : baseResult.speed

  // Крит-чарм и крит-орбы повышают МОЙ шанс крита; антикрит-чарм снижает шанс крита
  // ПРОТИВНИКА против меня (не мой собственный) - считается отдельно, применяется
  // в момент удара к атакующему+цели вместе (см. resolve-attack.ts), не здесь.
  const critCharmBonusPct = charmCritBonus(opts.critCharmActive, 'Charm_Critical') + mods.critPct
  const anticritBonusPct = charmCritBonus(opts.anticritCharmActive, 'Charm_Anticritical')

  // Способность: своя (первая по массиву abilities мутанта, base/plus по уровню 25)
  // + возможный оверрайд/усиление спец-орбом.
  const abilityEntries: { name: string; pct: number }[] = Array.isArray(mutant.abilities)
    ? mutant.abilities
    : []
  let ability: CombatAbility | null = null
  if (abilityEntries.length) {
    const own =
      abilityEntries.find((a) => a.name.endsWith('_plus')) && level >= 25
        ? abilityEntries.find((a) => a.name.endsWith('_plus'))!
        : abilityEntries.find((a) => !a.name.endsWith('_plus')) || abilityEntries[0]
    const kind = abilityKindFromCode(own.name)
    if (kind) {
      const orbBonus =
        mods.abilityBonus && mods.abilityBonus.kind === kind ? mods.abilityBonus.pct : 0
      const pct = Math.abs(own.pct) + orbBonus
      ability = { kind, pct }
    }
  }
  if (!ability && mods.abilityBonus) {
    // спец-орб выдал способность мутанту, у которого своей не было
    ability = { kind: mods.abilityBonus.kind, pct: mods.abilityBonus.pct }
  }

  const ownGene = normalizeGene(Array.isArray(mutant.genes) ? mutant.genes[0] : undefined)
  const rawGene2 = Array.isArray(mutant.genes) ? mutant.genes[1] : undefined
  // Показываем второй ген как есть, без дедупликации против первого (по прямому
  // запросу пользователя) - даже genes: ["C","C"] даёт gene2 === gene.
  const gene2 = rawGene2 ? normalizeGene(rawGene2) : undefined
  const portraitUrl =
    mutant.stars?.[opts.star]?.images?.[0] || mutant.stars?.normal?.images?.[0] || ''

  return {
    instanceId: opts.instanceId || `${mutantId}-${Math.random().toString(36).slice(2, 9)}`,
    mutantId,
    name: mutant.name || mutantId,
    side: opts.side,
    gene: ownGene,
    gene2,
    portraitUrl,
    hp,
    maxHp: hp,
    atk1,
    atk1Gene: normalizeGene(bs.atk1_gene ?? lvl1.atk1_gene),
    atk1IsAOE: Boolean(bs.atk1_AOE ?? lvl1.atk1_AOE),
    attack1Name: mutant.name_attack1 || 'Атака 1',
    atk2,
    atk2Gene: normalizeGene(bs.atk2_gene ?? lvl1.atk2_gene),
    atk2IsAOE: Boolean(bs.atk2_AOE ?? lvl1.atk2_AOE),
    attack2Name: mutant.name_attack2 || 'Атака 2',
    atk2Available: level >= ATK2_UNLOCK_LEVEL,
    speedX100,
    critCharmBonusPct,
    anticritBonusPct,
    ability,
    isAlive: true,
    shieldPool: 0,
    strengthenCharges: 0,
    weakenCharge: false,
    weakenPct: 0,
    slashDot: 0,
  }
}
