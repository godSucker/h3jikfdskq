/**
 * Квадратная карточка "Ротация крафта" для стат-бота (.расписание): текущая
 * дополнительная награда крафта и порядок следующих. Цикл детерминирован
 * (craft-simulator.ts::getIncentiveSchedule, IncentiveLoop из craft.xml с
 * 2015-11-28 12:00 UTC), поэтому живых запросов к игре не нужно.
 *
 * Рисуется тем же Satori+resvg, что и карточка статов (без Chromium - см.
 * шапку telegram-card-render.ts), в квадрат 1080x1080: длинная полоса на 18
 * слотов в чате нечитаема. Все 18 слотов цикла, в порядке включения, активный
 * подсвечен. Время - МСК.
 */
import {
  getIncentiveSchedule,
  incentiveLoopOrder,
  translateItemId,
  getItemTexture,
  formatDurationMinutes,
} from '@/lib/craft-simulator'
import { h, loadImageDataUri, rasterize } from './telegram-card-render'

const SIZE = 1080
const PAD = 36
const COLS = 3
const GAP = 14
const TILE_W = Math.floor((SIZE - PAD * 2 - GAP * (COLS - 1)) / COLS)
const CDN_PREFIX = 'https://cdn.archivist-library.com'
const FALLBACK_ICON = '/etc/icon_larva.webp'

const mskDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

// Как в CraftSimulator.svelte: до ближайшего включения бывает больше недели -
// минуты нужны только когда ждать меньше часа, часы - пока меньше суток.
function coarseMinutes(minutes: number): number {
  const m = Math.max(1, Math.round(minutes))
  if (m >= 1440) return Math.round(m / 60) * 60
  if (m >= 60) return Math.round(m / 5) * 5
  return m
}

function iconPath(id: string): string {
  const url = getItemTexture(id)
  return url?.startsWith(CDN_PREFIX) ? url.slice(CDN_PREFIX.length) : (url ?? FALLBACK_ICON)
}

function pct(per1000: number): string {
  const v = per1000 / 10
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')}%`
}

export interface CraftScheduleCard {
  png: Buffer
}

export async function renderCraftScheduleCard(now: Date = new Date()): Promise<CraftScheduleCard> {
  const schedule = getIncentiveSchedule(now)
  if (schedule.length === 0) throw new Error('craft incentive schedule is empty')

  // Хронологически: активный первым, дальше по времени включения.
  const slots = [...schedule].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const icons = new Map<string, string>()
  await Promise.all(
    [...new Set(slots.map((s) => incentiveLoopOrder[s.index].id))].map(async (id) => {
      const uri = await loadImageDataUri(iconPath(id)).catch(() => loadImageDataUri(FALLBACK_ICON))
      icons.set(id, uri)
    }),
  )

  const totalMinutes = incentiveLoopOrder.reduce((sum, r) => sum + r.duration, 0)
  const rows = Math.ceil(slots.length / COLS)
  const HEADER_H = 128
  const FOOTER_H = 44
  const tileH = Math.floor(
    (SIZE - PAD * 2 - HEADER_H - FOOTER_H - GAP * (rows - 1)) / rows,
  )

  const tiles = slots.map((slot) => {
    const reward = incentiveLoopOrder[slot.index]
    const active = slot.isActive
    // Как на странице крафта (craft.incentive.slotStartsAt / slotRemaining):
    // "{дата} · через {время}" и "ещё {время}" - в плитке две строки.
    const whenDate = active ? 'СЕЙЧАС' : mskDate.format(slot.startsAt)
    const whenIn = active
      ? `ещё ${formatDurationMinutes(coarseMinutes(slot.minutesRemaining), 'ru')}`
      : `через ${formatDurationMinutes(coarseMinutes(slot.minutesUntilStart), 'ru')}`
    return h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          width: TILE_W,
          height: tileH,
          padding: 8,
          borderRadius: 18,
          backgroundColor: active ? 'rgba(251,191,36,0.14)' : '#161b22',
          border: active ? '2px solid #fbbf24' : '1px solid rgba(148,163,184,0.2)',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            width: 68,
            height: 68,
            flexShrink: 0,
            marginRight: 10,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: 'rgba(0,0,0,0.3)',
          },
        },
        h('img', { src: icons.get(reward.id), width: 58, height: 58, style: { objectFit: 'contain' } }),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: 19,
              fontWeight: 700,
              lineHeight: 1.15,
              color: '#f1f5f9',
              lineClamp: 2,
            },
          },
          translateItemId(reward.id),
        ),
        h(
          'div',
          { style: { display: 'flex', fontSize: 18, color: '#94a3b8', marginTop: 4 } },
          `${pct(reward.per1000)} · ${formatDurationMinutes(reward.duration, 'ru')}`,
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: 18,
              fontWeight: 700,
              marginTop: 2,
              color: active ? '#fbbf24' : '#60a5fa',
            },
          },
          whenDate,
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: 17,
              fontWeight: 600,
              color: active ? '#fcd34d' : '#93c5fd',
            },
          },
          whenIn,
        ),
      ),
    )
  })

  const tree = h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: SIZE,
        height: SIZE,
        padding: PAD,
        backgroundColor: '#0d1117',
        fontFamily: 'TT Supermolot Neue',
        color: '#e2e8f0',
      },
    },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', height: HEADER_H } },
      h('div', { style: { display: 'flex', fontSize: 48, fontWeight: 800, color: '#fceabb' } }, 'Ротация крафта'),
      h(
        'div',
        { style: { display: 'flex', fontSize: 24, color: '#94a3b8', marginTop: 6 } },
        `Дополнительные награды · ${slots.length} слотов по кругу, полный цикл ${formatDurationMinutes(totalMinutes, 'ru')}`,
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: GAP, flex: 1, alignContent: 'flex-start' } },
      ...tiles,
    ),
    h(
      'div',
      { style: { display: 'flex', height: FOOTER_H, alignItems: 'flex-end', fontSize: 22, color: '#64748b' } },
      'Время указано по Москве (МСК) · archivist-library.com/simulators/craft',
    ),
  )

  const png = await rasterize(tree, SIZE, SIZE)

  return { png }
}
