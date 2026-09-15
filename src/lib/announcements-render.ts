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
  // Точный диапазон ЭТОГО оффера из живого kartel-запроса (см. scripts/
  // kartel-filter-dates.ts) - null, если live-данных нет, тогда карточка
  // берёт общий sprintRangeLabel(sprint) как раньше.
  exactDateLabel?: string | null
  // ISO-дата начала (не форматированная) - для хронологической сортировки
  // офферов на странице (ближайшие сверху), exactDateLabel не сортируется.
  exactDateStart?: string | null
  // Только shopForecast - 'week'/'month' помечает "мутанта недели"/"мутанта
  // месяца" (окно продажи ~7 или ~28-31 день, см.
  // scripts/detect-shop-forecast.ts::classifyFeaturedMutant). 'day' - оффер
  // из пула daily-offer (Path cat="special" subCat="dailyoffer") - тот самый
  // "мутант дня" из календаря MUTODEX/@KaiserZ, см.
  // scripts/detect-shop-forecast.ts::fetchDailyMutantOffers.
  featuredMutant?: 'day' | 'week' | 'month' | null
  // Только exchange - какой из 3 залов (см. scripts/build-announcements.ts::
  // detectExchange). Карточка группирует items по этому полю на 3 подблока.
  hall?: 'jackpot' | 'event' | 'mystery' | null
  // Только hall==='mystery' - цена контракта (жетон + количество).
  cost?: { amount: number; name: string; image: string | null } | null
  // Только hall==='mystery' - клик должен открыть модалку СРАЗУ на этой
  // звезде/скине (jackpot/event Reward'ы их не несут вообще).
  star?: string | null
  skin?: string | null
}

export function featuredMutantLabel(v: string | null | undefined): string | null {
  if (v === 'day') return 'Мутант дня'
  if (v === 'week') return 'Мутант недели'
  if (v === 'month') return 'Мутант месяца'
  return null
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
  eventLadder: 'Ивент-лесенки',
  reactor: 'Реакторы',
  token: 'Жетоны',
  shopForecast: 'Прогноз магазина',
  dailyNews: 'Скоро в игре',
  rebalance: 'Ребаланс',
}

// Переехало в announcement-categories.ts - тот же маппинг нужен и публикации
// (build-announcements.ts), а её голый tsx этот модуль импортировать не может.
// Реэкспорт, чтобы не трогать существующие импорты из компонентов.
export { cardKind, isSingleItemCategory, type CardKind } from './announcement-categories'

export const EXCHANGE_HALL_META: Record<
  'jackpot' | 'event' | 'mystery',
  { title: string; texture: string }
