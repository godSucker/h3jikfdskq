<script lang="ts">
  import mutantsRaw from '@/data/mutants/mutants.json'
  import orbsRaw from '@/data/materials/orbs.json'
  import { textureUrl } from '@/lib/texture-cdn'
  import { GENE_RU, ABILITY_RU } from '@/lib/mutant-dicts'
  import { maxLevelForHp, orbHpBonusPct } from '@/lib/pvp/battle-profile'
  import IconSelect from './IconSelect.svelte'

  interface SlotConfig {
    mutantId: string
    level: number
    star: 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
    basicOrbIds: (string | null)[]
    specialOrbId: string | null
  }

  let {
    title,
    slots = $bindable(),
    disableLevelInputs = false,
  }: { title: string; slots: SlotConfig[]; disableLevelInputs?: boolean } = $props()

  // Пресеты команд - общий список на localStorage (не привязан к стороне мои/оппонент,
  // это просто "сборка из 3 мутантов", годная для любой из двух TeamBuilder-карточек).
  const PRESETS_KEY = 'mgg-pvp-team-presets'
  interface TeamPreset {
    name: string
    slots: SlotConfig[]
  }
  let presets = $state<TeamPreset[]>([])
  let newPresetName = $state('')
  let selectedPresetName = $state('')

  // "Активен" - выбранный в дропдауне пресет ДЕЙСТВИТЕЛЬНО совпадает с текущей
  // сборкой прямо сейчас (не просто был когда-то загружен и с тех пор мог
  // разъехаться после ручных правок слотов).
  let activePresetName = $derived.by(() => {
    if (!selectedPresetName) return null
    const preset = presets.find((p) => p.name === selectedPresetName)
    if (!preset) return null
    const same = JSON.stringify($state.snapshot(slots)) === JSON.stringify(preset.slots)
    return same ? preset.name : null
  })

  function loadPresetsFromStorage() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY)
      presets = raw ? JSON.parse(raw) : []
    } catch {
      presets = [] // битый JSON в сторадже - не роняем страницу, просто пустой список
    }
  }

  // localStorage недоступен при SSR (client:load рендерит разметку и на сервере) -
  // $effect гарантированно выполняется только в браузере после гидрации.
  $effect(() => {
    loadPresetsFromStorage()
  })

  function persistPresets() {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  }

  function savePreset() {
    const name = newPresetName.trim()
    if (!name) return
    // slots - Svelte 5 $state-прокси, structuredClone на нём падает ("could not be
    // cloned") - $state.snapshot() уже сам по себе возвращает обычный плоский клон.
    const snapshot: TeamPreset = { name, slots: $state.snapshot(slots) }
    const idx = presets.findIndex((p) => p.name === name)
    if (idx >= 0) presets[idx] = snapshot
    else presets = [...presets, snapshot]
    persistPresets()
    selectedPresetName = name
    newPresetName = ''
  }

  function loadPreset() {
    const preset = presets.find((p) => p.name === selectedPresetName)
    if (!preset) return
    // preset пришёл из presets ($state-массив) - тот же прокси-гочтя, что и в savePreset.
    const cloned = $state.snapshot(preset.slots)
    slots.splice(0, slots.length, ...cloned)
    search = cloned.map(() => '')
    searchOpen = cloned.map(() => false)
  }

  function deletePreset() {
    if (!selectedPresetName) return
    presets = presets.filter((p) => p.name !== selectedPresetName)
    persistPresets()
    selectedPresetName = ''
  }

  const MUTANTS = mutantsRaw as any[]
  const MUTANT_MAP = new Map(MUTANTS.map((m) => [String(m.id), m]))
  const MUTANT_OPTIONS = MUTANTS.map((m) => ({ id: m.id, name: m.name || m.id })).sort((a, b) =>
    a.name.localeCompare(b.name, 'ru')
  )

  // orb_basic_xp* - бонус к получаемому опыту, не влияет на бой (нет боевого
  // эффекта в PvP-симуляторе) - убраны из выбора, чтобы не путать пользователя.
  const BASIC_ORBS = (orbsRaw as any[]).filter(
    (o) =>
      !String(o.id).includes('ephemeral') &&
      String(o.id).startsWith('orb_basic') &&
      !String(o.id).startsWith('orb_basic_xp')
  )
  const SPECIAL_ORBS = (orbsRaw as any[]).filter(
    (o) => !String(o.id).includes('ephemeral') && String(o.id).startsWith('orb_special')
  )
  const orbIcon = (id: string | null, kind: 'basic' | 'special'): string | null =>
    id ? `/orbs/${kind}/${id}.webp` : null

  const STAR_ORDER: SlotConfig['star'][] = ['normal', 'bronze', 'silver', 'gold', 'platinum']
  // Приоритет для дефолта - лучшая доступная звезда мутанта, не первая по алфавиту/порядку.
  const STAR_PRIORITY: SlotConfig['star'][] = ['platinum', 'gold', 'silver', 'bronze', 'normal']
  const STAR_LABEL: Record<SlotConfig['star'], string> = {
    normal: 'Без звезды',
    bronze: 'Бронза',
    silver: 'Серебро',
    gold: 'Золото',
    platinum: 'Платина',
  }
  const STAR_ICON: Record<SlotConfig['star'], string> = {
    normal: '/stars/no_stars.webp',
    bronze: '/stars/star_bronze.webp',
    silver: '/stars/star_silver.webp',
    gold: '/stars/star_gold.webp',
    platinum: '/stars/star_platinum.webp',
  }

  /** Не у всех мутантов есть все 5 звёзд (105 - только "normal", 12 - только "platinum" и т.п.,
   *  см. mutants.json) - показывать нужно только реально доступные, иначе выбор молча
   *  деградирует до multiplier=1.0 (см. buildBattleUnit: `?? 1.0` фоллбэк). */
  function availableStars(mutant: any): SlotConfig['star'][] {
    const keys = new Set(Object.keys(mutant?.stars || {}))
    return STAR_ORDER.filter((s) => keys.has(s))
  }

  function bestStar(mutant: any): SlotConfig['star'] {
    const avail = new Set(availableStars(mutant))
    return STAR_PRIORITY.find((s) => avail.has(s)) || 'normal'
  }

  function abilityLabel(name: string | undefined): string | null {
    if (!name) return null
    return ABILITY_RU[name] || ABILITY_RU[name.toLowerCase()] || null
  }

  /** ability_regen -> ability_regenerate.webp - единственное расхождение имени
   *  способности и её файла иконки (см. тот же хелпер в StatsCalculator.svelte). */
  function abilityIconPath(name: string): string {
    const stripped = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/_plus$/, '')
    return stripped === 'ability_regen' ? '/ability/ability_regenerate.webp' : `/ability/${stripped}.webp`
  }

  function genesOf(mutant: any): string[] {
    if (!mutant || !Array.isArray(mutant.genes)) return []
    // Показываем гены как есть, без дедупликации (по прямому запросу пользователя) -
    // даже если genes: ["C","C"], оба элемента отображаются.
    return mutant.genes
      .map((g: string) => String(g || '').toUpperCase())
      .filter((g: string) => GENE_RU[g])
  }

  // Приглушённые бейджи (bg с прозрачностью + ring), не сплошная заливка - тот же
  // паттерн, что STAR_COLOR в mutant-dicts.ts, а не "едкий" solid-цвет.
  const TIER_CLASS: Record<string, string> = {
    '1': 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40',
    '2': 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40',
    '3': 'bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/40',
    '4': 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40',
  }

  function tierClass(tier: string | undefined): string {
    const main = String(tier || '').replace(/[+-]$/, '')
    return TIER_CLASS[main] || 'bg-slate-700/40 text-slate-300 ring-1 ring-slate-500/40'
  }

  // Поиск мутанта - отдельное текстовое состояние на слот, не привязано к slot.mutantId
  // напрямую (иначе выбор перезаписывался бы при каждом наборе символа).
  let search = $state<string[]>(slots.map(() => ''))
  let searchOpen = $state<boolean[]>(slots.map(() => false))

  function filteredOptions(i: number) {
    const q = search[i]?.trim().toLowerCase()
    if (!q) return MUTANT_OPTIONS.slice(0, 8)
    return MUTANT_OPTIONS.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 8)
  }

  function normalOrbSlots(mutant: any): number {
    const n = Number(mutant?.orbs?.normal)
    return Number.isFinite(n) && n > 0 ? n : 1
  }

  function hasSpecialOrbSlot(mutant: any): boolean {
    return Number(mutant?.orbs?.special) > 0
  }

  /** Реального лимита 30 в игре нет - настоящий потолок это int32-переполнение HP
   *  (см. /guides "Скрытые лимиты чисел"), индивидуальное на мутанта - зависит от
   *  hp_base, звезды и HP-орбов. Совпадает с клампом в buildBattleUnit, просто
   *  считается тут же для UI-подсказки max у инпута уровня. */
  function maxLevel(mutant: any, star: SlotConfig['star'], slot: SlotConfig): number {
    if (!mutant) return 1
    const starMul = mutant.stars?.[star]?.multiplier ?? 1.0
    const hpBase = Number(mutant.base_stats?.hp_base) || 0
    const hpOrbPct = orbHpBonusPct({ basicOrbIds: slot.basicOrbIds, specialOrbId: slot.specialOrbId })
    return maxLevelForHp(hpBase * starMul * (1 + hpOrbPct / 100))
  }

  // Кап уровня зависит от мутанта/звезды/HP-орбов и может ПОНИЗИТЬСЯ после того,
  // как уровень уже был выставлен (смена звезды на более сильную, добавление
  // HP-орба, смена самого мутанта) - buildBattleUnit молча клэмпит level при
  // сборке боя, но инпут в UI без этого продолжал бы показывать невалидное число,
  // расходящееся с тем, что реально пойдёт в бой. Один эффект на все слоты и все
  // источники инвалидации, а не точечные проверки в каждом обработчике.
  $effect(() => {
    for (const slot of slots) {
      const mutant = MUTANT_MAP.get(slot.mutantId)
      if (!mutant) continue
      const cap = maxLevel(mutant, slot.star, slot)
      // !(level >= 1) вместо level < 1 - тем же условием ловит и NaN (пустой/
      // стёртый инпут), не только отрицательные/нулевые значения.
      if (!(slot.level >= 1)) slot.level = 1
      else if (slot.level > cap) slot.level = cap
    }
  })

  function pickMutant(i: number, id: string) {
    const mutant = MUTANT_MAP.get(id)
    slots[i].mutantId = id
    // Звезда/орбы могут стать невалидными для нового мутанта (другой набор звёзд,
    // другое число орб-слотов) - подгоняем сразу, а не оставляем молча сломанными.
    if (!availableStars(mutant).includes(slots[i].star)) {
      slots[i].star = bestStar(mutant)
    }
    const orbCount = normalOrbSlots(mutant)
    slots[i].basicOrbIds = Array.from({ length: orbCount }, (_, idx) => slots[i].basicOrbIds[idx] ?? null)
    if (!hasSpecialOrbSlot(mutant)) {
      slots[i].specialOrbId = null
    }
    searchOpen[i] = false
    search[i] = ''
  }
