<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn';
  import {
    craftRecipesByCategory,
    incentiveRewards,
    incentiveLoopOrder,
    getIncentiveCycleState,
    translateItemId,
    describeIngredientRegex,
    getItemTexture,
    simulateRecipe,
    calculateIncentiveChance,
    formatDurationMinutes,
    getBonusRange,
    getFeaturedRewardIds,
    RECIPE_HEADER_TITLES,
    type CraftRecipe,
    type DetailedSimulationResult,
  } from '@/lib/craft-simulator';

  type FacilityId = 'metal' | 'transformatron' | 'supplies' | 'blackhole';

  interface FeaturedItem {
    id: string;
    label: string;
    icon: string | null;
  }

  interface FacilityDefinition {
    id: FacilityId;
    name: string;
    badge: string;
    tagline: string;
    description: string;
    accent: string;
    gradient: string;
    glow: string;
    category: keyof typeof craftRecipesByCategory;
    recipes: CraftRecipe[];
    featuredRewards: FeaturedItem[];
  }

  interface FacilityState {
    selectedRecipeId: string;
    craftCount: number;
    result: DetailedSimulationResult | null;
  }

  const MAX_SIMULATIONS = 1000000;

  const allRecipes: CraftRecipe[] = [
    ...craftRecipesByCategory.star,
    ...craftRecipesByCategory.orb,
    ...craftRecipesByCategory.lab,
    ...craftRecipesByCategory.blackhole,
  ];

  const totalRecipes = allRecipes.length;
  const uniqueRewardIds = new Set(
    allRecipes.flatMap((recipe) => recipe.rewards.map((reward) => reward.id)),
  );
  const maxBonus = Math.max(...allRecipes.map((recipe) => recipe.bonusPer1000));

  function buildFeaturedItems(recipes: CraftRecipe[], limit = 4): FeaturedItem[] {
    return getFeaturedRewardIds(recipes, limit).map((id) => ({
      id,
      label: translateItemId(id),
      icon: getItemTexture(id),
    }));
  }

  const facilities: FacilityDefinition[] = [
    {
      id: 'metal',
      name: 'Metal Factory',
      badge: 'Metal Factory',
      tagline: 'Переплавляем звёзды в следующий ранг',
      description:
        'Пять одноранговых звёзд превращаются в новую — шанс доп. награды зависит от уровня.',
      accent: '#f59e0b',
      gradient: 'linear-gradient(135deg, rgba(63, 29, 7, 0.95), rgba(190, 108, 29, 0.82))',
      glow: 'rgba(252, 211, 77, 0.35)',
      category: 'star',
      recipes: craftRecipesByCategory.star,
      featuredRewards: buildFeaturedItems(craftRecipesByCategory.star),
    },
    {
      id: 'transformatron',
      name: 'Transformatron',
      badge: 'Transformatron',
      tagline: 'Сферы всех типов и уровней',
      description:
        'Ранки и рероллы сфер. Каждый рецепт использует 7 сфер и возвращает продвинутую версию.',
      accent: '#38bdf8',
      gradient: 'linear-gradient(135deg, rgba(14, 41, 84, 0.95), rgba(14, 116, 214, 0.82))',
      glow: 'rgba(56, 189, 248, 0.35)',
      category: 'orb',
      recipes: craftRecipesByCategory.orb,
      featuredRewards: buildFeaturedItems(craftRecipesByCategory.orb),
    },
    {
      id: 'supplies',
      name: 'Supplies Lab',
      badge: 'Supplies Lab',
      tagline: 'Медикаменты, опыт и мутостерон',
      description:
        'Конвертируй избыток ресурсов: апгрейд аптечек, XP-банок и мутостерона в пару кликов.',
      accent: '#f87171',
      gradient: 'linear-gradient(135deg, rgba(80, 16, 26, 0.92), rgba(220, 38, 38, 0.8))',
      glow: 'rgba(248, 113, 113, 0.32)',
      category: 'lab',
      recipes: craftRecipesByCategory.lab,
      featuredRewards: buildFeaturedItems(craftRecipesByCategory.lab),
    },
    {
      id: 'blackhole',
      name: 'Black Hole Experiment',
      badge: 'Black Hole',
      tagline: 'Комбинации всех предметов',
      description:
        'Фиолетовое сердце лаборатории. Перекрафт любых ресурсов и шанс на бустеры высокого класса.',
      accent: '#c084fc',
      gradient: 'linear-gradient(135deg, rgba(52, 15, 75, 0.95), rgba(147, 51, 234, 0.82))',
      glow: 'rgba(192, 132, 252, 0.35)',
      category: 'blackhole',
      recipes: craftRecipesByCategory.blackhole,
      featuredRewards: buildFeaturedItems(craftRecipesByCategory.blackhole),
    },
  ];

  let activeFacilityId: FacilityId = $state(facilities[0]?.id ?? 'metal');
  let sidebarOpen = $state(false);
  // Свёрнуто по умолчанию только визуально (CSS, см. @media max-width:1023px) -
  // на десктопе всегда открыто, здесь просто общий тоггл-стейт для мобилки.
  let introOpen = $state(false);

  function ingredientTypesLabel(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'тип';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'типа';
    return 'типов';
  }

  // Цикл доп. наград детерминирован (см. getIncentiveCycleState) - по умолчанию
  // показываем реально активную сейчас награду, а не первую по списку. Ручной
  // выбор в дропдауне переключает useCycleIncentive=false. cycleState = null до
  // клиентского onMount (SSR-время сборки не годится для "текущего" момента).
  // cycleState стартует null и на сервере, и при первой клиентской отрисовке
  // (иначе структура DOM разъедется с SSR и гидратация astro-острова падает
  // с ошибкой прямо в консоли) - заполняем его чуть позже через rAF, это уже
  // обычное реактивное обновление после гидратации, а не часть самой гидратации.
  let cycleState: ReturnType<typeof getIncentiveCycleState> | null = $state(null);
  if (typeof window !== 'undefined') {
    requestAnimationFrame(() => {
      cycleState = getIncentiveCycleState();
      setInterval(() => {
        cycleState = getIncentiveCycleState();
      }, 60000);
    });
  }
  let useCycleIncentive = $state(true);
  let activeIncentiveId: string = $state('');
  // Индекс карточки в треке цикла, выбранной вручную кликом - отдельно от
  // cycleState.activeIndex (реальная позиция цикла сейчас), чтобы можно было
  // подсветить ОБА состояния разными маркерами, если они не совпадают.
  // Выбор через дропдаун (не клик по карточке) не даёт однозначного индекса
  // при повторяющихся id в цикле - тогда просто сбрасывается в null.
  let selectedCycleIndex: number | null = $state(null);
  let activeIncentive = $derived(
    useCycleIncentive
      ? (cycleState?.active ?? null)
      : activeIncentiveId === ''
        ? null
        : (incentiveRewards.find((reward) => reward.id === activeIncentiveId) ?? null),
  );

  function pickManualIncentive(id: string, cycleIndex: number | null = null) {
    useCycleIncentive = false;
    activeIncentiveId = id;
    selectedCycleIndex = cycleIndex;
  }
  let activeFacility = $derived(
    facilities.find((facility) => facility.id === activeFacilityId) ?? facilities[0] ?? null,
  );

  let facilityStates: Record<FacilityId, FacilityState> = $state(facilities.reduce(
    (acc, facility) => {
      acc[facility.id] = {
        selectedRecipeId: facility.recipes[0]?.id ?? '',
        craftCount: 10,
        result: null,
      } satisfies FacilityState;
      return acc;
    },
    {} as Record<FacilityId, FacilityState>,
  ));

  function setActiveFacility(id: FacilityId) {
    activeFacilityId = id;
    sidebarOpen = false;
  }

  function selectRecipe(facilityId: FacilityId, recipeId: string) {
    const state = facilityStates[facilityId];
    facilityStates = {
      ...facilityStates,
      [facilityId]: {
        ...state,
        selectedRecipeId: recipeId,
        result: null,
      },
    };
  }

  function updateCraftCount(facilityId: FacilityId, value: number) {
    const safeValue = Number.isFinite(value)
      ? Math.min(Math.max(Math.floor(value), 1), MAX_SIMULATIONS)
      : 1;
    facilityStates = {
      ...facilityStates,
      [facilityId]: {
        ...facilityStates[facilityId],
        craftCount: safeValue,
      },
    };
  }

  function runSimulation(facilityId: FacilityId) {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;

    const state = facilityStates[facilityId];
    const recipe = facility.recipes.find((item) => item.id === state.selectedRecipeId);
    if (!recipe) return;

    const crafts = Math.min(Math.max(Math.floor(state.craftCount), 1), MAX_SIMULATIONS);
    const result = simulateRecipe(recipe, crafts, activeIncentive);

    facilityStates = {
      ...facilityStates,
      [facilityId]: {
        ...state,
        craftCount: crafts,
        result,
      },
    };
  }

  function getRewardDisplay(recipe: CraftRecipe) {
    const totalOdds = recipe.rewards.reduce((sum, reward) => sum + reward.odds, 0);
    return recipe.rewards.map((reward) => ({
      ...reward,
      chance: totalOdds > 0 ? reward.odds / totalOdds : 0,
    }));
  }

  function formatPercent(value: number): string {
    return `${(value * 100).toFixed(value * 100 < 1 ? 2 : 1)}%`;
  }

  // detail.perCraft у основных наград — это amount/crafts (средний выход
  // ШТУК за крафт), не вероятность: если награда даёт >1 шт. за попадание
  // (напр. Material_LP1000 amount="5" в blackhole.txt), это число может
  // превышать 1 - formatPercent тут дал бы бессмысленные "250%". Реальный
  // % шанса — в getRewardDisplay() выше, для темпа выхода нужен свой формат.
  function formatPerCraft(value: number): string {
    return `${value.toFixed(value < 1 ? 2 : value < 10 ? 2 : 1)} шт./крафт`;
  }

  // Рецепты для перемещения из "Рецепты" в "Крафты"
  const RECIPES_TO_MOVE = new Set(['little_rewards_01', 'big_rewards_01', 'big_rewards_02']);

  let regularRecipes = $derived(
    activeFacility.id === 'blackhole'
      ? activeFacility.recipes.filter((r) => !r.id.startsWith('pot_pourri_') && !RECIPES_TO_MOVE.has(r.id))
      : activeFacility.recipes,
  );
  let potPourriRecipes = $derived(
    activeFacility.id === 'blackhole'
      ? activeFacility.recipes.filter((r) => r.id.startsWith('pot_pourri_') || RECIPES_TO_MOVE.has(r.id))
      : [],
  );
