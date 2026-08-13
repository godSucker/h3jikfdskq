<script lang="ts">
  import type { BasicReward, GachaDefinition } from '@/lib/reactor-gacha';
  import {
    GACHA_NAME_RU,
    STAR_ICON,
    getMutantName,
  } from '@/lib/reactor-gacha';
  import { textureUrl } from '@/lib/texture-cdn';
  import { pluralize } from '@/lib/utils';

  interface DecoratedReward extends BasicReward {
    name: string;
    texture: string | null;
  }

  interface SpinResult {
    item: BasicReward;
    costType: 'token' | 'hc';
    isCompletionReward: boolean;
    completedNow: boolean;
    completionTrigger?: string;
  }

  let { gachaId, gacha, baseTextures, completionTexture } = $props<{
    gachaId: string;
    gacha: GachaDefinition;
    baseTextures: Record<string, string | null>;
    completionTexture: string | null;
  }>();

  const gachaName = GACHA_NAME_RU[gachaId] ?? gachaId;

  const baseRewards: DecoratedReward[] = gacha.basic_elements.map((item) => ({
    ...item,
    name: getMutantName(item.specimen),
    texture: baseTextures[item.specimen] ?? null,
  }));

  const baseSpecimenIds = new Set(baseRewards.map((reward) => reward.specimen));

  let unlocked = $state(new Set<string>());
  let unlockedBaseCount = $state(0);
  let completed = $state(false);
  let completionGranted = $state(false);
  let completionTrigger: string | null = $state(null);
  let lastResult: SpinResult | null = $state(null);

  // STATS
  let tokensSpent = $state(0);
  let goldSpent = $state(0);
  let tokenSpins = $state(0);
  let goldSpins = $state(0);
  let inventory = $state(new Map<string, number>());
  let history: SpinResult[] = $state([]);

  let totalSpins = $derived(tokenSpins + goldSpins);

  const totalUniqueBaseRewards = baseSpecimenIds.size || baseRewards.length;

  let progressPercent = $derived(totalUniqueBaseRewards ? Math.round((unlockedBaseCount / totalUniqueBaseRewards) * 100) : 0);
  let progressSummary = $derived(totalUniqueBaseRewards ? `${unlockedBaseCount} / ${totalUniqueBaseRewards}` : '0 / 0');

  const completionReward: DecoratedReward | null = gacha.completion_reward
    ? {
        ...gacha.completion_reward,
        name: getMutantName(gacha.completion_reward.specimen),
        texture: completionTexture ?? null,
      }
    : null;

  const rewardDisplay = new Map<string, DecoratedReward>();
  for (const reward of baseRewards) {
    rewardDisplay.set(reward.specimen, reward);
  }
  if (completionReward) {
    rewardDisplay.set(completionReward.specimen, completionReward);
  }

  // --- ЛОГИКА ШАНСОВ ---
  
  // Пул наград для расчета (меняется, когда выпадает Зевс)
  let currentPool = $derived.by(() => {
      let pool = [...gacha.basic_elements];
      if (completionGranted && completionReward) {
          pool.push(completionReward);
      }
      return pool;
  });

  // Сумма весов пула (знаменатель)
  let weightDenominator = $derived(currentPool.reduce((sum, item) => sum + item.odds, 0));
  
  // Хелпер для получения названия и текстуры
  const getRewardName = (id: string) => rewardDisplay.get(id)?.name ?? getMutantName(id);
  const getRewardTexture = (id: string) => rewardDisplay.get(id)?.texture ?? null;

  // weightDenominator может быть 0, если пул наград пуст (в теории для
  // некорректных данных гачи) - без гарда деление даёт NaN%, тот же паттерн
  // guard'а, что уже используется в остальных симуляторах (cash/lucky/madness/craft).
  const oddsPercent = (odds: number) => (weightDenominator > 0 ? (odds / weightDenominator) * 100 : 0);

  function updateUnlocked(specimenId: string): boolean {
    if (unlocked.has(specimenId)) return false;
    const next = new Set(unlocked);
    next.add(specimenId);
    unlocked = next;

    let completedNow = false;
    if (baseSpecimenIds.has(specimenId)) {
      unlockedBaseCount += 1;
      if (!completed && unlockedBaseCount >= totalUniqueBaseRewards) {
        completed = true;
        completedNow = true;
        completionTrigger = getMutantName(specimenId);
      }
    }
    return completedNow;
  }

  function registerResult(result: SpinResult, chargeCost: boolean = true) {
    lastResult = result;
    if (chargeCost) {
      if (result.costType === 'token') {
        tokensSpent += gacha.token_cost;
        tokenSpins += 1;
      } else {
        goldSpent += gacha.hc_cost;
        goldSpins += 1;
      }
    }

    const key = result.item.specimen;
    inventory.set(key, (inventory.get(key) || 0) + 1);
    inventory = new Map(inventory);
    history = [result, ...history].slice(0, 10);
  }

  function rollWeighted(pool: BasicReward[], totalW: number): BasicReward {
      let threshold = Math.random() * totalW;
      for (const item of pool) {
          threshold -= item.odds;
          if (threshold <= 0) return item;
      }
      return pool[pool.length - 1];
  }

  function spin(costType: 'token' | 'hc') {
    if (costType === 'token') {
      const reward = rollWeighted(currentPool, weightDenominator);
      const wasCompleted = completed;
      const completedNow = updateUnlocked(reward.specimen);
      const completionJustNow = completedNow || (!wasCompleted && completed);
      
      registerResult({
        item: reward,
        costType: 'token',
        isCompletionReward: completionReward ? reward.specimen === completionReward.specimen : false,
        completedNow: completionJustNow,
        completionTrigger: completionJustNow ? reward.specimen : undefined,
      });

      if (completionJustNow) {
        grantCompletionReward('token', reward.specimen);
      }
    } else {
      let reward: BasicReward | null = null;
      let trigger: string | undefined = undefined;

      for (const item of gacha.basic_elements) {
        if (!unlocked.has(item.specimen)) {
          reward = item;
          trigger = item.specimen;
          break;
        }
      }

      if (!reward) {
          if (!completed) completed = true;
          if (completionReward && !completionGranted) {
              reward = completionReward;
          } else {
              reward = rollWeighted(currentPool, weightDenominator);
          }
      }

      const wasCompleted = completed;
      const completedNow = updateUnlocked(reward.specimen);
      const completionJustNow = completedNow || (!wasCompleted && completed);
      
      registerResult({
        item: reward,
        costType: 'hc',
        isCompletionReward: completionReward ? reward.specimen === completionReward.specimen : false,
        completedNow: completionJustNow,
        completionTrigger: completionJustNow ? trigger ?? reward.specimen : undefined,
      });

      if (completionJustNow) {
        grantCompletionReward('hc', trigger ?? reward.specimen);
      }
    }
  }

  function grantCompletionReward(costType: 'token' | 'hc', trigger?: string) {
    if (!completionReward || completionGranted) return;
    completionGranted = true;
    updateUnlocked(completionReward.specimen);
    registerResult({
      item: completionReward,
      costType,
      isCompletionReward: true,
      completedNow: true,
      completionTrigger: trigger ?? completionReward.specimen,
    }, false);
    if (!completionTrigger) {
      completionTrigger = getMutantName(trigger ?? completionReward.specimen);
    }
  }
