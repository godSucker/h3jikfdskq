import rawMachine from '@/data/simulators/lucky_slots/machine.json'

export type LuckyRewardType = 'entity' | 'hardcurrency' | 'softcurrency'

export type LuckyRewardCategory =
  | 'jackpot'
  | 'free-spin'
  | 'star'
  | 'material'
  | 'booster'
  | 'mutant'
  | 'currency'
  | 'token'
  | 'orb'
  | 'special'

export interface LuckyReward {
  rewardId: number
  amount: number
  odds: number
  type: LuckyRewardType
  id: string | null
  picture: string | null
  isBigwin: boolean
  isSuperJackpot: boolean
  isFreeTry: boolean
  name: string
  description: string
  category: LuckyRewardCategory
  icon: string
}

export interface LuckyMachineDefinition {
  id: string
  title: string
  cost: number
  tokenCost: number
  rewards: LuckyReward[]
}

export interface LuckyRewardChance extends LuckyReward {
  chance: number
}

export interface LuckyRewardAggregate {
  reward: LuckyReward
  label: string
  count: number
  totalAmount: number
  icon: string
}

export interface LuckyCategoryAggregate {
  category: LuckyRewardCategory
  label: string
  icon: string
  count: number
  totalAmount: number
}

export type LuckySpinType = 'reward' | 'free-spin'

export interface LuckySpinSummary {
  type: LuckySpinType
  reward: LuckyReward
  label: string
  icon: string
  timestamp: number
}

export interface LuckySimulation {
  requestedSpins: number
  totalSpins: number
  paidSpins: number
  freeSpins: number
  goldWon: number
  silverWon: number
  tokenItems: number
  breakdown: LuckyRewardAggregate[]
  categories: LuckyCategoryAggregate[]
  history: LuckySpinSummary[]
}

export interface LuckySimulationOptions {
  historySize?: number
  randomFn?: () => number
  batchSize?: number
  onProgress?: (completed: number, total: number) => void
  signal?: AbortSignal
  labels?: Record<number, string>
}

interface WeightedReward {
  reward: LuckyReward
  cumulative: number
}

interface LuckySimulationContext {
  weightedRewards: WeightedReward[]
  totalWeight: number
  rewardMap: Map<number, LuckyRewardAggregate>
  categoryMap: Map<LuckyRewardCategory, LuckyCategoryAggregate>
  totalGoldWon: number
  totalSilverWon: number
  totalTokenItems: number
  freeSpins: number
  historyBuffer: LuckySpinSummary[]
  historySize: number
  historyCount: number
  lastHistoryIndex: number
  baseTimestamp: number
  totalSpins: number
  labels?: Record<number, string>
}

const CATEGORY_INFO: Record<LuckyRewardCategory, { label: string; icon: string }> = {
  jackpot: { label: 'Джекпоты', icon: '/roulette-thumbs/jackpot.png' },
  'free-spin': { label: 'Бесплатные прокруты', icon: '/etc/freespin.webp' },
  star: { label: 'Звёзды', icon: '/stars/star_gold.webp' },
  material: { label: 'Материалы', icon: '/materials/mini_xp.webp' },
  booster: { label: 'Бустеры', icon: '/boosters/charm_xpx2_7.webp' },
  mutant: { label: 'Мутанты', icon: '/mut_icons/icon_gacha.webp' },
  currency: { label: 'Валюта', icon: '/roulette-thumbs/hardcurrency.png' },
  token: { label: 'Жетоны', icon: '/materials/Material_Gacha_Token.png' },
  orb: { label: 'Сферы', icon: '/orbs/basic/orb_basic_xp.webp' },
  special: { label: 'Особые призы', icon: '/etc/icon_timer.webp' },
}

export const luckyMachine: LuckyMachineDefinition = rawMachine as LuckyMachineDefinition

export function getValidRewards(machine: LuckyMachineDefinition = luckyMachine): LuckyReward[] {
  return machine.rewards.filter((reward) => reward.odds > 0)
}

export function getTotalWeight(machine: LuckyMachineDefinition = luckyMachine): number {
  return getValidRewards(machine).reduce((sum, reward) => sum + reward.odds, 0)
}

export { formatNumber } from '@/lib/utils'

export function getRewardWithChance(
  reward: LuckyReward,
  machine: LuckyMachineDefinition = luckyMachine,
): LuckyRewardChance {
  const totalWeight = getTotalWeight(machine)
  const chance = totalWeight > 0 ? reward.odds / totalWeight : 0
  return {
    ...reward,
    chance,
  }
}

function createSimulationContext(
  machine: LuckyMachineDefinition,
  options: LuckySimulationOptions,
): LuckySimulationContext {
  const { historySize = 20 } = options
  const rewards = getValidRewards(machine)
  if (!rewards.length) {
    throw new Error('Нет доступных наград для симуляции.')
  }

  const weightedRewards: WeightedReward[] = []
  let cumulativeWeight = 0
  for (const reward of rewards) {
    cumulativeWeight += reward.odds
    weightedRewards.push({ reward, cumulative: cumulativeWeight })
  }

  const historyBuffer = historySize > 0 ? new Array<LuckySpinSummary>(historySize) : []

  return {
    weightedRewards,
    totalWeight: cumulativeWeight,
    rewardMap: new Map(),
    categoryMap: new Map(),
    totalGoldWon: 0,
    totalSilverWon: 0,
    totalTokenItems: 0,
    freeSpins: 0,
    historyBuffer,
    historySize,
    historyCount: 0,
    lastHistoryIndex: -1,
    baseTimestamp: Date.now(),
    totalSpins: 0,
    labels: options.labels,
  }
}

