/**
 * Каталог сфер + группировка по категориям для восьмиугольного пикера в TeamBuilder.svelte -
 * СКОПИРОВАНО (не импортировано) из StatsCalculator.svelte (groupOrbsByCategory, CAT_ORDER
 * и соседние константы, allowOrbForAbilities, getOrbingPresets, ~L1065-1140 и L416-453) - та же причина, что уже
 * описана в battle-profile.ts: тот компонент не экспортирует эти функции, а трогать рабочий
 * 3000-строчный файл ради экспорта не оправдано. Дублирование однонаправленное - если формулы
 * там поменяются, это не обязано ломать PvP (и наоборот).
 */

import orbsRaw from '@/data/materials/orbs.json'
import { orbingMap, type OrbCell } from '@/lib/orbing-map'
import { baseMutantId } from '@/lib/utils'
import type { AbilityKind } from './battle-profile'

export interface CatalogOrb {
  id: string
  name: string
  percent: number
  icon: string
  category: string
}

function isEphemeral(id: string): boolean {
  return id.includes('ephemeral')
}

export function orbCategoryKey(id: string): string {
  const key = id.toLowerCase()
  if (key.includes('attack')) return 'attack'
  if (key.includes('health') || key.includes('_hp') || key.includes('life')) return 'health'
  if (key.includes('speed')) return 'speed'
  if (key.includes('critical') || key.includes('crit')) return 'critical'
  if (key.includes('xp') || key.includes('experience')) return 'xp'
  if (key.includes('shield')) return 'shield'
  if (key.includes('regenerate')) return 'regenerate'
  if (key.includes('retaliate')) return 'retaliate'
  if (key.includes('slash')) return 'slash'
  if (key.includes('strengthen')) return 'strengthen'
  if (key.includes('weaken')) return 'weaken'
  return 'other'
}

function enrich(
  o: { id: string; name?: string; percent?: string | number },
  kind: 'basic' | 'special',
): CatalogOrb {
  const id = String(o.id)
  return {
    id,
    name: o.name || id,
    percent: Number(o.percent ?? 0),
    icon: `/orbs/${kind}/${id}.webp`,
    category: orbCategoryKey(id),
  }
}

const RAW_ORBS = orbsRaw as { id: string; name?: string; percent?: string | number }[]

// orb_basic_xp* - бонус к получаемому опыту, не влияет на бой (нет боевого эффекта в
// PvP-симуляторе) - убраны из выбора, тот же фильтр, что был в TeamBuilder.svelte раньше.
export const BASIC_ORBS: CatalogOrb[] = RAW_ORBS.filter(
  (o) => !isEphemeral(o.id) && o.id.startsWith('orb_basic') && !o.id.startsWith('orb_basic_xp'),
).map((o) => enrich(o, 'basic'))

export const SPECIAL_ORBS: CatalogOrb[] = RAW_ORBS.filter(
  (o) => !isEphemeral(o.id) && o.id.startsWith('orb_special'),
).map((o) => enrich(o, 'special'))

export const CAT_ORDER = [
  'attack',
  'health',
  'speed',
  'critical',
  'xp',
  'shield',
  'regenerate',
  'retaliate',
  'slash',
  'strengthen',
  'weaken',
  'other',
]

export const CAT_LABELS: Record<string, string> = {
  attack: 'Атака',
  health: 'Здоровье',
  speed: 'Скорость',
  critical: 'Крит',
  xp: 'Опыт',
  shield: 'Щит',
  regenerate: 'Вытягивание жизни',
  retaliate: 'Отражение',
  slash: 'Рана',
  strengthen: 'Усиление',
  weaken: 'Проклятие',
}

const CAT_ICONS: Record<string, string> = {
  attack: '/orbs/basic/orb_basic_attack_03.webp',
  health: '/orbs/basic/orb_basic_life_03.webp',
  speed: '/orbs/special/orb_special_speed_02.webp',
  critical: '/orbs/basic/orb_basic_critical_03.webp',
  shield: '/orbs/basic/orb_basic_shield.webp',
  regenerate: '/orbs/basic/orb_basic_regenerate.webp',
  retaliate: '/orbs/basic/orb_basic_retaliate.webp',
  slash: '/orbs/basic/orb_basic_slash.webp',
  strengthen: '/orbs/basic/orb_basic_strengthen.webp',
  weaken: '/orbs/basic/orb_basic_weaken.webp',
}

export interface OrbCategoryGroup {
  key: string
  label: string
  icon: string
  items: CatalogOrb[]
}

export function groupOrbsByCategory(
  list: CatalogOrb[],
  prefix: 'basic' | 'special',
): OrbCategoryGroup[] {
  const map = new Map<string, CatalogOrb[]>()
  for (const orb of list) {
    if (!map.has(orb.category)) map.set(orb.category, [])
    map.get(orb.category)!.push(orb)
  }
  const result: OrbCategoryGroup[] = []
  for (const k of CAT_ORDER) {
    const items = map.get(k)
    if (items && items.length > 0) {
      const fallback = CAT_ICONS[k] ? CAT_ICONS[k].replace('/orbs/basic/', `/orbs/${prefix}/`) : ''
      result.push({ key: k, label: CAT_LABELS[k] || k, icon: items[0]?.icon || fallback, items })
    }
  }
  return result
}

