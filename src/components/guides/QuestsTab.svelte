<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn'
  import { normalizeSearch } from '@/lib/search-normalize'
  import { t, pluralizeCount, type Locale } from '@/lib/i18n'
  import { buildQuestChains, type QuestNode, type QuestChain } from '@/lib/guides-chains'

  interface MutantLite { id: string; name: string; genes: string[]; icon: string; fullArt?: string }
  interface QuestReward { label: string; icon: string | null; mutant?: MutantLite }
  type TriggerCategory = 'battle' | 'pvp' | 'craft' | 'breeding' | 'incubation' | 'building' | 'level' | 'collection' | 'social' | 'misc'
  interface Quest {
    id: string
    title: string
    caption: string
    rewards: QuestReward[]
    chainType: 'story' | 'achievement'
    prevId: string | null
    trigger: { category: TriggerCategory; amount: number | null }
    icon: string | null
  }

  // Реальные quest_*-иконки (s-ak.kobojo.com/assets/mobile/icon-quest/, найдено
  // живым Frida-захватом 2026-08-25 - см. build-quests.ts) - скачаны и залиты
  // на CDN, полное покрытие подтверждено (97/97 нужных на момент захвата).
  // Не allowlist - просто пробуем файл, onerror молча переключает на
  // SVG-иконку категории триггера (страхует будущие новые квесты с ещё
  // недокачанной иконкой, не ломает вёрстку битой картинкой).
  let failedStoryIcons = $state<Set<string>>(new Set())
  function storyIconUrl(icon: string | null): string | null {
    return icon && !failedStoryIcons.has(icon) ? `/quests/story/${icon}.png` : null
  }
  function onStoryIconError(icon: string | null) {
    if (!icon) return
    failedStoryIcons = new Set(failedStoryIcons).add(icon)
  }

  let { locale = 'ru' as Locale, quests = [] }: { locale?: Locale; quests: Quest[] } = $props()

  function openMutant(specimenId: string) {
    window.dispatchEvent(new CustomEvent('archivist:open-mutant', { detail: { specimenId } }))
  }

  let query = $state('')
  let filterType = $state<'all' | 'story' | 'achievement'>('all')
  let expandedIds = $state<Set<string>>(new Set())

  function toggleChain(rootId: string) {
    const next = new Set(expandedIds)
    if (next.has(rootId)) next.delete(rootId)
    else next.add(rootId)
    expandedIds = next
  }

  const chains = $derived(buildQuestChains(quests) as QuestChain<Quest>[])
  const normalizedQuery = $derived(normalizeSearch(query))

  function nodeMatches(node: QuestNode<Quest>): boolean {
    const q = normalizedQuery
    if (normalizeSearch(node.quest.title).includes(q) || normalizeSearch(node.quest.caption).includes(q)) return true
    return node.children.some(nodeMatches)
  }

  const visibleChains = $derived(
    chains.filter((c) => {
      if (filterType !== 'all' && c.chainType !== filterType) return false
      if (!normalizedQuery) return true
      return c.roots.some(nodeMatches)
    }),
  )

  function isExpanded(chain: QuestChain<Quest>): boolean {
    return normalizedQuery.length > 0 || expandedIds.has(chain.roots[0].quest.id)
  }

  function stageCount(n: number): string {
    return `${n} ${pluralizeCount(n, locale, 'guides.count.stage')}`
  }

  // Тиры ачивки берутся в порядке дерева (prevMissions уже кодирует верную
  // прогрессию тиров). Сортировка по trigger.amount была бы ОШИБКОЙ - amount
  // в игровых данных для тиров 2+ это ПРИРАЩЕНИЕ от предыдущего тира, а не
  // абсолютный порог (тир "25" на самом деле amount=20, т.к. 5 уже набрано
  // тиром 1) - подтверждено на 81 из 131 квестов ачивок, где amount не
  // совпадает с числом в уже переведённой caption. Абсолютный порог для
  // игрока - то, что написано в caption, отдельно не показываем.
  function achievementTiers(chain: QuestChain<Quest>): Quest[] {
    const all: Quest[] = []
    function walk(node: QuestNode<Quest>) {
      all.push(node.quest)
      for (const c of node.children) walk(c)
    }
    for (const r of chain.roots) walk(r)
    return all
  }
</script>