function selectReward(ctx: LuckySimulationContext, randomFn: () => number): LuckyReward {
  const target = randomFn() * ctx.totalWeight
  for (const weighted of ctx.weightedRewards) {
    if (target <= weighted.cumulative) {
      return weighted.reward
    }
  }

  return ctx.weightedRewards[ctx.weightedRewards.length - 1].reward
}

function ensureCategory(
  ctx: LuckySimulationContext,
  category: LuckyRewardCategory,
): LuckyCategoryAggregate {
  let entry = ctx.categoryMap.get(category)
  if (!entry) {
    const meta = CATEGORY_INFO[category] ?? CATEGORY_INFO.special
    entry = {
      category,
      label: meta.label,
      icon: meta.icon,
      count: 0,
      totalAmount: 0,
    }
    ctx.categoryMap.set(category, entry)
  }
  return entry
}

function recordHistory(
  ctx: LuckySimulationContext,
  reward: LuckyReward,
  index: number,
  type: LuckySpinType,
): void {
  if (ctx.historySize <= 0) {
    return
  }

  const summary: LuckySpinSummary = {
    type,
    reward,
    label: ctx.labels?.[reward.rewardId] ?? reward.name,
    icon: reward.icon,
    timestamp: ctx.baseTimestamp + index,
  }

  const slot = index % ctx.historySize
  ctx.historyBuffer[slot] = summary
  ctx.lastHistoryIndex = slot
  if (ctx.historyCount < ctx.historySize) {
    ctx.historyCount += 1
  }
}

function recordReward(ctx: LuckySimulationContext, reward: LuckyReward, index: number): void {
  let aggregate = ctx.rewardMap.get(reward.rewardId)
  if (!aggregate) {
    aggregate = {
      reward,
      label: ctx.labels?.[reward.rewardId] ?? reward.name,
      count: 0,
      totalAmount: 0,
      icon: reward.icon,
    }
    ctx.rewardMap.set(reward.rewardId, aggregate)
  }

  aggregate.count += 1
  aggregate.totalAmount += reward.amount

  const categoryEntry = ensureCategory(ctx, reward.category)
  categoryEntry.count += 1
  categoryEntry.totalAmount += reward.amount

  if (reward.type === 'hardcurrency') {
    ctx.totalGoldWon += reward.amount
  } else if (reward.type === 'softcurrency') {
    ctx.totalSilverWon += reward.amount
  }

  if (reward.category === 'token') {
    ctx.totalTokenItems += reward.amount
  }

  recordHistory(ctx, reward, index, 'reward')
}

function recordFreeSpin(ctx: LuckySimulationContext, reward: LuckyReward, index: number): void {
  ctx.freeSpins += 1
  recordHistory(ctx, reward, index, 'free-spin')
}

function finalizeSimulation(ctx: LuckySimulationContext, requestedSpins: number): LuckySimulation {
  const breakdown = Array.from(ctx.rewardMap.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count
    }
    return b.totalAmount - a.totalAmount
  })

  const categories = Array.from(ctx.categoryMap.values()).sort((a, b) => b.count - a.count)

  const history: LuckySpinSummary[] = []
  for (let i = 0; i < ctx.historyCount; i += 1) {
    const index = (ctx.lastHistoryIndex - i + ctx.historySize) % ctx.historySize
    const entry = ctx.historyBuffer[index]
    if (entry) {
      history.push(entry)
    }
  }

  const paidSpins = ctx.totalSpins - ctx.freeSpins

  return {
    requestedSpins,
    totalSpins: ctx.totalSpins,
    paidSpins,
    freeSpins: ctx.freeSpins,
    goldWon: ctx.totalGoldWon,
    silverWon: ctx.totalSilverWon,
    tokenItems: ctx.totalTokenItems,
    breakdown,
    categories,
    history,
  }
}

export async function simulateLuckyMachineAsync(
  spins: number,
  machine: LuckyMachineDefinition = luckyMachine,
  options: LuckySimulationOptions = {},
): Promise<LuckySimulation> {
  const { randomFn = Math.random, batchSize = 2000, onProgress, signal } = options
  const ctx = createSimulationContext(machine, options)

  let queue = spins
  let remainingPaid = spins
  let completedPaid = 0
  let index = 0

  while (queue > 0) {
    if (signal?.aborted) {
      throw new DOMException('Симуляция остановлена', 'AbortError')
    }

    const spinsThisBatch = Math.min(batchSize, queue)
    let processed = 0

    while (processed < spinsThisBatch) {
      queue -= 1
      processed += 1

      const reward = selectReward(ctx, randomFn)
      ctx.totalSpins += 1

      const wasPaid = remainingPaid > 0
      if (wasPaid) {
        remainingPaid -= 1
        completedPaid += 1
      }

      if (reward.isFreeTry) {
        queue += 1
        recordFreeSpin(ctx, reward, index)
      } else {
        recordReward(ctx, reward, index)
      }

      index += 1
    }

    onProgress?.(completedPaid, spins)

    if (queue > 0) {
      await new Promise((resolve) => setTimeout(resolve))
    }
  }

  if (completedPaid < spins) {
    onProgress?.(spins, spins)
  }

  return finalizeSimulation(ctx, spins)
}
