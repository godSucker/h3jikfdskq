// Details of raids / special ladders / event ladders for /guides: entry cost,
// completion limit, per-mutant conditions, energy per fight and the rewards
// handed out on each floor (milestones). Stored separately from raids.json,
// special-ladders.json and event-ladders.json (they are written by
// finish-pending.ts after a human names a dungeon), so this file can be
// regenerated at any time without touching them.
//
// Sources (s-beta gameconfig, plain XML, no decryption needed):
//   dungeon/dungeons.xml         master registry: cost, completionMax, conditions
//   dungeon/dungeon_<id>.xml     one file per dungeon: fights (= floors), energy, rewards
//   pve_event/<id>.xml           event ladders: maps -> fights, MapFinishingReward
//   content_mb.csv               manifest, lists every pve_event file (new events show up here)
//
// Additive: an id that disappears from the registry (dungeon retired) keeps its
// last known entry and is marked active=false; a failed download keeps the old entry.
// ASCII-only comments on purpose (esbuild/tsx and U+2014, see CLAUDE.md Gotchas).

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import { runMain } from './lib/run-main'

const ROOT = process.cwd()
const BASE = 'https://s-beta.kobojo.com/mutants/gameconfig'
const OUT_PATH = path.join(ROOT, 'src/data/guides/dungeon-details.json')
const RAIDS_PATH = path.join(ROOT, 'src/data/guides/raids.json')
const SPECIAL_PATH = path.join(ROOT, 'src/data/guides/special-ladders.json')
const EVENTS_PATH = path.join(ROOT, 'src/data/guides/event-ladders.json')

export interface ItemAmount {
  id: string
  amount: number
}
export interface Conditions {
  minLevel: number | null
  maxLevel: number | null
  genes: string[]
  stars: string[] | null
}
export interface DungeonDetail {
  type: 'raid' | 'experiment' | 'challenge'
  active: boolean
  entryCost: { amount: number; type: 'hardcurrency' | 'softcurrency' } | null
  completionMax: number | null
  conditions: Conditions | null
  // title logo on the Kobojo CDN (pveeventcontent), null = none found
  title?: string | null
  // arena screenshot (screen_<asset>.jpg), the poster background
  screen?: string | null
  floors: number
  energy: { min: number; max: number; total: number } | null
  milestones: { floor: number; items: ItemAmount[] }[]
}
export interface EventMapDetail {
  fights: number
  energy: [number, number] | null
  fightItems: ItemAmount[]
  finish: ItemAmount[]
}
export interface EventDetail {
  active: boolean
  title?: string | null
  screen?: string | null
  energy: { min: number; max: number; total: number } | null
  maps: EventMapDetail[]
}
interface DetailsFile {
  dungeons: Record<string, DungeonDetail>
  events: Record<string, EventDetail>
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function fetchText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get<string>(url, { timeout: 30000, responseType: 'text' })
      return res.data
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  return null
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

// Entity rewards inside a fragment. Currency/experience rewards are skipped on
// purpose (totals already live in raids.json etc.).
function entityRewards(frag: string): ItemAmount[] {
  const out: ItemAmount[] = []
  for (const m of frag.matchAll(/<(?:Reward|MapFinishingReward)\b([^>]*)\/>/g)) {
    const a = attrs(m[1])
    if (a.type === 'softcurrency' || a.type === 'hardcurrency' || a.type === 'experience') continue
    if (a.id) out.push({ id: a.id, amount: Number(a.amount ?? '1') || 1 })
  }
  return out
}

function fightEnergy(frag: string): number | null {
  const m = frag.match(/<Cost\b([^>]*)\/>/)
  if (!m) return null
  const a = attrs(m[1])
  return a.type === 'energy' ? Number(a.amount) : null
}

function splitFights(xml: string): string[] {
  return xml.match(/<Fight\b[\s\S]*?<\/Fight>/g) ?? []
}

function energySummary(values: number[]): { min: number; max: number; total: number } | null {
  if (values.length === 0) return null
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    total: values.reduce((s, v) => s + v, 0),
  }
}

interface RegistryEntry {
  assetId: string | null
  type: DungeonDetail['type']
  completionMax: number | null
  entryCost: DungeonDetail['entryCost']
  conditions: Conditions | null
}

