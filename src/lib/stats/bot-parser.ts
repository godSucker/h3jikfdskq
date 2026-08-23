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
import Fuse from 'fuse.js'
import { normalizeSearch } from '@/lib/search-normalize'
import orbsRaw from '@/data/materials/orbs.json'
import mutantsRaw from '@/data/mutants/mutants.json'
import nicknameAliases from '@/data/mutants/nickname-aliases.json'
import { normalizeMutant, resolveOrb } from './panel-data'
import { maxLevelForHp } from './unified-calculator'

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
  { keywords: ['атака', 'атк'], basicPrefix: 'orb_basic_attack' },
  { keywords: ['здоровье', 'хп', 'жизнь', 'хелс'], basicPrefix: 'orb_basic_life' },
  { keywords: ['критический шанс', 'крит', 'критшанс'], basicPrefix: 'orb_basic_critical' },
  {
    keywords: ['вытягивание жизни', 'вампиризм', 'лайфстил', 'вамп', 'вампирка'],
    basicPrefix: 'orb_basic_regenerate',
    specialPrefix: 'orb_special_addregenerate',
  },
  {
    keywords: ['контратака', 'отражение', 'контра', 'реталиэйт'],
    basicPrefix: 'orb_basic_retaliate',
    specialPrefix: 'orb_special_addretaliate',
  },
  { keywords: ['щит'], basicPrefix: 'orb_basic_shield', specialPrefix: 'orb_special_addshield' },
  {
    keywords: ['ранение', 'кровотечение', 'рана', 'кровь', 'кровоток'],
    basicPrefix: 'orb_basic_slash',
    specialPrefix: 'orb_special_addslash',
  },
  {
    keywords: ['усиление', 'усил', 'баф', 'бафф'],
    basicPrefix: 'orb_basic_strengthen',
    specialPrefix: 'orb_special_addstrengthen',
  },
  {
    keywords: ['проклятие', 'ослабление', 'дебаф', 'дебафф', 'прокл'],
    basicPrefix: 'orb_basic_weaken',
    specialPrefix: 'orb_special_addweaken',
  },
  { keywords: ['опыт', 'экспа', 'exp'], basicPrefix: 'orb_basic_xp' },
  { keywords: ['скорость', 'скор', 'спид'], specialPrefix: 'orb_special_speed' },
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

export type ParseCompareResult =
  { ok: true; configs: ParsedConfig[] } | { ok: false; error: string }

type FindMutantResult =
  | { kind: 'found'; mutant: any; fuzzy: boolean }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' }

const FUZZY_MAX_SCORE = 0.3
const FUZZY_TIE_EPSILON = 0.03

let mutantFuse: Fuse<{ name: string; mutant: any }> | null = null
let nameStripPattern: RegExp | null = null

function getMutantFuse(): Fuse<{ name: string; mutant: any }> {
  if (!mutantFuse) {
    mutantFuse = new Fuse(
      (mutantsRaw as any[]).map((m) => ({ name: m.name, mutant: m })),
      { keys: ['name'], includeScore: true, threshold: 0.4, ignoreLocation: true },
    )
  }
  return mutantFuse
}

function getNameStripPattern(): RegExp {
  if (!nameStripPattern) {
    const phrases = new Set<string>()
    for (const { words } of STAR_KEYWORDS) for (const w of words) phrases.add(w)
    for (const cat of CATEGORIES) for (const kw of cat.keywords) phrases.add(kw)
    for (const w of [
      'ур',
      'уровень',
      'lvl',
      'lv',
      'спец',
      'на',
      'первую',
      'первая',
      'вторую',
      'вторая',
      'атаку',
    ])
      phrases.add(w)
    // Longest first, so e.g. "критический шанс" is stripped whole before its
    // substring "крит" would otherwise chew into it piecemeal.
    const sorted = Array.from(phrases).sort((a, b) => b.length - a.length)
    const escaped = sorted.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    nameStripPattern = new RegExp(`(?<![a-zа-яё0-9])(?:${escaped.join('|')})(?![a-zа-яё0-9])`, 'gi')
  }
  return nameStripPattern
}

