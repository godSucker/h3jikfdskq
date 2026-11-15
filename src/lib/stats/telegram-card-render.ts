/**
 * Renders a PanelData (see panel-data.ts) into a PNG stats card via Satori +
 * resvg - the Telegram-bot equivalent of the live calculator's share
 * screenshot, but without a browser (see prod-fidelity notes in memory:
 * headless Chromium was measured at 4s+ warm and prone to shared-instance
 * crashes, unacceptable for chat-bot latency).
 *
 * Every image (fonts, icons, portraits) is fetched over HTTP from the CDN
 * and cached at module scope - on a warm Vercel instance (Fluid Compute)
 * only the mutant-specific portrait/orb icons are ever fetched more than
 * once; the font and the fixed icon set (stars, stat icons, gene icons,
 * type icons) are fetched exactly once per instance lifetime.
 */
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import type { Appearances, BingoChip, GoldBuilding, RecentOffer } from './appearances'
import sharp from 'sharp'
import type { PanelData } from './panel-data'

const CDN = 'https://cdn.archivist-library.com'
const FONT_PATH = '/fonts/tt-supermolot-neue'

const STAR_ICONS = [
  '/stars/no_stars.webp',
  '/stars/star_bronze.webp',
  '/stars/star_silver.webp',
  '/stars/star_gold.webp',
  '/stars/star_platinum.webp',
]
const STAT_ICON_HP = '/etc/icon_hp.webp'
const STAT_ICON_SPEED = '/etc/icon_speed.webp'
const SILVER_ICON = '/cash/softcurrency.webp'
const SLOT_BG_BASIC = '/orbs/basic/orb_slot.webp'
const SLOT_BG_SPECIAL = '/orbs/special/orb_slot_spe.webp'
const AOE_ICON = '/genes/atk_multiple.webp'
const GENE_ICON_PATHS: Record<string, string> = {
  A: '/genes/gene_a.webp',
  B: '/genes/gene_b.webp',
  C: '/genes/gene_c.webp',
  D: '/genes/gene_d.webp',
  E: '/genes/gene_e.webp',
  F: '/genes/gene_f.webp',
}

// atk-mult-btn.active color table (StatsCalculator.svelte CSS), keyed by delta.
const MULT_COLORS: Record<string, { color: string; border: string; bg: string }> = {
  '-50': { color: '#7ec8e3', border: 'rgba(126,200,227,0.4)', bg: 'rgba(126,200,227,0.15)' },
  '-25': { color: '#d4c49a', border: 'rgba(212,196,154,0.4)', bg: 'rgba(212,196,154,0.15)' },
  '0': { color: '#60a5fa', border: 'rgba(59,130,246,0.4)', bg: 'rgba(59,130,246,0.2)' },
  '25': { color: '#e8923a', border: 'rgba(232,146,58,0.4)', bg: 'rgba(232,146,58,0.15)' },
  '50': { color: '#e05555', border: 'rgba(224,85,85,0.4)', bg: 'rgba(224,85,85,0.15)' },
}
const MULT_STEPS = [-50, -25, 0, 25, 50]

// Every asset the card uses (icons AND fonts) exists both on the Yandex CDN and in
// public/, i.e. on the site domain served by Vercel - a different network path.
// Yandex CDN GSLB (cdn.archivist-library.com) occasionally drops the TCP connect
// from Vercel's region or accepts it and stays silent (14 TimeoutError in the
// week of 2026-10-15..23, all from the font fetch, which had no site fallback).
// So both origins are asked AT ONCE and the first good answer wins: a hung CDN
// costs nothing, instead of the old "CDN first (4 tries x 8s), site afterwards".
const SITE_ORIGIN = 'https://archivist-library.com'
const ATTEMPT_TIMEOUT_MS = 5000

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res
}

export async function fetchAsset(relPath: string, attempts = 2): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await Promise.any([fetchOk(CDN + relPath), fetchOk(SITE_ORIGIN + relPath)])
    } catch (err) {
      lastErr = err
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
    }
  }
  const detail =
    lastErr instanceof AggregateError
      ? lastErr.errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ')
      : String(lastErr)
  throw new Error(`fetch failed ${relPath}: ${detail}`)
}

