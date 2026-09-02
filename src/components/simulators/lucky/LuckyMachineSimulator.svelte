<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn';
  import type {
    LuckyMachineDefinition,
    LuckyRewardAggregate,
    LuckyRewardChance,
    LuckySimulation,
  } from '@/lib/lucky-machine';
  import {
    formatNumber,
    getRewardWithChance,
    simulateLuckyMachineAsync,
  } from '@/lib/lucky-machine';
  import { tick } from 'svelte';
  import { t, type Locale } from '@/lib/i18n';

  let { machine, locale, labels = {} }: { machine: LuckyMachineDefinition; locale: Locale; labels?: Record<number, string> } = $props();

  const rewardChances: LuckyRewardChance[] = machine.rewards
    .filter((reward) => reward.odds > 0)
    .map((reward) => getRewardWithChance(reward, machine))
    .sort((a, b) => b.chance - a.chance);

  let showOdds = $state(false);
  let spins = $state(200);
  let isSimulating = $state(false);
  let error = $state<string | null>(null);
  let result = $state<LuckySimulation | null>(null);
  let progress = $state(0);
  let completedPaid = $state(0);
  let controller = $state<AbortController | null>(null);
  let showResultsModal = $state(false);

  type ResourceSummaryKey = 'consumables'|'stars'|'spheres'|'boosters'|'tokens'|'mutants'|'jackpots';
  interface ResourceSummary { key: ResourceSummaryKey; label: string; icon: string; metaLabel: string; count: number; totalAmount: number; }

  const resourceSummaryConfig: Record<ResourceSummaryKey, {label:string, icon:string, metaLabel:string}> = {
    consumables: { label: t('roulette.lucky.resourceConsumables', locale), icon: '/med/normal_med.webp', metaLabel: t('roulette.lucky.metaTotal', locale) },
    stars: { label: t('roulette.lucky.resourceStars', locale), icon: '/stars/all_stars.webp', metaLabel: t('roulette.lucky.metaTotal', locale) },
    spheres: { label: t('roulette.lucky.resourceSpheres', locale), icon: '/orbs/basic/orb_slot.webp', metaLabel: t('roulette.lucky.metaTotal', locale) },
    boosters: { label: t('roulette.lucky.resourceBoosters', locale), icon: '/boosters/charm_xpx2_7.webp', metaLabel: t('roulette.lucky.metaTotal', locale) },
    tokens: { label: t('roulette.lucky.resourceTokens', locale), icon: '/materials/Material_Gacha_Token.png', metaLabel: t('roulette.lucky.metaTotal', locale) },
    mutants: { label: t('roulette.lucky.resourceMutants', locale), icon: '/etc/icon_larva.webp', metaLabel: t('roulette.lucky.metaDropped', locale) },
    jackpots: { label: t('roulette.lucky.resourceJackpots', locale), icon: '/roulette-thumbs/jackpot.png', metaLabel: t('roulette.lucky.metaDropped', locale) },
  };

  const resourceSummaryOrder: ResourceSummaryKey[] = ['consumables','stars','spheres','boosters','tokens','mutants','jackpots'];

  const rewardChanceMap = new Map<number, number>();
  for (const reward of rewardChances) { rewardChanceMap.set(reward.rewardId, reward.chance); }

  function detectResourceSummaryKey(entry: LuckyRewardAggregate): ResourceSummaryKey | null {
    const { reward } = entry;
    const name = reward.name.toLowerCase();
    const slug = reward.id?.toLowerCase?.() ?? '';
    if (reward.isSuperJackpot || reward.category === 'jackpot' || name.includes('джекпот')) return 'jackpots';
    if (reward.category === 'mutant' || slug.includes('specimen') || name.includes('мутант')) return 'mutants';
    if (reward.category === 'token' || name.includes('жетон') || slug.includes('token') || slug.includes('jackpot')) return 'tokens';
    if (reward.category === 'orb' || name.includes('сфер') || slug.includes('orb')) return 'spheres';
    if (reward.category === 'booster' || name.includes('бустер') || slug.includes('booster')) return 'boosters';
    if (reward.category === 'star' || name.includes('звёзд') || slug.includes('star')) return 'stars';
    if (reward.category === 'material' || name.includes('апт') || name.includes('опыт') || slug.includes('xp') || slug.includes('med')) return 'consumables';
    return null;
  }

  function buildResourceSummaries(simulation: LuckySimulation | null): ResourceSummary[] {
    const totals = new Map<ResourceSummaryKey, { count: number; totalAmount: number }>();
    if (simulation) {
      for (const entry of simulation.breakdown) {
        const key = detectResourceSummaryKey(entry);
        if (!key) continue;
        const current = totals.get(key) ?? { count: 0, totalAmount: 0 };
        current.count += entry.count;
        current.totalAmount += entry.totalAmount;
        totals.set(key, current);
      }
    }
    return resourceSummaryOrder.map((key) => {
      const config = resourceSummaryConfig[key];
      const bucket = totals.get(key) ?? { count: 0, totalAmount: 0 };
      return { key, ...config, ...bucket };
    });
  }

  let resourceSummaries = $derived(buildResourceSummaries(result));

  function formatPercent(value: number, digits = 2): string {
    return `${(value * 100).toFixed(digits)}%`;
  }

  function resetSimulation() {
    if (controller) { controller.abort(); controller = null; }
    result = null; progress = 0; completedPaid = 0; error = null; showResultsModal = false;
  }

  function closeResultsModal() {
    showResultsModal = false;
  }

  async function handleSimulate(e: Event) {
    e.preventDefault();
    error = null;
    if (!Number.isFinite(spins) || spins <= 0) { error = t('roulette.lucky.errorPositive', locale); return; }
    result = null; progress = 0; completedPaid = 0;
    isSimulating = true;
    controller = new AbortController();
    await tick();
    try {
      // Для плавности разбиваем на мелкие пачки и не блокируем поток
      const simulation = await simulateLuckyMachineAsync(spins, machine, {
        historySize: 24,
        batchSize: 200, // Еще меньше батч для частых обновлений
        signal: controller.signal,
        labels,
        onProgress(completed) {
          completedPaid = completed;
          const raw = spins > 0 ? completed / spins : 0;
          // Плавное обновление
          progress = raw;
        },
      });
      progress = 1;
      result = simulation;
      showResultsModal = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        error = t('roulette.lucky.errorAborted', locale);
      } else {
        error = t('roulette.lucky.errorGeneric', locale);
      }
    } finally {
      controller = null; isSimulating = false; progress = 0; completedPaid = 0;
    }
  }

  function getFreeSpinRate(sim?: LuckySimulation | null) {
    if (!sim || sim.totalSpins === 0) return '—';
    return `${((sim.freeSpins / sim.totalSpins) * 100).toFixed(2)}%`;
  }
  function getFreeSpinRatio(sim?: LuckySimulation | null) {
    if (!sim || sim.freeSpins === 0) return '—';
    const r = sim.paidSpins / sim.freeSpins;
    return t('roulette.lucky.freeSpinRatioFormat', locale).replace('{n}', r.toFixed(2));
  }

  // --- Helpers for Detailed Results ---
  function getActualShare(entry: LuckyRewardAggregate): string {
    if (!result || result.totalSpins <= 0) return '—';
    return formatPercent(entry.count / result.totalSpins, 2);
  }

  function getExpectedShare(entry: LuckyRewardAggregate): string {
    const chance = rewardChanceMap.get(entry.reward.rewardId);
    if (chance == null) return '—';
    return formatPercent(chance, 4);
  }

  function getCurrencyLabel(entry: LuckyRewardAggregate): string {
    const { reward, totalAmount } = entry;
    if (reward.type === 'hardcurrency') {
      return `${formatNumber(totalAmount, locale)} ${t('roulette.lucky.currencyGold', locale)}`;
    }
    if (reward.type === 'softcurrency') {
      return `${formatNumber(totalAmount, locale)} ${t('roulette.lucky.currencySilver', locale)}`;
    }
    if (reward.category === 'token') {
      return `${formatNumber(totalAmount, locale)} ${t('roulette.lucky.currencyTokens', locale)}`;
    }
    return '—';
  }

  // В отличие от Cash/Madness, здесь не было cleanup при размонтировании -
  // уход со страницы во время симуляции оставлял simulateLuckyMachineAsync
  // крутиться в фоне и писать в состояние уже уничтоженного компонента.
  $effect(() => {
    return () => {
      controller?.abort();
    };
  });
