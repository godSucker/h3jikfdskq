<script lang="ts">
  // Сайтовый поиск (Fuse.js). Держим бандл этого острова минимальным - сам
  // компонент не тянет ни fuse.js, ни индекс: оба грузятся динамическим
  // import()/fetch() только при первом фокусе/вводе в поле, а не при заходе
  // на страницу (BaseLayout.astro рендерится на КАЖДОЙ странице сайта, тянуть
  // сюда fuse.js + JSON индекс на клиенте по умолчанию значило бы раздувать
  // JS каждой страницы ради опциональной фичи, которой пользуется меньшинство).
  // Индекс генерируется build-time скриптом scripts/build-search-index.ts в
  // public/search-index.json (см. "prebuild" в package.json).
  interface SearchEntry {
    title: string
    category: string
    href: string
    keywords?: string[]
  }

  // header в BaseLayout.astro использует backdrop-filter: blur(...) - это
  // создаёт containing block для потомков с position:fixed (стандартное
  // поведение CSS), из-за чего мобильный оверлей вместо всего вьюпорта
  // растягивался только на высоту самого header (~56px). Портал переносит
  // DOM-узел оверлея прямо в <body>, минуя этот containing block.
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() {
        node.remove()
      },
    }
  }

  const MAX_PER_CATEGORY = 6
  const MAX_TOTAL = 30
  // Fuse у мульти-ключевого (title+keywords) поиска умеет возвращать
  // итоговый score ВЫШЕ настроенного threshold - веса при склейке нескольких
  // ключей не переприменяют порог (баг/особенность поведения, проверено
  // руками: "Робот" находил "Создатели" c score 0.71 при threshold 0.34).
  // threshold в опциях Fuse ниже режет явный мусор пораньше (быстрее), этот
  // порог - страховка после склейки весов.
  const SCORE_CUTOFF = 0.4

  let query = $state('')
  let open = $state(false)
  let mobileOpen = $state(false)
  let loading = $state(false)
  let loadFailed = $state(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- тип живёт в fuse.js, динамически импортируемом ниже
  let fuse: any = null
  let flatResults: SearchEntry[] = $state([])
  let activeIndex = $state(-1)

  let rootEl: HTMLDivElement
  let mobileOverlayEl: HTMLDivElement | undefined = $state()
  let desktopInputEl: HTMLInputElement | undefined = $state()
  let mobileInputEl: HTMLInputElement | undefined = $state()

  let loadPromise: Promise<void> | null = null

  async function ensureLoaded(): Promise<void> {
    if (loadPromise) return loadPromise
    loading = true
    loadPromise = (async () => {
      try {
        const [{ default: Fuse }, res] = await Promise.all([
          import('fuse.js'),
          fetch('/search-index.json').then((r) => {
            if (!r.ok) throw new Error(`search-index.json: HTTP ${r.status}`)
            return r.json() as Promise<SearchEntry[]>
          }),
        ])
        fuse = new Fuse(res, {
          keys: [
            { name: 'title', weight: 0.7 },
            { name: 'keywords', weight: 0.3 },
          ],
          threshold: 0.34,
          ignoreLocation: true,
          minMatchCharLength: 2,
          includeScore: true,
        })
      } catch (err) {
        console.error('[search] не удалось загрузить индекс поиска', err)
        loadFailed = true
      } finally {
        loading = false
      }
    })()
    return loadPromise
  }

  // Группируем по категориям, но порядок ГРУПП определяем по тому, где
  // впервые встретилась категория в списке Fuse (он уже отсортирован по
  // убыванию релевантности) - НЕ по фиксированному списку категорий. Так
  // категория с лучшим совпадением всегда идёт первой секцией, а не шумная
  // категория, которая просто выше в жёстко заданном приоритете. Результат
  // уже сгруппирован по категориям подряд - groupedForRender ниже просто
  // режет на секции по границам категории.
  function capByCategory(results: SearchEntry[]): SearchEntry[] {
    const order: string[] = []
    const buckets = new Map<string, SearchEntry[]>()
    for (const r of results) {
      let bucket = buckets.get(r.category)
      if (!bucket) {
        bucket = []
        buckets.set(r.category, bucket)
        order.push(r.category)
      }
      if (bucket.length < MAX_PER_CATEGORY) bucket.push(r)
    }
    const out: SearchEntry[] = []
    for (const cat of order) {
      for (const item of buckets.get(cat)!) {
        if (out.length >= MAX_TOTAL) return out
        out.push(item)
      }
    }
    return out
  }

  function runSearch(q: string) {
    activeIndex = -1
    if (!fuse || !q.trim()) {
      flatResults = []
      return
    }
    const hits = fuse
      .search(q.trim(), { limit: MAX_TOTAL * 2 })
      .filter((h: { score?: number }) => (h.score ?? 1) <= SCORE_CUTOFF)
      .map((h: { item: SearchEntry }) => h.item)
    flatResults = capByCategory(hits)
  }

  let debounceHandle: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const q = query
    if (debounceHandle) clearTimeout(debounceHandle)
    debounceHandle = setTimeout(() => {
      if (fuse) {
        runSearch(q)
      } else if (q.trim()) {
        ensureLoaded().then(() => runSearch(query))
      } else {
        flatResults = []
      }
    }, 150)
    return () => {
      if (debounceHandle) clearTimeout(debounceHandle)
    }
  })

  // Группы для рендера (пересчитываются из уже сгруппированного flatResults,
  // порядок сохранён groupAndFlatten - тут просто разбиваем обратно по секциям
  // для заголовков).
  let groupedForRender = $derived.by(() => {
    const groups: { category: string; items: SearchEntry[] }[] = []
    for (const item of flatResults) {
      const last = groups[groups.length - 1]
      if (last && last.category === item.category) last.items.push(item)
      else groups.push({ category: item.category, items: [item] })
    }
    return groups
  })

  function onFocus() {
    open = true
    void ensureLoaded()
  }

  function onInput() {
    open = true
  }

  function closeAll() {
    open = false
    mobileOpen = false
    activeIndex = -1
  }

  function toggleMobile() {
    mobileOpen = !mobileOpen
    if (mobileOpen) {
      open = true
      queueMicrotask(() => mobileInputEl?.focus())
    } else {
      closeAll()
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeAll()
      ;(e.target as HTMLElement | null)?.blur()
      return
    }
    if (!flatResults.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % flatResults.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = activeIndex <= 0 ? flatResults.length - 1 : activeIndex - 1
    } else if (e.key === 'Enter') {
      const target = activeIndex >= 0 ? flatResults[activeIndex] : flatResults[0]
      if (target) {
        e.preventDefault()
        window.location.href = target.href
        closeAll()
      }
    }
  }

  function onWindowClick(e: MouseEvent) {
    if (!open && !mobileOpen) return
    const target = e.target as Node
    // Оверлей вынесен порталом в <body> (см. portal() выше) - он больше не
    // потомок rootEl в DOM, поэтому клик внутри него надо проверять отдельно.
    if (mobileOverlayEl && mobileOverlayEl.contains(target)) return
    if (rootEl && !rootEl.contains(target)) closeAll()
  }

  function resultKey(item: SearchEntry, i: number) {
    return `${item.href}:${i}`
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="site-search" bind:this={rootEl}>
  <button
    class="search-icon-btn"
    type="button"
    aria-label={mobileOpen ? 'Закрыть поиск' : 'Открыть поиск'}
    onclick={toggleMobile}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </button>

  <div class="search-desktop">
    <input
      bind:this={desktopInputEl}
      type="search"
      class="search-input"
      placeholder="Поиск по сайту..."
      autocomplete="off"
      bind:value={query}
      onfocus={onFocus}
      oninput={onInput}
      onkeydown={onKeydown}
      aria-label="Поиск по сайту"
    />
    {#if open && query.trim()}
      <div class="search-dropdown">
        {#if loading}
          <p class="search-status">Загрузка...</p>
        {:else if loadFailed}
          <p class="search-status">Поиск временно недоступен</p>
        {:else if flatResults.length === 0}
          <p class="search-status">Ничего не найдено по запросу «{query.trim()}»</p>
        {:else}
          {#each groupedForRender as group (group.category)}
            <div class="search-group">
              <div class="search-group-label">{group.category}</div>
              {#each group.items as item, i (resultKey(item, i))}
                {@const flatIdx = flatResults.indexOf(item)}
                <a
                  href={item.href}
                  class="search-result"
                  class:active={flatIdx === activeIndex}
                  onmouseenter={() => (activeIndex = flatIdx)}
                  onclick={closeAll}
                >
                  {item.title}
                </a>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if mobileOpen}
  <div class="search-mobile-overlay" use:portal bind:this={mobileOverlayEl}>
    <div class="search-mobile-bar">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        bind:this={mobileInputEl}
        type="search"
        class="search-input"
        placeholder="Поиск по сайту..."
        autocomplete="off"
        bind:value={query}
        oninput={onInput}
        onkeydown={onKeydown}
        aria-label="Поиск по сайту"
      />
      <button class="close-btn" type="button" aria-label="Закрыть поиск" onclick={toggleMobile}>&times;</button>
    </div>
    <div class="search-mobile-results">
      {#if loading}
        <p class="search-status">Загрузка...</p>
      {:else if loadFailed}
        <p class="search-status">Поиск временно недоступен</p>
      {:else if query.trim() && flatResults.length === 0}
        <p class="search-status">Ничего не найдено по запросу «{query.trim()}»</p>
      {:else}
        {#each groupedForRender as group (group.category)}
          <div class="search-group">
            <div class="search-group-label">{group.category}</div>
            {#each group.items as item, i (resultKey(item, i))}
              <a href={item.href} class="search-result" onclick={closeAll}>{item.title}</a>
            {/each}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .site-search {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .search-icon-btn {
    display: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: none;
    border: none;
    color: #58a6ff;
    cursor: pointer;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .search-icon-btn:hover {
    background-color: rgba(88, 166, 255, 0.1);
  }

  .search-desktop {
    position: relative;
  }

  .search-input {
    width: 150px;
    max-width: 40vw;
    background-color: rgba(13, 17, 23, 0.6);
    border: 1px solid #30363d;
    color: #c9d1d9;
    font-family: inherit;
    font-weight: 700;
    font-size: 0.8rem;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    transition: width 0.2s ease, border-color 0.2s ease;
  }

  .search-input:focus {
    outline: none;
    width: 220px;
    border-color: rgba(88, 166, 255, 0.5);
  }

  .search-input::placeholder {
    color: #7d8590;
    font-weight: 700;
  }

  /* Убираем нативный крестик очистки WebKit - свой UI не рисуем, но и
     системный дублирующий значок в поле поиска не нужен. */
  .search-input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }

  .search-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 320px;
    max-width: 80vw;
    max-height: 70vh;
    overflow-y: auto;
    background-color: rgba(22, 27, 34, 0.97);
    backdrop-filter: blur(12px);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 0.5rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    z-index: 200;
  }

  .search-status {
    margin: 0;
    padding: 0.75rem 0.6rem;
    color: #7d8590;
    font-size: 0.85rem;
  }

  .search-group + .search-group {
    margin-top: 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid rgba(48, 54, 61, 0.6);
  }

  .search-group-label {
    padding: 0.3rem 0.6rem;
    color: #7d8590;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .search-result {
    display: block;
    padding: 0.55rem 0.6rem;
    color: #c9d1d9;
    text-decoration: none;
    font-size: 0.85rem;
    border-radius: 8px;
    transition: background-color 0.15s, color 0.15s;
  }

  .search-result:hover,
  .search-result.active {
    background: linear-gradient(90deg, rgba(88, 166, 255, 0.15) 0%, transparent 100%);
    color: #58a6ff;
  }

  .search-mobile-overlay {
    display: none;
  }

  @media (max-width: 767px) {
    .search-icon-btn {
      display: flex;
    }

    .search-desktop {
      display: none;
    }

    .search-mobile-overlay {
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(13, 17, 23, 0.98);
      z-index: 1001;
    }

    .search-mobile-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.6rem;
      border-bottom: 1px solid #30363d;
      color: #58a6ff;
      flex-shrink: 0;
    }

    .search-mobile-bar .search-input {
      flex: 1;
      width: auto;
      max-width: none;
    }

    .search-mobile-bar .search-input:focus {
      width: auto;
    }

    .search-mobile-bar .close-btn {
      background: none;
      border: none;
      color: #c9d1d9;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0;
      width: 36px;
      height: 36px;
      flex-shrink: 0;
    }

    .search-mobile-results {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }

    .search-mobile-results .search-result {
      padding: 0.75rem 0.6rem;
      font-size: 0.95rem;
      border-bottom: 1px solid #21262d;
      border-radius: 0;
    }
  }
</style>