</script>

<div class="reactor-layout">
  <div class="reactor-stage">
    <div class="stage-header">
      <div class="header-info">
        <h1>{gachaName}</h1>
        <p>Соберите коллекцию из {baseRewards.length} {pluralize(baseRewards.length, 'мутант', 'мутанта', 'мутантов')}.</p>
      </div>
      <div class="header-progress">
        <span>{progressSummary}</span>
        <div class="header-meter">
          <div class="header-fill" style={`width: ${progressPercent}%`}></div>
        </div>
      </div>
    </div>

    <div class="slot-track">
      {#each baseRewards as reward (reward.specimen)}
        <div class={`slot-card ${unlocked.has(reward.specimen) ? 'unlocked' : ''} ${lastResult?.item.specimen === reward.specimen ? 'active' : ''}`}>
          <div class="slot-inner">
            <div class="slot-top">
              {#if STAR_ICON[reward.stars]}
                <img class="slot-stars" src={textureUrl(STAR_ICON[reward.stars])} alt="Звёзды награды" />
              {/if}
              <!-- ПРЯМОЙ РАСЧЕТ ШАНСА В ВЕРСТКЕ ДЛЯ ГАРАНТИИ ПЕРЕСЧЕТА -->
              <span class="slot-odds">{oddsPercent(reward.odds).toFixed(2)}%</span>
            </div>
            <div class="slot-art">
              {#if reward.texture}
                <img src={textureUrl(reward.texture ?? '')} alt={reward.name} loading="lazy" />
              {:else}
                <span class="slot-placeholder">?</span>
              {/if}
            </div>
            <div class="slot-name">{reward.name}</div>
          </div>
          {#if unlocked.has(reward.specimen)}
            <div class="slot-overlay-check"><span class="check-icon">✔</span></div>
          {/if}
        </div>
      {/each}

      {#if completionReward}
        <div class={`slot-card completion ${completed ? 'unlocked' : ''} ${lastResult?.item.specimen === completionReward.specimen ? 'active' : ''}`}>
          <div class="slot-inner">
            <div class="slot-top">
              <span class="completion-label">Награда</span>
              <span class="slot-odds">
                {#if completionGranted}
                    {oddsPercent(completionReward.odds).toFixed(2)}%
                {:else}
                    ---
                {/if}
              </span>
            </div>
            <div class="slot-art">
              {#if completionReward.texture}
                <img src={textureUrl(completionReward.texture ?? '')} alt={completionReward.name} loading="lazy" />
              {:else}
                <span class="slot-placeholder">?</span>
              {/if}
            </div>
            <div class="slot-name">{completionReward.name}</div>
          </div>
          {#if completed}
            <div class="slot-overlay-check"><span class="check-icon">★</span></div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="stage-controls">
      <div class="cost-line">
        <div class="cost-pill"><span>Жетоны</span> <strong>{gacha.token_cost}</strong></div>
        <div class="cost-pill"><span>Золото</span> <strong>{gacha.hc_cost}</strong></div>
      </div>
      <div class="spin-buttons">
        <button class="spin token" onclick={() => spin('token')}>Крутить ({gacha.token_cost} Ж)</button>
        <button class="spin hc" onclick={() => spin('hc')}>Крутить ({gacha.hc_cost} З)</button>
      </div>
    </div>
  </div>

  <aside class="info-panel">
    <div class="info-card stats-card">
        <h3 class="stats-title">Статистика</h3>
        <div class="stats-total">
            <span class="total-label">Сделано прокрутов:</span>
            <span class="total-val">{totalSpins}</span>
        </div>
        <div class="stats-row">
            <div class="stat-item"><span class="stat-label">Жетонов:</span><span class="stat-val token">{tokensSpent}</span></div>
            <div class="stat-item"><span class="stat-label">Золота:</span><span class="stat-val hc">{goldSpent}</span></div>
        </div>
        {#if inventory.size > 0}
            <div class="inventory-list custom-scroll">
                {#each [...inventory.entries()].sort((a,b) => b[1] - a[1]) as [id, count]}
                    <div class="inv-item">
                        <div class="inv-thumb"><img src={textureUrl(getRewardTexture(id) || '')} alt="Текстура награды"/></div>
                        <div class="inv-name">{getRewardName(id)}</div>
                        <div class="inv-count">x{count}</div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    {#if lastResult}
      <div class="info-card result-card">
        <header>
          <span class={`badge ${lastResult.costType === 'token' ? 'token' : 'hc'}`}>{lastResult.costType === 'token' ? 'Жетон' : 'Золото'}</span>
          {#if lastResult.isCompletionReward}<span class="badge completion">🏆</span>{/if}
        </header>
        <div class="result-body">
          <div class="result-art-wrapper">
             <img class="result-art" src={textureUrl(getRewardTexture(lastResult.item.specimen) ?? '')} alt="Итоговая награда"/>
          </div>
          <div class="result-info">
            <h3>{getRewardName(lastResult.item.specimen)}</h3>
            <p>Шанс: {oddsPercent(lastResult.item.odds).toFixed(2)}%</p>
            {#if lastResult.completedNow}<p class="result-complete">Собрано!</p>{/if}
          </div>
        </div>
      </div>
    {/if}

    {#if history.length}
      <div class="info-card history-card">
        <h3>История</h3>
        <ul>
          {#each history as entry}
            <li>
              <div class="history-thumb">
                 <img src={textureUrl(getRewardTexture(entry.item.specimen) ?? '')} alt="Иконка награды"/>
              </div>
              <div class="history-main">
                <div class="history-name">{getRewardName(entry.item.specimen)}</div>
                <div class="history-meta">
                  <span class={`mini-badge ${entry.costType === 'token' ? 'token' : 'hc'}`}>{entry.costType === 'token' ? 'Ж' : 'З'}</span>
                  {#if entry.isCompletionReward}<span class="history-flag">🏆</span>{/if}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </aside>
</div>

<style>
  .reactor-layout { display: grid; grid-template-columns: minmax(0, 5fr) minmax(225px, 1fr); gap: 2rem; align-items: start; }
  .reactor-stage {
    padding: 2rem;
    border-radius: 24px;
    /* UPDATED: Use gacha_background.webp texture */
    background-image: url('https://cdn.archivist-library.com/reactor/gacha_background.webp');
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    /* Dark overlay for better text contrast */
    position: relative;
    border: 1px solid rgba(59, 130, 246, 0.25);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
  }

  /* Dark overlay for better readability */
  .reactor-stage::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 24px;
    pointer-events: none;
    z-index: 0;
  }

  /* Ensure content is above overlay */
  .reactor-stage > * {
    position: relative;
    z-index: 1;
  }
  .stage-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
  .stage-header h1 { margin: 0; font-size: 1.8rem; color: #f1f5f9; }
  .stage-header p { margin: 0.25rem 0 0; color: #e5e7eb; font-size: 0.9rem; }
  .header-progress { min-width: 160px; text-align: right; }
  .header-progress span { color: #cbd5f5; font-size: 0.85rem; display: block; margin-bottom: 4px; }
  .header-meter { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.1); overflow: hidden; }
  .header-fill { height: 100%; background: #3b82f6; transition: width 0.3s; }
  .slot-track { display: flex; gap: 0.5rem; padding-bottom: 10px; flex-wrap: nowrap; }
  .slot-card { flex: 0 0 130px; background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: var(--radius-lg); position: relative; transition: all 0.2s; }
  .slot-card.unlocked { background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.5); }
  .slot-card.active { transform: translateY(-4px); border-color: #facc15; box-shadow: 0 0 15px rgba(250, 204, 21, 0.3); }
  .slot-inner { padding: 0.5rem; display: flex; flex-direction: column; align-items: center; text-align: center; height: 100%; }
  .slot-top { display: flex; justify-content: space-between; width: 100%; margin-bottom: 4px; font-size: 0.65rem; color: #94a3b8; }
  .slot-stars { height: 14px; }
  .slot-odds { font-weight: 600; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 4px; }
  .slot-art { width: 100%; height: 95px; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; border-radius: var(--radius-lg); }
  .slot-art img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 4px 4px rgba(0,0,0,0.5)); }
  .slot-placeholder { color: #475569; font-size: 1.5rem; }
  .slot-name { font-size: 0.8rem; font-weight: 600; color: #e2e8f0; line-height: 1.2; margin-bottom: auto; }
  .slot-overlay-check { position: absolute; inset: 0; background: rgba(16, 185, 129, 0.1); border-radius: var(--radius-md); pointer-events: none; display: flex; align-items: start; justify-content: end; padding: 6px; }
  .check-icon { background: #10b981; color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
  .slot-card.completion { border-color: #eab308; background: rgba(234, 179, 8, 0.1); }
  .stage-controls { margin-top: 2rem; }
  .cost-line { display: flex; gap: 1rem; margin-bottom: 1rem; }
  .cost-pill { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); padding: 0.5rem 1rem; border-radius: var(--radius-sm); font-size: 0.85rem; color: #cbd5f5; display: flex; gap: 0.5rem; align-items: center; }
  .cost-pill strong { color: #fff; font-size: 1rem; }
  .spin-buttons { display: flex; gap: 1rem; }
  .spin { flex: 1; padding: 0.85rem; border: none; border-radius: var(--radius-md); font-weight: 700; font-size: 0.95rem; cursor: pointer; color: #0f172a; transition: filter 0.2s; }
  .spin.token { background: #22d3ee; }
  .spin.hc { background: #fbbf24; }
  .spin:hover { filter: brightness(1.1); }
  .info-panel { display: flex; flex-direction: column; gap: 0.75rem; }
  .info-card { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255,255,255,0.05); border-radius: var(--radius-lg); padding: 0.75rem; overflow: hidden; }
  .info-card h2, .info-card h3 { margin: 0 0 0.6rem; font-size: 0.75rem; color: #e2e8f0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
  .stats-title { text-align: center; display: block; margin-bottom: 0.5rem; font-size: 0.75rem; }
  .stats-total { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; margin-bottom: 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .total-label { font-size: 0.8rem; color: #cbd5f5; font-weight: 500; }
  .total-val { font-size: 1rem; font-weight: 700; color: #f1f5f9; }
  .stats-row { display: flex; gap: 1rem; margin-bottom: 0.75rem; padding-bottom: 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .stat-item { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .stat-label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 500; }
  .stat-val { font-size: 1.2rem; font-weight: 700; }
  .stat-val.token { color: #22d3ee; }
  .stat-val.hc { color: #fbbf24; }
  .inventory-list { display: flex; flex-direction: column; gap: 6px; }
  .inv-item { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.2); padding: 6px; border-radius: var(--radius-sm); }
  .inv-thumb { width: 40px; height: 40px; flex-shrink: 0; }
  .inv-thumb img { width: 100%; height: 100%; object-fit: contain; }
  .inv-name { flex: 1; font-size: 0.8rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .inv-count { font-size: 0.85rem; font-weight: 700; color: #84cc16; }
  .result-card { background: rgba(15, 23, 42, 0.8); border-color: #3b82f6; padding: 0.6rem; }
  .result-body { display: flex; gap: 0.6rem; align-items: center; margin-top: 0.3rem; }
  .result-art-wrapper { width: 72px; height: 72px; background: rgba(0,0,0,0.3); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; }
  .result-art { max-width: 90%; max-height: 90%; }
  .result-info h3 { color: #fff; font-size: 1rem; margin-bottom: 0.2rem; }
  .result-info p { margin: 0; font-size: 0.85rem; color: #cbd5f5; }
  .badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: #334155; color: #94a3b8; margin-right: 6px; }
  .history-card ul { list-style: none; padding: 0; margin: 0; }
  .history-card li { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .history-card li:last-child { border-bottom: none; }
  .history-thumb { width: 48px; height: 48px; background: rgba(0,0,0,0.2); border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .history-thumb img { max-width: 85%; max-height: 85%; }
  .history-name { font-size: 0.85rem; color: #e2e8f0; font-weight: 500; }
  .history-meta { display: flex; gap: 0.5rem; font-size: 0.75rem; color: #64748b; }
  .mini-badge { font-size: 0.7rem; font-weight: bold; }
  .mini-badge.token { color: #22d3ee; }
  .mini-badge.hc { color: #fbbf24; }
  @media (max-width: 1023px) {
    .reactor-layout {
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }
    .info-panel {
      /* Удаляем order: -1, чтобы info-panel следовал за reactor-stage в DOM порядке */
      flex-direction: column; /* Размещаем элементы info-panel в столбец */
      gap: 1rem; /* Отступ между элементами */
    }
    .info-panel .stats-card { order: 1; }
    .info-panel .result-card { order: 2; }
    .info-panel .history-card { order: 3; }

    .reactor-stage {
      padding: 1rem;
    }
    .stage-header {
      flex-direction: column;
      gap: 0.75rem;
    }
    .header-progress {
      width: 100%;
      text-align: left;
    }
    .slot-track {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin: 1.5rem 0;
      overflow: visible;
      padding-bottom: 0;
    }
    .slot-card {
      flex: none;
      max-width: none;
      width: auto;
    }
    .slot-card.completion {
      grid-column: 1 / -1;
      background: rgba(234, 179, 8, 0.15);
    }
    .slot-inner {
      padding: 0.5rem;
    }
    .slot-name {
      font-size: 0.75rem;
      margin-top: 4px;
    }
    .slot-art {
      height: 80px;
    }
    .spin-buttons {
      flex-direction: column;
      gap: 0.75rem;
    }
    .spin {
      padding: 1rem;
    }
  }
</style>
