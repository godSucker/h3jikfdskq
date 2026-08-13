import rawMachine from '@/data/simulators/mutants_madness/machine.json';

export type MadnessRewardType = 'entity';

export type MadnessIconVariant = 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface MadnessReward {
  rewardId: number;
  amount: number;
  odds: number;
  type: MadnessRewardType;
  id: string | null;
  picture: string | null;
  isBigwin: boolean;
  isSuperJackpot: boolean;
  skin: string | null;
  stars: number | null;
  research: number | null;
  name: string;
  starLabel: string | null;
  slug: string | null;
  iconVariant: MadnessIconVariant | null;
  icon: string | null;
}

export interface MadnessMachineDefinition {
  id: string;
  title: string;
  cost: number;
  tokenCost: number;
  rewards: MadnessReward[];
}

export interface MadnessRewardChance extends MadnessReward {
  chance: number;
  label: string;
}

export type MadnessResearchKey = number | 'special' | 'jackpot';

export interface MadnessResearchChance {
  key: MadnessResearchKey;
  label: string;
  totalOdds: number;
  chance: number;
  rewards: MadnessRewardChance[];
}

export type MadnessCurrency = 'token' | 'gold';

export interface MadnessSpinSummary {
  reward: MadnessReward;
  label: string;
  icon: string | null;
  researchKey: MadnessResearchKey;
  currency: MadnessCurrency;
  timestamp: number;
}

export interface MadnessRewardAggregate {
  reward: MadnessReward;
  label: string;
  icon: string | null;
  chance: number;
  count: number;
  totalAmount: number;
  currencyCounts: Record<MadnessCurrency, number>;
}

export interface MadnessResearchAggregate {
  key: MadnessResearchKey;
  label: string;
  chance: number;
  count: number;
  totalAmount: number;
}

export interface MadnessSimulation {
  level: number;
  totalSpins: number;
  tokenSpins: number;
  goldSpins: number;
  rewardBreakdown: MadnessRewardAggregate[];
  researchBreakdown: MadnessResearchAggregate[];
  history: MadnessSpinSummary[];
  jackpotCount: number;
}

export interface MadnessSimulationInput {
  level: number;
  tokenSpins: number;
  goldSpins: number;
}

export interface MadnessSimulationOptions {
  historySize?: number;
  randomFn?: () => number;
  batchSize?: number;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
}

interface WeightedReward {
  reward: MadnessReward;
  cumulative: number;
}

interface MadnessSimulationContext {
  weightedRewards: WeightedReward[];
  totalWeight: number;
  entityTotalWeight: number;
  level: number;
  tokenSpins: number;
  goldSpins: number;
  rewardMap: Map<number, MadnessRewardAggregate>;
  researchMap: Map<MadnessResearchKey, MadnessResearchAggregate>;
  chanceMap: Map<number, number>;
  researchChanceMap: Map<MadnessResearchKey, number>;
  historyBuffer: MadnessSpinSummary[];
  historySize: number;
  historyCount: number;
  lastHistoryIndex: number;
  baseTimestamp: number;
  jackpotCount: number;
  totalSpins: number;
}

// research 9/10 намеренно отсутствуют: в игре они выключены (все их награды
// в machine.json стоят с odds:0 и никогда не выпадают, независимо от уровня
// игрока), maxResearch не должен их учитывать - иначе текст "доступны
// исследования до N" врал бы на высоких уровнях (N=10 вместо реального 8).
const researchLevelMap: Record<number, number> = {
  1: 1,
  2: 10,
  3: 25,
  4: 35,
  5: 50,
  6: 100,
  7: 150,
  8: 175,
};

export const madnessMachine: MadnessMachineDefinition = rawMachine as MadnessMachineDefinition;

export function getMaxResearchForLevel(level: number): number {
  let max = 0;
  for (const [research, requiredLevel] of Object.entries(researchLevelMap)) {
    const researchNum = Number(research);
    if (Number.isFinite(requiredLevel) && level >= requiredLevel) {
      if (researchNum > max) {
        max = researchNum;
      }
    }
  }
  return max;
}

