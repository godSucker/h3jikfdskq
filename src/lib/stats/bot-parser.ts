/**
 * Deterministic (non-LLM) parser for the Telegram stats-bot command text.
 * No clarification round-trip: on any ambiguity/miss we fail with a reason
 * and point the user at /format instead of guessing.
 *
 * Orb matching is anchored on (category keyword + explicit percent number),
 * not fuzzy name matching - every percent tier per category in orbs.json is
 * unique, so "щит 20%" resolves to exactly one orb id, no clarification
 * needed. Only orbs actually selectable in the real orb picker (>= tier 3,
 * see isSelectableOrbId - mirrors buildOrbCatalog's filter in
 * StatsCalculator.svelte) are matched; weaker tiers are treated as unknown.
 */
import { normalizeSearch } from '@/lib/search-normalize'
import orbsRaw from '@/data/materials/orbs.json'
import mutantsRaw from '@/data/mutants/mutants.json'
import { normalizeMutant } from './panel-data'

interface RawOrb {
  id: string
  name: string
  percent: string
  description?: string
}

interface OrbCatalogEntry {
  id: string
  name: string
  percent: number
  category: 'basic' | 'special'
}

function isTemporaryOrb(id: string): boolean {
  const key = id.toLowerCase()
  return key.includes('ephemeral') || key.includes('temporary')
}

// Mirrors buildOrbCatalog's tier filter in StatsCalculator.svelte: for
// attack/life/speed and the ability-type basics, only tier _03+ is actually
// selectable on the real page - weaker tiers exist in orbs.json but aren't
// offered in the picker.
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
  if (/_0[3-7]$/.test(id)) return true
  return false
}

const ORB_CATALOG: OrbCatalogEntry[] = (orbsRaw as RawOrb[])
  .filter((o) => !isTemporaryOrb(o.id) && isSelectableOrbId(o.id))
  .map((o) => ({
    id: o.id,
    name: o.name,
    percent: Number(o.percent),
    category: o.id.startsWith('orb_special') ? 'special' : 'basic',
  }))

interface CategoryDef {
  keywords: string[]
  basicPrefix?: string
  specialPrefix?: string
}

const CATEGORIES: CategoryDef[] = [
  { keywords: ['атака'], basicPrefix: 'orb_basic_attack' },
  { keywords: ['здоровье', 'хп', 'жизнь'], basicPrefix: 'orb_basic_life' },
  { keywords: ['критический шанс', 'крит'], basicPrefix: 'orb_basic_critical' },
  {
    keywords: ['вытягивание жизни', 'вампиризм', 'лайфстил'],
    basicPrefix: 'orb_basic_regenerate',
    specialPrefix: 'orb_special_addregenerate',
  },
  {
    keywords: ['контратака', 'отражение'],
    basicPrefix: 'orb_basic_retaliate',
    specialPrefix: 'orb_special_addretaliate',
  },
  { keywords: ['щит'], basicPrefix: 'orb_basic_shield', specialPrefix: 'orb_special_addshield' },
  {
    keywords: ['ранение', 'кровотечение'],
    basicPrefix: 'orb_basic_slash',
    specialPrefix: 'orb_special_addslash',
  },
  {
    keywords: ['усиление'],
    basicPrefix: 'orb_basic_strengthen',
    specialPrefix: 'orb_special_addstrengthen',
  },
  {
    keywords: ['проклятие', 'ослабление'],
    basicPrefix: 'orb_basic_weaken',
    specialPrefix: 'orb_special_addweaken',
  },
  { keywords: ['опыт'], basicPrefix: 'orb_basic_xp' },
  { keywords: ['скорость'], specialPrefix: 'orb_special_speed' },
]

const STAR_KEYWORDS: Array<{ index: number; words: string[] }> = [
  { index: 0, words: ['обычный', 'обычная', 'обычные', 'без звезд', 'без звёзд'] },
  { index: 1, words: ['бронза', 'бронзовый', 'бронзовая'] },
  { index: 2, words: ['серебро', 'серебряный', 'серебряная'] },
  { index: 3, words: ['золото', 'золотой', 'золотая'] },
  { index: 4, words: ['платина', 'платиновый', 'платиновая'] },
]

const ALLOWED_MULTIPLIERS = [-50, -25, 0, 25, 50]

export interface ParsedOrbMention {
  category: string
  percent: number
  slot: 'basic' | 'special'
  id: string
}

