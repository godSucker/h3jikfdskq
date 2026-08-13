<script lang="ts">
  import toplistsData from '@/data/mutants/toplists.json'
  import { textureUrl } from '@/lib/texture-cdn'
  import { ABILITY_RU, STAR_LABEL } from '@/lib/mutant-dicts'
  import { STAR_ICONS } from '@/lib/mutant-icons'

  interface RankEntry {
    id: string
    name: string
    star: string
    icon: string
    value: number
    pct?: number
  }
  interface LevelBucket {
    atk1: RankEntry[]
    atk2: RankEntry[]
    hp: RankEntry[]
    speed: RankEntry[]
    silver: RankEntry[]
    abilities: Record<string, RankEntry[]>
  }
  interface Snapshot {
    id: string
    label: string
    levels: Record<'1' | '30', LevelBucket>
  }

  const snapshots = toplistsData as unknown as Snapshot[]

  const PLUS_ABILITIES = [
    'ability_shield_plus',
    'ability_regen_plus',
    'ability_retaliate_plus',
    'ability_slash_plus',
    'ability_strengthen_plus',
    'ability_weaken_plus',
  ]

  const CATEGORIES: { key: string; label: string; unit?: string }[] = [
    { key: 'atk1', label: 'Атака (одиночная)' },
    { key: 'atk2', label: 'Атака (массовая)' },
    { key: 'hp', label: 'ХП' },
    { key: 'speed', label: 'Скорость' },
    { key: 'silver', label: 'Серебро' },
    ...PLUS_ABILITIES.map((k) => ({ key: k, label: ABILITY_RU[k] ?? k })),
  ]

  let selectedCategory = $state('atk1')
  let selectedLevel: '1' | '30' = $state('30')
  let sortDir: 'top' | 'bottom' = $state('top')
  let selectedDate = $state(snapshots[0].id)
  let visibleCount = $state(20)

  const isAbilityCategory = $derived(selectedCategory.startsWith('ability_'))

  const currentSnapshot = $derived(snapshots.find((s) => s.id === selectedDate) ?? snapshots[0])

  const rawList = $derived.by(() => {
    const bucket = currentSnapshot.levels[selectedLevel]
    return isAbilityCategory ? bucket.abilities[selectedCategory] : (bucket as any)[selectedCategory]
  })

  const orderedList = $derived.by(() => {
    const list: RankEntry[] = rawList ?? []
    return sortDir === 'top' ? list : [...list].reverse()
  })

  const isUnavailable = $derived(orderedList.length === 0)

  // Серебро - это плоский показатель прокачки (silver = base * level), а не
  // боевая эффективность: "худший по серебру" всегда будет тривиально самым
  // низкоуровневым стартовым мутантом - неинформативно, поэтому анти-топ для
  // этой категории не показываем и форсим "Лучшие" при переключении на неё.
  const bottomAllowed = $derived(selectedCategory !== 'silver')

  $effect(() => {
    // При смене категории/уровня/даты/направления сбрасываем пагинацию сверху.
    void selectedCategory
    void selectedLevel
    void selectedDate
    visibleCount = 20
    if (selectedCategory === 'silver') sortDir = 'top'
  })

  function openMutant(specimenId: string) {
    window.dispatchEvent(new CustomEvent('archivist:open-mutant', { detail: { specimenId } }))
  }

  function fmt(n: number): string {
    return n.toLocaleString('ru-RU')
  }
</script>