</script>

<div class="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-4 backdrop-blur">
  <h2 class="text-sky-100 font-bold mb-3">{title}</h2>

  <div class="mb-4 rounded-xl border border-slate-700/50 bg-slate-950/40 p-3 text-xs">
    <div class="flex flex-wrap items-center gap-2">
      <input
        type="text"
        placeholder="Название пресета..."
        bind:value={newPresetName}
        class="rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1 min-w-0 flex-1 basis-24"
      />
      <button
        type="button"
        onclick={savePreset}
        disabled={!newPresetName.trim()}
        class="px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shrink-0"
      >
        Сохранить
      </button>
      {#if presets.length}
        <select
          bind:value={selectedPresetName}
          class="rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1 min-w-0 max-w-32"
        >
          <option value="">Выбрать пресет...</option>
          {#each presets as p (p.name)}
            <option value={p.name}>{p.name}</option>
          {/each}
        </select>
        <button
          type="button"
          onclick={loadPreset}
          disabled={!selectedPresetName}
          class="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white shrink-0"
        >
          Загрузить
        </button>
        <button
          type="button"
          onclick={deletePreset}
          disabled={!selectedPresetName}
          class="px-2 py-1 rounded-lg bg-rose-700/80 hover:bg-rose-600 disabled:opacity-50 text-white shrink-0"
        >
          Удалить
        </button>
      {/if}
    </div>
    {#if activePresetName}
      <!-- Отдельная строка, не часть flex-wrap выше - бейдж с произвольной длиной
           названия пресета иначе отжимал flex-1 инпут ввода до нечитаемой ширины. -->
      <div class="mt-2">
        <span
          class="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
        >
          ✓ Активен: {activePresetName}
        </span>
      </div>
    {/if}
  </div>

  <div class="space-y-4">
    {#each slots as slot, i (i)}
      {@const mutant = MUTANT_MAP.get(slot.mutantId)}
      {@const portrait = mutant?.stars?.[slot.star]?.images?.[0] || mutant?.stars?.normal?.images?.[0]}
      {@const genes = mutant ? genesOf(mutant) : []}
      {@const ability = abilityLabel(mutant?.abilities?.[0]?.name)}
      {@const levelCap = maxLevel(mutant, slot.star, slot)}
      <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 p-3 space-y-3">
        <div class="flex gap-3">
          {#if portrait}
            <img
              src={textureUrl(portrait)}
              alt={mutant?.name || ''}
              loading="lazy"
              class="w-16 h-16 rounded-lg object-cover border border-slate-700/60 bg-slate-900/60 shrink-0"
            />
          {:else}
            <div
              class="w-16 h-16 rounded-lg border border-slate-700/60 bg-slate-900/60 shrink-0 flex items-center justify-center text-slate-600 text-xs"
            >
              ?
            </div>
          {/if}
          <div class="min-w-0 flex-1 space-y-1">
            <div class="relative">
              <input
                type="text"
                placeholder={searchOpen[i] ? 'Начните вводить имя...' : mutant ? mutant.name : `Мутант ${i + 1}...`}
                bind:value={search[i]}
                onfocus={() => (searchOpen[i] = true)}
                onblur={() => setTimeout(() => (searchOpen[i] = false), 150)}
                class="w-full rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 text-sm px-2 py-1.5"
              />
              {#if searchOpen[i]}
                <ul
                  class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-900 shadow-xl"
                >
                  {#each filteredOptions(i) as opt (opt.id)}
                    <li>
                      <button
                        type="button"
                        onmousedown={(e) => e.preventDefault()}
                        onclick={() => pickMutant(i, opt.id)}
                        class="w-full text-left px-2 py-1.5 text-sm text-sky-100 hover:bg-sky-600/30"
                      >
                        {opt.name}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
            {#if mutant}
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sky-300/80">
                {#if genes.length}
                  <span class="inline-flex items-center gap-0.5">
                    {#each genes as gene (gene)}
                      <img
                        src={textureUrl(`/genes/icon_gene_${gene.toLowerCase()}.webp`)}
                        alt={GENE_RU[gene] || gene}
                        title={GENE_RU[gene] || gene}
                        class="w-4 h-4"
                      />
                    {/each}
                  </span>
                {/if}
                {#if mutant.tier}
                  <span class={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${tierClass(mutant.tier)}`}>
                    Тир {mutant.tier}
                  </span>
                {/if}
                {#if ability}
                  <span class="inline-flex items-center gap-1">
                    <img src={textureUrl(abilityIconPath(mutant.abilities[0].name))} alt="" class="w-4 h-4" />
                    {ability}
                  </span>
                {/if}
              </div>
              <div class="text-[11px] text-sky-400/70 truncate">
                {mutant.name_attack1 || 'Атака 1'} · {mutant.name_attack2 || 'Атака 2'}
              </div>
            {/if}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-sky-300/70 text-xs">
              {disableLevelInputs ? 'Уровень (задан диапазоном ниже)' : `Уровень (макс. ${levelCap})`}
            </span>
            <input
              type="number"
              min="1"
              max={levelCap}
              bind:value={slot.level}
              disabled={disableLevelInputs}
              class="mt-1 w-full rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 text-sm px-2 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </label>
          <label class="block">
            <span class="text-sky-300/70 text-xs">Звезда</span>
            <div class="mt-1">
              <IconSelect
                bind:value={slot.star}
                options={availableStars(mutant).map((s) => ({ value: s, label: STAR_LABEL[s], icon: STAR_ICON[s] }))}
              />
            </div>
          </label>
        </div>

        <div class="grid grid-cols-3 gap-2">
          {#each Array.from({ length: normalOrbSlots(mutant) }) as _, slotIdx (slotIdx)}
            <label class="block">
              <span class="text-sky-300/70 text-xs">Сфера {slotIdx + 1}</span>
              <div class="mt-1">
                <IconSelect
                  bind:value={slot.basicOrbIds[slotIdx]}
                  options={[
                    { value: null, label: '—', icon: null },
                    ...BASIC_ORBS.map((o) => ({ value: o.id, label: o.name, icon: orbIcon(o.id, 'basic') })),
                  ]}
                />
              </div>
            </label>
          {/each}
        </div>

        {#if hasSpecialOrbSlot(mutant)}
          <label class="block">
            <span class="text-sky-300/70 text-xs">Спец-сфера</span>
            <div class="mt-1">
              <IconSelect
                bind:value={slot.specialOrbId}
                options={[
                  { value: null, label: '—', icon: null },
                  ...SPECIAL_ORBS.map((o) => ({ value: o.id, label: o.name, icon: orbIcon(o.id, 'special') })),
                ]}
              />
            </div>
          </label>
        {/if}
      </div>
    {/each}
  </div>
</div>
