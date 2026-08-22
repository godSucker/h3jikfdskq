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
import sharp from 'sharp'
import type { PanelData } from './panel-data'

const CDN = 'https://cdn.archivist-library.com'
const FONT_BASE = `${CDN}/fonts/tt-supermolot-neue`

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

const imgCache = new Map<string, string>()
async function loadImageDataUri(relPath: string, grayscale = false): Promise<string> {
  const key = grayscale ? `${relPath}#gray` : relPath
  const cached = imgCache.get(key)
  if (cached) return cached
  const res = await fetch(CDN + relPath)
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${relPath}`)
  const buf = Buffer.from(await res.arrayBuffer())
  let img = sharp(buf)
  if (grayscale) img = img.grayscale().modulate({ brightness: 0.6 })
  const uri = `data:image/png;base64,${(await img.png().toBuffer()).toString('base64')}`
  imgCache.set(key, uri)
  return uri
}

let fontsPromise: Promise<{ bold: Buffer; medium: Buffer; regular: Buffer }> | null = null
function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all(
      ['Bold', 'Medium', 'Regular'].map(async (w) => {
        const res = await fetch(`${FONT_BASE}/TTSupermolotNeue-${w}.ttf`)
        if (!res.ok) throw new Error(`font fetch failed ${res.status} ${w}`)
        return Buffer.from(await res.arrayBuffer())
      }),
    ).then(([bold, medium, regular]) => ({ bold, medium, regular }))
  }
  return fontsPromise
}

function h(type: string, props: any, ...children: any[]) {
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
}

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
  ])
  const uriByPath: Record<string, string> = {}
  await Promise.all(
    Array.from(uniquePaths).map(async (p) => {
      uriByPath[p] = await loadImageDataUri(p)
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
          { style: { display: 'flex', position: 'relative', width: 54, height: 44, flexShrink: 0 } },
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
        background: '#2a313c',
        borderRadius: 16,
        padding: '24px 26px',
        fontFamily: 'TT Supermolot Neue',
      },
    },
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'center', width: '100%' } },
      h(
        'div',
        { style: { display: 'flex', fontSize: 28, fontWeight: 800, color: '#ffffff' } },
        panel.name,
      ),
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
    ),
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
  const estHeight = 90 + 8 * 14 + 150 + 60 + 12 + 52 + 60 + rowCount * 60 + 60 + 160
  return { tree, estHeight }
}

async function rasterize(tree: any, width: number, height: number): Promise<Buffer> {
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
  return sharp(pngBuffer).trim().toBuffer()
}

export async function renderStatsCard(input: CardInput): Promise<Buffer> {
  const { tree, estHeight } = await buildPanelTree(input)
  return rasterize(tree, 680, estHeight)
}

export async function renderComparePair(a: CardInput, b: CardInput): Promise<Buffer> {
  const [treeA, treeB] = await Promise.all([buildPanelTree(a), buildPanelTree(b)])
  const wrapper = h(
    'div',
    { style: { display: 'flex', alignItems: 'flex-start', gap: 0, background: '#1b212a' } },
    treeA.tree,
    h('div', { style: { display: 'flex', width: 2, background: '#3a475a', alignSelf: 'stretch' } }),
    treeB.tree,
  )
  return rasterize(wrapper, 680 * 2 + 2, Math.max(treeA.estHeight, treeB.estHeight))
}
