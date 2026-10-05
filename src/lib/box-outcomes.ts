// Общая логика исходов бокса: используется и модалкой (BoxModal.svelte), и
// страницей-постером (box-poster.astro), чтобы они не могли показать разные цифры.

export interface BoxMutantRef {
  id: string
  name: string
  tier: string | null
  skin: string | null
}
export interface BoxReward {
  name: string
  type: 'entity' | 'hardcurrency' | 'softcurrency'
  amount: number
}
export interface BoxGroup {
  chance: number | null
  mutants: BoxMutantRef[]
  rewards: BoxReward[]
}
export interface BoxPrice {
  amount: number
  type: 'hardcurrency' | 'softcurrency'
}
export interface Box {
  itemId: string
  icon: string | null
  category: string
  name: string
  price: BoxPrice | null
  groups: BoxGroup[]
}

export interface BoxOutcome {
  chance: number | null
  mutants: BoxMutantRef[]
  rewards: BoxReward[]
}

export const TIER_ICON: Record<string, string> = {
  бронза: '/stars/star_bronze.webp',
  серебро: '/stars/star_silver.webp',
  золото: '/stars/star_gold.webp',
  платина: '/stars/star_platinum.webp',
}

export const TIER_KEY: Record<string, 'bronze' | 'silver' | 'gold' | 'platinum'> = {
  бронза: 'bronze',
  серебро: 'silver',
  золото: 'gold',
  платина: 'platinum',
}

// Игра розыгрывает бокс по группам (не по плоскому списку статей) - Tag
// key="option"/rand_X на ShopItem группирует несколько ArticleItem в ОДИН
// атомарный исход (мутант + бонусный жетон выпадают вместе, это не два
// независимых слота, см. Mystery_Anniversary26_1 - "Шанс 1 к 6" в тултипе
// игры, а не 1 к 11 как посчитал бы наивный плоский пул). Схлопываем группы
// с одинаковым содержимым (в боксах на сотни мутантов реальных групп может
// быть меньше, чем кажется) суммированием их шанса.
export function groupedOutcomes(b: Box): BoxOutcome[] {
  const map = new Map<string, BoxOutcome>()
  for (const g of b.groups) {
    const key = [
      ...g.mutants.map((m) => `m:${m.id}|${m.tier ?? ''}|${m.skin ?? ''}`),
      ...g.rewards.map((r) => `r:${r.type}|${r.name}|${r.amount}`),
    ]
      .sort()
      .join(',')
    const existing = map.get(key)
    if (existing) {
      if (existing.chance != null && g.chance != null) existing.chance += g.chance
    } else {
      map.set(key, { chance: g.chance, mutants: g.mutants, rewards: g.rewards })
    }
  }
  return [...map.values()]
}

// Ряды постера: исходы с одинаковым шансом (округление до 4 знаков, иначе
// сырые float вроде 0.36855036... раскололи бы один уровень на десяток рядов).
// Ряды по убыванию шанса; у каждого - шанс одного исхода и суммарный шанс ряда.
export interface ChanceRow {
  chance: number
  total: number
  outcomes: BoxOutcome[]
}

export function chanceRows(outcomes: BoxOutcome[]): ChanceRow[] {
  const buckets = new Map<number, BoxOutcome[]>()
  for (const o of outcomes) {
    if (o.chance == null) continue
    const key = Math.round(o.chance * 10000) / 10000
    const list = buckets.get(key)
    if (list) list.push(o)
    else buckets.set(key, [o])
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([chance, list]) => ({
      chance,
      total: list.reduce((s, o) => s + (o.chance ?? 0), 0),
      outcomes: list,
    }))
}

// 20 -> "20%", 0.36855 -> "0.37%", 1.3513 -> "1.35%". Ниже 1% нужны 2 знака,
// иначе 0.37 и 0.61 схлопнутся в "0.4" и "0.6" и теряется смысл ряда.
export function formatChance(p: number): string {
  const digits = p >= 10 ? 1 : 2
  return `${p.toFixed(digits).replace(/\.?0+$/, '')}%`
}
