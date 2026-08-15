<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn';
  import type {
    CashMachineDefinition,
    RewardAggregate,
    RewardChance,
    SpinSummary,
  } from '@/lib/cash-machine';
  import {
    formatNumber,
    getCurrencyIcon,
    getRewardWithChance,
    simulateMachineAsync,
  } from '@/lib/cash-machine';
  import { tick } from 'svelte';
  import { t, type Locale } from '@/lib/i18n';

  interface SimulationResult {
    spins: number;
    budget: number;
    goldSpent: number;
    goldWon: number;
    silverWon: number;
    netGold: number;
  }

  let { machine, locale }: { machine: CashMachineDefinition; locale: Locale } = $props();

  const costPerSpin = machine.cost;
  const rewardChances: RewardChance[] = machine.rewards
    .filter((reward) => reward.odds > 0)
    .map((reward) => getRewardWithChance(reward, machine))
    .sort((a, b) => b.chance - a.chance);

  let budget = $state(1000);
  let isSimulating = $state(false);
  let error: string | null = $state(null);
  let result: SimulationResult | null = $state(null);
  const goldIcon = getCurrencyIcon('hardcurrency');
  const silverIcon = getCurrencyIcon('softcurrency');

  function getRewardUnit(type: string): string {
    if (type === 'hardcurrency') return t('roulette.cash.unitGold', locale);
    if (type === 'softcurrency') return t('roulette.cash.unitSilver', locale);
    return '';
  }

  function formatAmountWithUnit(amount: number, type: string): string {
    const unit = getRewardUnit(type);
    return unit ? `${formatNumber(amount)} ${unit}` : formatNumber(amount);
  }

  let showOdds = $state(false);
  let breakdown: RewardAggregate[] = $state([]);
  let history: SpinSummary[] = $state([]);
  let progress = $state(0);
  let controller: AbortController | null = $state(null);
  let totalSpins = $state(0);
  let completedSpins = $state(0);
  let showResultsModal = $state(false);

  function resetSimulation() {
    if (controller) {
      controller.abort();
      controller = null;
    }
    result = null;
    breakdown = [];
    history = [];
    progress = 0;
    totalSpins = 0;
    error = null;
    completedSpins = 0;
    showResultsModal = false;
  }

  function closeResultsModal() {
    showResultsModal = false;
  }

  function stopSimulation() {
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  async function handleSimulate(e: Event) {
    e.preventDefault();
    error = null;
    const spins = Math.floor(budget / costPerSpin);

    if (!Number.isFinite(budget) || budget <= 0) {
      error = t('roulette.cash.errorPositive', locale);
      return;
    }

    if (spins <= 0) {
      error = t('roulette.cash.errorInsufficient', locale).replace('{n}', String(costPerSpin));
      return;
    }

    result = null;
    breakdown = [];
    history = [];

    isSimulating = true;
    progress = 0;
    totalSpins = spins;
    controller = new AbortController();

    await tick();

    try {
      const simulation = await simulateMachineAsync(spins, machine, {
        historySize: 12,
        batchSize: 2000,
        signal: controller.signal,
        onProgress(completed) {
          completedSpins = completed;
          progress = completed / spins;
        },
      });

      breakdown = simulation.breakdown;

      result = {
        spins,
        budget,
        goldSpent: spins * costPerSpin,
        goldWon: simulation.goldWon,
        silverWon: simulation.silverWon,
        netGold: simulation.goldWon - spins * costPerSpin,
      };

      history = simulation.history;
      showResultsModal = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        error = t('roulette.cash.errorAborted', locale);
      } else {
        error = t('roulette.cash.errorGeneric', locale);
      }
    } finally {
      controller = null;
      isSimulating = false;
      progress = 0;
      totalSpins = 0;
      completedSpins = 0;
    }
  }

  $effect(() => {
    return () => {
      stopSimulation();
    };
  });
</script>