function getResearchKey(reward: MadnessReward): MadnessResearchKey {
  if (reward.isSuperJackpot) {
    return 'jackpot';
  }
  if (reward.research == null) {
    return 'special';
  }
  return reward.research;
}

export function getResearchLabel(key: MadnessResearchKey): string {
  if (key === 'jackpot') {
    return 'Джекпот';
  }
  if (key === 'special') {
    return 'Специальные награды';
  }
  return `Исследование ${key}`;
}

export function getRewardLabel(reward: MadnessReward): string {
  return reward.starLabel ? `${reward.name} (${reward.starLabel})` : reward.name;
}

export function getAvailableRewards(
  level: number,
  machine: MadnessMachineDefinition = madnessMachine,
): MadnessReward[] {
  const maxResearch = getMaxResearchForLevel(level);
  return machine.rewards.filter((reward) => {
    if (reward.odds <= 0) return false;
    if (reward.isSuperJackpot) return true;
    if (reward.research == null) return true;
    return reward.research <= maxResearch;
  });
}

export function getTotalWeightForLevel(
  level: number,
  machine: MadnessMachineDefinition = madnessMachine,
): number {
  return getAvailableRewards(level, machine).reduce((sum, reward) => sum + reward.odds, 0);
}

export function getRewardChanceForLevel(
  reward: MadnessReward,
  level: number,
  machine: MadnessMachineDefinition = madnessMachine,
): number {
  const available = getAvailableRewards(level, machine);
  const total = available.reduce((sum, item) => sum + item.odds, 0);
  if (!total) return 0;
  const target = available.find((item) => item.rewardId === reward.rewardId);
  if (!target) return 0;
  return target.odds / total;
}

export function getRewardChances(
  level: number,
  machine: MadnessMachineDefinition = madnessMachine,
): MadnessRewardChance[] {
  const rewards = getAvailableRewards(level, machine).filter(
    (reward) => reward.type === 'entity',
  );
  const total = rewards.reduce((sum, reward) => sum + reward.odds, 0);
  return rewards
    .map((reward) => ({
      ...reward,
      chance: total > 0 ? reward.odds / total : 0,
      label: getRewardLabel(reward),
    }))
    .sort((a, b) => b.chance - a.chance);
}

export function getResearchChanceBreakdown(
  level: number,
  machine: MadnessMachineDefinition = madnessMachine,
): MadnessResearchChance[] {
  const rewards = getRewardChances(level, machine);
  const groups = new Map<MadnessResearchKey, MadnessResearchChance>();
  let totalOdds = 0;

  for (const reward of rewards) {
    const key = getResearchKey(reward);
    const existing = groups.get(key);
    if (existing) {
      existing.totalOdds += reward.odds;
      existing.rewards.push(reward);
    } else {
      groups.set(key, {
        key,
        label: getResearchLabel(key),
        totalOdds: reward.odds,
        chance: 0,
        rewards: [reward],
      });
    }
    totalOdds += reward.odds;
  }

  const result: MadnessResearchChance[] = [];
  for (const entry of groups.values()) {
    entry.chance = totalOdds > 0 ? entry.totalOdds / totalOdds : 0;
    entry.rewards.sort((a, b) => b.chance - a.chance);
    result.push(entry);
  }

  return result.sort((a, b) => {
    const order = (value: MadnessResearchKey): number => {
      if (value === 'jackpot') return -1;
      if (value === 'special') return Number.MAX_SAFE_INTEGER;
      return value;
    };
    return order(a.key) - order(b.key);
  });
}