<div class="toolbar">
  <div class="cat-tabs" role="tablist">
    {#each CATEGORIES as c (c.key)}
      <button
        class="cat-tab"
        class:active={selectedCategory === c.key}
        onclick={() => (selectedCategory = c.key)}
      >
        {c.label}
      </button>
    {/each}
  </div>

  <div class="controls-row">
    <div class="pill-group" role="tablist" aria-label="Уровень">
      <button class="pill" class:active={selectedLevel === '1'} onclick={() => (selectedLevel = '1')}>Ур. 1</button>
      <button class="pill" class:active={selectedLevel === '30'} onclick={() => (selectedLevel = '30')}>Ур. 30</button>
    </div>

    <div class="pill-group" role="tablist" aria-label="Направление">
      <button class="pill" class:active={sortDir === 'top'} onclick={() => (sortDir = 'top')}>Лучшие</button>
      <button
        class="pill"
        class:active={sortDir === 'bottom'}
        disabled={!bottomAllowed}
        title={bottomAllowed ? '' : 'Серебро — плоский показатель уровня, анти-топ по нему неинформативен'}
        onclick={() => bottomAllowed && (sortDir = 'bottom')}
      >
        Худшие
      </button>
    </div>

    {#if snapshots.length > 1}
      <select class="date-select" bind:value={selectedDate}>
        {#each snapshots as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>
    {/if}
  </div>
</div>

{#if isUnavailable}
  <p class="unavailable-note">
    Для уровня 1 история изменений в этой категории пока не отслеживалась — точные прошлые значения
    появятся только после следующего ребаланса. Доступны только текущие данные.
  </p>
{:else}
  <ol class="rank-list">
    {#each orderedList.slice(0, visibleCount) as entry, i (entry.id)}
      <li class="rank-row">
        <button class="rank-btn" onclick={() => openMutant(entry.id)}>
          <span class="rank-num">{i + 1}</span>
          <span class="rank-icon">
            {#if entry.icon}
              <img src={textureUrl(entry.icon)} alt="" loading="lazy" decoding="async" />
            {/if}
          </span>
          <span class="rank-name">{entry.name}</span>
          <span class="rank-star">
            <img src={textureUrl(STAR_ICONS[entry.star])} alt={STAR_LABEL[entry.star] ?? entry.star} title={STAR_LABEL[entry.star] ?? entry.star} loading="lazy" decoding="async" />
          </span>
          {#if isAbilityCategory && entry.pct != null}
            <span class="rank-pct">{entry.pct}%</span>
          {/if}
          <span class="rank-value">{fmt(entry.value)}</span>
        </button>
      </li>
    {/each}
  </ol>

  {#if visibleCount < orderedList.length}
    <button class="load-more" onclick={() => (visibleCount += 40)}>
      Показать ещё ({orderedList.length - visibleCount})
    </button>
  {/if}
{/if}

<style>
  .toolbar { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.25rem; }

  .cat-tabs { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .cat-tab {
    appearance: none; border: 1px solid rgba(48, 54, 61, 0.6); background: rgba(22, 27, 34, 0.9);
    color: #94a3b8; border-radius: 8px; padding: 0.45rem 0.85rem; font-size: 0.82rem; font-weight: 600; cursor: pointer;
  }
  .cat-tab:hover { background: rgba(30, 58, 138, 0.2); color: #fff; }
  .cat-tab.active { background: rgba(30, 58, 138, 0.4); color: #60a5fa; border-color: rgba(96,165,250,0.4); }

  .controls-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
  .pill-group { display: inline-flex; border: 1px solid rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden; }
  .pill { appearance: none; border: none; background: rgba(15, 23, 42, 0.7); color: #94a3b8; padding: 0.4rem 0.9rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
  .pill.active { background: rgba(59, 130, 246, 0.35); color: #fff; }

  .pill:disabled { opacity: 0.35; cursor: not-allowed; }

  .date-select {
    background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
    padding: 0.4rem 0.7rem; color: #e2e8f0; font-size: 0.82rem;
  }

  .unavailable-note { color: #94a3b8; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 1rem; font-size: 0.88rem; line-height: 1.5; }

  /* Список рангов - grid, а не одна узкая колонка: на широких экранах одна
     колонка оставляла огромные пустые поля по бокам. */
  .rank-list {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(17.5rem, 1fr)); gap: 0.5rem;
  }

  .rank-btn {
    display: flex; align-items: center; gap: 0.6rem; width: 100%; height: 100%; text-align: left;
    background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;
    padding: 0.5rem 0.65rem; cursor: pointer;
  }
  .rank-btn:hover { background: rgba(30, 41, 59, 0.85); border-color: rgba(96,165,250,0.3); }
  .rank-btn:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }

  .rank-num { width: 1.6rem; flex-shrink: 0; font-weight: 700; color: #64748b; font-size: 0.85rem; text-align: center; }
  .rank-icon { width: 40px; height: 40px; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; }
  .rank-icon img { width: 100%; height: 100%; object-fit: cover; }
  .rank-name { flex: 1 1 auto; min-width: 0; color: #e2e8f0; font-size: 0.86rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-star { width: 16px; height: 16px; flex-shrink: 0; }
  .rank-star img { width: 100%; height: 100%; object-fit: contain; }
  .rank-pct { flex-shrink: 0; font-size: 0.74rem; color: #a5b4fc; font-weight: 600; }
  .rank-value { flex-shrink: 0; min-width: 4rem; text-align: right; font-variant-numeric: tabular-nums; color: #86efac; font-weight: 700; font-size: 0.88rem; }

  .load-more {
    display: block; margin: 1rem auto 0; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(96,165,250,0.35);
    color: #93c5fd; border-radius: 8px; padding: 0.5rem 1.2rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  .load-more:hover { background: rgba(59, 130, 246, 0.28); }

  @media (min-width: 1440px) {
    .rank-list { grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: 0.65rem; }
    .rank-icon { width: 46px; height: 46px; }
    .rank-name { font-size: 0.92rem; }
    .rank-value { font-size: 0.95rem; }
  }
  @media (min-width: 1921px) {
    .rank-list { grid-template-columns: repeat(auto-fill, minmax(22.5rem, 1fr)); gap: 0.8rem; }
    .rank-icon { width: 52px; height: 52px; }
    .rank-name { font-size: 1rem; }
    .rank-value { font-size: 1.02rem; }
  }
</style>