// What's left after stripping every keyword the rest of the parser already
// understands (level, star, orb categories, multiplier words) is presumed to
// be the mutant name - typo'd or abbreviated. Fuzzy-matched only as a
// fallback when the exact substring pass below finds nothing, so a clean
// exact name is never second-guessed.
function fuzzyFindMutant(text: string): FindMutantResult {
  let remainder = ' ' + text.toLowerCase() + ' '
  remainder = remainder.replace(/\d+\s*%/g, ' ')
  remainder = remainder.replace(/[+-]\d{1,3}/g, ' ')
  remainder = remainder.replace(/\d+/g, ' ')
  remainder = remainder.replace(getNameStripPattern(), ' ')
  remainder = remainder.replace(/\s+/g, ' ').trim()
  if (remainder.length < 2) return { kind: 'none' }

  const hits = getMutantFuse()
    .search(remainder)
    .filter((h) => (h.score ?? 1) <= FUZZY_MAX_SCORE)
  if (hits.length === 0) return { kind: 'none' }

  const best = hits[0]
  const runnerUp = hits.find((h) => h.item.name !== best.item.name)
  if (runnerUp && (runnerUp.score ?? 1) - (best.score ?? 0) < FUZZY_TIE_EPSILON) {
    const names = Array.from(new Set([best, runnerUp].map((h) => h.item.name)))
    return { kind: 'ambiguous', candidates: names }
  }
  return { kind: 'found', mutant: best.item.mutant, fuzzy: true }
}

// One entry per exact display name - only matters for the rare pair of
// mutants sharing a name differing purely by case (e.g. "Колосс" vs
// "колосс", both real entries in mutants.json); aliases reference the
// specific capitalization they mean, so this must NOT be normalized.
const mutantByExactName = new Map<string, any>()
for (const m of mutantsRaw as any[]) {
  if (!mutantByExactName.has(m.name)) mutantByExactName.set(m.name, m)
}

// Curated from a months-old sibling bot's query cache (see memory) -
// community nicknames/abbreviations too far from the canonical name for
// fuzzy matching to safely guess (e.g. "борода" -> "Капитан Черная
// Борода"), hand-approved one by one rather than merged wholesale.
const ALIAS_CANDIDATES: Array<{ alias: string; mutant: any }> = Object.entries(
  nicknameAliases as Record<string, string>,
)
  .map(([alias, targetName]) => ({ alias, mutant: mutantByExactName.get(targetName) }))
  .filter((e): e is { alias: string; mutant: any } => Boolean(e.mutant))

function findMutant(text: string): FindMutantResult {
  const normalizedText = normalizeSearch(text)
  // Collect every candidate at the current best (longest) match length,
  // not just the first one seen - a same-length tie between two distinct
  // mutants is genuine ambiguity (mirrors how fuzzyFindMutant handles it),
  // not something array order should silently decide.
  let bestLen = 0
  let candidates: any[] = []
  const consider = (matchedText: string, mutant: any) => {
    if (!matchedText) return
    if (!normalizedText.includes(matchedText)) return
    if (matchedText.length > bestLen) {
      bestLen = matchedText.length
      candidates = [mutant]
    } else if (matchedText.length === bestLen && !candidates.includes(mutant)) {
      candidates.push(mutant)
    }
  }
  for (const m of mutantsRaw as any[]) consider(normalizeSearch(m.name), m)
  for (const { alias, mutant } of ALIAS_CANDIDATES) consider(normalizeSearch(alias), mutant)

  if (candidates.length === 1) return { kind: 'found', mutant: candidates[0], fuzzy: false }
  if (candidates.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: Array.from(new Set(candidates.map((m) => m.name))),
    }
  }
  return fuzzyFindMutant(text)
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

// null = no star keyword in the text - caller decides the default (varies
// per mutant: some don't have a "normal" tier at all, e.g. platinum-only
// specials, so a flat 0 default is wrong for them).
function findStarKeyword(text: string): number | null {
  const normalized = normalizeSearch(text)
  for (const { index, words } of STAR_KEYWORDS) {
    for (const w of words) {
      if (normalized.includes(normalizeSearch(w))) return index
    }
  }
  return null
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
            mentions.push({
              category: kw,
              percent: entry.percent,
              slot: entry.category,
              id: entry.id,
            })
          }
        }
        idx = lower.indexOf(kw, idx + kw.length)
      }
    }
  }
  return mentions
}

// Default level when the message names a mutant but never specifies one
// (e.g. ".азимов" with nothing else) - there's no in-game "default level" so
// this is purely a bot UX call: 30 reads as a reasonable mid-game snapshot.
const DEFAULT_LEVEL = 30