function buildSimulationContext(
  input: MadnessSimulationInput,
  machine: MadnessMachineDefinition,
  options: MadnessSimulationOptions,
): MadnessSimulationContext {
  const { level, tokenSpins, goldSpins } = input;
  const available = getAvailableRewards(level, machine);
  if (!available.length) {
    throw new Error('Нет доступных наград для заданного уровня.');
  }

  const weightedRewards: WeightedReward[] = [];
  const chanceMap = new Map<number, number>();
  const researchChanceMap = new Map<MadnessResearchKey, number>();

  let cumulative = 0;
  let entityTotalWeight = 0;
  for (const reward of available) {
    cumulative += reward.odds;
    weightedRewards.push({ reward, cumulative });
    if (reward.type === 'entity') {
      entityTotalWeight += reward.odds;
    }
  }

  const totalWeight = cumulative;

  for (const reward of available) {
    const chance = totalWeight > 0 ? reward.odds / totalWeight : 0;
    chanceMap.set(reward.rewardId, chance);

    if (reward.type === 'entity') {
      const researchKey = getResearchKey(reward);
      researchChanceMap.set(
        researchKey,
        (researchChanceMap.get(researchKey) ?? 0) + reward.odds,
      );
    }
  }

  const historySize = options.historySize ?? 20;
  const historyBuffer = historySize > 0 ? new Array<MadnessSpinSummary>(historySize) : [];

  return {
    weightedRewards,
    totalWeight,
    entityTotalWeight,
    level,
    tokenSpins,
    goldSpins,
    rewardMap: new Map(),
    researchMap: new Map(),
    chanceMap,
    researchChanceMap,
    historyBuffer,
    historySize,
    historyCount: 0,
    lastHistoryIndex: -1,
    baseTimestamp: Date.now(),
    jackpotCount: 0,
    totalSpins: tokenSpins + goldSpins,
  };
}

function selectReward(ctx: MadnessSimulationContext, randomFn: () => number): MadnessReward {
  if (ctx.totalWeight <= 0) {
    return ctx.weightedRewards[0].reward;
  }
  const target = randomFn() * ctx.totalWeight;
  for (const entry of ctx.weightedRewards) {
    if (target <= entry.cumulative) {
      return entry.reward;
    }
  }
  return ctx.weightedRewards[ctx.weightedRewards.length - 1].reward;
}

function recordHistory(
  ctx: MadnessSimulationContext,
  reward: MadnessReward,
  currency: MadnessCurrency,
  index: number,
): void {
  if (ctx.historySize <= 0) return;
  const summary: MadnessSpinSummary = {
    reward,
    label: getRewardLabel(reward),
    icon: reward.icon,
    researchKey: getResearchKey(reward),
    currency,
    timestamp: ctx.baseTimestamp + index,
  };

  const slot = index % ctx.historySize;
  ctx.historyBuffer[slot] = summary;
  ctx.lastHistoryIndex = slot;
  if (ctx.historyCount < ctx.historySize) {
    ctx.historyCount += 1;
  }
}

function ensureRewardAggregate(
  ctx: MadnessSimulationContext,
  reward: MadnessReward,
): MadnessRewardAggregate {
  let aggregate = ctx.rewardMap.get(reward.rewardId);
  if (!aggregate) {
    aggregate = {
      reward,
      label: getRewardLabel(reward),
      icon: reward.icon,
      chance: ctx.chanceMap.get(reward.rewardId) ?? 0,
      count: 0,
      totalAmount: 0,
      currencyCounts: {
        token: 0,
        gold: 0,
      },
    };
    ctx.rewardMap.set(reward.rewardId, aggregate);
  }
  return aggregate;
}

function ensureResearchAggregate(
  ctx: MadnessSimulationContext,
  key: MadnessResearchKey,
): MadnessResearchAggregate {
  let aggregate = ctx.researchMap.get(key);
  if (!aggregate) {
    const totalOdds = ctx.researchChanceMap.get(key) ?? 0;
    const totalWeight = ctx.entityTotalWeight;
    aggregate = {
      key,
      label: getResearchLabel(key),
      chance: totalWeight > 0 ? totalOdds / totalWeight : 0,
      count: 0,
      totalAmount: 0,
    };
    ctx.researchMap.set(key, aggregate);
  }
  return aggregate;
}