{#snippet triggerIcon(category: TriggerCategory)}
  <span class="trigger-icon trigger-{category}" title={t(`guides.quests.triggerCategory.${category}`, locale)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      {#if category === 'battle'}
        <line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" />
      {:else if category === 'pvp'}
        <path d="M4 12 L10 6 L10 18 Z" /><path d="M20 12 L14 6 L14 18 Z" />
      {:else if category === 'craft'}
        <line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" />
      {:else if category === 'breeding'}
        <circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" />
      {:else if category === 'incubation'}
        <ellipse cx="12" cy="13" rx="6" ry="8" />
      {:else if category === 'building'}
        <path d="M4 20 L4 11 L12 4 L20 11 L20 20 Z" /><rect x="10" y="14" width="4" height="6" />
      {:else if category === 'level'}
        <path d="M6 15 L12 8 L18 15" />
      {:else if category === 'collection'}
        <rect x="4" y="9" width="16" height="11" rx="1" /><path d="M4 9 L12 4 L20 9" />
      {:else if category === 'social'}
        <rect x="4" y="10" width="16" height="10" /><line x1="12" y1="10" x2="12" y2="20" /><line x1="4" y1="14" x2="20" y2="14" />
      {:else}
        <circle cx="12" cy="12" r="7" />
      {/if}
    </svg>
  </span>
{/snippet}

{#snippet rewardChips(rewards: QuestReward[])}
  <div class="quest-node-rewards">
    {#each rewards as r, i (i)}
      {#if r.mutant}
        <button class="farmer-chip" onclick={() => openMutant(r.mutant!.id)}>
          {#if r.mutant.icon}<img src={textureUrl(r.mutant.icon)} alt="" loading="lazy" decoding="async" />{/if}
          <span>{r.mutant.name}</span>
        </button>
      {:else}
        <span class="reward-inline">
          {#if r.icon}<img src={textureUrl(r.icon)} alt="" loading="lazy" decoding="async" />{/if}
          {r.label}
        </span>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet questNode(node: QuestNode<Quest>)}
  <div class="quest-node">
    <div class="quest-node-card">
      <div class="quest-node-header">
        {#if storyIconUrl(node.quest.icon)}
          <img
            src={textureUrl(storyIconUrl(node.quest.icon))}
            alt=""
            class="quest-node-icon"
            loading="lazy"
            decoding="async"
            onerror={() => onStoryIconError(node.quest.icon)}
          />
        {:else}
          {@render triggerIcon(node.quest.trigger.category)}
        {/if}
        <span class="quest-node-title">{node.quest.title}</span>
      </div>
      {#if node.quest.caption}<div class="quest-node-caption">{node.quest.caption}</div>{/if}
      {@render rewardChips(node.quest.rewards)}
    </div>
    {#if node.children.length > 0}
      <div class="quest-node-children" class:forked={node.children.length > 1}>
        {#each node.children as child (child.quest.id)}
          <div class="quest-branch">{@render questNode(child)}</div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="text-block">
  <p>{t('guides.intro.quests.p1', locale)}</p>
</div>

<div class="quest-toolbar">
  <input class="quest-search" type="search" placeholder={t('guides.quests.searchPlaceholder', locale)} bind:value={query} />
  <div class="quest-filters">
    <button class="filter-chip" class:active={filterType === 'all'} onclick={() => (filterType = 'all')}>{t('guides.quests.filterAll', locale)}</button>
    <button class="filter-chip" class:active={filterType === 'story'} onclick={() => (filterType = 'story')}>{t('guides.quests.filterStory', locale)}</button>
    <button class="filter-chip" class:active={filterType === 'achievement'} onclick={() => (filterType = 'achievement')}>{t('guides.quests.filterAchievements', locale)}</button>
  </div>
</div>

<div class="chain-list">
  {#each visibleChains as chain (chain.roots[0].quest.id)}
    {#if chain.chainType === 'achievement'}
      {@const root = chain.roots[0].quest}
      <div class="chain-card achievement-chain">
        <div class="chain-card-header">
          {#if root.icon}
            <img src={textureUrl(`/quests/achievements/${root.icon}.png`)} alt="" class="achievement-chain-icon" loading="lazy" decoding="async" />
          {:else}
            {@render triggerIcon(root.trigger.category)}
          {/if}
          <div class="chain-card-heading">
            <span class="chain-card-title">{root.title}</span>
            <span class="chain-card-meta">{stageCount(chain.size)}</span>
          </div>
        </div>
        <div class="tier-list">
          {#each achievementTiers(chain) as tier, i (tier.id)}
            <div class="tier-row">
              <span class="tier-index">{i + 1}</span>
              <span class="tier-caption">{tier.caption}</span>
              {@render rewardChips(tier.rewards)}
            </div>
          {/each}
        </div>
      </div>
    {:else}
      {@const root = chain.roots[0].quest}
      <div class="chain-card story-chain">
        <button class="chain-card-header chain-card-header-btn" onclick={() => toggleChain(root.id)}>
          {#if storyIconUrl(root.icon)}
            <img
              src={textureUrl(storyIconUrl(root.icon))}
              alt=""
              class="quest-node-icon"
              loading="lazy"
              decoding="async"
              onerror={() => onStoryIconError(root.icon)}
            />
          {:else}
            {@render triggerIcon(root.trigger.category)}
          {/if}
          <div class="chain-card-heading">
            <span class="chain-card-title">{root.title}</span>
            <span class="chain-card-meta">{stageCount(chain.size)}</span>
          </div>
          <span class="chain-toggle" class:open={isExpanded(chain)}>▾</span>
        </button>
        {#if isExpanded(chain)}
          <div class="chain-tree">
            {#each chain.roots as r (r.quest.id)}
              {@render questNode(r)}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/each}

  {#if !visibleChains.length}
    <p class="soon-block">{t('guides.emptyState', locale)}</p>
  {/if}
</div>

<style>
  .text-block { color: #cbd5f5; font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.25rem; max-width: 900px; }
  .text-block p { margin: 0 0 0.75rem; }

  .quest-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
  .quest-search {
    flex: 1 1 240px; min-width: 200px; padding: 0.45rem 0.7rem;
    background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
    color: #e2e8f0; font-size: 0.85rem;
  }
  .quest-search:focus { outline: none; border-color: rgba(96,165,250,0.4); }
  .quest-filters { display: flex; gap: 6px; }
  .filter-chip {
    padding: 6px 14px; border-radius: 999px; border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(15, 23, 42, 0.5); color: #94a3b8; font-size: 0.8rem; font-weight: 600; cursor: pointer;
    transition: all 0.15s;
  }
  .filter-chip:hover { border-color: rgba(96, 165, 250, 0.4); color: #cbd5e1; }
  .filter-chip.active { background: rgba(59, 130, 246, 0.18); border-color: rgba(96, 165, 250, 0.5); color: #e2e8f0; }

  .chain-list { display: flex; flex-direction: column; gap: 10px; }
  .chain-card { border-radius: 12px; background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(148, 163, 184, 0.15); overflow: hidden; }

  .chain-card-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
  .chain-card-header-btn { width: 100%; background: none; border: none; cursor: pointer; text-align: left; }
  .chain-card-header-btn:hover { background: rgba(255, 255, 255, 0.03); }
  .chain-card-heading { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .chain-card-title { font-size: 0.9rem; font-weight: 700; color: #e2e8f0; }
  .chain-card-meta { font-size: 0.72rem; color: #64748b; }
  .chain-toggle { color: #64748b; transition: transform 0.15s; font-size: 0.8rem; }
  .chain-toggle.open { transform: rotate(180deg); }

  .achievement-chain-icon { width: 44px; height: 44px; object-fit: contain; flex-shrink: 0; border-radius: 8px; }

  .trigger-icon { display: inline-flex; width: 30px; height: 30px; flex-shrink: 0; color: #7dd3fc; opacity: 0.85; }
  .quest-node-icon { width: 30px; height: 30px; object-fit: contain; flex-shrink: 0; border-radius: 5px; }
  .trigger-icon svg { width: 100%; height: 100%; }

  .tier-list { display: flex; flex-direction: column; gap: 4px; padding: 0 14px 12px; }
  .tier-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.03); flex-wrap: wrap; }
  .tier-index {
    display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0;
    border-radius: 50%; background: rgba(125, 211, 252, 0.15); color: #7dd3fc; font-weight: 700; font-size: 0.72rem;
  }
  .tier-caption { flex: 1; min-width: 140px; font-size: 0.8rem; color: #cbd5e1; }

  .chain-tree { padding: 0 14px 14px; border-top: 1px solid rgba(148, 163, 184, 0.1); }
  .quest-node { padding-top: 12px; }
  .quest-node-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 10px 12px; }
  .quest-node-header { display: flex; align-items: center; gap: 8px; }
  .quest-node-title { font-size: 0.85rem; font-weight: 700; color: #e2e8f0; }
  .quest-node-caption { font-size: 0.78rem; color: #94a3b8; margin-top: 4px; line-height: 1.4; }
  .quest-node-rewards { display: flex; flex-wrap: wrap; gap: 5px 8px; margin-top: 8px; }

  .farmer-chip { display: inline-flex; align-items: center; gap: 0.35rem; background: transparent; border: none; color: #e2e8f0; font-size: 0.78rem; font-weight: 600; cursor: pointer; padding: 1px 0; text-align: left; }
  .farmer-chip:hover { color: #60a5fa; }
  .farmer-chip img { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; }
  .reward-inline { display: inline-flex; align-items: center; gap: 5px; font-size: 0.75rem; color: #86efac; }
  .reward-inline img { width: 18px; height: 18px; object-fit: contain; }
  .soon-block { color: #64748b; padding: 2rem 0; text-align: center; font-size: 0.9rem; }

  /* Отступ/линия-коннектор растут ТОЛЬКО в реальных точках ветвления (5 из 297
     квестов) - без .forked это просто следующий шаг линейной цепочки, без
     дополнительного margin/padding/border. Раньше отступ копился на КАЖДОМ шаге
     подряд (даже линейном) - 46-шаговая цепочка к концу схлопывала карточки
     до ~150px (46 * 32px отступа), текст расползался по одному слову в строку. */
  .quest-node-children { display: flex; flex-direction: column; }
  .quest-node-children.forked { flex-direction: row; gap: 12px; align-items: flex-start; margin-left: 16px; padding-left: 16px; border-left: 2px solid rgba(148, 163, 184, 0.18); }
  .quest-node-children.forked .quest-branch { flex: 1 1 0; min-width: 0; }

  @media (max-width: 640px) {
    .quest-node-children.forked { flex-direction: column; }
  }
</style>
