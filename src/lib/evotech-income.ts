// Режим "Тратить сейчас или ждать" калькулятора эво: доход серебра с мутантов в зонах и
// сравнение стратегий (потратить долю серебра на скидке сейчас или копить до большой).
// Чистые функции без DOM, покрыты тестами (evotech-income.test.ts).
//
// Модель (все числа из игры):
//  - мутант в зоне даёт bank x level серебра в час (bank_base из mutants.json, как в
//    калькуляторе статов; HabitatController::getCurrencyFromSpecimen);
//  - зона копит серебро только до своего лимита (Tag "bank" у Habitat_* в
//    gamedefinitions.xml), копит и офлайн, но забрать можно только онлайн;
//  - доход за один сбор = min(лимит, ставка x часы с прошлого сбора);
//  - уровень эволюционного центра = максимальный уровень мутантов. Мутанты подтягиваются
//    к капу не сами, поэтому уровень растёт вслед за эво с коэффициентом follow (1 = всегда
//    на капе).
// Сознательные упрощения (должны быть видны пользователю в подсказке режима):
//  считается серебро только с заданных групп; мутанты занимают самые вместительные зоны
//  первыми; сборы идут через равные промежутки; цена прокачки самих мутантов не учитывается.

import { createEvoModel, solveForward, type EvoRow } from './evotech'

export interface ZoneType {
  id: string
  cap: number // лимит серебра в зоне
  slots: number // сколько мутантов вмещает зона
}

// Лимиты и вместимость из gamedefinitions.xml: у каждой зоны два значения bank (на время
// улучшения и итоговое), берём итоговое (максимум). Вместимость 2/3/4 - src/data/materials/zones.json.
// Лимиты обычных секторов зависят от гена: A/B/C одинаковые, D, E и F свои. Люкс-секторы
// у всех генов одинаковые (200 000 / 320 000). Сектор определяет первый ген мутанта.
const LUXE: readonly ZoneType[] = [
  { id: 'l2', cap: 200_000, slots: 3 },
  { id: 'l3', cap: 320_000, slots: 4 },
]
export const ZONE_TYPES = {
  low: [
    { id: 't1', cap: 500, slots: 2 },
    { id: 't2', cap: 2_500, slots: 3 },
    { id: 't3', cap: 9_000, slots: 4 },
    ...LUXE,
  ],
  beast: [
    { id: 't1', cap: 5_000, slots: 2 },
    { id: 't2', cap: 15_000, slots: 3 },
    { id: 't3', cap: 30_000, slots: 4 },
    ...LUXE,
  ],
  galactic: [
    { id: 't1', cap: 12_000, slots: 2 },
    { id: 't2', cap: 50_000, slots: 3 },
    { id: 't3', cap: 80_000, slots: 4 },
    ...LUXE,
  ],
  mythic: [
    { id: 't1', cap: 25_000, slots: 2 },
    { id: 't2', cap: 80_000, slots: 3 },
    { id: 't3', cap: 160_000, slots: 4 },
    ...LUXE,
  ],
} as const satisfies Record<string, readonly ZoneType[]>

export type ZoneKind = keyof typeof ZONE_TYPES

// Семейство секторов по первому гену мутанта (A-F).
export function zoneKindForGene(gene: string | undefined): ZoneKind {
  switch ((gene ?? '').toUpperCase()) {
    case 'D':
      return 'beast'
    case 'E':
      return 'galactic'
    case 'F':
      return 'mythic'
    default:
      return 'low' // A, B, C
  }
}

export interface IncomeGroup {
  mutants: number
  bankPerLevel: number // bank_base мутанта (105 у Мидаса и Охотника за головами)
  level: number // средний уровень группы СЕЙЧАС
  zones: { cap: number; slots: number; count: number }[]
}

// Уровень мутантов группы при эво evo: тянется за эво с коэффициентом follow, но не выше капа.
export function levelAt(level0: number, evo0: number, evo: number, follow: number): number {
  const f = Math.max(0, Math.min(1, follow))
  return Math.min(evo, level0 + f * (evo - evo0))
}

export interface GroupIncome {
  perCycle: number // серебра за один сбор
  potentialPerCycle: number // сколько было бы без лимитов зон
  placed: number
  unplaced: number // мутантов, которым не хватило зон
  minFillHours: number | null // за сколько часов самая быстрая занятая зона забивается
}

// Серебро за один сбор с группы при заданном уровне мутантов и интервале между сборами.
export function groupIncome(group: IncomeGroup, level: number, intervalHours: number): GroupIncome {
  const zones = [...group.zones].filter((z) => z.count > 0).sort((a, b) => b.cap - a.cap)
  let left = Math.max(0, Math.floor(group.mutants))
  const perMutantHour = group.bankPerLevel * Math.max(0, level)
  let perCycle = 0
  let potential = 0
  let placed = 0
  let minFill: number | null = null
  for (const z of zones) {
    for (let i = 0; i < z.count && left > 0; i++) {
      const n = Math.min(z.slots, left)
      left -= n
      placed += n
      const rate = n * perMutantHour
      perCycle += Math.min(z.cap, rate * intervalHours)
      potential += rate * intervalHours
      if (rate > 0) {
        const fill = z.cap / rate
        minFill = minFill === null ? fill : Math.min(minFill, fill)
      }
    }
  }
  return { perCycle, potentialPerCycle: potential, placed, unplaced: left, minFillHours: minFill }
}