function recordReward(
  ctx: MadnessSimulationContext,
  reward: MadnessReward,
  currency: MadnessCurrency,
  index: number,
): void {
  const aggregate = ensureRewardAggregate(ctx, reward);
  aggregate.count += 1;
  aggregate.totalAmount += reward.amount;
  aggregate.currencyCounts[currency] += 1;

  const researchKey = getResearchKey(reward);
  const researchAggregate = ensureResearchAggregate(ctx, researchKey);
  researchAggregate.count += 1;
  researchAggregate.totalAmount += reward.amount;

  if (reward.isSuperJackpot) {
    ctx.jackpotCount += 1;
  }

  recordHistory(ctx, reward, currency, index);
}

function finalizeSimulation(ctx: MadnessSimulationContext): MadnessSimulation {
  const rewardBreakdown = Array.from(ctx.rewardMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
    return (b.chance ?? 0) - (a.chance ?? 0);
  });

  const researchBreakdown = Array.from(ctx.researchMap.values()).sort((a, b) => {
    const order = (value: MadnessResearchKey): number => {
      if (value === 'jackpot') return -1;
      if (value === 'special') return Number.MAX_SAFE_INTEGER;
      return value;
    };
    return order(a.key) - order(b.key);
  });

  const history: MadnessSpinSummary[] = [];
  for (let i = 0; i < ctx.historyCount; i += 1) {
    const index = (ctx.lastHistoryIndex - i + ctx.historySize) % ctx.historySize;
    const entry = ctx.historyBuffer[index];
    if (entry) {
      history.push(entry);
    }
  }

  return {
    level: ctx.level,
    totalSpins: ctx.totalSpins,
    tokenSpins: ctx.tokenSpins,
    goldSpins: ctx.goldSpins,
    rewardBreakdown,
    researchBreakdown,
    history,
    jackpotCount: ctx.jackpotCount,
  };
}

export async function simulateMadnessAsync(
  input: MadnessSimulationInput,
  machine: MadnessMachineDefinition = madnessMachine,
  options: MadnessSimulationOptions = {},
): Promise<MadnessSimulation> {
  const { randomFn = Math.random, batchSize = 1800, onProgress, signal } = options;
  const ctx = buildSimulationContext(input, machine, options);
  const totalSpins = ctx.totalSpins;
  if (totalSpins <= 0) {
    return finalizeSimulation(ctx);
  }

  let completed = 0;
  let index = 0;

  const tokenSpins = ctx.tokenSpins;

  while (completed < totalSpins) {
    if (signal?.aborted) {
      throw new DOMException('Симуляция остановлена', 'AbortError');
    }

    const spinsThisBatch = Math.min(batchSize, totalSpins - completed);

    for (let i = 0; i < spinsThisBatch; i += 1) {
      const reward = selectReward(ctx, randomFn);
      const currency: MadnessCurrency = index < tokenSpins ? 'token' : 'gold';
      recordReward(ctx, reward, currency, index);

      completed += 1;
      index += 1;
    }

    onProgress?.(completed, totalSpins);

    if (completed < totalSpins) {
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  if (completed < totalSpins) {
    onProgress?.(totalSpins, totalSpins);
  }

  return finalizeSimulation(ctx);
}

export function simulateMadness(
  input: MadnessSimulationInput,
  machine: MadnessMachineDefinition = madnessMachine,
  options: MadnessSimulationOptions = {},
): MadnessSimulation {
  const { randomFn = Math.random } = options;
  const ctx = buildSimulationContext(input, machine, options);
  const totalSpins = ctx.totalSpins;
  const tokenSpins = ctx.tokenSpins;

  for (let index = 0; index < totalSpins; index += 1) {
    const reward = selectReward(ctx, randomFn);
    const currency: MadnessCurrency = index < tokenSpins ? 'token' : 'gold';
    recordReward(ctx, reward, currency, index);
  }

  return finalizeSimulation(ctx);
}
