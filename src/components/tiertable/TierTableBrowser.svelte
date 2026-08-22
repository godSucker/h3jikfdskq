<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn'
  import { getGeneIcon, getTypeIcon, ABILITY_ICONS } from '@/lib/mutant-icons'
  import { ABILITY_RU, TYPE_RU } from '@/lib/mutant-dicts'

  interface Row {
    number: number
    id: string
    name: string
    icon: string
    type: string
    releaseNumber: number | null
    lastRebalance: string | null
    gene1: string
    gene2: string
    speed: number
    hp: number
    atk1: number
    atk1Gene: string
    atk1Aoe: boolean
    atk2: number
    atk2Gene: string
    atk2Aoe: boolean
    abilityKey: string | null
    abilityPct: number | null
    abilityAtk1: number | null
    abilityAtk2: number | null
    tierBefore: string
    tierAfter: string
  }

  let { rows = [] }: { rows: Row[] } = $props()

  const TIER_OPTIONS = ['1+', '1', '1-', '2+', '2', '2-', '3+', '3', '3-', '4', '-']
  const TIER_RANK: Record<string, number> = Object.fromEntries(TIER_OPTIONS.map((t, i) => [t, i]))
  const TIER_BG: Record<string, string> = {
    '1+': 'rgba(220,38,38,0.85)',
    '1': 'rgba(220,38,38,0.6)',
    '1-': 'rgba(220,38,38,0.35)',
    '2+': 'rgba(234,88,12,0.85)',
    '2': 'rgba(234,88,12,0.6)',
    '2-': 'rgba(234,88,12,0.35)',
    '3+': 'rgba(132,180,20,0.85)',
    '3': 'rgba(132,180,20,0.6)',
    '3-': 'rgba(132,180,20,0.35)',
    '4': 'rgba(21,100,55,0.85)',
    '-': 'transparent',
  }

  // Локальная редактируемая копия тиров - источник истины для рендера ячеек,
  // независимая от исходных rows props (правки не пишут ни в mutants.json,
  // ни в тир-лист, только в это состояние + на сервер по кнопке "Сохранить").
  let tiers = $state(new Map(rows.map((r) => [r.id, { before: r.tierBefore, after: r.tierAfter }])))
  let dirty = $state(new Set<string>())
  let saving = $state(false)
  let refreshing = $state(false)
  let pushingProd = $state(false)
  let statusMsg = $state('')

  type FilterCol = 'tierBefore' | 'tierAfter' | 'gene1' | 'gene2' | 'abilityKey'
  let filters = $state<Record<FilterCol, Set<string>>>({
    tierBefore: new Set(),
    tierAfter: new Set(),
    gene1: new Set(),
    gene2: new Set(),
    abilityKey: new Set(),
  })
  let openFilter: FilterCol | null = $state(null)
  // .toolbar-left скроллится по горизонтали (см. ниже) - это делает её
  // ближайшим clipping-контейнером для абсолютно позиционированных потомков,
  // так что дропдаун фильтра там обрезался бы снизу. Вместо absolute считаем
  // его позицию от кнопки и рендерим как position:fixed - вне зоны обрезки.
  let toolbarFilterPos: { top: number; left: number } | null = $state(null)
  function openToolbarFilter(e: MouseEvent, col: FilterCol) {
    e.stopPropagation()
    if (openFilter === col) {
      openFilter = null
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    toolbarFilterPos = { top: rect.bottom + 4, left: rect.left }
    openFilter = col
  }

  const GENE_VALUES = ['A', 'B', 'C', 'D', 'E', 'F', 'NEUTRO']
  const ABILITY_VALUES = ['shield', 'regen', 'retaliate', 'slash', 'strengthen', 'weaken']

  // Триггеры фильтров этих 4 колонок живут в общей верхней панели, не в
  // заголовках таблицы (см. prompt_tablica_combined_final.md, часть A.1) -
  // раньше сортировка и фильтр толкались в одном месте заголовка.
  const TOOLBAR_FILTER_DEFS: { col: FilterCol; label: string }[] = [
    { col: 'tierBefore', label: 'Тир до' },
    { col: 'tierAfter', label: 'Тир после' },
    { col: 'gene1', label: 'Ген 1' },
    { col: 'gene2', label: 'Ген 2' },
  ]

  function filterOptions(col: FilterCol): string[] {
    if (col === 'tierBefore' || col === 'tierAfter') return TIER_OPTIONS
    if (col === 'gene1' || col === 'gene2') return GENE_VALUES
    return ABILITY_VALUES
  }
  function filterLabel(col: FilterCol, v: string): string {
    if (col === 'abilityKey') return ABILITY_RU[`ability_${v}_plus`] ?? v
    if (v === 'NEUTRO') return 'Нейтральный'
    return v
  }
  function toggleFilter(col: FilterCol, value: string) {
    const set = new Set(filters[col])
    if (set.has(value)) set.delete(value)
    else set.add(value)
    filters = { ...filters, [col]: set }
  }

  type SortKey =
    | 'number'
    | 'releaseNumber'
    | 'lastRebalance'
    | 'tierBefore'
    | 'tierAfter'
    | 'speed'
    | 'hp'
    | 'atk1'
    | 'atk2'
    | 'abilityKey'
    | 'abilityPct'
    | 'abilityAtk1'
    | 'abilityAtk2'

  // Многоуровневая сортировка: стек последних 2 активных колонок, а не одно
  // поле. При клике на новую колонку старая "первичная" сортировка становится
  // tie-breaker'ом для строк с равным значением новой - не теряется полностью.
  let sortHistory: { key: SortKey; dir: 'asc' | 'desc' }[] = $state([])

  function setSort(key: SortKey) {
    if (sortHistory[0]?.key === key) {
      sortHistory = [{ key, dir: sortHistory[0].dir === 'asc' ? 'desc' : 'asc' }, ...sortHistory.slice(1)]
    } else {
      sortHistory = [{ key, dir: 'asc' as const }, ...sortHistory.filter((s) => s.key !== key)].slice(0, 2)
    }
  }

  function resetAll() {
    filters = { tierBefore: new Set(), tierAfter: new Set(), gene1: new Set(), gene2: new Set(), abilityKey: new Set() }
    sortHistory = []
    openFilter = null
  }

  const filteredRows = $derived.by(() => {
    return rows.filter((r) => {
      const t = tiers.get(r.id)!
      if (filters.tierBefore.size && !filters.tierBefore.has(t.before)) return false
      if (filters.tierAfter.size && !filters.tierAfter.has(t.after)) return false
      if (filters.gene1.size && !filters.gene1.has(r.gene1)) return false
      if (filters.gene2.size && !filters.gene2.has(r.gene2)) return false
      if (filters.abilityKey.size && !filters.abilityKey.has(r.abilityKey ?? '')) return false
      return true
    })
  })

  function rowValue(r: Row, key: SortKey): number {
    switch (key) {
      case 'number': return r.number
      case 'tierBefore': return TIER_RANK[tiers.get(r.id)!.before] ?? 99
      case 'tierAfter': return TIER_RANK[tiers.get(r.id)!.after] ?? 99
      case 'speed': return r.speed
      case 'hp': return r.hp
      case 'atk1': return r.atk1
      case 'atk2': return r.atk2
      case 'abilityPct': return r.abilityPct ?? -Infinity
      case 'abilityAtk1': return r.abilityAtk1 ?? -Infinity
      case 'abilityAtk2': return r.abilityAtk2 ?? -Infinity
      default: return 0
    }
  }

  function abilityLabel(r: Row): string | null {
    if (!r.abilityKey) return null
    return ABILITY_RU[`ability_${r.abilityKey}_plus`] ?? r.abilityKey
  }

  // lastRebalance/releaseNumber/abilityKey - особые случаи: строки без значения
  // всегда идут последними, независимо от направления сортировки (не просто
  // "маленькое значение", иначе они прыгали бы в начало при desc).
  function compareByKey(a: Row, b: Row, key: SortKey, dir: 'asc' | 'desc'): number {
    if (key === 'lastRebalance') {
      if (a.lastRebalance == null && b.lastRebalance == null) return 0
      if (a.lastRebalance == null) return 1
      if (b.lastRebalance == null) return -1
      const cmp = a.lastRebalance.localeCompare(b.lastRebalance)
      return dir === 'asc' ? cmp : -cmp
    }
    if (key === 'releaseNumber') {
      if (a.releaseNumber == null && b.releaseNumber == null) return 0
      if (a.releaseNumber == null) return 1
      if (b.releaseNumber == null) return -1
      const cmp = a.releaseNumber - b.releaseNumber
      return dir === 'asc' ? cmp : -cmp
    }
    if (key === 'abilityKey') {
      const la = abilityLabel(a)
      const lb = abilityLabel(b)
      if (la == null && lb == null) return 0
      if (la == null) return 1
      if (lb == null) return -1
      const cmp = la.localeCompare(lb, 'ru')
      return dir === 'asc' ? cmp : -cmp
    }
    const cmp = rowValue(a, key) - rowValue(b, key)
    return dir === 'asc' ? cmp : -cmp
  }

  const sortedRows = $derived.by(() => {
    const list = [...filteredRows]
    if (sortHistory.length === 0) {
      // Дефолт: Тир после (лучше -> выше), при равенстве - скорость по убыванию.
      list.sort((a, b) => {
        const ta = TIER_RANK[tiers.get(a.id)!.after] ?? 99
        const tb = TIER_RANK[tiers.get(b.id)!.after] ?? 99
        if (ta !== tb) return ta - tb
        return b.speed - a.speed
      })
      return list
    }
    list.sort((a, b) => {
      for (const { key, dir } of sortHistory) {
        const cmp = compareByKey(a, b, key, dir)
        if (cmp !== 0) return cmp
      }
      return 0
    })
    return list
  })

  function editTier(id: string, col: 'before' | 'after', value: string) {
    const next = new Map(tiers)
    const cur = next.get(id)!
    next.set(id, { ...cur, [col]: value })
    tiers = next
    dirty = new Set(dirty).add(id)
  }

  async function saveChanges() {
    if (!dirty.size) return
    saving = true
    statusMsg = ''
    const changes: Record<string, { before: string; after: string }> = {}
    for (const id of dirty) changes[id] = tiers.get(id)!
    try {
      const res = await fetch('/api/tier-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', changes }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        statusMsg = `Ошибка сохранения: ${err.error ?? res.status}`
      } else {
        dirty = new Set()
        statusMsg = 'Сохранено ✓'
        setTimeout(() => (statusMsg = ''), 3000)
      }
    } catch {
      statusMsg = 'Ошибка сети при сохранении'
    } finally {
      saving = false
    }
  }

  async function refreshTiers() {
    if (!confirm('Это перезапишет ОБЕ колонки (Тир до/после) у ВСЕХ мутантов текущими значениями из тир-листа сайта, включая несохранённые правки. Продолжить?')) return
    refreshing = true
    statusMsg = ''
    try {
      const res = await fetch('/api/tier-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        statusMsg = `Ошибка обновления: ${err.error ?? res.status}`
      } else {
        const data = await res.json()
        tiers = new Map(Object.entries(data.table))
        dirty = new Set()
        statusMsg = 'Тиры обновлены ✓'
        setTimeout(() => (statusMsg = ''), 3000)
      }
    } catch {
      statusMsg = 'Ошибка сети при обновлении'
    } finally {
      refreshing = false
    }
  }

  // Публикует текущую колонку "после" (tiers.get(id).after, включая
  // несохранённые в tier-table.json правки - это то, что реально видно в
  // таблице прямо сейчас) в mutants.json.tier на main. Сначала диф без
  // записи для подтверждения, потом отдельный запрос на сам коммит - см.
  // память tier-table-preview-pipeline про то, почему сюда нельзя тащить
  // билд-тайм импорт mutants.json (устареет относительно main).
  async function pushTiersToProd() {
    pushingProd = true
    statusMsg = ''
    const current: Record<string, string> = {}
    for (const [id, t] of tiers) current[id] = t.after
    try {
      const diffRes = await fetch('/api/tier-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tier-diff', tiers: current }),
      })
      if (!diffRes.ok) {
        const err = await diffRes.json().catch(() => ({}))
        statusMsg = `Ошибка расчёта диффа: ${err.error ?? diffRes.status}`
        return
      }
      const { diff } = await diffRes.json()
      const total = diff.set + diff.changed + diff.cleared
      if (total === 0) {
        statusMsg = 'В проде и так всё совпадает — нечего отправлять'
        return
      }
      const preview = diff.details
        .slice(0, 15)
        .map((d: { name: string; from: string; to: string }) => `${d.name}: ${d.from} → ${d.to}`)
        .join('\n')
      const more = diff.details.length > 15 ? `\n… и ещё ${diff.details.length - 15}` : ''
      const confirmed = confirm(
        `Отправить в прод (mutants.json, ветка main)?\n\nНовых тиров: ${diff.set}\nИзменено: ${diff.changed}\nСнято: ${diff.cleared}\n\n${preview}${more}`,
      )
      if (!confirmed) return
      const res = await fetch('/api/tier-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-to-prod', tiers: current }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        statusMsg = `Ошибка публикации: ${err.error ?? res.status}`
      } else {
        statusMsg = `Отправлено в прод ✓ (${total})`
        setTimeout(() => (statusMsg = ''), 4000)
      }
    } catch {
      statusMsg = 'Ошибка сети при публикации в прод'
    } finally {
      pushingProd = false
    }
  }

  let posterLoading = $state(false)
  // Язык постера - независим от языка самой /tier-table (эта страница всегда
  // на RU, это внутренний инструмент), постер же расходится дальше в паблик
  // на разных языках сайта.
  let posterLocale = $state('ru')
  const POSTER_LOCALES: Array<{ code: string; label: string }> = [
    { code: 'ru', label: 'RU' },
    { code: 'en', label: 'EN' },
    { code: 'es', label: 'ES' },
    { code: 'fr', label: 'FR' },
    { code: 'de', label: 'DE' },
    { code: 'pt', label: 'PT' },
    { code: 'it', label: 'IT' },
    { code: 'tr', label: 'TR' },
    { code: 'nl', label: 'NL' },
  ]

  // Постер собирается из текущего "после" (включая несохранённые правки в
  // таблице - та же логика источника данных, что и у "→ в прод"), сервер
  // берёт иконки/имена/гены сам из mutants.json по id, через URL летит только
  // компактный {id: тир} - см. tier-poster-render.astro.
  async function downloadPoster() {
    posterLoading = true
    statusMsg = ''
    try {
      const tiersOut: Record<string, string> = {}
      for (const [id, t] of tiers) if (t.after !== '-') tiersOut[id] = t.after
      const state = encodeURIComponent(JSON.stringify({ tiers: tiersOut }))
      const res = await fetch(`/api/tier-poster?state=${state}&locale=${posterLocale}`)
      if (!res.ok) {
        statusMsg = `Ошибка генерации постера: ${res.status}`
        return
      }
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `tier-poster-${posterLocale}.png`
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch {
      statusMsg = 'Ошибка сети при генерации постера'
    } finally {
      posterLoading = false
    }
  }

  function fmt(n: number): string {
    return n.toLocaleString('ru-RU')
  }
  function fmtAbility(n: number | null): string {
    return n != null && n > 0 ? n.toLocaleString('ru-RU') : '-'
  }
  function fmtDate(iso: string | null): string {
    if (!iso) return '-'
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }
  function sortIndicator(key: SortKey): string {
    const entry = sortHistory.find((s) => s.key === key)
    if (!entry) return ''
    const arrow = entry.dir === 'asc' ? '▲' : '▼'
    return sortHistory[0]?.key === key ? arrow : `${arrow}₂`
  }

  // Закрытие панели фильтра по клику вне её - иначе висит открытой, пока не
  // кликнут по её же кнопке ещё раз.
  $effect(() => {
    if (openFilter === null) return
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.filterable')) openFilter = null
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  })
</script>

<div class="toolbar">
  <div class="toolbar-left">
    <button class="btn" onclick={refreshTiers} disabled={refreshing}>
      {refreshing ? 'Обновляю…' : '↻ Обновить тиры'}
    </button>
    <button class="btn btn-primary" onclick={saveChanges} disabled={saving || dirty.size === 0}>
      {saving ? 'Сохраняю…' : `💾 Сохранить изменения${dirty.size ? ` (${dirty.size})` : ''}`}
    </button>
    <button class="btn" onclick={resetAll}>Сбросить всё</button>
    <span class="toolbar-sep"></span>
    <button class="btn btn-danger" onclick={pushTiersToProd} disabled={pushingProd}>
      {pushingProd ? 'Отправляю…' : '🚀 Тир после → в прод'}
    </button>
    <select class="btn" bind:value={posterLocale} title="Язык постера">
      {#each POSTER_LOCALES as pl}
        <option value={pl.code}>{pl.label}</option>
      {/each}
    </select>
    <button class="btn" onclick={downloadPoster} disabled={posterLoading}>
      {posterLoading ? 'Генерирую…' : '📸 Тир-постер'}
    </button>
    <span class="toolbar-sep"></span>
    {#each TOOLBAR_FILTER_DEFS as fd}
      <div class="filterable">
        <button class="btn filter-toolbar-btn" onclick={(e) => openToolbarFilter(e, fd.col)}>
          {fd.label} {#if filters[fd.col].size}<span class="filter-badge">{filters[fd.col].size}</span>{/if} ▾
        </button>
        {#if openFilter === fd.col && toolbarFilterPos}
          <div class="filter-pop filter-pop-fixed" style={`top:${toolbarFilterPos.top}px; left:${toolbarFilterPos.left}px;`}>
            {#each filterOptions(fd.col) as v}
              <label><input type="checkbox" checked={filters[fd.col].has(v)} onchange={() => toggleFilter(fd.col, v)} />{filterLabel(fd.col, v)}</label>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if statusMsg}<span class="status-msg">{statusMsg}</span>{/if}
  </div>
  <div class="toolbar-right">Показано: {sortedRows.length} / {rows.length}</div>
</div>

<div class="table-wrap">
  <table>
    <colgroup>
      <col style="width: 3%" />
      <col style="width: 3%" />
      <col style="width: 8%" />
      <col style="width: 6%" />
      <col style="width: 3.5%" />
      <col style="width: 6%" />
      <col style="width: 5%" />
      <col style="width: 6.5%" />
      <col style="width: 4%" />
      <col style="width: 4%" />
      <col style="width: 6%" />
      <col style="width: 6%" />
      <col style="width: 6.5%" />
      <col style="width: 6.5%" />
      <col style="width: 6%" />
      <col style="width: 4%" />
      <col style="width: 8%" />
      <col style="width: 8%" />
    </colgroup>
    <thead>
      <tr>
        <th class="sortable" onclick={() => setSort('number')}>№ {sortIndicator('number')}</th>
        <th>Иконка</th>
        <th>Имя</th>
        <th>Тип</th>
        <th class="sortable" onclick={() => setSort('releaseNumber')}>№2 {sortIndicator('releaseNumber')}</th>
        <th class="sortable" onclick={() => setSort('lastRebalance')}>Ребаланс {sortIndicator('lastRebalance')}</th>
        <th class="sortable" onclick={() => setSort('tierBefore')}>Тир до {sortIndicator('tierBefore')}</th>
        <th class="sortable" onclick={() => setSort('tierAfter')}>Тир после {sortIndicator('tierAfter')}</th>
        <th>Ген 1</th>
        <th>Ген 2</th>
        <th class="sortable" onclick={() => setSort('speed')}>Скорость {sortIndicator('speed')}</th>
        <th class="sortable" onclick={() => setSort('hp')}>HP {sortIndicator('hp')}</th>
        <th class="sortable" onclick={() => setSort('atk1')}>Атк1 {sortIndicator('atk1')}</th>
        <th class="sortable" onclick={() => setSort('atk2')}>Атк2 {sortIndicator('atk2')}</th>
        <th class="sortable filterable">
          <span onclick={() => setSort('abilityKey')}>Абилка {sortIndicator('abilityKey')}</span>
          <button class="filter-btn" onclick={(e) => { e.stopPropagation(); openFilter = openFilter === 'abilityKey' ? null : 'abilityKey' }}>▾</button>
          {#if openFilter === 'abilityKey'}
            <div class="filter-pop">
              {#each filterOptions('abilityKey') as v}
                <label><input type="checkbox" checked={filters.abilityKey.has(v)} onchange={() => toggleFilter('abilityKey', v)} />{filterLabel('abilityKey', v)}</label>
              {/each}
            </div>
          {/if}
        </th>
        <th class="sortable" onclick={() => setSort('abilityPct')}>% {sortIndicator('abilityPct')}</th>
        <th class="sortable" onclick={() => setSort('abilityAtk1')}>Аб.Атк1 {sortIndicator('abilityAtk1')}</th>
        <th class="sortable" onclick={() => setSort('abilityAtk2')}>Аб.Атк2 {sortIndicator('abilityAtk2')}</th>
      </tr>
    </thead>
    <tbody>
      {#each sortedRows as r (r.id)}
        {@const t = tiers.get(r.id)!}
        <tr class:dirty-row={dirty.has(r.id)}>
          <td class="num">{r.number}</td>
          <td class="icon-cell">
            {#if r.icon}<img src={textureUrl(r.icon)} alt="" loading="lazy" decoding="async" />{/if}
          </td>
          <td class="name-cell">{r.name}</td>
          <td class="type-cell">
            <span class="type-cell-inner">
              {#if getTypeIcon(r.type)}<img class="mini-ico" src={textureUrl(getTypeIcon(r.type))} alt="" loading="lazy" decoding="async" />{/if}
              <span>{TYPE_RU[r.type] ?? r.type}</span>
            </span>
          </td>
          <td class="num">{r.releaseNumber ?? '-'}</td>
          <td class="rebalance-cell">
            {#if r.lastRebalance}<a href="/rebalance">{fmtDate(r.lastRebalance)}</a>{:else}-{/if}
          </td>
          <td class="tier-cell" style={`background:${TIER_BG[t.before]}`}>
            <select value={t.before} onchange={(e) => editTier(r.id, 'before', (e.target as HTMLSelectElement).value)}>
              {#each TIER_OPTIONS as opt}<option value={opt}>{opt}</option>{/each}
            </select>
          </td>
          <td class="tier-cell" style={`background:${TIER_BG[t.after]}`}>
            <select value={t.after} onchange={(e) => editTier(r.id, 'after', (e.target as HTMLSelectElement).value)}>
              {#each TIER_OPTIONS as opt}<option value={opt}>{opt}</option>{/each}
            </select>
          </td>
          <td class="gene-cell">{#if getGeneIcon(r.gene1)}<img class="mini-ico" src={textureUrl(getGeneIcon(r.gene1))} alt={r.gene1} loading="lazy" decoding="async" />{/if}</td>
          <td class="gene-cell">{#if getGeneIcon(r.gene2)}<img class="mini-ico" src={textureUrl(getGeneIcon(r.gene2))} alt={r.gene2} loading="lazy" decoding="async" />{/if}</td>
          <td class="num">{r.speed}</td>
          <td class="num">{fmt(r.hp)}</td>
          <td class="num">
            <span class="atk-cell-inner">
              {#if getGeneIcon(r.atk1Gene)}<img class="mini-ico inline-ico" src={textureUrl(getGeneIcon(r.atk1Gene))} alt="" loading="lazy" decoding="async" />{/if}
              <span class:aoe-text={r.atk1Aoe} title={r.atk1Aoe ? 'Площадная атака' : undefined}>{fmt(r.atk1)}</span>
            </span>
          </td>
          <td class="num">
            <span class="atk-cell-inner">
              {#if getGeneIcon(r.atk2Gene)}<img class="mini-ico inline-ico" src={textureUrl(getGeneIcon(r.atk2Gene))} alt="" loading="lazy" decoding="async" />{/if}
              <span class:aoe-text={r.atk2Aoe} title={r.atk2Aoe ? 'Площадная атака' : undefined}>{fmt(r.atk2)}</span>
            </span>
          </td>
          <td class="ability-cell">
            {#if r.abilityKey && ABILITY_ICONS[r.abilityKey]}
              <img class="mini-ico" src={textureUrl(ABILITY_ICONS[r.abilityKey])} alt={r.abilityKey} title={ABILITY_RU[`ability_${r.abilityKey}_plus`] ?? r.abilityKey} loading="lazy" decoding="async" />
            {/if}
          </td>
          <td class="num">{r.abilityPct != null ? `${r.abilityPct}%` : '-'}</td>
          <td class="num">{fmtAbility(r.abilityAtk1)}</td>
          <td class="num">{fmtAbility(r.abilityAtk2)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  /* flex-wrap: nowrap намеренно - высота панели не должна расти на узких
     экранах, вместо переноса строк .toolbar-left скроллится по горизонтали
     (см. prompt_tablica_combined_final.md, A.1). */
  .toolbar { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.6rem; }
  .toolbar-left {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: nowrap;
    overflow-x: auto; overflow-y: hidden; min-width: 0; scrollbar-width: thin;
  }
  .toolbar-left .btn, .toolbar-left .status-msg, .toolbar-sep { flex-shrink: 0; }
  .toolbar-right { color: #64748b; font-size: 0.8rem; flex-shrink: 0; white-space: nowrap; }
  .btn { appearance: none; border: 1px solid rgba(255,255,255,0.12); background: rgba(22,27,34,0.9); color: #cbd5f5; border-radius: 6px; padding: 0.35rem 0.7rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
  .btn:hover:not(:disabled) { background: rgba(51,65,85,0.8); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: rgba(34,197,94,0.2); border-color: rgba(34,197,94,0.4); color: #86efac; }
  .btn-primary:hover:not(:disabled) { background: rgba(34,197,94,0.32); }
  .btn-danger { background: rgba(220,38,38,0.18); border-color: rgba(220,38,38,0.4); color: #fca5a5; }
  .btn-danger:hover:not(:disabled) { background: rgba(220,38,38,0.3); }
  .status-msg { font-size: 0.78rem; color: #93c5fd; }

  .table-wrap {
    max-height: 82vh; min-height: 320px; overflow: auto; border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px; background: rgba(13,17,23,0.94);
  }
  table { border-collapse: collapse; width: 100%; font-size: 0.74rem; table-layout: fixed; }
  thead th {
    position: sticky; top: 0; z-index: 2; background: #161b22; color: #94a3b8;
    text-align: left; padding: 0.3rem 0.4rem; font-weight: 700; white-space: nowrap;
    border-bottom: 1px solid rgba(255,255,255,0.12); border-right: 2px solid rgba(255,255,255,0.1); user-select: none;
  }
  th.sortable { cursor: pointer; }
  th.sortable:hover { color: #e2e8f0; }
  /* th.filterable сознательно БЕЗ position:relative - position:sticky на
     thead th уже создаёт containing block для абсолютно позиционированного
     .filter-pop. Явный relative здесь раньше перебивал sticky по специфичности
     (0,1,1) против (0,0,2) у `thead th`, из-за чего заголовки этих колонок не
     были закреплены при скролле - см. prompt_tablica_combined_final.md, A.3. */
  .filter-btn { appearance: none; border: none; background: transparent; color: #64748b; cursor: pointer; margin-left: 2px; font-size: 0.7rem; }
  .filter-btn:hover { color: #e2e8f0; }
  .filter-pop {
    position: absolute; top: 100%; left: 0; z-index: 5; background: #0d1117; border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px; padding: 0.35rem; display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto;
    box-shadow: 0 6px 18px rgba(0,0,0,0.5); white-space: nowrap;
  }
  .filter-pop label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; font-weight: 400; color: #cbd5f5; cursor: pointer; padding: 1px 3px; }
  .filter-pop label:hover { background: rgba(255,255,255,0.06); }

  /* Тулбар-версия .filterable (обёртка кнопок фильтра над таблицей) - ей, в
     отличие от th.filterable, нужен свой relative-контейнер под .filter-pop. */
  .toolbar-left .filterable { position: relative; }
  .filter-pop-fixed { position: fixed; top: auto; left: auto; }
  .toolbar-sep { width: 1px; align-self: stretch; background: rgba(255,255,255,0.1); margin: 0 0.1rem; }
  .filter-toolbar-btn { display: inline-flex; align-items: center; gap: 0.3rem; }
  .filter-badge {
    background: rgba(56,189,248,0.25); color: #7dd3fc; border-radius: 999px;
    padding: 0 0.35rem; font-size: 0.68rem; font-weight: 700; line-height: 1.4;
  }

  tbody td {
    padding: 0.15rem 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.04);
    border-right: 2px solid rgba(255,255,255,0.07); white-space: nowrap; color: #cbd5f5;
    overflow: hidden; text-overflow: ellipsis;
  }
  tbody tr:hover td { background: rgba(255,255,255,0.03); }
  tr.dirty-row td { box-shadow: inset 0 0 0 9999px rgba(96,165,250,0.05); }

  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .icon-cell img { width: 28px; height: 28px; object-fit: cover; border-radius: 4px; vertical-align: middle; }
  .name-cell { font-weight: 600; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; }
  .type-cell-inner { display: flex; align-items: center; gap: 0.3rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; }
  .rebalance-cell a { color: #60a5fa; text-decoration: none; }
  .rebalance-cell a:hover { text-decoration: underline; }

  .mini-ico { width: 14px; height: 14px; vertical-align: middle; object-fit: contain; }
  .gene-cell .mini-ico, .ability-cell .mini-ico { width: 19px; height: 19px; }
  .inline-ico { width: 16px; height: 16px; }
  .atk-cell-inner { display: inline-flex; align-items: center; gap: 3px; justify-content: flex-end; }
  .aoe-text { color: #f87171; }

  .gene-cell { text-align: center; }
  .ability-cell { text-align: center; }

  .tier-cell { padding: 0; text-align: center; }
  .tier-cell select {
    width: 100%; appearance: none; text-align: center; border: none; background: transparent; color: #f1f5f9;
    font-weight: 800; font-size: 0.74rem; padding: 0.15rem 0.2rem; cursor: pointer; text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }
  .tier-cell select:focus-visible { outline: 2px solid #38bdf8; outline-offset: -2px; }
  /* Нативный дропдаун <select> рендерит option-список ОС/браузером - без
     этого он белый на белом в тёмной теме (Chromium поддерживает стилизацию
     option, в отличие от большинства других элементов формы). */
  .tier-cell select option { background: #0d1117; color: #c9d1d9; }

  @media (max-width: 767px) {
    .table-wrap { max-height: 75vh; }
    table { font-size: 0.68rem; }
    .name-cell { max-width: 100px; }
  }
</style>
