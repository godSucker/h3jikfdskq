<script lang="ts">
  import { secretCombos } from '@/lib/secretCombos';
  import mutantsAll from '@/data/mutants/mutants.json';
  import { calculateBreeding, findParentsFor, calculateDuration, recommendedScore } from '@/lib/breeding/breeding';
  import type { Mutant, BreedingResult, BuildingLevel, StarLevel } from '@/lib/breeding/breeding';
  import { fly, fade, slide } from 'svelte/transition';
  import { normalizeSearch } from '@/lib/search-normalize';
  import { isBreedableLegend } from '@/lib/breeding/type-filters';
  import { sortMutantsByGene } from '@/lib/mutant-sort';
  import { textureUrl } from '@/lib/texture-cdn';
  import { getGeneIcon as getGeneIconPath, getTypeIcon as getTypeIconPath } from '@/lib/mutant-icons';
  import { t, type Locale } from '@/lib/i18n';
  import type { MutantNameEntry } from '@/lib/mutant-names-i18n';

  let {
    locale = 'ru' as Locale,
    names = {},
  }: { locale?: Locale; names?: Record<string, MutantNameEntry> } = $props();

  // --- DATA ---
  const allMutants: Mutant[] = (mutantsAll as any[]).map((m: any) => ({
    id: String(m.id),
    name: m.name,
    genes: m.genes,
    chance: Number(m.chance) || 0,
    type: m.type || 'default',
    incub_time: Number(m.incub_time) || 0,
    stars: m.stars || {},
    image: (() => { const s = m.stars; if (s) { const k = Object.keys(s); if (k.length) return s[k[0]]?.images ?? []; } return m.image ?? []; })()
  }));

  const normalize = normalizeSearch;
  const secretNames = new Set(secretCombos.map(s => normalize(s.childName)));

  // --- HELPERS ---
  const getName = (m: Mutant) => names[m.id]?.name || m.name || m.id;

  function getImageSrc(m: Mutant): string {
    const img = m.image;
    const list = Array.isArray(img) ? img : (img ? [img] : []);
    if (!list.length) return textureUrl('/preview.jpg');
    const specimen = list.find((p: string) => p.includes('specimen'));
    if (specimen) return textureUrl(specimen);
    const first = list[0];
    return textureUrl(first);
  }

  // Иконки генов/типов — единый источник: src/lib/mutant-icons.ts
  function getGeneIcon(geneChar: string): string {
    return textureUrl(getGeneIconPath(geneChar.charAt(0)) ?? '/genes/gene_all.webp');
  }

  function getTypeIcon(m: Mutant): string {
    return textureUrl(getTypeIconPath(m.type) ?? '/mut_icons/icon_morphology.webp');
  }

  function formatTime(seconds: number): string {
    if (!seconds || seconds <= 0) return '-';
    const hUnit = t('breeding.unit.hour', locale);
    const mUnit = t('breeding.unit.minute', locale);
    const sUnit = t('breeding.unit.second', locale);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}${hUnit}`);
    if (m > 0) parts.push(`${m}${mUnit}`);
    if (s > 0 && h === 0) parts.push(`${s}${sUnit}`);
    return parts.join(' ') || '-';
  }

  function formatMinutes(minutes: number): string {
    if (!minutes || minutes <= 0) return '-';
    const hUnit = t('breeding.unit.hour', locale);
    const mUnit = t('breeding.unit.minute', locale);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}${hUnit} ${m}${mUnit}`;
    if (h > 0) return `${h}${hUnit}`;
    return `${m}${mUnit}`;
  }

  // Star timer multiplier: same as in breeding.ts
  const STAR_TIMER_MULT: Record<StarLevel, number> = {
    0: 1.0, 1: 1.5, 2: 2.0, 3: 3.0, 4: 1.0,
  };

  function getIncubTime(mutant: Mutant, star: StarLevel): number {
    const base = Number(mutant.incub_time) || 0;
    return Math.round(base * STAR_TIMER_MULT[star]);
  }

  function getGeneCode(mutant: Mutant): string {
    const g = Array.isArray(mutant.genes) ? mutant.genes.join('') : (mutant.genes || '');
    return g.toUpperCase();
  }

  function formatProb(prob: number): string {
    if (prob >= 100) return '100%';
    if (prob >= 10) return `${prob.toFixed(1)}%`;
    if (prob >= 1) return `${prob.toFixed(1)}%`;
    return `${prob.toFixed(2)}%`;
  }

  // --- STATE ---
  let mode: 'calc' | 'reverse' = $state('calc');
  let mobileTab: 'lab' | 'list' = $state('lab');

  let p1: Mutant | null = $state(null);
  let p2: Mutant | null = $state(null);
  let target: Mutant | null = $state(null);
  let search = $state('');
  let filterGene = $state('all');
  let filterGene2 = $state('all');

  // Breeding settings
  let buildingLevel: BuildingLevel = $state(3);
  let resultStar: StarLevel = $state(0);
  let showStarDropdown = $state(false);

  const starNames: Record<StarLevel, string> = $derived({
    0: t('breeding.star.none', locale),
    1: t('breeding.star.bronze', locale),
    2: t('breeding.star.silver', locale),
    3: t('breeding.star.gold', locale),
    4: t('breeding.star.platinum', locale),
  });

  // Declined forms for error messages (RU needs the accusative case; other
  // locales reuse the nominative form since they don't decline nouns here).
  const starNamesAcc: Record<StarLevel, string> = $derived({
    0: '',
    1: t('breeding.star.acc.bronze', locale),
    2: t('breeding.star.acc.silver', locale),
    3: t('breeding.star.acc.gold', locale),
    4: t('breeding.star.acc.platinum', locale),
  });

  const starIcons: Record<StarLevel, string> = {
    0: '/stars/no_stars.webp',
    1: '/stars/star_bronze.webp',
    2: '/stars/star_silver.webp',
    3: '/stars/star_gold.webp',
    4: '/stars/star_platinum.webp',
  };

  const STAR_MIN_LEVEL: Record<StarLevel, number> = {
    0: 0,
    1: 10,
    2: 15,
    3: 20,
    4: 30,
  };

  function hasStarUpgrades(mutant: Mutant): boolean {
    const stars = (mutant as any).stars;
    return stars && Object.keys(stars).length > 1;
  }

  function selectResultStar(star: StarLevel) {
    if (star === 4) {
      // Platinum: only for 2 identical mutants with star upgrades
      if (!p1 || !p2) {
        showStarDropdown = false;
        return;
      }
      if (p1.id !== p2.id) {
        notify(t('breeding.notify.platinumSameOnly', locale));
        showStarDropdown = false;
        return;
      }
      if (!hasStarUpgrades(p1)) {
        notify(t('breeding.notify.platinumNoStars', locale).replace('{name}', getName(p1)));
        showStarDropdown = false;
        return;
      }
    } else if (star > 1) {
      // Silver / Gold: parents must have star upgrades
      if (p1 && !hasStarUpgrades(p1)) {
        notify(t('breeding.notify.starNoStars', locale).replace('{star}', starNamesAcc[star]).replace('{name}', getName(p1)));
        showStarDropdown = false;
        return;
      }
      if (p2 && !hasStarUpgrades(p2)) {
        notify(t('breeding.notify.starNoStars', locale).replace('{star}', starNamesAcc[star]).replace('{name}', getName(p2)));
        showStarDropdown = false;
        return;
      }
    }
    resultStar = star;
    showStarDropdown = false;
  }

  function toggleStarDropdown() {
    showStarDropdown = !showStarDropdown;
  }

  // Close dropdown on outside click
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.star-dropdown-wrapper')) {
      showStarDropdown = false;
    }
  }

  $effect(() => {
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });

  let notificationMessage = $state('');
  let showNotification = $state(false);
  let notificationTimeout: ReturnType<typeof setTimeout> | null = null;

  function notify(msg: string) {
    notificationMessage = msg;
    showNotification = true;
    if (notificationTimeout) clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => { showNotification = false; }, 4000);
  }

  const getGenesArray = (m: Mutant) => {
      const gStr = Array.isArray(m.genes) ? m.genes.join('') : m.genes;
      return (gStr || '').toUpperCase().split('');
  };

  const getAllGenes = (m: Mutant): string[] => {
      const genes = getGenesArray(m);
      if (genes.length === 1) return [genes[0]];
      return genes;
  };

  $effect(() => {
    if (filterGene === 'all') filterGene2 = 'all';
  });

  let filteredList = $derived(allMutants.filter(m => {
    if (filterGene === 'recipe') return secretNames.has(normalize(getName(m)));

    const normalizedSearch = normalizeSearch(search);
    const nameMatch = !normalizedSearch || normalizeSearch(getName(m)).includes(normalizedSearch);

    const mGenes = getGenesArray(m);

    if (filterGene === 'all') return nameMatch;

    const hasPrimaryGene = mGenes[0] === filterGene.toUpperCase();

    if (filterGene2 === 'all') return hasPrimaryGene && nameMatch;

    if (filterGene2 === 'neutral') {
      return mGenes.length === 1 && mGenes[0] === filterGene.toUpperCase() && nameMatch;
    }

    return mGenes.length >= 2 && mGenes[0] === filterGene.toUpperCase() && mGenes[1] === filterGene2.toUpperCase() && nameMatch;
  }).sort(sortMutantsByGene));

  // --- LOGIC ---
  let calcResults: BreedingResult[] = $state([]);

  $effect(() => {
    if (mode === 'calc' && p1 && p2) {
      calcResults = calculateBreeding(p1, p2, allMutants, buildingLevel, resultStar, resultStar)
        .sort((a, b) => {
          // Secrets first, then by gene code
          if (a.isSecret !== b.isSecret) return a.isSecret ? -1 : 1;
          return getGeneCode(a.child).localeCompare(getGeneCode(b.child));
        });
    } else {
      calcResults = [];
    }
  });

  let guideResults: any[] = $state([]);
  let isSearching = $state(false);
  let allSecrets = $derived(guideResults.length > 0 && guideResults.every((r: any) => r.isSecret));
  let sortField: 'duration' | 'probability' | 'recommended' = $state('recommended');
  let sortAsc = $state(true);
  let showAll = $state(false);
  let reverseStar: StarLevel = $state(0);
  let easyMode = $state(false);
  let easyModalOpen = $state(false);

  const TOP_N = 15;

  // "Доступные мутанты" - пул для лёгкой прогрессии: сам целевой мутант (любой
  // тип), Обычные/Начальные, выводимые легендарки (BREEDABLE_LEGENDS) и два
  // именных исключения (Ксенарахнид - первый дивизион, Ориас - за регу в FB).
  const EASY_MODE_EXTRA = new Set([normalizeSearch('Ксенарахнид'), normalizeSearch('Ориас')]);
  function isEasyModePool(m: Mutant): boolean {
    if (!target) return true;
    if (String(m.id) === String(target.id)) return true;
    if ((m.type || 'default').toLowerCase() === 'default') return true;
    if (isBreedableLegend(m.name)) return true;
    if (EASY_MODE_EXTRA.has(normalizeSearch(m.name))) return true;
    return false;
  }
  function passesEasyMode(r: any): boolean {
    return !easyMode || (isEasyModePool(r.p1) && isEasyModePool(r.p2));
  }

  const byRecommended = $derived(() => {
    const sorted = guideResults.filter((r: any) => !r.isSecret && passesEasyMode(r)).sort((a, b) =>
      recommendedScore(b.probability, b.duration) - recommendedScore(a.probability, a.duration)
    );
    return sorted.slice(0, 200);
  });

  const byTime = $derived(() => {
    const sorted = guideResults.filter((r: any) => !r.isSecret && passesEasyMode(r)).sort((a, b) => {
      const cmp = a.duration !== b.duration ? a.duration - b.duration : b.probability - a.probability;
      return sortAsc ? cmp : -cmp;
    });
    return sorted.slice(0, 200);
  });

  const byProbability = $derived(() => {
    const sorted = guideResults.filter((r: any) => !r.isSecret && passesEasyMode(r)).sort((a, b) => {
      const cmp = b.probability !== a.probability ? b.probability - a.probability : a.duration - b.duration;
      return sortAsc ? cmp : -cmp;
    });
    return sorted.slice(0, 200);
  });

  const EASY_MODE_HINT_KEY = 'breeding_easy_mode_hint_seen';
  function toggleEasyMode() {
    easyMode = !easyMode;
    if (easyMode) {
      // Подсказку показываем один раз за вход в раздел (за вкладку/сессию),
      // не при каждом включении фильтра.
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(EASY_MODE_HINT_KEY)) {
        easyModalOpen = true;
        sessionStorage.setItem(EASY_MODE_HINT_KEY, '1');
      }
      sortField = 'recommended';
      sortAsc = true;
    }
    showAll = false;
  }

  let tabCount = $derived(() => {
    if (allSecrets) return guideResults.length;
    const base = sortField === 'recommended' ? byRecommended() :
                 sortField === 'duration' ? byTime() : byProbability();
    return base.length;
  });

  let sortedGuideResults = $derived(() => {
    const base = sortField === 'recommended' ? byRecommended() :
                 sortField === 'duration' ? byTime() : byProbability();
    const secrets = guideResults.filter((r: any) => r.isSecret);
    const combined = [...secrets, ...base];
    return showAll ? combined : combined.slice(0, TOP_N);
  });

  function toggleSort(field: 'duration' | 'probability' | 'recommended') {
    if (field === 'recommended') {
      sortField = 'recommended';
      sortAsc = true;
    } else if (sortField === field) {
      sortAsc = !sortAsc;
    } else {
      sortField = field;
      sortAsc = true;
    }
    showAll = false;
  }

  // При смене целевого мутанта фильтр "Доступные мутанты" сбрасывается
  // на "Рекомендуемое" - фильтр не должен молча переезжать на нового мутанта.
  let lastTargetId: string | null = $state(null);
  $effect(() => {
    const tid = target?.id ?? null;
    if (tid !== lastTargetId) {
      lastTargetId = tid;
      if (easyMode) {
        easyMode = false;
        sortField = 'recommended';
        sortAsc = true;
      }
    }
  });

  $effect(() => {
    if (mode === 'reverse' && target) {
      const bl = buildingLevel;
      const rs = reverseStar;
      isSearching = true;
      guideResults = [];
      setTimeout(() => {
          if (!target) return;
          const res = findParentsFor(target, allMutants, bl, rs, rs);
          guideResults = res.map(r => ({
              p1: r.p1, p2: r.p2, isSecret: r.isSecret,
              duration: r.duration, probability: r.probability,
              tag: r.isSecret ? 'РЕЦЕПТ' : 'ПАРЫ'
          }));
          isSearching = false;
      }, 100);
    }
  });

  function handleCardClick(m: Mutant) {
    const isSecret = secretNames.has(normalize(getName(m)));

    if (window.innerWidth < 1024) {
        mobileTab = 'lab';
    }

    if (filterGene === 'recipe' || (isSecret && mode === 'reverse')) {
        mode = 'reverse'; target = m; return;
    }
    if (mode === 'calc') {
      if (!p1) p1 = m;
      else if (!p2) p2 = m;
      else if (p1.id === m.id) p1 = null;
      else if (p2?.id === m.id) p2 = null;
      else { p1 = m; p2 = null; }
    } else {
      target = (target?.id === m.id) ? null : m;
    }
  }
