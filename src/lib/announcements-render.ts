// Общий слой данных для карточки анонса - используется И на /announcements
// (лента), И на /announcements/render/[id] (изолированная страница для
// скриншот-бота, без ленты/фильтров/CTA). Вынесено в отдельный модуль, чтобы
// не дублировать резолверы box/dungeon/bingo в двух .astro файлах (тот же
// принцип, что guides-resolve.ts - framework-agnostic, строит lookup-карты
// один раз через ESM module cache).
import mutantsData from '@/data/mutants/mutants.json'
import skinIconsData from '@/data/mutants/skin-icons.json'
import skinsData from '@/data/mutants/skins.json'
import raidsData from '@/data/guides/raids.json'
import specialLaddersData from '@/data/guides/special-ladders.json'
import materialData from '@/data/materials/material.json'
import dungeonCovers from '@/data/guides/dungeon-covers.json'
import { translateItemId, getItemTexture } from '@/lib/craft-simulator'
import { getLocalisedName } from '@/lib/localisation'
import { getGeneIcon } from '@/lib/mutant-icons'
import { GENE_RU, bingoLabelL } from '@/lib/mutant-dicts'
import bingosData from '@/data/bingos.json'
import eventQuestsData from '@/data/guides/event-quests.json'
import { shouldShowAmount } from '@/lib/event-quest-text'
import {
  resolveDungeon,
  resolveReward,
  type DungeonRaw,
  type MutantRaw,
  type MaterialEntry,
  type RewardResolveCtx,
  type ResolvedDungeon,
} from '@/lib/guides-resolve'
import boxesData from '@/data/boxes.json'
import { getMutantTexturePath } from '@/lib/bingo-textures'
import { t, type Locale } from '@/lib/i18n'
import { getItemName } from '@/lib/materials-i18n'
import { getBoxName } from '@/lib/boxes-i18n'
import { getLocalizedMutantNames, type MutantNameEntry } from '@/lib/mutant-names-i18n'
import { getDungeonName } from '@/lib/guides-content-i18n'
import { formatDateIn, formatExactRange } from '@/lib/sprint-calendar'
import {
  RIBBONS,
  CATEGORIES,
  type AnnouncementItem,
  type Announcement,
} from '@/lib/announcement-schema'

export type { AnnouncementItem, Announcement }

export function featuredMutantLabel(
  v: string | null | undefined,
  locale: Locale = 'ru',
): string | null {
  if (v !== 'day' && v !== 'week' && v !== 'month' && v !== 'zodiac') return null
  return t(`announcements.featured.${v}`, locale)
}

export function ribbonLabel(
  ribbon: string | null | undefined,
  locale: Locale = 'ru',
): string | null {
  if (!ribbon) return null
  const discount = ribbon.match(/^discount-(\d+)$/)
  if (discount) return `-${discount[1]}%`
  return (RIBBONS as readonly string[]).includes(ribbon)
    ? t(`announcements.ribbon.${ribbon}`, locale)
    : null
}

export function ribbonClass(ribbon: string | null | undefined): string {
  if (!ribbon) return ''
  if (ribbon.startsWith('discount-')) return 'ribbon-discount'
  return `ribbon-${ribbon}`
}

// Название категории (вкладки ленты и подпись на карточке). Неизвестная
// категория отдаётся как есть - лучше сырой ключ, чем пустая подпись.
export function categoryLabel(category: string | undefined, locale: Locale = 'ru'): string {
  if (!category) return ''
  return (CATEGORIES as readonly string[]).includes(category)
    ? t(`announcements.category.${category}`, locale)
    : category
}

// Переехало в announcement-categories.ts - тот же маппинг нужен и публикации
// (build-announcements.ts), а её голый tsx этот модуль импортировать не может.
// Реэкспорт, чтобы не трогать существующие импорты из компонентов.
export { cardKind, isSingleItemCategory, type CardKind } from './announcement-categories'

export type ExchangeHall = 'jackpot' | 'event' | 'mystery'

