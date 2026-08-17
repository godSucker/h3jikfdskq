<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn'
  import { groupOrbsByCategory, type CatalogOrb } from '@/lib/pvp/orb-catalog'
  import { t, type Locale } from '@/lib/i18n'

  let {
    value = $bindable(),
    options,
    slotBg,
    label,
    locale = 'ru' as Locale,
  }: {
    value: string | null
    options: CatalogOrb[]
    slotBg: string
    label: string
    locale?: Locale
  } = $props()

  let open = $state(false)
  let selected = $derived(options.find((o) => o.id === value) ?? null)
  let isSpecial = $derived(slotBg.includes('special'))
  let groups = $derived(groupOrbsByCategory(options, isSpecial ? 'special' : 'basic', locale))
  // Списки внутри категорий сворачиваемые, по умолчанию свёрнуты - тот же
  // приём, что collapsedCats в StatsCalculator.svelte (юзер явно попросил
  // повторить паттерн, 2026-08-17). Ключ - cat.key, общий Set на весь пикер
  // (открытые категории не переживают закрытие дропдауна - намеренно, как
  // и в стат-калькуляторе).
  let openCats = $state(new Set<string>())
  function toggleCat(key: string) {
    const next = new Set(openCats)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    openCats = next
  }
  // Рамка спец-слота (orb_slot_spe.webp) толще и золотая - "окошко" под сферу заметно
  // меньше, чем у обычного слота (orb_slot.webp), хотя оба png одного размера. Одинаковый
  // размер иконки для обеих даёт на спец-слоте сферу внахлёст на золотую рамку - криво.
  // ВАЖНО: явные w/h, а не position:absolute+inset-X% на самом img - Tailwind preflight
  // ставит img{height:auto}, из-за чего inset-проценты игнорируются и картинка рендерится
  // на весь родительский квадрат (проверено getBoundingClientRect - inset давал 5px со всех
  // сторон в computed style, но фактический бокс всё равно был полные 44×44, без сжатия).
  let iconSizeClass = $derived(isSpecial ? 'w-[90%] h-[90%]' : 'w-[94%] h-[94%]')

  function pick(id: string | null) {
    value = id
    open = false
  }
</script>

<div class="relative inline-block">
  <button
    type="button"
    onclick={() => (open = !open)}
    title={label}
    class="relative w-11 h-11 rounded-lg overflow-hidden border-none bg-transparent p-0 shrink-0"
  >
    <img src={textureUrl(slotBg)} alt="" class="w-full h-full object-cover" />
    {#if selected}
      <img
        src={textureUrl(selected.icon)}
        alt={selected.name}
        class={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${iconSizeClass} object-contain`}
      />
    {/if}
  </button>
  {#if selected}
    <button
      type="button"
      title={t('pvp.orb.remove', locale)}
      onclick={() => pick(null)}
      class="absolute -right-1.5 -top-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] leading-4 z-10"
    >
      ×
    </button>
  {/if}

  {#if open}
    <button
      type="button"
      aria-label={t('pvp.orb.close', locale)}
      onclick={() => (open = false)}
      class="fixed inset-0 z-40 cursor-default bg-black/70"
    ></button>
    <div
      class="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 max-w-[90vw] max-h-[55vh] overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 p-3 shadow-2xl"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-sky-100 text-sm font-semibold">{label}</span>
        <button type="button" onclick={() => (open = false)} class="text-slate-400 hover:text-slate-200 text-lg leading-none">×</button>
      </div>
      {#if options.length === 0}
        <div class="text-sky-300/60 text-xs px-1 py-2">{t('pvp.orb.none', locale)}</div>
      {/if}
      {#each groups as cat (cat.key)}
        <button
          type="button"
          onclick={() => toggleCat(cat.key)}
          aria-expanded={openCats.has(cat.key)}
          class="w-full mt-1.5 mb-1 flex items-center gap-1.5 px-1 py-0.5 rounded text-xs font-bold uppercase tracking-wide text-sky-200/80 hover:bg-sky-600/15"
        >
          <span class="w-3 text-center shrink-0">{openCats.has(cat.key) ? '▾' : '▸'}</span>
          <img src={textureUrl(cat.icon)} alt="" class="w-5 h-5 object-contain" />
          <span>{cat.label}</span>
          <span class="ml-auto text-slate-500 font-normal">{cat.items.length}</span>
        </button>
        {#if openCats.has(cat.key)}
          {#each cat.items as o (o.id)}
            <button
              type="button"
              onclick={() => pick(o.id)}
              class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sky-100 text-sm hover:bg-sky-600/30"
            >
              <img src={textureUrl(o.icon)} alt="" class="w-8 h-8 object-contain shrink-0" />
              <span class="truncate">{o.name}</span>
            </button>
          {/each}
        {/if}
      {/each}
    </div>
  {/if}
</div>
