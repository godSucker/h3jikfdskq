<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn'
  import { getGeneIcon } from '@/lib/mutant-icons'
  import tabsData from '@/data/guides/tabs.json'

  interface MutantLite { id: string; name: string; genes: string[]; icon: string; fullArt?: string }
  interface ResolvedItem { label: string; icon: string | null; mutant?: MutantLite }
  interface ZodiacEntry extends MutantLite {
    sign: string
    dateFrom: string
    dateTo: string
    iconNormal: string
    iconSilver: string
    priceNormal?: number
    priceSilver?: number
  }
  interface FarmerRow {
    ids: string[]
    mutants: MutantLite[]
    breedable: 'yes' | 'no'
    price: string
    rating: number
    verdict: string
    silverPerHour: number
    relative: number
  }
  interface SpeedOrbRow { base: number; l3: number; l3pct: number; l4: number; l4pct: number; l5: number; l5pct: number }
  interface FightFighter { id: string; name: string; icon: string; level: number; boss: boolean; stats: { hp: number; atk1: number; atk2: number; ability: number; speed: number; silver: number } }
  interface FightWave { number: number; fighters: FightFighter[] }
  interface DivisionFight { fightId: number; waves: FightWave[] }
  interface DivisionMap {
    mapId: string
    locationName: string
    lore: string
    reward: { label: string; icon: string | null; mutant?: MutantLite }
    fightCount: number
    levelRange: [number, number]
    enemies: MutantLite[]
    fights: DivisionFight[]
  }
  interface Division { id: string; name: string; recommendedLevel: number; maps: DivisionMap[] }
  interface DungeonEntry {
    id: string
    name: string
    nameAuthored: boolean
    mutant: MutantLite | null
    fightCount: number
    bossCount: number
    currency: ResolvedItem[]
    items: ResolvedItem[]
  }
  interface EventLadderEntry {
    id: string
    name: string
    nameAuthored: boolean
    mapCount: number
    mutant: MutantLite | null
    fightCount: number
    items: ResolvedItem[]
  }
  interface SpecialLadders { experiment: DungeonEntry[]; challenge: DungeonEntry[] }
  interface QuestReward { label: string; icon: string | null; mutant?: MutantLite }
  interface Quest { id: string; title: string; caption: string; rewards: QuestReward[] }
  interface OfferMutant { id: string; name: string; tier: string | null; skin: string | null; icon: string }
  interface OfferGroup { chance: number | null; mutants: OfferMutant[]; rewards: ResolvedItem[] }
  interface SpecialOffer {
    id: string
    name: string
    icon: string | null
    level: number
    cost: { amount: number; type: 'hardcurrency' | 'softcurrency' } | null
    realPriceUsd: number | null
    groups: OfferGroup[]
  }

  let {
    legendaries = [],
    zodiac = [],
    farmers = [],
    speedOrbs = [],
    divisions = [],
    quests = [],
    raids = [],
    eventLadders = [],
    specialLadders = { experiment: [], challenge: [] },
    specialOffers = [],
    dungeonCovers = {},
    divisionArenas = {},
  }: {
    legendaries: MutantLite[]
    zodiac: ZodiacEntry[]
    farmers: FarmerRow[]
    speedOrbs: SpeedOrbRow[]
    divisions: Division[]
    quests: Quest[]
    raids: DungeonEntry[]
    eventLadders: EventLadderEntry[]
    specialLadders: SpecialLadders
    specialOffers: SpecialOffer[]
    dungeonCovers: Record<string, string | null>
    divisionArenas: Record<string, string | null>
  } = $props()

  // Готовые баннеры/бейджи с Kobojo CDN (найдены 2026-08-07, см. память
  // auto-announcements-architecture) - хотлинк, не качаем на свой CDN, эти
  // картинки только фоны/бейджи карточек, не постоянный сайтовый актив.
  function divisionBadge(campaignId: string): string {
    return `https://s-beta.kobojo.com/mutants/assets/hud/fight_screen/division_${campaignId}.png`
  }

  let activeDivision = $state(0)
  let zodiacStar: 'normal' | 'silver' = $state('normal')
  let offersModalOffer: SpecialOffer | null = $state(null)
  let fightsModalMap: DivisionMap | null = $state(null)
  function openFights(m: DivisionMap) {
    fightsModalMap = m
  }
  function closeFights() {
    fightsModalMap = null
  }
  $effect(() => {
    if (!fightsModalMap && !offersModalOffer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      closeFights()
      offersModalOffer = null
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const FEATURED_LEGENDARY = 'specimen_cc_02' // Бак Морис

  // Вынесено в JSON (src/data/guides/tabs.json) - тот же список читает
  // scripts/build-search-index.ts для генерации ссылок сайтового поиска на
  // конкретные вкладки гайдов, один источник правды вместо двух копий списка.
  // 'pvp-seasons' временно скрыт из списка - обсуждается отдельно, вернуть
  // после решения, не удалять оттуда.
  const TABS = tabsData as { key: string; label: string; ready: boolean }[]

  const GENE_LABEL: Record<string, string> = {
    A: 'Киборг', B: 'Нежить', C: 'Рубака', D: 'Зверь', E: 'Галактик', F: 'Мифик',
  }
  // Таблица преимуществ типов (StrengthsAndWeaknesses::getDamageModifier) -
  // строка = атакующий, столбец = защищающийся, значение = модификатор урона в %.
  const TYPE_TABLE: Record<string, Record<string, number>> = {
    A: { A: 0, B: -25, C: 25, D: 50, E: -50, F: 0 },
    B: { A: 25, B: 0, C: -25, D: 0, E: 50, F: -50 },
    C: { A: -25, B: 25, C: 0, D: -50, E: 0, F: 50 },
    D: { A: -50, B: 0, C: 50, D: 0, E: -25, F: 25 },
    E: { A: 50, B: -50, C: 0, D: 25, E: 0, F: -25 },
    F: { A: 0, B: 50, C: -50, D: -25, E: 25, F: 0 },
  }
  const GENE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

  // Крит-шанс = 5% × (100 + бустеры + сферы) / 100. Бустер крита +50%,
  // антикрит противника -75% (см. секцию "Крит-шанс" на этой странице).
  const CRIT_SPHERE_PERCENTS = [2, 5, 11, 13, 15, 17, 18, 19]
  const CRIT_BASE = 5
  const CRIT_BOOST_NET = 50 - 75
  function critChance(bonus: number): number {
    return Math.round(CRIT_BASE * (100 + bonus) / 100 * 100) / 100
  }
  const CRIT_SPHERE_LEVELS = CRIT_SPHERE_PERCENTS.map((percent, level) => ({
    level,
    percent,
    icon: `/orbs/basic/orb_basic_critical${level === 0 ? '' : `_0${level}`}.webp`,
    oneSphere: critChance(percent),
    twoSpheres: critChance(percent * 2),
    twoSpheresBoosted: critChance(CRIT_BOOST_NET + percent * 2),
  }))

  // Хэш в URL (#raids и т.п.) открывает нужную вкладку сразу при заходе -
  // нужно для сайтового поиска (SearchBox.svelte ссылается на /guides#<key>).
  function initialTab(): string {
    if (typeof window === 'undefined') return 'legendaries'
    const key = window.location.hash.slice(1)
    return TABS.some((t) => t.key === key) ? key : 'legendaries'
  }
  let activeTab = $state(initialTab())

  // Клик по результату поиска на СТРАНИЦЕ /guides меняет только фрагмент
  // (#quests и т.п.) - это НЕ полная навигация, initialTab() выше запускается
  // один раз при маунте и не увидит смену хэша. Слушаем hashchange отдельно,
  // иначе клик из SearchBox.svelte молча не делает ничего, если пользователь
  // уже на /guides.
  $effect(() => {
    if (typeof window === 'undefined') return
    const onHashChange = () => {
      const key = window.location.hash.slice(1)
      if (TABS.some((t) => t.key === key)) activeTab = key
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  })

  function openMutant(specimenId: string) {
    window.dispatchEvent(new CustomEvent('archivist:open-mutant', { detail: { specimenId } }))
  }

  function breedableLabel(b: 'yes' | 'no'): string {
    return b === 'yes' ? 'Выводится' : 'Не выводится'
  }

  function fmtSilver(n: number): string {
    return n.toLocaleString('ru-RU')
  }

  function fmtSpeed(n: number): string {
    return n.toFixed(2).replace('.', ',')
  }

  function fmtPct(n: number): string {
    return n.toFixed(1).replace('.', ',')
  }

  let activeLadderSection = $state<'event' | 'experiment' | 'challenge'>('event')

  let offersByLevel = $derived.by(() => {
    const map = new Map<number, SpecialOffer[]>()
    for (const o of specialOffers) {
      if (!map.has(o.level)) map.set(o.level, [])
      map.get(o.level)!.push(o)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  })

  function fmtCost(o: SpecialOffer): string {
    if (o.cost) {
      const label = o.cost.type === 'hardcurrency' ? 'золота' : 'серебра'
      return `${o.cost.amount.toLocaleString('ru-RU')} ${label}`
    }
    if (o.realPriceUsd != null) return `$${o.realPriceUsd}`
    return '—'
  }

  let questSearch = $state('')
  let filteredQuests = $derived(
    questSearch.trim()
      ? quests.filter(
          (q) =>
            q.title.toLowerCase().includes(questSearch.trim().toLowerCase()) ||
            q.caption.toLowerCase().includes(questSearch.trim().toLowerCase()),
        )
      : quests,
  )
</script>

<div class="tab-bar" role="tablist">
  {#each TABS as t (t.key)}
    <button class="tab-btn" class:active={activeTab === t.key} class:soon={!t.ready} onclick={() => (activeTab = t.key)}>
      {t.label}{#if !t.ready}<span class="soon-badge">скоро</span>{/if}
    </button>
  {/each}
</div>

<div class="tab-content">
  {#snippet activityCard(
    id: string,
    dungeonType: 'raid' | 'experiment' | 'challenge' | 'event',
    name: string,
    nameAuthored: boolean,
    mutant: MutantLite | null,
    secondaryLine: string,
    currency: ResolvedItem[],
    items: ResolvedItem[],
  )}
    {@const fallbackIcon = items.find((it) => it.icon)?.icon ?? currency.find((c) => c.icon)?.icon ?? '/stars/star_gold.webp'}
    {@const cover = dungeonCovers[id]}
    <div class="activity-card" class:no-mutant={!mutant}>
      {#if mutant}
        <button
          class="activity-hero"
          style={cover ? `background-image: linear-gradient(180deg, rgba(10,14,22,0.15), rgba(10,14,22,0.75)), url(${cover})` : ''}
          onclick={() => openMutant(mutant.id)}
          title={`Открыть ${mutant.name}`}
        >
          <img class="activity-hero-art" src={textureUrl(mutant.fullArt)} alt={mutant.name} loading="lazy" decoding="async" />
        </button>
      {:else}
        <div
          class="activity-hero activity-hero-empty"
          style={cover ? `background-image: linear-gradient(180deg, rgba(10,14,22,0.15), rgba(10,14,22,0.75)), url(${cover})` : ''}
        >
          <img class="activity-hero-empty-art" src={textureUrl(fallbackIcon)} alt="" loading="lazy" decoding="async" />
        </div>
      {/if}
      <div class="activity-card-body">
        <div class:authored-name={nameAuthored} class="activity-name">{name}</div>
        {#if mutant}
          <button class="activity-mutant-name" onclick={() => openMutant(mutant.id)}>{mutant.name}</button>
        {:else}
          <div class="activity-mutant-name muted">без уникального мутанта</div>
        {/if}
        <div class="activity-secondary">{secondaryLine}</div>
        {#if currency.length}
          <div class="activity-currency">
            {#each currency as c, i (i)}
              <span class="reward-inline">
                {#if c.icon}<img src={textureUrl(c.icon)} alt="" loading="lazy" decoding="async" />{/if}
                {c.label}
              </span>
            {/each}
          </div>
        {/if}
        {#if items.length}
          <div class="activity-items">
            {#each items as it, i (i)}
              <span class="activity-item-chip" title={it.label}>
                {#if it.icon}<img src={textureUrl(it.icon)} alt="" loading="lazy" decoding="async" />{/if}
                <span>{it.label}</span>
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/snippet}
  {#if activeTab === 'legendaries'}
    <div class="text-block">
      <p>
        Эти мутанты могут получиться у вас в результате скрещивания вообще любых мутантов с подходящими генами
        (например, Воин + Воин = Бак Моррис). Чем выше уровень вашего центра разведений, тем выше шанс на выпадение
        легендарного мутанта со скрещивания.
      </p>
      <p>
        Среди этих мутантов стоит внимания в основном только <strong>Бак Моррис</strong>, его определённо стоит
        выводить. Но в случае нехватки сильных мутантов на старте, можно вывести Звёздного Десантника и Дезингера,
        либо же любого моногена из списка, ибо у них слегка завышены статы. Но в целом, чаще всего найдутся варианты
        получше даже среди секретных.
      </p>
    </div>
    <div class="mutant-grid">
      {#each legendaries as m (m.id)}
        <button class="mutant-card" class:featured={m.id === FEATURED_LEGENDARY} onclick={() => openMutant(m.id)}>
          <span class="mutant-card-genes">
            {#each (m.genes.length ? m.genes : ['neutro']) as g}
              {#if getGeneIcon(g)}<img src={textureUrl(getGeneIcon(g))} alt={g} loading="lazy" decoding="async" />{/if}
            {/each}
          </span>
          <span class="mutant-card-icon">
            {#if m.icon}<img src={textureUrl(m.icon)} alt="" loading="lazy" decoding="async" />{/if}
          </span>
          <span class="mutant-card-name">{m.name}</span>
        </button>
      {/each}
    </div>
  {:else if activeTab === 'zodiac'}
    <div class="text-block">
      <p>
        Все мутанты распределены относительно знаков зодиака и появляются в точно те же даты, что и их аналоги из
        реального мира. Брать их рекомендуем преимущественно ради коллекции и бинго.
      </p>
    </div>
    <div class="zodiac-star-switcher">
      <button class="division-btn" class:active={zodiacStar === 'normal'} onclick={() => (zodiacStar = 'normal')}>Обычная версия</button>
      <button class="division-btn" class:active={zodiacStar === 'silver'} onclick={() => (zodiacStar = 'silver')}>Серебряная версия</button>
    </div>
    <div class="zodiac-grid">
      {#each zodiac as z (z.id)}
        {@const icon = zodiacStar === 'silver' ? z.iconSilver : z.iconNormal}
        {@const price = zodiacStar === 'silver' ? z.priceSilver : z.priceNormal}
        <button class="zodiac-card" onclick={() => openMutant(z.id)}>
          <span class="zodiac-card-icon">
            {#if icon}<img src={textureUrl(icon)} alt="" loading="lazy" decoding="async" />{/if}
          </span>
          <span class="zodiac-card-body">
            <span class="zodiac-card-name">{z.name}</span>
            <span class="zodiac-card-sign">{z.sign}</span>
            <span class="zodiac-card-dates">{z.dateFrom} — {z.dateTo}</span>
            {#if price != null}
              <span class="zodiac-card-price">
                <img src={textureUrl('/cash/hardcurrency.webp')} alt="" loading="lazy" decoding="async" />
                {price.toLocaleString('ru-RU')}
              </span>
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {:else if activeTab === 'tandem'}
    <div class="text-block guide-prose">
      <h2>Как работает тандем?</h2>
      <p>
        В тандем становится последний помещённый в инкубатор мутант, прокаченный на максимум опыта. Иначе говоря,
        существует 2 приоритета, по которым мутант становится в тандем.
      </p>
      <ol>
        <li>
          <strong>Уровень мутанта</strong> — в тандеме всегда будет один из ваших мутантов с наивысшим уровнем Эво, а
          в случае максимального уровня нужно добирать полоску опыта до конца.
        </li>
        <li>
          <strong>Порядок выведения</strong> — если мутант А был помещён в инкубатор раньше мутанта Б, то на
          максимальном уровне обоих в тандем станет именно мутант Б.
        </li>
      </ol>
      <p>
        Причём дальнейший порядок прокачки мутантов никак на это не влияет. Даже если вы сразу заморозите мутанта А
        на 1 уровне и захотите его потом докачать и поставить в тандем, в случае прокачки мутанта Б на максимум,
        мутант А туда уже никак не станет. Тут поможет только прокачка Эво и оставление мутанта Б на уровне пониже.
        Но с такими заморочками лучше просто вывести в тандем нового мутанта.
      </p>
      <div class="note">
        Важно: тандем выбирать нельзя. Как и просто прокачать любого другого на максимум — только через помещение
        мутанта в инкубатор.
      </div>
    </div>
  {:else if activeTab === 'pvp-bug'}
    <div class="text-block guide-prose">
      <h2>Гайд на баг (или фичу) в PvP</h2>
      <p>
        Можете не переживать — бан за это точно не дают. Вы не используете никакой сторонний софт, а всего лишь
        небольшую игровую махинацию, которая существует уже много лет.
      </p>
      <h3>О самом баге</h3>
      <p>
        К самому концу сезона нужно набрать минимум 50 атак (столько требуется по условию попадания в 1%. Можно
        набрать и 30 для 3%, но скорее всего всё равно получится больше) и как можно лучше % в PvP — минимум 10–11%
        (на практике, возможно, и 11–15%, но есть сомнения). Вы должны запомнить, сколько % у вас было в конце
        сезона перед началом нового. Лучше всего проверять свой окончательный % утром перед стартом нового PvP или
        хотя бы ночью в последний день сезона, так как именно на этот показатель вам придётся ориентироваться.
      </p>
      <p>
        Допустим, вы набрали 10%. Как только начнётся новый сезон, вам просто нужно не заходить в PvP-режим (вообще
        не открывать сам раздел при выборе режима боя, то есть даже не собирать награду за прошлое PvP). Не заходить
        нужно столько дней (предположительно), сколько процентов вы набрали в прошлом PvP. Тогда вы получите все
        награды. Пример: у вас было 10%. После старта нового сезона не заходите в PvP 10 дней, после этого туда можно
        зайти и вам выдадут все награды, включая мутанта.
      </p>
      <h3>Как это работает?</h3>
      <p>
        Точный механизм неизвестен, но есть предположение, что со стартом нового PvP игроки, которые забирают
        награды за прошлый сезон, пропадают из рейтинга старого PvP, а люди, которые награды не забрали, — там
        остаются. Так и получается, что по чуть-чуть рейтинг опустевает: большинство игроков с верхушки топа забирает
        награды в первые дни, и люди с низов начинают в этом рейтинге подниматься и оказываться всё ближе к 1%.
        Поэтому точные цифры тут, увы, никак не выявить. Но примерная закономерность есть — каждый день с результата
        прошлого сезона у вас снимается по ≈1%, пока он не достигнет 1% — тогда вы сможете забрать награды.
      </p>
      <h3>Примерный процесс</h3>
      <ul>
        <li>Вы набрали 10% в прошлом сезоне.</li>
        <li>Начался новый сезон — ваш прошлый результат всё ещё учитывается как 10%.</li>
        <li>Уже где-то через пару часов достаточно людей с вершины топа начнёт PvP и заберёт награды за старый сезон — теперь результат учитывается уже как ≈9% (а то и меньше).</li>
        <li>Во вторник — ≈8%, в среду — ≈7%, и так далее.</li>
        <li>Наступает следующий вторник — ваш результат прошлого сезона теперь ≈1%, и вы можете зайти в режим и забрать награды.</li>
      </ul>
      <div class="note">
        Небольшая рекомендация — лучше подождать с запасом 1–2 дня, чтобы точно забрать награды. Если мутант вам не
        нужен, можно ждать до 3% — в этом случае можно сократить ожидание на пару дней. Также можно набирать не
        только 10%, но и 9%, 8% и даже меньше — баг всё равно будет работать, просто время ожидания сократится.
      </div>
      <p>Тут конечно могут быть неточности, но на данный момент игроки ориентируются на указанную выше схему.</p>
    </div>
  {:else if activeTab === 'farmers'}
    <div class="text-block">
      <p>
        Таблица мутантов с нестандартным доходом серебра. Большинство из них — ивентовые мутанты, которых можно
        назвать около мусором в плане фарма, но решили добавить сюда вообще всех.
      </p>
      <p>
        Из достойных новых мутантов можно отметить Даба и Загама, хоть второй и стоит слишком дорого. Оценки
        субъективные, но приближены к реальности — учитывались доход/час, возможность выведения (и комфорт
        выведения), возможность фарма вне люкс-зон и лёгкость получения.
      </p>
      <p>
        Мидасов, Охотников и ДАБов не обязательно выводить в звёзды для фарма — в любой звезде они принесут
        одинаковое количество серебра.
      </p>
    </div>
    <div class="farmers-grid">
      {#each farmers as row, i (i)}
        <div class="farmer-card">
          <div class="farmer-card-head">
            <div class="farmer-card-mutants">
              {#each row.mutants as m (m.id)}
                <button class="farmer-chip" onclick={() => openMutant(m.id)}>
                  {#if m.icon}<img src={textureUrl(m.icon)} alt="" loading="lazy" decoding="async" />{/if}
                  <span>{m.name}</span>
                </button>
              {/each}
            </div>
            <span class="farmer-rating" class:rating-high={row.rating >= 7} class:rating-mid={row.rating >= 4 && row.rating < 7} class:rating-low={row.rating < 4}>
              {row.rating}/10
            </span>
          </div>
          <div class="farmer-card-stats">
            <span class="farmer-stat"><strong>{fmtSilver(row.silverPerHour)}</strong> серебра/час</span>
            <span class="farmer-stat farmer-stat-muted">×{row.relative} к обычным</span>
            <span class="farmer-badge" class:breedable-yes={row.breedable === 'yes'} class:breedable-no={row.breedable === 'no'}>
              {breedableLabel(row.breedable)}
            </span>
          </div>
          <div class="farmer-card-price">{row.price}</div>
          <p class="farmer-card-verdict">{row.verdict}</p>
        </div>
      {/each}
    </div>
  {:else if activeTab === 'speed-orbs'}
    <div class="text-block">
      <p>
        Таблица точного прироста от сфер скорости 3–5 уровня. Когда даёшь мутанту ту или иную сферу скорости, %
        прироста не всегда соответствует указанным на самой сфере 15%, 18% и 20% — в скобках указан реальный прирост
        для каждой конкретной базовой скорости.
      </p>
      <p>
        Как можно заметить, почти везде прирост от сферы выше номинала, особенно на больших скоростях, где может
        набегать по 1–2 лишних процента. Похоже, что каждая прибавка со сферы прописывалась разработчиками вручную, а
        не считалась по единой формуле — скорость с той или иной сферой у части мутантов совпадает с чужой стоковой
        скоростью или скоростью с другим уровнем сферы.
      </p>
    </div>
    <div class="speed-table-wrap">
      <table class="speed-table">
        <thead>
          <tr>
            <th>Скорость</th>
            <th>Сфера 3 (+15%)</th>
            <th>Сфера 4 (+18%)</th>
            <th>Сфера 5 (+20%)</th>
          </tr>
        </thead>
        <tbody>
          {#each speedOrbs as row, i (i)}
            <tr>
              <td class="num base-speed">{fmtSpeed(row.base)}</td>
              <td class="num">{fmtSpeed(row.l3)} <span class="pct">(+{fmtPct(row.l3pct)}%)</span></td>
              <td class="num">{fmtSpeed(row.l4)} <span class="pct">(+{fmtPct(row.l4pct)}%)</span></td>
              <td class="num">{fmtSpeed(row.l5)} <span class="pct">(+{fmtPct(row.l5pct)}%)</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if activeTab === 'quests'}
    <div class="text-block">
      <p>
        Основные (не ивентовые) квесты игры с наградой — ачивки, сюжетные квесты и системные задания. Игра хранит
        5300+ миссий, но у большинства из них нет ни названия, ни отдельной награды — сюда попали только те, что
        реально выглядят как квест: название → условие → награда.
      </p>
    </div>
    <input class="quest-search" type="search" placeholder="Поиск по названию или условию…" bind:value={questSearch} />
    <div class="quest-list">
      {#each filteredQuests as q (q.id)}
        <div class="quest-row">
          <div class="quest-row-body">
            <div class="quest-row-title">{q.title}</div>
            <div class="quest-row-caption">{q.caption}</div>
          </div>
          <div class="quest-row-rewards">
            {#each q.rewards as r, i (i)}
              {#if r.mutant}
                <button class="farmer-chip" onclick={() => openMutant(r.mutant.id)}>
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
        </div>
      {/each}
      {#if !filteredQuests.length}
        <p class="soon-block">Ничего не найдено.</p>
      {/if}
    </div>
  {:else if activeTab === 'divisions'}
    <div class="text-block">
      <p>
        7 дивизионов кампании (Альфа → Гига), в каждом по 9 карт — одни и те же 9 локаций, но с растущим уровнем
        противников и наградами. Рекомендации по эво-уровню и составу команды — наша оценка, в игре таких подсказок нет.
      </p>
    </div>
    <div class="division-switcher">
      {#each divisions as d, i (d.id)}
        <button class="division-btn" class:active={activeDivision === i} onclick={() => (activeDivision = i)}>{d.name}</button>
      {/each}
    </div>
    {#if divisions[activeDivision]}
      <div class="division-rec">
        <img class="division-rec-badge" src={divisionBadge(divisions[activeDivision].id)} alt="" loading="lazy" decoding="async" />
        Рекомендуемый эво для прохождение: «{divisions[activeDivision].recommendedLevel}»
      </div>
      <div class="division-maps">
        {#each divisions[activeDivision].maps as m, i (m.mapId)}
          {@const arena = divisionArenas[m.mapId]}
          <div
            class="division-map-card"
            style={arena ? `background-image: linear-gradient(180deg, rgba(15,23,42,0.75), rgba(15,23,42,0.92)), url(${arena}); background-size: cover; background-position: center;` : ''}
          >
            <div class="division-map-head">
              <span class="division-map-num">Карта {i + 1}</span>
              <span class="division-map-title">{m.locationName}</span>
            </div>
            <div class="division-map-meta">
              <span>Боёв: <strong>{m.fightCount}</strong></span>
              <span>Уровни врагов: <strong>{m.levelRange[0]}–{m.levelRange[1]}</strong></span>
            </div>
            <div class="division-map-reward">
              <span class="division-map-reward-label">Награда за прохождение:</span>
              {#if m.reward.mutant}
                <button class="farmer-chip" onclick={() => openMutant(m.reward.mutant.id)}>
                  {#if m.reward.mutant.icon}<img src={textureUrl(m.reward.mutant.icon)} alt="" loading="lazy" decoding="async" />{/if}
                  <span>{m.reward.mutant.name}</span>
                </button>
              {:else}
                <span class="reward-inline">
                  {#if m.reward.icon}<img src={textureUrl(m.reward.icon)} alt="" loading="lazy" decoding="async" />{/if}
                  <strong>{m.reward.label}</strong>
                </span>
              {/if}
            </div>
            <button class="division-map-toggle" onclick={() => openFights(m)}>Посмотреть все бои</button>
          </div>
        {/each}
      </div>
    {/if}
  {:else if activeTab === 'ladders'}
    <div class="text-block">
      <p>Здесь представлены практически все когда-либо существовавшие «лесенки» в игре.</p>
    </div>
    <div class="division-switcher">
      <button class="division-btn" class:active={activeLadderSection === 'event'} onclick={() => (activeLadderSection = 'event')}>
        Ивенты ({eventLadders.length})
      </button>
      <button class="division-btn" class:active={activeLadderSection === 'experiment'} onclick={() => (activeLadderSection = 'experiment')}>
        Эксперименты ({specialLadders.experiment.length})
      </button>
      <button class="division-btn" class:active={activeLadderSection === 'challenge'} onclick={() => (activeLadderSection = 'challenge')}>
        Испытания ({specialLadders.challenge.length})
      </button>
    </div>
    {#if activeLadderSection === 'event'}
      <div class="activity-grid">
        {#each eventLadders as e (e.id)}
          {@render activityCard(e.id, 'event', e.name, e.nameAuthored, e.mutant, `${e.mapCount} этапов`, [], e.items)}
        {/each}
      </div>
    {:else}
      <div class="activity-grid">
        {#each specialLadders[activeLadderSection] as d (d.id)}
          {@render activityCard(d.id, activeLadderSection, d.name, d.nameAuthored, d.mutant, `${d.fightCount} этапов`, d.currency, d.items)}
        {/each}
      </div>
    {/if}
  {:else if activeTab === 'raids'}
    <div class="text-block">
      <p>
        Рейды — самые сложные «лесенки» в игре, но зато каждый даёт уникального мутанта (который неплохо
        играется). У части рейдов в игре нет отдельного текстового названия — такие названия придуманы нами по
        тематике арта и помечены курсивом.
      </p>
    </div>
    <div class="activity-grid">
      {#each raids as r (r.id)}
        {@render activityCard(r.id, 'raid', r.name, r.nameAuthored, r.mutant, `${r.fightCount} этапов`, r.currency, r.items)}
      {/each}
    </div>
  {:else if activeTab === 'special-offers'}
    <div class="text-block">
      <p>
        Разовые предложения, которые всплывают при достижении определённого уровня игрока (не путать с
        обычными боксами из магазина — эти привязаны именно к уровню и показываются один раз).
      </p>
    </div>
    {#each offersByLevel as [level, offers] (level)}
      <div class="offer-level">
        <div class="offer-level-title">Уровень {level}</div>
        <div class="offer-grid">
          {#each offers as o (o.id)}
            <button class="offer-card" onclick={() => (offersModalOffer = o)}>
              <div class="offer-card-head">
                {#if o.icon}<img class="offer-card-icon" src={textureUrl(o.icon)} alt="" loading="lazy" decoding="async" />{/if}
                <div class="offer-card-info">
                  <div class="offer-card-name">{o.name}</div>
                  <div class="offer-card-cost">{fmtCost(o)}</div>
                </div>
              </div>
              <div class="offer-card-outcomes-hint">Нажмите, чтобы открыть</div>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  {:else if activeTab === 'numbers'}
    <div class="text-block guide-prose numbers-tab">
      <div class="note">
        Раздел основан на реверс-инжиниринге игрового бинарника — не догадки и не подсчёты по наблюдениям.
      </div>

      <h2>Рост HP с уровнем мутанта</h2>
      <p>
        При повышении уровня мутант получает +10% HP от базового HP (HP мутанта на первом уровне).
      </p>
      <div class="formula-box">
        Итоговое HP = HP на первом уровне × (уровень / 10 + 0.9)
      </div>

      <h2>Рост урона с уровнем мутанта</h2>
      <p>
        Каждый уровень добавляет +10% от атаки мутанта на первом уровне (не от текущей атаки, а именно от
        «базового» значения).
      </p>
      <p>
        В файлах игры у каждого мутанта изначально прописаны два варианта базовых характеристик:
        <strong>atk1</strong> и <strong>atk2</strong> — стандартная база, <strong>atk1p</strong> и
        <strong>atk2p</strong> — усиленная база (начинает использоваться с 10 и 15 уровня соответственно).
      </p>
      <p>
        На 10 уровне игра не просто накидывает бонус к текущему урону — она полностью подменяет переменную
        в формуле расчёта: старая база atk1 заменяется на усиленную atk1p. После этого все накопленные
        бонусы за уровни пересчитываются так, будто мутант с самого 1-го уровня имел эту новую, более
        высокую атаку. Так же это работает и для второй атаки (atk2), но на 15 уровне.
      </p>
      <div class="formula-box">
        Итоговый урон (до 10/15 уровня) = урон на первом уровне × (уровень / 10 + 0.9)
      </div>
      <div class="formula-box">
        Итоговый урон (после 10/15 уровня) = усиленный урон на первом уровне × (уровень / 10 + 0.9)
      </div>
      <p>
        Пример: на 1 уровне (atk1) у мутанта 200 атаки — игра прибавляет по 10% (20 атаки) за уровень, на 9
        уровне атака становится 360. Без замены базы на 10 уровне атака стала бы 380, но вместо этого atk1
        (200) меняется на atk1p (300), и все накопленные бонусы (+90% за уровни) применяются уже к новой
        базе: 300 + 90% = <strong>570</strong>. Каждый следующий уровень прибавляет по 10% уже от atk1p
        (300).
      </p>

      <h2>Прибавка звёзд к характеристикам мутантов</h2>
      <p>
        При получении любой звезды характеристики (урон и HP) мутанта увеличиваются на то значение,
        которое звезда даёт: бронза ×1.1, серебро ×1.3, золото ×1.75, платина ×2.0.
      </p>

      <h2>Рост доходов серебра мутантов с уровнем</h2>
      <p>
        Базовый доход мутанта равен 42 единицам серебра в час (с/ч). На следующих уровнях базовое значение
        умножается на уровень мутанта. У некоторых мутантов базовое значение доходов отличается.
      </p>
      <div class="formula-box">
        Итоговый доход = 42 с/ч × уровень мутанта
      </div>

      <h2>Крит-шанс</h2>
      <p>
        Базовый шанс крита — <strong>5%</strong>.
      </p>
      <p>
        К нему добавляются все бонусы крит-шанса (бустеры + сферы), и вся сумма умножается на эти 5%,
        а не складывается напрямую:
      </p>
      <div class="formula-box crit-formula">
        шанс крита = 5% × (100 + бустеры<sub><img src={textureUrl('/boosters/charm_critical_7.webp')} alt="бустер крита" class="formula-icon" loading="lazy" decoding="async" /></sub> + бустеры<sub><img src={textureUrl('/boosters/charm_anticritical_7.webp')} alt="антикрит-бустер" class="formula-icon" loading="lazy" decoding="async" /></sub> + сферы<sub>крит</sub>) / 100
      </div>
      <p>
        Сферы крит шанса бустят именно <strong>шанс</strong> крита, а не урон от него — в ру локализации
        написано иначе, и это опечатка локализаторов.
      </p>
      <p class="crit-booster-line">
        Бустер крита даёт +50% получаемого шанса. Антикрит-бустер — −75% получаемого шанса.
      </p>
      <p class="formula-example">
        Пример (сфера +2%, ваш бустер крита<img src={textureUrl('/boosters/charm_critical_7.webp')} alt="бустер крита" class="formula-icon" loading="lazy" decoding="async" />, антикрит-бустер противника<img src={textureUrl('/boosters/charm_anticritical_7.webp')} alt="антикрит-бустер" class="formula-icon" loading="lazy" decoding="async" />):
        5% × (100 + 50 − 75 + 2) / 100 =
        <strong>3.85%</strong>.
      </p>

      <div class="type-table-wrap">
        <table class="type-table">
          <thead>
            <tr>
              <th class="corner">Ур. сферы</th>
              <th>Бонус от сферы крита</th>
              <th>Крит шанс с 1 сферой</th>
              <th>Крит шанс с 2 сферами</th>
              <th>Крит шанс с 2 сферами и бустерами</th>
            </tr>
          </thead>
          <tbody>
            {#each CRIT_SPHERE_LEVELS as row (row.level)}
              <tr>
                <th class="sphere-level-cell">
                  <img src={textureUrl(row.icon)} alt="" class="sphere-level-icon" loading="lazy" decoding="async" />
                  {row.level}
                </th>
                <td>+{row.percent}%</td>
                <td>{row.oneSphere}%</td>
                <td>{row.twoSpheres}%</td>
                <td>{row.twoSpheresBoosted}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <h2>Формула урона</h2>
      <p>
        Базовый урон и активный бафф/дебафф атаки считаются <strong>раздельными ветками</strong> — каждый
        проходит крит и модификатор типа сам по себе, а не «бафф плоско сверху готового числа»:
      </p>
      <div class="formula-box formula-steps">
        <div><span class="step-num">1</span> базовый урон → крит (если сработал, ×2) → тип (±25% / ±50% из таблицы ниже)</div>
        <div><span class="step-num">2</span> отдельно: база баффа → тот же крит → тот же тип → берётся % баффа от результата</div>
        <div><span class="step-num">3</span> итог = результат шага 1 + результат шага 2</div>
      </div>
      <p>
        Пример: атака 10 000, крит сработал (×2), тип +25%, бафф атаки +40%. Основная ветка: 10 000 →
        20 000 → 25 000. Ветка баффа: 10 000 → 20 000 → 25 000 → 40% = 10 000. Итог —
        <strong>35 000</strong>, а не 29 000 (плоское сложение 25000+40%) и не наивные 35000 по совпадению —
        механизм именно раздельный.
      </p>

      <h2>Таблица пониж/повыш урона</h2>
      <p>
        Таблица показывает, сколько процентов урона атакующий добавляет или теряет против типа
        защищающегося.
      </p>
      <div class="type-table-wrap">
        <table class="type-table">
          <thead>
            <tr>
              <th class="corner">атк ↓ / защ →</th>
              {#each GENE_LETTERS as g (g)}
                <th>{GENE_LABEL[g]}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each GENE_LETTERS as row (row)}
              <tr>
                <th>{GENE_LABEL[row]}</th>
                {#each GENE_LETTERS as col (col)}
                  {@const v = TYPE_TABLE[row][col]}
                  <td class:pos={v > 0} class:neg={v < 0} class:neutral={v === 0}>
                    {v > 0 ? `+${v}%` : v === 0 ? '—' : `${v}%`}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <h2>Скрытые лимиты чисел</h2>
      <p>
        Игра считает часть значений в 32-битных числах, и при определённых пределах это ломается.
      </p>
      <div class="numbers-grid">
        <div class="number-card bad">
          <div class="number-card-title">HP мутанта</div>
          <div class="number-card-value">≈21 474 836</div>
          <p>
            При базовом HP выше этого порога (без HP-сфер) значение переполняется и уходит в минус.
            HP-сферы опускают порог ещё ниже — чем больше % бонуса, тем раньше ловит баг.
          </p>
        </div>
        <div class="number-card bad">
          <div class="number-card-title">Скорость мутанта</div>
          <div class="number-card-value">&gt; 21 474 836</div>
          <p>Тот же класс бага, что и с HP. Порог тут не зависит от сфер скорости.</p>
        </div>
        <div class="number-card bad">
          <div class="number-card-title">Золото (баланс игрока)</div>
          <div class="number-card-value">2 147 483 647</div>
          <p>
            При переходе через это значение весь баланс золота <strong>обнуляется до 0</strong> (не уходит
            в минус — просто сгорает).
          </p>
        </div>
        <div class="number-card ok">
          <div class="number-card-title">Атака мутанта</div>
          <div class="number-card-value">≈214 748 364</div>
          <p>Это просто потолок значения — при его достижении атака перестаёт расти дальше, но не ломается и не уходит в минус.</p>
        </div>
        <div class="number-card ok">
          <div class="number-card-title">Серебро (баланс игрока)</div>
          <div class="number-card-value">9 223 372 036 854 775 807</div>
          <p>Считается в 64-битном числе — реалистично упереться в этот предел невозможно.</p>
        </div>
        <div class="number-card ok">
          <div class="number-card-title">Уровень эво / мутанта / игрока</div>
          <div class="number-card-value">без лимита</div>
          <p>Обычное сохранённое значение без вычислений на клиенте — переполняться нечему.</p>
        </div>
      </div>

      <h2>Как думают боты (PvE и защита в PvP)</h2>
      <p>
        У ПвЕ-противников и защиты в PvP <strong>один и тот же ИИ</strong> — отдельного «защитного»
        алгоритма не существует. У каждого бота есть скрытый параметр «сообразительности» (IQ), и на
        каждый ход это решается заново:
      </p>
      <div class="formula-box formula-steps">
        <div><span class="step-num">1</span> бросается случайное число от 0 до 99</div>
        <div><span class="step-num">2</span> число ≥ IQ — случайный ход: случайная атака по случайной живой цели, вообще без расчётов</div>
        <div><span class="step-num">3</span> число &lt; IQ — «умный» ход: бот честно симулирует урон для каждой пары атака×цель и берёт связку с лучшим итогом боя (если атака AOE — дальше цели не перебираются)</div>
      </div>
      <p>
        Важный нюанс: во время этого перебора крит математически невозможен — бот сравнивает варианты
        по гарантированному не-крит урону. Настоящий бросок крита происходит один раз, уже в момент
        реального удара уже выбранным ходом — тем же кодом, что обрабатывает ваш собственный тап по
        экрану.
      </p>
      <p>
        Значение IQ у боя в кампании не считается — это ручной хардкод разработчиков на каждый конкретный
        бой, растёт вместе с прогрессией мира:
      </p>
      <div class="type-table-wrap">
        <table class="type-table">
          <thead>
            <tr><th class="corner">мир</th><th>IQ ранних боёв главы</th></tr>
          </thead>
          <tbody>
            <tr><th>Detroit 01→03</th><td>5 → 40 → 45</td></tr>
            <tr><th>Mexico 01→03</th><td>45 → 50 → 50</td></tr>
            <tr><th>Tchernobyl 01→04</th><td>55 → 55 → 60 → 100</td></tr>
            <tr><th>New Delhi 01→03</th><td>60 → 60 → 65</td></tr>
            <tr><th>Shanghai 01→03</th><td>65 → 65/70 → 70</td></tr>
            <tr><th>Tokyo 01→03</th><td>75/80 → 80/85 → 90</td></tr>
            <tr><th>Atlantis / Paris / Cairo</th><td>100 (везде, без исключений)</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Внутри одной главы IQ у первых ~6 «сюжетных» боёв переменный (см. таблицу), а у всех остальных
        боёв этой же главы (повторное прохождение/фарм) — всегда 100.
      </p>

      <h2>Хил неиспользованного тандема</h2>
      <p>
        Тандем, который вы не задействовали в бою, всё равно лечит вашего мутанта — да, тандемы умеют
        хилить.
      </p>
      <div class="formula-box">
        хил = уровень славы тандема × 100 ÷ 3 &nbsp;(или, что то же самое, уровень славы ÷ 0,03)
      </div>
      <div class="numbers-grid">
        <div class="number-card ok">
          <div class="number-card-title">Слава 100</div>
          <div class="number-card-value">3 333 HP</div>
        </div>
        <div class="number-card ok">
          <div class="number-card-title">Слава 200</div>
          <div class="number-card-value">6 666 HP</div>
        </div>
        <div class="number-card ok">
          <div class="number-card-title">Слава 300</div>
          <div class="number-card-value">10 000 HP</div>
        </div>
        <div class="number-card ok">
          <div class="number-card-title">Слава 400</div>
          <div class="number-card-value">13 333 HP</div>
        </div>
      </div>
      <p>
        При поражении в PvP тандем не лечит — этот хил срабатывает только при победе.
      </p>

      <h2>Цена скипа противника в PvP</h2>
      <p>
        Скип оппонента в PvP-турнире стоит серебра, и цена зависит не от вашей славы, а от
        <strong>уровня оппонента</strong>, которого вы скипаете:
      </p>
      <div class="formula-box">
        цена скипа = уровень оппонента × 250
      </div>
      <p>
        250 серебра за уровень — константа из игровых настроек (<code>PvpTournamentSkipping</code>).
        Чем выше уровень показанного оппонента, тем дороже его пропустить.
      </p>
    </div>
  {:else}
    <div class="soon-block">
      <p>Этот раздел ещё в разработке — данные вытаскиваются из игры.</p>
    </div>
  {/if}
</div>

{#if fightsModalMap}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-start justify-center p-2 md:p-4 overflow-y-auto overscroll-contain"
    onclick={(e) => { if (e.target === e.currentTarget) closeFights() }}
  >
    <div class="fights-modal-panel w-full max-w-[880px] mt-10 md:mt-16 mb-6 rounded-xl bg-slate-950 ring-1 ring-white/10 shadow-2xl" role="dialog" aria-modal="true" aria-label={fightsModalMap.locationName}>
      <div class="fights-modal-head">
        <div class="fights-modal-head-body">
          <div class="fights-modal-title">{fightsModalMap.locationName}</div>
          {#if fightsModalMap.lore}<p class="fights-modal-lore">{fightsModalMap.lore}</p>{/if}
        </div>
        <button class="close-btn" onclick={closeFights} aria-label="Закрыть">&times;</button>
      </div>
      <div class="fights-modal-body">
        {#each fightsModalMap.fights as fight, i (fight.fightId)}
          <div class="fight-row">
            <div class="fight-row-num">Бой {i + 1}</div>
            <div class="fight-row-waves">
              {#each fight.waves as wave (wave.number)}
                <div class="fight-wave">
                  {#if fight.waves.length > 1}<span class="fight-wave-label">Волна {wave.number}</span>{/if}
                  <div class="fight-wave-fighters">
                    {#each wave.fighters as f, j (j)}
                      <button class="fighter-card" class:boss={f.boss} onclick={() => openMutant(f.id)}>
                        {#if f.icon}<img src={textureUrl(f.icon)} alt="" loading="lazy" decoding="async" />{/if}
                        <div class="fighter-card-body">
                          <span class="fighter-card-name">{f.name}{#if f.boss} <span class="fighter-boss-badge">БОСС</span>{/if}</span>
                          <span class="fighter-card-level">Ур. {f.level}</span>
                          <div class="fighter-card-stats">
                            <span class="stat-chip stat-hp">HP {f.stats.hp.toLocaleString('ru-RU')}</span>
                            <span class="stat-chip stat-atk">АТК1 {f.stats.atk1.toLocaleString('ru-RU')}</span>
                            <span class="stat-chip stat-atk">АТК2 {f.stats.atk2.toLocaleString('ru-RU')}</span>
                            <span class="stat-chip stat-speed">СКР {f.stats.speed}</span>
                          </div>
                        </div>
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if offersModalOffer}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-start justify-center p-2 md:p-4 overflow-y-auto overscroll-contain"
    onclick={(e) => { if (e.target === e.currentTarget) offersModalOffer = null }}
  >
    <div class="fights-modal-panel w-full max-w-2xl mt-10 md:mt-16 mb-6 rounded-xl bg-slate-950 ring-1 ring-white/10 shadow-2xl" role="dialog" aria-modal="true" aria-label={offersModalOffer.name}>
      <div class="fights-modal-head">
        {#if offersModalOffer.icon}<img class="offer-modal-icon" src={textureUrl(offersModalOffer.icon)} alt="" loading="lazy" decoding="async" />{/if}
        <div class="fights-modal-head-body">
          <div class="fights-modal-title">{offersModalOffer.name}</div>
          <p class="fights-modal-lore">{fmtCost(offersModalOffer)} · уровень {offersModalOffer.level}</p>
        </div>
        <button class="close-btn" onclick={() => (offersModalOffer = null)} aria-label="Закрыть">&times;</button>
      </div>
      <div class="fights-modal-body">
        {#each offersModalOffer.groups as g, i (i)}
          <div class="offer-outcome">
            {#each g.mutants as m (m.id)}
              <button class="farmer-chip" onclick={() => openMutant(m.id)}>
                {#if m.icon}<img src={textureUrl(m.icon)} alt="" loading="lazy" decoding="async" />{/if}
                <span>{m.name}{#if m.tier} ({m.tier}){/if}{#if m.skin} («{m.skin}»){/if}</span>
              </button>
            {/each}
            {#each g.rewards as r, j (j)}
              <span class="reward-inline">
                {#if r.icon}<img src={textureUrl(r.icon)} alt="" loading="lazy" decoding="async" />{/if}
                {r.label}
              </span>
            {/each}
            <span class="offer-outcome-chance">{g.chance != null ? `${g.chance.toFixed(1)}%` : 'гарантировано'}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .tab-bar { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 1.1rem; }
  .tab-btn {
    appearance: none; border: 1px solid rgba(48, 54, 61, 0.6); background: rgba(22, 27, 34, 0.9);
    color: #94a3b8; border-radius: 8px; padding: 0.45rem 0.85rem; font-size: 0.82rem; font-weight: 600; cursor: pointer;
    display: inline-flex; align-items: center; gap: 0.35rem;
  }
  .tab-btn:hover { background: rgba(30, 58, 138, 0.2); color: #fff; }
  .tab-btn.active { background: rgba(30, 58, 138, 0.4); color: #60a5fa; border-color: rgba(96,165,250,0.4); }
  .tab-btn.soon { opacity: 0.7; }
  .soon-badge { font-size: 9px; text-transform: uppercase; background: rgba(148,163,184,0.2); color: #94a3b8; border-radius: 4px; padding: 1px 4px; }

  .text-block { color: #cbd5f5; font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.25rem; max-width: 900px; }
  .text-block p { margin: 0 0 0.75rem; }
  .text-block strong { color: #e2e8f0; }
  .text-block.guide-prose {
    background: rgba(13, 17, 23, 0.72); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;
    padding: 1.1rem 1.3rem; max-width: 100%;
  }
  .guide-prose h2 { font-size: 1.15rem; color: #e2e8f0; margin: 0 0 0.6rem; }
  .guide-prose h3 { font-size: 1rem; color: #e2e8f0; margin: 1.1rem 0 0.5rem; }
  .guide-prose ol, .guide-prose ul { margin: 0 0 0.75rem; padding-left: 1.3rem; }
  .guide-prose li { margin-bottom: 0.4rem; }
  .guide-prose code {
    background: rgba(96,165,250,0.1); color: #a5f3fc; border-radius: 4px; padding: 0.1rem 0.35rem;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.85em;
  }
  .note { background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.25); border-radius: 8px; padding: 0.75rem 1rem; margin: 0.75rem 0; font-size: 0.87rem; color: #bfdbfe; }

  .numbers-tab .crit-booster-line {
    font-size: 0.9rem; color: #e2e8f0;
  }
  .numbers-tab .formula-icon {
    display: inline-block;
    width: 1.5em; height: 1.5em; object-fit: contain; vertical-align: middle;
    border-radius: 0.2rem; background: rgba(255,255,255,0.06);
  }
  .numbers-tab .formula-example {
    font-size: 0.85rem; color: #94a3b8; margin: 0.4rem 0 1rem;
  }
  .numbers-tab .formula-example .formula-icon {
    width: 1.3rem; height: 1.3rem; margin-left: 0.25rem;
  }
  .numbers-tab .formula-box {
    background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(96,165,250,0.2); border-radius: 8px;
    padding: 0.85rem 1rem; margin: 0.6rem 0 0.9rem; font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.85rem; color: #a5f3fc; line-height: 1.6; overflow-x: auto;
  }
  .numbers-tab .formula-box.crit-formula { white-space: nowrap; }
  .numbers-tab .formula-steps { display: flex; flex-direction: column; gap: 0.5rem; color: #e2e8f0; font-family: inherit; }
  .numbers-tab .formula-steps > div { display: flex; align-items: baseline; gap: 0.6rem; }
  .numbers-tab .step-num {
    flex-shrink: 0; width: 1.4rem; height: 1.4rem; border-radius: 50%; background: rgba(96,165,250,0.18);
    color: #93c5fd; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; justify-content: center;
  }
  .type-table-wrap { overflow-x: auto; margin: 0 0 1.25rem; }
  .type-table { border-collapse: collapse; width: 100%; min-width: 480px; font-size: 0.82rem; }
  .type-table th, .type-table td { padding: 0.45rem 0.6rem; text-align: center; border: 1px solid rgba(255,255,255,0.07); }
  .type-table thead th { color: #93c5fd; font-weight: 600; background: rgba(96,165,250,0.06); }
  .type-table tbody th { color: #e2e8f0; font-weight: 600; text-align: left; background: rgba(96,165,250,0.06); }
  .type-table td.pos { color: #86efac; font-weight: 600; }
  .type-table td.neg { color: #fca5a5; font-weight: 600; }
  .type-table td.neutral { color: #64748b; }
  .type-table th.corner { color: #64748b; font-weight: 500; font-size: 0.75rem; }
  .type-table th.sphere-level-cell { display: flex; align-items: center; justify-content: flex-start; gap: 0.4rem; }
  .sphere-level-icon {
    width: 1.5em; height: 1.5em; object-fit: contain; vertical-align: middle;
    border-radius: 0.2rem; background: rgba(255,255,255,0.06); flex-shrink: 0;
  }

  .numbers-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(13.75rem, 1fr)); gap: 0.85rem; margin: 0 0 1.25rem; }
  .number-card { border-radius: 10px; padding: 0.9rem 1rem; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.07); }
  .number-card.bad { border-color: rgba(248,113,113,0.3); }
  .number-card.ok { border-color: rgba(34,197,94,0.3); }
  .number-card-title { font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.3rem; }
  .number-card-value { font-size: 1.15rem; font-weight: 800; margin-bottom: 0.4rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .number-card.bad .number-card-value { color: #fca5a5; }
  .number-card.ok .number-card-value { color: #86efac; }
  .number-card p { margin: 0; font-size: 0.82rem; color: #94a3b8; line-height: 1.5; }

  .mutant-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.7rem; }
  .mutant-card { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; padding: 0.6rem 0.4rem; border-radius: 10px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.06); cursor: pointer; text-align: center; }
  .mutant-card:hover { background: rgba(30, 41, 59, 0.85); border-color: rgba(96,165,250,0.3); }
  .mutant-card.featured { border-color: rgba(250,204,21,0.6); box-shadow: 0 0 12px rgba(250,204,21,0.25); }
  .mutant-card-genes { display: flex; gap: 3px; }
  .mutant-card-genes img { width: 16px; height: 16px; }
  .mutant-card-icon { width: 52px; height: 52px; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.25); }
  .mutant-card-icon img { width: 100%; height: 100%; object-fit: cover; }
  .mutant-card-name { font-size: 11.5px; font-weight: 600; color: #e2e8f0; line-height: 1.2; }

  .zodiac-star-switcher { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .zodiac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.65rem; }
  .zodiac-card { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.7rem; border-radius: 10px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.06); cursor: pointer; text-align: left; }
  .zodiac-card:hover { background: rgba(30, 41, 59, 0.85); border-color: rgba(96,165,250,0.3); }
  .zodiac-card-icon { width: 44px; height: 44px; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.25); }
  .zodiac-card-icon img { width: 100%; height: 100%; object-fit: cover; }
  .zodiac-card-body { display: flex; flex-direction: column; }
  .zodiac-card-name { font-size: 12.5px; font-weight: 700; color: #e2e8f0; }
  .zodiac-card-sign { font-size: 11px; color: #60a5fa; }
  .zodiac-card-dates { font-size: 10.5px; color: #94a3b8; }
  .zodiac-card-price { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 11px; font-weight: 700; color: #fbbf24; margin-top: 0.15rem; }
  .zodiac-card-price img { width: 14px; height: 14px; object-fit: contain; }

  .farmer-chip { display: inline-flex; align-items: center; gap: 0.35rem; background: transparent; border: none; color: #e2e8f0; font-size: 0.78rem; font-weight: 600; cursor: pointer; padding: 1px 0; text-align: left; }
  .farmer-chip:hover { color: #60a5fa; }
  .farmer-chip img { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .breedable-yes { color: #86efac; font-weight: 600; white-space: nowrap; }
  .breedable-no { color: #fca5a5; font-weight: 600; white-space: nowrap; }

  .farmers-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.8rem; }
  .farmer-card { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.55rem; }
  .farmer-card:hover { border-color: rgba(96,165,250,0.25); }
  .farmer-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
  .farmer-card-mutants { display: flex; flex-direction: column; gap: 3px; }
  .farmer-rating { flex-shrink: 0; font-size: 0.78rem; font-weight: 800; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
  .farmer-rating.rating-high { background: rgba(34,197,94,0.15); color: #86efac; }
  .farmer-rating.rating-mid { background: rgba(250,204,21,0.15); color: #fde68a; }
  .farmer-rating.rating-low { background: rgba(239,68,68,0.15); color: #fca5a5; }
  .farmer-card-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.8rem; font-size: 0.78rem; color: #94a3b8; }
  .farmer-stat strong { color: #e2e8f0; }
  .farmer-stat-muted { color: #64748b; }
  .farmer-badge { font-size: 0.72rem; font-weight: 700; border-radius: 5px; padding: 1px 7px; }
  .farmer-badge.breedable-yes { background: rgba(34,197,94,0.12); }
  .farmer-badge.breedable-no { background: rgba(239,68,68,0.12); }
  .farmer-card-price { font-size: 0.76rem; color: #94a3b8; }
  .farmer-card-verdict { margin: 0; font-size: 0.8rem; line-height: 1.5; color: #cbd5f5; }
  .authored-name { font-style: italic; }
  .quest-search {
    display: block; width: 100%; max-width: 360px; margin-bottom: 0.75rem; padding: 0.45rem 0.7rem;
    background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
    color: #e2e8f0; font-size: 0.85rem;
  }
  .quest-search:focus { outline: none; border-color: rgba(96,165,250,0.4); }

  .quest-list { display: flex; flex-direction: column; gap: 3px; border-radius: 10px; overflow: hidden; }
  .quest-row {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6rem 1rem;
    padding: 0.55rem 0.85rem; background: rgba(15, 23, 42, 0.55); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px;
  }
  .quest-row:hover { background: rgba(30, 41, 59, 0.75); border-color: rgba(96,165,250,0.25); }
  .quest-row-body { flex: 1 1 260px; min-width: 0; }
  .quest-row-title { font-size: 0.85rem; font-weight: 700; color: #e2e8f0; }
  .quest-row-caption { font-size: 0.78rem; color: #94a3b8; margin-top: 2px; line-height: 1.4; }
  .quest-row-rewards { display: flex; flex-wrap: wrap; gap: 5px 10px; justify-content: flex-end; flex: 0 1 auto; }
  .quest-row-rewards .reward-inline { font-size: 0.78rem; color: #86efac; }

  .speed-table-wrap { overflow-x: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; max-height: 640px; overflow-y: auto; }
  .speed-table { border-collapse: collapse; width: 100%; font-size: 0.8rem; min-width: 560px; }
  .speed-table th { position: sticky; top: 0; background: #161b22; color: #94a3b8; text-align: right; padding: 0.4rem 0.6rem; font-weight: 700; white-space: nowrap; border-bottom: 1px solid rgba(255,255,255,0.12); }
  .speed-table th:first-child { text-align: left; }
  .speed-table td { padding: 0.32rem 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.04); color: #cbd5f5; }
  .speed-table tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
  .speed-table tbody tr:hover { background: rgba(96,165,250,0.08); }
  .speed-table .base-speed { font-weight: 700; color: #e2e8f0; text-align: left; }
  .speed-table .pct { color: #64748b; font-size: 0.72rem; }

  .division-switcher { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .division-btn { appearance: none; border: 1px solid rgba(48, 54, 61, 0.6); background: rgba(15, 23, 42, 0.6); color: #94a3b8; border-radius: 8px; padding: 0.4rem 0.8rem; font-size: 0.82rem; font-weight: 700; cursor: pointer; }
  .division-btn:hover { color: #e2e8f0; border-color: rgba(96,165,250,0.3); }
  .division-btn.active { background: rgba(30, 58, 138, 0.4); color: #60a5fa; border-color: rgba(96,165,250,0.4); }
  .division-rec { background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.25); border-radius: 8px; padding: 0.65rem 0.9rem; margin-bottom: 1rem; font-size: 0.85rem; font-weight: 700; color: #bfdbfe; display: flex; align-items: center; gap: 0.5rem; }
  .division-rec-badge { width: 40px; height: 40px; object-fit: contain; flex-shrink: 0; }
  .division-maps { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; }
  .division-map-card { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem 0.85rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .division-map-head { display: flex; align-items: baseline; gap: 0.5rem; }
  .division-map-num { font-size: 10.5px; text-transform: uppercase; color: #94a3b8; font-weight: 700; }
  .division-map-title { font-size: 0.92rem; font-weight: 800; color: #e2e8f0; }
  .division-map-meta { display: flex; gap: 0.9rem; font-size: 0.76rem; color: #94a3b8; }
  .division-map-meta strong { color: #cbd5f5; }
  .division-map-reward { font-size: 0.78rem; color: #94a3b8; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .division-map-reward strong { color: #86efac; }
  .division-map-reward-label { color: #94a3b8; }
  .division-map-toggle {
    appearance: none; align-self: flex-start; border: 1px solid rgba(96,165,250,0.25); background: rgba(30, 58, 138, 0.15);
    color: #60a5fa; border-radius: 6px; padding: 0.3rem 0.65rem; font-size: 0.74rem; font-weight: 700; cursor: pointer;
  }
  .division-map-toggle:hover { background: rgba(30, 58, 138, 0.3); }
  .reward-inline { display: inline-flex; align-items: center; gap: 5px; }
  .reward-inline img { width: 18px; height: 18px; object-fit: contain; }

  .fights-modal-panel { max-height: calc(100vh - 5rem); display: flex; flex-direction: column; }
  .fights-modal-head { display: flex; align-items: flex-start; gap: 0.75rem; padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .fights-modal-head-body { flex: 1; min-width: 0; }
  .fights-modal-title { font-size: 1.05rem; font-weight: 800; color: #fff; }
  .fights-modal-lore { margin: 0.3rem 0 0; font-size: 0.78rem; color: #94a3b8; line-height: 1.45; }
  .close-btn { appearance: none; background: transparent; border: none; color: #94a3b8; font-size: 1.4rem; line-height: 1; cursor: pointer; padding: 0.2rem 0.4rem; flex-shrink: 0; }
  .close-btn:hover { color: #fff; }
  .fights-modal-body { overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.9rem; }
  .fight-row { display: flex; flex-direction: column; gap: 0.4rem; }
  .fight-row-num { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .fight-row-waves { display: flex; flex-direction: column; gap: 0.5rem; }
  .fight-wave { display: flex; flex-direction: column; gap: 0.3rem; }
  .fight-wave-label { font-size: 10.5px; color: #f87171; font-weight: 700; text-transform: uppercase; }
  .fight-wave-fighters { display: flex; flex-wrap: wrap; gap: 0.6rem; }
  .fighter-card {
    display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem 0.65rem; border-radius: 8px;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; text-align: left;
    flex: 1 1 220px; max-width: calc(33.333% - 0.4rem); min-width: 170px;
  }
  .fighter-card:hover { background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.4); }
  .fighter-card.boss { border-color: rgba(248,113,113,0.5); background: rgba(248,113,113,0.07); }
  .fighter-card img { width: 34px; height: 34px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
  .fighter-card-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .fighter-card-name { font-size: 12px; font-weight: 700; color: #e2e8f0; }
  .fighter-boss-badge { color: #f87171; font-size: 10px; margin-left: 0.4rem; }
  .fighter-card-level { font-size: 10.5px; color: #94a3b8; }
  .fighter-card-stats { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
  .stat-chip { font-size: 9.5px; font-weight: 700; padding: 1.5px 5px; border-radius: 4px; white-space: nowrap; }
  .stat-hp { color: #86efac; background: rgba(134,239,172,0.12); }
  .stat-atk { color: #fb923c; background: rgba(251,146,60,0.12); }
  .stat-speed { color: #60a5fa; background: rgba(96,165,250,0.12); }

  @media (max-width: 640px) {
    .fighter-card { max-width: 100%; }
  }

  .activity-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.9rem; }
  .activity-card {
    display: flex; flex-direction: column; border-radius: 14px; overflow: hidden;
    background: linear-gradient(180deg, rgba(30,41,59,0.4) 0%, rgba(10,14,22,0.9) 70%);
    border: 1px solid rgba(255,255,255,0.07);
  }
  .activity-card:hover { border-color: rgba(96,165,250,0.35); }
  .activity-hero {
    appearance: none; border: none; padding: 0; cursor: pointer; display: block;
    position: relative; height: 148px; background: radial-gradient(circle at 50% 30%, rgba(96,165,250,0.16), transparent 70%);
    background-size: cover; background-position: center;
    overflow: hidden;
  }
  .activity-hero-art { width: 100%; height: 100%; object-fit: contain; object-position: center bottom; filter: drop-shadow(0 6px 10px rgba(0,0,0,0.5)); }
  .activity-hero-empty { display: flex; align-items: center; justify-content: center; background: rgba(15,23,42,0.5); cursor: default; }
  .activity-hero-empty-art { width: 55%; height: 55%; object-fit: contain; opacity: 0.55; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); }
  .no-mutant .activity-hero { background: rgba(15,23,42,0.35); }
  .activity-card-body { padding: 0.6rem 0.75rem 0.75rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .activity-name { font-size: 0.8rem; font-weight: 700; color: #94a3b8; }
  .activity-mutant-name { appearance: none; background: none; border: none; padding: 0; text-align: left; font-size: 0.94rem; font-weight: 800; color: #e2e8f0; cursor: pointer; }
  .activity-mutant-name:hover { color: #60a5fa; }
  .activity-mutant-name.muted { color: #64748b; font-weight: 600; font-size: 0.82rem; cursor: default; }
  .activity-secondary { font-size: 0.72rem; color: #64748b; }
  .activity-currency { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 0.1rem; }
  .activity-currency .reward-inline { font-size: 0.72rem; color: #86efac; }
  .activity-currency .reward-inline img { width: 14px; height: 14px; }
  .activity-items { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 0.3rem; align-content: flex-start; }
  .activity-item-chip {
    display: inline-flex; align-items: center; gap: 4px; background: rgba(15,23,42,0.7);
    border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 2px 6px 2px 3px;
    font-size: 0.68rem; color: #94a3b8; max-width: 100%;
  }
  .activity-item-chip img { width: 16px; height: 16px; object-fit: contain; flex-shrink: 0; }
  .activity-item-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .soon-block { color: #64748b; padding: 2rem 0; text-align: center; font-size: 0.9rem; }

  .offer-level { margin-bottom: 1.25rem; }
  .offer-level-title {
    font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
    color: #93c5fd; margin-bottom: 0.5rem; padding-bottom: 0.3rem;
    border-bottom: 1px solid rgba(96,165,250,0.2);
  }
  .offer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.75rem; }
  .offer-card {
    appearance: none; width: 100%; background: rgba(15,23,42,0.7); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px;
    padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; cursor: pointer; text-align: left;
  }
  .offer-card:hover { background: rgba(30, 58, 138, 0.15); border-color: rgba(96,165,250,0.3); }
  .offer-card-head { display: flex; align-items: center; gap: 0.6rem; }
  .offer-card-icon { width: 56px; height: 56px; object-fit: contain; border-radius: 8px; background: rgba(0,0,0,0.25); flex-shrink: 0; }
  .offer-card-info { min-width: 0; }
  .offer-card-name { font-size: 0.85rem; font-weight: 700; color: #e2e8f0; line-height: 1.2; }
  .offer-card-cost { font-size: 0.75rem; color: #fbbf24; font-weight: 600; margin-top: 2px; }
  .offer-card-outcomes-hint { font-size: 0.7rem; color: #60a5fa; }
  .offer-outcome {
    display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem;
    background: rgba(255,255,255,0.03); border-radius: 8px; padding: 0.3rem 0.5rem;
  }
  .offer-outcome-chance { margin-left: auto; font-size: 0.7rem; font-weight: 700; color: #86efac; white-space: nowrap; }
  .offer-modal-icon { width: 56px; height: 56px; object-fit: contain; border-radius: 8px; background: rgba(0,0,0,0.25); flex-shrink: 0; }

  @media (max-width: 767px) {
    .mutant-grid { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); }
    .zodiac-grid { grid-template-columns: 1fr; }
    .speed-table { min-width: 0; font-size: 0.68rem; }
    .speed-table th, .speed-table td { padding: 0.28rem 0.3rem; }
    .speed-table .pct { display: block; font-size: 0.62rem; }
  }
</style>