</script>

<div class="facility-tabs" role="tablist" aria-label="Станции крафта">
  {#each facilities as facility (facility.id)}
    <button
      type="button"
      class:active={facility.id === activeFacilityId}
      onclick={() => setActiveFacility(facility.id)}
      role="tab"
      aria-selected={facility.id === activeFacilityId}
    >
      <span class="facility-tabs__name">{facility.name}</span>
      <span class="facility-tabs__tagline">{facility.tagline}</span>
    </button>
  {/each}
</div>

<div class="craft-intro" class:open={introOpen}>
  <!-- На десктопе (см. @media в стилях ниже) этот тоггл визуально не активен -
       hero и бонус-блок всегда развёрнуты, кнопка скрыта. Сворачивание нужно
       только на мобилке, чтобы выбор станции не уезжал вниз за длинным
       описанием инструмента. -->
  <button
    type="button"
    class="craft-intro-toggle"
    onclick={() => introOpen = !introOpen}
    aria-expanded={introOpen}
  >
    <span class="badge">Sim • Black Hole Lab</span>
    <span class="craft-intro-toggle__title">Black Hole Craft Lab — о симуляторе и бонусах</span>
    <svg class="sidebar-toggle__chevron" class:rotated={introOpen} width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>

  <section class="craft-hero">
    <div class="craft-hero__card">
      <h1>Black Hole Craft Lab</h1>
      <p>
        Четыре станции крафта на одной странице. Повторяет реальные рецепты Metal Factory,
        Transformatron, Supplies Lab и Black Hole: берём данные из игры, считаем шансы и бонусы.
      </p>
      <dl class="hero-stats" aria-label="Основные показатели симулятора">
        <div>
          <dt>Рецептов</dt>
          <dd>{totalRecipes}</dd>
        </div>
        <div>
          <dt>Уникальных наград</dt>
          <dd>{uniqueRewardIds.size}</dd>
        </div>
        <div>
          <dt>Максимальный бонус за качество</dt>
          <dd>{(maxBonus / 10).toFixed(1)}%</dd>
        </div>
      </dl>
    </div>
  </section>

  <section class="incentive-panel">
    <div class="incentive-card">
      <div class="incentive-card__grid">
      <div class="incentive-card__info">
        <span class="badge badge--soft">Доп. награды</span>
        <h2>Выбери активный бонус</h2>
        <p>Симулятор учитывает шанс бонусной награды.</p>
      </div>
      <div class="incentive-card__controls">
        <label for="incentive-select">Активный бонус</label>
        <select
          id="incentive-select"
          value={useCycleIncentive ? '__cycle__' : activeIncentiveId}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v === '__cycle__') { useCycleIncentive = true; selectedCycleIndex = null; }
            else { pickManualIncentive(v); }
          }}
          aria-label="Активная дополнительная награда"
        >
          <option value="__cycle__">Текущая по расписанию (авто)</option>
          <option value="">Без бонуса</option>
          {#each incentiveRewards as incentive, index (index)}
            <option value={incentive.id}>
              {translateItemId(incentive.id)} — {(incentive.per1000 / 10).toFixed(1)}%
            </option>
          {/each}
        </select>
      </div>
      {#if activeIncentive}
        <div class="incentive-card__stats">
          <div>
            <span class="metric-label">Награда</span>
            <span class="metric-value">{translateItemId(activeIncentive.id)}</span>
          </div>
          <div>
            <span class="metric-label">Шанс</span>
            <span class="metric-value">{(activeIncentive.probability * 100).toFixed(1)}%</span>
          </div>
          <div>
            <span class="metric-label">Длительность</span>
            <span class="metric-value">{formatDurationMinutes(activeIncentive.duration)}</span>
          </div>
          {#if useCycleIncentive && cycleState}
            <div>
              <span class="metric-label">Сменится через</span>
              <span class="metric-value">{formatDurationMinutes(Math.round(cycleState.remainingMinutes))}</span>
            </div>
          {/if}
        </div>
      {/if}
      </div>

      {#if cycleState}
        <div class="incentive-cycle">
          <div class="incentive-cycle__header">
            <span class="badge badge--soft">Цикл наград</span>
            <span class="incentive-cycle__hint">
              Игра крутит эти {incentiveLoopOrder.length} наград по кругу с фиксированной длительностью каждой
              (полный круг — {formatDurationMinutes(cycleState.totalCycleMinutes)}). Ниже — вся
              последовательность, подсвечена активная сейчас.
            </span>
          </div>
          <div class="incentive-cycle__track">
            {#each incentiveLoopOrder as entry, i (i)}
              <button
                class="incentive-cycle__slot"
                class:active={i === cycleState.activeIndex}
                class:selected={i === selectedCycleIndex}
                onclick={() => pickManualIncentive(entry.id, i)}
                title={`${translateItemId(entry.id)} — ${(entry.per1000 / 10).toFixed(1)}%, ${formatDurationMinutes(entry.duration)}`}
              >
                {#if i === cycleState.activeIndex}
                  <span class="incentive-cycle__now">сейчас</span>
                {:else if i === selectedCycleIndex}
                  <span class="incentive-cycle__picked">выбрано</span>
                {/if}
                {#if getItemTexture(entry.id)}
                  <img src={textureUrl(getItemTexture(entry.id) ?? '')} alt="" loading="lazy" />
                {/if}
                <span class="incentive-cycle__slot-name">{translateItemId(entry.id)}</span>
                <span class="incentive-cycle__slot-meta">{(entry.per1000 / 10).toFixed(1)}% · {formatDurationMinutes(entry.duration)}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>
</div>

{#if activeFacility}
  {@const state = facilityStates[activeFacility.id]}
  {@const currentRecipe =
    activeFacility.recipes.find((recipe) => recipe.id === state.selectedRecipeId) ??
    activeFacility.recipes[0]}
  {@const rewardDisplay = currentRecipe ? getRewardDisplay(currentRecipe) : []}
  {@const incentiveChance = calculateIncentiveChance(currentRecipe, activeIncentive)}
  {@const bonusRange = getBonusRange(activeFacility.recipes)}

  <section
    class="facility"
    style={`--accent: ${activeFacility.accent}; --glow: ${activeFacility.glow};`}
  >
    <div class="facility__background" style={`background-image: ${activeFacility.gradient};`}></div>
    <div class="facility__inner">
      <aside class="facility__sidebar" class:open={sidebarOpen}>
        <button
          type="button"
          class="sidebar-toggle"
          onclick={() => sidebarOpen = !sidebarOpen}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? 'Свернуть информацию' : 'Развернуть информацию'}
        >
          <span class="badge badge--outline">{activeFacility.badge}</span>
          <h2>{activeFacility.name}</h2>
          <svg class="sidebar-toggle__chevron" class:rotated={sidebarOpen} width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="facility__header">
          <p>{activeFacility.description}</p>
        </div>
        <div class="facility__featured" aria-label="Ключевые награды">
          {#each activeFacility.featuredRewards as item (item.id)}
            <div class="featured-item">
              {#if item.icon}
                <img src={textureUrl(item.icon)} alt={item.label} />
              {:else}
                <span>{item.label.slice(0, 1)}</span>
              {/if}
              <span class="featured-item__label">{item.label}</span>
            </div>
          {/each}
        </div>
        <dl class="facility__stats" aria-label="Статистика секции">
          <div>
            <dt>Рецептов</dt>
            <dd>{activeFacility.recipes.length}</dd>
          </div>
          <div>
            <dt>Бонус за качество материалов</dt>
            <dd>
              {bonusRange.min === bonusRange.max
                ? `${(bonusRange.max / 10).toFixed(1)}%`
                : `${(bonusRange.min / 10).toFixed(1)}–${(bonusRange.max / 10).toFixed(1)}%`}
            </dd>
          </div>
        </dl>
      </aside>

      <div class="facility__content">
        {#if activeFacility.id === 'blackhole'}
          <div class="recipes-container">
            <div class="recipes-group">
              <h4 class="group-title">Рецепты</h4>
              <div class="recipe-selector">
                {#each regularRecipes as recipe (recipe.id)}
                  {@const displayReward = recipe.rewards[0]}
                  <!-- For specific recipe IDs, use the recipe ID for translation instead of the first reward -->
                  {@const isSpecialRecipe = recipe.id === 'orb_basic_1' || recipe.id === 'orb_basic_2' || recipe.id === 'orb_basic_3' || recipe.id === 'orb_basic_4' || recipe.id === 'orb_special_1' || recipe.id === 'orb_special_2' || recipe.id === 'orb_special_3' || recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1' || recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2' || recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'}
                  {@const baseLabel = isSpecialRecipe ? translateItemId(recipe.id) : (displayReward ? translateItemId(displayReward.id) : 'Рецепт')}
                  {@const rewardIcon = isSpecialRecipe ? getItemTexture(recipe.id) : (displayReward ? getItemTexture(displayReward.id) : null)}
                  <button
                    type="button"
                    class:selected={recipe.id === currentRecipe?.id}
                    onclick={() => selectRecipe(activeFacility.id, recipe.id)}
                    role="tab"
                    aria-selected={recipe.id === currentRecipe?.id}
                  >
                    {#if rewardIcon}
                      <img src={textureUrl(rewardIcon)} alt={baseLabel} />
                    {/if}
                    <span class="recipe-selector__title">{baseLabel}</span>
                  </button>
                {/each}
              </div>
            </div>

            <div class="recipes-group">
              <h4 class="group-title">Крафты</h4>
              <div class="recipe-selector">
                {#each potPourriRecipes as recipe (recipe.id)}
                  {@const displayReward = recipe.rewards[0]}
                  <!-- For specific recipe IDs, use the recipe ID for translation instead of the first reward -->
                  {@const isSpecialRecipe = recipe.id === 'orb_basic_1' || recipe.id === 'orb_basic_2' || recipe.id === 'orb_basic_3' || recipe.id === 'orb_basic_4' || recipe.id === 'orb_special_1' || recipe.id === 'orb_special_2' || recipe.id === 'orb_special_3' || recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1' || recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2' || recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'}
                  {@const isMovedRecipe = RECIPES_TO_MOVE.has(recipe.id)}
                  {@const useRecipeIdLabel = isSpecialRecipe || isMovedRecipe}
                  {@const baseLabel = useRecipeIdLabel ? translateItemId(recipe.id) : (displayReward ? translateItemId(displayReward.id) : 'Рецепт')}
                  {@const totalIngredients = recipe.ingredients.reduce(
                    (sum, ing) => sum + ing.amount,
                    0,
                  )}
                  <!-- Для pot_pourri_* используем формат "Средняя аптечка xN", для token_sink_* и big_rewards_* убираем множитель -->
                  {@const isPotPourriRecipe = recipe.id.startsWith('pot_pourri_')}
                  {@const isTokenSinkRecipe = recipe.id.startsWith('token_sink_')}
                  {@const skipMultiplier = isTokenSinkRecipe || recipe.id === 'big_rewards_01' || recipe.id === 'big_rewards_02' || recipe.id === 'little_rewards_01'}
                  {@const rewardLabel = isPotPourriRecipe
                    ? `Средняя аптечка x${totalIngredients}`
                    : skipMultiplier
                      ? baseLabel
                      : useRecipeIdLabel
                        ? `${translateItemId(recipe.id)} ×${totalIngredients}`
                        : `${baseLabel} ×${totalIngredients}`}
                  {@const rewardIcon = isPotPourriRecipe ? textureUrl('/med/normal_med.webp') : (useRecipeIdLabel ? getItemTexture(recipe.id) : (displayReward ? getItemTexture(displayReward.id) : null))}
                  <button
                    type="button"
                    class:selected={recipe.id === currentRecipe?.id}
                    onclick={() => selectRecipe(activeFacility.id, recipe.id)}
                    role="tab"
                    aria-selected={recipe.id === currentRecipe?.id}
                  >
                    {#if rewardIcon}
                      <img src={textureUrl(rewardIcon)} alt={rewardLabel} />
                    {/if}
                    <span class="recipe-selector__title">{rewardLabel}</span>
                  </button>
                {/each}
              </div>
            </div>
          </div>
        {:else if activeFacility.id === 'transformatron'}
          <!-- Group orb recipes by output result level (strict logic) -->
          {@const allRecipes = activeFacility.recipes}
          {@const level1Recipes = allRecipes.filter(recipe => 
            recipe.rewards.some(reward => 
              reward.id.includes('_01')
            ) || 
            recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1'
          )}
          {@const level2Recipes = allRecipes.filter(recipe => 
            recipe.rewards.some(reward => 
              reward.id.includes('_02')
            ) || 
            recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2'
          )}
          {@const level3Recipes = allRecipes.filter(recipe => 
            recipe.rewards.some(reward => 
              reward.id.includes('_03')
            ) || 
            recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'
          )}
          {@const level4Recipes = allRecipes.filter(recipe => 
            recipe.rewards.some(reward => 
              reward.id.includes('_04')
            )
          )}
          
          <!-- Apply mutual exclusivity to prevent duplicates -->
          {@const filteredLevel2Recipes = level2Recipes.filter(recipe => 
            !level1Recipes.includes(recipe)
          )}
          {@const filteredLevel3Recipes = level3Recipes.filter(recipe => 
            !level1Recipes.includes(recipe) && !filteredLevel2Recipes.includes(recipe)
          )}
          {@const filteredLevel4Recipes = level4Recipes.filter(recipe => 
            !level1Recipes.includes(recipe) && !filteredLevel2Recipes.includes(recipe) && !filteredLevel3Recipes.includes(recipe)
          )}

          <div class="recipe-groups">
            {#if level1Recipes.length > 0}
              <div class="recipes-group">
                <h4 class="group-title">КРАФТ СФЕР 1 УРОВНЯ</h4>
                <div class="recipe-selector grid-3-4">
                  {#each level1Recipes as recipe (recipe.id)}
                    {@const displayReward = recipe.rewards[0]}
                    <!-- For specific recipe IDs, use the recipe ID for translation instead of the first reward -->
                    {@const isSpecialRecipe = recipe.id === 'orb_basic_1' || recipe.id === 'orb_basic_2' || recipe.id === 'orb_basic_3' || recipe.id === 'orb_basic_4' || recipe.id === 'orb_special_1' || recipe.id === 'orb_special_2' || recipe.id === 'orb_special_3' || recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1' || recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2' || recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'}
                    {@const baseLabel = isSpecialRecipe ? translateItemId(recipe.id) : (displayReward ? translateItemId(displayReward.id) : 'Рецепт')}
                    {@const totalIngredients = recipe.ingredients.reduce(
                      (sum, ing) => sum + ing.amount,
                      0,
                    )}
                    {@const rewardLabel = recipe.id.startsWith('pot_pourri_')
                      ? `Средняя аптечка x${totalIngredients}`
                      : baseLabel}
                    {@const rewardIcon = isSpecialRecipe ? getItemTexture(recipe.id) : (displayReward ? getItemTexture(displayReward.id) : null)}
                    <button
                      type="button"
                      class:selected={recipe.id === currentRecipe?.id}
                      onclick={() => selectRecipe(activeFacility.id, recipe.id)}
                      role="tab"
                      aria-selected={recipe.id === currentRecipe?.id}
                    >
                      {#if rewardIcon}
                        <img src={textureUrl(rewardIcon)} alt={rewardLabel} />
                      {/if}
                      <span class="recipe-selector__title">{rewardLabel}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if filteredLevel2Recipes.length > 0}
              <div class="recipes-group">
                <h4 class="group-title">КРАФТ СФЕР 2 УРОВНЯ</h4>
                <div class="recipe-selector grid-3-4">
                  {#each filteredLevel2Recipes as recipe (recipe.id)}
                    {@const displayReward = recipe.rewards[0]}
                    <!-- For specific recipe IDs, use the recipe ID for translation instead of the first reward -->
                    {@const isSpecialRecipe = recipe.id === 'orb_basic_1' || recipe.id === 'orb_basic_2' || recipe.id === 'orb_basic_3' || recipe.id === 'orb_basic_4' || recipe.id === 'orb_special_1' || recipe.id === 'orb_special_2' || recipe.id === 'orb_special_3' || recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1' || recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2' || recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'}
                    {@const baseLabel = isSpecialRecipe ? translateItemId(recipe.id) : (displayReward ? translateItemId(displayReward.id) : 'Рецепт')}
                    {@const totalIngredients = recipe.ingredients.reduce(
                      (sum, ing) => sum + ing.amount,
                      0,
                    )}
                    {@const rewardLabel = recipe.id.startsWith('pot_pourri_')
                      ? `Средняя аптечка x${totalIngredients}`
                      : baseLabel}
                    {@const rewardIcon = isSpecialRecipe ? getItemTexture(recipe.id) : (displayReward ? getItemTexture(displayReward.id) : null)}
                    <button
                      type="button"
                      class:selected={recipe.id === currentRecipe?.id}
                      onclick={() => selectRecipe(activeFacility.id, recipe.id)}
                      role="tab"
                      aria-selected={recipe.id === currentRecipe?.id}
                    >
                      {#if rewardIcon}
                        <img src={textureUrl(rewardIcon)} alt={rewardLabel} />
                      {/if}
                      <span class="recipe-selector__title">{rewardLabel}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if filteredLevel3Recipes.length > 0}
              <div class="recipes-group">
                <h4 class="group-title">КРАФТ СФЕР 3 УРОВНЯ</h4>
                <div class="recipe-selector grid-3-4">
                  {#each filteredLevel3Recipes as recipe (recipe.id)}
                    {@const displayReward = recipe.rewards[0]}
                    <!-- For specific recipe IDs, use the recipe ID for translation instead of the first reward -->
                    {@const isSpecialRecipe = recipe.id === 'orb_basic_1' || recipe.id === 'orb_basic_2' || recipe.id === 'orb_basic_3' || recipe.id === 'orb_basic_4' || recipe.id === 'orb_special_1' || recipe.id === 'orb_special_2' || recipe.id === 'orb_special_3' || recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1' || recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2' || recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'}
                    {@const baseLabel = isSpecialRecipe ? translateItemId(recipe.id) : (displayReward ? translateItemId(displayReward.id) : 'Рецепт')}
                    {@const totalIngredients = recipe.ingredients.reduce(
                      (sum, ing) => sum + ing.amount,
                      0,
                    )}
                    {@const rewardLabel = recipe.id.startsWith('pot_pourri_')
                      ? `Средняя аптечка x${totalIngredients}`
                      : baseLabel}
                    {@const rewardIcon = isSpecialRecipe ? getItemTexture(recipe.id) : (displayReward ? getItemTexture(displayReward.id) : null)}
                    <button
                      type="button"
                      class:selected={recipe.id === currentRecipe?.id}
                      onclick={() => selectRecipe(activeFacility.id, recipe.id)}
                      role="tab"
                      aria-selected={recipe.id === currentRecipe?.id}
                    >
                      {#if rewardIcon}
                        <img src={textureUrl(rewardIcon)} alt={rewardLabel} />
                      {/if}
                      <span class="recipe-selector__title">{rewardLabel}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if filteredLevel4Recipes.length > 0}
              <div class="recipes-group">
                <h4 class="group-title">КРАФТ СФЕР 4 УРОВНЯ</h4>
                <div class="recipe-selector grid-3-4">
                  {#each filteredLevel4Recipes as recipe (recipe.id)}
                    {@const displayReward = recipe.rewards[0]}
                    <!-- For specific recipe IDs, use the recipe ID for translation instead of the first reward -->
                    {@const isSpecialRecipe = recipe.id === 'orb_basic_1' || recipe.id === 'orb_basic_2' || recipe.id === 'orb_basic_3' || recipe.id === 'orb_basic_4' || recipe.id === 'orb_special_1' || recipe.id === 'orb_special_2' || recipe.id === 'orb_special_3' || recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1' || recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2' || recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'}
                    {@const baseLabel = isSpecialRecipe ? translateItemId(recipe.id) : (displayReward ? translateItemId(displayReward.id) : 'Рецепт')}
                    {@const totalIngredients = recipe.ingredients.reduce(
                      (sum, ing) => sum + ing.amount,
                      0,
                    )}
                    {@const rewardLabel = recipe.id.startsWith('pot_pourri_')
                      ? `Средняя аптечка x${totalIngredients}`
                      : baseLabel}
                    {@const rewardIcon = isSpecialRecipe ? getItemTexture(recipe.id) : (displayReward ? getItemTexture(displayReward.id) : null)}
                    <button
                      type="button"
                      class:selected={recipe.id === currentRecipe?.id}
                      onclick={() => selectRecipe(activeFacility.id, recipe.id)}
                      role="tab"
                      aria-selected={recipe.id === currentRecipe?.id}
                    >
                      {#if rewardIcon}
                        <img src={textureUrl(rewardIcon)} alt={rewardLabel} />
                      {/if}
                      <span class="recipe-selector__title">{rewardLabel}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <div
            class="recipe-selector"
            role="tablist"
            aria-label={`Рецепты ${activeFacility.name}`}
            class:grid-3-4={activeFacility.id !== 'metal'}
          >
            {#each activeFacility.recipes as recipe (recipe.id)}
              {@const displayReward = recipe.rewards[0]}
              <!-- For specific recipe IDs, use the recipe ID for translation instead of the first reward -->
              {@const isSpecialRecipe = recipe.id === 'orb_basic_1' || recipe.id === 'orb_basic_2' || recipe.id === 'orb_basic_3' || recipe.id === 'orb_basic_4' || recipe.id === 'orb_special_1' || recipe.id === 'orb_special_2' || recipe.id === 'orb_special_3' || recipe.id === 'orb_reroll_basic_1' || recipe.id === 'orb_reroll_special_1' || recipe.id === 'orb_reroll_basic_2' || recipe.id === 'orb_reroll_special_2' || recipe.id === 'orb_reroll_basic_3' || recipe.id === 'orb_reroll_special_3'}
              {@const baseLabel = isSpecialRecipe ? translateItemId(recipe.id) : (displayReward ? translateItemId(displayReward.id) : 'Рецепт')}
              {@const totalIngredients = recipe.ingredients.reduce(
                (sum, ing) => sum + ing.amount,
                0,
              )}
              {@const rewardLabel = recipe.id.startsWith('pot_pourri_')
                ? `Средняя аптечка x${totalIngredients}`
                : baseLabel}
              {@const rewardIcon = isSpecialRecipe ? getItemTexture(recipe.id) : (displayReward ? getItemTexture(displayReward.id) : null)}
              <button
                type="button"
                class:selected={recipe.id === currentRecipe?.id}
                onclick={() => selectRecipe(activeFacility.id, recipe.id)}
                role="tab"
                aria-selected={recipe.id === currentRecipe?.id}
              >
                {#if rewardIcon}
                  <img src={textureUrl(rewardIcon)} alt={rewardLabel} />
                {/if}
                <span class="recipe-selector__title">{rewardLabel}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if currentRecipe}
          {@const totalIngredientPieces = currentRecipe
            ? currentRecipe.ingredients.reduce((sum, ingredient) => sum + ingredient.amount, 0)
            : 0}
          <div class="recipe-card">
            <header class="recipe-card__header">
              <div>
                <h3>
                  {currentRecipe.rewards.length
                    ? (RECIPE_HEADER_TITLES[currentRecipe.id] ?? translateItemId(currentRecipe.id))
                    : 'Рецепт'}
                </h3>
                <p class="recipe-card__subtitle">
                  {currentRecipe.ingredients.length} {ingredientTypesLabel(currentRecipe.ingredients.length)} ингредиентов • {totalIngredientPieces} предметов
                </p>
              </div>
              <div class="recipe-card__meta">
                {#if currentRecipe.bonusPer1000 > 0}
                  <span class="meta-pill">
                    Бонус за качество материалов: {(currentRecipe.bonusPer1000 / 10).toFixed(1)}%
                  </span>
                {/if}
                {#if incentiveChance > 0}
                  <span class="meta-pill meta-pill--accent">
                    Шанс доп. награды: {formatPercent(incentiveChance)}
                  </span>
                {/if}
              </div>
            </header>

            <div class="recipe-card__body">
              <!-- Ингредиенты -->
              <div class="recipe-section">
                <h4>Ингредиенты</h4>
                <ul class="ingredient-list">
                  {#each currentRecipe.ingredients as ingredient, index (ingredient.regex + index)}
                    {@const label = describeIngredientRegex(ingredient.regex)}
                    {@const icon = getItemTexture(ingredient.regex)}
                    <li>
                      <div class="item-icon">
                        {#if icon}
                          <img src={textureUrl(icon)} alt={label} />
                        {:else}
                          <span>{label.slice(0, 1)}</span>
                        {/if}
                      </div>
                      <div class="item-info">
                        <span class="item-title">{label}</span>
                        <span class="item-sub">×{ingredient.amount}</span>
                      </div>
                    </li>
                  {/each}
                </ul>
              </div>

              <!-- Награды -->
              <div class="recipe-section">
                <h4>Награды</h4>
                <div class="rewards-scroll">
                  <ul class="reward-list">
                    {#each rewardDisplay as reward, index (index)}
                      {@const label = translateItemId(reward.id)}
                      {@const icon = getItemTexture(reward.id)}
                      <li>
                        <div class="item-icon">
                          {#if icon}
                            <img src={textureUrl(icon)} alt={label} />
                          {:else}
                            <span>{label.slice(0, 1)}</span>
                          {/if}
                        </div>
                        <div class="item-info">
                          <span class="item-title">{label}</span>
                          <span class="item-sub">
                            ×{reward.amount}
                          </span>
                        </div>
                        <div class="item-odds">
                          <span>{formatPercent(reward.chance)}</span>
                        </div>
                      </li>
                    {/each}
                  </ul>
                </div>
              </div>
            </div>

            <!-- Блок симуляции -->
            <div class="simulation-controls">
              <div class="craft-input">
                <label for={`craft-count-${activeFacility.id}`}>Количество крафтов</label>
                <input
                  id={`craft-count-${activeFacility.id}`}
                  type="number"
                  min="1"
                  max={MAX_SIMULATIONS}
                  value={state.craftCount}
                  oninput={(event) =>
                    updateCraftCount(activeFacility.id, Number(event.currentTarget.value))}
                />
              </div>
              <button
                type="button"
                class="simulate-btn"
                onclick={() => runSimulation(activeFacility.id)}
              >
                🎲 Симулировать
              </button>
            </div>

            <!-- Результаты симуляции -->
            {#if state.result}
              {@const rewardDetails = state.result.rewardDetails}
              {@const incentiveDetails = state.result.incentiveDetails}
              {@const totalMain = rewardDetails.reduce((sum, item) => sum + item.amount, 0)}
              <div class="results-card">
                <header>
                  <h4>Результаты {state.result.crafts} крафтов</h4>
                  {#if state.result.expectedIncentiveChance > 0 && activeIncentive}
                    <span>
                      Ожидалось доп. награды:
                      {formatPercent(state.result.expectedIncentiveChance)} за крафт
                    </span>
                  {/if}
                </header>

                <div class="results-grid">
                  <div>
                    <h5>Основные награды</h5>
                    {#if rewardDetails.length > 0}
                      <ul>
                        {#each rewardDetails as detail (detail.id)}
                          {@const label = translateItemId(detail.id)}
                          {@const icon = getItemTexture(detail.id)}
                          <li>
                            <div class="item-icon">
                              {#if icon}
                                <img src={textureUrl(icon)} alt={label} />
                              {:else}
                                <span>{label.slice(0, 1)}</span>
                              {/if}
                            </div>
                            <div class="item-info">
                              <span class="item-title">{label}</span>
                              <span class="item-sub">
                                {detail.amount} шт. • {formatPerCraft(detail.perCraft)}
                              </span>
                            </div>
                            <div class="item-odds">
                              <span>{formatPerCraft(detail.perCraft)}</span>
                              <span class="item-odds__raw">
                                {totalMain > 0 ? formatPercent(detail.share) : '—'} от дропа
                              </span>
                            </div>
                          </li>
                        {/each}
                      </ul>
                    {:else}
                      <p class="empty">Наград нет — попробуйте увеличить количество крафтов.</p>
                    {/if}
                  </div>

                  <div>
                    <h5>Дополнительные награды</h5>
                    {#if incentiveDetails.length > 0}
                      <ul>
                        {#each incentiveDetails as detail (detail.id)}
                          {@const label = translateItemId(detail.id)}
                          {@const icon = getItemTexture(detail.id)}
                          <li>
                            <div class="item-icon">
                              {#if icon}
                                <img src={textureUrl(icon)} alt={label} />
                              {:else}
                                <span>{label.slice(0, 1)}</span>
                              {/if}
                            </div>
                            <div class="item-info">
                              <span class="item-title">{label}</span>
                              <span class="item-sub">
                                {detail.amount} шт. • {formatPercent(detail.perCraft)} за крафт
                              </span>
                            </div>
                          </li>
                        {/each}
                      </ul>
                    {:else}
                      <p class="empty">Дополнительные награды не выпали.</p>
                    {/if}
                  </div>
                </div>

                {#if state.result.log.length > 0}
                  <div class="results-log">
                    <h5>Текстовый лог</h5>
                    <ul>
                      {#each state.result.log as line, index}
                        <li>
                          <span class="results-log__index">{index + 1}.</span>
                          <span>{line}</span>
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  :global(body) {
    background: radial-gradient(circle at top left, rgba(15, 23, 42, 0.8), rgba(2, 6, 23, 0.95));
    margin: 0;
    overflow-x: hidden;
  }

  section + section {
    margin-top: 3rem;
  }

  /* Тоггл сворачивания intro — виден только на мобилке (см. @media ниже) */
  .craft-intro-toggle { display: none; }

  /* --- HERO СЕКЦИЯ --- */
  .craft-hero {
    margin-bottom: 2.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .craft-hero__card {
    position: relative;
    padding: 3rem;
    border-radius: 36px;
    background: radial-gradient(circle at 20% 20%, rgba(147, 51, 234, 0.25), rgba(17, 24, 39, 0.95));
    border: 1px solid rgba(192, 132, 252, 0.35);
    box-shadow: 0 32px 60px rgba(76, 29, 149, 0.35);
    overflow: hidden;
  }

  .craft-hero__card::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 80% -10%, rgba(255, 255, 255, 0.2), transparent 60%);
    pointer-events: none;
    mix-blend-mode: screen;
  }

  /* --- ТИПОГРАФИКА И БЕЙДЖИ --- */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 1.1rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(226, 232, 240, 0.9);
    font-size: 0.82rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .badge--soft {
    background: rgba(139, 92, 246, 0.15);
    color: #c4b5fd;
  }
  .badge--outline {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(226, 232, 240, 0.85);
  }

  h1 {
    margin: 1rem 0 0.8rem;
    font-size: clamp(2rem, 5vw, 3.4rem);
    color: #ede9fe;
    word-wrap: break-word;
  }
  h2 {
    margin: 0.75rem 0;
    font-size: clamp(1.5rem, 4vw, 2.4rem);
    color: rgba(248, 250, 252, 0.95);
  }
  h3 {
    margin: 0.35rem 0 0;
    font-size: clamp(1.2rem, 3vw, 1.9rem);
    color: rgba(248, 250, 252, 0.92);
  }
  p {
    margin: 0;
    color: rgba(226, 232, 240, 0.9);
    line-height: 1.7;
    max-width: 720px;
    font-size: 1.05rem;
  }

  .hero-stats {
    margin: 2.2rem 0 0;
    display: grid;
    gap: 1.5rem;
    /* Адаптивная сетка, но не меньше 140px */
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  dt {
    margin: 0 0 0.35rem;
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #e5e7eb;
  }
  dd {
    margin: 0;
    font-size: 1.35rem;
    color: rgba(248, 250, 252, 0.95);
    font-weight: 600;
  }

  /* --- БОНУСЫ --- */
  .incentive-panel {
    display: flex;
    justify-content: center;
    width: 100%;
    box-sizing: border-box;
  }
  .incentive-card {
    position: relative;
    width: 100%;
    box-sizing: border-box;
    padding: 2.5rem;
    border-radius: 28px;
    background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(17, 24, 39, 0.92));
    border: 1px solid rgba(99, 102, 241, 0.25);
    box-shadow: 0 20px 40px rgba(30, 64, 175, 0.35);
  }

  /* Три инфо-блока (описание/выбор/статы) - отдельный грид, изолированный
     от .incentive-cycle ниже, иначе auto-fit считает колонки по строке
     цикла (grid-column: 1/-1) и оставляет в этой строке пустые треки. */
  .incentive-card__grid {
    display: grid;
    gap: 1.75rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    align-items: start;
  }

  .incentive-card__controls {
    min-width: 0;
  } /* Фикс переполнения */
  .incentive-card__controls select {
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: 16px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.8);
    color: rgba(226, 232, 240, 0.95);
    font-size: 1rem;
    max-width: 100%;
  }
  .incentive-card__controls label {
    display: block;
    margin-bottom: 0.65rem;
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #e5e7eb;
  }

  .incentive-card__stats {
    display: grid;
    gap: 1rem;
    padding: 1rem 1.4rem;
    border-radius: 20px;
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(96, 165, 250, 0.25);
    min-width: 0;
  }
  .metric-label {
    display: block;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #e5e7eb;
    margin-bottom: 0.35rem;
  }
  .metric-value {
    font-size: 1.05rem;
    font-weight: 600;
    color: rgba(248, 250, 252, 0.92);
    word-break: break-word;
  }

  /* --- ЦИКЛ ДОП. НАГРАД --- */
  .incentive-cycle {
    margin-top: 1.75rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(148, 163, 184, 0.18);
  }
  .incentive-cycle__header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .incentive-cycle__hint {
    font-size: 0.82rem;
    line-height: 1.5;
    color: rgba(203, 213, 225, 0.75);
  }
  .incentive-cycle__track {
    display: flex;
    gap: 0.6rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    scrollbar-width: thin;
  }
  .incentive-cycle__slot {
    position: relative;
    flex: 0 0 auto;
    width: 108px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.75rem 0.5rem;
    border-radius: 14px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(15, 23, 42, 0.55);
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: center;
    transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
  }
  .incentive-cycle__slot:hover {
    border-color: rgba(148, 163, 184, 0.5);
    transform: translateY(-2px);
  }
  .incentive-cycle__slot.active {
    border-color: rgba(96, 165, 250, 0.9);
    background: rgba(59, 130, 246, 0.22);
    box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.4), 0 8px 20px rgba(30, 64, 175, 0.35);
  }
  /* Выбрано вручную (клик по карточке), но это НЕ то же самое, что реально
     активно по циклу прямо сейчас - другой акцентный цвет, чтобы не путать. */
  .incentive-cycle__slot.selected:not(.active) {
    border-color: rgba(217, 119, 6, 0.9);
    background: rgba(217, 119, 6, 0.18);
    box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.4), 0 8px 20px rgba(120, 53, 15, 0.35);
  }
  .incentive-cycle__slot img {
    width: 36px;
    height: 36px;
    object-fit: contain;
  }
  .incentive-cycle__slot-name {
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.25;
    color: rgba(226, 232, 240, 0.95);
  }
  .incentive-cycle__slot-meta {
    font-size: 0.65rem;
    color: rgba(203, 213, 225, 0.7);
  }
  .incentive-cycle__now,
  .incentive-cycle__picked {
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    color: white;
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .incentive-cycle__now {
    background: #3b82f6;
  }
  .incentive-cycle__picked {
    background: #d97706;
  }

  /* --- ТАБЫ --- */
  .facility-tabs {
    margin: 3rem 0 2rem;
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: center;
    width: 100%;
  }
  .facility-tabs button {
    display: grid;
    gap: 0.25rem;
    padding: 1rem 1.4rem;
    border-radius: 18px;
    border: 1px solid rgba(99, 102, 241, 0.25);
    background: rgba(30, 41, 59, 0.65);
    color: rgba(226, 232, 240, 0.82);
    text-align: left;
    cursor: pointer;
    min-width: 200px;
    flex: 1 1 auto;
    transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
  }
  .facility-tabs button.active {
    border-color: rgba(192, 132, 252, 0.45);
    background: rgba(76, 29, 149, 0.35);
    box-shadow: 0 18px 30px rgba(76, 29, 149, 0.25);
    color: rgba(248, 250, 252, 0.95);
  }
  .facility-tabs button:hover {
    transform: translateY(-2px);
    border-color: rgba(129, 140, 248, 0.5);
  }
  .facility-tabs__name {
    font-weight: 600;
    font-size: 1.05rem;
  }
  .facility-tabs__tagline {
    font-size: 0.85rem;
    color: #e5e7eb;
  }

  /* --- ОСНОВНОЙ ЛЕЙАУТ --- */
  .facility {
    position: relative;
    border-radius: 40px;
    overflow: hidden;
    box-shadow: 0 28px 60px rgba(0, 0, 0, 0.35);
    width: 100%;
    box-sizing: border-box;
  }
  .facility__background {
    position: absolute;
    inset: 0;
    opacity: 0.92;
    pointer-events: none;
  }

  .facility__inner {
    position: relative;
    display: grid;
    /* Десктопная сетка */
    grid-template-columns: minmax(240px, 320px) 1fr;
    gap: 0;
  }

  /* САЙДБАР */
  .facility__sidebar {
    position: relative;
    padding: 2.8rem 2.4rem;
    background: linear-gradient(160deg, rgba(15, 23, 42, 0.85), rgba(15, 15, 18, 0.85));
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    display: grid;
    gap: 2rem;
    align-content: start;
  }
  .sidebar-toggle {
    display: none;
  }
  .facility__sidebar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at top, var(--glow), transparent 65%);
    opacity: 0.7;
    pointer-events: none;
  }

  .facility__header h2 {
    margin-bottom: 0.4rem;
  }
  .facility__header p {
    color: rgba(226, 232, 240, 0.75);
    overflow-wrap: break-word;
    word-wrap: break-word;
    word-break: normal;
    hyphens: none;
  }

  .facility__featured {
    display: grid;
    gap: 1.1rem;
  }
  .featured-item {
    display: grid;
    grid-template-columns: 48px 1fr;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 0.8rem;
    border-radius: 18px;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.15);
  }
  .featured-item img {
    width: 48px;
    height: 48px;
    object-fit: contain;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
  }
  .featured-item__label {
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.2;
    color: #fff;
  }
  .facility__stats {
    display: grid;
    gap: 1.2rem;
  }

  /* КОНТЕНТ */
  .facility__content {
    position: relative;
    padding: 2.8rem;
    display: grid;
    gap: 2rem;
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
  }

  .recipe-selector {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  }
  .recipe-selector button {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: center;
    justify-content: center;
    padding: 0.75rem;
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(15, 23, 42, 0.78);
    color: rgba(226, 232, 240, 0.85);
    cursor: pointer;
    transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
    width: 100%;
  }
  .recipe-selector button img {
    width: 38px;
    height: 38px;
    object-fit: contain;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
  }
  .recipe-selector button.selected {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.35);
    box-shadow: 0 16px 28px rgba(0, 0, 0, 0.35);
  }
  .recipe-selector__title {
    font-weight: 600;
    text-align: center;
    color: rgba(248, 250, 252, 0.92);
    font-size: 0.8rem;
    line-height: 1.2;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* КАРТОЧКА РЕЦЕПТА */
  .recipe-card {
    position: relative;
    border-radius: 28px;
    background: rgba(15, 23, 42, 0.82);
    border: 1px solid rgba(148, 163, 184, 0.18);
    box-shadow: 0 18px 32px rgba(0, 0, 0, 0.35);
    display: grid;
    gap: 1.75rem;
    padding: 2.2rem;
    width: 100%;
    box-sizing: border-box;
  }
  .recipe-card__header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
  }
  .recipe-card__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: flex-end;
  }
  .recipe-card__subtitle {
    margin: 0.3rem 0 0;
    color: #e5e7eb;
    font-size: 0.95rem;
  }
  .meta-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(226, 232, 240, 0.85);
    font-size: 0.85rem;
  }
  .meta-pill--accent {
    background: rgba(34, 197, 94, 0.15);
    color: rgba(134, 239, 172, 0.95);
  }

  /* СЕТКА ИНГРЕДИЕНТОВ И НАГРАД */
  .recipe-card__body {
    display: grid;
    gap: 1.8rem;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
  .recipe-section h4 {
    margin: 0 0 1rem;
    font-size: 1.1rem;
    color: rgba(248, 250, 252, 0.92);
  }

  .ingredient-list,
  .reward-list,
  .results-grid ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.9rem;
  }
  .ingredient-list li,
  .reward-list li,
  .results-grid li {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    align-items: center;
    gap: 0.9rem;
    padding: 0.75rem 1rem;
    border-radius: 18px;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.15);
  }
  .item-icon {
    width: var(--orb-size-container);
    height: var(--orb-size-container);
    display: grid;
    place-items: center;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    overflow: hidden;
    flex-shrink: 0;
  }
  .item-icon img {
    width: var(--orb-size-img);
    height: var(--orb-size-img);
    object-fit: contain;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.45));
  }
  .item-info {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  } /* min-width: 0 позволяет тексту сжиматься */
  .item-title {
    font-weight: 600;
    color: rgba(248, 250, 252, 0.92);
    font-size: 0.95rem;
    white-space: normal;
    overflow-wrap: break-word;
  }
  .item-sub {
    font-size: 0.85rem;
    color: #e5e7eb;
  }
  .item-odds {
    text-align: right;
    color: rgba(226, 232, 240, 0.9);
    font-weight: 600;
  }
  .item-odds__raw {
    display: block;
    margin-top: 0.2rem;
    font-size: 0.75rem;
    color: rgba(148, 163, 184, 0.65);
  }

  .craft-input {
    display: grid;
    gap: 0.45rem;
    flex: 1;
  }
  .craft-input label {
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(148, 163, 184, 0.75);
  }
  .craft-input input {
    width: 100%;
    padding: 0.65rem 0.9rem;
    border-radius: 14px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.85);
    color: rgba(226, 232, 240, 0.95);
    font-size: 1rem;
    box-sizing: border-box;
  }

  .simulate-btn {
    padding: 0.8rem 1.8rem;
    border-radius: 999px;
    border: none;
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.25), rgba(56, 189, 248, 0.35));
    color: rgba(248, 250, 252, 0.95);
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    white-space: nowrap;
  }
  .simulate-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 14px 32px rgba(56, 189, 248, 0.35);
  }

  .simulation-controls {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
    padding: 1.5rem;
    border-radius: 20px;
    background: rgba(139, 92, 246, 0.08);
    border: 1px solid rgba(192, 132, 252, 0.2);
    flex-wrap: wrap;
  }

  .results-card {
    border-radius: 24px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.7);
    padding: 1.8rem;
    display: grid;
    gap: 1.6rem;
    width: 100%;
    box-sizing: border-box;
  }
  .results-grid {
    display: grid;
    gap: 1.4rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
  .results-log ul {
    margin: 0.8rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
    list-style: none;
  }
  .results-log li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.6rem;
    color: rgba(226, 232, 240, 0.75);
    font-size: 0.92rem;
    word-break: break-word;
  }
  .results-log__index {
    color: rgba(148, 163, 184, 0.65);
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: 0;
    color: rgba(148, 163, 184, 0.7);
  }

  .recipes-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    align-items: start;
  }

  .recipe-groups {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  .recipes-group .recipe-selector {
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .recipes-group .recipe-selector button {
    padding: 0.5rem;
    border-radius: 10px;
    gap: 0.3rem;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
  }

  .recipes-group .recipe-selector button img {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
  }

  .recipes-group .recipe-selector__title {
    font-size: 0.75rem;
    line-height: 1.1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Compact grid for Transformatron and others */
  .recipe-selector.grid-3-4 {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.4rem;
  }

  .recipe-selector.grid-3-4 button {
    padding: 0.5rem;
    border-radius: 12px;
    gap: 0.3rem;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
  }

  .recipe-selector.grid-3-4 button img {
    width: 38px;
    height: 38px;
  }

  .recipe-selector.grid-3-4 .recipe-selector__title {
    font-size: 0.7rem;
    line-height: 1.1;
  }

  .group-title {
    margin: 0 0 0.5rem;
    font-size: 1.2rem;
    color: rgba(248, 250, 252, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 0.3rem;
  }

  .rewards-scroll {
    max-height: 400px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 0.5rem;
    margin-right: -0.5rem;
  }
  .rewards-scroll::-webkit-scrollbar {
    width: 8px;
  }
  .rewards-scroll::-webkit-scrollbar-track {
    background: rgba(15, 23, 42, 0.4);
    border-radius: 4px;
  }
  .rewards-scroll::-webkit-scrollbar-thumb {
    background: rgba(192, 132, 252, 0.3);
    border-radius: 4px;
  }

  /* --- МОБИЛЬНАЯ АДАПТАЦИЯ --- */
  @media (max-width: 1023px) {
    /* 1. Секции — плотнее */
    section + section { margin-top: 1.5rem; }

    /* 2. Hero — компактный */
    .craft-hero { margin-bottom: 1.2rem; }
    .craft-hero__card {
      padding: 1.5rem 1rem;
      border-radius: 20px;
    }
    .craft-hero__card h1 { font-size: 1.5rem; margin: 0.6rem 0 0.5rem; }
    .craft-hero__card p { font-size: 0.9rem; line-height: 1.5; }
    .hero-stats {
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin-top: 1.2rem;
    }
    dt { font-size: 0.7rem; }
    dd { font-size: 1.1rem; }

    /* 3. Incentive — компактный */
    .incentive-panel { width: 100%; }
    .incentive-card {
      padding: 1rem;
      border-radius: 20px;
    }
    .incentive-card__grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    .incentive-card__info h2 { font-size: 1.2rem; margin: 0.4rem 0; }
    .incentive-card__info p { font-size: 0.85rem; line-height: 1.5; }

    /* Intro (hero + бонус) — сворачиваемый блок, чтобы выбор станции (табы)
       был первым, что видно, а не после длинного описания. На десктопе этот
       медиа-запрос вообще не применяется - там всё всегда развёрнуто. */
    .craft-intro-toggle {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      width: 100%;
      padding: 0.8rem 1rem;
      margin-bottom: 1rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.6);
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    .craft-intro-toggle__title {
      flex: 1;
      font-size: 0.85rem;
      font-weight: 600;
      color: rgba(226, 232, 240, 0.85);
    }
    .craft-intro:not(.open) .craft-hero,
    .craft-intro:not(.open) .incentive-panel {
      display: none;
    }

    /* 4. Табы — 2x2 сетка, все станции видны без скролла */
    .facility-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 0;
      margin: 0 0 1rem;
      gap: 0.6rem;
    }
    .facility-tabs button {
      min-width: auto;
      padding: 0.65rem 0.7rem;
      border-radius: 14px;
      gap: 0.15rem;
    }
    .facility-tabs__name { font-size: 0.9rem; }
    .facility-tabs__tagline { font-size: 0.75rem; }

    /* 5. Основной layout — колонка */
    .facility { border-radius: 24px; }
    .facility__inner {
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    /* 6. Сайдбар → сворачиваемый блок */
    .facility__sidebar {
      border-right: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 0;
      gap: 0;
    }
    .facility__sidebar::after { opacity: 0.3; }
    .facility__sidebar .facility__header,
    .facility__sidebar .facility__featured,
    .facility__sidebar .facility__stats {
      display: none;
    }
    .facility__sidebar.open .facility__header,
    .facility__sidebar.open .facility__featured,
    .facility__sidebar.open .facility__stats {
      display: grid;
    }
    .facility__sidebar.open {
      padding: 0 1rem 1.2rem;
    }

    /* Toggle button */
    .sidebar-toggle {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      width: 100%;
      padding: 0.8rem 1rem;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
      border-radius: 0;
    }
    .sidebar-toggle h2 {
      margin: 0;
      font-size: 1.1rem;
      flex: 1;
    }
    .sidebar-toggle .badge { flex-shrink: 0; }
    .sidebar-toggle__chevron {
      flex-shrink: 0;
      transition: transform 0.25s ease;
      color: rgba(226, 232, 240, 0.6);
    }
    .sidebar-toggle__chevron.rotated { transform: rotate(180deg); }

    .facility__sidebar.open .sidebar-toggle {
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    /* Featured items — горизонтально в opened sidebar */
    .facility__sidebar.open .facility__featured {
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      padding-top: 1rem;
    }
    .facility__sidebar.open .featured-item {
      padding: 0.4rem 0.5rem;
      grid-template-columns: 32px 1fr;
      gap: 0.4rem;
      border-radius: 12px;
    }
    .facility__sidebar.open .featured-item img {
      width: 32px;
      height: 32px;
    }
    .facility__sidebar.open .featured-item__label {
      font-size: 0.75rem;
    }
    .facility__sidebar.open .facility__stats {
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
      padding-top: 0.75rem;
    }

    /* 7. Контент — плотнее */
    .facility__content {
      padding: 1rem;
      gap: 1rem;
    }

    /* 8. Сетка рецептов — 2 колонки, компактные кнопки */
    .recipe-selector {
      grid-template-columns: 1fr 1fr;
      gap: 0.4rem;
    }
    .recipe-selector button {
      padding: 0.45rem;
      border-radius: 12px;
      gap: 0.2rem;
    }
    .recipe-selector button img {
      width: 30px;
      height: 30px;
    }
    .recipe-selector__title {
      font-size: 0.65rem;
      line-height: 1.1;
    }

    /* Black hole recipes container — 1 колонка */
    .recipes-container {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    .recipes-group .recipe-selector {
      grid-template-columns: 1fr 1fr;
    }
    .recipes-group .recipe-selector button {
      padding: 0.35rem;
      border-radius: 8px;
      gap: 0.15rem;
    }
    .recipes-group .recipe-selector button img {
      width: 26px;
      height: 26px;
    }
    .recipes-group .recipe-selector__title {
      font-size: 0.6rem;
    }
    .group-title {
      font-size: 0.95rem;
      margin-bottom: 0.3rem;
    }

    /* Compact grid (transformatron etc) */
    .recipe-selector.grid-3-4 {
      grid-template-columns: 1fr 1fr;
      gap: 0.3rem;
    }
    .recipe-selector.grid-3-4 button {
      padding: 0.35rem;
      border-radius: 8px;
    }
    .recipe-selector.grid-3-4 button img {
      width: 26px;
      height: 26px;
    }
    .recipe-selector.grid-3-4 .recipe-selector__title {
      font-size: 0.6rem;
    }

    /* 9. Карточка рецепта — компактная */
    .recipe-card {
      padding: 1rem;
      border-radius: 18px;
      gap: 1rem;
    }
    .recipe-card__header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .recipe-card__meta {
      justify-content: flex-start;
    }
    .recipe-card__subtitle { font-size: 0.8rem; }
    .meta-pill { font-size: 0.75rem; padding: 0.3rem 0.6rem; }

    .recipe-card__body {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    .recipe-section h4 {
      font-size: 0.95rem;
      margin-bottom: 0.6rem;
    }

    /* 10. Списки ингредиентов/наград — компактные */
    .ingredient-list,
    .reward-list,
    .results-grid ul {
      gap: 0.4rem;
    }
    .ingredient-list li,
    .reward-list li,
    .results-grid li {
      grid-template-columns: 36px 1fr;
      gap: 0.5rem;
      padding: 0.5rem 0.6rem;
      border-radius: 12px;
    }
    .item-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
    }
    .item-icon img {
      width: 30px;
      height: 30px;
    }
    .item-title { font-size: 0.82rem; }
    .item-sub { font-size: 0.72rem; }

    .item-odds,
    .reward-list li .item-odds {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 0.35rem;
      margin-top: 0.15rem;
      text-align: left;
      font-size: 0.78rem;
    }
    .item-odds__raw { display: inline; margin: 0; }

    .rewards-scroll { max-height: 280px; }

    /* 11. Контролы симуляции — компактные */
    .simulation-controls {
      flex-direction: column;
      align-items: stretch;
      padding: 0.75rem;
      border-radius: 14px;
      gap: 0.5rem;
    }
    .craft-input label { font-size: 0.75rem; }
    .craft-input input {
      padding: 0.55rem 0.7rem;
      font-size: 0.9rem;
    }
    .simulate-btn {
      padding: 0.65rem 1.2rem;
      font-size: 0.9rem;
      width: 100%;
    }

    /* 12. Результаты — компактные */
    .results-card {
      padding: 1rem;
      border-radius: 16px;
      gap: 1rem;
    }
    .results-grid {
      grid-template-columns: 1fr;
      gap: 0.8rem;
    }
    .results-grid h5 { font-size: 0.9rem; }
    .results-log li { font-size: 0.8rem; }
  }

  /* Очень маленькие экраны */
  @media (max-width: 400px) {
    .craft-hero__card { padding: 1rem 0.75rem; }
    .craft-hero__card h1 { font-size: 1.3rem; }
    .hero-stats { grid-template-columns: 1fr; }
    .recipe-selector { grid-template-columns: 1fr 1fr; }
    .recipe-selector button img { width: 26px; height: 26px; }
    .recipe-selector__title { font-size: 0.6rem; }
    .facility__content { padding: 0.75rem; }
  }

  /* Desktop layout boundary fix (2K/QHD) */
  @media (min-width: 1440px) {
    .facility__inner {
      grid-template-columns: 340px 1fr;
    }
    .facility__sidebar {
      min-width: 0;
      overflow: visible;
    }
    .facility__header {
      min-width: 0;
    }
    .facility__header h2 {
      font-size: clamp(1.1rem, 2vw, 1.6rem);
    }
    .facility__header p {
      overflow-wrap: break-word;
      word-wrap: break-word;
      word-break: normal;
      hyphens: none;
    }
  }

  /* QHD upscaling */
  @media (min-width: 1921px) {
    .featured-item { grid-template-columns: 60px 1fr; }
    .featured-item img { width: 60px; height: 60px; }
    .item-icon { width: var(--orb-size-container); height: var(--orb-size-container); }
    .item-icon img { width: var(--orb-size-img); height: var(--orb-size-img); }
    .recipe-selector button img { width: 48px; height: 48px; }
    .recipe-selector.grid-3-4 button img { width: 48px; height: 48px; }
    .recipes-group .recipe-selector button img { width: 60px; height: 60px; }
  }
</style>
