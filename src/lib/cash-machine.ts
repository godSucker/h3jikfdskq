import rawMachine from '@/data/simulators/cash/machine.json'
import { t, type Locale } from '@/lib/i18n'

export type CashRewardType = 'entity' | 'hardcurrency' | 'softcurrency'

export interface CashReward {
  rewardId: number
  amount: number
  odds: number
  type: CashRewardType
  id: string | null
  picture: string | null
  isBigwin: boolean
  isSuperJackpot: boolean
}

export interface CashMachineDefinition {
  id: string
  title: string
  cost: number
  tokenCost: number
  rewards: CashReward[]
}

export interface RewardChance extends CashReward {
  chance: number
  label: string
  icon: string
}

export const cashMachine: CashMachineDefinition = rawMachine as CashMachineDefinition

export function getValidRewards(machine: CashMachineDefinition = cashMachine): CashReward[] {
  return machine.rewards.filter((reward) => reward.odds > 0)
}

export function getTotalWeight(machine: CashMachineDefinition = cashMachine): number {
  return getValidRewards(machine).reduce((sum, reward) => sum + reward.odds, 0)
}

import { formatNumber } from '@/lib/utils'
export { formatNumber }

export function getRewardLabel(reward: CashReward, locale: Locale = 'ru'): string {
  if (reward.type === 'hardcurrency') {
    return `${formatNumber(reward.amount, locale)} ${t('roulette.cash.unitGold', locale)}`
  }
  if (reward.type === 'softcurrency') {
    return `${formatNumber(reward.amount, locale)} ${t('roulette.cash.unitSilver', locale)}`
  }
  if (reward.picture && reward.picture.includes('jackpot')) {
    return t('roulette.madness.researchJackpot', locale)
  }
  return t('roulette.cash.unknownReward', locale)
}

// Real Cash Frenzy reward thumbnails, mirrored from the game CDN
// (assets/thumbnails/*.png) into public/roulette-thumbs/. The roulette config
// references each thumbnail by name in reward.picture; earlier this module
// ignored that and substituted the generic outlined coin icons in
// public/cash/*.webp (shared with bingo/lucky/madness), which did not match
// the artwork shown inside the roulette itself.
const FRENZY_ICON_BASE = '/roulette-thumbs'

const FRENZY_REWARD_ICONS = new Set([
  'jackpot',
  'jackpot_gold_x30',
  'jackpot_gold_x40',
  'jackpot_gold_x50',
  'jackpot_gold_x80',
  'jackpot_gold_x100',
  'jackpot_gold_x200',
  'jackpot_gold_x500',
  'jackpot_gold_x1000',
  'jackpot_gold_x2000',
  'jackpot_gold_x5000',
  'sc10000',
])

function frenzyIconFromPicture(picture: string | null): string | null {
  if (!picture) return null
  const base = picture.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '')
  return FRENZY_REWARD_ICONS.has(base) ? `${FRENZY_ICON_BASE}/${base}.png` : null
}

export function getCurrencyIcon(currency: 'hardcurrency' | 'softcurrency'): string {
  return currency === 'hardcurrency'
    ? `${FRENZY_ICON_BASE}/hardcurrency.png`
    : `${FRENZY_ICON_BASE}/softcurrency.png`
}

export function getRewardIcon(reward: CashReward): string {
  const fromPicture = frenzyIconFromPicture(reward.picture)
  if (fromPicture) return fromPicture

  if (reward.type === 'softcurrency') return getCurrencyIcon('softcurrency')
  if (reward.type === 'entity') return `${FRENZY_ICON_BASE}/jackpot.png`
  return getCurrencyIcon('hardcurrency')
}

export function getRewardChance(
  reward: CashReward,
  machine: CashMachineDefinition = cashMachine,
): number {
  const weight = getTotalWeight(machine)
  if (!weight) return 0
  return reward.odds / weight
}

export function getRewardWithChance(
  reward: CashReward,
  machine: CashMachineDefinition = cashMachine,
  locale: Locale = 'ru',
): RewardChance {
  return {
    ...reward,
    label: getRewardLabel(reward, locale),
    chance: getRewardChance(reward, machine),
    icon: getRewardIcon(reward),
  }
}

export interface SpinSummary {
  reward: CashReward
  label: string
  timestamp: number
  icon: string
}

export interface RewardAggregate {
  reward: CashReward
  label: string
  count: number
  totalAmount: number
  icon: string
}

export interface MachineSimulation {
  spins: number
  goldWon: number
  silverWon: number
  breakdown: RewardAggregate[]
  history: SpinSummary[]
}