export interface ParsedConfig {
  mutant: any
  mutantName: string
  level: number
  starIndex: number
  basicOrbIds: (string | null)[]
  specialOrbId: string | null
  atkMultipliers: { 1: number; 2: number }
}

export type ParseResult =
  { ok: true; primary: ParsedConfig; secondary?: ParsedConfig } | { ok: false; error: string }

function findMutant(text: string): { mutant: any; matchedLen: number } | null {
  const normalizedText = normalizeSearch(text)
  let best: { mutant: any; matchedLen: number } | null = null
  for (const m of mutantsRaw as any[]) {
    const normName = normalizeSearch(m.name)
    if (!normName) continue
    if (normalizedText.includes(normName)) {
      if (!best || normName.length > best.matchedLen) {
        best = { mutant: m, matchedLen: normName.length }
      }
    }
  }
  return best
}

// JS's \b only recognizes ASCII \w, so it's a no-op (or worse) around Cyrillic
// text - use explicit lookaround on "not a letter/digit" instead.
const NOT_WORD = '(?![a-zа-яё0-9])'
function findLevel(text: string): number | null {
  // No real level cap in-game (only an HP-overflow ceiling that varies per
  // mutant/star/orbs, in the tens of thousands - see maxLevelForHp in
  // unified-calculator.ts) - \d{1,3} silently rejected anything above 999.
  const suffixMatch = text.match(
    new RegExp(`(?:^|[^a-zа-яё0-9])(\\d{1,6})\\s*(?:ур\\.?|уровень|lvl|lv)${NOT_WORD}`, 'i'),
  )
  if (suffixMatch) return Number(suffixMatch[1])
  const prefixMatch = text.match(
    new RegExp(`(?:ур\\.?|уровень|lvl|lv)\\s*(\\d{1,6})${NOT_WORD}`, 'i'),
  )
  if (prefixMatch) return Number(prefixMatch[1])
  return null
}

function findStar(text: string): number {
  const normalized = normalizeSearch(text)
  for (const { index, words } of STAR_KEYWORDS) {
    for (const w of words) {
      if (normalized.includes(normalizeSearch(w))) return index
    }
  }
  return 0
}

function findMultipliers(text: string): { 1: number; 2: number } {
  const result: { 1: number; 2: number } = { 1: 0, 2: 0 }
  // \w is ASCII-only in JS regex - use [а-яё]* to actually span Cyrillic
  // word endings ("первую", "первая", "вторую", ...).
  const patterns: Array<[RegExp, 1 | 2]> = [
    [/([+-]\d{1,3})\s*%[^%]{0,15}?перв[а-яё]*\s*атак[а-яё]*/gi, 1],
    [/перв[а-яё]*\s*атак[а-яё]*[^%]{0,15}?([+-]\d{1,3})\s*%/gi, 1],
    [/([+-]\d{1,3})\s*%[^%]{0,15}?втор[а-яё]*\s*атак[а-яё]*/gi, 2],
    [/втор[а-яё]*\s*атак[а-яё]*[^%]{0,15}?([+-]\d{1,3})\s*%/gi, 2],
  ]
  for (const [re, attack] of patterns) {
    const match = re.exec(text)
    if (match) {
      const val = Number(match[1])
      if (ALLOWED_MULTIPLIERS.includes(val)) result[attack] = val
    }
  }
  return result
}

function findOrbMentions(text: string): ParsedOrbMention[] {
  const lower = text.toLowerCase()
  const mentions: ParsedOrbMention[] = []
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      let idx = lower.indexOf(kw)
      while (idx !== -1) {
        const windowStart = Math.max(0, idx - 15)
        const windowEnd = Math.min(lower.length, idx + kw.length + 15)
        const window = lower.slice(windowStart, windowEnd)
        const isSpecial = window.includes('спец') && Boolean(cat.specialPrefix)
        const prefix = isSpecial ? cat.specialPrefix : (cat.basicPrefix ?? cat.specialPrefix)
        if (prefix) {
          // "%" -> match by percent (unambiguous, every tier's percent is
          // unique). A bare number with no "%" -> match by sphere LEVEL (the
          // id's _0N suffix), not percent - "спец скорость 5" means tier 5
          // (orb_special_speed_05), not "5%" (that'd be tier 1). Restricted
          // to right after the keyword so it can't grab an unrelated number
          // elsewhere in the message (mutant level, star index, ...).
          const percentMatch = window.match(/(\d{1,3})\s*%/)
          const levelMatch = !percentMatch
            ? lower.slice(idx + kw.length, idx + kw.length + 5).match(/^\s*(\d{1,2})\b/)
            : null
          let entry: OrbCatalogEntry | null = null
          if (percentMatch) {
            const percent = Number(percentMatch[1])
            entry =
              ORB_CATALOG.find(
                (o) =>
                  o.category === (isSpecial ? 'special' : 'basic') &&
                  o.id.startsWith(prefix) &&
                  o.percent === percent,
              ) ?? null
          } else if (levelMatch) {
            const level = levelMatch[1].padStart(2, '0')
            const id = `${prefix}_${level}`
            entry = ORB_CATALOG.find((o) => o.id === id) ?? null
          }
          if (entry) {
            mentions.push({ category: kw, percent: entry.percent, slot: entry.category, id: entry.id })
          }
        }
        idx = lower.indexOf(kw, idx + kw.length)
      }
    }
  }
  return mentions
}