<div class="machine-shell">
  <div class="machine-body">
    <div class="machine-header">
      <span class="machine-tag">{t('roulette.cash.machineTag', locale)}</span>
      <h2>{machine.title}</h2>
      <p>{t('roulette.cash.headerDescription', locale).replace('{n}', String(costPerSpin))}</p>
    </div>

    <form class="control-panel" onsubmit={handleSimulate} style="order: -1;">
      <label class="input-group">
        <span>{t('roulette.cash.budgetLabel', locale)}</span>
        <div class="input-wrapper">
          <input
            id="cash-budget"
            name="cash-budget"
            type="number"
            min={costPerSpin}
            bind:value={budget}
            aria-describedby="budget-hint"
          />
          <span class="suffix">{t('roulette.cash.unitGold', locale)}</span>
        </div>
        <small id="budget-hint">{t('roulette.cash.budgetHint', locale).replace('{n}', String(costPerSpin))}</small>
      </label>

      <div class="actions">
        <button type="submit" class="primary" disabled={isSimulating}>
          {isSimulating ? t('roulette.cash.btnSimulating', locale) : t('roulette.cash.btnRun', locale)}
        </button>
        <button
          type="button"
          class={`ghost ${isSimulating ? 'danger' : ''}`}
          onclick={isSimulating ? stopSimulation : resetSimulation}
        >
          {isSimulating ? t('roulette.cash.btnStop', locale) : t('roulette.cash.btnClear', locale)}
        </button>
      </div>
      {#if isSimulating}
        <div class="progress">
          <div class="progress-bar">
            <div class="progress-fill" style={`width: ${Math.min(progress * 100, 100)}%`}></div>
          </div>
          <div class="progress-label">
            {t('roulette.cash.progressLabel', locale)
              .replace('{pct}', String(Math.min(Math.floor(progress * 100), 100)))
              .replace('{done}', formatNumber(completedSpins))
              .replace('{total}', formatNumber(totalSpins))}
          </div>
        </div>
      {/if}
      {#if error}
        <p class="error">{error}</p>
      {/if}
    </form>

    {#if result && !showResultsModal}
      <button class="primary show-results-btn" onclick={() => showResultsModal = true}>{t('roulette.cash.showResults', locale)}</button>
    {/if}
  </div>

  {#if result && showResultsModal}
    <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) closeResultsModal(); }} onkeydown={(e) => e.key === 'Escape' && closeResultsModal()} role="dialog" tabindex="-1">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{t('roulette.cash.modalTitle', locale)}</h3>
          <button class="modal-close" onclick={closeResultsModal}>✕</button>
        </div>

        <section class="stats">
          <div class="stat-card metric spins">
            <div class="metric-icon" aria-hidden="true">
              <img src={textureUrl("/etc/icon_timer.webp")} alt="" loading="lazy" />
            </div>
            <div class="metric-body">
              <span class="label">{t('roulette.cash.statSpins', locale)}</span>
              <strong>{formatNumber(result.spins)}</strong>
            </div>
          </div>
          <div class="stat-card currency">
            <img class="stat-icon" src={textureUrl(goldIcon)} alt={t('roulette.cash.goldIconAlt', locale)} loading="lazy" />
            <div class="stat-body">
              <span class="label">{t('roulette.cash.statGoldSpent', locale)}</span>
              <strong>{formatNumber(result.goldSpent)}</strong>
            </div>
          </div>
          <div class="stat-card currency">
            <img class="stat-icon" src={textureUrl(goldIcon)} alt={t('roulette.cash.goldIconAlt', locale)} loading="lazy" />
            <div class="stat-body">
              <span class="label">{t('roulette.cash.statGoldWon', locale)}</span>
              <strong>{formatNumber(result.goldWon)}</strong>
            </div>
          </div>
          <div class="stat-card currency">
            <img class="stat-icon" src={textureUrl(silverIcon)} alt={t('roulette.cash.silverIconAlt', locale)} loading="lazy" />
            <div class="stat-body">
              <span class="label">{t('roulette.cash.statSilverWon', locale)}</span>
              <strong>{formatNumber(result.silverWon)}</strong>
            </div>
          </div>
          <div class={`stat-card currency net ${result.netGold >= 0 ? 'positive' : 'negative'}`}>
            <img class="stat-icon" src={textureUrl(goldIcon)} alt={t('roulette.cash.goldIconAlt', locale)} loading="lazy" />
            <div class="stat-body">
              <span class="label">{t('roulette.cash.statNetResult', locale)}</span>
              <strong>{result.netGold >= 0 ? '+' : ''}{formatNumber(result.netGold)}</strong>
            </div>
          </div>
        </section>

        <section class="results-grid">
          <div class="panel">
            <h3>{t('roulette.cash.panelRewardStats', locale)}</h3>
            <div class="table">
              <div class="table-row head">
                <span>{t('roulette.cash.tableHeadReward', locale)}</span>
                <span>{t('roulette.cash.tableHeadCount', locale)}</span>
                <span>{t('roulette.cash.tableHeadTotal', locale)}</span>
              </div>
              {#each breakdown as entry}
                <div class="table-row">
                  <span class="reward-label">
                    <img class="reward-icon" src={textureUrl(entry.icon)} alt={entry.label} loading="lazy" />
                    <span>{entry.label}</span>
                  </span>
                  <span>x{formatNumber(entry.count)}</span>
                  <span>{formatAmountWithUnit(entry.totalAmount, entry.reward.type)}</span>
                </div>
              {/each}
            </div>
          </div>
          <div class="panel">
            <h3>{t('roulette.cash.panelRecentWins', locale)}</h3>
            {#if history.length === 0}
              <p class="empty">{t('roulette.cash.emptyHistory', locale)}</p>
            {:else}
              <ul class="history">
                {#each history as spin (spin.timestamp)}
                  <li>
                    <div class="history-info">
                      <img class="history-icon" src={textureUrl(spin.icon)} alt={spin.label} loading="lazy" />
                    </div>
                    <span class="odds">+{formatAmountWithUnit(spin.reward.amount, spin.reward.type)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </section>

        <button class="primary modal-close-bottom" onclick={closeResultsModal}>{t('roulette.cash.closeBtn', locale)}</button>
      </div>
    </div>
  {/if}

  <aside class="odds-panel" class:collapsed={!showOdds}>
    <button class="odds-toggle" onclick={() => showOdds = !showOdds}>
      <div class="odds-toggle__title">
        <h3>{t('roulette.cash.theoreticalChances', locale)}</h3>
        <span class="badge badge--small">{t('roulette.cash.prizeCountBadge', locale).replace('{n}', String(rewardChances.length))}</span>
      </div>
      <span class="chevron">{showOdds ? '▼' : '▲'}</span>
    </button>

    {#if showOdds}
      <p class="odds-caption">{t('roulette.cash.oddsCaption', locale)}</p>
      <ul class="odds-list">
        {#each rewardChances as reward}
          <li>
            <span class="odds-name">
              <img class="odds-icon" src={textureUrl(reward.icon)} alt={reward.label} loading="lazy" />
              <span class="name">{reward.label}</span>
            </span>
            <span class="chance">{(reward.chance * 100).toFixed(4)}%</span>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
</div>


<style>
  .machine-shell {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: minmax(320px, 1fr) minmax(0, 2.2fr);
    align-items: start;
  }

  .machine-body {
    background: linear-gradient(160deg, rgba(253, 216, 112, 0.12), rgba(22, 27, 34, 0.92));
    border: 1px solid rgba(255, 202, 40, 0.25);
    border-radius: 32px;
    padding: 2rem;
    box-shadow: 0 24px 40px rgba(255, 193, 7, 0.18);
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .machine-header {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    color: rgba(248, 250, 252, 0.9);
  }

  .machine-header h2 {
    margin: 0;
    font-size: 2rem;
    color: #fceabb;
  }

  .machine-header p {
    margin: 0;
    line-height: 1.6;
    color: rgba(248, 250, 252, 0.75);
  }

  .machine-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 1rem;
    border-radius: 999px;
    background: rgba(255, 193, 7, 0.18);
    color: #ffd54f;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 0.78rem;
  }

  .control-panel {
    display: grid;
    gap: 1.35rem;
  }

  .input-group span {
    display: block;
    font-size: 0.95rem;
    color: #e5e7eb;
    margin-bottom: 0.45rem;
  }

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-wrapper input {
    width: 100%;
    padding: 0.8rem 3.5rem 0.8rem 1rem;
    border-radius: 14px;
    border: 1px solid rgba(255, 213, 79, 0.45);
    background: rgba(13, 17, 23, 0.88);
    color: #fceabb;
    font-size: 1.05rem;
    font-weight: 600;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .input-wrapper input:focus {
    outline: none;
    border-color: #ffd54f;
    box-shadow: 0 0 0 3px rgba(255, 213, 79, 0.25);
  }

  /* Скрытие стрелочек (spin buttons) для input type="number" */
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type=number] {
    -moz-appearance: textfield;
  }

  .suffix {
    position: absolute;
    right: 1rem;
    color: rgba(255, 248, 225, 0.7);
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  small {
    color: #e5e7eb;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    border: none;
    border-radius: 999px;
    padding: 0.85rem 1.8rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
  }

  button:disabled {
    cursor: progress;
    opacity: 0.65;
  }

  button.primary {
    background: linear-gradient(120deg, #ffd54f, #ff9100);
    color: #0d1117;
    box-shadow: 0 12px 28px rgba(255, 193, 7, 0.28);
  }

  button.primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 18px 32px rgba(255, 193, 7, 0.35);
  }

  button.ghost {
    background: rgba(255, 255, 255, 0.08);
    color: #f8fafc;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  button.ghost:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.25);
  }

  button.ghost.danger {
    border-color: rgba(255, 138, 101, 0.4);
    color: #ffab91;
  }

  button.ghost.danger:hover:not(:disabled) {
    background: rgba(255, 82, 82, 0.15);
    border-color: rgba(255, 138, 101, 0.65);
    color: #ffcdd2;
  }

  .error {
    margin: 0;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    background: rgba(255, 82, 82, 0.12);
    border: 1px solid rgba(255, 138, 101, 0.45);
    color: #ffab91;
  }

  .progress {
    display: grid;
    gap: 0.4rem;
    margin-top: -0.25rem;
  }

  .progress-bar {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.05);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #ffd54f, #ff9100);
    box-shadow: 0 0 10px rgba(255, 145, 0, 0.5);
    transition: width 0.2s ease-out;
    border-radius: 999px;
  }

  .progress-label {
    font-size: 0.85rem;
    color: rgba(255, 248, 225, 0.75);
    letter-spacing: 0.02em;
  }

  .stats {
    display: grid;
    gap: 1.15rem;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .stat-card {
    background: rgba(13, 17, 23, 0.82);
    border-radius: 18px;
    border: 1px solid rgba(255, 213, 79, 0.3);
    padding: 1.15rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .stat-card.metric,
  .stat-card.currency {
    background: rgba(13, 17, 23, 0.6);
    border-radius: 16px;
    border: 1px solid rgba(255, 213, 79, 0.18);
    padding: 0.95rem 1.1rem;
    display: flex;
    flex-direction: column; /* Вертикальная компоновка для лучшей центровки */
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-width: 0;
    text-align: center;
  }

  .stat-card.no-icon {
    justify-content: space-between;
    padding: 0.95rem 1.1rem;
  }

  .stat-card.spins {
    background: linear-gradient(150deg, rgba(255, 213, 79, 0.22), rgba(13, 17, 23, 0.92));
    border-color: rgba(255, 213, 79, 0.45);
  }

  .metric-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(255, 213, 79, 0.45);
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    border-radius: 14px;
    background: rgba(255, 213, 79, 0.16);
    display: grid;
    place-items: center;
  }

  .metric-icon img {
    width: 44px;
    height: 44px;
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  .stat-icon {
    width: 56px;
    height: 56px;
    object-fit: contain;
    width: 36px;
    height: 36px;
  }

  .stat-card.spins {
    background: linear-gradient(150deg, rgba(255, 213, 79, 0.18), rgba(13, 17, 23, 0.78));
    border-color: rgba(255, 213, 79, 0.3);
  }

  .stat-card.spins .metric-icon {
    background: rgba(255, 213, 79, 0.22);
  }

  .metric-body,
  .stat-body {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
    align-items: center; /* Центрируем содержимое по горизонтали */
    text-align: center;   /* Центрируем текст */
    flex: 1;             /* Занимаем всё свободное место */
  }

  .stat-card .label {
    display: block;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(248, 250, 252, 0.58);
    align-self: flex-start;
  }

  .stat-card strong {
    font-size: clamp(1.05rem, 0.9rem + 0.5vw, 1.45rem);
    color: #fceabb;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    gap: 0.25rem;
    min-width: 0;
    align-items: flex-start;
    text-align: left;
    color: rgba(252, 234, 187, 0.88);
  }

  .stat-card.currency .stat-body {
    align-items: flex-start;
  }

  .stat-card .label {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(252, 234, 187, 0.6);
  }

  .stat-card strong {
    font-size: clamp(1.05rem, 0.95rem + 0.55vw, 1.5rem);
    color: #ffe082;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.015em;
    white-space: nowrap;
  }

  .stat-card.currency.net.positive strong {
    color: #a5d6a7;
  }


  .stat-card.currency.net.negative strong {
    color: #ffab91;
  }

  .stat-icon,
  .reward-icon,
  .history-icon,
  .odds-icon {
    display: block;
  }

  .stat-card.net {
    background: linear-gradient(160deg, rgba(255, 213, 79, 0.2), rgba(13, 17, 23, 0.82));
    border: 1px solid rgba(255, 213, 79, 0.32);
    box-shadow: none;
  }

  .stat-card.net.positive strong {
    color: #d4ff6a;
  }

  .stat-card.net.negative strong {
    color: #ffab91;
  }

  .odds-panel h3 {
    margin: 0;
    color: #ffe082;
  }

  .odds-caption {
    margin: 0;
    color: rgba(248, 250, 252, 0.6);
    font-size: 0.9rem;
  }

  .odds-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.9rem;
  }

  .results-grid {
    display: grid;
    gap: 1.5rem;
    /* "Статистика призов" несёт 3 колонки данных против 2 у "Последних выигрышей" -
       ей нужен больший вес, иначе числа переносятся построчно даже на широких
       экранах (см. фикс max-width модалки ниже). */
    grid-template-columns: minmax(360px, 1.4fr) minmax(300px, 1fr);
    align-items: flex-start;
  }

  .panel {
    background: rgba(13, 17, 23, 0.78);
    border-radius: 20px;
    border: 1px solid rgba(255, 213, 79, 0.2);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: auto;
    flex: 0 0 auto;
    max-height: none;
  }

  .panel > h3 {
    flex-shrink: 0;
  }

  .panel > .table,
  .panel > .history,
  .panel > .empty {
    flex: 0 0 auto;
    max-height: none;
    overflow-y: visible;
  }

  .panel h3 {
    margin: 0;
    font-size: 1.2rem;
    color: #ffe082;
  }

  .table {
    display: grid;
    gap: 0.75rem;
  }

  .table-row {
    display: grid;
    grid-template-columns: minmax(6rem, 1fr) minmax(4rem, auto) minmax(7rem, auto);
    gap: 0.75rem;
    align-items: center;
    color: rgba(248, 250, 252, 0.85);
  }
  .table-row > span:last-child { text-align: right; }

  .table-row.head {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(248, 250, 252, 0.55);
  }

  .reward-label {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .reward-icon {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }

  .history {
    list-style: none;
    display: grid;
    gap: 0.65rem;
    padding: 0;
    margin: 0;
  }

  .history li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.06);
  }

  .history-info {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }

  .history-icon {
    width: 44px;
    height: 44px;
    object-fit: contain;
  }

  .odds-panel {
    background: rgba(13, 17, 23, 0.82);
    border-radius: 28px;
    border: 1px solid rgba(255, 213, 79, 0.22);
    padding: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    color: rgba(248, 250, 252, 0.85);
    transition: all 0.3s ease;
  }

  .odds-toggle {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }

  .odds-toggle__title {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .odds-panel h3 {
    margin: 0;
    font-size: 1.2rem;
    color: #ffe082;
  }

  .badge--small {
    font-size: 0.65rem;
    padding: 0.15rem 0.5rem;
    background: rgba(255, 213, 79, 0.1);
    color: rgba(255, 213, 79, 0.7);
    border-radius: 999px;
    width: fit-content;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .chevron {
    font-size: 1.2rem;
    color: rgba(255, 213, 79, 0.5);
    transition: transform 0.3s ease;
  }

  .odds-caption {
    margin: 0;
    color: rgba(248, 250, 252, 0.65);
    font-size: 0.92rem;
  }

  .odds-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.85rem;
  }

  .odds-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .odds-name {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .odds-icon {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }

  .odds-name .name {
    font-weight: 600;
    color: #fff8e1;
  }

  .chance {
    font-variant-numeric: tabular-nums;
    color: rgba(248, 250, 252, 0.7);
  }

  @media (max-width: 980px) {
    .machine-shell {
      grid-template-columns: minmax(0, 1fr);
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
    background: linear-gradient(160deg, rgba(253, 216, 112, 0.08), rgba(13, 17, 23, 0.97));
    border: 1px solid rgba(255, 202, 40, 0.25);
    border-radius: 28px;
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
    color: #fceabb;
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

  /* На Full HD/2K modal-content всё равно упирался в фикс max-width:900px, и
     .results-grid делил эту узкую ширину пополам - "Статистика призов" (3 колонки
     данных) не помещалась и переносила текст построчно, хотя на экране полно
     свободного места по бокам. */
  @media (min-width: 1440px) {
    .modal-content {
      max-width: 1160px;
    }
  }

  .modal-close-bottom {
    width: 100%;
    margin-top: 0.5rem;
  }

  /* Неравные minmax-колонки .results-grid (1.4fr/1fr, см. выше) не умеют сами
     схлопываться в 1 колонку как умел старый repeat(auto-fit, ...) - без этого
     правила модалка получала горизонтальный скролл в диапазоне ~640-860px,
     где сумма минимумов (360+300+gap) уже не помещается. */
  @media (max-width: 860px) {
    .results-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .odds-panel {
      padding: 1rem;
    }

    .odds-panel.collapsed {
      gap: 0;
    }

    .machine-body {
      padding: 1.25rem 1rem;
      border-radius: 24px;
      gap: 1.5rem;
    }

    .machine-header h2 {
      font-size: 1.5rem;
    }

    .machine-header p {
      font-size: 0.9rem;
    }

    .odds-panel {
      padding: 1.25rem 1rem;
      border-radius: 24px;
    }

    .stat-card {
      padding: 1rem;
    }

    .stat-card strong {
      font-size: 1.2rem;
    }

    .stats {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .results-grid {
      grid-template-columns: 1fr;
    }

    .panel {
      padding: 1.25rem 1rem;
    }

    .table-row {
      grid-template-columns: 1fr auto;
      gap: 0.5rem;
    }

    .table-row.head span:last-child,
    .table-row span:last-child {
      grid-column: 1 / -1;
      text-align: left;
      padding-left: 3rem;
      font-size: 0.85rem;
      color: rgba(248, 250, 252, 0.6);
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 0.4rem;
      margin-top: 0.2rem;
    }

    .table-row.head span:last-child {
      display: none;
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
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 12px;
    }

    .odds-list .chance {
      align-self: flex-end;
      font-size: 0.9rem;
      color: #ffd54f;
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