function parseSingleSegment(segment: string): ParsedConfig | { error: string } {
  const found = findMutant(segment)
  if (found.kind === 'none') return { error: `не нашёл мутанта в "${segment.trim()}"` }
  if (found.kind === 'ambiguous')
    return {
      error: `не понял, какого мутанта имеешь в виду - похоже на ${found.candidates.join(' или ')}, уточни имя`,
    }
  const rawLevel = findLevel(segment) ?? DEFAULT_LEVEL
  const normalized = normalizeMutant(found.mutant)
  // No star keyword in the text -> default to the mutant's highest available
  // tier (platinum for anything that has one), same as the live page's
  // auto-select-on-mutant-change behavior.
  const availableStars = Array.from(normalized.availableStars)
  const starIndex =
    findStarKeyword(segment) ?? (availableStars.length > 0 ? Math.max(...availableStars) : 0)
  const atkMultipliers = findMultipliers(segment)
  const mentions = findOrbMentions(segment)

  // The real page never offers a multiplier control for a neutro-gene attack
  // (`{#if attack.gene !== 'neutro'}` gates both the bar and the button
  // group in StatsCalculator.svelte) - a real user can never reach that
  // state via the site, so the bot shouldn't manufacture one either. Silent
  // drop, not an error: the rest of the message still parses fine.
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

  // Same HP-overflow cap the live calculator applies (maxLevelForHp in
  // unified-calculator.ts, shared with the PvP fight-engine) - without it a
  // troll level like "999999ур" produces an HP number the card's fixed-width
  // layout was never built to hold, on top of not reflecting anything real
  // in-game (int32 overflow past this point, see that function's comment).
  const hpPct = [...basicOrbIds, specialMention?.id ?? null]
    .map((id) => resolveOrb(id)?.hpPct ?? 0)
    .reduce((a, b) => a + b, 0)
  const starMul = normalized.starMultipliers[starIndex] ?? 1.0
  const maxLevel = maxLevelForHp(normalized.hpBase * starMul * (1 + hpPct / 100))
  const level = Math.min(rawLevel, maxLevel)

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

const COMPARE_SEPARATOR = /\s+(?:vs|против)\s+/i
const MAX_MULTI_COMPARE = 5

export function parseMessage(text: string): ParseResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'пустое сообщение' }

  const compareSplit = trimmed.split(COMPARE_SEPARATOR)
  if (compareSplit.length > 2) {
    return {
      ok: false,
      error:
        'больше одного разделителя "vs"/"против" - для сравнения больше двух мутантов используй .сравнение',
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

// Same "vs"/"против" segmentation as parseMessage, just without the
// hard cap at two - .сравнение is the only entry point that reaches this,
// so a plain ".vs" message still can't accidentally produce a 5-way card
// (which would need a wider render than renderComparePair is built for).
export function parseCompareMessage(text: string): ParseCompareResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'пустое сообщение' }

  const segments = trimmed.split(COMPARE_SEPARATOR)
  if (segments.length < 2) {
    return {
      ok: false,
      error: 'нужно минимум 2 мутанта, раздели их через "vs" или "против"',
    }
  }
  if (segments.length > MAX_MULTI_COMPARE) {
    return { ok: false, error: `максимум ${MAX_MULTI_COMPARE} мутантов за раз` }
  }

  const configs: ParsedConfig[] = []
  for (const segment of segments) {
    const parsed = parseSingleSegment(segment)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    configs.push(parsed)
  }
  return { ok: true, configs }
}

export const FORMAT_HELP = `Формат сообщения (свободный порядок слов, начинай с точки):

.<имя мутанта> [уровень]ур [звёздность] [сферы] [атака1: X%] [атака2: X%]

Имя мутанта можно писать с опечаткой или сокращённо - подберу похожее (если совпадений несколько, переспрошу).
Уровень необязателен - без него подставлю 30.
Звёздность необязательна - без неё подставлю максимально доступную мутанту (платину, если она есть).

Сферы - пиши название категории + число вплотную рядом, например:
"щит 20%" (по проценту) или "щит 4" (по уровню сферы, без "%")
"спец щит 20%" (спец-слот - добавь слово "спец")
Категории (можно сокращённо): атака/атк, здоровье/хп, крит, вытягивание жизни/вамп, контратака/контра, щит, ранение/кровь, усиление/баф, проклятие/дебаф, опыт, скорость/спид (только спец)

Мультипликатор урона: "+25% на первую атаку", "-50% вторая атака" (допустимые значения: -50/-25/0/+25/+50)

Сравнение двух мутантов - раздели сообщения словом "vs" или "против"

Сравнение до 5 мутантов - начни с ".сравнение", дальше те же сегменты через "vs"/"против"

Примеры:
.азимов (30 уровень, максимальная звезда)
.робот 20ур серебро щит 20% +25% на первую атаку
.робот 20ур серебро vs зомби 30ур золото
.сравнение робот 30ур vs зомби 45ур vs воин 55ур vs брейкмастер 1ур vs банши 4ур`
