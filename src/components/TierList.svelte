<script lang="ts">
  import { sortMutantsByGene } from '@/lib/mutant-sort'
  import { textureUrl } from '@/lib/texture-cdn'
  import { baseMutantId as baseId, buildSkinLookup } from '@/lib/utils'
  import { t, pluralizeCount, type Locale } from '@/lib/i18n'
  import MutantModal from './MutantModal.svelte'
  import skinsData from '@/data/mutants/skins.json'

  let {
    mutants = [],
    locale = 'ru' as Locale,
    names = {} as Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>,
    obtainNames = {} as Record<string, string>,
  }: {
    mutants: any[]
    locale?: Locale
    names?: Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>
    obtainNames?: Record<string, string>
  } = $props()

  // Тот же приём, что MutantsBrowser.svelte: mutants.json остаётся
  // RU-каноном, names[] - сиблинг-словарь официальных переводов по id.
  function displayName(m: any): string {
    return names[m?.id]?.name || m?.name || ''
  }

  const skinLookup = buildSkinLookup((skinsData as any)?.specimens ?? [])

  const MAIN_TIERS = ['1', '2', '3', '4']

  const SUB_ORDER: Record<string, string[]> = {
    '1': ['1+', '1', '1-'],
    '2': ['2+', '2', '2-'],
    '3': ['3+', '3', '3-'],
    '4': ['4'],
  }

  const TIER_COLORS: Record<string, { border: string; bg: string; headerBg: string; subText: string }> = {
    '1': { border: 'border-red-500', bg: 'bg-[#141922]', headerBg: 'bg-red-600', subText: 'text-red-300' },
    '2': { border: 'border-orange-500', bg: 'bg-[#141922]', headerBg: 'bg-orange-600', subText: 'text-orange-300' },
    '3': { border: 'border-yellow-500', bg: 'bg-[#141922]', headerBg: 'bg-yellow-600', subText: 'text-yellow-300' },
    '4': { border: 'border-green-500', bg: 'bg-[#141922]', headerBg: 'bg-green-600', subText: 'text-green-300' },
  }

  // '+' - верх подтира, '-' - низ, без суффикса - середина (см. SUB_ORDER выше).
  function subLabel(subTier: string): string {
    if (subTier.endsWith('+')) return t('tierList.sub.top', locale)
    if (subTier.endsWith('-')) return t('tierList.sub.bottom', locale)
    return t('tierList.sub.mid', locale)
  }

  function groupByTier(list: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {}
    for (const m of list) {
      const t = String(m.tier ?? '').trim()
      if (!t) continue
      if (!groups[t]) groups[t] = []
      groups[t].push(m)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort(sortMutantsByGene)
    }
    return groups
  }

  const grouped = $derived(groupByTier(mutants))

  let modalOpen = $state(false)
  let selectedMutant: any = $state(null)
  let selectedStar = $state('normal')
  let selectedSkins: any[] = $state([])

  function openModal(m: any) {
    selectedMutant = m
    if (m.stars) {
      const available = ['platinum', 'gold', 'silver', 'bronze', 'normal']
      selectedStar = available.find(s => m.stars[s]) || 'normal'
    } else {
      selectedStar = 'normal'
    }
    selectedSkins = skinLookup.get(baseId(m.id)) ?? []
    modalOpen = true
  }

  function closeModal() {
    modalOpen = false
    selectedMutant = null
    selectedSkins = []
  }

  const STAR_ORDER = ['platinum', 'gold', 'silver', 'bronze', 'normal'] as const

  const GENE_COLORS: Record<string, string> = {
    A: '#c8a200',
    B: '#5a7a1a',
    C: '#a04040',
    D: '#a07228',
    E: '#3a6aa8',
    F: '#7b4fa0',
  }

  function primaryGene(m: any): string {
    const genes = m.genes
    if (Array.isArray(genes) && genes.length > 0) return String(genes[0]).toUpperCase()
    return ''
  }

  function geneColor(m: any): string {
    return GENE_COLORS[primaryGene(m)] ?? '#555'
  }

  function specimenSrc(m: any): string {
    const id = String(m.id ?? '')
    const base = id
      .replace(/^specimen[_-]/i, '')
      .replace(/_(normal|bronze|silver|gold|plat.*)$/i, '')
      .toLowerCase()

    let star = 'normal'
    if (m.stars) {
      for (const s of STAR_ORDER) {
        if (m.stars[s]) { star = s; break }
      }
    }

    return textureUrl(`/textures_by_mutant/${base}/specimen_${base}_${star}.webp`)
  }

  function specimenFallback(m: any): string {
    const id = String(m.id ?? '')
    const base = id
      .replace(/^specimen[_-]/i, '')
      .replace(/_(normal|bronze|silver|gold|plat.*)$/i, '')
      .toLowerCase()
    return textureUrl(`/textures_by_mutant/${base}/specimen_${base}_normal.webp`)
  }