const imgCache = new Map<string, string>()
export async function loadImageDataUri(relPath: string, grayscale = false): Promise<string> {
  const key = grayscale ? `${relPath}#gray` : relPath
  const cached = imgCache.get(key)
  if (cached) return cached
  const res = await fetchAsset(relPath)
  const buf = Buffer.from(await res.arrayBuffer())
  let img = sharp(buf)
  if (grayscale) img = img.grayscale().modulate({ brightness: 0.6 })
  const uri = `data:image/png;base64,${(await img.png().toBuffer()).toString('base64')}`
  imgCache.set(key, uri)
  return uri
}

// Комбинированная сфера (одна физическая сфера с двумя эффектами) рисуется
// половинками. Склеиваем их в ОДНУ картинку заранее, а не двумя обрезанными
// <img> в Satori: там половинка - это контейнер в 2 раза уже картинки, и
// движок не обрезает её, а сжимает по ширине, отчего иконка выглядела мыльной.
// Режем по диагонали (из правого верхнего угла в левый нижний), а не пополам:
// цифра уровня нарисована по центру сферы, и вертикальный рез приходился ровно
// по ней. Тот же вид, что в модалке мутанта на сайте.
async function loadSplitOrbDataUri(leftPath: string, rightPath: string): Promise<string> {
  const key = `${leftPath}|${rightPath}#split`
  const cached = imgCache.get(key)
  if (cached) return cached
  const SIZE = 128
  const triangle = (side: 'left' | 'right') =>
    Buffer.from(
      `<svg width="${SIZE}" height="${SIZE}"><polygon points="${
        side === 'left' ? `0,0 ${SIZE},0 0,${SIZE}` : `${SIZE},0 ${SIZE},${SIZE} 0,${SIZE}`
      }" fill="#fff"/></svg>`,
    )
  const half = async (relPath: string, side: 'left' | 'right') => {
    const res = await fetchAsset(relPath)
    const square = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    return sharp(square)
      .composite([{ input: triangle(side), blend: 'dest-in' }])
      .png()
      .toBuffer()
  }
  const [l, r] = await Promise.all([half(leftPath, 'left'), half(rightPath, 'right')])
  const merged = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: l }, { input: r }])
    .png()
    .toBuffer()
  const uri = `data:image/png;base64,${merged.toString('base64')}`
  imgCache.set(key, uri)
  return uri
}

let fontsPromise: Promise<{ bold: Buffer; medium: Buffer; regular: Buffer }> | null = null
function loadFonts() {
  if (!fontsPromise) {
    // On failure, drop the cached rejected promise - Fluid Compute reuses this
    // instance across requests, so otherwise every future request on it would
    // fail instantly forever without even attempting a new fetch.
    fontsPromise = Promise.all(
      ['Bold', 'Medium', 'Regular'].map(async (w) => {
        const res = await fetchAsset(`${FONT_PATH}/TTSupermolotNeue-${w}.ttf`)
        return Buffer.from(await res.arrayBuffer())
      }),
    )
      .then(([bold, medium, regular]) => ({ bold, medium, regular }))
      .catch((err) => {
        fontsPromise = null
        throw err
      })
  }
  return fontsPromise
}

export function h(type: string, props: any, ...children: any[]) {
  return {
    type,
    props: { ...props, children: children.flat().filter((c) => c !== null && c !== undefined) },
  }
}

function formatSpeed(v: number): string {
  const rounded = Math.round(v * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace('.', ',')
}

export interface CardInput {
  panel: PanelData
  level: number
  starIndex: number
  atkMultipliers: { 1: number; 2: number }
  // "Бинго" and "Последние появления" blocks; single cards only (a compare
  // row is already near Telegram's width + height limit).
  appearances?: Appearances
}

// Card body colour; also what rasterize() flattens the transparent corners onto.
const CARD_BG = '#2a313c'

const CONTROL_CHIP = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#aab6c8',
  fontSize: 15,
  background: '#1b212a',
  border: '1px solid #2e3948',
  borderRadius: 10,
  padding: '8px 16px',
}

// ===== "Бинго" / "Последние появления" =====