export interface SimulationOptions {
  historySize?: number
  randomFn?: () => number
  batchSize?: number
  onProgress?: (completed: number, total: number) => void
  signal?: AbortSignal
  locale?: Locale
}

interface SimulationContext {
  weightedRewards: { reward: CashReward; cumulative: number }[]
  totalWeight: number
  rewardMap: Map<number, RewardAggregate>
  totalGoldWon: number
  totalSilverWon: number
  historyBuffer: SpinSummary[]
  historySize: number
  historyCount: number
  lastHistoryIndex: number
  baseTimestamp: number
  locale: Locale
}

function createSimulationContext(
  machine: CashMachineDefinition,
  options: SimulationOptions,
): SimulationContext {
  const { historySize = 12 } = options
  const rewards = getValidRewards(machine)
  if (!rewards.length) {
    throw new Error('Нет доступных наград для симуляции.')
  }

  const totalWeight = getTotalWeight(machine)
  const weightedRewards = [] as { reward: CashReward; cumulative: number }[]
  let cumulativeWeight = 0
  for (const reward of rewards) {
    cumulativeWeight += reward.odds
    weightedRewards.push({ reward, cumulative: cumulativeWeight })
  }

  const historyBuffer: SpinSummary[] = historySize > 0 ? new Array(historySize) : []

  return {
    weightedRewards,
    totalWeight,
    rewardMap: new Map<number, RewardAggregate>(),
    totalGoldWon: 0,
    totalSilverWon: 0,
    historyBuffer,
    historySize,
    historyCount: 0,
    lastHistoryIndex: -1,
    baseTimestamp: Date.now(),
    locale: options.locale ?? 'ru',
  }
}

function recordSpin(
  ctx: SimulationContext,
  machine: CashMachineDefinition,
  index: number,
  randomFn: () => number,
): void {
  const { weightedRewards, totalWeight } = ctx
  const target = randomFn() * totalWeight
  let selected: CashReward | null = null

  for (const weighted of weightedRewards) {
    if (target <= weighted.cumulative) {
      selected = weighted.reward
      break
    }
  }

  const reward = selected ?? weightedRewards[weightedRewards.length - 1].reward
  const label = getRewardLabel(reward, ctx.locale)
  const icon = getRewardIcon(reward)
  let entry = ctx.rewardMap.get(reward.rewardId)

  if (!entry) {
    entry = {
      reward,
      label,
      count: 0,
      totalAmount: 0,
      icon,
    }
    ctx.rewardMap.set(reward.rewardId, entry)
  }

  entry.count += 1
  entry.totalAmount += reward.amount

  if (reward.type === 'hardcurrency') {
    ctx.totalGoldWon += reward.amount
  } else if (reward.type === 'softcurrency') {
    ctx.totalSilverWon += reward.amount
  }

  if (ctx.historySize > 0) {
    const summary: SpinSummary = {
      reward,
      label,
      timestamp: ctx.baseTimestamp + index,
      icon,
    }
    const slot = index % ctx.historySize
    ctx.historyBuffer[slot] = summary
    ctx.lastHistoryIndex = slot
    if (ctx.historyCount < ctx.historySize) {
      ctx.historyCount += 1
    }
  }
}

function finalizeSimulation(ctx: SimulationContext, spins: number): MachineSimulation {
  const breakdown = Array.from(ctx.rewardMap.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count
    }
    return b.totalAmount - a.totalAmount
  })

  const history: SpinSummary[] = []
  for (let i = 0; i < ctx.historyCount; i += 1) {
    const index = (ctx.lastHistoryIndex - i + ctx.historySize) % ctx.historySize
    const entry = ctx.historyBuffer[index]
    if (entry) {
      history.push(entry)
    }
  }

  return {
    spins,
    goldWon: ctx.totalGoldWon,
    silverWon: ctx.totalSilverWon,
    breakdown,
    history,
  }
}

export async function simulateMachineAsync(
  spins: number,
  machine: CashMachineDefinition = cashMachine,
  options: SimulationOptions = {},
): Promise<MachineSimulation> {
  const { randomFn = Math.random, batchSize = 2000, onProgress, signal } = options
  const ctx = createSimulationContext(machine, options)

  let completed = 0

  while (completed < spins) {
    if (signal?.aborted) {
      throw new DOMException('Симуляция остановлена', 'AbortError')
    }

    const batchEnd = Math.min(completed + batchSize, spins)
    for (let i = completed; i < batchEnd; i += 1) {
      recordSpin(ctx, machine, i, randomFn)
    }

    completed = batchEnd
    onProgress?.(completed, spins)

    if (completed < spins) {
      await new Promise((resolve) => setTimeout(resolve))
    }
  }

  return finalizeSimulation(ctx, spins)
}