const HALL_TEXTURE: Record<ExchangeHall, string> = {
  jackpot: '/buildings/jackpot_sink_global.png',
  event: '/buildings/item_maker.png',
  mystery: '/buildings/building_mystery.png',
}

// Иконка скина - тот же официальный арт игры, что модалка мутанта показывает в
// пикере звёзд (assets/gachacontent/icon_<gachaId>.png, карта в
// data/mutants/skin-icons.json, пополняется scripts/sync-skin-icons.ts).
// Часть skin id иконки на CDN игры не имеет вовсе - тогда null, и плитка
// просто остаётся без значка (тот же фолбэк, что в MutantModal.svelte).
const SKIN_ICON = skinIconsData as Record<string, string>
const normalizeSkinKey = (v: string) =>
  v
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\uFF07]/g, "'")
    .replace(/[^a-z0-9'_ ]/g, '')

// Голова мутанта В СКИНЕ - тот же формат 100x100, что обычные головы из
// textures_by_mutant/, только из textures_by_skin/semi-full/. Нужна плиткам
// Анализатора тайны: награда там - конкретный скин, а detectExchange кладёт в
// image обычную голову мутанта (просьба юзера 2026-09-18). Считаем на
// рендере, а не в детекторе, чтобы исправились и уже опубликованные карточки.
const SKIN_HEAD = new Map<string, string>()
for (const sp of (skinsData as { specimens: { id: string; skin: string; image?: string[] }[] })
  .specimens) {
  const head = sp.image?.find((p) => p.includes('/semi-full/'))
  if (head) SKIN_HEAD.set(`${sp.id.toLowerCase()}|${sp.skin.toLowerCase()}`, head)
}

export function skinHeadImage(
  specimenId: string | null | undefined,
  skin: string | null | undefined,
): string | null {
  if (!specimenId || !skin) return null
  return SKIN_HEAD.get(`${specimenId.toLowerCase()}|${skin.toLowerCase()}`) ?? null
}

export function skinIconFor(skin: string | null | undefined): string | null {
  const raw = String(skin ?? '').trim()
  if (!raw) return null
  if (SKIN_ICON[raw]) return SKIN_ICON[raw]
  const lower = raw.toLowerCase()
  if (SKIN_ICON[lower]) return SKIN_ICON[lower]
  const normalized = normalizeSkinKey(lower)
  for (const [key, val] of Object.entries(SKIN_ICON)) {
    if (normalizeSkinKey(key) === normalized) return val
  }
  return null
}

export function exchangeHallMeta(
  hall: ExchangeHall,
  locale: Locale = 'ru',
): { title: string; texture: string } {
  return { title: t(`announcements.hall.${hall}`, locale), texture: HALL_TEXTURE[hall] }
}

// id оффера внутри прогноза = "<sprint>|<filter>" (см. detectShopForecast/
// detectDailyNews в build-announcements.ts).
// Переехала в announcement-schema.ts - скриншот-бот (голый tsx) считает по ней
// недели прогноза так же, как карточка. Реэкспорт для существующих импортов.
export { forecastSprint } from './announcement-schema'

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
  locale: Locale = 'ru',
): string | null {
  if (!price) return null
  if (price.type === 'usd') return `USD ${price.amount.toFixed(2)}`
  const key =
    price.type === 'hardcurrency' ? 'announcements.price.gold' : 'announcements.price.silver'
  return t(key, locale).replace('{n}', price.amount.toLocaleString(INTL_NUMBER[locale] ?? 'ru-RU'))
}

const INTL_NUMBER: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  it: 'it-IT',
  tr: 'tr-TR',
  nl: 'nl-NL',
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

export function boxDescription(box: BoxEntry, locale: Locale = 'ru'): string {
  const pool = box.groups.filter((g) => g.chance != null)
  if (pool.length === 0) return t('announcements.box.guaranteedOnly', locale)
  const chances = new Set(pool.map((g) => g.chance!.toFixed(1)))
  const key =
    chances.size === 1 ? 'announcements.box.randomEqual' : 'announcements.box.randomVaried'
  return t(key, locale)
    .replace('{n}', String(pool.length))
    .replace('{chance}', pool[0].chance!.toFixed(1))
    .toUpperCase()
}

export function formatBingoTitle(title: string, id: string, locale: Locale = 'ru'): string {
  // Тот же словарь названий досок, что на /bingo (bingoLabelL).
  const labelById = bingoLabelL(id, locale)
  if (labelById && labelById !== id) return labelById
  const labelByTitle = bingoLabelL(title, locale)
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
export function bingoAddedNames(
  names: string[],
  mutantsById: Map<string, MutantRaw>,
  localizedMutantName: (ruName: string) => string = (n) => n,
): string[] {
  return names.map((name) => {
    if (!RAW_SPECIMEN_ID_RE.test(name)) return localizedMutantName(name)
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
  // Имена на языке страницы по id - для мест, где в announcements.json лежит
  // русское имя, записанное детектором (обменники, тайлы прогноза, боксы).
  mutantName: (id: string) => string | null
  materialName: (id: string) => string | null
  boxName: (box: BoxEntry) => string
  // Имя оффера прогноза по сырому itemId из shopitems.xml: пакеты и бандлы не
  // резолвятся ни в мутанта, ни в бокс, но часть из них есть в словарях
  // боксов/материалов. Не нашлось нигде - остаётся русское имя из данных.
  offerName: (rawItemId: string, fallback: string) => string
  // Русское имя мутанта -> имя на языке страницы. Нужно там, где в данных
  // лежит готовая строка, а не id (bingo addedNames старых записей).
  localizedMutantName: (ruName: string) => string
  // Переводы имён мутантов для getRewardLabel (/bingo использует тот же словарь).
  mutantNames: Record<string, MutantNameEntry>
  // Цепочки ивентовых заданий по filter (lowercase), награды уже
  // зарезолвлены тем же resolveReward, что на /guides.
  eventQuestByFilter: Map<string, ResolvedEventQuest>
}

export interface ResolvedEventQuest {
  filter: string
  name: string
  icon: string | null
  requiredLevel: number | null
  // Параллельные линии заданий цепочки, у каждой своя нумерация этапов (см.
  // splitIntoLines в scripts/build-event-quests.ts).
  lines: ResolvedEventQuestStep[][]
  stepCount: number
}

export interface ResolvedEventQuestStep {
  id: string
  condition: string
  amount: number | null
  amountText: string
  showAmount: boolean
  rewards: { label: string; name?: string; count?: string; icon: string | null }[]
}

// Контекст строится по одному на локаль и кэшируется в модуле (ESM-кэш):
// каждый .astro, импортирующий этот модуль, переиспользует уже собранные
// Map'ы, а не пересобирает их на каждую карточку.
const CONTEXT_CACHE = new Map<Locale, AnnouncementRenderContext>()

export function buildAnnouncementContext(locale: Locale = 'ru'): AnnouncementRenderContext {
  const cached = CONTEXT_CACHE.get(locale)
  if (cached) return cached
  const ctx = buildContext(locale)
  CONTEXT_CACHE.set(locale, ctx)
  return ctx
}

function buildContext(locale: Locale): AnnouncementRenderContext {
  // Имена мутантов, материалов и предметов - через те же locale-словари, что
  // на /guides и /materials (см. GuidesPage.astro: RU-источники Kobojo не
  // принимают локаль, поэтому на не-RU их отключаем, чтобы русский текст не
  // утекал в другие языки).
  // obtainNames - словарь имён товаров магазина (пакеты, бандлы, контейнеры)
  // из официальной локализации Kobojo, тот же, что в модалке мутанта в разделе
  // "как получить" (scripts/sync-obtain-names.ts).
  const { names, obtainNames } = getLocalizedMutantNames(locale)
  const obtainNamesLower = new Map(
    Object.entries(obtainNames).map(([k, v]) => [k.toLowerCase(), v]),
  )
  const mutantsById = new Map(
    (mutantsData as MutantRaw[]).map((m) => [m.id, { ...m, name: names[m.id]?.name ?? m.name }]),
  )
  const materialsById = new Map(
    (materialData as MaterialEntry[]).map((m) => [
      m.id,
      { ...m, name: m.name ? getItemName(m.id, locale, m.name) : m.name },
    ]),
  )
  const formatNumber = (n: number) => n.toLocaleString(INTL_NUMBER[locale] ?? 'ru-RU')
  const rewardCtx: RewardResolveCtx = {
    mutantsById,
    materialsById,
    translateItemId: (id: string) => {
      const ru = translateItemId(id)
      return locale === 'ru' ? ru : getItemName(id, locale, ru)
    },
    getItemTexture,
    getLocalisedName: (id: string) => (locale === 'ru' ? getLocalisedName(id) : null),
    getGeneIcon,
    geneRu: GENE_RU,
    names,
    t: (key: string) => t(key, locale),
    formatNumber,
  }
  // Имена рейдов/лесенок - тот же словарь и те же ключи ("<группа>/<id>"),
  // что на /guides (guides-content-i18n.ts::getDungeonName).
  const dungeonById = new Map<string, ResolvedDungeon>([
    ...(raidsData as DungeonRaw[]).map(
      (d) =>
        [
          d.id,
          {
            ...resolveDungeon(d, rewardCtx),
            name: (d as DungeonRaw & { nameAuthored?: boolean }).nameAuthored
              ? getDungeonName(d.id, locale, d.name)
              : resolveDungeon(d, rewardCtx).name,
          },
        ] as const,
    ),
    ...(['experiment', 'challenge'] as const).flatMap((group) =>
      (specialLaddersData as { experiment: DungeonRaw[]; challenge: DungeonRaw[] })[group].map(
        (d) =>
          [
            d.id,
            {
              ...resolveDungeon(d, rewardCtx),
              name: getDungeonName(`${group}/${d.id}`, locale, d.name),
            },
          ] as const,
      ),
    ),
  ])
  const dungeonCoversMap = dungeonCovers as Record<string, string | null>
  const boxesById = new Map((boxesData as BoxEntry[]).map((b) => [b.itemId, b]))
  const boxesByIdLower = new Map((boxesData as BoxEntry[]).map((b) => [b.itemId.toLowerCase(), b]))
  const bingosById = new Map(
    (bingosData as { id: string; title: string }[]).map((b) => [b.id, b.title]),
  )

  type EvI18n = Record<string, string>
  const pick = (tx: EvI18n) => tx[locale] || tx.ru || tx.en || ''
  const eventQuestByFilter = new Map<string, ResolvedEventQuest>(
    (
      eventQuestsData as unknown as {
        filter: string
        name: EvI18n
        icon: string | null
        requiredLevel: number | null
        steps: {
          id: string
          line: number
          condition: EvI18n
          amount: number | null
          rewards: { id: string | null; type: string | null; amount: number }[]
        }[]
      }[]
    ).map((c) => [
      c.filter.toLowerCase(),
      {
        filter: c.filter,
        name: pick(c.name),
        icon: c.icon,
        requiredLevel: c.requiredLevel,
        stepCount: c.steps.length,
        lines: c.steps.reduce<ResolvedEventQuestStep[][]>((lines, st) => {
          const condition = pick(st.condition)
          ;(lines[st.line] ??= []).push({
            id: st.id,
            condition,
            amount: st.amount,
            showAmount: shouldShowAmount(condition, st.amount),
            amountText: st.amount !== null ? formatNumber(st.amount) : '',
            rewards: st.rewards.map((r) => {
              const res = resolveReward(r as never, rewardCtx)
              return { label: res.label, name: res.name, count: res.count, icon: res.icon ?? null }
            }),
          })
          return lines
        }, []),
      },
    ]),
  )

  const localizedByRu = new Map(
    (mutantsData as MutantRaw[]).map((m) => [m.name, names[m.id]?.name ?? m.name]),
  )
  return {
    mutantName: (id: string) => mutantsById.get(id.toLowerCase())?.name ?? null,
    localizedMutantName: (ruName: string) => localizedByRu.get(ruName) ?? ruName,
    mutantNames: names,
    materialName: (id: string) => materialsById.get(id)?.name ?? null,
    // Тот же словарь имён боксов, что на /boxes (boxes-i18n.ts).
    boxName: (box: BoxEntry) => getBoxName(box.itemId, locale, box.name),
    offerName: (rawItemId: string, fallback: string) => {
      if (locale === 'ru' || !rawItemId) return fallback
      const clean = (
        rawItemId.includes('|') ? rawItemId.slice(rawItemId.indexOf('|') + 1) : rawItemId
      )
        .replace(/^-+/, '')
        .replace(/^#/, '')
        .replace(/^shop_/i, '')
      const key = clean.toLowerCase()
      return (
        obtainNamesLower.get(key) ??
        obtainNamesLower.get(key.replace(/\d+$/, '')) ??
        (getBoxName(clean, locale, '') || getItemName(clean, locale, '') || fallback)
      )
    },
    eventQuestByFilter,
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

// Мутанты ВНУТРИ пакета (packMutants), уже резолвнутые в имя/иконку/звезду.
// Пакеты вроде "Пакет «Спираксия»" (bank_e_14_*) мутанта в itemId не несут -
// он лежит только в <ArticleItems>, поэтому тайл выглядел некликабельным
// (юзер поймал 2026-09-16). Один мутант -> тайл открывает его модалку сразу;
// несколько -> открывается лист состава (см. announcements.astro).
export interface PackMutantRef {
  id: string
  star: string | null
  name: string
  image: string
}

export function resolvePackMutants(
  ids: string[] | null | undefined,
  mutantsById: Map<string, MutantRaw>,
): PackMutantRef[] {
  const out: PackMutantRef[] = []
  const seen = new Set<string>()
  for (const raw of ids ?? []) {
    const target = resolveForecastTarget(raw, mutantsById, () => undefined)
    if (!target || target.type !== 'mutant') continue
    const key = `${target.id}|${target.star ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const m = mutantsById.get(target.id)
    if (!m) continue
    const tier = target.star
      ? ({ bronze: 'бронза', silver: 'серебро', gold: 'золото', platinum: 'платина' }[
          target.star
        ] ?? null)
      : null
    out.push({
      id: target.id,
      star: target.star,
      name: m.name,
      image: boxMutantIcon({ id: target.id, name: m.name, tier, skin: null }),
    })
  }
  return out
}

export const fmtDate = (iso: string, locale: Locale = 'ru') =>
  new Date(iso).toLocaleDateString(INTL_NUMBER[locale] ?? 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

// Подпись даты окна на языке страницы. Собирается из ISO-дат самого анонса, а
// не из exactDateLabel: тот записан по-русски (его снимает скриншот-бот).
// Старые записи без ISO-конца падают обратно на сохранённую строку.
export function exactDateLabelIn(
  it:
    | {
        exactDateLabel?: string | null
        exactDateStart?: string | null
        exactDateEnd?: string | null
        exactDateApprox?: boolean
        exactDateOpenEnd?: boolean
      }
    | null
    | undefined,
  locale: Locale = 'ru',
): string | null {
  if (!it?.exactDateLabel) return null
  if (locale === 'ru' || !it.exactDateStart) return it.exactDateLabel
  const start = new Date(it.exactDateStart)
  if (Number.isNaN(start.getTime())) return it.exactDateLabel
  if (it.exactDateApprox) return `≈ ${formatDateIn(start, locale)}`
  if (it.exactDateOpenEnd) return `${formatDateIn(start, locale)} — ?`
  const end = it.exactDateEnd ? new Date(it.exactDateEnd) : null
  return formatExactRange(start, end && !Number.isNaN(end.getTime()) ? end : null, locale)
}
