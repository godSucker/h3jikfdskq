// Резолвинг наград/данжей для /guides, вынесенный из guides.astro в общий
// модуль - используется и там, и в build-announcements.ts/finish-pending.ts
// (Фаза 2 авто-анонсов), чтобы announcements-карточки для рейдов/лесенок
// показывали ТЕ ЖЕ иконки/названия, что и activityCard на /guides, без
// второй независимой реализации, которая рано или поздно разъедется.
// Framework-agnostic: принимает уже построенные lookup-мапы, ничего сам не
// импортирует из JSON, поэтому одинаково работает и в Astro-фронтматтере
// (Vite), и в чистом tsx-скрипте вне Astro.

export interface MutantLite {
  id: string
  name: string
  genes: string[]
  icon: string
  fullArt: string
}

export interface MutantRaw {
  id: string
  name: string
  genes?: string[]
  stars: Record<string, { images?: string[]; multiplier?: number } | undefined>
}

export interface MaterialEntry {
  id: string
  name?: string
  texture?: string
}

export interface RewardRaw {
  type: string
  id?: string | null
  amount?: string | number | null
}

export interface ResolvedReward {
  label: string
  icon: string | null
  mutant?: MutantLite
}

export interface DungeonRaw {
  id: string
  name: string
  nameAuthored: boolean
  mutantId: string | null
  fightCount: number
  bossCount: number
  rewards: {
    currency: { softcurrency: number; hardcurrency: number; experience: number }
    items: { id: string; amount: number }[]
  }
}

export interface ResolvedDungeon {
  id: string
  name: string
  nameAuthored: boolean
  mutant: MutantLite | null
  fightCount: number
  bossCount: number
  currency: ResolvedReward[]
  items: ResolvedReward[]
}

export const STAR_ORDER = ['platinum', 'gold', 'silver', 'bronze', 'normal']

export function maxStar(m: MutantRaw): string {
  for (const key of STAR_ORDER) if (m.stars?.[key]) return key
  return 'normal'
}

export function mutantIcon(m: MutantRaw): string {
  const star = maxStar(m)
  const raw = m.stars?.[star]?.images?.[0]
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

function mutantFullArt(m: MutantRaw): string {
  const star = maxStar(m)
  const folder = m.id.replace(/^specimen_/, '')
  const suffix = star === 'normal' ? '' : `_${star}`
  return `/textures_by_mutant/${folder}/FULL_${folder}${suffix}.png`
}

export interface MutantNameEntry {
  name: string
}

// names - опционально: names.{lang}.json-совместимый лукап (см.
// src/lib/mutant-names-i18n.ts), не переданный announcements-render.ts
// (та страница всегда RU) - значит RU-поведение не меняется без него.
export function resolveMutantLite(
  id: string,
  mutantsById: Map<string, MutantRaw>,
  names?: Record<string, MutantNameEntry>,
): MutantLite | null {
  const m = mutantsById.get(id)
  if (!m) return null
  return {
    id: m.id,
    name: names?.[m.id]?.name || m.name,
    genes: m.genes ?? [],
    icon: mutantIcon(m),
    fullArt: mutantFullArt(m),
  }
}

function prettifyId(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\bHC\b/, '')
    .trim()
}

export interface RewardResolveCtx {
  mutantsById: Map<string, MutantRaw>
  materialsById: Map<string, MaterialEntry>
  translateItemId: (id: string) => string
  getItemTexture: (id: string) => string | null
  getLocalisedName: (id: string) => string | null
  getGeneIcon: (gene: string) => string | null
  geneRu: Record<string, string>
  // Опционально - без них поведение как раньше (RU-строки, ru-RU-числа).
  // announcements-render.ts их не передаёт (страница всегда RU), guides.astro
  // передаёт t()/formatNumber, привязанные к текущей локали.
  names?: Record<string, MutantNameEntry>
  t?: (key: string) => string
  formatNumber?: (n: number) => string
}

