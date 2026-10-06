// Ready-to-render details of one raid / special ladder / event ladder for the
// announcement card: entry cost, limit, tickets per fight, mutant requirements and
// the per-floor reward list. Same data (dungeon-details.json) and the same wording
// (guides.dungeon.* i18n keys) as the activity cards on /guides, so the two cannot
// drift apart. The /guides page still builds its own copy of this in GuidesPage.astro
// and GuidesBrowser.svelte (client-side collapsing); keep both in step.
import detailsData from '@/data/guides/dungeon-details.json'
import { resolveReward, type RewardResolveCtx } from '@/lib/guides-resolve'
import { geneLabelL, starLabelL } from '@/lib/mutant-dicts'
import { getGeneIcon } from '@/lib/mutant-icons'
import { t, type Locale } from '@/lib/i18n'
import { GOLD_WORD, SILVER_WORD } from '@/lib/bingo-textures'

export interface DetailItem {
  label: string
  icon: string | null
  mutantId: string | null
}
export interface DetailRow {
  // "10" or "1-80" (a run of identical floors)
  floorLabel: string
  floorTitle: string
  mutant: boolean
  // event ladders: items of every fight of the map, then the map finishing reward
  fightItems: DetailItem[]
  items: DetailItem[]
}
export interface DungeonDetailCard {
  kind: 'dungeon' | 'event'
  // false: not in the game registry any more, entry cost and conditions are unknown
  known: boolean
  cost: { label: string; icon: string | null } | null
  limit: number | null
  tickets: string | null
  level: string | null
  genes: { except: boolean; list: { label: string; icon: string | null }[] } | null
  stars: { key: string; label: string; icon: string | null }[] | null
  rowsTitle: string
  rows: DetailRow[]
}