</script>

<div class="machine-shell">
  <div class="machine-body">
    <div class="machine-header">
      <span class="machine-tag">{t('roulette.lucky.machineTag', locale)}</span>
      <h2>{machine.title}</h2>
      <p>{t('roulette.lucky.headerDescription', locale)}</p>
    </div>

    <form class="control-panel" onsubmit={handleSimulate} style="order: -1;">
      <label class="input-group">
        <span>{t('roulette.lucky.spinsLabel', locale)}</span>
        <div class="input-wrapper">
          <input id="lucky-spins" name="lucky-spins" type="number" min={1} bind:value={spins} />
          <span class="suffix">{t('roulette.lucky.spinsSuffix', locale)}</span>
        </div>
      </label>
      <div class="actions">
        <button type="submit" class="primary" disabled={isSimulating}>{isSimulating ? t('roulette.lucky.btnSimulating', locale) : t('roulette.lucky.btnRun', locale)}</button>
        <button type="button" class="ghost" onclick={isSimulating ? () => controller?.abort() : resetSimulation}>{isSimulating ? t('roulette.lucky.btnStop', locale) : t('roulette.lucky.btnClear', locale)}</button>
      </div>
      {#if isSimulating}
        <div class="progress">
          <div class="progress-bar"><div class="progress-fill" style={`width: ${Math.min(progress * 100, 100)}%`}></div></div>
          <div class="progress-label">{t('roulette.lucky.progressLabel', locale)
            .replace('{pct}', String(Math.min(Math.floor(progress * 100), 100)))
            .replace('{done}', formatNumber(completedPaid, locale))
            .replace('{total}', formatNumber(spins, locale))}</div>
        </div>
      {/if}
      {#if error}<p class="error">{error}</p>{/if}
    </form>

    {#if result && !showResultsModal}
      <button class="primary show-results-btn" onclick={() => showResultsModal = true}>{t('roulette.lucky.showResults', locale)}</button>
    {/if}
  </div>

  {#if result && showResultsModal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) closeResultsModal(); }} onkeydown={(e) => e.key === 'Escape' && closeResultsModal()} role="dialog" tabindex="-1">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{t('roulette.lucky.modalTitle', locale)}</h3>
          <button class="modal-close" onclick={closeResultsModal}>✕</button>
        </div>

        <section class="stats">
          <div class="stat-card">
            <img class="stat-icon" src={textureUrl("/etc/icon_timer.webp")} alt="" />
            <div class="stat-body"><span class="label">{t('roulette.lucky.statTotalSpins', locale)}</span><strong>{formatNumber(result.totalSpins, locale)}</strong></div>
          </div>
          <div class="stat-card">
            <img class="stat-icon" src={textureUrl("/materials/Material_Jackpot_Token.png")} alt="" />
            <div class="stat-body"><span class="label">{t('roulette.lucky.statPaid', locale)}</span><strong>{formatNumber(result.paidSpins, locale)}</strong></div>
          </div>
          <div class="stat-card highlight">
            <img class="stat-icon" src={textureUrl("/etc/freespin.webp")} alt="" />
            <div class="stat-body">
              <span class="label">{t('roulette.lucky.statFree', locale)}</span>
              <strong>{formatNumber(result.freeSpins, locale)}</strong>
              <small>{t('roulette.lucky.statFreeShare', locale).replace('{rate}', getFreeSpinRate(result)).replace('{ratio}', getFreeSpinRatio(result))}</small>
            </div>
          </div>
          <div class="stat-card">
            <img class="stat-icon" src={textureUrl("/roulette-thumbs/hc20.png")} alt="" />
            <div class="stat-body"><span class="label">{t('roulette.lucky.statGoldWon', locale)}</span><strong>{formatNumber(result.goldWon, locale)}</strong></div>
          </div>
          <div class="stat-card">
            <img class="stat-icon" src={textureUrl("/roulette-thumbs/softcurrency.png")} alt="" />
            <div class="stat-body"><span class="label">{t('roulette.lucky.statSilverWon', locale)}</span><strong>{formatNumber(result.silverWon, locale)}</strong></div>
          </div>
          <div class="stat-card">
            <img class="stat-icon" src={textureUrl("/materials/Material_Gacha_Token.png")} alt="" />
            <div class="stat-body"><span class="label">{t('roulette.lucky.statTokens', locale)}</span><strong>{formatNumber(result.tokenItems, locale)}</strong></div>
          </div>
        </section>

        <section class="resource-summary">
          {#each resourceSummaries as s (s.key)}
            <article class="resource-card">
              <div class="resource-icon"><img src={textureUrl(s.icon)} alt="" /></div>
              <div class="resource-body">
                <span class="resource-title">{s.label}</span>
                <strong>{formatNumber(s.count, locale)}</strong>
                <span class="resource-meta">{s.metaLabel}: {formatNumber(s.totalAmount, locale)}</span>
              </div>
            </article>
          {/each}
        </section>

        <div class="result-grid">
          <section class="result-column">
            <h4>{t('roulette.lucky.byRewards', locale)}</h4>
            {#if result.breakdown.length}
              <ul class="reward-board">
                {#each result.breakdown as entry, index}
                  {@const totalLabel = getCurrencyLabel(entry)}
                  <li class:index-top={index < 3}>
                    <div class="icon">
                      <img src={textureUrl(entry.icon ?? '/etc/icon_larva.webp')} alt="" loading="lazy" />
                    </div>
                    <div class="details">
                      <div class="row">
                        <span class="name">{entry.label}</span>
                        <span class="count-badge">{formatNumber(entry.count, locale)}×</span>
                      </div>
                      <div class="pills">
                        <span class="pill actual">{t('roulette.lucky.actualShare', locale).replace('{pct}', getActualShare(entry))}</span>
                        <span class="pill expected">{t('roulette.lucky.expectedShare', locale).replace('{pct}', getExpectedShare(entry))}</span>
                      </div>
                      {#if totalLabel !== '—'}
                        <span class="currency">{totalLabel}</span>
                      {:else if entry.totalAmount > entry.count}
                        <span class="currency">{formatNumber(entry.totalAmount, locale)} {t('roulette.lucky.unitPieces', locale)}</span>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted">{t('roulette.lucky.emptyRewards', locale)}</p>
            {/if}
          </section>

          <section class="result-column">
            <h4>{t('roulette.lucky.recentHistory', locale)}</h4>
            {#if result.history.length}
              <ul class="history-list">
                {#each result.history as spin}
                  <li class:free-spin={spin.type === 'free-spin'}>
                    <div class="history-info">
                      <img src={textureUrl(spin.icon ?? '/etc/icon_larva.webp')} alt="" loading="lazy" />
                      <span class="title">{spin.label}</span>
                    </div>
                    {#if spin.type === 'free-spin'}
                      <span class="note">{t('roulette.lucky.freeSpinNote', locale)}</span>
                    {:else}
                      <span class="note">{formatNumber(spin.reward.amount, locale)}×</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted">{t('roulette.lucky.emptyHistory', locale)}</p>
            {/if}
          </section>
        </div>

        <button class="primary modal-close-bottom" onclick={closeResultsModal}>{t('roulette.lucky.closeBtn', locale)}</button>
      </div>
    </div>
  {/if}
  <aside class="odds-panel" class:collapsed={!showOdds}>
    <button class="odds-toggle" onclick={() => showOdds = !showOdds}>
      <h3>{t('roulette.lucky.chancesTitle', locale)}</h3>
      <span class="chevron">{showOdds ? '▼' : '▲'}</span>
    </button>

    {#if showOdds}
      <div class="odds-scroll">
        <ul class="odds-list">
          {#each rewardChances as r}
            <li>
              <span class="odds-name"><img class="odds-icon" src={textureUrl(r.icon)} alt="" /><span class="name">{labels[r.rewardId] ?? r.name}</span></span>
              <span class="chance">{(r.chance * 100).toFixed(4)}%</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </aside>
</div>

<style>
  .machine-shell { display: grid; gap: 1.5rem; grid-template-columns: minmax(300px, 1fr) minmax(0, 2fr); align-items: start; }
  .machine-body { background: linear-gradient(150deg, rgba(124,77,255,0.15), rgba(16,14,26,0.95)); border: 1px solid rgba(129,140,248,0.3); border-radius: 24px; padding: 2rem; display: flex; flex-direction: column; gap: 2rem; }
  .machine-header h2 { margin: 0; font-size: 2rem; color: #e0e7ff; }
  .machine-tag { display: inline-block; padding: 0.3rem 0.8rem; border-radius: 999px; background: rgba(124,77,255,0.2); color: #c7b8ff; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 0.5rem; }
  .control-panel { display: grid; gap: 1rem; }
  .input-wrapper { position: relative; display: flex; align-items: center; }
  .input-wrapper input { width: 100%; padding: 0.7rem 1rem; border-radius: 12px; border: 1px solid rgba(129,140,248,0.4); background: #0c0a18; color: #fff; font-size: 1.1rem; }
  input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
  .actions { display: flex; gap: 0.5rem; }
  button { border: none; border-radius: 999px; padding: 0.7rem 1.5rem; cursor: pointer; font-weight: 700; transition: 0.2s; }
  button.primary { background: #7c4dff; color: #fff; }
  button.ghost { background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255,255,255,0.1); }
  .progress-bar { height: 10px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden; margin: 0.5rem 0; }
  
  /* Плавная анимация изменения ширины */
  .progress-fill { 
    height: 100%; 
    background: linear-gradient(90deg, #c7b8ff, #7c4dff); /* Более яркий градиент */
    box-shadow: 0 0 15px rgba(124, 77, 255, 0.6); /* Более заметная тень */
    transition: width 0.15s ease-out;
    border-radius: 999px;
  }

  .stats { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .stat-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 1rem; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.5rem; }
  .stat-card.highlight { background: rgba(124,77,255,0.1); border-color: rgba(124,77,255,0.2); }
  .stat-icon { width: 32px; height: 32px; object-fit: contain; }
  .stat-body { display: flex; flex-direction: column; align-items: center; }
  .stat-body .label { font-size: 0.7rem; text-transform: uppercase; color: #e5e7eb; }
  .stat-body strong { font-size: 1.2rem; color: #fff; }
  .resource-summary { display: grid; gap: 0.8rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
  .resource-card { display: flex; align-items: center; gap: 1rem; background: rgba(255,255,255,0.03); padding: 0.8rem; border-radius: 12px; }
  .resource-icon img { width: var(--orb-size-img); height: var(--orb-size-img); }
  .resource-body { display: flex; flex-direction: column; }
  .resource-title { font-size: 0.8rem; color: #e5e7eb; }
  .resource-body strong { color: #fff; }
  .resource-meta { font-size: 0.7rem; color: #e5e7eb; }
  .odds-panel { background: rgba(16,14,26,0.8); border-radius: 20px; padding: 1.5rem; border: 1px solid rgba(129,140,248,0.2); transition: all 0.3s ease; }
  .odds-toggle { background: none; border: none; padding: 0; width: 100%; display: flex; justify-content: space-between; align-items: center; cursor: pointer; color: inherit; }
  .chevron { font-size: 1.2rem; color: rgba(124, 77, 255, 0.5); transition: transform 0.3s ease; }
  .odds-scroll { max-height: 500px; overflow-y: auto; padding-right: 0.5rem; margin-top: 1rem; }
  .odds-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.6rem; }
  .odds-list li { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
  .odds-name { display: flex; align-items: center; gap: 0.5rem; }
  .odds-icon { width: 32px; height: 32px; }
  .chance { color: #7c4dff; font-weight: 700; }

  /* Добавлено для отображения списков наград */
  .result-grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); margin-top: 1.5rem; }
  .result-column { display: flex; flex-direction: column; gap: 0.8rem; background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 16px; }
  .result-column h4 { margin: 0; font-size: 1rem; color: #e5e7eb; }
  .reward-board, .history-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; flex: 1; }
  
  .reward-board li, .history-list li { display: flex; align-items: center; gap: 0.8rem; background: rgba(255,255,255,0.05); padding: 0.6rem; border-radius: 8px; }
  .reward-board li.index-top { background: rgba(124,77,255,0.15); border: 1px solid rgba(124,77,255,0.3); }

  .reward-board .icon,
  .history-list .history-thumb {
    width: 50px; /* Увеличил контейнер */
    height: 50px;
    display: flex; /* Сделал флекс для центровки */
    align-items: center; justify-content: center;
    background: rgba(0,0,0,0.2);
    border-radius: 12px; /* Более мягкие углы */
    flex-shrink: 0;
  }
  .reward-board .icon img,
  .history-list img {
    max-width: 90%; /* Вписываем в новый контейнер */
    max-height: 90%;
    object-fit: contain; 
    display: block;
    transform: scale(1.1); /* Слегка увеличим саму иконку, чтобы она казалась полнее */
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4));
  }

  /* Для элемента в истории, который был history-thumb, теперь он .history-info img, чтобы избежать конфликтов. */
  .history-list .history-info img {
    width: 36px; /* Чуть меньше, чем основная награда, для иерархии */
    height: 36px;
    border-radius: 8px;
    padding: 2px;
  }

  .reward-board .details, .history-list .history-info { flex: 1; min-width: 0; }
  .reward-board .row { display: flex; justify-content: space-between; align-items: center; }
  .reward-board .name { font-size: 0.85rem; font-weight: 600; color: #fff; }
  .count-badge { font-size: 0.75rem; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; }
  .pills { display: flex; gap: 0.4rem; margin-top: 2px; }
  .pill { font-size: 0.65rem; padding: 1px 4px; border-radius: 4px; background: rgba(0,0,0,0.3); color: #e5e7eb; }
  .currency, .note { font-size: 0.75rem; color: #e5e7eb; white-space: nowrap; }

  @media (max-width: 1000px) {
    .machine-shell {
      grid-template-columns: 1fr;
    }
    .odds-panel {
      order: -1;
    }
  }

  .show-results-btn {
    width: 100%;
    margin-top: 0.5rem;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    overflow-y: auto;
  }

  .modal-content {
    background: linear-gradient(150deg, rgba(124,77,255,0.12), rgba(13,10,22,0.97));
    border: 1px solid rgba(129,140,248,0.3);
    border-radius: 24px;
    padding: 2rem;
    width: 100%;
    max-width: 900px;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.6rem;
    color: #e0e7ff;
  }

  .modal-close {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: #fff;
    font-size: 1.1rem;
    padding: 0;
    cursor: pointer;
    transition: background 0.2s;
  }

  .modal-close:hover {
    background: rgba(255,255,255,0.15);
  }

  .modal-close-bottom {
    width: 100%;
    margin-top: 0.5rem;
  }

  @media (max-width: 640px) {
    .odds-panel {
      padding: 1rem;
    }
    .odds-panel.collapsed {
      gap: 0;
    }
    .odds-panel.collapsed .odds-scroll {
      display: none;
    }

    .machine-body {
      padding: 1.25rem 1rem;
      gap: 1.5rem;
    }

    .machine-header h2 {
      font-size: 1.5rem;
    }

    .stats {
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    .stat-card {
      padding: 0.75rem;
    }

    .stat-body strong {
      font-size: 1rem;
    }

    .stat-body .label {
      font-size: 0.6rem;
    }

    .resource-summary {
      grid-template-columns: 1fr;
    }

    .result-grid {
      grid-template-columns: 1fr;
    }

    .actions {
      flex-direction: column;
    }

    .actions button {
      width: 100%;
    }

    .odds-list li {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
      padding: 0.6rem;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 12px;
    }

    .odds-list .chance {
      align-self: flex-end;
    }

    .modal-overlay {
      padding: 0.75rem;
    }

    .modal-content {
      padding: 1.25rem;
      border-radius: 20px;
      max-height: 95vh;
    }

    .modal-header h3 {
      font-size: 1.3rem;
    }
  }
</style>