</script>

<div class="main-wrapper">
  <!-- LEFT PANEL: LABORATORY -->
  <div class="panel lab-panel {mobileTab === 'lab' ? 'active' : ''}">
    <div class="panel-header">
      <div class="logo-area">
         <div class="logo-icon">🧬</div>
         <div>
             <h1>MGG <span class="highlight">Breeder</span></h1>
             <div class="subtitle">Genetics Simulator</div>
         </div>
      </div>

      <div class="mode-switch-desktop">
         <button class="mode-btn {mode==='calc' ? 'active' : ''}" onclick={() => {mode='calc'; target=null}}>
             {t('breeding.mode.calc', locale)}
         </button>
         <button class="mode-btn {mode==='reverse' ? 'active' : ''}" onclick={() => {mode='reverse'; p1=null; p2=null}}>
             {t('breeding.mode.reference', locale)}
         </button>
      </div>

      <button class="mode-switch-mobile" onclick={() => {
          if (mode === 'reverse') {
              mode = 'calc';
              target = null;
          } else {
              mode = 'reverse';
              p1 = null; p2 = null;
          }
      }}>
          {mode === 'calc' ? t('breeding.mode.reference', locale) : t('breeding.mode.switchToCalc', locale)}
      </button>
    </div>

    <div class="workspace custom-scroll">
        {#if mode === 'calc'}
            <div class="calc-container" in:fly={{y:20, duration:400}}>
                <!-- BUILDING LEVEL SELECTOR -->
                <div class="building-level-bar">
                    <span class="building-label">{t('breeding.buildingLevel.label', locale)}</span>
                    <div class="building-level-btns">
                        {#each [1, 2, 3] as lvl}
                            <button
                                class="level-btn {buildingLevel === lvl ? 'active' : ''}"
                                onclick={() => buildingLevel = lvl as BuildingLevel}
                            >
                                {lvl}
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- PARENT SLOTS -->
                <div class="slots-area">
                    <div class="parent-slot-wrapper">
                        <button class="slot {p1 ? 'filled' : 'empty'}" onclick={() => { p1 = null; mobileTab = 'list'; }}>
                            {#if p1}
                                <img src={textureUrl(getImageSrc(p1))} alt={p1.name} class="mutant-img"/>
                                <div class="slot-label">{getName(p1)}</div>
                                <div class="remove-icon">✕</div>
                            {:else}
                                 <div class="plus">+</div>
                                 <span class="label">{t('breeding.slot.selectPrompt', locale)}</span>
                            {/if}
                        </button>
                        {#if p1}
                            <div class="parent-genes" in:fade>
                                {#each getAllGenes(p1) as g}
                                    <img src={textureUrl(getGeneIcon(g))} alt={g} class="parent-gene-icon" title="Gene {g}" />
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <!-- STAR SELECTOR BETWEEN MUTANTS -->
                    <div class="cross-area">
                        <div class="star-dropdown-wrapper">
                            <button class="star-dropdown-trigger" onclick={(e) => { e.stopPropagation(); toggleStarDropdown(); }} title={t('breeding.star.selectTitle', locale)}>
                                <img src={textureUrl(starIcons[resultStar])} alt={starNames[resultStar]} class="star-between-icon" />
                            </button>
                            {#if showStarDropdown}
                                <div class="star-dropdown" in:fly={{y: -8, duration: 150}}>
                                    {#each [0, 1, 2, 3, 4] as star}
                                        {@const minLvl = STAR_MIN_LEVEL[star]}
                                        <button
                                            class="star-option {resultStar === star ? 'active' : ''}"
                                            onclick={() => selectResultStar(star as StarLevel)}
                                        >
                                            <img src={textureUrl(starIcons[star])} alt={starNames[star]} class="star-option-icon" />
                                            <span class="star-option-name">{starNames[star]}</span>
                                            {#if minLvl > 0}
                                                <span class="star-option-level">{t('breeding.star.level', locale).replace('{n}', String(minLvl))}</span>
                                            {/if}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                        <div class="cross-icon">✕</div>
                    </div>

                    <div class="parent-slot-wrapper">
                        <button class="slot {p2 ? 'filled' : 'empty'}" onclick={() => { p2 = null; mobileTab = 'list'; }}>
                            {#if p2}
                                <img src={textureUrl(getImageSrc(p2))} alt={p2.name} class="mutant-img"/>
                                <div class="slot-label">{getName(p2)}</div>
                                <div class="remove-icon">✕</div>
                            {:else}
                                 <div class="plus">+</div>
                                 <span class="label">{t('breeding.slot.selectPrompt', locale)}</span>
                            {/if}
                        </button>
                        {#if p2}
                            <div class="parent-genes" in:fade>
                                {#each getAllGenes(p2) as g}
                                    <img src={textureUrl(getGeneIcon(g))} alt={g} class="parent-gene-icon" title="Gene {g}" />
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- BREEDING TIME (below parents) -->
                {#if p1 && p2}
                    <div class="breeding-time-summary" in:fade>
                        <span class="time-label">{t('breeding.time.label', locale)}</span>
                        <span class="time-icon">⏱</span>
                        <span class="time-value">{formatTime(calculateDuration(p1, p2, buildingLevel, resultStar, resultStar))}</span>
                    </div>
                {/if}

                <!-- RESULTS -->
                {#if p1 && p2}
                    <div class="results-area" in:slide>
                        {#if calcResults.length > 0}
                            <div class="results-header">
                                <span>{t('breeding.results.count', locale)} <strong class="text-lime-400">{calcResults.length}</strong></span>
                            </div>

                            <div class="results-list">
                                {#each calcResults as res, i}
                                    <div class="result-card" style="animation-delay: {i * 50}ms">
                                        <div class="card-left">
                                            <div class="mutant-thumb">
                                                <img src={textureUrl(getImageSrc(res.child))} alt={t('breeding.results.childAlt', locale)}/>
                                            </div>
                                        </div>
                                        <div class="card-info">
                                            <div class="card-header-row">
                                                <div class="card-title">{getName(res.child)}</div>
                                                <div class="card-genes">
                                                    {#each getAllGenes(res.child) as g}
                                                        <img src={textureUrl(getGeneIcon(g))} alt={g} class="gene-result-icon" title="Gene {g}" />
                                                    {/each}
                                                </div>
                                            </div>
                                            <div class="card-meta">
                                                <span class="prob-badge">{formatProb(res.probability)}</span>
                                                <span class="time">⏱ {formatMinutes(getIncubTime(res.child, resultStar))}</span>
                                                {#if res.isSecret || secretNames.has(normalize(getName(res.child)))}
                                                    <span class="secret-tag">{t('breeding.results.secretTag', locale)}</span>
                                                {/if}
                                                {#if res.tag && res.tag !== 'ВОЗМОЖНО' && res.tag !== 'РЕЦЕПТ'}
                                                    <span class="info-tag">{res.tag}</span>
                                                {/if}
                                            </div>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <div class="empty-state">
                                {t('breeding.results.empty', locale)}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <div class="instruction">
                        <div class="icon">👆</div>
                        <p>{t('breeding.instruction.calc', locale)}</p>
                    </div>
                {/if}
            </div>
        {:else}
            <!-- REVERSE MODE - СПРАВОЧНИК -->
             <div class="reverse-container" in:fly={{y:20, duration:400}}>
                 {#if target}
                     <!-- TARGET CARD -->
                     <div class="target-card">
                         <div class="target-content">
                             <div class="target-img-wrap">
                                 <img src={textureUrl(getImageSrc(target))} alt={getName(target)} />
                             </div>
                             <div class="target-info">
                                 <div class="badges">
                                     <span class="badge">{(target.type || 'default').toUpperCase()}</span>
                                     {#each getAllGenes(target) as g}
                                         <img src={textureUrl(getGeneIcon(g))} alt={g} class="badge-gene-icon" />
                                     {/each}
                                 </div>
                                 <h2>{getName(target)}</h2>
                                  <button class="reset-btn" onclick={() => { target = null; guideResults = []; }}>
                                     {t('breeding.reverse.resetBtn', locale)}
                                 </button>
                             </div>
                         </div>
                     </div>

                     <!-- BUILDING LEVEL + STAR SELECTORS -->
                     <div class="reverse-settings">
                         <div class="building-level-bar">
                             <span class="building-label">{t('breeding.buildingLevel.labelShort', locale)}</span>
                             <div class="building-level-btns">
                                 {#each [1, 2, 3] as lvl}
                                     <button
                                         class="level-btn {buildingLevel === lvl ? 'active' : ''}"
                                         onclick={() => buildingLevel = lvl as BuildingLevel}
                                     >
                                         {lvl}
                                     </button>
                                 {/each}
                             </div>
                         </div>
                         <div class="reverse-star-bar">
                             <span class="building-label">{t('breeding.reverse.starLabel', locale)}</span>
                             <div class="building-level-btns">
                                 {#each [0, 1, 2, 3, 4] as star}
                                     <button
                                         class="level-btn star-btn {reverseStar === star ? 'active' : ''}"
                                         onclick={() => reverseStar = star as StarLevel}
                                     >
                                         <img src={textureUrl(starIcons[star])} alt={starNames[star]} class="star-btn-icon" />
                                     </button>
                                 {/each}
                             </div>
                         </div>
                     </div>

                     <!-- RESULTS -->
                     {#if isSearching}
                         <div class="loading">
                             <div class="spinner"></div>
                             {t('breeding.reverse.loading', locale)}
                         </div>
                      {:else if guideResults.length > 0}
                          <div class="results-area">
                              <div class="results-header">
                                  <span>{allSecrets ? t('breeding.reverse.existingRecipes', locale) : t('breeding.reverse.foundPairs', locale)}: <strong class="text-lime-400">{tabCount()}</strong></span>
                                  {#if !allSecrets}
                                  <div class="sort-controls">
                                      <button class="sort-btn rec-btn {sortField === 'recommended' ? 'active' : ''}" onclick={() => toggleSort('recommended')}>
                                          {t('breeding.sort.recommended', locale)}
                                      </button>
                                      <button class="sort-btn easy-btn {easyMode ? 'active' : ''}" onclick={toggleEasyMode}>
                                          {t('breeding.sort.easyMode', locale)}
                                      </button>
                                      <button class="sort-btn {sortField === 'duration' ? 'active' : ''}" onclick={() => toggleSort('duration')}>
                                          {t('breeding.sort.time', locale)} {sortField === 'duration' ? (sortAsc ? '↑' : '↓') : ''}
                                      </button>
                                      <button class="sort-btn {sortField === 'probability' ? 'active' : ''}" onclick={() => toggleSort('probability')}>
                                          {t('breeding.sort.probability', locale)} {sortField === 'probability' ? (sortAsc ? '↑' : '↓') : ''}
                                      </button>
                                  </div>
                                  {/if}
                              </div>
                              <div class="pairs-list">
                                  {#each sortedGuideResults() as pair, i}
                                      <div class="pair-card" style="animation-delay: {i * 50}ms">
                                          <div class="parents">
                                              <div class="p-imgs">
                                                  <div class="p-item">
                                                      <div class="p-genes-overlay">
                                                          {#each getAllGenes(pair.p1) as g}
                                                              <img src={textureUrl(getGeneIcon(g))} alt={g} class="p-gene-icon" />
                                                          {/each}
                                                      </div>
                                                      <img src={textureUrl(getImageSrc(pair.p1))} alt={getName(pair.p1)} title={getName(pair.p1)} />
                                                      <div class="p-genes-below">
                                                          {#each getAllGenes(pair.p1) as g}
                                                              <img src={textureUrl(getGeneIcon(g))} alt={g} class="p-gene-icon" />
                                                          {/each}
                                                      </div>
                                                      <div class="p-name">{getName(pair.p1)}</div>
                                                  </div>
                                                  <span class="plus">+</span>
                                                  <div class="p-item">
                                                      <div class="p-genes-overlay">
                                                          {#each getAllGenes(pair.p2) as g}
                                                              <img src={textureUrl(getGeneIcon(g))} alt={g} class="p-gene-icon" />
                                                          {/each}
                                                      </div>
                                                      <img src={textureUrl(getImageSrc(pair.p2))} alt={getName(pair.p2)} title={getName(pair.p2)} />
                                                      <div class="p-genes-below">
                                                          {#each getAllGenes(pair.p2) as g}
                                                              <img src={textureUrl(getGeneIcon(g))} alt={g} class="p-gene-icon" />
                                                          {/each}
                                                      </div>
                                                      <div class="p-name">{getName(pair.p2)}</div>
                                                  </div>
                                              </div>
                                              <div class="p-names">
                                                  {getName(pair.p1)} × {getName(pair.p2)}
                                              </div>
                                          </div>
                                          <div class="pair-stats">
                                              <span class="pair-time">⏱ {formatTime(pair.duration)}</span>
                                              <span class="pair-prob">{formatProb(pair.probability)}</span>
                                          </div>
                                      </div>
                                  {/each}
                              </div>
                              {#if !allSecrets && tabCount() > TOP_N && !showAll}
                                  <button class="show-all-btn" onclick={() => showAll = true}>
                                      {t('breeding.showMore', locale).replace('{n}', String(tabCount()))}
                                  </button>
                              {/if}
                         </div>
                     {:else}
                         <div class="empty-search">
                             <div class="icon">🔍</div>
                             <p>{t('breeding.reverse.emptySearch', locale)}</p>
                         </div>
                     {/if}
                 {:else}
                     <!-- INSTRUCTIONS -->
                     <div class="instruction">
                         <button class="mobile-select-btn" onclick={() => { mobileTab = 'list'; }}>
                             {t('breeding.reverse.mobileSelectBtn', locale)}
                         </button>
                         <div class="icon">🔬</div>
                         <p>{t('breeding.reverse.instruction', locale)}</p>
                     </div>
                 {/if}
             </div>
        {/if}
    </div>
  </div>

  <!-- RIGHT PANEL: MUTANT LIST -->
  <div class="panel list-panel {mobileTab === 'list' ? 'active' : ''}">
      <div class="list-header">
          <div class="search-box">
              <input id="breeding-search" name="breeding-search" type="text" bind:value={search} placeholder={t('breeding.search.placeholder', locale)} />
              <span class="icon">🔍</span>
          </div>

          <div class="filters">
              <div class="gene-line">
                  <button class="filter-chip {filterGene==='all' ? 'active' : ''}" onclick={() => filterGene='all'}>
                      <span>{t('breeding.gene1.all', locale)}</span>
                  </button>
                  {#each ['A','B','C','D','E','F'] as g}
                      <button class="filter-chip gene-chip {filterGene===g ? 'active' : ''}" onclick={() => filterGene=g}>
                          <img src={textureUrl(getGeneIcon(g))} alt={g}/>
                      </button>
                  {/each}
              </div>
              <div class="gene-line" class:disabled={filterGene==='all'}>
                  <button class="filter-chip {filterGene2==='all' ? 'active' : ''}" disabled={filterGene==='all'} onclick={() => filterGene2='all'}>
                      <span>{t('breeding.gene2.all', locale)}</span>
                  </button>
                  <button class="filter-chip gene-chip {filterGene2==='neutral' ? 'active' : ''}" disabled={filterGene==='all'} onclick={() => filterGene2='neutral'}>
                      <img src={textureUrl("/genes/gene_all.webp")} alt={t('breeding.gene.neutralAlt', locale)}/>
                  </button>
                  {#each ['A','B','C','D','E','F'] as g}
                      <button class="filter-chip gene-chip {filterGene2===g ? 'active' : ''}" disabled={filterGene==='all'} onclick={() => filterGene2=g}>
                          <img src={textureUrl(getGeneIcon(g))} alt={g}/>
                      </button>
                  {/each}
              </div>

               <button class="filter-chip secret-chip {filterGene==='recipe' ? 'active' : ''}" onclick={() => filterGene='recipe'}>
                   <span class="star">★</span>
                   <span>{t('breeding.filter.secrets', locale)}</span>
               </button>
          </div>
      </div>

      <div class="list-grid custom-scroll">
           {#each filteredList as m (m.id + m.name)}
                <button class="grid-item" onclick={() => handleCardClick(m)} title={getName(m)}>
                    <div class="card-badges">
                        <img src={textureUrl(getTypeIcon(m))} alt={t('breeding.typeIconAlt', locale)} class="type-icon" />
                        <div class="gene-icons">
                            {#each (Array.isArray(m.genes) ? m.genes : [m.genes]) as g}
                                <img src={textureUrl(getGeneIcon(g))} alt={g} class="gene-icon" />
                            {/each}
                        </div>
                    </div>
                    <div class="img-wrapper">
                        <img class="mutant-texture" loading="lazy" src={getImageSrc(m)} alt={t('breeding.textureAlt', locale)} onerror={(e) => (e.currentTarget as HTMLImageElement).src = textureUrl('/preview.jpg')}/>
                    </div>
                    <div class="item-info-row">
                        <div class="item-name">{getName(m)}</div>
                    </div>
                    {#if secretNames.has(normalize(getName(m)))}<div class="secret-badge">★</div>{/if}
                </button>
           {/each}
      </div>
  </div>

  <!-- BOTTOM NAV (MOBILE) -->
  <nav class="mobile-nav">
       <button class="nav-item {mobileTab==='lab' ? 'active' : ''}" onclick={() => mobileTab = 'lab'}>
           <span class="icon">{mode==='calc' ? '🧬' : '🔬'}</span>
           <span class="label">{t('breeding.nav.lab', locale)}</span>
       </button>
       <div class="divider"></div>
       <button class="nav-item {mobileTab==='list' ? 'active' : ''}" onclick={() => mobileTab = 'list'}>
           <span class="icon">📋</span>
           <span class="label">{t('breeding.nav.dnaBase', locale)}</span>
       </button>
  </nav>

</div>

{#if showNotification}
  <div class="notification-toast" in:fly={{y: 40, duration: 300}} out:fade={{duration: 200}}>
    <span class="notification-text">{notificationMessage}</span>
    <button class="notification-close" onclick={() => { showNotification = false; if (notificationTimeout) clearTimeout(notificationTimeout); }}>✕</button>
  </div>
{/if}

{#if easyModalOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="easy-modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) easyModalOpen = false; }} in:fade={{duration: 150}} out:fade={{duration: 150}}>
    <div class="easy-modal-panel" role="dialog" aria-modal="true" aria-label={t('breeding.sort.easyMode', locale)}>
      <p>
        {t('breeding.easyMode.description', locale)}
      </p>
      <button class="easy-modal-ok" onclick={() => easyModalOpen = false}>{t('breeding.easyMode.ok', locale)}</button>
    </div>
  </div>
{/if}

<style>
  :global(body) { background-color: #050505; }

  .main-wrapper {
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 90px);
    max-width: 1600px;
    margin: 0 auto;
    background: #0a0f1c;
    position: relative;
    overflow: hidden;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.05);
  }

  @media (max-width: 1023px) {
    .main-wrapper {
        height: calc(100dvh - 70px);
        border-radius: 0;
        border: none;
    }
  }

  @media (min-width: 1024px) {
    .main-wrapper {
      flex-direction: row;
      padding: 1rem;
      gap: 1.5rem;
    }
  }

  .panel {
    display: none;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(12px);
    overflow: hidden;
  }

  .panel.active { display: flex; }

  @media (min-width: 1024px) {
    .panel {
        display: flex;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 24px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .list-panel {
        flex: none;
        width: 400px;
    }
  }

  .panel-header {
    padding: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: rgba(0,0,0,0.2);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .logo-area {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo-icon {
    width: 2.5rem; height: 2.5rem;
    background: linear-gradient(135deg, #84cc16, #10b981);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.5rem;
    box-shadow: 0 0 15px rgba(132, 204, 22, 0.4);
  }

  .logo-area h1 {
    font-size: 1.1rem; font-weight: 800; line-height: 1;
    text-transform: uppercase; letter-spacing: 0.05em; margin: 0;
  }
  .highlight { color: #84cc16; }
  .subtitle {
    font-size: 0.65rem; color: #64748b; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.2em; margin-top: 2px;
  }

  .mode-switch-desktop {
    display: none;
    background: rgba(0,0,0,0.3);
    padding: 4px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.05);
  }

  .mode-btn {
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
    color: #64748b;
    transition: all 0.2s;
  }
  .mode-btn:hover { color: #fff; }
  .mode-btn.active { background: #84cc16; color: #000; box-shadow: 0 2px 10px rgba(132, 204, 22, 0.3); }
  .mode-btn.active:last-child { background: #a855f7; color: #fff; box-shadow: 0 2px 10px rgba(168, 85, 247, 0.4); }
  .mode-btn.disabled { background: rgba(239, 68, 68, 0.2); color: #ef4444; cursor: not-allowed; border: 1px solid rgba(239, 68, 68, 0.3); }

  .mode-switch-mobile {
    padding: 0.5rem 0.8rem;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    font-size: 0.7rem; font-weight: 800; text-transform: uppercase;
    color: #94a3b8;
  }

  @media (min-width: 1024px) {
    .mode-switch-desktop { display: flex; }
    .mode-switch-mobile { display: none; }
    .panel-header { padding: 1.5rem; }
  }

  .workspace {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    padding-bottom: 6rem;
    position: relative;
  }

  @media (min-width: 1024px) {
    .workspace { padding: 2rem; padding-bottom: 2rem; }
  }

  .calc-container, .reverse-container {
    max-width: 800px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 1.5rem;
  }

  /* BUILDING LEVEL BAR */
  .building-level-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .building-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #94a3b8;
    white-space: nowrap;
  }

  .building-level-btns {
    display: flex;
    gap: 0.35rem;
  }

  .level-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid rgba(132, 204, 22, 0.2);
    background: rgba(132, 204, 22, 0.05);
    color: #84cc16;
    font-size: 0.8rem;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .level-btn:hover {
    background: rgba(132, 204, 22, 0.15);
    border-color: rgba(132, 204, 22, 0.4);
  }

  .level-btn.active {
    background: #84cc16;
    color: #000;
    border-color: #84cc16;
    box-shadow: 0 0 10px rgba(132, 204, 22, 0.4);
  }

  /* SLOTS */
  .slots-area {
    display: flex; align-items: flex-start; justify-content: center;
    gap: 0.5rem;
  }

  .parent-slot-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .parent-genes {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    justify-content: center;
    padding: 0.375rem 0.5rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    border: 1px solid rgba(132, 204, 22, 0.2);
  }

  .parent-gene-icon {
    width: 32px;
    height: 32px;
    object-fit: contain;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
    transition: transform 0.2s;
  }

  .parent-gene-icon:hover {
    transform: scale(1.1);
  }

  .slot {
    width: 100px; height: 100px;
    border: 2px dashed #334155;
    border-radius: 20px;
    background: rgba(30, 41, 59, 0.3);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative;
    overflow: hidden;
    transition: all 0.2s;
    cursor: pointer;
  }

  .slot:hover { border-color: #84cc16; background: rgba(30, 41, 59, 0.5); }
  .slot.filled { border-style: solid; border-color: rgba(132, 204, 22, 0.5); background: #0f172a; }

  .slot .plus { font-size: 2rem; color: #475569; margin-bottom: 0.2rem; }
  .slot .label { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; color: #475569; }

  .mutant-img { width: 85%; height: 85%; object-fit: contain; z-index: 1; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5)); }
  .slot-label {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: rgba(0,0,0,0.8);
    color: #fff; font-size: 0.6rem; font-weight: 700;
    text-transform: uppercase; padding: 4px; text-align: center;
    z-index: 2;
  }
  .remove-icon {
    position: absolute; top: 4px; right: 4px;
    color: rgba(255,255,255,0.5); font-size: 0.8rem; z-index: 2;
    @media (max-width: 1023px) { display: none; }
  }

  /* STAR DROPDOWN */
  .star-dropdown-wrapper {
    position: relative;
  }

  .star-dropdown-trigger {
    width: 40px;
    height: 40px;
    background: radial-gradient(circle, rgba(255, 80, 80, 0.25), rgba(255, 50, 50, 0.08));
    border: 2px solid rgba(255, 80, 80, 0.45);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
    padding: 0;
    box-shadow: 0 0 12px rgba(255, 50, 50, 0.2);
  }

  .star-dropdown-trigger:hover {
    border-color: rgba(255, 100, 100, 0.7);
    box-shadow: 0 0 18px rgba(255, 50, 50, 0.35);
    transform: scale(1.08);
  }

  .star-between-icon {
    width: 22px;
    height: 22px;
    object-fit: contain;
    filter: drop-shadow(0 0 4px rgba(255, 200, 0, 0.5));
  }

  .star-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 0.3rem;
    z-index: 50;
    min-width: 160px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(12px);
  }

  .star-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: none;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    color: #cbd5e1;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .star-option:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .star-option.active {
    background: rgba(255, 215, 0, 0.12);
    color: #fbbf24;
  }

  .star-option-icon {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }

  .star-option-name {
    white-space: nowrap;
  }

  .star-option-level {
    margin-left: auto;
    font-size: 0.65rem;
    color: #64748b;
    font-weight: 600;
  }

  /* CROSS AREA */
  .cross-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    margin-top: 2rem;
  }

  .cross-icon { font-size: 1.2rem; color: #475569; }

  @media (min-width: 1024px) {
    .slots-area { gap: 2rem; }
    .slot { width: 180px; height: 180px; }
    .slot .plus { font-size: 3rem; }
    .slot .label { font-size: 0.75rem; }
    .slot-label { font-size: 0.8rem; padding: 6px; }
    .parent-gene-icon { width: 40px; height: 40px; }
    .parent-genes { gap: 0.5rem; padding: 0.5rem 0.75rem; }
    .star-dropdown-trigger { width: 48px; height: 48px; }
    .star-between-icon { width: 28px; height: 28px; }
    .star-dropdown { min-width: 180px; }
    .star-option { padding: 0.55rem 0.75rem; font-size: 0.8rem; }
    .star-option-icon { width: 24px; height: 24px; }
    .cross-area { margin-top: 3rem; }
  }

  /* BREEDING TIME SUMMARY */
  .breeding-time-summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 10px;
    font-size: 0.85rem;
    color: #93c5fd;
    font-weight: 700;
  }

  .time-label {
    font-size: 0.8rem;
    color: #94a3b8;
    font-weight: 600;
  }

  .time-icon { font-size: 1rem; }
  .time-value { font-family: monospace; }

  /* RESULTS */
  .results-area {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 16px;
    overflow: hidden;
  }

  .results-header {
    background: rgba(0,0,0,0.2);
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.65rem; text-transform: uppercase; font-weight: 700; color: #94a3b8;
  }
  .sort-controls { display: flex; gap: 0.3rem; }
  .sort-btn {
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      color: #94a3b8; border-radius: 6px; padding: 0.2rem 0.3rem;
      font-size: 0.65rem; font-weight: 700; cursor: pointer; transition: all 0.15s;
      display: flex; align-items: center; gap: 2px;
  }
  .sort-btn:hover { background: rgba(255,255,255,0.12); color: #e2e8f0; }
  .sort-btn.active { background: rgba(74,222,128,0.15); color: #4ade80; border-color: rgba(74,222,128,0.3); }
  .rec-btn { border-color: rgba(251,191,36,0.25); color: #fbbf24; }
  .rec-btn:hover { background: rgba(251,191,36,0.1); color: #fcd34d; }
  .rec-btn.active { background: rgba(251,191,36,0.15); color: #fbbf24; border-color: rgba(251,191,36,0.4); }
  .easy-btn { border-color: rgba(248,113,113,0.3); color: #f87171; }
  .easy-btn:hover { background: rgba(248,113,113,0.1); color: #fca5a5; }
  .easy-btn.active { background: rgba(248,113,113,0.18); color: #f87171; border-color: rgba(248,113,113,0.5); }

  .easy-modal-overlay {
    position: fixed; inset: 0; z-index: 95; background: rgba(0,0,0,0.7);
    backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; padding: 1rem;
  }
  .easy-modal-panel {
    max-width: 420px; background: #0f172a; border: 1px solid rgba(248,113,113,0.3);
    border-radius: 14px; padding: 1.25rem; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    display: flex; flex-direction: column; gap: 1rem;
  }
  .easy-modal-panel p { font-size: 0.85rem; line-height: 1.5; color: #cbd5e1; margin: 0; }
  .easy-modal-ok {
    align-self: flex-end; background: rgba(248,113,113,0.15); color: #f87171;
    border: 1px solid rgba(248,113,113,0.4); border-radius: 8px; padding: 0.4rem 1rem;
    font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: all 0.15s;
  }
  .easy-modal-ok:hover { background: rgba(248,113,113,0.25); }

  .results-list {
    padding: 0.5rem;
    display: grid; gap: 0.5rem;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  .result-card {
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 12px;
    padding: 0.75rem;
    display: flex; gap: 0.75rem; align-items: center;
    animation: fadeIn 0.3s ease-out backwards;
  }

  .card-left { position: relative; width: 50px; height: 50px; flex-shrink: 0; }
  .mutant-thumb { width: 100%; height: 100%; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid #334155; display: flex; align-items: center; justify-content: center; }
  .mutant-thumb img { width: 100%; height: 100%; object-fit: contain; padding: 2px; }
  .card-info { flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 4px; }

  .card-header-row {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }

  .card-title { font-weight: 700; font-size: 0.9rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .card-genes { display: flex; gap: 4px; flex-shrink: 0; }
  .gene-result-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.4));
  }

  .card-meta { display: flex; gap: 0.5rem; font-size: 0.7rem; color: #64748b; font-weight: 600; align-items: center; flex-wrap: wrap; }
  .secret-tag { color: #d946ef; background: rgba(217, 70, 239, 0.1); padding: 2px 4px; border-radius: 4px; }
  .info-tag { color: #60a5fa; background: rgba(96, 165, 250, 0.1); padding: 2px 4px; border-radius: 4px; }
  .prob-badge {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 800;
    font-size: 0.7rem;
  }

  .time { font-family: monospace; color: #94a3b8; }

  /* REVERSE MODE STYLES */
  .empty-search, .instruction {
    text-align: center;
    padding: 3rem 1rem;
    opacity: 0.6;
    display: flex; flex-direction: column; align-items: center; gap: 1rem;
  }
  .big-icon, .icon { font-size: 3rem; margin-bottom: 0.5rem; filter: grayscale(1); }
  .instruction p { max-width: 300px; font-size: 0.9rem; line-height: 1.5; }

  .mobile-select-btn {
    display: none;
    padding: 0.7rem 1.5rem;
    background: rgba(132, 204, 22, 0.15);
    border: 1px solid rgba(132, 204, 22, 0.4);
    border-radius: 10px;
    color: #84cc16;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }
  .mobile-select-btn:hover {
    background: rgba(132, 204, 22, 0.25);
    border-color: rgba(132, 204, 22, 0.6);
  }
  @media (max-width: 1023px) {
    .mobile-select-btn { display: block; }
  }

  .target-card {
    position: relative;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 20px;
    overflow: hidden;
    padding: 1.5rem;
  }

  .target-bg {
    position: absolute; inset: 0;
    background-size: cover; background-position: center;
    opacity: 0.1; filter: blur(20px);
  }

  .target-content { position: relative; display: flex; gap: 1.5rem; align-items: center; }
  .target-img-wrap {
    width: 80px; height: 80px;
    border-radius: 16px; background: #000;
    border: 2px solid rgba(168, 85, 247, 0.5);
    overflow: hidden; box-shadow: 0 10px 20px rgba(0,0,0,0.5);
    flex-shrink: 0;
  }
  .target-img-wrap img { width: 100%; height: 100%; object-fit: cover; }

  .target-info h2 { margin: 0; font-size: 1.5rem; font-weight: 800; color: #fff; line-height: 1.2; }
  .badges { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
  .badge { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase; border: 1px solid rgba(168, 85, 247, 0.3); }
  .badge-gene-icon { width: 20px; height: 20px; object-fit: contain; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4)); }
  .reset-btn { margin-top: 0.5rem; font-size: 0.75rem; color: #94a3b8; text-decoration: underline; background: none; border: none; cursor: pointer; padding: 0; }
  .reverse-settings {
    display: flex; flex-wrap: wrap; gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .reverse-settings .building-level-bar { flex: 1; min-width: 0; }
  .reverse-star-bar {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .star-btn { width: 32px; height: 32px; padding: 0; }
  .star-btn-icon { width: 20px; height: 20px; object-fit: contain; }
  @media (max-width: 480px) {
    .reverse-settings { flex-direction: column; gap: 0.15rem; margin-bottom: 0.15rem; margin-top: -0.35rem; }
    .reverse-settings .building-level-bar { min-width: 100%; padding: 0.2rem 0.4rem; }
    .reverse-star-bar { min-width: 100%; padding: 0.2rem 0.4rem; justify-content: center; }
    .building-label { font-size: 0.55rem; }
    .level-btn { width: 30px; height: 30px; font-size: 0.7rem; }
    .star-btn { width: 30px; height: 30px; }
    .star-btn-icon { width: 18px; height: 18px; }
  }

  .pairs-list { display: grid; gap: 0.4rem; }
  .pair-card {
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid rgba(255,255,255,0.05);
    padding: 0.45rem 0.6rem; border-radius: 10px;
    display: flex; justify-content: space-between; align-items: center;
    animation: slideUp 0.3s ease-out backwards;
  }
  .parents { display: flex; gap: 0.5rem; align-items: center; }
  .p-imgs { display: flex; align-items: center; gap: 0.25rem; }
  .p-item { display: flex; flex-direction: column; align-items: center; gap: 1px; position: relative; }
  .p-item > img { width: 36px; height: 36px; border-radius: 6px; background: #000; border: 1px solid #475569; object-fit: contain; }
  .p-genes-overlay { display: none; }
  .p-genes-below { display: flex; gap: 0px; }
  .p-gene-icon { width: 16px; height: 16px; object-fit: contain; border: none !important; border-radius: 0 !important; background: none !important; }
  .p-imgs .plus { font-size: 0.6rem; color: #64748b; }
  .p-names { font-size: 0.7rem; color: #cbd5e1; font-weight: 600; line-height: 1.2; }
  .p-name { display: none; }
  .pair-stats {
    display: flex; flex-direction: row; align-items: baseline; justify-content: flex-end; gap: 0.4em;
    flex-shrink: 0; margin-left: auto; margin-right: 1.5rem;
  }
  .pair-time {
    font-size: 0.65rem; color: #94a3b8; white-space: nowrap;
    text-align: right;
  }
  .pair-prob {
    font-size: 0.65rem; color: #4ade80; font-weight: 700; white-space: nowrap;
    text-align: right;
  }
  @media (max-width: 480px) {
    .pair-card {
        display: flex; align-items: stretch; gap: 0;
        padding: 0.35rem 0; border-radius: 8px;
    }
    .parents {
        flex: 1; min-width: 0; padding: 0 0.4rem;
        display: flex; align-items: center; gap: 0.3rem;
    }
    .p-imgs { display: flex; align-items: center; gap: 0.3rem; }
    .p-item { width: 38px; text-align: center; }
    .p-item > img { width: 34px; height: 34px; display: block; margin: 0 auto; }
    .p-genes-overlay {
        display: flex; gap: 0; position: absolute; top: -4px; left: 50%;
        transform: translateX(-50%); z-index: 2;
    }
    .p-genes-overlay .p-gene-icon { width: 12px; height: 12px; }
    .p-genes-below { display: none; }
    .p-names { display: none; }
    .p-name {
        display: block; font-size: 0.5rem; color: #cbd5e1; font-weight: 600;
        line-height: 1.1; max-width: 50px; text-align: center; word-break: break-word;
        margin-top: 1px; min-height: 1.2em;
    }
    .p-imgs .plus { font-size: 0.55rem; }
    .pair-stats {
        display: flex; flex-direction: row; align-items: baseline; justify-content: flex-end; gap: 0.35em;
        flex-shrink: 0; margin-left: auto; margin-right: 0.3rem; min-width: 0;
    }
    .pair-time, .pair-prob {
        display: flex; align-items: center; justify-content: flex-end;
        padding: 0; box-sizing: border-box; white-space: nowrap;
    }
    .pair-time { font-size: 0.7rem; color: #94a3b8; }
    .pair-prob { font-size: 0.7rem; color: #4ade80; font-weight: 700; }
    .sort-btn { width: 46px; justify-content: center; padding: 0.15rem 0.2rem; font-size: 0.6rem; }
    .sort-btn.rec-btn, .sort-btn.easy-btn { width: auto; padding: 0.15rem 0.35rem; }
    .sort-controls { gap: 0.35rem; flex-wrap: wrap; justify-content: flex-start; }
    .results-header { flex-direction: column; align-items: center; gap: 0.5rem; }
  }
  .show-all-btn {
    width: 100%; margin-top: 0.5rem;
    background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.12);
    color: #94a3b8; border-radius: 8px; padding: 0.5rem;
    font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.15s;
  }
  .show-all-btn:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; border-color: rgba(255,255,255,0.2); }

  /* LIST PANEL STYLES */
  .list-header {
    padding: 1rem;
    background: rgba(0,0,0,0.2);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    display: flex; flex-direction: column; gap: 1rem;
  }

  .search-box { position: relative; }
  .search-box input {
    width: 100%;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(51, 65, 85, 0.8);
    padding: 0.75rem 1rem; padding-right: 2.5rem;
    border-radius: 12px;
    color: #fff; font-size: 0.9rem;
  }
  .search-box .icon { position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); opacity: 0.5; }

  .filters {
    display: flex; flex-wrap: wrap; gap: 0.5rem;
  }

  .filter-chip {
    height: 36px;
    padding: 0 0.8rem;
    border-radius: 8px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
    font-size: 0.75rem; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }

  .filter-chip.active { background: #e2e8f0; color: #0f172a; border-color: #fff; transform: scale(1.05); }

  .gene-chip { width: 36px; padding: 0; }
  .gene-chip img { width: 20px; height: 20px; }

  .secret-chip {
    gap: 0.3rem;
    background: rgba(88, 28, 135, 0.3); border-color: rgba(168, 85, 247, 0.4); color: #d8b4fe;
  }
  .secret-chip.active { background: #a855f7; color: #fff; }
  .secret-chip .star { font-size: 1rem; line-height: 1; }

  .gene-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .gene-line.disabled {
    opacity: 0.3;
    pointer-events: none;
  }

  .list-grid {
    flex: 1; overflow-y: auto;
    padding: 0.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 0.5rem;
    padding-bottom: 6rem;
    align-content: start;
  }

  @media (min-width: 1024px) {
    .list-grid {
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 0.75rem; padding: 1rem; padding-bottom: 1rem;
    }
  }

  .grid-item {
    background: #1e293b;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
    border: 1px solid rgba(255,255,255,0.05);
    transition: all 0.2s;
    appearance: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem;
    margin: 0;
    width: 100%;
    height: 120px;
    cursor: pointer;
  }

  .card-badges {
    position: absolute;
    top: 4px;
    left: 4px;
    right: 4px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    pointer-events: none;
    z-index: 2;
  }

  .type-icon {
    width: 14px;
    height: 14px;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
  }

  .gene-icons {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .gene-icon {
    width: 14px;
    height: 14px;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
  }
  .grid-item:hover { border-color: #84cc16; background: rgba(30, 41, 59, 0.8); transform: translateY(-2px); z-index: 10; }

  .img-wrapper {
      width: 100%;
      height: 70px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.25rem;
  }

  .grid-item img.mutant-texture {
      width: 100%;
      height: 100%;
      object-fit: contain;
      filter: drop-shadow(0 4px 4px rgba(0,0,0,0.3));
      opacity: 0.9;
      transition: 0.2s;
      transform: scale(1.2);
  }

  .grid-item:hover img { opacity: 1; transform: scale(1.05); }

  .item-info-row {
    width: 100%;
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .item-name {
    font-size: 0.7rem;
    font-weight: 600;
    color: #cbd5e1;
    line-height: 1.1;
    text-align: center;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }

  .secret-badge {
    position: absolute; top: 4px; right: 4px; left: auto;
    background: #d946ef; color: #fff;
    font-size: 0.6rem; width: 16px; height: 16px; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  }

  /* MOBILE NAV */
  .mobile-nav {
    display: flex;
    position: fixed; bottom: 0; left: 0; right: 0;
    height: 80px;
    background: #0f172a;
    border-top: 1px solid rgba(255,255,255,0.1);
    z-index: 100;
    padding-bottom: env(safe-area-inset-bottom, 20px);
  }

  @media (min-width: 1024px) {
    .mobile-nav { display: none; }
  }

  .nav-item {
    flex: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #64748b;
    gap: 4px;
  }
  .nav-item.active { color: #84cc16; }
  .nav-item.active:last-child { color: #60a5fa; }

  .nav-item .icon { font-size: 1.5rem; }
  .nav-item .label { font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }

  .divider { width: 1px; background: rgba(255,255,255,0.1); height: 60%; align-self: center; }

  /* SCROLLBARS */
  .custom-scroll {
    scrollbar-width: thin;
    scrollbar-color: #334155 transparent;
  }
  .custom-scroll::-webkit-scrollbar { width: 5px; }
  .custom-scroll::-webkit-scrollbar-track { background: transparent; }
  .custom-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
  .custom-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }

  /* CLOSED SECTION */
  .closed-section {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 500px;
    padding: 2rem;
  }

  .closed-content {
    text-align: center;
    max-width: 500px;
    position: relative;
  }

  .closed-icon {
    font-size: 5rem;
    margin-bottom: 1rem;
    filter: drop-shadow(0 0 20px rgba(239, 68, 68, 0.5));
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.1); opacity: 0.8; }
  }

  .closed-content h1 {
    font-size: 2rem;
    color: #ef4444;
    margin-bottom: 0.5rem;
    font-weight: 800;
  }

  .closed-reason {
    font-size: 1.1rem;
    color: #f87171;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .closed-text {
    color: #94a3b8;
    line-height: 1.6;
    margin-bottom: 2rem;
  }

  .back-btn {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: #fff;
    border: none;
    padding: 0.875rem 2rem;
    border-radius: 12px;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
  }

  .back-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
  }

  .decorator {
    margin-top: 3rem;
    opacity: 0.3;
  }

  .dna-strand {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    font-size: 1.5rem;
    font-weight: 800;
    font-family: monospace;
  }

  .dna-strand .base {
    display: inline-block;
    width: 30px;
    height: 30px;
    line-height: 30px;
    text-align: center;
    border-radius: 50%;
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    animation: float 3s ease-in-out infinite;
  }

  .dna-strand .base:nth-child(1) { animation-delay: 0s; }
  .dna-strand .base:nth-child(2) { animation-delay: 0.2s; }
  .dna-strand .base:nth-child(3) { animation-delay: 0.4s; }
  .dna-strand .base:nth-child(4) { animation-delay: 0.6s; }
  .dna-strand .base:nth-child(5) { animation-delay: 0.8s; }
  .dna-strand .base:nth-child(6) { animation-delay: 1s; }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  .loading { text-align: center; padding: 2rem; color: #a855f7; font-weight: 700; font-size: 0.9rem; }
  .spinner {
     display: inline-block; width: 30px; height: 30px;
     border: 3px solid rgba(168, 85, 247, 0.3);
     border-top-color: #a855f7;
     border-radius: 50%;
     animation: spin 1s linear infinite;
     margin-bottom: 0.5rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* NOTIFICATION TOAST */
  .notification-toast {
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 90vw;
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    z-index: 200;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(10px);
  }

  .notification-text {
    font-size: 0.8rem;
    color: #e2e8f0;
    font-weight: 500;
    white-space: pre-line;
    line-height: 1.4;
  }

  .notification-close {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #94a3b8;
    font-size: 0.8rem;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.2s;
  }

  .notification-close:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  @media (min-width: 1024px) {
    .notification-toast {
      bottom: 40px;
    }
  }
</style>
