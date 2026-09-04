// Общий слой данных для карточки анонса - используется И на /announcements
// (лента), И на /announcements/render/[id] (изолированная страница для
// скриншот-бота, без ленты/фильтров/CTA). Вынесено в отдельный модуль, чтобы
// не дублировать резолверы box/dungeon/bingo в двух .astro файлах (тот же
// принцип, что guides-resolve.ts - framework-agnostic, строит lookup-карты
// один раз через ESM module cache).
import mutantsData from '@/data/mutants/mutants.json'
import raidsData from '@/data/guides/raids.json'
import specialLaddersData from '@/data/guides/special-ladders.json'
import materialData from '@/data/materials/material.json'
import dungeonCovers from '@/data/guides/dungeon-covers.json'
import { translateItemId, getItemTexture } from '@/lib/craft-simulator'
import { getLocalisedName } from '@/lib/localisation'
import { getGeneIcon } from '@/lib/mutant-icons'
import { GENE_RU, bingoLabel } from '@/lib/mutant-dicts'
import bingosData from '@/data/bingos.json'
import {
  resolveDungeon,
  type DungeonRaw,
  type MutantRaw,
  type MaterialEntry,
  type RewardResolveCtx,
  type ResolvedDungeon,
} from '@/lib/guides-resolve'
import boxesData from '@/data/boxes.json'
import { getMutantTexturePath } from '@/lib/bingo-textures'

export interface AnnouncementItem {
  id: string
  name: string
  image?: string | null
  addedNames?: string[]
  // Только для shopForecast/dailyNews - реальная цена оффера, если она есть
  // (не у всех, часть daily_news - чисто событийные анонсы без покупки).
  // 'usd' - донат-паки за реальные деньги (<RealPrices Currency="USD">),
  // отдельно от игровой золота/серебра.
  price?: { amount: number; type: 'hardcurrency' | 'softcurrency' | 'usd' } | null
  // Только для shopForecast/dailyNews - настоящая игровая лента оффера
  // (offerTag из shopitems.xml), см. scripts/shop-offer-tags.ts.
  ribbon?: string | null
}

// Зеркалит OfferRibbon из scripts/shop-offer-tags.ts (не импортируем сам файл -
// он тянет node-only axios/fs и живёт вне Vite-графа страницы).
const RIBBON_LABEL: Record<string, string> = {
  legendary: 'Легендарный',
  limited: 'Ограничено',
  new: 'Новинка',
  heroic: 'Героический',
  exclusive: 'Эксклюзив',
  seasonal: 'Событие',
}

export function ribbonLabel(ribbon: string | null | undefined): string | null {
  if (!ribbon) return null
  const discount = ribbon.match(/^discount-(\d+)$/)
  if (discount) return `-${discount[1]}%`
  return RIBBON_LABEL[ribbon] ?? null
}

export function ribbonClass(ribbon: string | null | undefined): string {
  if (!ribbon) return ''
  if (ribbon.startsWith('discount-')) return 'ribbon-discount'
  return `ribbon-${ribbon}`
}

export interface Announcement {
  id: string
  date: string
  category?: string
  title?: string
  text?: string | null
  imagePath?: string | null
  sourceUrl?: string | null
  items?: AnnouncementItem[] | null
  link?: string | null
}

export const CATEGORY_RU: Record<string, string> = {
  mutant: 'Мутанты',
  skin: 'Скины',
  bingo: 'Бинго',
  box: 'Боксы',
  exchange: 'Обменники',
  raid: 'Рейды',
  ladder: 'Лесенки',
  reactor: 'Реакторы',
  token: 'Жетоны',
  shopForecast: 'Прогноз магазина',
  dailyNews: 'Скоро в игре',
  rebalance: 'Ребаланс',
}

export type CardKind =
  'dungeon' | 'mutant' | 'skin' | 'reactor' | 'box' | 'bingo' | 'forecast' | 'generic'

export function cardKind(category: string | undefined): CardKind {
  if (category === 'raid' || category === 'ladder') return 'dungeon'
  if (category === 'mutant') return 'mutant'
  if (category === 'skin') return 'skin'
  if (category === 'reactor') return 'reactor'
  if (category === 'box') return 'box'
  if (category === 'bingo') return 'bingo'
  if (category === 'shopForecast' || category === 'dailyNews') return 'forecast'
  return 'generic'
}

