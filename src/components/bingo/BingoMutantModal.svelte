<script lang="ts">
  import MutantModal from '../MutantModal.svelte'
  import { baseMutantId as baseId, buildSkinLookup } from '@/lib/utils'

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
  <MutantModal open={modalOpen} mutant={selectedMutant} star={selectedStar} skins={selectedSkins} onclose={closeModal} />
{/if}