> = {
  jackpot: { title: 'Зал джекпота', texture: '/buildings/jackpot_sink_global.png' },
  event: { title: 'Зал испытаний', texture: '/buildings/item_maker.png' },
  mystery: { title: 'Анализатор тайны', texture: '/buildings/building_mystery.png' },
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

// "Показывать только боксы со скинами" (фидбек юзера 2026-09-15) - старые
// боксы (LuckyBox_Stars_22 и т.п.) не несут ни одного скин-дропа, только
// голых мутантов/звёзды; актуальные ивент-боксы 2025-2026 все со скинами.
// Данные, не имя - хардкодить список "старых" названий было бы хрупко.
export function boxHasSkin(box: BoxEntry): boolean {
  return box.groups.some((g) => g.mutants.some((m) => !!m.skin))
}

export function boxMutantIcon(m: BoxMutantRef): string {
  const variant = (
    m.tier && ['бронза', 'серебро', 'золото', 'платина'].includes(m.tier)
      ? { бронза: 'bronze', серебро: 'silver', золото: 'gold', платина: 'platinum' }[m.tier]
      : 'normal'
  ) as 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
  return getMutantTexturePath(m.id, m.skin ?? '_any', variant)
}

export interface BoxReward {
  name: string
  type: 'entity' | 'hardcurrency' | 'softcurrency'
  amount: number
}
export interface BoxOutcome {
  chance: number | null
  mutants: BoxMutantRef[]
  rewards: BoxReward[]
}

// 1-в-1 с BoxModal.svelte::groupedOutcomes: игра разыгрывает бокс по группам
// (мутант + бонусный жетон в одном атомарном исходе, а не два независимых
// слота). Схлопываем группы с одинаковым содержимым, суммируя шанс. Затем
// делим на гарантированное (chance == null) и пул (chance != null).
export function boxGroupedOutcomes(box: BoxEntry): {
  guaranteed: BoxOutcome[]
  pool: BoxOutcome[]
} {
  const map = new Map<string, BoxOutcome>()
  for (const g of box.groups as unknown as BoxOutcome[]) {
    const key = [
      ...g.mutants.map((m) => `m:${m.id}|${m.tier ?? ''}|${m.skin ?? ''}`),
      ...(g.rewards ?? []).map((r) => `r:${r.type}|${r.name}|${r.amount}`),
    ]
      .sort()
      .join(',')
    const existing = map.get(key)
    if (existing) {
      if (existing.chance != null && g.chance != null) existing.chance += g.chance
    } else {
      map.set(key, { chance: g.chance, mutants: g.mutants, rewards: g.rewards ?? [] })
    }
  }
  const outcomes = [...map.values()]
  return {
    guaranteed: outcomes.filter((o) => o.chance == null),
    pool: outcomes.filter((o) => o.chance != null),
  }
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

// Бинго-анонсы, записанные ДО фикса 2026-09-09 (build-announcements.ts::
// detectBingo), хранят addedNames сырыми ("Specimen_DA_15") - тогдашний код
// ещё не резолвил их через mutantNames. Живёт как ДАННЫЕ в announcements.json
// навсегда (JSON не бэкфиллили), поэтому чиним на рендере, а не миграцией:
// покрывает и старые записи, и любую будущую подобную протечку разом.
const RAW_SPECIMEN_ID_RE = /^Specimen_[A-Za-z]+_\d+$/i
export function bingoAddedNames(names: string[], mutantsById: Map<string, MutantRaw>): string[] {
  return names.map((name) => {
    if (!RAW_SPECIMEN_ID_RE.test(name)) return name
    return mutantsById.get(name.toLowerCase())?.name ?? name
  })
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

// Прогноз магазина (shopForecast) несёт сырые itemId из shopitems.xml
// (Specimen_CC_12_Gold, bundle_orbs_crafting_master, Mystery_School_2026...) -
// ни mutants.json id (base-форма, без звезды), ни boxes.json itemId напрямую
// не совпадают. Резолвит тайл прогноза в клик-цель модалки: мутант (+звезда,
// если суффикс её нёс) или бокс. Бандлы/паки - ни то ни другое, null
// (тайл остаётся некликабельным, открывать нечего).
export type ForecastClickTarget =
  { type: 'mutant'; id: string; star: string | null } | { type: 'box'; id: string } | null

// itemId в shopitems.xml несёт МАССУ хвостов помимо звезды - валютные/офферные
// коды (_sc/_rc/_hc/_lc), событийные теги (_xmas/_halloween/_aprilfools/...),
// комбинации (_silver_sc_xmas) - НАЙДЕНО 2026-09-16 живьём ("Хранитель Ключей"/
// "Левиафан" не кликались: суффикс _sc не входил в старый список звёзд).
// Пытаться перечислить все хвосты - бесконечная игра в догонялки с новым
// ивент-контентом. Вместо этого - вырезаем ТОЛЬКО префикс specimen_<ген>_<номер>
// целиком, что бы за ним ни следовало; звезда (если это первый сегмент хвоста) -
// отдельно, best-effort, не блокирует резолв мутанта если её там нет/незнакома.
const STAR_NAMES = new Set(['normal', 'bronze', 'silver', 'gold', 'platinum', 'plat'])

export function resolveForecastTarget(
  itemId: string,
  mutantsById: Map<string, MutantRaw>,
  findBox: (itemId: string) => BoxEntry | undefined,
): ForecastClickTarget {
  // offer.id = "<sprint>|<rawItemId>" (см. forecastSprint) - НАЙДЕНО
  // 2026-09-16: забыл срезать префикс спринта, поэтому /^specimen_/i никогда
  // не матчился и тайлы прогноза не кликались вообще. dailyNews вдобавок
  // несёт свой rawItemId с префиксом "Shop_" (напр. "Shop_Specimen_FC_04") -
  // shopForecast его не несёт, срезаем на всякий случай в обоих случаях.
  const withoutSprint = itemId.includes('|') ? itemId.slice(itemId.indexOf('|') + 1) : itemId
  const cleaned = withoutSprint
    .replace(/^-+/, '')
    .replace(/^#/, '')
    .replace(/^shop_/i, '')
  const baseMatch = cleaned.match(/^specimen_[a-z]+_\d+/i)
  if (baseMatch) {
    const base = baseMatch[0].toLowerCase()
    const rest = cleaned.slice(baseMatch[0].length).replace(/^_+/, '')
    const firstSeg = rest.split('_')[0]?.toLowerCase()
    const star =
      firstSeg && STAR_NAMES.has(firstSeg) ? (firstSeg === 'plat' ? 'platinum' : firstSeg) : null
    if (mutantsById.has(base)) return { type: 'mutant', id: base, star }
  }
  const box = findBox(cleaned)
  if (box) return { type: 'box', id: box.itemId }
  return null
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
