/**
 * Skin lookup for the Telegram stats bot: which skins a mutant has, their
 * display names, and the phrases a user may type to pick one.
 *
 * A skin is identified by (mutant id, skin code) - skins.json has exactly one
 * record per pair (checked by skin-catalog.test.ts).
 */
import skinsRaw from '@/data/mutants/skins.json'
import skinsRuCurated from '@/data/mutants/skins-ru-curated.json'
import skinsI18n from '@/data/mutants/skins-i18n.json'
import skinAliasesRaw from '@/data/mutants/skin-aliases.json'
import { baseMutantId } from '@/lib/utils'

const STAR_INDEX_BY_NAME: Record<string, number> = {
  none: 0,
  normal: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
}

export interface SkinEntry {
  /** Base mutant id, lowercase (specimen_a_01). */
  mutantId: string
  /** Skin code from gacha.xml (winter, halloween, ...). */
  skin: string
  /** Russian display name. */
  label: string
  /** Star index 0..4 - fixed for a skin. */
  stars: number
  /** Integer bonus of the (specimen, skin) gacha line. */
  bonus: number
  /** Texture paths: [full, semi-full]. */
  image: string[]
}

interface RawSkin {
  id: string
  skin: string
  star: string
  bonus?: number
  image: string[]
}

const RU_CURATED = skinsRuCurated as Record<string, string>
const I18N = skinsI18n as Record<string, Record<string, string>>

export function skinLabel(code: string): string {
  return RU_CURATED[code] || I18N[code]?.ru || code
}

const BY_MUTANT = new Map<string, SkinEntry[]>()
for (const raw of (skinsRaw as { specimens: RawSkin[] }).specimens) {
  const mutantId = baseMutantId(raw.id)
  const entry: SkinEntry = {
    mutantId,
    skin: raw.skin,
    label: skinLabel(raw.skin),
    stars: STAR_INDEX_BY_NAME[raw.star] ?? 0,
    bonus: Number(raw.bonus ?? 0),
    image: raw.image,
  }
  const list = BY_MUTANT.get(mutantId) ?? []
  list.push(entry)
  BY_MUTANT.set(mutantId, list)
}

export function skinsForMutant(mutantId: unknown): SkinEntry[] {
  return BY_MUTANT.get(baseMutantId(mutantId)) ?? []
}

export interface SkinPhrase {
  skin: string
  text: string
  /** Case-insensitive, word-bounded, separator-tolerant matcher. */
  re: RegExp
}

const TOKEN_SPLIT = /[^a-zа-яё0-9]+/i
const NOT_WORD_BEFORE = '(?<![a-zа-яё0-9])'
const NOT_WORD_AFTER = '(?![a-zа-яё0-9])'

function phraseRegex(text: string): RegExp | null {
  const tokens = text
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter(Boolean)
    .map((t) =>
      t
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/[её]/g, '[её]'),
    )
  if (!tokens.length) return null
  return new RegExp(
    `${NOT_WORD_BEFORE}${tokens.join('[^a-zа-яё0-9]+')}${NOT_WORD_AFTER}`,
    'gi',
  )
}

function buildPhrases(): SkinPhrase[] {
  const codes = new Set<string>()
  for (const list of BY_MUTANT.values()) for (const s of list) codes.add(s.skin)
  const aliases = skinAliasesRaw as Record<string, string[] | string>
  const out: SkinPhrase[] = []
  const seen = new Set<string>()
  const add = (skin: string, text: string) => {
    const key = `${skin}|${text.toLowerCase()}`
    if (!text.trim() || seen.has(key)) return
    const re = phraseRegex(text)
    if (!re) return
    seen.add(key)
    out.push({ skin, text, re })
  }
  for (const skin of codes) {
    add(skin, skinLabel(skin))
    add(skin, skin)
    const extra = aliases[skin]
    if (Array.isArray(extra)) for (const a of extra) add(skin, a)
  }
  // Longest first: "тропическое лето" must win over "лето".
  return out.sort((a, b) => b.text.length - a.text.length)
}

let phrases: SkinPhrase[] | null = null
export function skinPhrases(): SkinPhrase[] {
  return (phrases ??= buildPhrases())
}

/** True when `phrase` occurs as whole words inside `text` (used on mutant names). */
export function textContainsPhrase(text: string, phrase: SkinPhrase): boolean {
  phrase.re.lastIndex = 0
  const hit = phrase.re.test(text)
  phrase.re.lastIndex = 0
  return hit
}

/** `segment` with every occurrence of `phrase` replaced by a space. */
export function stripPhrase(segment: string, phrase: SkinPhrase): string {
  phrase.re.lastIndex = 0
  const out = segment.replace(phrase.re, ' ')
  phrase.re.lastIndex = 0
  return out
}
