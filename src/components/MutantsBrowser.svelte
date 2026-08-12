<script lang="ts">
  import MutantModal from './MutantModal.svelte';
  import { TYPE_RU, geneLabel, bingoLabel } from '@/lib/mutant-dicts';
  import { normalizeSearch } from '@/lib/search-normalize';
  import { sortMutantsByGene } from '@/lib/mutant-sort';
  import { textureUrl } from '@/lib/texture-cdn';
  import { pluralize, baseMutantId as baseId } from '@/lib/utils';
  import { getTypeIcon } from '@/lib/mutant-icons';
  import { bingoIconUrl } from '@/lib/bingo-textures';

  const normalizeForSearch = normalizeSearch;

  let { items = [], skins = [], bingos = [], title = '', bingoIndex = [] } = $props();

  let showScrollTop = $state(false);
  $effect(() => {
    const onScroll = () => { showScrollTop = window.scrollY > 600; };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  });
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  type BaseMap = Map<string, any>;
  function buildBaseMap(list: any[]): BaseMap {
    const map: BaseMap = new Map();
    for (const item of Array.isArray(list) ? list : []) {
      const key = baseId(item?.id);
      if (!key) continue;
      const id = String(item?.id ?? '').toLowerCase();
      const isNormal = !/_+(?:bronze|silver|gold|platinum|plat)\b/.test(id);
      if (!map.has(key) || isNormal) {
        map.set(key, item);
      }
    }
    return map;
  }

  function hasBingo(val: any): boolean {
    if (!val) return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    return false;
  }

  function mergeBaseStats(baseStats: any, override: any) {
    if (!baseStats && !override) return undefined;
    const result = { ...(baseStats ?? {}) };
    if (baseStats?.lvl1 || override?.lvl1) {
      result.lvl1 = { ...(baseStats?.lvl1 ?? {}), ...(override?.lvl1 ?? {}) };
    }
    if (baseStats?.lvl30 || override?.lvl30) {
      result.lvl30 = { ...(baseStats?.lvl30 ?? {}), ...(override?.lvl30 ?? {}) };
    }
    for (const key of Object.keys(override ?? {})) {
      if (key === 'lvl1' || key === 'lvl30') continue;
      result[key] = override[key];
    }
    return result;
  }

  function pickImage(preferred: any, fallback: any) {
    if (Array.isArray(preferred)) return preferred.slice();
    if (preferred != null) return preferred;
    if (Array.isArray(fallback)) return fallback.slice();
    return fallback ?? [];
  }

  function mapSkin(s: any, lookup: BaseMap, index: number) {

    const key = baseId(s?.id);
    const base = key ? lookup.get(key) : undefined;

    const merged: any = {
      ...Object.fromEntries(Object.entries(base ?? {}).filter(([k]) => k !== 'stars')),
      ...(s ?? {}),
      id: s?.id ?? base?.id,
      name: s?.name ?? base?.name,
      genes: Array.isArray(s?.genes) && s.genes.length ? s.genes : base?.genes,
      base_stats: mergeBaseStats(base?.base_stats, s?.base_stats),
      image: pickImage(s?.image, base?.image),
      type: s?.type ?? base?.type ?? 'default',
      star: !s?.star || s.star === 'none' ? 'normal' : String(s.star).toLowerCase(),
      bingo: hasBingo(s?.bingo) ? s.bingo : base?.bingo,
      abilities: Array.isArray(s?.abilities) && s.abilities.length ? s.abilities : base?.abilities,
      name_attack1: s?.name_attack1 ?? base?.name_attack1,
      name_attack2: s?.name_attack2 ?? base?.name_attack2,
      name_lore: s?.name_lore ?? base?.name_lore,
      incub_time:
        s?.incub_time ??
        s?.incubation ??
        s?.incubation_time ??
        s?.incubationTime ??
        s?.incubation_hours ??
        s?.hatch_time ??
        base?.incub_time ??
        base?.incubation ??
        base?.incubation_time ??
        base?.incubationTime ??
        base?.incubation_hours ??
        base?.hatch_time,
      chance: s?.chance ?? s?.chance_percent ?? base?.chance ?? base?.chance_percent,
      tier: s?.tier ?? base?.tier,
      skin: s?.skin ?? base?.skin ?? true,
      __source: 'skin' as const,
      __skinIndex: index,
      __skinKey: `${key || 'skin'}::${String(s?.skin ?? '')}::${index}`,
    };

    return merged;
  }

  let baseMap: BaseMap = $derived(buildBaseMap(items ?? []));

  let preparedMutants: any[] = $state([]);

  $effect(() => {
    preparedMutants = (items || []).map(enrichItem);
  });

  let normalizedSkins = $derived((Array.isArray(skins) ? skins : []).map((skin, index) => mapSkin(skin, baseMap, index)));

  type ViewMode = 'full' | 'heads';
  let viewMode: ViewMode = $state('full');

  let query = $state('');
  let gene1Sel = $state('');
  let gene2Sel = $state('');

  $effect(() => {
    if (!gene1Sel) gene2Sel = '';
  });

  let typeOptions = $derived(uniq(items.map(it => it?.type).filter(Boolean))
      .sort((a:any,b:any) => String(TYPE_RU?.[a] ?? a).localeCompare(String(TYPE_RU?.[b] ?? b), 'ru')));
  let typeSel = $state('');
  let typeDropdownOpen = $state(false);
  let bingoDropdownOpen = $state(false);
  function closeIconDropdowns() { typeDropdownOpen = false; bingoDropdownOpen = false; }

  function collectBingoKeys(it:any): string[] {
    const b = it?.bingo;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x:any) => typeof x === 'string' ? x : (x?.key ?? '')).filter(Boolean);
    if (typeof b === 'object') return Object.keys(b);
    return [];
  }
  function flatten<T>(arr: T[][]): T[] { const out:T[]=[]; for (let i=0;i<arr.length;i++) out.push(...arr[i]); return out; }
  let bingoOptions = $derived((bingoIndex?.length
      ? [...bingoIndex]
      : uniq(flatten(items.map(collectBingoKeys)))
    ).sort((a,b) => {
      const la = String(bingoLabel?.(a) ?? a);
      const lb = String(bingoLabel?.(b) ?? b);
      const aIsResearch = /^Исследование\s/.test(la);
      const bIsResearch = /^Исследование\s/.test(lb);
      if (aIsResearch && !bIsResearch) return -1;
      if (!aIsResearch && bIsResearch) return 1;
      const na = la.replace(/\d+/g, m => m.padStart(6, '0'));
      const nb = lb.replace(/\d+/g, m => m.padStart(6, '0'));
      return na.localeCompare(nb, 'ru');
    }));
  let bingoSel = $state('');

  type StarKey = 'normal'|'bronze'|'silver'|'gold'|'platinum';

  const starSelMutants: StarKey = 'normal';

  // Skin lookup: map base ID → array of skins for that mutant
  let skinLookup: Map<string, any[]> = $derived((() => {
    const map = new Map<string, any[]>();
    for (const skin of normalizedSkins) {
      const key = baseId(skin?.id);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(skin);
    }
    return map;
  })());

  const geneList = [
    { key: '',  label: 'Ген 1: ВСЕ',             icon: '/genes/gene_all.webp' },
    { key: 'A', label: geneLabel?.('A') ?? 'A', icon: '/genes/gene_a.webp' },
    { key: 'B', label: geneLabel?.('B') ?? 'B', icon: '/genes/gene_b.webp' },
    { key: 'C', label: geneLabel?.('C') ?? 'C', icon: '/genes/gene_c.webp' },
    { key: 'D', label: geneLabel?.('D') ?? 'D', icon: '/genes/gene_d.webp' },
    { key: 'E', label: geneLabel?.('E') ?? 'E', icon: '/genes/gene_e.webp' },
    { key: 'F', label: geneLabel?.('F') ?? 'F', icon: '/genes/gene_f.webp' },
  ];
  const geneList2 = [
    { key: '', label:  'Ген 2: ВСЕ',             icon: '/genes/gene_all.webp' },
    { key: 'neutral', label: 'Нейтральный',      icon: '/genes/gene_all.webp' },
    { key: 'A', label: geneLabel?.('A') ?? 'A', icon: '/genes/gene_a.webp' },
    { key: 'B', label: geneLabel?.('B') ?? 'B', icon: '/genes/gene_b.webp' },
    { key: 'C', label: geneLabel?.('C') ?? 'C', icon: '/genes/gene_c.webp' },
    { key: 'D', label: geneLabel?.('D') ?? 'D', icon: '/genes/gene_d.webp' },
    { key: 'E', label: geneLabel?.('E') ?? 'E', icon: '/genes/gene_e.webp' },
    { key: 'F', label: geneLabel?.('F') ?? 'F', icon: '/genes/gene_f.webp' },
  ];
  const geneButtonClass = (selected: boolean, disabled: boolean = false) =>
    'p-1 rounded-lg ring-1 ' + (disabled ? 'bg-slate-900 ring-white/5 opacity-30 cursor-not-allowed' : selected ? 'bg-cyan-700 ring-cyan-400' : 'bg-slate-800 ring-white/10');

  const geneChipClass = (selected: boolean, disabled: boolean = false) =>
    'h-9 px-3 rounded-lg ring-1 flex items-center justify-center ' +
    (disabled ? 'bg-slate-900 ring-white/5 opacity-30 cursor-not-allowed' :
     selected ? 'bg-cyan-700 ring-cyan-400 text-white' :
     'bg-slate-800 ring-white/10 text-slate-200');

  const normalizeGene = (s:string) => (s ?? '').toUpperCase();
  const starOf = (it:any) => String(it?.star ?? 'normal').toLowerCase();
  function readGeneCode(it:any): string {
    if (Array.isArray(it?.genes)) {
      return it.genes.filter(Boolean).map((g: any) => String(g).toUpperCase()).join('');
    }
    if (typeof it?.gene === 'string') return it.gene;
    if (typeof it?.gene_code === 'string') return it.gene_code;
    return '';
  }
  const geneOrder = new Map<string, number>([
    ['A', 0], ['B', 1], ['C', 2], ['D', 3], ['E', 4], ['F', 5],
  ]);

  function enrichItem(it: any) {
    const searchName = normalizeForSearch(String(it?.name ?? ''));
    const rawCode = readGeneCode(it);
    const code = normalizeGene(rawCode);
    const first = code?.[0] ?? '';
    const rank = first ? geneOrder.get(first) ?? 99 : 199;

    const secondaryWeight = code.length <= 1 ? 0 : (geneOrder.get(code[1]) ?? 99) + 1;

    const typeKey = String(it?.type ?? '').toLowerCase();

    const starKey = starOf(it);
    const bingoKeys = new Set(collectBingoKeys(it).map(String));
    return {
      ...it,
      _meta: { searchName, code, rank, secondaryWeight, typeKey, starKey, bingoKeys, id: String(it?.id ?? '') }
    };
  }

  function uniq<T>(arr: T[]) { return Array.from(new Set(arr)); }

  let filteredMutants = $derived((() => {
    const q = query ? query.trim().toLowerCase() : null;
    const normalizedQ = q ? normalizeForSearch(q) : null;
    const sBingo = bingoSel ? String(bingoSel) : null;
    const sType = typeSel ? String(typeSel).toLowerCase() : null;

    const isSearching = !!normalizedQ;

    const bingoData = sBingo ? bingos.find((b: any) => b.id === sBingo) : null;
    const isReactorSel = sBingo === 'reactor' || (sType === 'reactor' || sType === 'gacha');

    const res = [];
    for (const it of preparedMutants) {
      const m = it._meta;

      if (normalizedQ && !m.searchName.includes(normalizedQ)) continue;

      if (!isSearching) {
        if (gene1Sel) {
          const firstGene = m.code?.[0];
          if (firstGene !== gene1Sel.toUpperCase()) continue;
          if (gene2Sel) {
            if (gene2Sel === 'neutral') {
              if (m.code.length !== 1) continue;
            } else {
              if (m.code.length < 2 || m.code[1] !== gene2Sel.toUpperCase()) continue;
            }
          }
        }

        if (sType) {
          if (m.typeKey !== sType) continue;
        }

        if (sBingo) {
          if (!m.bingoKeys.has(sBingo)) continue;
        }
      }

      let fSkin = null;
      if (bingoData) {
        const entry = bingoData.mutants.find((bm: any) => bm.specimenId.toLowerCase() === m.id.toLowerCase());
        if (entry && entry.skin && entry.skin !== '_any') {
          fSkin = entry.skin;
        }
      }

      if (!fSkin && isReactorSel) {
        const hasReactorBingo = m.bingoKeys.has('reactor');
        const isGachaType = m.typeKey === 'reactor' || m.typeKey === 'gacha';
        if (hasReactorBingo || isGachaType) {
          fSkin = 'gachaboss';
        }
      }

      res.push(fSkin ? { ...it, forceSkin: fSkin } : it);
    }

    if (sBingo) {
        let autoStar = '';
        if (sBingo === 'reactor') autoStar = 'platinum';
        else if (sBingo.includes('bronze') || sBingo.includes('research_1')) autoStar = 'bronze';
        else if (sBingo.includes('silver') || sBingo.includes('research_2')) autoStar = 'silver';
        else if (sBingo.includes('gold') || sBingo.includes('research_3')) autoStar = 'gold';
        else if (sBingo.includes('platinum') || sBingo.includes('plat') || sBingo.includes('research_4')) autoStar = 'platinum';

        if (autoStar) {
            return res.map(it => ({ ...it, _displayStar: autoStar })).sort(sortMutantsByGene);
        }
    }

    return res.sort((a, b) => {
      const rankA = a._meta?.rank ?? 199;
      const rankB = b._meta?.rank ?? 199;
      if (rankA !== rankB) return rankA - rankB;

      const weight2A = a._meta?.secondaryWeight ?? 0;
      const weight2B = b._meta?.secondaryWeight ?? 0;
      if (weight2A !== weight2B) return weight2A - weight2B;

      return (a._meta?.id || '').localeCompare(b._meta?.id || '');
    });
  })());

  let pageSize = $derived(viewMode === 'heads' ? 60 : 20);
  let currentPage = $state(1);

  $effect(() => {
    // Явное чтение зависимостей: смена любого фильтра сбрасывает страницу
    void [query, gene1Sel, gene2Sel, typeSel, bingoSel, starSelMutants, viewMode];
    currentPage = 1;
  });

  let endIndex = $derived(pageSize * currentPage);
  let shownMutants = $derived(filteredMutants.slice(0, endIndex));

  function pickTexture(it:any): string {
    const bid = baseId(it.id);

    if (it?.forceSkin) {
        const skinTag = String(it.forceSkin).toLowerCase();

        if (skins && skins.length > 0) {
           const skinEntry = skins.find((s: any) => {
             const sId = baseId(s.id);
             const sSkin = String(s.skin ?? '').toLowerCase();
             return sId === bid && (sSkin.includes(skinTag) || skinTag.includes(sSkin));
           });

           if (skinEntry && skinEntry.image) {
             const skinImages = Array.isArray(skinEntry.image) ? skinEntry.image : [skinEntry.image];
             const fullChar = skinImages.find((p: any) => String(p).includes('full-char'));
             if (fullChar) return fullChar;
             const semiFull = skinImages.find((p: any) => String(p).includes('semi-full'));
             if (semiFull) return semiFull;
             return skinImages[0];
           }
        }
    }

    if (it?.stars) {
        const displayStar = it._displayStar || starSelMutants;
        const starKeys = Object.keys(it.stars);
        const starData = it.stars[displayStar] || it.stars[starKeys[0]];
        if (starData?.images?.length) {
            const imgs = starData.images;
            const specimen = imgs.find((p: string) => p.includes('specimen'));
            if (specimen) return specimen;
            const fullTexture = imgs.find((p: string) => p.includes('textures_by_mutant/') && !p.includes('specimen') && !p.includes('larva'));
            if (fullTexture) return fullTexture;
            return imgs[0];
        }
    }

    const list = Array.isArray(it?.image) ? it.image : (it?.image ? [it.image] : []);
    const starVal = String(it?.star ?? 'normal').toLowerCase();

    let pick = list.find((p: string) => {
        const path = p.toLowerCase();
        if (starVal === 'normal') return path.includes('normal') || (!path.includes('bronze') && !path.includes('silver') && !path.includes('gold') && !path.includes('platinum') && !path.includes('plat'));
        if (starVal === 'platinum') return path.includes('platinum') || path.includes('plat');
        return path.includes(starVal);
    });

    if (!pick) {
        pick = list.find((p:string) => p.includes('specimen'));
        if (!pick) {
            pick = list.find((p:string) => p.includes('textures_by_mutant/') && !p.includes('specimen') && !p.includes('larva'));
        }
        if (!pick) {
            pick = list[0];
        }
    }
    return pick ?? 'placeholder-mutant.webp';
  }

  // Полная текстура (стойка), отрендеренная пайплайном scripts/character-textures/.
  // Лежит рядом со старыми specimen_*.webp: textures_by_mutant/<code>/FULL_<code>[_<tier>].png
  // baseId() не срезает префикс specimen_, поэтому нормализуем id здесь.
  // FULL-версия есть не у каждого мутанта/тира -> в разметке onerror откатывает на портрет.
  function fullTexturePath(it: any): string {
    const code = String(it?.id ?? '')
      .replace(/^specimen[_-]/i, '')
      .replace(/_+(?:normal|bronze|silver|gold|platinum|plat).*$/i, '')
      .toLowerCase();
    if (!code) return '';
    const star = String(it?._displayStar || starSelMutants || 'normal').toLowerCase();
    const suffix = star && star !== 'normal' ? `_${star}` : '';
    return `textures_by_mutant/${code}/FULL_${code}${suffix}.png`;
  }

  function rarityType(item:any){
    return item?._displayStar || starSelMutants;
  }

  const keyOf = (it:any, index?: number) => {
    return `mut:${it?.id ?? index}`;
  };

  let openItem:any = $state(null);
  const openModal  = (it:any) => { openItem = it; };
  const closeModal = () => { openItem = null; };

  // Диплинк из сайтового поиска (SearchBox.svelte -> /mutants?mutant=<id>):
  // открываем модалку сразу при заходе на страницу, минуя текущие фильтры,
  // поэтому ищем прямо в сыром items, а не в отфильтрованном списке.
  // deepLinkHandled - страховка от повторного открытия: $effect формально
  // реагирует на items (реактивное чтение), и хотя проп меняется один раз за
  // жизнь страницы, без флага случайное повторное срабатывание молча
  // переоткрыло бы модалку, которую пользователь уже закрыл сам.
  let deepLinkHandled = false;
  $effect(() => {
    if (typeof window === 'undefined' || deepLinkHandled) return;
    const id = new URLSearchParams(window.location.search).get('mutant');
    if (!id) return;
    const match = items.find((it: any) => it?.id === id) ?? items.find((it: any) => baseId(it?.id) === baseId(id));
    if (match) {
      deepLinkHandled = true;
      openModal(enrichItem(match));
    }
  });