export interface SpendParams {
  rows: readonly (EvoRow | null)[]
  evo: number // текущее эво
  silver: bigint
  gold: bigint // золото не копится в модели: тратится только на большой скидке
  nowDiscount: { silver: number; gold: number }
  bigDiscount: number // процент большой скидки (на обе валюты)
  days: number // дней до большой скидки
  collectsPerDay: number
  follow: number // 0..1
  groups: IncomeGroup[]
}

export interface SpendOutcome {
  fraction: number
  midLevel: number // эво сразу после покупки сейчас
  finalLevel: number // эво после траты на большой скидке
  incomePerDayBefore: number
  incomePerDayAfter: number
}

export function incomePerDay(
  p: SpendParams,
  evo: number,
): { perDay: number; groups: GroupIncome[] } {
  const interval = 24 / Math.max(0.01, p.collectsPerDay)
  const groups = p.groups.map((g) =>
    groupIncome(g, levelAt(g.level, p.evo, evo, p.follow), interval),
  )
  const cycle = groups.reduce((s, g) => s + g.perCycle, 0)
  return { perDay: cycle * p.collectsPerDay, groups }
}

// Что будет, если сейчас потратить долю fraction серебра на скидке сейчас, а остальное
// (вместе с накопленным) потратить на большой скидке.
export function evaluateSpend(p: SpendParams, fraction: number): SpendOutcome {
  const f = Math.max(0, Math.min(1, fraction))
  const now = createEvoModel(p.rows, p.nowDiscount)
  const big = createEvoModel(p.rows, { silver: p.bigDiscount, gold: p.bigDiscount })

  const budgetNow = (p.silver * BigInt(Math.round(f * 1000))) / 1000n
  const bought = f > 0 ? solveForward(now, p.evo, budgetNow, 0n) : null
  const midLevel = bought ? bought.endLevel : p.evo
  const silverAfter = p.silver - (bought ? bought.spentSilver : 0n)

  const before = incomePerDay(p, p.evo).perDay
  const after = incomePerDay(p, midLevel).perDay
  const earned = BigInt(Math.floor(after * Math.max(0, p.days)))
  const final = solveForward(big, midLevel, silverAfter + earned, p.gold)
  return {
    fraction: f,
    midLevel,
    finalLevel: final.endLevel,
    incomePerDayBefore: before,
    incomePerDayAfter: after,
  }
}

export interface SpendComparison {
  wait: SpendOutcome
  all: SpendOutcome
  best: SpendOutcome // лучшая доля из сетки; при равенстве - меньшая доля
}

export function compareSpend(p: SpendParams, step = 0.05): SpendComparison {
  const wait = evaluateSpend(p, 0)
  const all = evaluateSpend(p, 1)
  let best = wait
  for (let f = step; f < 1 - 1e-9; f += step) {
    const o = evaluateSpend(p, f)
    if (o.finalLevel > best.finalLevel) best = o
  }
  if (all.finalLevel > best.finalLevel) best = all
  return { wait, all, best }
}

// Ближайшее "окно" больших скидок по истории (src/data/evo-big-discounts.json, windows).
export interface BigWindow {
  kind: string
  from: string // MM-DD
  to: string // MM-DD, может быть в следующем году
}

export function nextBigWindow(
  windows: readonly BigWindow[],
  now: Date,
): {
  kind: string
  start: Date
  end: Date
  daysToStart: number
  daysToEnd: number
  daysToMid: number
} | null {
  const day = 86_400_000
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  let best: { kind: string; start: number; end: number } | null = null
  for (const w of windows) {
    const [fm, fd] = w.from.split('-').map(Number)
    const [tm, td] = w.to.split('-').map(Number)
    for (const y of [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
      const start = Date.UTC(y, fm - 1, fd)
      const end = Date.UTC(tm < fm || (tm === fm && td < fd) ? y + 1 : y, tm - 1, td)
      if (end < today) continue // окно уже прошло
      if (!best || start < best.start) best = { kind: w.kind, start, end }
    }
  }
  if (!best) return null
  const toStart = Math.max(0, Math.round((best.start - today) / day))
  const toEnd = Math.max(0, Math.round((best.end - today) / day))
  return {
    kind: best.kind,
    start: new Date(best.start),
    end: new Date(best.end),
    daysToStart: toStart,
    daysToEnd: toEnd,
    daysToMid: Math.round((toStart + toEnd) / 2),
  }
}
