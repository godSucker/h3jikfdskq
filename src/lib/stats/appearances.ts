// Bingo membership and recent shop appearances of a mutant: the data behind the
// "Бинго" / "Последние появления" blocks of the Telegram stats card.
//
// Pure functions over plain data (the bound versions at the bottom feed them
// the site's JSON), so the logic is unit-testable and has no I/O.
import { bingoLabelL } from '@/lib/mutant-dicts'
import { compareBingoBoards } from '@/lib/bingo-order'
import { baseMutantId } from '@/lib/utils'
import { renderObtainWhere } from '@/lib/obtain-render'
import bingosRaw from '@/data/bingos.json'
import mutantsRaw from '@/data/mutants/mutants.json'
import offerHistoryRaw from '@/data/mutants/offer-history.json'
import obtainRaw from '@/data/mutants/obtain.json'

export const FORGE_REWARD = 'Building_HC_1' // Златокузня
export const SMELTER_REWARD = 'Building_HC_2' // Золотоплавильня
export type GoldBuilding = 'forge' | 'smelter'

export interface BingoBoardData {
  id: string
  columns?: number
  rewards: { name: string }[]
  mutants: { specimenId: string }[]
}

// Boards where THIS mutant sits on a row / column / the whole board that is
// rewarded with a gold forge or smelter. Same reward-to-line layout as
// getBingoLayout() in BingoPage.astro (rewards go rows -> columns -> prize for
// the whole board): a mutant on a board that merely contains a forge reward
// somewhere else does not count.
export function goldBuildingsOnBoard(board: BingoBoardData, specimenId: string): GoldBuilding[] {
  const count = board.mutants.length
  let cols = board.columns || Math.ceil(Math.sqrt(count))
  if (count === 12 && !board.columns) cols = 4
  const rows = Math.ceil(count / cols)
  const withCompletion = board.rewards.length === rows + cols + 1
  if (!withCompletion && board.rewards.length !== rows + cols) return []

  const idx = board.mutants.findIndex((m) => m.specimenId.toLowerCase() === specimenId)
  if (idx < 0) return []
  const row = Math.floor(idx / cols)
  const col = idx % cols
  const found = new Set<GoldBuilding>()
  const mark = (name: string | undefined) => {
    if (name === FORGE_REWARD) found.add('forge')
    if (name === SMELTER_REWARD) found.add('smelter')
  }
  mark(board.rewards[row]?.name)
  mark(board.rewards[rows + col]?.name)
  if (withCompletion) mark(board.rewards[board.rewards.length - 1]?.name)
  return [...found]
}

export interface BingoChip {
  label: string
  // Gold forge/smelter on a line this mutant belongs to (shown first, highlighted).
  gold: GoldBuilding[]
}

// Forge/smelter boards first, the rest in the site's board order.
export function bingoChipsFor(
  specimenId: string,
  boardKeys: string[],
  boards: BingoBoardData[],
  label: (id: string) => string,
): BingoChip[] {
  const byId = new Map(boards.map((b) => [b.id, b]))
  const chips = boardKeys.map((key) => {
    const board = byId.get(key)
    return { key, label: label(key), gold: board ? goldBuildingsOnBoard(board, specimenId) : [] }
  })
  chips.sort((a, b) => {
    if (!!a.gold.length !== !!b.gold.length) return a.gold.length ? -1 : 1
    return compareBingoBoards(a.key, b.key, label)
  })
  return chips.map(({ label: l, gold }) => ({ label: l, gold }))
}

// [date, ref, price?] - same shape as offer-history.json.
export type OfferHistoryEntry = [string, string, ([string, number][] | null)?]
export interface ObtainEntry {
  type: string
  where: string
  itemId?: string
}
export interface RecentOffer {
  date: string
  label: string
  price: [string, number][] | null
}

// Same selection rules as the mutant modal: future windows dropped, label taken
// from the matching obtain entry (or "Магазин" for the mutant's own shop item),
// duplicates of the same date+label collapsed, newest first.
export function pickRecentOffers(
  list: OfferHistoryEntry[],
  obtain: ObtainEntry[],
  today: string,
  max: number,
  renderWhere: (entry: ObtainEntry) => string = (e) => e.where,
  shopLabel = 'Магазин',
): RecentOffer[] {
  const seen = new Set<string>()
  const out: RecentOffer[] = []
  for (const [date, ref, price] of list) {
    if (date > today) continue
    const entry = obtain.find((o) =>
      ref.includes('|') ? `${o.type}|${o.where}` === ref : o.itemId === ref,
    )
    const label = entry ? renderWhere(entry) : ref.startsWith('Specimen_') ? shopLabel : ''
    if (!label || seen.has(`${date}|${label}`)) continue
    seen.add(`${date}|${label}`)
    out.push({ date, label, price: price ?? null })
    if (out.length === max) break
  }
  return out
}

export type OffersState = 'ok' | 'none' | 'onlyLowChance'

export interface Appearances {
  bingo: BingoChip[]
  offers: RecentOffer[]
  // 'none' = no known dates, 'onlyLowChance' = appearances exist but all in
  // containers with a chance below 10% (empty array in offer-history.json).
  offersState: OffersState
}

export const MAX_OFFERS = 3

export function buildAppearances(
  mutantId: string,
  today: string,
  data: {
    bingoKeys: string[]
    boards: BingoBoardData[]
    offerHistory: Record<string, OfferHistoryEntry[]>
    obtain: Record<string, ObtainEntry[]>
  },
): Appearances {
  const id = baseMutantId(mutantId).toLowerCase()
  const bingo = bingoChipsFor(id, data.bingoKeys, data.boards, (k) => bingoLabelL(k, 'ru'))
  const list = data.offerHistory[id]
  const offers = list?.length
    ? pickRecentOffers(list, data.obtain[id] ?? [], today, MAX_OFFERS, (e) =>
        renderObtainWhere(e, 'ru', {}),
      )
    : []
  const offersState: OffersState = offers.length
    ? 'ok'
    : Array.isArray(list) && list.length === 0
      ? 'onlyLowChance'
      : 'none'
  return { bingo, offers, offersState }
}

const mutantsById = new Map<string, { bingo?: unknown }>(
  (mutantsRaw as { id: string; bingo?: unknown }[]).map((m) => [m.id, m]),
)

function bingoKeysOf(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === 'string' ? x : ((x as { key?: string } | null)?.key ?? '')))
      .filter(Boolean)
  }
  return raw && typeof raw === 'object' ? Object.keys(raw) : []
}

// Bound to the site's data. `today` is UTC, like the modal's cut-off.
export function appearancesFor(
  mutantId: string,
  today = new Date().toISOString().slice(0, 10),
): Appearances {
  const id = baseMutantId(mutantId).toLowerCase()
  return buildAppearances(id, today, {
    bingoKeys: bingoKeysOf(mutantsById.get(id)?.bingo),
    boards: bingosRaw as unknown as BingoBoardData[],
    offerHistory: offerHistoryRaw as unknown as Record<string, OfferHistoryEntry[]>,
    obtain: obtainRaw as unknown as Record<string, ObtainEntry[]>,
  })
}

// Changes whenever anything visible in the blocks changes - part of the card
// cache key, so a data update is not hidden behind a cached PNG.
export function appearancesSignature(a: Appearances): string {
  return JSON.stringify([
    a.bingo.map((c) => [c.label, c.gold]),
    a.offers.map((o) => [o.date, o.label, o.price]),
    a.offersState,
  ])
}
