<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn';
  import { tick } from 'svelte';
  import type {
    MadnessMachineDefinition,
    MadnessRewardAggregate,
    MadnessSimulation,
  } from '@/lib/madness-machine';
  import {
    getMaxResearchForLevel,
    getResearchChanceBreakdown,
    getResearchLabel,
    madnessMachine,
    simulateMadnessAsync,
  } from '@/lib/madness-machine';
  import { t, type Locale } from '@/lib/i18n';

  // names - слайд {specimenId (lowercase): локализованное имя} только для
  // мутантов, реально встречающихся в machine.json, посчитанный на билде в
  // RouletteMadnessPage.astro. Раньше компонент сам импортировал
  // mutant-names-i18n.ts (все 8 языков x lore/atk-тексты) - клиентский чанк
  // раздулся до 2.2MB вместо ~70-170KB у соседних симуляторов (пойман сразу
  // после фикса, живой build + du -h dist/client/_astro/*.js).
  let { machine = madnessMachine, locale, names: mutantNames = {} }: { machine?: MadnessMachineDefinition; locale: Locale; names?: Record<string, string> } = $props();

  const discountOptions = [0, 50, 55, 60, 65, 70, 75, 80, 85, 90];

  let level = $state(1);
  let gold = $state(0);
  let tokens = $state(0);
  let discountValue = $state('0');

  let showOdds = $state(false);
  let isSimulating = $state(false);
  let error: string | null = $state(null);
  let result: MadnessSimulation | null = $state(null);

  let progress = $state(0);
  let completedSpins = $state(0);
  let controller: AbortController | null = $state(null);

  const numberFormatter = new Intl.NumberFormat('ru-RU');

  function formatNumber(value: number): string {
    return numberFormatter.format(Math.floor(value));
  }

  type ResourceSummaryKey =
    | 'consumables'
    | 'stars'
    | 'spheres'
    | 'boosters'
    | 'tokens'
    | 'mutants'
    | 'jackpots';

  interface ResourceSummaryDefinition {
    label: string;
    icon: string;
    metaLabel: string;
  }

  interface ResourceSummary extends ResourceSummaryDefinition {
    key: ResourceSummaryKey;
    count: number;
    totalAmount: number;
  }

  const resourceSummaryConfig: Record<ResourceSummaryKey, ResourceSummaryDefinition> = {
    consumables: {
      label: t('roulette.madness.resourceConsumables', locale),
      icon: '/med/normal_med.webp',
      metaLabel: t('roulette.madness.metaTotal', locale),
    },
    stars: {
      label: t('roulette.madness.resourceStars', locale),
      icon: '/stars/all_stars.webp',
      metaLabel: t('roulette.madness.metaTotal', locale),
    },
    spheres: {
      label: t('roulette.madness.resourceSpheres', locale),
      icon: '/orbs/basic/orb_slot.webp',
      metaLabel: t('roulette.madness.metaTotal', locale),
    },
    boosters: {
      label: t('roulette.madness.resourceBoosters', locale),
      icon: '/boosters/charm_xpx2_7.webp',
      metaLabel: t('roulette.madness.metaTotal', locale),
    },
    tokens: {
      label: t('roulette.madness.resourceTokens', locale),
      icon: '/materials/Material_Jackpot_Token.png',
      metaLabel: t('roulette.madness.metaTotal', locale),
    },
    mutants: {
      label: t('roulette.madness.resourceMutants', locale),
      icon: '/etc/icon_larva.webp',
      metaLabel: t('roulette.madness.metaDropped', locale),
    },
    jackpots: {
      label: t('roulette.madness.resourceJackpots', locale),
      icon: '/cash/jackpot.webp',
      metaLabel: t('roulette.madness.metaDropped', locale),
    },
  };

  const resourceSummaryOrder: ResourceSummaryKey[] = [
    'consumables',
    'stars',
    'spheres',
    'boosters',
    'tokens',
    'mutants',
    'jackpots',
  ];

  function detectResourceSummaryKey(entry: MadnessRewardAggregate): ResourceSummaryKey {
    const { reward, label } = entry;

    if (reward.isSuperJackpot) {
      return 'jackpots';
    }

    if (reward.id?.startsWith('Specimen')) {
      return 'mutants';
    }

    const slug = reward.slug?.toLowerCase() ?? '';
    const name = label.toLowerCase();

    if (
      name.includes('жетон') ||
      slug.includes('token') ||
      slug.includes('jackpot') ||
      slug.includes('reactor')
    ) {
      return 'tokens';
    }

    if (
      name.includes('сфер') ||
      name.includes('sphere') ||
      name.includes('орб') ||
      slug.includes('orb') ||
      slug.includes('sphere')
    ) {
      return 'spheres';
    }

    if (
      name.includes('бустер') ||
      name.includes('ускорител') ||
      name.includes('чарм') ||
      name.includes('booster') ||
      slug.includes('booster') ||
      slug.includes('charm')
    ) {
      return 'boosters';
    }

    if (
      name.includes('звёзд') ||
      name.includes('звезд') ||
      name.includes('звезда') ||
      name.includes('звезды') ||
      name.includes('star') ||
      slug.includes('star') ||
      slug.includes('elite')
    ) {
      return 'stars';
    }

    if (
      name.includes('апт') ||
      name.includes('опыт') ||
      name.includes('мутостерон') ||
      name.includes('серон') ||
      name.includes('стерон') ||
      name.includes('пропуск') ||
      name.includes('experience') ||
      slug.includes('med') ||
      slug.includes('mutoster') ||
      slug.includes('steroid') ||
      slug.includes('pass') ||
      slug.includes('consumable') ||
      slug.includes('xp')
    ) {
      return 'consumables';
    }

    return 'mutants';
  }

  function buildResourceSummaries(simulation: MadnessSimulation | null): ResourceSummary[] {
    const totals = new Map<ResourceSummaryKey, { count: number; totalAmount: number }>();

    if (simulation) {
      for (const entry of simulation.rewardBreakdown) {
        const key = detectResourceSummaryKey(entry);
        const current = totals.get(key) ?? { count: 0, totalAmount: 0 };
        current.count += entry.count;
        current.totalAmount += entry.totalAmount;
        totals.set(key, current);
      }

      const jackpotBucket = totals.get('jackpots') ?? { count: 0, totalAmount: 0 };
      if (simulation.jackpotCount > jackpotBucket.count) {
        jackpotBucket.count = simulation.jackpotCount;
        jackpotBucket.totalAmount = simulation.jackpotCount;
        totals.set('jackpots', jackpotBucket);
      }
    }

    return resourceSummaryOrder.map((key) => {
      const config = resourceSummaryConfig[key];
      const bucket = totals.get(key) ?? { count: 0, totalAmount: 0 };
      return {
        key,
        label: config.label,
        icon: config.icon,
        metaLabel: config.metaLabel,
        count: bucket.count,
        totalAmount: bucket.totalAmount,
      };
    });
  }

  function formatPercent(value: number, digits = 3): string {
    return `${(value * 100).toFixed(digits)}%`;
  }

  let discount = $derived(Number(discountValue));
  let multiplier = $derived(Math.max(0, (100 - discount) / 100));
  let goldCostPerSpin = $derived(Math.ceil(machine.cost * multiplier));
  let tokenCostPerSpin = $derived(Math.ceil(machine.tokenCost * multiplier));

  let maxResearch = $derived(getMaxResearchForLevel(level));
  let researchChances = $derived(getResearchChanceBreakdown(level, machine, locale, mutantNames));

  let tokenSpins = $derived(tokenCostPerSpin > 0 ? Math.floor(tokens / tokenCostPerSpin) : 0);
  let goldSpins = $derived(goldCostPerSpin > 0 ? Math.floor(gold / goldCostPerSpin) : 0);
  let totalSpins = $derived(tokenSpins + goldSpins);

  let tokenSpent = $derived(tokenSpins * tokenCostPerSpin);
  let goldSpent = $derived(goldSpins * goldCostPerSpin);
  let tokenRemaining = $derived(Math.max(tokens - tokenSpent, 0));
  let goldRemaining = $derived(Math.max(gold - goldSpent, 0));

  let jackpotChance = $derived(researchChances.find((entry) => entry.key === 'jackpot')?.chance ?? 0);
  let jackpotOddsRatio = $derived(jackpotChance > 0 ? 1 / jackpotChance : null);
  let resourceSummaries = $derived(buildResourceSummaries(result));
  let displayedResourceSummaries = $derived(resourceSummaries.filter((summary) =>
    summary.key === 'mutants' || summary.key === 'jackpots',
  ));

  function resetSimulation() {
    if (controller) {
      controller.abort();
      controller = null;
    }
    result = null;
    error = null;
    progress = 0;
    completedSpins = 0;
  }

  function stopSimulation() {
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  async function handleSimulate() {
    error = null;

    if (level < 1) {
      error = t('roulette.madness.errorLevel', locale);
      return;
    }

    if (!Number.isFinite(totalSpins) || totalSpins <= 0) {
      error = t('roulette.madness.errorResources', locale);
      return;
    }

    if (!Number.isFinite(level)) {
      error = t('roulette.madness.errorLevelInvalid', locale);
      return;
    }

    result = null;
    progress = 0;
    completedSpins = 0;
    isSimulating = true;
    controller = new AbortController();

    await tick();

    try {
      const simulation = await simulateMadnessAsync(
        { level, tokenSpins, goldSpins },
        machine,
        {
          historySize: 30,
          batchSize: 2000,
          signal: controller.signal,
          locale,
          names: mutantNames,
          onProgress(completed, total) {
            completedSpins = completed;
            progress = total > 0 ? Math.min(completed / total, 1) : 0;
          },
        },
      );
      result = simulation;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        error = t('roulette.madness.errorAborted', locale);
      } else {
        error = t('roulette.madness.errorGeneric', locale);
      }
    } finally {
      controller = null;
      isSimulating = false;
      progress = 0;
    }
  }

  function getActualShare(entry: MadnessRewardAggregate): string {
    if (!result || result.totalSpins <= 0) return '—';
    return `${((entry.count / result.totalSpins) * 100).toFixed(2)}%`;
  }

  function getCurrencyLabel(entry: MadnessRewardAggregate): string {
    const { token, gold } = entry.currencyCounts;
    if (!token && !gold) return '—';
    const parts: string[] = [];
    if (token) parts.push(`${formatNumber(token)} ${t('roulette.madness.currencyTokens', locale)}`);
    if (gold) parts.push(`${formatNumber(gold)} ${t('roulette.madness.currencyGold', locale)}`);
    return parts.join(' · ');
  }

  $effect(() => {
    return () => {
      stopSimulation();
    };
  });