// id оффера внутри прогноза = "<sprint>|<filter>" (см. detectShopForecast/
// detectDailyNews в build-announcements.ts).
export function forecastSprint(items: AnnouncementItem[]): number | null {
  const raw = items[0]?.id.split('|')[0]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

export interface BoxMutantRef {
  id: string
  name: string
  tier: string | null
  skin: string | null
}
export interface BoxGroup {
  chance: number | null
  mutants: BoxMutantRef[]
  rewards: { name: string; type: string; amount: number }[]
}
export interface BoxEntry {
  itemId: string
  icon: string | null
  category: string
  name: string
  price: { amount: number; type: 'hardcurrency' | 'softcurrency' } | null
  groups: BoxGroup[]
}

export const TIER_ICON: Record<string, string> = {
  бронза: '/stars/star_bronze.webp',
  серебро: '/stars/star_silver.webp',
  золото: '/stars/star_gold.webp',
  платина: '/stars/star_platinum.webp',
}

export function formatPrice(
  price: { amount: number; type: 'hardcurrency' | 'softcurrency' | 'usd' } | null | undefined,
): string | null {
  if (!price) return null
  if (price.type === 'usd') return `USD ${price.amount.toFixed(2)}`
  const label = price.type === 'hardcurrency' ? 'золота' : 'серебра'
  return `${price.amount.toLocaleString('ru-RU')} ${label}`
}

export function boxMutantIcon(m: BoxMutantRef): string {
  const variant = (
    m.tier && ['бронза', 'серебро', 'золото', 'платина'].includes(m.tier)
      ? { бронза: 'bronze', серебро: 'silver', золото: 'gold', платина: 'platinum' }[m.tier]
      : 'normal'
  ) as 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
  return getMutantTexturePath(m.id, m.skin ?? '_any', variant)
}

export function uniqueBoxMutants(box: BoxEntry): BoxMutantRef[] {
  const seen = new Set<string>()
  const out: BoxMutantRef[] = []
  for (const g of box.groups) {
    for (const m of g.mutants) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      out.push(m)
    }
  }
  return out
}

export function boxDescription(box: BoxEntry): string {
  const pool = box.groups.filter((g) => g.chance != null)
  if (pool.length === 0) return 'Гарантированное содержимое'
  const chances = new Set(pool.map((g) => g.chance!.toFixed(1)))
  if (chances.size === 1) {
    return `Случайный выбор · ${pool.length} равновероятных слотов, шанс ${pool[0].chance!.toFixed(1)}%`.toUpperCase()
  }
  return `Случайный выбор · ${pool.length} слотов с разным шансом`.toUpperCase()
}

export function formatBingoTitle(title: string, id: string): string {
  const labelById = bingoLabel(id)
  if (labelById && labelById !== id) return labelById
  const labelByTitle = bingoLabel(title)
  if (labelByTitle && labelByTitle !== title) return labelByTitle
  return title
    .replace(/^--------/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export interface AnnouncementRenderContext {
  mutantsById: Map<string, MutantRaw>
  dungeonById: Map<string, ResolvedDungeon>
  dungeonCoversMap: Record<string, string | null>
  boxesById: Map<string, BoxEntry>
  boxesByIdLower: Map<string, BoxEntry>
  bingosById: Map<string, string>
  findBox: (itemId: string) => BoxEntry | undefined
}

// Строится один раз за модуль (ESM-кэш) - каждый .astro файл, что импортирует
// этот модуль, переиспользует ОДИН И ТОТ ЖЕ построенный контекст, не
// пересобирает Map на каждый рендер карточки.
export function buildAnnouncementContext(): AnnouncementRenderContext {
  const mutantsById = new Map((mutantsData as MutantRaw[]).map((m) => [m.id, m]))
  const materialsById = new Map((materialData as MaterialEntry[]).map((m) => [m.id, m]))
  const rewardCtx: RewardResolveCtx = {
    mutantsById,
    materialsById,
    translateItemId,
    getItemTexture,
    getLocalisedName,
    getGeneIcon,
    geneRu: GENE_RU,
  }
  const dungeonById = new Map<string, ResolvedDungeon>(
    [
      ...(raidsData as DungeonRaw[]),
      ...(specialLaddersData as { experiment: DungeonRaw[]; challenge: DungeonRaw[] }).experiment,
      ...(specialLaddersData as { experiment: DungeonRaw[]; challenge: DungeonRaw[] }).challenge,
    ].map((d) => [d.id, resolveDungeon(d, rewardCtx)]),
  )
  const dungeonCoversMap = dungeonCovers as Record<string, string | null>
  const boxesById = new Map((boxesData as BoxEntry[]).map((b) => [b.itemId, b]))
  const boxesByIdLower = new Map((boxesData as BoxEntry[]).map((b) => [b.itemId.toLowerCase(), b]))
  const bingosById = new Map(
    (bingosData as { id: string; title: string }[]).map((b) => [b.id, b.title]),
  )

  return {
    mutantsById,
    dungeonById,
    dungeonCoversMap,
    boxesById,
    boxesByIdLower,
    bingosById,
    findBox: (itemId: string) => boxesById.get(itemId) ?? boxesByIdLower.get(itemId.toLowerCase()),
  }
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
