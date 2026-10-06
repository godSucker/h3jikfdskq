// Data for the dungeon poster (/dungeon-poster): one raid, special ladder or
// event ladder as a ready-to-draw structure. Russian only, like the box poster.
// Everything comes from the same sources as /guides (dungeon-details.json from
// scripts/sync-dungeon-details.ts, reward names/icons through guides-resolve.ts),
// so the poster cannot disagree with the site.
import mutantsData from '@/data/mutants/mutants.json'
import materialData from '@/data/materials/material.json'
import raidsData from '@/data/guides/raids.json'
import specialLaddersData from '@/data/guides/special-ladders.json'
import eventLaddersData from '@/data/guides/event-ladders.json'
import detailsData from '@/data/guides/dungeon-details.json'
import { translateItemId, getItemTexture } from '@/lib/craft-simulator'
import { getLocalisedName } from '@/lib/localisation'
import { getItemName } from '@/lib/materials-i18n'
import { getGeneIcon } from '@/lib/mutant-icons'
import { geneLabelL } from '@/lib/mutant-dicts'
import { getLocalizedMutantNames } from '@/lib/mutant-names-i18n'
import {
  resolveMutantLite,
  resolveReward,
  type MaterialEntry,
  type MutantRaw,
  type RewardResolveCtx,
} from '@/lib/guides-resolve'

export type DungeonKind = 'raid' | 'experiment' | 'challenge' | 'event'

export interface PosterItem {
  id: string
  name: string
  icon: string | null
  amount: number
  isMutant: boolean
}

export interface PosterCell {
  // "10" or "1-80" (a run of identical floors is folded into one cell)
  label: string
  items: PosterItem[]
  // event ladders: items handed out for every fight of the map
  perFight: PosterItem[]
  // true when the label is a range (smaller number, "за каждый" note)
  range: boolean
}

export interface PosterData {
  id: string
  kind: DungeonKind
  name: string
  titleUrl: string | null
  screenUrl: string | null
  cost: { amount: number; type: 'hardcurrency' | 'softcurrency' } | null
  limit: number | null
  floors: number
  tickets: { min: number; max: number } | null
  levelText: string
  genes: { code: string; label: string; icon: string | null; allowed: boolean }[]
  stars: { key: string; allowed: boolean }[]
  mutantArt: string | null
  mutantName: string | null
  cells: PosterCell[]
}

interface DetailsFile {
  dungeons: Record<
    string,
    {
      type: 'raid' | 'experiment' | 'challenge'
      title?: string | null
      screen?: string | null
      entryCost: { amount: number; type: 'hardcurrency' | 'softcurrency' } | null
      completionMax: number | null
      conditions: {
        minLevel: number | null
        maxLevel: number | null
        genes: string[]
        stars: string[] | null
      } | null
      floors: number
      energy: { min: number; max: number; total: number } | null
      milestones: { floor: number; items: { id: string; amount: number }[] }[]
    }
  >
  events: Record<
    string,
    {
      title?: string | null
      screen?: string | null
      energy: { min: number; max: number; total: number } | null
      maps: {
        fights: number
        energy: [number, number] | null
        fightItems: { id: string; amount: number }[]
        finish: { id: string; amount: number }[]
      }[]
    }
  >
}
const details = detailsData as unknown as DetailsFile

interface SiteDungeon {
  id: string
  name: string
  mutantId?: string | null
}
const siteList: SiteDungeon[] = [
  ...(raidsData as SiteDungeon[]),
  ...(specialLaddersData as unknown as { experiment: SiteDungeon[]; challenge: SiteDungeon[] })
    .experiment,
  ...(specialLaddersData as unknown as { experiment: SiteDungeon[]; challenge: SiteDungeon[] })
    .challenge,
  ...(eventLaddersData as SiteDungeon[]),
]
const siteById = new Map(siteList.map((d) => [d.id, d]))

const { names } = getLocalizedMutantNames('ru')
const mutantsById = new Map((mutantsData as unknown as MutantRaw[]).map((m) => [m.id, m]))
const materialsById = new Map(
  (materialData as MaterialEntry[]).map((m) => [
    m.id,
    { ...m, name: m.name ? getItemName(m.id, 'ru', m.name) : m.name },
  ]),
)
const rewardCtx: RewardResolveCtx = {
  mutantsById,
  materialsById,
  translateItemId,
  getItemTexture,
  getLocalisedName,
  getGeneIcon,
  geneRu: Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map((g) => [g, geneLabelL(g, 'ru')])),
  names,
}

const itemCache = new Map<string, Omit<PosterItem, 'amount'>>()
function item(id: string, amount: number): PosterItem {
  let base = itemCache.get(id)
  if (!base) {
    const r = resolveReward({ type: 'entity', id, amount: '1' }, rewardCtx)
    // luxe zones (Habitat_*_HC) resolve without an icon, the file name is the lowercase id
    const icon =
      r.icon ?? (/^Habitat_.+_HC$/.test(id) ? `/zones/luxe/${id.toLowerCase()}.webp` : null)
    base = { id, name: r.label, icon, isMutant: Boolean(r.mutant) }
    itemCache.set(id, base)
  }
  return { ...base, amount }
}