</script>

<div class="space-y-2 sm:space-y-3">
  {#each MAIN_TIERS as mainTier}
    {@const subs = SUB_ORDER[mainTier] ?? [mainTier]}
    {@const colors = TIER_COLORS[mainTier]}
    {@const hasAny = subs.some(s => grouped[s]?.length > 0)}
    {@const tierCount = subs.reduce((sum, s) => sum + (grouped[s]?.length ?? 0), 0)}

    {#if hasAny}
      <section class="rounded-xl border-2 {colors.border} {colors.bg} overflow-hidden">
        <div class="flex items-center gap-2 px-2 sm:px-3 py-1.5 sm:py-2 {colors.headerBg}">
          <span class="text-sm sm:text-base font-extrabold text-white tracking-wide">{t('tierList.tierLabel', locale)} {mainTier}</span>
          <span class="text-[10px] sm:text-xs text-slate-300">
            {tierCount} {pluralizeCount(tierCount, locale)}
          </span>
        </div>

        {#each subs as subTier, subIdx}
          {@const list = grouped[subTier] ?? []}
          {@const isLast = subIdx === subs.length - 1}
          {#if list.length > 0}
            <div class="px-1.5 sm:px-3 pt-1 sm:pt-1.5 {isLast ? 'pb-1.5 sm:pb-2' : 'pb-0'}">
              {#if subs.length > 1}
                <div class="flex items-center gap-1.5 mb-0.5 sm:mb-1">
                  <span class="text-[10px] sm:text-[11px] font-bold {colors.subText} opacity-80 uppercase tracking-wider">
                    {subTier}
                  </span>
                  <span class="text-[9px] sm:text-[10px] text-slate-400">
                    {subLabel(subTier)}
                  </span>
                  <div class="flex-1 h-px bg-white/5"></div>
                </div>
              {/if}

              <div class="tier-grid">
                {#each list as m (m.id)}
                  {@const gc = geneColor(m)}
                  <button
                    class="group relative tier-icon rounded-sm overflow-hidden
                           cursor-pointer transition-all duration-200
                           hover:ring-1 hover:ring-sky-400/60 hover:z-10"
                    style="background-color: {gc}"
                    onclick={() => openModal(m)}
                    title={displayName(m)}
                  >
                    <img
                      src={textureUrl(specimenSrc(m))}
                      alt={displayName(m)}
                      class="absolute inset-0 w-full h-full object-contain"
                      loading="lazy"
                      decoding="async"
                      onerror={(e) => { if (!e.currentTarget.dataset.fallback) { e.currentTarget.dataset.fallback = '1'; e.currentTarget.src = specimenFallback(m) } }}
                    />
                    <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent
                                px-px py-px opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <span class="text-[6px] sm:text-[7px] md:text-[8px] text-white leading-tight line-clamp-2 text-center block">
                        {displayName(m)}
                      </span>
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </section>
    {/if}
  {/each}
</div>

{#if modalOpen && selectedMutant}
  <MutantModal
    open={modalOpen}
    mutant={selectedMutant}
    star={selectedStar}
    skins={selectedSkins}
    onclose={closeModal}
    locale={locale}
    names={names}
    obtainNames={obtainNames}
  />
{/if}

<style>
  .tier-icon { width: 100%; aspect-ratio: 1; box-sizing: border-box; max-width: var(--tier-icon); max-height: var(--tier-icon); }
  .tier-grid {
    display: grid;
    grid-template-columns: repeat(9, 1fr);
    gap: 5px;
  }
  @media (min-width: 768px) {
    .tier-icon { width: var(--tier-icon); height: var(--tier-icon); max-width: none; max-height: none; aspect-ratio: auto; }
    .tier-grid { display: flex; flex-wrap: wrap; gap: 4px; }
  }
  :root { --tier-icon: 2.25rem; }
  @media (min-width: 640px)  { :root { --tier-icon: 2.5rem; } }
  @media (min-width: 768px)  { :root { --tier-icon: 3rem; } }
  @media (min-width: 1024px) { :root { --tier-icon: 3.5rem; } }
  @media (min-width: 1920px) { :root { --tier-icon: 4rem; } }
  @media (min-width: 2560px) { :root { --tier-icon: 4.5rem; } }
</style>