export function parseRegistry(xml: string): Map<string, RegistryEntry> {
  const out = new Map<string, RegistryEntry>()
  for (const block of xml.match(/<Dungeon\b[^>]*>[\s\S]*?<\/Dungeon>/g) ?? []) {
    const head = attrs(block.match(/<Dungeon\b([^>]*)>/)![1])
    if (!head.id || !/^(raid|experiment|challenge)$/.test(head.type)) continue
    const costTag = block.match(/<Cost\b([^>]*)\/>/)
    const cost = costTag ? attrs(costTag[1]) : null
    const condBlock = block.match(/<Conditions>([\s\S]*?)<\/Conditions>/)
    let conditions: Conditions | null = null
    if (condBlock) {
      const c: Conditions = { minLevel: null, maxLevel: null, genes: [], stars: null }
      for (const lv of condBlock[1].matchAll(/<Level\b([^>]*)\/?>/g)) {
        const a = attrs(lv[1])
        if (a.type === 'min') c.minLevel = Number(a.value)
        if (a.type === 'max') c.maxLevel = Number(a.value)
      }
      c.genes = [...condBlock[1].matchAll(/<Gene\b([^>]*)\/?>/g)]
        .map((g) => attrs(g[1]).type)
        .filter(Boolean)
      const stars = [...condBlock[1].matchAll(/<Star\b([^>]*)\/?>/g)].map(
        (s) => attrs(s[1]).type ?? '',
      )
      c.stars = stars.length ? stars : null
      const empty =
        c.minLevel === null && c.maxLevel === null && c.genes.length === 0 && c.stars === null
      conditions = empty ? null : c
    }
    out.set(head.id, {
      assetId: head.assetId || null,
      type: head.type as DungeonDetail['type'],
      completionMax: head.completionMax ? Number(head.completionMax) : null,
      entryCost:
        cost && (cost.type === 'hardcurrency' || cost.type === 'softcurrency')
          ? { amount: Number(cost.amount), type: cost.type }
          : null,
      conditions,
    })
  }
  return out
}

export function parseDungeonFile(
  xml: string,
): Pick<DungeonDetail, 'floors' | 'energy' | 'milestones'> {
  const fights = splitFights(xml)
  const energies: number[] = []
  const milestones: DungeonDetail['milestones'] = []
  fights.forEach((f, idx) => {
    const e = fightEnergy(f)
    if (e !== null) energies.push(e)
    const idAttr = f.match(/<Fight\b[^>]*\bid="(\d+)"/)
    const floor = (idAttr ? Number(idAttr[1]) : idx) + 1
    const items = entityRewards(f)
    if (items.length) milestones.push({ floor, items })
  })
  return { floors: fights.length, energy: energySummary(energies), milestones }
}

function sumItems(list: ItemAmount[]): ItemAmount[] {
  const acc = new Map<string, number>()
  for (const it of list) acc.set(it.id, (acc.get(it.id) ?? 0) + it.amount)
  return [...acc].map(([id, amount]) => ({ id, amount }))
}

export function parseEventFile(xml: string): Pick<EventDetail, 'energy' | 'maps'> {
  const maps: EventMapDetail[] = []
  const all: number[] = []
  for (const m of xml.matchAll(/<Map\b[^>]*>([\s\S]*?)<\/Map>/g)) {
    const body = m[1]
    const fights = splitFights(body)
    const energies = fights.map(fightEnergy).filter((e): e is number => e !== null)
    all.push(...energies)
    // finishing reward sits in the Map but outside any Fight
    const outsideFights = body.replace(/<Fight\b[\s\S]*?<\/Fight>/g, '')
    maps.push({
      fights: fights.length,
      energy: energies.length ? [Math.min(...energies), Math.max(...energies)] : null,
      fightItems: sumItems(fights.flatMap((f) => entityRewards(f))),
      finish: entityRewards(outsideFights),
    })
  }
  return { energy: energySummary(all), maps }
}

const ASSET_BASE = 'https://s-beta.kobojo.com/mutants/assets/pveeventcontent/'

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await axios.head(url, {
      timeout: 8000,
      validateStatus: (s) => s === 200 || s === 404,
    })
    return res.status === 200
  } catch {
    return false
  }
}

// Title logo: title_<c>-ru.png, falling back to title_<c>.png. Candidates in order:
// the registry assetId (69 of 105 dungeons use an asset that differs from the id,
// e.g. vegas_16 -> vegas), the id, the id without "season_", the id without "_N".
// 147 of 147 resolved on 2026-10-06.
function assetCandidates(id: string, assetId: string | null): string[] {
  const noSeason = id.replace(/^season_/, '')
  return [
    ...new Set([assetId, id, noSeason, noSeason.replace(/_\d+$/, '')].filter(Boolean) as string[]),
  ]
}

export async function resolveScreen(id: string, assetId: string | null): Promise<string | null> {
  for (const c of assetCandidates(id, assetId)) {
    const url = `${ASSET_BASE}screen_${c}.jpg`
    if (await urlExists(url)) return url
  }
  return null
}