// Order of the star column in the game: no star, bronze, silver, gold, platinum.
const STAR_KEYS = ['', 'bronze', 'silver', 'gold', 'platinum']
const GENES = ['A', 'B', 'C', 'D', 'E', 'F']

function levelText(min: number | null, max: number | null): string {
  // 9999 in the game config means "no upper bound"
  const hi = max !== null && max >= 9999 ? null : max
  if (min === null && hi === null) return 'Любой'
  if (hi === null) return `от ${min}`
  if (min === null) return `до ${hi}`
  return min === hi ? String(min) : `${min}–${hi}`
}

function sameItems(a: PosterItem[], b: PosterItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.amount === b[i].amount)
}

// Folds consecutive floors with identical rewards (halloween: 3 souls on each of
// 80 floors) into one cell, but only runs of 3+, shorter runs stay separate.
function foldRuns(
  rows: { floor: number; items: PosterItem[] }[],
): { from: number; to: number; items: PosterItem[] }[] {
  const out: { from: number; to: number; items: PosterItem[] }[] = []
  for (let i = 0; i < rows.length;) {
    let j = i
    while (
      j + 1 < rows.length &&
      rows[j + 1].floor === rows[j].floor + 1 &&
      sameItems(rows[i].items, rows[j + 1].items)
    )
      j++
    if (j - i + 1 >= 3) {
      out.push({ from: rows[i].floor, to: rows[j].floor, items: rows[i].items })
    } else {
      for (let k = i; k <= j; k++)
        out.push({ from: rows[k].floor, to: rows[k].floor, items: rows[k].items })
    }
    i = j + 1
  }
  return out
}

function buildPosterData(id: string): PosterData | null {
  const site = siteById.get(id)
  const featuredId = site?.mutantId ?? null
  const name = site?.name ?? id
  const featuredMutant = featuredId
    ? resolveMutantLite(featuredId.toLowerCase(), mutantsById, names)
    : null
  const mutantArt = featuredMutant?.fullArt ?? null
  const mutantName = featuredMutant?.name ?? null

  const d = details.dungeons[id]
  if (d) {
    const c = d.conditions
    const rows = d.milestones.map((m) => ({
      floor: m.floor,
      items: m.items.map((it) => item(it.id, it.amount)),
    }))
    const cells = foldRuns(rows).map((r) => ({
      label: r.from === r.to ? String(r.from) : `${r.from}–${r.to}`,
      items: r.items,
      perFight: [],
      range: r.from !== r.to,
    }))
    return {
      id,
      kind: d.type,
      name,
      titleUrl: d.title ?? null,
      screenUrl: d.screen ?? null,
      cost: d.entryCost,
      limit: d.completionMax,
      floors: d.floors,
      tickets: d.energy ? { min: d.energy.min, max: d.energy.max } : null,
      levelText: levelText(c?.minLevel ?? null, c?.maxLevel ?? null),
      genes: GENES.map((g) => ({
        code: g,
        label: geneLabelL(g, 'ru'),
        icon: getGeneIcon(g),
        allowed: !c || c.genes.length === 0 || c.genes.includes(g),
      })),
      stars: STAR_KEYS.map((k) => ({ key: k, allowed: !c?.stars || c.stars.includes(k) })),
      mutantArt,
      mutantName,
      cells,
    }
  }

  const e = details.events[id]
  if (e) {
    let acc = 0
    const cells: PosterCell[] = e.maps.map((m) => {
      acc += m.fights
      return {
        label: String(acc),
        items: m.finish.map((it) => item(it.id, it.amount)),
        perFight: m.fightItems.map((it) => item(it.id, it.amount)),
        range: false,
      }
    })
    return {
      id,
      kind: 'event',
      name,
      titleUrl: e.title ?? null,
      screenUrl: e.screen ?? null,
      cost: null,
      limit: null,
      floors: acc,
      tickets: e.energy ? { min: e.energy.min, max: e.energy.max } : null,
      // event ladder configs carry no conditions: any mutant can take part
      levelText: 'Любой',
      genes: GENES.map((g) => ({
        code: g,
        label: geneLabelL(g, 'ru'),
        icon: getGeneIcon(g),
        allowed: true,
      })),
      stars: STAR_KEYS.map((k) => ({ key: k, allowed: true })),
      mutantArt,
      mutantName,
      cells,
    }
  }
  return null
}

export function getPosterData(id: string): PosterData | null {
  const data = buildPosterData(id)
  // the mutant that stands in the arena: the featured one, else a mutant from the rewards, else a generic one
  if (data && !data.mutantArt) {
    const m =
      firstMutantReward(data.cells) ?? resolveMutantLite('specimen_a_01', mutantsById, names)
    data.mutantArt = m?.fullArt ?? null
    data.mutantName = m?.name ?? null
  }
  return data
}

function firstMutantReward(cells: PosterCell[]) {
  for (const c of cells)
    for (const it of [...c.items, ...c.perFight])
      if (it.isMutant) {
        const m = resolveMutantLite(it.id.toLowerCase(), mutantsById, names)
        if (m) return m
      }
  return null
}

export function posterIds(): string[] {
  return [...Object.keys(details.dungeons), ...Object.keys(details.events)]
}