interface Pair {
  id: string
  amount: number
}
interface DungeonRaw {
  active: boolean
  entryCost: { amount: number; type: string } | null
  completionMax: number | null
  conditions: {
    minLevel: number | null
    maxLevel: number | null
    genes: string[]
    stars: string[] | null
  } | null
  energy: { min: number; max: number } | null
  milestones: { floor: number; items: Pair[] }[]
  completion?: Pair[]
}
interface EventRaw {
  energy: { min: number; max: number } | null
  maps: { fights: number; fightItems: Pair[]; finish: Pair[] }[]
}
const details = detailsData as unknown as {
  dungeons: Record<string, DungeonRaw>
  events: Record<string, EventRaw>
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

const ALL_GENES = ['A', 'B', 'C', 'D', 'E', 'F']

const range = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`)

function levelText(min: number | null, max: number | null, locale: Locale): string | null {
  // 9999 in the game config means "no upper bound"
  const hi = max !== null && max >= 9999 ? null : max
  if (min && hi) {
    return t('guides.dungeon.levelRange', locale)
      .replace('{min}', String(min))
      .replace('{max}', String(hi))
  }
  if (min) return t('guides.dungeon.levelMin', locale).replace('{n}', String(min))
  if (hi) return t('guides.dungeon.levelMax', locale).replace('{n}', String(hi))
  return null
}

// 5 of 6 allowed genes reads better as "all except one" ("Without Cyborgs" ladders).
function geneView(genes: string[], locale: Locale): DungeonDetailCard['genes'] {
  if (!genes.length) return null
  const except = genes.length === ALL_GENES.length - 1
  const list = except ? ALL_GENES.filter((g) => !genes.includes(g)) : genes
  return { except, list: list.map((g) => ({ label: geneLabelL(g, locale), icon: getGeneIcon(g) })) }
}

const sameItems = (a: Pair[], b: Pair[]) => JSON.stringify(a) === JSON.stringify(b)

export function buildDungeonDetailCard(
  id: string,
  locale: Locale,
  rewardCtx: RewardResolveCtx,
): DungeonDetailCard | null {
  const itemCache = new Map<
    string,
    { name: string; icon: string | null; mutantId: string | null }
  >()
  // currency of the completion reward comes as pseudo ids $hardcurrency / $softcurrency
  const currency: Record<string, { name: string; icon: string }> = {
    $hardcurrency: { name: cap(GOLD_WORD[locale] ?? GOLD_WORD.ru), icon: '/cash/hardcurrency.webp' },
    $softcurrency: { name: cap(SILVER_WORD[locale] ?? SILVER_WORD.ru), icon: '/cash/softcurrency.webp' },
  }
  const item = (pair: Pair): DetailItem => {
    let base = itemCache.get(pair.id)
    if (!base && currency[pair.id]) {
      base = { ...currency[pair.id], mutantId: null }
      itemCache.set(pair.id, base)
    }
    if (!base) {
      const r = resolveReward({ type: 'entity', id: pair.id, amount: '1' }, rewardCtx)
      // luxe zones (Habitat_*_HC) resolve without an icon, the file name is the lowercase id
      const icon =
        r.icon ??
        (/^Habitat_.+_HC$/.test(pair.id) ? `/zones/luxe/${pair.id.toLowerCase()}.webp` : null)
      base = { name: r.label, icon, mutantId: r.mutant?.id ?? null }
      itemCache.set(pair.id, base)
    }
    return {
      label: pair.amount > 1 ? `${base.name} ×${pair.amount}` : base.name,
      icon: base.icon,
      mutantId: base.mutantId,
    }
  }
  const floorTitle = (key: 'floor' | 'map', label: string) =>
    t(`guides.dungeon.${key}`, locale).replace('{n}', label)

  const d = details.dungeons[id]
  if (d) {
    const c = d.conditions
    const cost = d.entryCost
      ? resolveReward({ type: d.entryCost.type, amount: String(d.entryCost.amount) }, rewardCtx)
      : null
    // consecutive floors with the same reward ("3 souls on every one of 80 floors") in one row
    const runs: { from: number; to: number; items: Pair[] }[] = []
    for (const m of d.milestones) {
      const last = runs[runs.length - 1]
      if (last && last.to === m.floor - 1 && sameItems(last.items, m.items)) last.to = m.floor
      else runs.push({ from: m.floor, to: m.floor, items: m.items })
    }
    return {
      kind: 'dungeon',
      known: d.active,
      cost: cost ? { label: cost.label, icon: cost.icon } : null,
      limit: d.completionMax,
      tickets: d.energy ? range(d.energy.min, d.energy.max) : null,
      level: levelText(c?.minLevel ?? null, c?.maxLevel ?? null, locale),
      genes: geneView(c?.genes ?? [], locale),
      stars: c?.stars
        ? c.stars.map((s) => ({
            key: s,
            label: s === '' ? t('guides.dungeon.noStar', locale) : starLabelL(s, locale),
            icon: s === '' ? null : `/stars/star_${s}.webp`,
          }))
        : null,
      rowsTitle: t('guides.dungeon.floorsTitle', locale),
      rows: [
        ...runs.map((r) => {
          const label = r.from === r.to ? String(r.from) : `${r.from}–${r.to}`
          const items = r.items.map(item)
          return {
            floorLabel: label,
            floorTitle: floorTitle('floor', label),
            mutant: items.some((i) => i.mutantId),
            fightItems: [],
            items,
          }
        }),
        // reward for finishing the whole dungeon, on top of the floors
        ...(d.completion?.length
          ? [
              {
                floorLabel: t('guides.dungeon.final', locale),
                floorTitle: t('guides.dungeon.completion', locale),
                mutant: d.completion.some((p) => item(p).mutantId),
                fightItems: [],
                items: d.completion.map(item),
              },
            ]
          : []),
      ],
    }
  }

  const e = details.events[id]
  if (e) {
    const runs: { from: number; to: number; fightItems: Pair[]; finish: Pair[] }[] = []
    e.maps.forEach((m, i) => {
      const last = runs[runs.length - 1]
      if (last && sameItems(last.fightItems, m.fightItems) && sameItems(last.finish, m.finish))
        last.to = i + 1
      else runs.push({ from: i + 1, to: i + 1, fightItems: m.fightItems, finish: m.finish })
    })
    return {
      kind: 'event',
      known: true,
      cost: null,
      limit: null,
      tickets: e.energy ? range(e.energy.min, e.energy.max) : null,
      level: null,
      genes: null,
      stars: null,
      rowsTitle: t('guides.dungeon.mapsTitle', locale),
      rows: runs.map((r) => {
        const label = r.from === r.to ? String(r.from) : `${r.from}–${r.to}`
        const items = r.finish.map(item)
        return {
          floorLabel: label,
          floorTitle: floorTitle('map', label),
          mutant: items.some((i) => i.mutantId),
          fightItems: r.fightItems.map(item),
          items,
        }
      }),
    }
  }
  return null
}