/** Категория ability-типа basic-орба -> AbilityKind движка (battle-profile.ts). Категории
 *  вне этой карты (attack/health/speed/critical/xp/other) не про способности - фильтр
 *  ниже их не трогает, показываются всегда. */
const CATEGORY_ABILITY_KIND: Partial<Record<string, AbilityKind>> = {
  shield: 'shield',
  regenerate: 'regen',
  retaliate: 'retaliate',
  slash: 'slash',
  strengthen: 'strengthen',
  weaken: 'weaken',
}

/** Дублирует abilityKindFromCode из battle-profile.ts (не экспортируется оттуда) -
 *  резолвит РОДНУЮ способность мутанта по имени (не по % - тир base/plus на kind не влияет). */
function nativeAbilityKind(mutant: any): AbilityKind | null {
  const entries: { name: string }[] = Array.isArray(mutant?.abilities) ? mutant.abilities : []
  if (!entries.length) return null
  const first = entries.find((a) => !String(a.name).endsWith('_plus')) || entries[0]
  const code = String(first?.name || '').toLowerCase()
  if (code.includes('regenerate') || code.includes('regen')) return 'regen'
  if (code.includes('retaliate')) return 'retaliate'
  if (code.includes('shield')) return 'shield'
  if (code.includes('slash')) return 'slash'
  if (code.includes('strengthen')) return 'strengthen'
  if (code.includes('weaken')) return 'weaken'
  return null
}

/** Спец-сфера add<kind>, совпадающая с родной способностью мутанта, в движке ничего не
 *  добавляет (battle-profile.ts держит 0-2 записи ГАРАНТИРОВАННО разных kind) - такой выбор
 *  нет смысла показывать/разрешать, тот же принцип, что isOrbConflicting в StatsCalculator.svelte. */
export function isSpecialOrbBlocked(orb: CatalogOrb, mutant: any): boolean {
  const kind = CATEGORY_ABILITY_KIND[orb.category]
  if (!kind) return false
  return nativeAbilityKind(mutant) === kind
}

export function specialOrbOptionsForMutant(mutant: any): CatalogOrb[] {
  return SPECIAL_ORBS.filter((o) => !isSpecialOrbBlocked(o, mutant))
}

/** Basic-орбы ability-типа (щит/отхил/отражение/рана/усиление/проклятие) показываются
 *  только если совпадают с родной способностью мутанта ИЛИ со способностью уже выбранной
 *  спец-сферы - не захламляем список тем, что физически не может сработать у этого мутанта. */
export function basicOrbOptionsForMutant(mutant: any, specialOrbId: string | null): CatalogOrb[] {
  const allowed = new Set<AbilityKind>()
  const own = nativeAbilityKind(mutant)
  if (own) allowed.add(own)
  const specialOrb = specialOrbId ? SPECIAL_ORBS.find((o) => o.id === specialOrbId) : null
  if (specialOrb) {
    const kind = CATEGORY_ABILITY_KIND[specialOrb.category]
    if (kind) allowed.add(kind)
  }
  return BASIC_ORBS.filter((o) => {
    const kind = CATEGORY_ABILITY_KIND[o.category]
    return !kind || allowed.has(kind)
  })
}

export interface OrbingPreset {
  basicOrbIds: (string | null)[]
  specialOrbId: string | null
}

function findOrbingEntry(mutantId: string) {
  if (orbingMap[mutantId]) return orbingMap[mutantId]
  const entry = Object.entries(orbingMap).find(([k]) => k.toLowerCase() === mutantId.toLowerCase())
  if (entry) return entry[1]
  const bId = baseMutantId(mutantId)
  const entryBase = Object.entries(orbingMap).find(([k]) => k.toLowerCase() === bId.toLowerCase())
  return entryBase ? entryBase[1] : null
}

function resolveOrbCell(cell: OrbCell): string | null {
  const file = Array.isArray(cell) ? cell[0] : cell
  const m = /^(?:basic|special)\/(.+)\.webp$/.exec(String(file || ''))
  if (!m) return null
  const id = m[1]
  if (id === 'orb_slot' || id === 'orb_slot_spe') return null // пустой слот-плейсхолдер
  return id
}

/** "Сферовка из вики" - готовые наборы сфер конкретного мутанта (orbing.json, та же карта,
 *  что и в модалке мутанта на /mutants), для кнопок быстрого заполнения слотов в TeamBuilder. */
export function orbingPresetsFor(mutantId: string): OrbingPreset[] {
  const data = findOrbingEntry(mutantId)
  const rows = Array.isArray(data?.rows) ? data!.rows : []
  const presets: OrbingPreset[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) continue
    const resolved = row.map(resolveOrbCell)
    if (resolved.every((id) => id === null)) continue // строка целиком из плейсхолдеров
    const specialOrbId = resolved[resolved.length - 1]
    const basicOrbIds = resolved.slice(0, -1)
    presets.push({ basicOrbIds, specialOrbId })
  }
  return presets
}
