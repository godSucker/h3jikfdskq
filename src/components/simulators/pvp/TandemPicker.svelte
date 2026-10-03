<script lang="ts">
  import mutantsRaw from '@/data/mutants/mutants.json'
  import { textureUrl } from '@/lib/texture-cdn'
  import { maxLevelForHp } from '@/lib/stats/unified-calculator'
  import { buildTandemUnit, strongestTandem, type TandemConfig, type TandemStar } from '@/lib/pvp/tandem'
  import IconSelect from './IconSelect.svelte'
  import { t, type Locale } from '@/lib/i18n'
  import type { MutantNameEntry } from '@/lib/mutant-names-i18n'

  let {
    config = $bindable(),
    locale = 'ru' as Locale,
    names = {},
  }: {
    config: TandemConfig | null
    locale?: Locale
    names?: Record<string, MutantNameEntry>
  } = $props()

  const MUTANTS = mutantsRaw as any[]
  const MUTANT_MAP = new Map(MUTANTS.map((m) => [String(m.id), m]))
  const STAR_ORDER: TandemStar[] = ['normal', 'bronze', 'silver', 'gold', 'platinum']
  const STAR_PRIORITY: TandemStar[] = ['platinum', 'gold', 'silver', 'bronze', 'normal']
  const STAR_ICON: Record<TandemStar, string> = {
    normal: '/stars/no_stars.webp',
    bronze: '/stars/star_bronze.webp',
    silver: '/stars/star_silver.webp',
    gold: '/stars/star_gold.webp',
    platinum: '/stars/star_platinum.webp',
  }
  let STAR_LABEL = $derived<Record<TandemStar, string>>({
    normal: t('pvp.star.none', locale),
    bronze: t('pvp.star.bronze', locale),
    silver: t('pvp.star.silver', locale),
    gold: t('pvp.star.gold', locale),
    platinum: t('pvp.star.platinum', locale),
  })

  function getName(id: string): string {
    return (locale !== 'ru' && names[id]?.name) || MUTANT_MAP.get(id)?.name || id
  }

  const OPTIONS = MUTANTS.map((m) => ({ id: String(m.id), name: getName(String(m.id)) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  )

  let search = $state('')
  let open = $state(false)
  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase()
    return (q ? OPTIONS.filter((o) => o.name.toLowerCase().includes(q)) : OPTIONS).slice(0, 8)
  })

  let mutant = $derived(config ? MUTANT_MAP.get(config.mutantId) : null)
  let stars = $derived(STAR_ORDER.filter((s) => mutant?.stars?.[s]))
  let levelCap = $derived(
    mutant
      ? maxLevelForHp(
          (Number(mutant.base_stats?.hp_base) || 0) * (mutant.stars?.[config!.star]?.multiplier ?? 1),
        )
      : 1,
  )
  let atk1 = $derived(config ? buildTandemUnit(config, 'mine').atk1 : 0)

  function pick(id: string) {
    const m = MUTANT_MAP.get(id)
    const star = STAR_PRIORITY.find((s) => m?.stars?.[s]) ?? 'normal'
    config = { mutantId: id, star, level: config?.level ?? 30 }
    search = ''
    open = false
  }

  function oneshot() {
    config = { ...strongestTandem() }
    search = ''
    open = false
  }

  // Keep level inside the mutant's own cap whenever star/mutant change (same idea as TeamBuilder).
  $effect(() => {
    if (!config) return
    const next = !(config.level >= 1) ? 1 : Math.min(config.level, levelCap)
    if (next !== config.level) config.level = next
  })
</script>

<div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
  <div class="flex items-center justify-between gap-2">
    <span class="text-amber-200 font-semibold text-sm">✦ {t('pvp.tandem.title', locale)}</span>
    <div class="flex gap-2">
      <button
        type="button"
        onclick={oneshot}
        title={t('pvp.tandem.oneshotTitle', locale)}
        class="min-h-9 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-600/80 hover:bg-amber-500 text-white ring-1 ring-white/10"
      >
        ⚡ {t('pvp.tandem.oneshot', locale)}
      </button>
      {#if config}
        <button
          type="button"
          onclick={() => (config = null)}
          class="min-h-9 px-3 py-1 rounded-lg text-xs bg-slate-700 hover:bg-slate-600 text-white"
        >
          {t('pvp.tandem.remove', locale)}
        </button>
      {/if}
    </div>
  </div>

  <div class="flex gap-3">
    {#if mutant}
      <img
        src={textureUrl(mutant.stars?.[config!.star]?.images?.[0] || mutant.stars?.normal?.images?.[0] || '')}
        alt={getName(mutant.id)}
        loading="lazy"
        class="w-14 h-14 rounded-lg object-cover border border-slate-700/60 bg-slate-900/60 shrink-0"
      />
    {/if}
    <div class="min-w-0 flex-1 space-y-1">
      <div class="relative">
        <input
          type="text"
          placeholder={mutant ? getName(mutant.id) : t('pvp.tandem.pick', locale)}
          bind:value={search}
          onfocus={() => (open = true)}
          onblur={() => setTimeout(() => (open = false), 150)}
          class="w-full rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 text-base md:text-sm px-2 py-1.5"
        />
        {#if open}
          <ul class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-900 shadow-xl">
            {#each filtered as opt (opt.id)}
              <li>
                <button
                  type="button"
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => pick(opt.id)}
                  class="w-full text-left px-2 py-2.5 md:py-1.5 text-base md:text-sm text-sky-100 hover:bg-sky-600/30"
                >
                  {opt.name}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if config}
        <div class="text-[11px] text-amber-200/80">⚔ {atk1}</div>
      {:else}
        <div class="text-[11px] text-slate-500">{t('pvp.tandem.empty', locale)}</div>
      {/if}
    </div>
  </div>

  {#if config && mutant}
    <div class="grid grid-cols-2 gap-2">
      <label class="block">
        <span class="text-sky-300/70 text-xs">{t('pvp.level.label', locale).replace('{n}', String(levelCap))}</span>
        <input
          type="number"
          min="1"
          max={levelCap}
          bind:value={config.level}
          class="mt-1 w-full rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 text-base md:text-sm px-2 py-1.5"
        />
      </label>
      <div class="block">
        <span class="text-sky-300/70 text-xs">{t('pvp.star.label', locale)}</span>
        <div class="mt-1">
          <IconSelect
            bind:value={config.star}
            options={stars.map((s) => ({ value: s, label: STAR_LABEL[s], icon: STAR_ICON[s] }))}
          />
        </div>
      </div>
    </div>
  {/if}

  <p class="text-[11px] text-slate-400 leading-snug">{t('pvp.tandem.hint', locale)}</p>
</div>