</script>

<div class="madness-shell">
  <form class="control-panel" onsubmit={(e) => { e.preventDefault(); handleSimulate(); }} style="order: -1;">
    <div class="inputs">
      <label class="field">
        <span class="label">{t('roulette.madness.levelLabel', locale)}</span>
        <input id="madness-level" name="madness-level" type="number" min={1} bind:value={level} />
        <small>{t('roulette.madness.maxResearchLabel', locale).replace('{n}', maxResearch > 0 ? String(maxResearch) : t('roulette.madness.maxResearchNone', locale))}</small>
      </label>
      <label class="field">
        <span class="label">{t('roulette.madness.goldLabel', locale)}</span>
        <input id="madness-gold" name="madness-gold" type="number" min={0} step={1} bind:value={gold} />
        <small>{t('roulette.madness.goldCostHint', locale).replace('{n}', formatNumber(goldCostPerSpin))}</small>
      </label>
      <label class="field">
        <span class="label">{t('roulette.madness.tokensLabel', locale)}</span>
        <input id="madness-tokens" name="madness-tokens" type="number" min={0} step={1} bind:value={tokens} />
        <small>{t('roulette.madness.tokensCostHint', locale).replace('{n}', formatNumber(tokenCostPerSpin))}</small>
      </label>
      <label class="field">
        <span class="label">{t('roulette.madness.discountLabel', locale)}</span>
        <select id="madness-discount" name="madness-discount" bind:value={discountValue}>
          {#each discountOptions as option}
            <option value={option}>{option}%</option>
          {/each}
        </select>
        <small>{t('roulette.madness.discountHint', locale)}</small>
      </label>
    </div>

    <div class="summary-grid" role="presentation">
      <div class="summary-card token-spins">
        <div class="summary-icon" aria-hidden="true">
          <img src={textureUrl("/materials/Material_Jackpot_Token.png")} alt="" loading="lazy" />
        </div>
        <div class="summary-body">
          <span class="title">{t('roulette.madness.summaryTokenSpins', locale)}</span>
          <strong>{formatNumber(tokenSpins)}</strong>
          <span class="meta">{t('roulette.madness.summaryTokenRemaining', locale).replace('{n}', formatNumber(tokenRemaining))}</span>
        </div>
      </div>
      <div class="summary-card gold-spins">
        <div class="summary-icon" aria-hidden="true">
          <img src={textureUrl("/cash/g20.webp")} alt="" loading="lazy" />
        </div>
        <div class="summary-body">
          <span class="title">{t('roulette.madness.summaryGoldSpins', locale)}</span>
          <strong>{formatNumber(goldSpins)}</strong>
          <span class="meta">{t('roulette.madness.summaryGoldRemaining', locale).replace('{n}', formatNumber(goldRemaining))}</span>
        </div>
      </div>
      <div class="summary-card total-spins">
        <div class="summary-icon" aria-hidden="true">
          <img src={textureUrl("/etc/icon_timer.webp")} alt="" loading="lazy" />
        </div>
        <div class="summary-body">
          <span class="title">{t('roulette.madness.summaryTotalSpins', locale)}</span>
          <strong>{formatNumber(totalSpins)}</strong>
          <span class="meta">{t('roulette.madness.summaryResearchOpen', locale).replace('{n}', String(maxResearch))}</span>
        </div>
      </div>
      <div class="summary-card highlight jackpot-chance">
        <div class="summary-icon" aria-hidden="true">
          <img src={textureUrl("/cash/jackpot.webp")} alt="" loading="lazy" />
        </div>
        <div class="summary-body">
          <span class="title">{t('roulette.madness.summaryJackpotChance', locale)}</span>
          <strong>{formatPercent(jackpotChance, 4)}</strong>
          <span class="meta">{t('roulette.madness.summaryForLevel', locale).replace('{n}', String(level))}</span>
          {#if jackpotOddsRatio}
            <span class="meta odds">{t('roulette.madness.summaryOddsRatio', locale).replace('{n}', jackpotOddsRatio.toFixed(2))}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="actions">
      <button type="submit" class="primary" disabled={isSimulating}>
        {isSimulating ? t('roulette.madness.btnSimulating', locale) : t('roulette.madness.btnRun', locale)}
      </button>
      <button
        type="button"
        class={`ghost ${isSimulating ? 'danger' : ''}`}
        onclick={isSimulating ? stopSimulation : resetSimulation}
      >
        {isSimulating ? t('roulette.madness.btnStop', locale) : t('roulette.madness.btnClear', locale)}
      </button>
    </div>

    {#if isSimulating}
      <div class="progress">
        <div class="progress-bar" style={`--progress: ${Math.min(progress * 100, 100)}%`}></div>
        <div class="progress-label">
          {t('roulette.madness.progressLabel', locale)
            .replace('{pct}', String(Math.floor(progress * 100)))
            .replace('{done}', formatNumber(completedSpins))
            .replace('{total}', formatNumber(totalSpins))}
        </div>
      </div>
    {/if}

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </form>

  {#if result}
    <section class="results">
      <header class="results-header">
        <h3>{t('roulette.madness.resultsTitle', locale)}</h3>
        <p>
          {t('roulette.madness.resultsSummary', locale)
            .replace('{total}', formatNumber(result.totalSpins))
            .replace('{tokenSpins}', formatNumber(result.tokenSpins))
            .replace('{goldSpins}', formatNumber(result.goldSpins))
            .replace('{jackpots}', formatNumber(result.jackpotCount))}
        </p>
      </header>

      <div class="resource-summary" role="presentation">
        {#if displayedResourceSummaries.length === 0}
          <p class="muted">{t('roulette.madness.emptyResources', locale)}</p>
        {:else}
          {#each displayedResourceSummaries as summary (summary.key)}
            <article class="resource-card">
              <div class="resource-icon">
                <img src={textureUrl(summary.icon)} alt="" loading="lazy" />
              </div>
              <div class="resource-body">
                <span class="resource-title">{summary.label}</span>
                <strong>{formatNumber(summary.count)}</strong>
                <span class="resource-meta">
                  {summary.metaLabel}: {formatNumber(summary.totalAmount)}
                </span>
              </div>
            </article>
          {/each}
        {/if}
      </div>

      <div class="result-grid">
        <section class="result-column">
          <h4>{t('roulette.madness.byRewards', locale)}</h4>
          {#if result.rewardBreakdown.length}
            <ul class="reward-board">
              {#each result.rewardBreakdown as entry, index}
                {@const currencyLabel = getCurrencyLabel(entry)}
                <li class:index-top={index < 3}>
                  <div class="icon">
                    <img src={textureUrl(entry.icon ?? '/etc/icon_larva.webp')} alt="" loading="lazy" />
                  </div>
                  <div class="details">
                    <div class="row">
                      <span class="name">{entry.label}</span>
                      <span class="count-badge">{formatNumber(entry.count)}×</span>
                    </div>
                    <div class="pills">
                      <span class="pill actual">{t('roulette.madness.actualShare', locale).replace('{pct}', getActualShare(entry))}</span>
                      <span class="pill expected">{t('roulette.madness.expectedShare', locale).replace('{pct}', formatPercent(entry.chance, 4))}</span>
                    </div>
                    {#if currencyLabel !== '—'}
                      <span class="currency">{currencyLabel}</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t('roulette.madness.emptyRewards', locale)}</p>
          {/if}
        </section>

        <section class="result-column">
          <h4>{t('roulette.madness.recentHistory', locale)}</h4>
          {#if result.history.length}
            <ul class="history-list">
              {#each result.history as entry}
                <li>
                  <div class="icon">
                    <img src={textureUrl(entry.icon ?? '/etc/icon_larva.webp')} alt="" loading="lazy" />
                  </div>
                  <div class="details">
                    <span class="name">{entry.label}</span>
                    <span class="meta">
                      {entry.currency === 'token' ? t('roulette.madness.currencyLabelToken', locale) : t('roulette.madness.currencyLabelGold', locale)} · {getResearchLabel(entry.researchKey, locale)}
                    </span>
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t('roulette.madness.emptyHistory', locale)}</p>
          {/if}
        </section>

        <section class="result-column">
          <h4>{t('roulette.madness.researchDistribution', locale)}</h4>
          {#if result.researchBreakdown.length}
            <ul class="research-list">
              {#each result.researchBreakdown as entry}
                <li>
                  <span>{entry.label}</span>
                  <span class="meta">
                    {formatNumber(entry.count)}× · {t('roulette.madness.actualShare', locale).replace('{pct}', result.totalSpins > 0
                      ? `${((entry.count / result.totalSpins) * 100).toFixed(2)}%`
                      : '—')}
                    · {t('roulette.madness.expectedShare', locale).replace('{pct}', formatPercent(entry.chance, 4))}
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t('roulette.madness.noData', locale)}</p>
          {/if}
        </section>
      </div>
    </section>
  {/if}
</div>

  <section class="odds-section" class:collapsed={!showOdds}>
    <button class="odds-toggle" onclick={() => showOdds = !showOdds}>
      <header>
        <h3>{t('roulette.madness.oddsTitle', locale)}</h3>
        <p>{t('roulette.madness.oddsForLevel', locale).replace('{n}', String(level)).replace('{max}', String(maxResearch))}</p>
      </header>
      <span class="chevron">{showOdds ? '▼' : '▲'}</span>
    </button>

    {#if showOdds}
      <div class="odds-table">
        {#each researchChances as group}
          <article class="odds-card">
            <header>
              <h4>{group.label}</h4>
              <span class="chance">{formatPercent(group.chance, 4)}</span>
            </header>
            <p class="odds-meta">{t('roulette.madness.oddsRewardCount', locale).replace('{n}', String(group.rewards.length))}</p>
            <ul>
              {#each group.rewards.slice(0, 5) as reward}
                <li>
                  <span>{reward.label}</span>
                  <span class="value">{formatPercent(reward.chance, 4)}</span>
                </li>
              {/each}
              {#if group.rewards.length > 5}
                <li class="more">{t('roulette.madness.oddsMore', locale).replace('{n}', String(group.rewards.length - 5))}</li>
              {/if}
            </ul>
          </article>
        {/each}
      </div>
    {/if}
  </section>

<style>
  :global(body) {
    scroll-padding-top: 80px;
  }

  .madness-shell {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: minmax(320px, 1fr) minmax(0, 2.5fr);
    align-items: start;
  }

  .control-panel {
    display: flex;
    flex-direction: column;
    gap: 1.8rem;
    padding: 2.2rem;
    border-radius: 32px;
    background: linear-gradient(145deg, rgba(24, 32, 44, 0.9), rgba(24, 17, 38, 0.92));
    border: 1px solid rgba(226, 232, 240, 0.12);
  }

  .inputs {
    display: grid;
    gap: 1.4rem;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .label {
    font-size: 0.9rem;
    color: #e5e7eb;
  }

  input,
  select {
    height: 46px;
    padding: 0 0.9rem;
    border-radius: 14px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.65);
    color: #e2e8f0;
    font-size: 1rem;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: rgba(249, 168, 212, 0.8);
    box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.25);
  }

  small {
    color: #e5e7eb;
    font-size: 0.78rem;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.2rem;
  }

  .summary-card {
    padding: 1.2rem 1.4rem;
    border-radius: 22px;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.2);
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .summary-card.no-icon {
    padding: 1.3rem 1.6rem;
    flex-direction: column;
    gap: 0.45rem;
    align-items: flex-end;
    text-align: right;
    gap: 1rem;
  }

  .summary-card {
    padding: 0.95rem 1.1rem;
    border-radius: 18px;
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid rgba(148, 163, 184, 0.16);
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .summary-card.highlight {
    background: linear-gradient(140deg, rgba(76, 29, 149, 0.28), rgba(15, 23, 42, 0.7));
    border-color: rgba(196, 181, 253, 0.38);
    box-shadow: none;
  }

  .summary-icon {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: 14px;
    background: rgba(148, 163, 184, 0.15);
    display: grid;
    place-items: center;
  }

  .summary-icon img {
    width: 30px;
    height: 30px;
    object-fit: contain;
  }

  .summary-card.token-spins .summary-icon {
    background: rgba(250, 204, 21, 0.18);
  }

  .summary-card.gold-spins .summary-icon {
    background: rgba(253, 224, 71, 0.18);
  }

  .summary-card.total-spins .summary-icon {
    background: rgba(244, 114, 182, 0.2);
  }

  .summary-card.jackpot-chance .summary-icon {
    background: rgba(253, 224, 71, 0.22);
  }

  .summary-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    align-items: flex-start;
    text-align: left;
  }

  .summary-card .title {
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #e5e7eb;
  }

  .summary-card.highlight .title {
    color: rgba(221, 214, 254, 0.9);
  }

  .summary-card strong {
    font-size: clamp(1.1rem, 1rem + 0.5vw, 1.6rem);
    color: #fce7f3;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
    white-space: nowrap;
    text-align: right;
    align-self: flex-end;
    letter-spacing: 0.015em;
    word-break: break-word;
    align-self: stretch;
    font-size: 1.55rem;
    color: #fce7f3;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    align-self: flex-end;
    width: 100%;
    text-align: right;
    font-size: clamp(1.35rem, 1.1rem + 0.4vw, 1.65rem);
    color: #fce7f3;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.015em;
    width: 100%;
    word-break: break-all;
  }

  .summary-card.highlight strong {
    color: #fef3c7;
  }

  .summary-card .meta {
    font-size: 0.78rem;
    color: #e5e7eb;
  }

  .summary-card.highlight .meta {
    color: rgba(221, 214, 254, 0.85);
  }

  .summary-card .meta.odds {
    font-size: 0.78rem;
    color: rgba(221, 214, 254, 0.85);
  }

  .actions {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  button {
    border: none;
    cursor: pointer;
    border-radius: 14px;
    padding: 0.9rem 1.6rem;
    font-size: 1rem;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  button.primary {
    background: linear-gradient(135deg, #fb7185, #ec4899);
    color: white;
    box-shadow: 0 15px 30px rgba(236, 72, 153, 0.35);
  }

  button.primary:disabled {
    opacity: 0.7;
    cursor: wait;
    box-shadow: none;
  }

  button.ghost {
    background: transparent;
    border: 1px solid rgba(248, 113, 113, 0.35);
    color: rgba(248, 113, 113, 0.9);
  }

  button.ghost.danger {
    border-color: rgba(248, 113, 113, 0.6);
    color: #fee2e2;
    background: rgba(248, 113, 113, 0.12);
  }

  button:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
  }

  .progress-bar {
    height: 6px;
    border-radius: 999px;
    background: rgba(248, 113, 113, 0.25);
    position: relative;
    overflow: hidden;
  }

  .progress-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(248, 113, 113, 0.8), rgba(236, 72, 153, 0.85));
    width: var(--progress, 0%);
    border-radius: 999px;
    transition: width 0.15s ease-out;
  }

  .progress-label {
    font-size: 0.85rem;
    color: rgba(226, 232, 240, 0.8);
  }

  .error {
    margin: 0;
    color: #fecaca;
    font-size: 0.9rem;
  }

  .odds-section {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    transition: all 0.3s ease;
  }

  .odds-toggle {
    background: rgba(17, 24, 39, 0.78);
    border: 1px solid rgba(244, 114, 182, 0.25);
    border-radius: 24px;
    padding: 1.1rem 1.4rem;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    color: inherit;
    text-align: left;
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .odds-toggle:hover {
    background: rgba(30, 41, 59, 0.85);
    border-color: rgba(244, 114, 182, 0.45);
  }

  .chevron {
    font-size: 1.5rem;
    color: rgba(244, 114, 182, 0.5);
    transition: transform 0.3s ease;
  }

  .odds-section header h3 {
    margin: 0;
    font-size: 1.8rem;
    color: #fdf2f8;
  }

  .odds-section header p {
    margin: 0;
    color: rgba(226, 232, 240, 0.7);
  }

  .odds-table {
    display: grid;
    gap: 1.2rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .odds-card {
    padding: 1.4rem;
    border-radius: 24px;
    background: rgba(17, 24, 39, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.18);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .odds-card header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .odds-card h4 {
    margin: 0;
    font-size: 1.1rem;
    color: #fce7f3;
  }

  .odds-card .chance {
    font-size: 0.95rem;
    color: rgba(248, 113, 113, 0.9);
  }

  .odds-card .odds-meta {
    margin: 0;
    font-size: 0.82rem;
    color: rgba(203, 213, 225, 0.7);
  }

  .odds-card ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .odds-card li {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.9rem;
    color: rgba(226, 232, 240, 0.88);
  }

  .odds-card li .value {
    color: rgba(248, 113, 113, 0.9);
  }

  .odds-card li.more {
    color: rgba(148, 163, 184, 0.75);
    font-style: italic;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 1.8rem;
  }

  .resource-summary {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }

  .resource-summary > .muted {
    margin: 0;
    grid-column: 1 / -1;
    text-align: center;
    color: rgba(203, 213, 225, 0.75);
  }

  .resource-card {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border-radius: 16px;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.16);
  }

  .resource-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(30, 41, 59, 0.78);
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  .resource-icon img {
    width: 32px;
    height: 32px;
    object-fit: contain;
  }

  .resource-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    align-items: flex-start;
    text-align: left;
  }

  .resource-title {
    font-size: 0.88rem;
    color: rgba(226, 232, 240, 0.85);
  }

  .resource-body strong {
    font-size: 1.15rem;
    color: #f8fafc;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
  }

  .resource-meta {
    font-size: 0.78rem;
    color: rgba(148, 163, 184, 0.75);
  }

  .results-header h3 {
    margin: 0;
    font-size: 1.9rem;
    color: #fdf2f8;
  }

  .results-header p {
    margin: 0.6rem 0 0;
    color: rgba(226, 232, 240, 0.75);
  }

  .result-grid {
    display: grid;
    gap: 1.4rem;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .result-column {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.4rem;
    border-radius: 24px;
    background: rgba(17, 24, 39, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.15);
  }

  .result-column h4 {
    margin: 0;
    font-size: 1.2rem;
    color: #fce7f3;
  }

  .reward-board,
  .history-list,
  .research-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    max-height: 420px;
    overflow-y: auto;
  }

  .reward-board li,
  .history-list li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.85rem;
    align-items: flex-start;
  }

  .reward-board {
    gap: 1rem;
  }

  .reward-board li {
    padding: 0.75rem 0.85rem;
    border-radius: 18px;
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.16);
    transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .history-list li {
    padding: 0.65rem 0.85rem;
    border-radius: 16px;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.16);
    align-items: center;
  }

  .reward-board li.index-top {
    border-color: rgba(236, 72, 153, 0.45);
    box-shadow: 0 16px 32px rgba(236, 72, 153, 0.2);
    transform: translateY(-2px);
  }

  .icon {
    width: 48px;
    height: 48px;
    border-radius: 16px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .history-list .icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: rgba(30, 41, 59, 0.82);
    border: none;
  }

  .history-list .icon img {
    width: 32px;
    height: 32px;
    object-fit: contain;
  }

  .history-list .details {
    gap: 0.2rem;
  }

  .history-list .details .meta {
    color: rgba(203, 213, 225, 0.72);
  }

  .icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .details .name {
    font-weight: 600;
    color: #e9d5ff;
  }

  .details .meta,
  .research-list .meta {
    font-size: 0.82rem;
    color: rgba(203, 213, 225, 0.7);
  }

  .details .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem 0.75rem;
    border-radius: 999px;
    background: rgba(254, 202, 202, 0.18);
    border: 1px solid rgba(254, 202, 202, 0.35);
    color: #fecaca;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .pills {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: rgba(148, 163, 184, 0.16);
    color: rgba(226, 232, 240, 0.75);
  }

  .pill.actual {
    background: rgba(248, 113, 113, 0.16);
    color: rgba(248, 113, 113, 0.95);
  }

  .pill.expected {
    background: rgba(165, 180, 252, 0.16);
    color: rgba(165, 180, 252, 0.9);
  }

  .currency {
    font-size: 0.82rem;
    color: rgba(203, 213, 225, 0.75);
  }

  .muted {
    margin: 0;
    color: rgba(148, 163, 184, 0.65);
  }

  .research-list li {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 0.6rem;
    border-bottom: 1px dashed rgba(148, 163, 184, 0.18);
  }

  .research-list li:last-child {
    border-bottom: none;
  }

  @media (max-width: 1000px) {
    .madness-shell {
      grid-template-columns: 1fr;
    }
    .control-panel {
      order: 0 !important;
    }
  }

  @media (max-width: 720px) {
    .control-panel {
      padding: 1.25rem 1rem;
      border-radius: 24px;
    }

    .inputs {
      grid-template-columns: 1fr;
      gap: 1rem;
    }

    .actions {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }

    .actions button {
      width: 100%;
    }

    .summary-grid {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .summary-card {
      padding: 0.85rem;
    }

    .summary-card strong {
      font-size: 1.25rem;
    }

    .results-header h3 {
      font-size: 1.5rem;
    }

    .resource-summary {
      grid-template-columns: 1fr;
    }

    .reward-board li,
    .history-list li {
      grid-template-columns: auto 1fr;
      align-items: center;
      padding: 0.75rem;
    }

    .icon {
      width: 40px;
      height: 40px;
    }

    .details .row {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }

    .count-badge {
      font-size: 0.9rem;
      padding: 0.1rem 0.5rem;
    }

    .result-grid {
      grid-template-columns: 1fr;
    }

    .result-column {
      padding: 1rem;
      max-height: 350px;
    }

    .odds-section header h3 {
      font-size: 1.5rem;
    }
    
    .odds-section.collapsed header p {
      display: none;
    }

    .odds-table {
      grid-template-columns: 1fr;
    }
  }
</style>