function parseSingleSegment(segment: string): ParsedConfig | { error: string } {
  const found = findMutant(segment)
  if (!found) return { error: `не нашёл мутанта в "${segment.trim()}"` }
  const level = findLevel(segment)
  if (level === null)
    return {
      error: `не нашёл уровень (напиши число + "ур", например "20 ур") в "${segment.trim()}"`,
    }
  const starIndex = findStar(segment)
  const atkMultipliers = findMultipliers(segment)
  const mentions = findOrbMentions(segment)

  // The real page never offers a multiplier control for a neutro-gene attack
  // (`{#if attack.gene !== 'neutro'}` gates both the bar and the button
  // group in StatsCalculator.svelte) - a real user can never reach that
  // state via the site, so the bot shouldn't manufacture one either. Silent
  // drop, not an error: the rest of the message still parses fine.
  const normalized = normalizeMutant(found.mutant)
  for (const idx of [1, 2] as const) {
    if (normalized.attackMeta[idx]?.gene === 'neutro') atkMultipliers[idx] = 0
  }

  const basicSlotCount = Number.isFinite(found.mutant.orbs?.normal) ? found.mutant.orbs.normal : 1
  const basicMentions = mentions.filter((m) => m.slot === 'basic').slice(0, basicSlotCount)
  const specialMention = mentions.find((m) => m.slot === 'special') ?? null

  const basicOrbIds: (string | null)[] = Array(basicSlotCount).fill(null)
  basicMentions.forEach((m, i) => {
    basicOrbIds[i] = m.id
  })

  return {
    mutant: found.mutant,
    mutantName: found.mutant.name,
    level,
    starIndex,
    basicOrbIds,
    specialOrbId: specialMention?.id ?? null,
    atkMultipliers,
  }
}

export function parseMessage(text: string): ParseResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'пустое сообщение' }

  const compareSplit = trimmed.split(/\s+(?:vs|против)\s+/i)
  if (compareSplit.length > 2) {
    return {
      ok: false,
      error: 'больше одного разделителя "vs"/"против" - непонятно что сравнивать',
    }
  }

  const primary = parseSingleSegment(compareSplit[0])
  if ('error' in primary) return { ok: false, error: primary.error }

  if (compareSplit.length === 2) {
    const secondary = parseSingleSegment(compareSplit[1])
    if ('error' in secondary) return { ok: false, error: secondary.error }
    return { ok: true, primary, secondary }
  }

  return { ok: true, primary }
}

export const FORMAT_HELP = `Формат сообщения (свободный порядок слов, начинай с точки):

.<имя мутанта> <уровень>ур [звёздность] [сферы] [атака1: X%] [атака2: X%]

Звёздность: обычный / бронза / серебро / золото / платина (по умолчанию - обычный)

Сферы - пиши название категории + число вплотную рядом, например:
"щит 20%" (по проценту) или "щит 4" (по уровню сферы, без "%")
"спец щит 20%" (спец-слот - добавь слово "спец")
Категории: атака, здоровье, крит, вытягивание жизни, контратака, щит, ранение, усиление, проклятие, опыт, скорость (только спец)

Мультипликатор урона: "+25% на первую атаку", "-50% вторая атака" (допустимые значения: -50/-25/0/+25/+50)

Сравнение двух мутантов - раздели сообщения словом "vs" или "против"

Примеры:
.робот 20ур серебро щит 20% +25% на первую атаку
.робот 20ур серебро vs зомби 30ур золото`