export function resolveReward(reward: RewardRaw | null, ctx: RewardResolveCtx): ResolvedReward {
  if (!reward) return { label: '—', icon: null }
  const amount = reward.amount ? String(reward.amount) : ''
  const amountSuffix = amount && amount !== '1' ? ` ×${amount}` : ''
  const getMaterialName = (id: string) => ctx.materialsById.get(id)?.name ?? null
  const getMaterialTexture = (id: string) => ctx.materialsById.get(id)?.texture ?? null
  const fmtN = ctx.formatNumber ?? ((n: number) => n.toLocaleString('ru-RU'))
  const tr = (key: string, fallback: string, vars: Record<string, string> = {}) => {
    let s = ctx.t ? ctx.t(key) : fallback
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v)
    return s
  }

  if (reward.type === 'softcurrency') {
    return {
      label: tr('guides.reward.silver', '{n} серебра', { n: fmtN(Number(amount)) }),
      icon: '/cash/softcurrency.webp',
    }
  }
  if (reward.type === 'hardcurrency') {
    return {
      label: tr('guides.reward.gold', '{n} золота', { n: fmtN(Number(amount)) }),
      icon: '/cash/hardcurrency.webp',
    }
  }
  if (reward.type === 'experience') {
    return {
      label: tr('guides.reward.experience', '{n} опыта', { n: fmtN(Number(amount)) }),
      icon: ctx.getItemTexture('Material_XP1000'),
    }
  }
  if (reward.type === 'custom' && reward.id?.startsWith('allele-')) {
    const gene = reward.id.split('-')[1]
    return {
      label: tr('guides.reward.opensGeneForBreeding', 'Открывает ген «{gene}» для скрещивания', {
        gene: ctx.geneRu[gene] ?? gene,
      }),
      icon: ctx.getGeneIcon(gene),
    }
  }
  if (reward.type === 'entity' && reward.id) {
    if (reward.id.startsWith('Specimen_')) {
      const m = resolveMutantLite(reward.id.toLowerCase(), ctx.mutantsById, ctx.names)
      if (m) return { label: m.name, icon: m.icon, mutant: m }
      return { label: ctx.translateItemId(reward.id), icon: null }
    }
    if (reward.id.startsWith('Habitat_') || reward.id.startsWith('Building_')) {
      const match = reward.id.match(/_(\d+)_HC$/)
      const size = match ? Number(match[1]) + 1 : null
      // ctx.translateItemId - locale-aware (materials-i18n.ts, покрывает
      // building.json id вида Building_Hospital_1 напрямую, см. BUILDING_KEY_MAP
      // в build-materials-i18n.ts) - предпочтительнее голого prettifyId,
      // который раньше молча срабатывал для не-_HC-suffix зданий на всех
      // не-RU языках (баг, пойман на аудите 2026-08-17).
      const label =
        ctx.getLocalisedName(reward.id) ??
        (size
          ? tr('guides.reward.luxZone', 'Люкс-зона x{n}', { n: String(size) })
          : ctx.translateItemId(reward.id))
      return { label, icon: null }
    }
    const ephemeralMatch = reward.id.match(/^(.+)_ephemeral_(\d+)$/)
    if (ephemeralMatch) {
      const [, baseId, charges] = ephemeralMatch
      const baseName =
        ctx.getLocalisedName(reward.id) ??
        ctx.getLocalisedName(baseId) ??
        getMaterialName(baseId) ??
        ctx.translateItemId(baseId)
      return {
        label: `${baseName} ${tr('guides.reward.chargeSuffix', '(заряд {n})', { n: charges })}${amountSuffix}`,
        icon: ctx.getItemTexture(baseId) ?? getMaterialTexture(baseId),
      }
    }
    return {
      label: `${ctx.getLocalisedName(reward.id) ?? getMaterialName(reward.id) ?? ctx.translateItemId(reward.id)}${amountSuffix}`,
      icon: ctx.getItemTexture(reward.id) ?? getMaterialTexture(reward.id),
    }
  }
  return { label: '—', icon: null }
}

export function resolveCurrencySummary(
  currency: DungeonRaw['rewards']['currency'],
  ctx: RewardResolveCtx,
): ResolvedReward[] {
  const out: ResolvedReward[] = []
  if (currency.softcurrency)
    out.push(resolveReward({ type: 'softcurrency', amount: currency.softcurrency }, ctx))
  if (currency.hardcurrency)
    out.push(resolveReward({ type: 'hardcurrency', amount: currency.hardcurrency }, ctx))
  if (currency.experience)
    out.push(resolveReward({ type: 'experience', amount: currency.experience }, ctx))
  return out
}

export function resolveItemList(
  items: { id: string; amount: number }[],
  ctx: RewardResolveCtx,
): ResolvedReward[] {
  return items.map((it) => resolveReward({ type: 'entity', id: it.id, amount: it.amount }, ctx))
}

export function resolveDungeon(d: DungeonRaw, ctx: RewardResolveCtx): ResolvedDungeon {
  return {
    id: d.id,
    name: d.name,
    nameAuthored: d.nameAuthored,
    mutant: d.mutantId
      ? resolveMutantLite(d.mutantId.toLowerCase(), ctx.mutantsById, ctx.names)
      : null,
    fightCount: d.fightCount,
    bossCount: d.bossCount,
    currency: resolveCurrencySummary(d.rewards.currency, ctx),
    items: resolveItemList(d.rewards.items, ctx),
  }
}
