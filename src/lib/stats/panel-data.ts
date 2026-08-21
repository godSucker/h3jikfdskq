/**
 * Pure, framework-free port of the stat-panel computation from
 * StatsCalculator.svelte (normalizeMutants + calcStats + calcAbilityRows +
 * buildAttackRows + type/tier labels + orb modifiers). Single source of
 * truth shared between the interactive calculator and the stats-card
 * renderer (Telegram bot) - numbers must match exactly, not "look close".
 */
import { calculateFinalStats } from './unified-calculator'
import { applySpeedSphere } from './speed-sphere-table'
import { TYPE_RU, typeLabelL, abilityLabelL } from '@/lib/mutant-dicts'
import { baseMutantId } from '@/lib/utils'
import orbsRaw from '@/data/materials/orbs.json'

export type Locale = string

export interface OrbModifiers {
  hpPct?: number
  atk1Pct?: number
  atk2Pct?: number
  speedPct?: number
  abilityBonus?: Record<string, number>
}

function numberOr(val: unknown, fallback: number): number {
  const num = Number(val)
  return Number.isFinite(num) ? num : fallback
}

function firstDefined(...values: unknown[]): unknown {
  for (const val of values) {
    if (val === undefined || val === null) continue
    if (typeof val === 'string' && val.trim() === '') continue
    return val
  }
  return null
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (!lower) return false
    if (['false', 'no', '0'].includes(lower)) return false
    return true
  }
  return Boolean(value)
}