</script>

<svelte:window onclick={closeIconDropdowns} />
<div class="mx-auto max-w-[1400px] px-4 py-6 page-2k">
  {#if title}
    <h1 class="text-2xl md:text-3xl font-bold text-slate-100 mb-4">
      {title}
      <span class="text-base md:text-lg font-normal text-slate-200 ml-2">({filteredMutants.length} {pluralize(filteredMutants.length, 'мутант', 'мутанта', 'мутантов')})</span>
    </h1>
  {/if}



  <!-- Поиск -->
  <div class="mb-3">
    <input
      id="mutant-search"
      name="mutant-search"
      class="w-full px-4 py-3 rounded-lg ring-1 transition outline-none bg-slate-900 text-slate-100 placeholder-slate-400 ring-white/10 focus:ring-2 focus:ring-cyan-400"
      placeholder="Введите имя мутанта…"
      bind:value={query}
    />
  </div>

  <!-- Гены: две строки -->
  <div class="mb-2 rounded-xl bg-slate-900/60 ring-1 ring-white/10 p-2 shadow-sm md:shadow">
    <div class="flex flex-col gap-2">
      <!-- Gene 1 Row -->
      <div class="flex flex-wrap gap-2">
        {#each geneList as g}
          {#if g.key === ''}
            <button type="button"
              class={geneChipClass(gene1Sel===g.key)}
              onclick={() => { gene1Sel = ''; gene2Sel = ''; }}
              title={g.label}
              aria-pressed={gene1Sel===g.key}
            >
              <span class="text-xs">{g.label}</span>
            </button>
          {:else}
            <button type="button"
              class={geneButtonClass(gene1Sel===g.key)}
              onclick={() => { gene1Sel = (gene1Sel===g.key ? '' : g.key); }}
              title={g.label}
              aria-pressed={gene1Sel===g.key}
            >
              <img src={textureUrl(g.icon)} alt={g.label} class="h-8 w-8 object-contain" />
            </button>
          {/if}
        {/each}
      </div>
      <!-- Gene 2 Row -->
      <div class="flex flex-wrap gap-2">
        {#each geneList2 as g}
          {#if g.key === ''}
            <button type="button"
              class={geneChipClass(gene2Sel===g.key && gene1Sel, !gene1Sel)}
              onclick={() => { if (gene1Sel) gene2Sel = ''; }}
              title={g.label}
              aria-pressed={gene2Sel===g.key}
              disabled={!gene1Sel}
            >
              <span class="text-xs">{g.label}</span>
            </button>
          {:else if g.key === 'neutral'}
            <button type="button"
              class={geneButtonClass(gene2Sel===g.key, !gene1Sel)}
              onclick={() => { if (gene1Sel) gene2Sel = (gene2Sel===g.key ? '' : g.key); }}
              title={g.label}
              aria-pressed={gene2Sel===g.key}
              disabled={!gene1Sel}
            >
              <img src={textureUrl(g.icon)} alt={g.label} class="h-8 w-8 object-contain" />
            </button>
          {:else}
            <button type="button"
              class={geneButtonClass(gene2Sel===g.key, !gene1Sel)}
              onclick={() => { if (gene1Sel) gene2Sel = (gene2Sel===g.key ? '' : g.key); }}
              title={g.label}
              aria-pressed={gene2Sel===g.key}
              disabled={!gene1Sel}
            >
              <img src={textureUrl(g.icon)} alt={g.label} class="h-8 w-8 object-contain" />
            </button>
          {/if}
        {/each}
      </div>
    </div>
  </div>

  <!-- Тип/Бинго (кастомные дропдауны с иконками) -->
  <div class="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
    <div class="icon-select-wrap">
      <span id="mutant-type-filter-label" class="text-xs text-slate-300">Тип</span>
      <button
        type="button"
        id="mutant-type-filter"
        aria-labelledby="mutant-type-filter-label"
        class="icon-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={typeDropdownOpen}
        onclick={(e) => { e.stopPropagation(); bingoDropdownOpen = false; typeDropdownOpen = !typeDropdownOpen; }}
      >
        {#if typeSel}<img src={textureUrl(getTypeIcon(typeSel))} alt="" class="icon-select-icon" />{/if}
        <span class="icon-select-label">{typeSel ? (TYPE_RU?.[typeSel] ?? typeSel) : 'Любой'}</span>
        <span class="icon-select-caret">▾</span>
      </button>
      {#if typeDropdownOpen}
        <div class="icon-select-panel" role="listbox">
          <button type="button" class="icon-select-option {!typeSel ? 'active' : ''}" role="option" aria-selected={!typeSel} onclick={() => { typeSel = ''; typeDropdownOpen = false; }}>
            <span class="icon-select-label">Любой</span>
          </button>
          {#each typeOptions as t}
            <button type="button" class="icon-select-option {typeSel === t ? 'active' : ''}" role="option" aria-selected={typeSel === t} onclick={() => { typeSel = t; typeDropdownOpen = false; }}>
              <img src={textureUrl(getTypeIcon(t))} alt="" class="icon-select-icon" />
              <span class="icon-select-label">{TYPE_RU?.[t] ?? t}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="icon-select-wrap">
      <span id="mutant-bingo-filter-label" class="text-xs text-slate-300">Бинго</span>
      <button
        type="button"
        id="mutant-bingo-filter"
        aria-labelledby="mutant-bingo-filter-label"
        class="icon-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={bingoDropdownOpen}
        onclick={(e) => { e.stopPropagation(); typeDropdownOpen = false; bingoDropdownOpen = !bingoDropdownOpen; }}
      >
        {#if bingoSel}<img src={textureUrl(bingoIconUrl(bingoSel))} alt="" class="icon-select-icon" />{/if}
        <span class="icon-select-label">{bingoSel ? (bingoLabel?.(bingoSel) ?? bingoSel) : 'Любое'}</span>
        <span class="icon-select-caret">▾</span>
      </button>
      {#if bingoDropdownOpen}
        <div class="icon-select-panel" role="listbox">
          <button type="button" class="icon-select-option {!bingoSel ? 'active' : ''}" role="option" aria-selected={!bingoSel} onclick={() => { bingoSel = ''; bingoDropdownOpen = false; }}>
            <span class="icon-select-label">Любое</span>
          </button>
          {#each bingoOptions as b}
            <button type="button" class="icon-select-option {bingoSel === b ? 'active' : ''}" role="option" aria-selected={bingoSel === b} onclick={() => { bingoSel = b; bingoDropdownOpen = false; }}>
              <img src={textureUrl(bingoIconUrl(b))} alt="" class="icon-select-icon" />
              <span class="icon-select-label">{bingoLabel?.(b) ?? b}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Переключатель вида: полные текстуры / головы -->
  <div class="mb-3 flex items-center gap-2">
    <span class="text-xs text-slate-300">Вид</span>
    <div class="inline-flex overflow-hidden rounded-lg ring-1 ring-white/10">
      <button
        type="button"
        class={'px-3 py-1.5 text-sm transition ' + (viewMode === 'full'
          ? 'bg-cyan-500/20 text-cyan-200'
          : 'bg-slate-900 text-slate-300 hover:bg-slate-800')}
        aria-pressed={viewMode === 'full'}
        onclick={() => (viewMode = 'full')}
      >Полные</button>
      <button
        type="button"
        class={'px-3 py-1.5 text-sm transition ' + (viewMode === 'heads'
          ? 'bg-cyan-500/20 text-cyan-200'
          : 'bg-slate-900 text-slate-300 hover:bg-slate-800')}
        aria-pressed={viewMode === 'heads'}
        onclick={() => (viewMode = 'heads')}
      >Головы</button>
    </div>
  </div>

  <!-- Сетка карточек -->
  <div class={viewMode === 'heads'
    ? 'grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10'
    : 'grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5'}
  >
    {#each shownMutants as it, i (keyOf(it, i))}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div role="button" tabindex="0" class="cursor-pointer" onclick={() => openModal(it)} onkeydown={(e) => e.key === 'Enter' && openModal(it)}>
        {#if viewMode === 'heads'}
          <div class="heads-card">
            <img class="heads-img specimen" src={textureUrl(pickTexture(it))} alt={it.name} loading="lazy" decoding="async" width="128" height="128" oncontextmenu={(e) => e.preventDefault()} draggable="false" />
            <div class="heads-name">{it.name}</div>
          </div>
        {:else}
          <div class="relative rounded-xl overflow-hidden bg-slate-800 ring-1 ring-white/10">
            <img
              class="w-full object-contain bg-slate-900"
              style="height: 195px;"
              src={textureUrl(fullTexturePath(it))}
              data-fallback-src={textureUrl(pickTexture(it))}
              onerror={(e) => {
                const t = e.currentTarget;
                if (!t.dataset.fellBack && t.dataset.fallbackSrc) {
                  t.dataset.fellBack = '1';
                  t.src = t.dataset.fallbackSrc;
                }
              }}
              alt={it.name} loading="lazy" decoding="async" width="512" height="512"
              oncontextmenu={(e) => e.preventDefault()} draggable="false" />
            <div class="px-3 pt-2 pb-3">
              <div class="text-slate-100 font-semibold text-sm truncate">{it.name}</div>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Показать ещё -->
  {#if shownMutants.length < filteredMutants.length}
    <div class="mt-3 flex justify-center">
      <button class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 ring-1 ring-white/10 text-white"
              onclick={() => { currentPage = currentPage + 1; }}>
        Показать ещё
      </button>
    </div>
  {/if}

  {#if openItem}
    <MutantModal open={true} mutant={openItem} star={rarityType(openItem)} skins={skinLookup.get(baseId(openItem.id)) ?? []} onclose={closeModal} />
  {/if}

  {#if showScrollTop}
    <button class="scroll-top-btn" onclick={scrollToTop} aria-label="Наверх" title="Наверх">
      ↑
    </button>
  {/if}
</div>

<style>
  .scroll-top-btn {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 40;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: rgba(30, 41, 59, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
    font-size: 1.3rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  .scroll-top-btn:hover {
    background: rgba(51, 65, 85, 0.95);
  }

  .icon-select-wrap { position: relative; display: flex; flex-direction: column; gap: 0.25rem; }
  .icon-select-trigger {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 0.75rem; border-radius: 0.5rem;
    background: rgb(15 23 42); color: rgb(241 245 249);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
    cursor: pointer; text-align: left; width: 100%;
  }
  .icon-select-trigger:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgb(34 211 238); }
  .icon-select-icon { width: 1.5em; height: 1.5em; object-fit: contain; flex-shrink: 0; border-radius: 0.25em; background: rgba(255,255,255,0.06); }
  .icon-select-label { flex: 1; font-size: 0.875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icon-select-caret { font-size: 0.7em; opacity: 0.6; flex-shrink: 0; }
  .icon-select-panel {
    position: absolute; top: calc(100% + 0.25rem); left: 0; right: 0; z-index: 30;
    max-height: 18rem; overflow-y: auto;
    background: rgb(15 23 42); border-radius: 0.5rem;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 10px 30px rgba(0,0,0,0.5);
    padding: 0.25rem;
  }
  .icon-select-option {
    display: flex; align-items: center; gap: 0.5rem; width: 100%;
    padding: 0.4rem 0.5rem; border-radius: 0.375rem;
    background: transparent; color: rgb(203 213 225); cursor: pointer; text-align: left;
  }
  .icon-select-option:hover { background: rgba(34, 211, 238, 0.1); color: #fff; }
  .icon-select-option.active { background: rgba(34, 211, 238, 0.18); color: #67e8f9; }

  /* Апскейл на ≥2K */
  @media (min-width: 1921px){ .page-2k { font-size: 1.0625rem; } }
  @media (min-width: 1921px){
    .page-2k :global(img[style*="height: 195px"]) { height: 244px !important; }
    .heads-name { padding: 3px 5px; font-size: 13px; }
  }

  /* Heads mode */
  .heads-card {
    position: relative;
    border-radius: 10px;
    overflow: hidden;
    background: #1e293b;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
    aspect-ratio: 1;
  }
  .heads-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
    transform: scale(1.6);
    transform-origin: top center;
  }
  .heads-img.specimen {
    transform: none;
    object-fit: contain;
  }
  .heads-name {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: linear-gradient(transparent, rgba(0,0,0,0.85));
    color: #e2e8f0;
    font-size: 10px;
    font-weight: 600;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
