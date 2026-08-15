<script lang="ts">
  import MutantModal from '../MutantModal.svelte'
  import { baseMutantId as baseId, buildSkinLookup } from '@/lib/utils'
  import { type Locale } from '@/lib/i18n'

  // locale/names/obtainNames - опциональные пропы (не влияют на 5 страниц,
  // где ещё нет локали): страницы с уже готовым i18n (bingo/top-mutants/boxes)
  // передают их из своего NAMES_BY_LOCALE (тот же паттерн, что
  // TierListPage.astro) - это просто сериализованный объект имён ОДНОЙ
  // локали (~100КБ), не 8 файлов, поэтому бандл-стоимость незначительна и
  // не требует отдельного динамического импорта, как для mutants.json ниже.
  let {
    locale = 'ru' as Locale,
    names = {} as Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>,
    obtainNames = {} as Record<string, string>,
  }: {
    locale?: Locale
    names?: Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>
    obtainNames?: Record<string, string>
  } = $props()

  // BingoMutantModal монтируется client:load на 5 страницах (bingo,
  // top-mutants, announcements, boxes, guides), но модалка реально
  // открывается только по клику. mutants.json/skins.json грузим динамически
  // при первом открытии, а не статическим импортом - иначе ~1.8МБ данных
  // тянутся в клиентский бандл КАЖДОЙ из этих 5 страниц даже без единого
  // клика по мутанту.
  let dataPromise: Promise<{ byId: Map<string, any>; skinLookup: Map<string, any[]> }> | null =
    null

  function loadData() {
    if (!dataPromise) {
      dataPromise = Promise.all([
        import('@/data/mutants/mutants.json'),
        import('@/data/mutants/skins.json'),
      ]).then(([mutantsModule, skinsModule]) => {
        const mutants = mutantsModule.default as any[]
        const skinsData = skinsModule.default as any
        const byId = new Map(mutants.map((m) => [String(m.id).toLowerCase(), m]))
        const skinLookup = buildSkinLookup(skinsData?.specimens ?? [])
        return { byId, skinLookup }
      })
    }
    return dataPromise
  }

  const STAR_ORDER = ['platinum', 'gold', 'silver', 'bronze', 'normal']

  let modalOpen = $state(false)
  let selectedMutant: any = $state(null)
  let selectedStar = $state('normal')
  let selectedSkins: any[] = $state([])

  async function onOpen(e: Event) {
    const specimenId = (e as CustomEvent).detail?.specimenId as string | undefined
    if (!specimenId) return
    const { byId, skinLookup } = await loadData()
    const m = byId.get(specimenId.toLowerCase())
    if (!m) return
    selectedMutant = m
    selectedStar = m.stars ? STAR_ORDER.find((s) => m.stars[s]) || 'normal' : 'normal'
    selectedSkins = skinLookup.get(baseId(m.id)) ?? []
    modalOpen = true
  }

  function closeModal() {
    modalOpen = false
    selectedMutant = null
    selectedSkins = []
  }

  $effect(() => {
    window.addEventListener('archivist:open-mutant', onOpen)
    return () => window.removeEventListener('archivist:open-mutant', onOpen)
  })
</script>

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