function niceLabel(value: unknown): string {
  const s = String(value || '').trim()
  if (!s) return '—'
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function readableType(raw: unknown, locale: Locale): string {
  const val = String(raw || '').trim()
  if (!val) return '—'
  return TYPE_RU[val] ? typeLabelL(val, locale as any) : niceLabel(val)
}

const TYPE_ICON: Record<string, string> = {
  default: '/mut_icons/icon_special.webp',
  special: '/mut_icons/icon_special.webp',
  heroic: '/mut_icons/icon_heroic.webp',
  legend: '/mut_icons/icon_legendary.webp',
  legends: '/mut_icons/icon_legendary.webp',
  legendary: '/mut_icons/icon_legendary.webp',
  gacha: '/mut_icons/icon_gacha.webp',
  reactor: '/mut_icons/icon_gacha.webp',
  pvp: '/mut_icons/icon_pvp.webp',
  seasonal: '/mut_icons/icon_seasonal.webp',
  recipe: '/mut_icons/icon_recipe.webp',
  videogame: '/mut_icons/icon_videogame.webp',
  video_game: '/mut_icons/icon_videogame.webp',
  morphology: '/mut_icons/icon_morphology.webp',
  zodiac: '/mut_icons/icon_zodiac.webp',
  limited: '/mut_icons/limited.webp',
  community: '/mut_icons/icon_special.webp',
  реактор: '/mut_icons/icon_gacha.webp',
}

// Port of typeIconPath() from StatsCalculator.svelte - NOT the same mapping
// as mutant-icons.ts's getTypeIcon() (that one special-cases 'default' to
// icon_morphology; the live component doesn't call getTypeIcon at all, it
// looks straight into TYPE_ICON with a generic fallback pattern).
function typeIconPath(typeKey: unknown): string {
  const raw = String(typeKey || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (TYPE_ICON[lower]) return TYPE_ICON[lower]
  return `/mut_icons/icon_${lower}.webp`
}

function readableTier(raw: unknown): string {
  const val = String(raw || '').trim()
  if (!val) return '—'
  return val
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function slotsForType(type: string): number {
  const key = String(type || '')
    .trim()
    .toLowerCase()
  if (key === 'default') return 1
  if (key === 'heroic') return 3
  return 2
}

function normalizeAttackGene(raw: unknown): string {
  const val = String(raw ?? '').trim()
  if (!val) return ''
  const lower = val.toLowerCase()
  if (lower === 'neutral' || lower === 'none' || lower === 'all') return 'neutro'
  return lower
}

const ATTACK_GENE_ICON: Record<string, string> = {
  '': '/genes/gene_all.webp',
  a: '/genes/gene_a.webp',
  b: '/genes/gene_b.webp',
  c: '/genes/gene_c.webp',
  d: '/genes/gene_d.webp',
  e: '/genes/gene_e.webp',
  f: '/genes/gene_f.webp',
  neutro: '/genes/gene_all.webp',
}

function attackGeneIconPath(code: string): string {
  const key = normalizeAttackGene(code)
  if (!key) return ''
  return ATTACK_GENE_ICON[key] || ''
}

function niceAttackLabel(index: number, rawName: unknown, fallback: string): string {
  const label = String(rawName ?? '').trim()
  if (label) return label
  return fallback.replace('{n}', String(index))
}

interface AttackMeta {
  gene: string
  geneIcon: string
  isAoe: boolean
  label: string
}

function buildAttackMeta(
  mutant: any,
  locale: Locale,
  names: Record<string, any>,
): Record<number, AttackMeta> {
  const base = mutant?.base_stats ?? {}
  const lvl1 = base?.lvl1 ?? {}
  const lvl30 = base?.lvl30 ?? {}
  const meta: Record<number, AttackMeta> = {}
  for (const idx of [1, 2]) {
    const geneRaw = firstDefined(
      mutant?.[`atk${idx}_gene`],
      base?.[`atk${idx}_gene`],
      lvl30?.[`atk${idx}_gene`],
      lvl1?.[`atk${idx}_gene`],
    )
    const aoeRaw = firstDefined(
      base?.[`atk${idx}_AOE`],
      lvl30?.[`atk${idx}_AOE`],
      lvl1?.[`atk${idx}_AOE`],
    )
    const localizedAtkName =
      locale !== 'ru' ? names[baseMutantId(mutant?.id)]?.[`atk${idx}Name`] : null
    const nameRaw =
      localizedAtkName ||
      firstDefined(
        mutant?.[`name_attack${idx}`],
        base?.[`atk${idx}_name`],
        lvl30?.[`atk${idx}_name`],
        lvl1?.[`atk${idx}_name`],
      )
    const gene = normalizeAttackGene(geneRaw)
    meta[idx] = {
      gene,
      geneIcon: attackGeneIconPath(gene),
      isAoe: toBoolean(aoeRaw),
      label: niceAttackLabel(idx, nameRaw, 'Атака {n}'),
    }
  }
  return meta
}

function abilityUpgradeTier(code: string): number {
  const lower = String(code || '').toLowerCase()
  if (!lower) return 0
  if (lower.endsWith('_plus_plus')) return 2
  if (lower.endsWith('_plus')) return 1
  return 0
}

function abilityBaseCode(code: string): string {
  return String(code || '')
    .toLowerCase()
    .replace(/_plus_plus$/i, '')
    .replace(/_plus$/i, '')
}

function cleanAbilityCode(raw: unknown): string {
  const name = String(raw || '').trim()
  if (!name) return ''
  const match = name.match(/^([a-zA-Z0-9_]+)/)
  return (match ? match[1] : name).toLowerCase()
}

function toNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function abilityLabel(code: string, locale: Locale): string {
  if (!code) return '—'
  const resolved = abilityLabelL(code, locale as any)
  const ru = resolved !== code ? resolved : niceLabel(code)
  const lower = code.toLowerCase()
  if (lower.endsWith('_plus_plus')) return `${ru} ++`
  if (lower.endsWith('_plus')) return `${ru} +`
  return ru
}

function hasAbilityValue(entry: any, prefix: string): boolean {
  if (!entry || typeof entry !== 'object') return false
  const keys = Object.keys(entry)
  return keys.some(
    (k) => k.toLowerCase().startsWith(prefix.toLowerCase()) && entry[k] != null && entry[k] !== '',
  )
}

function abilityAppliesTo(entry: any, key: string): boolean {
  const lowerKey = key.toLowerCase()
  if (lowerKey === 'atk1')
    return hasAbilityValue(entry, 'value_atk1') || hasAbilityValue(entry, 'atk1')
  if (lowerKey === 'atk2')
    return hasAbilityValue(entry, 'value_atk2') || hasAbilityValue(entry, 'atk2')
  return true
}

interface AbilityEntry {
  code: string
  label: string
  baseCode: string
  tier: number
  pct: number | null
  hasAtk1: boolean
  hasAtk2: boolean
  raw: any
}

function normalizeAbilityEntry(entry: any, locale: Locale): AbilityEntry | null {
  if (!entry) return null
  if (typeof entry === 'string') {
    const code = cleanAbilityCode(entry)
    if (!code) return null
    return {
      code,
      label: abilityLabel(code, locale),
      baseCode: abilityBaseCode(code),
      tier: abilityUpgradeTier(code),
      pct: null,
      hasAtk1: true,
      hasAtk2: true,
      raw: null,
    }
  }
  if (typeof entry === 'object') {
    const code = cleanAbilityCode(entry.name ?? entry.id ?? entry.code ?? '')
    if (!code) return null
    const pct = toNumber(entry.pct ?? entry.percent ?? entry.percentage ?? entry.value)
    const hasAtk1 = abilityAppliesTo(entry, 'atk1')
    let hasAtk2 = abilityAppliesTo(entry, 'atk2')
    if (code.includes('retaliate')) hasAtk2 = false
    return {
      code,
      label: abilityLabel(code, locale),
      baseCode: abilityBaseCode(code),
      tier: abilityUpgradeTier(code),
      pct,
      hasAtk1,
      hasAtk2,
      raw: entry,
    }
  }
  return null
}

function abilitySource(m: any): any[] {
  const raw = m?.abilities ?? []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') return raw.split(/[;,]/)
  return []
}

function normalizeAbilities(m: any, locale: Locale): AbilityEntry[] {
  return abilitySource(m)
    .map((entry) => normalizeAbilityEntry(entry, locale))
    .filter((x): x is AbilityEntry => x !== null)
}

function abilityBaseKey(raw: unknown): string {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .split('#')[0]
  if (!base) return ''
  return abilityBaseCode(base)
}

export function abilityIconPath(code: string): string {
  const raw = String(code || '')
    .trim()
    .toLowerCase()
  if (!raw) return ''
  const stripped = raw.replace(/_plus_plus$/i, '').replace(/_plus$/i, '')
  if (stripped === 'ability_regen') return '/ability/ability_regenerate.webp'
  return `/ability/${stripped}.webp`
}

// --- Orb catalog + modifiers (port of enrichOrb/orbEffectsFromId/
// specialAbilityFromOrb/calcOrbModifiers from StatsCalculator.svelte) ---

interface RawOrb {
  id: string
  name: string
  percent: string
  description?: string
}

export interface EnrichedOrb {
  id: string
  name: string
  category: 'basic' | 'special'
  icon: string
  atkPct?: number
  hpPct?: number
  speedPct?: number
  abilityPct?: number
  abilityCode?: string
  abilityBaseCode?: string
  abilityLabel?: string
  specialAbility: AbilityEntry | null
}

function isTemporaryOrbId(id: string): boolean {
  const key = id.toLowerCase()
  return key.includes('ephemeral') || key.includes('temporary')
}

// Mirrors buildOrbCatalog's tier filter: for attack/life/speed and the
// ability-type basics (incl. their special "add_" counterparts, since the
// id.includes() checks below match both), only tier _03+ is actually
// offered in the real orb picker.
function isSelectableOrbId(id: string): boolean {
  const gated =
    id.endsWith('attack') ||
    id.endsWith('attack_01') ||
    id.endsWith('attack_02') ||
    id.endsWith('life') ||
    id.endsWith('life_01') ||
    id.endsWith('life_02') ||
    id.endsWith('speed') ||
    id.endsWith('speed_01') ||
    id.endsWith('speed_02') ||
    id.includes('critical') ||
    id.includes('regenerate') ||
    id.includes('retaliate') ||
    id.includes('shield') ||
    id.includes('slash') ||
    id.includes('strengthen') ||
    id.includes('weaken')
  if (!gated) return true
  return /_0[3-7]$/.test(id)
}

function specialAbilityCodeFromKey(key: string): string {
  const normalized = String(key || '')
    .trim()
    .toLowerCase()
  if (!normalized) return ''
  if (normalized.startsWith('regenerate')) return 'ability_regen'
  if (normalized.startsWith('retaliate')) return 'ability_retaliate'
  if (normalized.startsWith('shield')) return 'ability_shield'
  if (normalized.startsWith('slash')) return 'ability_slash'
  if (normalized.startsWith('strengthen')) return 'ability_strengthen'
  if (normalized.startsWith('weaken')) return 'ability_weaken'
  return ''
}

function specialAbilityFromOrb(id: string, percent: number): AbilityEntry | null {
  const match = String(id || '')
    .toLowerCase()
    .match(/^orb_special_add([a-z_]+)/)
  if (!match) return null
  const code = specialAbilityCodeFromKey(match[1])
  if (!code) return null
  const pct = toNumber(percent)
  if (pct === null) return null
  const base = abilityBaseCode(code)
  return {
    code,
    label: abilityLabel(code, 'ru'),
    baseCode: base,
    tier: 0,
    pct,
    hasAtk1: true,
    hasAtk2: !base.includes('retaliate'),
    raw: { source: 'special-orb', id },
  }
}

function abilityCodeFromOrbId(id: string): string {
  const normalized = String(id || '')
    .trim()
    .toLowerCase()
  if (!normalized) return ''
  if (normalized.includes('regenerate')) return 'ability_regen'
  if (normalized.includes('retaliate')) return 'ability_retaliate'
  if (normalized.includes('shield')) return 'ability_shield'
  if (normalized.includes('slash')) return 'ability_slash'
  if (normalized.includes('strengthen')) return 'ability_strengthen'
  if (normalized.includes('weaken')) return 'ability_weaken'
  return ''
}

function enrichOrb(orb: RawOrb): EnrichedOrb {
  const id = String(orb.id || '').trim()
  const category: 'basic' | 'special' = id.startsWith('orb_special') ? 'special' : 'basic'
  const percent = Number(orb.percent ?? 0)
  const specialAbility = specialAbilityFromOrb(id, percent)
  const key = id.toLowerCase()
  const abs = Math.abs(percent)
  const effects: Partial<EnrichedOrb> = {}
  if (key.includes('attack')) effects.atkPct = percent
  else if (key.includes('health') || key.includes('_hp') || key.includes('life'))
    effects.hpPct = percent
  else if (key.includes('speed')) effects.speedPct = percent
  else if (!specialAbility) {
    const abilityCode = abilityCodeFromOrbId(id)
    if (abilityCode) {
      effects.abilityPct = abs
      effects.abilityCode = abilityCode
      effects.abilityBaseCode = abilityBaseCode(abilityCode)
      effects.abilityLabel = abilityLabel(abilityCode, 'ru')
    }
  }
  return {
    id,
    name: orb.name,
    category,
    icon: `/orbs/${category}/${id}.webp`,
    specialAbility,
    ...effects,
  }
}

const ORB_CATALOG: Map<string, EnrichedOrb> = new Map(
  (orbsRaw as RawOrb[])
    .filter((o) => !isTemporaryOrbId(o.id) && isSelectableOrbId(o.id))
    .map((o) => [o.id, enrichOrb(o)]),
)

export function resolveOrb(id: string | null | undefined): EnrichedOrb | null {
  if (!id) return null
  return ORB_CATALOG.get(id) ?? null
}

function calcOrbModifiers(
  basic: (EnrichedOrb | null)[],
  special: EnrichedOrb | null,
): OrbModifiers {
  const mods: OrbModifiers = { hpPct: 0, atk1Pct: 0, atk2Pct: 0, speedPct: 0, abilityBonus: {} }
  const all = [...basic.filter((o): o is EnrichedOrb => Boolean(o))]
  if (special) all.push(special)
  for (const orb of all) {
    if (orb.hpPct) mods.hpPct = (mods.hpPct ?? 0) + orb.hpPct
    if (orb.atkPct) {
      mods.atk1Pct = (mods.atk1Pct ?? 0) + orb.atkPct
      mods.atk2Pct = (mods.atk2Pct ?? 0) + orb.atkPct
    }
    if (orb.speedPct) mods.speedPct = (mods.speedPct ?? 0) + orb.speedPct
    if (orb.abilityPct) {
      const base = orb.abilityBaseCode
      if (base) {
        mods.abilityBonus![base] = (mods.abilityBonus![base] || 0) + orb.abilityPct
      } else {
        mods.abilityBonus!.__all = (mods.abilityBonus!.__all || 0) + orb.abilityPct
      }
    }
  }
  return mods
}

export interface NormalizedMutant {
  id: string
  name: string
  type: string
  typeLabel: string
  tier: string
  tierLabel: string
  genes: string[]
  hpBase: number
  atk1Base: number
  atk1PlusBase: number
  atk2Base: number
  atk2PlusBase: number
  speed: number
  bankBase: number
  abilityPct1: number
  abilityPct2: number
  abilities: AbilityEntry[]
  starMultipliers: Record<number, number>
  availableStars: Set<number>
  basicSlotCount: number
  specialSlotCount: number
  attackMeta: Record<number, AttackMeta>
  raw: any
}

const STAR_MULTIPLIERS: Record<number, number> = { 0: 1.0, 1: 1.1, 2: 1.3, 3: 1.75, 4: 2.0 }
const SPECIAL_SLOT_COUNT = 1

export function normalizeMutant(
  m: any,
  locale: Locale = 'ru',
  names: Record<string, any> = {},
): NormalizedMutant {
  const genesRaw = Array.isArray(m.genes) ? m.genes : [m.genes]
  const genes = genesRaw
    .filter(Boolean)
    .flatMap((g: string) =>
      String(g || '')
        .toUpperCase()
        .split(''),
    )
    .filter(Boolean)
  const baseStats = m.base_stats || {}
  const lvl1 = baseStats.lvl1 || {}
  const lvl30 = baseStats.lvl30 || {}
  const hpBase = numberOr(baseStats.hp_base, numberOr(lvl1.hp, 0))
  const atk1Base = numberOr(baseStats.atk1_base, numberOr(lvl1.atk1, 0))
  const atk1PlusBase = numberOr(baseStats.atk1p_base, numberOr(lvl30.atk1, atk1Base))
  const atk2Base = numberOr(baseStats.atk2_base, numberOr(lvl1.atk2, 0))
  const atk2PlusBase = numberOr(baseStats.atk2p_base, numberOr(lvl30.atk2, atk2Base))
  const speed = numberOr(baseStats.speed_base, numberOr(lvl30.spd, numberOr(lvl1.spd, m.speed)))
  const bankBase = numberOr(baseStats.bank_base, 0)
  const abilityPct1 = numberOr(baseStats.abilityPct1, 0)
  const abilityPct2 = numberOr(baseStats.abilityPct2, 0)

  const typeRaw = m.type ?? ''
  const tierRaw = m.tier ?? ''
  const typeKey = String(typeRaw || '').trim()
  const typeLabel = readableType(typeRaw, locale)
  const tierLabel = readableTier(tierRaw)
  const basicSlotCount = Number.isFinite(m.orbs?.normal)
    ? m.orbs.normal
    : slotsForType(typeKey.toLowerCase())
  const specialSlotCount = Number.isFinite(m.orbs?.special) ? m.orbs.special : SPECIAL_SLOT_COUNT

  const availableStars = new Set<number>()
  const mStars = m.stars ?? {}
  if (mStars.normal) availableStars.add(0)
  if (mStars.bronze) availableStars.add(1)
  if (mStars.silver) availableStars.add(2)
  if (mStars.gold) availableStars.add(3)
  if (mStars.platinum) availableStars.add(4)

  const bId = baseMutantId(String(m.id ?? '').trim())
  return {
    id: bId,
    name: (locale !== 'ru' && names[bId]?.name) || m.name,
    type: typeRaw,
    typeLabel,
    tier: tierRaw,
    tierLabel,
    genes,
    hpBase,
    atk1Base,
    atk1PlusBase,
    atk2Base,
    atk2PlusBase,
    speed,
    bankBase,
    abilityPct1,
    abilityPct2,
    abilities: normalizeAbilities(m, locale),
    starMultipliers: STAR_MULTIPLIERS,
    availableStars,
    basicSlotCount,
    specialSlotCount,
    attackMeta: buildAttackMeta(m, locale, names),
    raw: m,
  }
}

interface CalcStatsResult {
  hp: number
  atk1: number
  atk2: number
  speed: number
  bank: number
}

function calcStats(
  m: NormalizedMutant,
  level: number,
  starIndex: number,
  mods: OrbModifiers,
): CalcStatsResult {
  const starMul = m.starMultipliers[starIndex] ?? 1.0
  const result = calculateFinalStats(
    {
      hp_base: m.hpBase,
      atk1_base: m.atk1Base,
      atk1p_base: m.atk1PlusBase,
      atk2_base: m.atk2Base,
      atk2p_base: m.atk2PlusBase,
      speed_base: m.speed,
      bank_base: m.bankBase,
      abilityPct1: m.abilityPct1,
      abilityPct2: m.abilityPct2,
    },
    level,
    starMul,
  )
  let hp = result.hp
  let atk1 = result.atk1
  let atk2 = result.atk2
  let speed = result.speed
  if (mods.hpPct) hp = Math.round(result.hp * (1 + mods.hpPct / 100))
  if (mods.atk1Pct) atk1 = Math.round(result.atk1 * (1 + mods.atk1Pct / 100))
  if (mods.atk2Pct) atk2 = Math.round(result.atk2 * (1 + mods.atk2Pct / 100))
  if (mods.speedPct) speed = applySpeedSphere(result.speed, mods.speedPct)
  return { hp, atk1, atk2, speed, bank: result.silver }
}

interface AbilityRowValue {
  attack: number
  value: number
  label: string
  geneIcon: string
  isAoe: boolean
  attackPower: number
}

interface AbilityRow {
  code: string
  label: string
  values: AbilityRowValue[]
  icon: string
  percent: number
}

function calcAbilityRows(
  mutant: NormalizedMutant,
  statLine: CalcStatsResult,
  mods: OrbModifiers,
  level: number,
  specialOrb: EnrichedOrb | null = null,
): AbilityRow[] {
  const combined = [...mutant.abilities]
  if (specialOrb?.specialAbility) combined.push(specialOrb.specialAbility)
  if (!combined.length) return []
  const abilityBoosts = mods.abilityBonus ?? {}
  const atkValues: Record<number, number> = { 1: statLine.atk1, 2: statLine.atk2 }
  const grouped = new Map<string, AbilityEntry[]>()
  for (const ability of combined) {
    const base = ability.baseCode || ability.code
    if (!grouped.has(base)) grouped.set(base, [])
    grouped.get(base)!.push(ability)
  }

  const result: AbilityRow[] = []
  for (const [, entries] of grouped) {
    if (!entries.length) continue
    const sorted = [...entries].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))
    const ability = level >= 25 ? sorted[sorted.length - 1] : sorted[0]

    let basePct = 0
    if (ability.raw?.source === 'special-orb') {
      basePct = toNumber(ability.pct) ?? 0
    } else {
      basePct = level < 25 ? mutant.abilityPct1 || 0 : mutant.abilityPct2 || 0
    }
    if (!Number.isFinite(basePct)) continue

    const baseKey = abilityBaseKey(ability.baseCode || ability.code)
    const abilityBoost = Math.abs(abilityBoosts[baseKey] ?? abilityBoosts.__all ?? 0)
    const signedPct = basePct >= 0 ? basePct + abilityBoost : -(Math.abs(basePct) + abilityBoost)

    const values: AbilityRowValue[] = []
    const isRetaliate = ability.code.toLowerCase().includes('retaliate')

    if (ability.hasAtk1) {
      const meta = mutant.attackMeta[1] ?? ({} as AttackMeta)
      const value = Math.floor(Math.abs(((atkValues[1] || 0) * signedPct) / 100))
      values.push({
        attack: 1,
        value,
        label: meta.label ?? 'Атака 1',
        geneIcon: meta.geneIcon || '',
        isAoe: Boolean(meta.isAoe),
        attackPower: Math.floor(Math.abs(atkValues[1] || 0)),
      })
    }
    if (ability.hasAtk2) {
      const meta = mutant.attackMeta[2] ?? ({} as AttackMeta)
      const value = isRetaliate ? 0 : Math.floor(Math.abs(((atkValues[2] || 0) * signedPct) / 100))
      if (value || ability.hasAtk1 === false || !values.length || isRetaliate) {
        values.push({
          attack: 2,
          value,
          label: meta.label ?? 'Атака 2',
          geneIcon: meta.geneIcon || '',
          isAoe: Boolean(meta.isAoe),
          attackPower: Math.floor(Math.abs(atkValues[2] || 0)),
        })
      }
    }

    if (!values.length) continue
    result.push({
      code: ability.code,
      label: ability.label,
      values,
      icon: abilityIconPath(ability.code),
      percent: Math.abs(signedPct),
    })
  }
  return result
}

export interface AttackRowEffect {
  label: string
  percent: number | null
  value: number
  icon: string
}

export interface AttackRow {
  attack: number
  label: string
  geneIcon: string
  isAoe: boolean
  gene: string
  damage: number
  effects: AttackRowEffect[]
}

// atkMultipliers is a raw factor (1 = unchanged, 1.25 = +25%, 0.5 = -50%) -
// matches the live component's own state shape, applied at display time to
// both the attack's damage and every effect riding on that attack (mirrors
// the `Math.round(x * (atkMultipliers[attack] ?? 1))` calls in the template,
// not part of calcStats - the underlying stat block is unaffected).
function buildAttackRows(
  mutant: NormalizedMutant,
  statLine: CalcStatsResult,
  abilityList: AbilityRow[],
  atkMultipliers: { 1: number; 2: number } = { 1: 1, 2: 1 },
): AttackRow[] {
  const rows = [1, 2].map((idx) => {
    const meta = mutant.attackMeta[idx] ?? ({} as AttackMeta)
    const mult = (atkMultipliers as any)[idx] ?? 1
    const damage = Math.round(Number((statLine as any)[`atk${idx}`] ?? 0) * mult)
    const effects: AttackRowEffect[] = []
    for (const ability of abilityList) {
      const hit = ability.values.find((val) => val.attack === idx)
      if (!hit) continue
      effects.push({
        label: ability.label,
        percent: ability.percent,
        value: Math.round(hit.value * mult),
        icon: ability.icon,
      })
    }
    return {
      attack: idx,
      label: meta.label || `Атака ${idx}`,
      geneIcon: meta.geneIcon || '',
      isAoe: Boolean(meta.isAoe),
      gene: meta.gene || '',
      damage,
      effects,
    }
  })
  return rows.filter((row) => row.label || row.damage || row.effects.length)
}

export interface PanelData {
  name: string
  portraitPath: string
  typeLabel: string
  typeIcon: string
  tierLabel: string
  genes: string[]
  hp: number
  attackRows: AttackRow[]
  speed: number
  silver: number
  basicSlotCount: number
  specialSlotCount: number
  basicOrbs: (EnrichedOrb | null)[]
  specialOrb: EnrichedOrb | null
  availableStars: number[]
}

const STAR_KEY_BY_INDEX = ['normal', 'bronze', 'silver', 'gold', 'platinum']

// Simplified relative to figureImage()/starTexture() in StatsCalculator.svelte
// (which falls back through several "specimen" image-keyword searches) -
// good enough for a share card: the mutant's own star-tier image set always
// has a usable first entry.
function portraitPath(rawMutant: any, starIndex: number): string {
  const key = STAR_KEY_BY_INDEX[starIndex] ?? 'normal'
  let images = rawMutant.stars?.[key]?.images
  // Some mutants only exist at one tier (e.g. platinum-exclusive specials) -
  // 'normal' isn't guaranteed to exist. Fall back to whatever tier actually
  // has images rather than sending an empty path to the CDN (that 403s and
  // takes the whole render down, per the original crash report).
  if (!images?.length) {
    for (const fallbackKey of STAR_KEY_BY_INDEX) {
      images = rawMutant.stars?.[fallbackKey]?.images
      if (images?.length) break
    }
  }
  return '/' + (images?.[0] ?? '')
}

export function buildPanelData(
  rawMutant: any,
  opts: {
    level: number
    starIndex: number
    locale?: Locale
    names?: Record<string, any>
    basicOrbIds?: (string | null)[]
    specialOrbId?: string | null
    atkMultipliers?: { 1: number; 2: number }
  },
): PanelData {
  const locale = opts.locale ?? 'ru'
  const mutant = normalizeMutant(rawMutant, locale, opts.names ?? {})
  // Always pad/truncate to basicSlotCount - mirrors the live component's own
  // `basicSlots = Array(count).fill(null)` reset, so a caller that passes
  // fewer ids than the mutant actually has slots still gets the right
  // number of (empty) slots back, not a shorter array.
  const basicOrbIds = Array.from(
    { length: mutant.basicSlotCount },
    (_, i) => opts.basicOrbIds?.[i] ?? null,
  )
  const basicOrbs = basicOrbIds.map((id) => resolveOrb(id))
  const specialOrb = resolveOrb(opts.specialOrbId)
  const mods = calcOrbModifiers(basicOrbs, specialOrb)
  const stats = calcStats(mutant, opts.level, opts.starIndex, mods)
  const abilityRows = calcAbilityRows(mutant, stats, mods, opts.level, specialOrb)
  const attackRows = buildAttackRows(mutant, stats, abilityRows, opts.atkMultipliers)
  return {
    name: mutant.name,
    portraitPath: portraitPath(rawMutant, opts.starIndex),
    typeLabel: mutant.typeLabel,
    typeIcon: typeIconPath(mutant.type),
    tierLabel: mutant.tierLabel,
    genes: mutant.genes,
    hp: stats.hp,
    attackRows,
    speed: stats.speed,
    silver: stats.bank,
    basicSlotCount: mutant.basicSlotCount,
    specialSlotCount: mutant.specialSlotCount,
    basicOrbs,
    specialOrb,
    availableStars: Array.from(mutant.availableStars).sort((a, b) => a - b),
  }
}