export async function resolveTitle(id: string, assetId: string | null): Promise<string | null> {
  for (const c of assetCandidates(id, assetId)) {
    for (const suffix of ['-ru.png', '.png']) {
      const url = `${ASSET_BASE}title_${c}${suffix}`
      if (await urlExists(url)) return url
    }
  }
  return null
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

async function main() {
  const [registryXml, manifest, raids, special, events, prev] = await Promise.all([
    fetchText(`${BASE}/dungeon/dungeons.xml`),
    fetchText(`${BASE}/content_mb.csv`),
    loadJson<{ id: string }[]>(RAIDS_PATH, []),
    loadJson<{ experiment: { id: string }[]; challenge: { id: string }[] }>(SPECIAL_PATH, {
      experiment: [],
      challenge: [],
    }),
    loadJson<{ id: string }[]>(EVENTS_PATH, []),
    loadJson<DetailsFile>(OUT_PATH, { dungeons: {}, events: {} }),
  ])
  if (!registryXml)
    throw new Error('dungeons.xml is not reachable, refusing to touch dungeon-details.json')

  const registry = parseRegistry(registryXml)
  const siteDungeonIds = [
    ...raids.map((r) => r.id),
    ...special.experiment.map((r) => r.id),
    ...special.challenge.map((r) => r.id),
  ]
  const dungeonIds = [...new Set([...registry.keys(), ...siteDungeonIds])]

  // event ladders: site list + every pve_event file in the manifest
  const manifestEvents = (manifest ?? '')
    .split('\n')
    .map((l) => l.match(/gamedata\/pve_event\/(.+)\.xmz/)?.[1])
    .filter((x): x is string => Boolean(x))
  const eventIds = [...new Set([...events.map((e) => e.id), ...manifestEvents])]
  const siteEventIds = new Set(events.map((e) => e.id))
  const unknownEvents = manifestEvents.filter((id) => !siteEventIds.has(id))

  const next: DetailsFile = { dungeons: { ...prev.dungeons }, events: { ...prev.events } }
  let failed = 0

  await mapLimit(dungeonIds, 6, async (id) => {
    const xml = await fetchText(`${BASE}/dungeon/dungeon_${id}.xml`)
    const reg = registry.get(id)
    if (!xml) {
      failed++
      console.error(`[DUNGEON-DETAILS] dungeon_${id}.xml not downloaded, keeping previous entry`)
      return
    }
    const body = parseDungeonFile(xml)
    const old = prev.dungeons[id]
    const type = reg?.type ?? old?.type ?? (raids.some((r) => r.id === id) ? 'raid' : 'experiment')
    next.dungeons[id] = {
      type,
      active: Boolean(reg),
      // a retired dungeon is not in the registry any more: keep what we knew about cost/conditions
      entryCost: reg ? reg.entryCost : (old?.entryCost ?? null),
      completionMax: reg ? reg.completionMax : (old?.completionMax ?? null),
      conditions: reg ? reg.conditions : (old?.conditions ?? null),
      title: old?.title ?? (await resolveTitle(id, reg?.assetId ?? null)),
      screen:
        old?.screen !== undefined ? old.screen : await resolveScreen(id, reg?.assetId ?? null),
      ...body,
    }
  })

  await mapLimit(eventIds, 6, async (id) => {
    const xml = await fetchText(`${BASE}/pve_event/${id}.xml`)
    if (!xml) {
      failed++
      console.error(`[DUNGEON-DETAILS] pve_event/${id}.xml not downloaded, keeping previous entry`)
      return
    }
    const oldEvent = prev.events[id]
    next.events[id] = {
      active: manifestEvents.includes(id),
      title: oldEvent?.title ?? (await resolveTitle(id, null)),
      screen: oldEvent?.screen !== undefined ? oldEvent.screen : await resolveScreen(id, null),
      ...parseEventFile(xml),
    }
  })

  const sortObj = <T>(o: Record<string, T>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
  const out: DetailsFile = { dungeons: sortObj(next.dungeons), events: sortObj(next.events) }
  const text = JSON.stringify(out, null, 1) + '\n'
  const before = await fs.readFile(OUT_PATH, 'utf-8').catch(() => '')
  if (before === text) {
    console.log('[DUNGEON-DETAILS] no changes')
  } else {
    await fs.writeFile(OUT_PATH, text, 'utf-8')
    console.log(
      `[DUNGEON-DETAILS] written: ${Object.keys(out.dungeons).length} dungeons, ${Object.keys(out.events).length} events`,
    )
  }
  if (unknownEvents.length) {
    console.log(
      `[DUNGEON-DETAILS] event ladders in the game manifest but not on the site: ${unknownEvents.join(', ')}`,
    )
  }
  if (failed) console.log(`[DUNGEON-DETAILS] ${failed} downloads failed (old entries kept)`)
}

runMain(import.meta.url, 'DUNGEON-DETAILS', main)
