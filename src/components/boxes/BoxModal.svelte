<script lang="ts">
  import boxesData from '@/data/boxes.json'
  import { textureUrl } from '@/lib/texture-cdn'
  import { getMutantTexturePath, getRewardTexturePath, getRewardLabel, formatCurrencyAmount } from '@/lib/bingo-textures'
  import { getBoxName } from '@/lib/boxes-i18n'
  import { t, pluralizeCount, type Locale } from '@/lib/i18n'

  let {
    locale = 'ru' as Locale,
    names = {} as Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>,
  }: {
    locale?: Locale
    names?: Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>
  } = $props()

  // Тот же приём, что MutantsBrowser.svelte/TierList.svelte: id уже базовый
  // (см. boxes.json - lowercase specimen_*, без суффикса звезды).
  function displayMutantName(m: { id: string; name: string }): string {
    return names[m.id]?.name || m.name
  }

  interface BoxMutantRef {
    id: string
    name: string
    tier: string | null
    skin: string | null
  }
  interface BoxReward {
    name: string
    type: 'entity' | 'hardcurrency' | 'softcurrency'
    amount: number
  }
  interface BoxGroup {
    chance: number | null
    mutants: BoxMutantRef[]
    rewards: BoxReward[]
  }
  interface BoxPrice {
    amount: number
    type: 'hardcurrency' | 'softcurrency'
  }
  interface Box {
    itemId: string
    icon: string | null
    category: string
    name: string
    price: BoxPrice | null
    groups: BoxGroup[]
  }

  function formatPrice(price: BoxPrice | null): string | null {
    if (!price) return null
    return formatCurrencyAmount(price.amount, price.type, locale)
  }

  const boxes = boxesData as Box[]
  const boxByItemId = new Map(boxes.map((b) => [b.itemId, b]))

  const TIER_ICON: Record<string, string> = {
    'бронза': '/stars/star_bronze.webp',
    'серебро': '/stars/star_silver.webp',
    'золото': '/stars/star_gold.webp',
    'платина': '/stars/star_platinum.webp',
  }

  function mutantIcon(m: BoxMutantRef): string {
    const variant = (m.tier && ['бронза', 'серебро', 'золото', 'платина'].includes(m.tier)
      ? { 'бронза': 'bronze', 'серебро': 'silver', 'золото': 'gold', 'платина': 'platinum' }[m.tier]
      : 'normal') as 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
    return getMutantTexturePath(m.id, m.skin ?? '_any', variant)
  }

  function allMutants(b: Box): BoxMutantRef[] {
    return b.groups.flatMap((g) => g.mutants)
  }

  // Игра розыгрывает бокс по группам (не по плоскому списку статей) - Tag
  // key="option"/rand_X на ShopItem группирует несколько ArticleItem в ОДИН
  // атомарный исход (мутант + бонусный жетон выпадают вместе, это не два
  // независимых слота, см. Mystery_Anniversary26_1 - "Шанс 1 к 6" в тултипе
  // игры, а не 1 к 11 как посчитал бы наивный плоский пул). Схлопываем группы
  // с одинаковым содержимым (в боксах на сотни мутантов реальных групп может
  // быть меньше, чем кажется) суммированием их шанса.
  function groupedOutcomes(b: Box) {
    const map = new Map<string, { chance: number | null; mutants: BoxMutantRef[]; rewards: BoxReward[] }>()
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

  let open = $state(false)
  let box: Box | null = $state(null)
  let outcomes = $derived(box ? groupedOutcomes(box) : [])
  let guaranteed = $derived(outcomes.filter((o) => o.chance == null))
  let pool = $derived(outcomes.filter((o) => o.chance != null))
  let boxName = $derived(box ? getBoxName(box.itemId, locale, box.name) : '')

  function onOpen(e: Event) {
    const itemId = (e as CustomEvent).detail?.boxId as string | undefined
    if (!itemId) return
    const found = boxByItemId.get(itemId)
    if (!found) return
    box = found
    open = true
  }

  function close() {
    open = false
    box = null
  }

  function openMutant(specimenId: string) {
    window.dispatchEvent(new CustomEvent('archivist:open-mutant', { detail: { specimenId } }))
  }

  let escHandler: ((e: KeyboardEvent) => void) | null = null
  $effect(() => {
    window.addEventListener('archivist:open-box', onOpen)
    escHandler = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', escHandler)
    return () => {
      window.removeEventListener('archivist:open-box', onOpen)
      if (escHandler) window.removeEventListener('keydown', escHandler)
    }
  })
</script>

{#if open && box}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-start justify-center p-2 md:p-4 overflow-y-auto overscroll-contain"
    onclick={(e) => { if (e.target === e.currentTarget) close() }}
  >
    <div class="modal-panel w-full max-w-2xl mt-10 md:mt-20 mb-6 rounded-xl bg-slate-950 ring-1 ring-white/10 shadow-2xl" role="dialog" aria-modal="true" aria-label={boxName}>
      <div class="modal-head flex items-start gap-4 p-4 border-b border-white/10">
        {#if box.icon}
          <img class="box-icon" src={textureUrl(box.icon)} alt="" loading="lazy" decoding="async" />
        {/if}
        <div class="flex-1 min-w-0">
          {#if box.category}<div class="text-[11px] uppercase tracking-wide text-blue-300/80">{box.category === 'Лаки-бокс' ? t('boxes.category.lucky', locale) : box.category === 'Мистери-бокс' ? t('boxes.category.mystery', locale) : box.category}</div>{/if}
          <h2 class="text-lg font-bold text-white leading-snug break-words">{boxName}</h2>
          {#if formatPrice(box.price)}<div class="text-sm font-semibold text-amber-400 mt-0.5">{formatPrice(box.price)}</div>{/if}
          {#if allMutants(box).length}<div class="text-xs text-slate-400 mt-1">{t('boxes.mutantsInDropList', locale).replace('{n}', String(allMutants(box).length))}</div>{/if}
        </div>
        <button class="close-btn shrink-0" onclick={close} aria-label={t('boxes.closeAria', locale)}>&times;</button>
      </div>

      <div class="p-4 flex flex-col gap-4">
        {#if guaranteed.length}
          <div>
            <div class="section-title">{t('boxes.guaranteedTitle', locale)}</div>
            <div class="reward-row">
              {#each guaranteed as o, i (i)}
                {#each o.rewards as reward, j (j)}
                  <span class="reward-chip">
                    {#if getRewardTexturePath(reward)}
                      <img src={textureUrl(getRewardTexturePath(reward))} alt="" loading="lazy" decoding="async" />
                    {/if}
                    {getRewardLabel(reward, locale)}
                  </span>
                {/each}
                {#each o.mutants as m (m.id)}
                  <button class="reward-chip" onclick={() => openMutant(m.id)}>
                    {#if mutantIcon(m)}
                      <img src={textureUrl(mutantIcon(m))} alt="" loading="lazy" decoding="async" />
                    {/if}
                    {displayMutantName(m)}
                  </button>
                {/each}
              {/each}
            </div>
          </div>
        {/if}

        {#if pool.length}
          <div>
            {#if guaranteed.length}<div class="section-title">{t('boxes.drawTitle', locale)}</div>{/if}
            <div class="mutant-grid">
              {#each pool as o, i (i)}
                <div class="mutant-cell" class:multi={o.mutants.length + o.rewards.length > 1}>
                  <div class="cell-items">
                    {#each o.mutants as m (m.id)}
                      <button class="cell-item" onclick={() => openMutant(m.id)}>
                        <span class="mutant-cell-img">
                          {#if mutantIcon(m)}
                            <img src={textureUrl(mutantIcon(m))} alt="" loading="lazy" decoding="async" />
                          {/if}
                        </span>
                        <span class="mutant-cell-name">{displayMutantName(m)}</span>
                        {#if m.tier && TIER_ICON[m.tier]}
                          <img class="tier-icon" src={textureUrl(TIER_ICON[m.tier])} alt={m.tier} title={m.tier} loading="lazy" decoding="async" />
                        {/if}
                        {#if m.skin}
                          <span class="skin-text" title={t('boxes.skinTitle', locale).replace('{skin}', m.skin)}>{t('boxes.skinLabel', locale).replace('{skin}', m.skin)}</span>
                        {/if}
                      </button>
                    {/each}
                    {#each o.rewards as reward (reward.type + reward.name + reward.amount)}
                      <span class="cell-item cell-item-reward">
                        {#if getRewardTexturePath(reward)}
                          <img src={textureUrl(getRewardTexturePath(reward))} alt="" loading="lazy" decoding="async" />
                        {/if}
                        <span class="mutant-cell-name">{getRewardLabel(reward, locale)}</span>
                      </span>
                    {/each}
                  </div>
                  <span class="chance-text">{o.chance?.toFixed(1)}%</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .box-icon { width: 64px; height: 64px; object-fit: contain; border-radius: 10px; background: rgba(255,255,255,0.04); padding: 6px; }
  .close-btn { width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.06); color: #cbd5f5; font-size: 1.4rem; line-height: 1; border: none; cursor: pointer; }
  .close-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }

  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 0.5rem; }

  .reward-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .reward-chip { display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; padding: 0.25rem 0.6rem 0.25rem 0.3rem; font-size: 11.5px; color: #e2e8f0; }
  .reward-chip img { width: 20px; height: 20px; object-fit: contain; }
  button.reward-chip { appearance: none; cursor: pointer; font: inherit; }
  button.reward-chip:hover { background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.35); }

  .mutant-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 0.6rem; max-height: 50vh; overflow-y: auto; }

  .mutant-cell { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; padding: 0.5rem 0.35rem; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); text-align: center; }
  .mutant-cell.multi { background: rgba(96,165,250,0.05); border-color: rgba(96,165,250,0.15); }

  .cell-items { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: center; gap: 0.4rem; }
  .cell-item { display: flex; flex-direction: column; align-items: center; gap: 2px; background: none; border: none; padding: 0; cursor: pointer; text-align: center; }
  button.cell-item:hover .mutant-cell-name { color: #93c5fd; }
  button.cell-item:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
  .cell-item-reward { cursor: default; }

  .mutant-cell-img { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; }
  .mutant-cell-img img { width: 100%; height: 100%; object-fit: cover; }
  .cell-item-reward img { width: 28px; height: 28px; object-fit: contain; }

  .mutant-cell-name { font-size: 11px; color: #cbd5f5; line-height: 1.15; word-break: break-word; }

  .tier-icon { width: 14px; height: 14px; }
  .chance-text { font-size: 9.5px; font-weight: 600; color: #86efac; }
  .skin-text { font-size: 9px; color: #a5b4fc; word-break: break-word; }

  @media (min-width: 1440px) {
    .modal-panel { max-width: 48rem; }
    .box-icon { width: 80px; height: 80px; }
    .mutant-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.75rem; }
    .mutant-cell-img { width: 54px; height: 54px; }
    .mutant-cell-name { font-size: 12.5px; }
    .chance-text { font-size: 10.5px; }
  }
  @media (min-width: 1921px) {
    .modal-panel { max-width: 58rem; }
    .box-icon { width: 96px; height: 96px; }
    .mutant-grid { grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: 0.9rem; }
    .mutant-cell-img { width: 62px; height: 62px; }
    .mutant-cell-name { font-size: 14px; }
    .chance-text { font-size: 11.5px; }
  }

  @media (prefers-reduced-motion: no-preference) {
    .modal-panel { animation: modal-in 0.18s ease-out; }
  }
  @keyframes modal-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
</style>