// Short tags on the highlighted chips (the building sprites are near-identical and
// unreadable at chip size, so text it is).
const GOLD_TAG: Record<GoldBuilding, string> = {
  forge: 'кузня',
  smelter: 'плавильня',
}
const MAX_BINGO_CHIPS = 9 // fewer hidden than this is never collapsed
const SHOWN_WHEN_COLLAPSED = 8
const MONTHS_RU = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]

// Gold chips come first (bingoChipsFor), so whatever is collapsed is the least
// interesting part.
function visibleBingo(chips: BingoChip[]) {
  const shown = chips.length <= MAX_BINGO_CHIPS ? chips : chips.slice(0, SHOWN_WHEN_COLLAPSED)
  return { shown, hidden: chips.length - shown.length }
}

function fmtOfferDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS_RU[m - 1]} ${y}`
}

// The card font has no U+2605 (checked against all labels in the data on
// 2026-11-15: it is the only missing glyph), so "3★" would render as an empty box.
function offerLabelText(label: string): string {
  return label.replace(/(\d)\s*★/g, '$1 зв.').replace(/★/g, 'зв.')
}

function fmtOfferPrice(price: RecentOffer['price']): string {
  if (!price?.length) return ''
  return price
    .map(([cur, amount]) => {
      if (cur === '$') return `$${amount}`
      const n = Number(amount).toLocaleString('ru-RU')
      if (cur === 'g') return `${n} золота`
      if (cur === 's') return `${n} серебра`
      return `${n}× Жетон генератора`
    })
    .join(' / ')
}

const APPEARANCE_BLOCK = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: '#1b212a',
  border: '1px solid #2e3948',
  borderRadius: 12,
  padding: '12px 16px 14px',
  width: '100%',
}
const APPEARANCE_TITLE = {
  display: 'flex',
  fontSize: 15,
  fontWeight: 800,
  color: '#aab6c8',
  letterSpacing: 1,
}
const APPEARANCE_EMPTY = { display: 'flex', fontSize: 15, color: '#637083' }

// Layout constants shared by the renderer and the height estimate below.
const APP_INNER_WIDTH = 680 - 2 * 26 - 2 * 16 - 2 // card padding, block padding, border
const CHIP_FONT = 14
const CHIP_H = 32
const CHIP_GAP = 8
const CHIP_PAD_X = 12
const GOLD_TAG_FONT = 12
const OFFER_FONT = 15
const OFFER_DATE_W = 112
const OFFER_LINE_H = 21
const OFFER_GAP = 6

function goldTagText(gold: GoldBuilding[] | undefined): string {
  return (gold ?? []).map((g) => GOLD_TAG[g]).join(' + ')
}

function chipWidth(chip: { label: string; gold?: GoldBuilding[] }): number {
  // Glyph widths rounded UP on purpose (a wider guess only costs spare height).
  const tag = goldTagText(chip.gold)
  return (
    Math.ceil(chip.label.length * CHIP_FONT * 0.62) +
    (tag ? Math.ceil(tag.length * GOLD_TAG_FONT * 0.62) + 10 : 0) +
    2 * CHIP_PAD_X +
    2
  )
}

function bingoRows(chips: { label: string; gold?: GoldBuilding[] }[]): number {
  let rows = 1
  let x = 0
  for (const chip of chips) {
    const w = Math.min(chipWidth(chip), APP_INNER_WIDTH)
    if (x > 0 && x + CHIP_GAP + w > APP_INNER_WIDTH) {
      rows++
      x = 0
    }
    x += (x > 0 ? CHIP_GAP : 0) + w
  }
  return rows
}

// Upper bound, never an estimate to be proud of: Satori has a fixed viewport,
// so undershooting clips the footer, overshooting is trimmed away by rasterize().
export function estimateAppearancesHeight(a: Appearances): number {
  const { shown, hidden } = visibleBingo(a.bingo)
  const chips = hidden > 0 ? [...shown, { label: `+${hidden}` }] : shown
  const bingoBody = a.bingo.length ? bingoRows(chips) * (CHIP_H + CHIP_GAP) : 24
  const offersBody = a.offers.length
    ? a.offers.reduce((sum, o) => {
        const text = offerLabelText(o.label).length + fmtOfferPrice(o.price).length + 3
        const perLine = Math.floor((APP_INNER_WIDTH - OFFER_DATE_W - 12) / (OFFER_FONT * 0.58))
        const lines = Math.min(2, Math.ceil(text / perLine))
        return sum + lines * OFFER_LINE_H + OFFER_GAP
      }, 0)
    : 48
  const block = 12 + 14 + 2 + 20 + 8 // padding, border, title, gap
  return Math.ceil(((2 * block + bingoBody + offersBody + 8) * 1.15) / 10) * 10 + 20
}

function chipEl(chip: { label: string; gold?: GoldBuilding[] }) {
  const gold = (chip.gold?.length ?? 0) > 0
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: '100%',
        fontSize: CHIP_FONT,
        fontWeight: 600,
        color: gold ? '#fde68a' : '#c7d2fe',
        background: gold ? 'rgba(251,191,36,0.12)' : 'rgba(99,102,241,0.15)',
        border: `1px solid ${gold ? 'rgba(251,191,36,0.55)' : 'rgba(99,102,241,0.4)'}`,
        borderRadius: 999,
        padding: `4px ${CHIP_PAD_X}px`,
      },
    },
    h('div', { style: { display: 'flex', lineClamp: 1, textOverflow: 'ellipsis' } }, chip.label),
    gold
      ? h(
          'div',
          {
            style: { display: 'flex', fontSize: GOLD_TAG_FONT, fontWeight: 800, color: '#d9a82e' },
          },
          goldTagText(chip.gold),
        )
      : null,
  )
}

function offerRowEl(o: RecentOffer) {
  const price = fmtOfferPrice(o.price)
  return h(
    'div',
    { style: { display: 'flex', gap: 12, fontSize: OFFER_FONT, color: '#e2e8f0', width: '100%' } },
    h(
      'div',
      {
        style: {
          display: 'flex',
          width: OFFER_DATE_W,
          flexShrink: 0,
          color: '#8a97ab',
          fontWeight: 600,
        },
      },
      fmtOfferDate(o.date),
    ),
    h(
      'div',
      { style: { display: 'flex', flexGrow: 1, flexShrink: 1, minWidth: 0, lineClamp: 2 } },
      price ? `${offerLabelText(o.label)} · ${price}` : offerLabelText(o.label),
    ),
  )
}

export function appearancesBlocks(a: Appearances) {
  const { shown, hidden } = visibleBingo(a.bingo)
  const bingo = h(
    'div',
    { style: APPEARANCE_BLOCK },
    h('div', { style: APPEARANCE_TITLE }, 'БИНГО'),
    a.bingo.length
      ? h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: CHIP_GAP, width: '100%' } },
          ...shown.map((c) => chipEl(c)),
          hidden > 0 ? chipEl({ label: `+${hidden}` }) : null,
        )
      : h('div', { style: APPEARANCE_EMPTY }, 'Не входит ни в одно бинго'),
  )
  const emptyText =
    a.offersState === 'onlyLowChance'
      ? 'Только в контейнерах с малым шансом выпадения (менее 10%)'
      : 'Нет данных о датах'
  const offers = h(
    'div',
    { style: APPEARANCE_BLOCK },
    h('div', { style: APPEARANCE_TITLE }, 'ПОСЛЕДНИЕ ПОЯВЛЕНИЯ'),
    ...(a.offers.length
      ? a.offers.map(offerRowEl)
      : [h('div', { style: APPEARANCE_EMPTY }, emptyText)]),
  )
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' } },
    bingo,
    offers,
  )
}

async function buildPanelTree(input: CardInput) {
  const { panel } = input

  const uniquePaths = new Set<string>([
    panel.portraitPath,
    panel.typeIcon,
    STAT_ICON_HP,
    STAT_ICON_SPEED,
    SILVER_ICON,
    SLOT_BG_BASIC,
    SLOT_BG_SPECIAL,
    ...panel.genes.map((g) => GENE_ICON_PATHS[g] || '/genes/gene_all.webp'),
    ...panel.attackRows.map((r) => r.geneIcon).filter(Boolean),
    ...panel.attackRows.flatMap((r) => r.effects.map((e) => e.icon)).filter(Boolean),
    ...panel.basicOrbs.filter((o): o is NonNullable<typeof o> => Boolean(o)).map((o) => o.icon),
    ...(panel.specialOrb ? [panel.specialOrb.icon] : []),
    ...(panel.attackRows.some((r) => r.isAoe) ? [AOE_ICON] : []),
    // Сборки сфер с сайта - у них свои иконки, в слотах мутанта их может не
    // быть вовсе. Комбинированные ячейки грузятся отдельно, склейкой (см.
    // splitUriByKey ниже).
    ...panel.orbBuilds
      .flat()
      .filter((cell): cell is string => !Array.isArray(cell))
      .map((file) => `/orbs/${file}`),
  ])
  const uriByPath: Record<string, string> = {}
  await Promise.all(
    Array.from(uniquePaths).map(async (p) => {
      uriByPath[p] = await loadImageDataUri(p)
    }),
  )
  const splitUriByKey: Record<string, string> = {}
  await Promise.all(
    panel.orbBuilds
      .flat()
      .filter((cell): cell is [string, string] => Array.isArray(cell))
      .map(async (cell) => {
        splitUriByKey[cell.join('|')] = await loadSplitOrbDataUri(
          `/orbs/${cell[0]}`,
          `/orbs/${cell[1]}`,
        )
      }),
  )

  const starColorUri: string[] = []
  const starGrayUri: string[] = []
  await Promise.all(
    STAR_ICONS.map(async (p, i) => {
      starColorUri[i] = await loadImageDataUri(p, false)
      starGrayUri[i] = await loadImageDataUri(p, true)
    }),
  )

  const numFmt = (n: number) => n.toLocaleString('ru-RU')

  const row = (labelIcon: string | null, label: string, value: string) =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#1b212a',
          border: '1px solid #2e3948',
          borderRadius: 12,
          padding: '8px 16px',
          minHeight: 44,
          width: '100%',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: '#aab6c8',
            fontSize: 15,
            fontWeight: 700,
          },
        },
        labelIcon
          ? h('img', {
              src: uriByPath[labelIcon],
              width: 22,
              height: 22,
              style: { objectFit: 'contain' },
            })
          : null,
        label,
      ),
      h(
        'div',
        { style: { display: 'flex', fontSize: 17, fontWeight: 700, color: '#e9eef6' } },
        value,
      ),
    )

  const multBar = (attackIdx: 1 | 2) => {
    const activeVal = Math.round((input.atkMultipliers[attackIdx] - 1) * 100)
    return h(
      'div',
      { style: { display: 'flex', gap: 4 } },
      ...MULT_STEPS.map((step) => {
        const active = step === activeVal
        const c = MULT_COLORS[String(step)]
        return h(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 5px',
              borderRadius: 4,
              border: `1px solid ${active ? c.border : '#2e3948'}`,
              color: active ? c.color : '#6b7a8d',
              background: active ? c.bg : '#10161f',
            },
          },
          step === 0 ? '0' : `${step > 0 ? '+' : ''}${step}%`,
        )
      }),
    )
  }

  const attackRow = (r: PanelData['attackRows'][number]) =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: '#1b212a',
          border: '1px solid #2e3948',
          borderRadius: 12,
          padding: '10px 16px',
          width: '100%',
        },
      },
      r.gene !== 'neutro' ? multBar(r.attack as 1 | 2) : null,
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10, width: '100%' } },
        h(
          // Matches .attack-gene/.attack-aoe in StatsCalculator.svelte: the
          // AOE burst icon sits behind-and-right of the gene icon, not next
          // to it - a relative/absolute pair, not a flex sibling. (Satori's
          // transform support is unreliable, so explicit px offsets instead
          // of the live page's translate(-50%,-50%).)
          'div',
          {
            style: { display: 'flex', position: 'relative', width: 54, height: 44, flexShrink: 0 },
          },
          r.isAoe
            ? h('img', {
                src: uriByPath[AOE_ICON],
                width: 44,
                height: 44,
                style: { position: 'absolute', top: 0, left: 12, objectFit: 'contain' },
              })
            : null,
          r.geneIcon
            ? h('img', {
                src: uriByPath[r.geneIcon],
                width: 38,
                height: 38,
                style: { position: 'absolute', top: 3, left: 0, objectFit: 'contain' },
              })
            : null,
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 2 } },
          h(
            'div',
            { style: { display: 'flex', color: '#aab6c8', fontSize: 14, fontWeight: 600 } },
            r.label,
          ),
          h(
            'div',
            { style: { display: 'flex', fontSize: 19, fontWeight: 700, color: '#e9eef6' } },
            numFmt(r.damage),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          ...r.effects.map((eff) =>
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(15,19,25,0.35)',
                  borderRadius: 10,
                  padding: '8px 12px',
                },
              },
              eff.icon
                ? h('img', {
                    src: uriByPath[eff.icon],
                    width: 24,
                    height: 24,
                    style: { objectFit: 'contain' },
                  })
                : null,
              h(
                'div',
                { style: { display: 'flex', color: '#f0f6ff', fontSize: 14, fontWeight: 600 } },
                eff.label,
              ),
              eff.percent != null
                ? h(
                    'div',
                    { style: { display: 'flex', color: '#90f36b', fontSize: 14, fontWeight: 600 } },
                    `${eff.percent}%`,
                  )
                : null,
              h(
                'div',
                { style: { display: 'flex', color: '#90f36b', fontSize: 16, fontWeight: 700 } },
                numFmt(eff.value),
              ),
            ),
          ),
        ),
      ),
    )

  // Ячейка рекомендованной сборки: слот и одна иконка. Комбинированная сфера
  // приходит уже склеенной картинкой (loadSplitOrbDataUri), поэтому рендер тут
  // одинаковый и ничего не масштабируется по половинке.
  const buildCell = (cell: string | [string, string]) => {
    const first = Array.isArray(cell) ? cell[0] : cell
    const bg = first.startsWith('special/') ? SLOT_BG_SPECIAL : SLOT_BG_BASIC
    const iconUri = Array.isArray(cell) ? splitUriByKey[cell.join('|')] : uriByPath[`/orbs/${cell}`]
    return h(
      'div',
      {
        style: {
          display: 'flex',
          width: 52,
          height: 52,
          borderRadius: 10,
          overflow: 'hidden',
          position: 'relative',
        },
      },
      h('img', {
        src: uriByPath[bg],
        width: 52,
        height: 52,
        style: { objectFit: 'cover', position: 'absolute' },
      }),
      iconUri
        ? h('img', {
            src: iconUri,
            width: 48,
            height: 48,
            style: { objectFit: 'contain', position: 'absolute', top: 2, left: 2 },
          })
        : null,
    )
  }

  // Сборки сфер с сайта - те же и в том же порядке, что в модалке мутанта.
  // Надетая через ".<мутант> сферовка N" подсвечивается рамкой.
  const orbBuildBlock = () => {
    if (panel.orbBuilds.length === 0) return row(null, 'Сферовка', 'пока нет')
    const active = panel.activeOrbBuild
    return h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          background: '#1b212a',
          border: '1px solid #2e3948',
          borderRadius: 12,
          padding: '10px 16px 12px',
          width: '100%',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
          },
        },
        h(
          'div',
          { style: { display: 'flex', color: '#aab6c8', fontSize: 15, fontWeight: 700 } },
          panel.orbBuilds.length > 1 ? 'Сферовки' : 'Сферовка',
        ),
        active !== null
          ? h(
              'div',
              { style: { display: 'flex', color: '#fbbf24', fontSize: 13 } },
              `надета №${active + 1}`,
            )
          : h('div', { style: { display: 'flex' } }, ''),
      ),
      ...panel.orbBuilds.map((cells, i) =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '4px 10px',
              borderRadius: 10,
              border: `1px solid ${i === active ? 'rgba(251,191,36,0.55)' : 'transparent'}`,
              background: i === active ? 'rgba(251,191,36,0.07)' : 'transparent',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                width: 18,
                color: i === active ? '#fbbf24' : '#637083',
                fontSize: 13,
                fontWeight: 700,
              },
            },
            String(i + 1),
          ),
          h('div', { style: { display: 'flex', gap: 12 } }, ...cells.map(buildCell)),
        ),
      ),
    )
  }

  const orbSlot = (bg: string, orbIconUri: string | null) =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          width: 52,
          height: 52,
          borderRadius: 10,
          overflow: 'hidden',
          position: 'relative',
        },
      },
      h('img', {
        src: uriByPath[bg],
        width: 52,
        height: 52,
        style: { objectFit: 'cover', position: 'absolute' },
      }),
      orbIconUri
        ? h('img', {
            src: orbIconUri,
            width: 48,
            height: 48,
            style: { objectFit: 'contain', position: 'absolute', top: 2, left: 2 },
          })
        : null,
    )

  const starEl = (idx: number) => {
    const selected = idx === input.starIndex
    return h(
      'div',
      {
        style: {
          display: 'flex',
          width: 30,
          height: 30,
          borderRadius: 999,
          boxShadow: selected ? '0 0 8px 2px rgba(255,255,255,0.55)' : 'none',
          opacity: selected ? 1 : 0.45,
        },
      },
      h('img', {
        src: selected ? starColorUri[idx] : starGrayUri[idx],
        width: 30,
        height: 30,
        style: { objectFit: 'contain' },
      }),
    )
  }

  const tree = h(
    'div',
    {
      style: {
        width: 680,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        background: CARD_BG,
        borderRadius: 16,
        padding: '24px 26px',
        fontFamily: 'TT Supermolot Neue',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          width: '100%',
        },
      },
      h(
        'div',
        { style: { display: 'flex', fontSize: 28, fontWeight: 800, color: '#ffffff' } },
        panel.name,
      ),
      panel.skinLabel
        ? h(
            'div',
            { style: { display: 'flex', fontSize: 17, fontWeight: 700, color: '#9fb0c8' } },
            `Скин: ${panel.skinLabel}`,
          )
        : null,
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 } },
      h(
        'div',
        { style: { display: 'flex', gap: 6 } },
        ...panel.genes.map((g) =>
          h('img', {
            src: uriByPath[GENE_ICON_PATHS[g] || '/genes/gene_all.webp'],
            width: 36,
            height: 36,
            style: { objectFit: 'contain' },
          }),
        ),
      ),
      h('img', {
        src: uriByPath[panel.portraitPath],
        width: 150,
        height: 150,
        style: { objectFit: 'contain' },
      }),
      h(
        'div',
        { style: { display: 'flex', gap: 12, justifyContent: 'center' } },
        ...panel.basicOrbs.map((o) => orbSlot(SLOT_BG_BASIC, o ? uriByPath[o.icon] : null)),
        ...(panel.specialSlotCount > 0
          ? [orbSlot(SLOT_BG_SPECIAL, panel.specialOrb ? uriByPath[panel.specialOrb.icon] : null)]
          : []),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
          },
        },
        h(
          'div',
          { style: CONTROL_CHIP as any },
          h('div', { style: { display: 'flex' } }, 'Уровень'),
          h(
            'div',
            {
              style: {
                display: 'flex',
                padding: '3px 10px',
                borderRadius: 8,
                border: '1px solid #3a475a',
                background: '#10161f',
                color: '#e9eef6',
                fontSize: 15,
              },
            },
            String(input.level),
          ),
        ),
        h(
          'div',
          { style: CONTROL_CHIP as any },
          h('div', { style: { display: 'flex' } }, 'Звёздность:'),
          h('div', { style: { display: 'flex', gap: 6 } }, ...[0, 1, 2, 3, 4].map(starEl)),
        ),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' } },
      row(panel.typeIcon, 'Тип', panel.typeLabel),
      row(null, 'Тир', panel.tierLabel),
      row(STAT_ICON_HP, 'HP', numFmt(panel.hp)),
      ...panel.attackRows.map(attackRow),
      row(STAT_ICON_SPEED, 'Скорость', formatSpeed(panel.speed)),
      row(SILVER_ICON, 'Серебро', numFmt(panel.silver)),
      orbBuildBlock(),
    ),
    ...(input.appearances ? [appearancesBlocks(input.appearances)] : []),
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'center',
          fontSize: 12,
          color: '#637083',
          marginTop: 6,
          paddingTop: 14,
          borderTop: '1px solid #3a475a',
          fontWeight: 700,
          letterSpacing: 2,
          width: '100%',
        },
      },
      'ARCHIVIST-LIBRARY.COM',
    ),
  )

  // Deliberately generous: Satori has a fixed SVG viewport, so an estimate
  // that undershoots the real content clips it (rasterized straight past the
  // bottom edge) - there's no auto-grow to fall back on. Overshooting costs
  // nothing since rasterize()'s sharp().trim() crops the unused space back
  // off. The +160 pads for a long mutant name wrapping to a second line
  // (longest in mutants.json is ~30 chars, close enough to the header's
  // single-line budget at 28px bold to not risk it) - untested against the
  // actual extremes, so err generous rather than exact.
  const rowCount = 4 + panel.attackRows.length
  // Блок сборок сфер: шапка плюс строка на каждую сборку (иконки выше обычной
  // строки, поэтому считается отдельно от rowCount).
  const buildBlockHeight = panel.orbBuilds.length > 0 ? 46 + panel.orbBuilds.length * 62 : 60
  const estHeight =
    90 +
    8 * 14 +
    150 +
    60 +
    12 +
    52 +
    60 +
    rowCount * 60 +
    buildBlockHeight +
    60 +
    160 +
    (input.appearances ? estimateAppearancesHeight(input.appearances) : 0)
  return { tree, estHeight }
}

export async function rasterize(tree: any, width: number, height: number): Promise<Buffer> {
  const { bold, medium, regular } = await loadFonts()
  const svg = await satori(tree, {
    width,
    height,
    fonts: [
      { name: 'TT Supermolot Neue', data: regular, weight: 400, style: 'normal' },
      { name: 'TT Supermolot Neue', data: medium, weight: 600, style: 'normal' },
      { name: 'TT Supermolot Neue', data: bold, weight: 700, style: 'normal' },
      { name: 'TT Supermolot Neue', data: bold, weight: 800, style: 'normal' },
    ],
  })
  const pngBuffer = new Resvg(svg, { fitTo: { mode: 'width', value: width * 2 } }).render().asPng()
  // trim()'s default reference is whatever color sits at (0,0) - for a
  // rounded-corner single card that's transparent (matches the generous
  // estHeight overshoot below, so it crops away cleanly), but
  // renderComparePair's wrapper paints an unrounded background starting
  // exactly at (0,0), making that corner opaque. An opaque reference
  // doesn't match the transparent overshoot padding, so trim() refuses to
  // crop it - the exact bug (a white/blank strip once Telegram composites
  // the leftover transparency). Pinning the trim target to transparent
  // sidesteps corner-color luck entirely.
  const trimmed = await sharp(pngBuffer)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  // Telegram photos have no alpha channel: the transparent corners cut out by
  // the card's borderRadius were composited on white (little white notches in
  // all four corners). Fill them with the card colour, so the corners just
  // read as square. Separate step: trim() above must still see the transparency.
  return sharp(trimmed).flatten({ background: CARD_BG }).toBuffer()
}

export async function renderStatsCard(input: CardInput): Promise<Buffer> {
  const { tree, estHeight } = await buildPanelTree(input)
  return rasterize(tree, 680, estHeight)
}

// Shared by the 2-way ".vs"/"против" card and the up-to-5-way ".сравнение"
// card - both are just a single flex row of panels with a divider between
// each pair, sized to fit whichever panel estimates tallest.
async function renderCompareRow(cards: CardInput[]): Promise<Buffer> {
  const trees = await Promise.all(cards.map(buildPanelTree))
  const children: ReturnType<typeof h>[] = []
  trees.forEach((t, i) => {
    if (i > 0) {
      children.push(
        h('div', {
          style: { display: 'flex', width: 2, background: '#3a475a', alignSelf: 'stretch' },
        }),
      )
    }
    children.push(t.tree)
  })
  const wrapper = h(
    'div',
    { style: { display: 'flex', alignItems: 'flex-start', gap: 0, background: '#1b212a' } },
    ...children,
  )
  const width = 680 * cards.length + 2 * (cards.length - 1)
  const height = Math.max(...trees.map((t) => t.estHeight))
  return rasterize(wrapper, width, height)
}

export async function renderComparePair(a: CardInput, b: CardInput): Promise<Buffer> {
  return renderCompareRow([a, b])
}

export async function renderCompareMulti(cards: CardInput[]): Promise<Buffer> {
  return renderCompareRow(cards)
}
