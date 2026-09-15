<script lang="ts">
  import { normalizeSearch } from '@/lib/search-normalize'
  import { textureUrl } from '@/lib/texture-cdn'
  import { getGeneIcon } from '@/lib/mutant-icons'
  import { t, type Locale } from '@/lib/i18n'

  function safeUrl(url: string): string {
    if (!url) return '#'
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return url
    } catch {}
    return '#'
  }

  // Токены-заглушки в колонке "Тандем": короткие ("-", "?", "нет") матчим ТОЛЬКО
  // целиком - иначе substring-проверка ловит их внутри реальных имён мутантов
  // (40+ имён с дефисом вроде "Кон-Тики", "Санта-Клаус"; "нет" - подстрока
  // "маг-НЕТ-ик"). Фразы матчим по includes, они многословные и в имена не влезают.
  const TANDEM_STOP_TOKENS = ['-', '—', '?', 'нет', 'net', 'off', 'none', 'empty', 'пусто']
  const TANDEM_STOP_PHRASES = ['отключен', 'низкое эво для тандема', 'слишком низкое', 'too low']

  function hasActiveTandem(tandem: string): boolean {
    const clean = (tandem || '').trim().toLowerCase()
    if (!clean) return false
    if (TANDEM_STOP_TOKENS.includes(clean)) return false
    if (TANDEM_STOP_PHRASES.some((p) => clean.includes(p))) return false
    return true
  }

  let {
    players = [],
    mutantsDb = [],
    locale = 'ru' as Locale,
    names = {} as Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>,
  }: {
    players: { rank: number; name: string; level: number; id: string; tandem: string; atk1: string; atk2: string; socials: any[] }[]
    mutantsDb: any[]
    locale?: Locale
    names?: Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>
  } = $props()

  let query = $state('')
  let displayCount = $state(50)
  let selectedPlayer: any = $state(null)
  let onlyActiveTandem = $state(false)
  let showHelpModal = $state(false)

  const filteredPlayers = $derived(players.filter(p => {
    const normalizedQuery = normalizeSearch(query)
    const normalizedName = normalizeSearch(p.name)
    if (!normalizedName.includes(normalizedQuery)) return false
    if (onlyActiveTandem && !hasActiveTandem(p.tandem)) return false
    return true
  }))

  const visiblePlayers = $derived(filteredPlayers.slice(0, displayCount))

  function loadMore() { displayCount += 50 }

  function getRankIcon(rank: number) {
    if (rank === 1) return '🥇'
    if (rank === 2) return '🥈'
    if (rank === 3) return '🥉'
    return `#${rank}`
  }

  function getRankClass(rank: number) {
    if (rank === 1) return 'rank-gold'
    if (rank === 2) return 'rank-silver'
    if (rank === 3) return 'rank-bronze'
    return 'rank-normal'
  }

  function findMutantVisuals(mutantName: string) {
    if (!mutantName || mutantName === '' || mutantName === 'undefined') {
      return { isDisabled: true }
    }

    if (!hasActiveTandem(mutantName)) {
      return { isDisabled: true }
    }

    const clean = mutantName.trim().toLowerCase()
    const normalizedClean = normalizeSearch(clean)

    const found = mutantsDb.find(m => {
      const dbNormalized = normalizeSearch(m.name)
      return dbNormalized === normalizedClean
    }) || mutantsDb.find(m => {
      const dbNormalized = normalizeSearch(m.name)
      return dbNormalized.includes(normalizedClean) || normalizedClean.includes(dbNormalized)
    })

    if (!found) return { isDisabled: true }

    let image = ''

    if (found.stars) {
      // Платина в приоритете (раз система и так подхватывает иконку мутанта -
      // платиновая не должна быть проблемой), с падением вниз по редкостям, если
      // для конкретного мутанта платиновых картинок нет.
      const rarities = ['platinum', 'gold', 'silver', 'bronze', 'normal']
      for (const rarity of rarities) {
        if (found.stars[rarity] && Array.isArray(found.stars[rarity].images)) {
          const images = found.stars[rarity].images
          image = images.find((img: string) => img.includes('specimen') || img.includes('portrait')) || images[0]
          if (image) break
        }
      }
    }

    if (!image && Array.isArray(found.image)) {
      image = found.image.find((img: string) => img.includes('specimen') || img.includes('portrait')) || found.image[0]
    } else if (!image && found.images && Array.isArray(found.images)) {
      image = found.images.find((img: string) => img.includes('specimen') || img.includes('portrait')) || found.images[0]
    } else if (!image && typeof found.image === 'string') {
      image = found.image
    }

    if (image && image.startsWith('/')) image = image.substring(1)

    const base = found.base_stats ?? {}
    const lvl30 = base.lvl30 ?? {}
    const lvl1 = base.lvl1 ?? {}
    const gene1 = lvl30.atk1_gene ?? lvl1.atk1_gene ?? base.atk1_gene ?? null
    const gene2 = lvl30.atk2_gene ?? lvl1.atk2_gene ?? base.atk2_gene ?? gene1
    const aoe1 = Boolean(lvl30.atk1_AOE ?? lvl1.atk1_AOE ?? base.atk1_AOE ?? false)
    const aoe2 = Boolean(lvl30.atk2_AOE ?? lvl1.atk2_AOE ?? base.atk2_AOE ?? false)
    const speed = Number(base.speed_base ?? lvl30.spd ?? found.speed ?? 0)

    return {
      isDisabled: false,
      name: names[found.id]?.name || found.name,
      image: image ? `/${image}` : null,
      atk1GeneIcon: getGeneIcon(gene1),
      atk2GeneIcon: getGeneIcon(gene2),
      atk1IsAoe: aoe1,
      atk2IsAoe: aoe2,
      speed: Math.round(speed * 100) / 100,
    }
  }

  function openPlayer(player: any) {
    const mutantData = findMutantVisuals(player.tandem)
    selectedPlayer = { ...player, mutantData }
  }

  function closePlayer() {
    selectedPlayer = null
  }
</script>

<div class="cta-banner">
  <a href="https://t.me/Donut_Safe" target="_blank" rel="noopener noreferrer">
    <span class="cta-icon">🚀</span>
    <span class="cta-text">
      {t('topEvo.ctaText', locale)}
      <span class="cta-link">{t('topEvo.ctaLink', locale)}</span>
    </span>
  </a>
</div>

<div class="leaderboard-container">
  <div class="search-bar">
    <div class="search-icon">🔍</div>
    <input id="evo-top-search" name="evo-top-search" type="text" placeholder={t('topEvo.searchPlaceholder', locale)} bind:value={query} />
  </div>

  <div class="toolbar-row">
    <label class="tandem-filter">
      <span class="checkbox-wrap">
        <input type="checkbox" bind:checked={onlyActiveTandem} />
        <span class="checkbox-box">
          <svg viewBox="0 0 16 16" class="checkbox-mark"><path d="M3 8.5 6.5 12 13 4.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </span>
      </span>
      <span>{t('topEvo.filterActiveTandem', locale)}</span>
    </label>
    <button type="button" class="help-btn" onclick={() => (showHelpModal = true)}>
      {t('topEvo.howToAddButton', locale)}
    </button>
  </div>

  <div class="list">
    <div class="list-header mobile-hidden">
      <span class="col-rank">{t('topEvo.col.rank', locale)}</span>
      <span class="col-name">{t('topEvo.col.name', locale)}</span>
      <span class="col-tandem">{t('topEvo.col.tandem', locale)}</span>
      <span class="col-lvl">{t('topEvo.col.level', locale)}</span>
    </div>

    {#each visiblePlayers as player (player.id)}
      <div
        class="row {getRankClass(player.rank)}"
        onclick={() => openPlayer(player)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(player) } }}
        role="button"
        tabindex="0"
      >
        <div class="cell rank">
          {#if player.rank <= 3}
            <div class="rank-badge">{getRankIcon(player.rank)}</div>
          {:else}
            <span>{getRankIcon(player.rank)}</span>
          {/if}
        </div>
        <div class="cell name">
          {player.name}
        </div>
        <div class="cell tandem mobile-hidden">
          {player.tandem || '—'}
        </div>
        <div class="cell level">
          <span class="lvl-label mobile-only">Evo:</span>
          <span class="lvl-value">{player.level}</span>
        </div>
      </div>
    {/each}

    {#if filteredPlayers.length === 0}
      <div class="empty-state">{t('topEvo.emptyState', locale)}</div>
    {/if}
  </div>

  {#if visiblePlayers.length < filteredPlayers.length}
    <button class="load-more" onclick={loadMore}>{t('topEvo.loadMore', locale)}</button>
  {/if}
</div>

{#if selectedPlayer}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={closePlayer}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-card {getRankClass(selectedPlayer.rank)}" onclick={(e) => e.stopPropagation()}>
      <button class="modal-close" onclick={closePlayer}>×</button>

      <div class="modal-header">
        <div class="modal-rank">{getRankIcon(selectedPlayer.rank)}</div>
        <h2 class="modal-name">{selectedPlayer.name}</h2>
        <div class="modal-level">Evo Lvl: <span>{selectedPlayer.level}</span></div>
      </div>

      <div class="modal-divider"></div>

      {#if selectedPlayer.mutantData}
        {#if selectedPlayer.mutantData.isDisabled}
          <div class="tandem-section">
            <h3 class="sad-title">{t('topEvo.tandemDisabledTitle', locale)}</h3>
            <div class="mutant-preview sad-preview">
              <img src={textureUrl("/avatars/sad_emoji.gif")} alt="Sad" class="sad-icon" />
            </div>
            <p class="sad-text">{t('topEvo.noActiveTandem', locale)}</p>
          </div>
        {:else}
          <div class="tandem-section">
            <h3>{t('topEvo.tandemLabel', locale)} <span class="tandem-name">{selectedPlayer.mutantData.name}</span></h3>
            <div class="mutant-preview">
              {#if selectedPlayer.mutantData.image}
                <img src={textureUrl(selectedPlayer.mutantData.image)} alt={selectedPlayer.mutantData.name} />
              {:else}
                <div class="no-image">?</div>
              {/if}
            </div>
            <div class="mutant-stats">
              <div class="stat-row">
                <span class="stat-label">
                  {#if selectedPlayer.mutantData.atk1GeneIcon}<span class="gene-ico"><img src={textureUrl(selectedPlayer.mutantData.atk1GeneIcon)} alt="" class="gene-icon" />{#if selectedPlayer.mutantData.atk1IsAoe}<img src={textureUrl('/genes/atk_multiple.webp')} alt={t('stats.aoeAlt', locale)} class="gene-aoe" />{/if}</span>{:else}ATK 1{#if selectedPlayer.mutantData.atk1IsAoe}<img src={textureUrl('/genes/atk_multiple.webp')} alt={t('stats.aoeAlt', locale)} class="aoe-icon-inline" />{/if}{/if}
                </span>
                <span class="stat-val">{selectedPlayer.atk1}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">
                  {#if selectedPlayer.mutantData.atk2GeneIcon}<span class="gene-ico"><img src={textureUrl(selectedPlayer.mutantData.atk2GeneIcon)} alt="" class="gene-icon" />{#if selectedPlayer.mutantData.atk2IsAoe}<img src={textureUrl('/genes/atk_multiple.webp')} alt={t('stats.aoeAlt', locale)} class="gene-aoe" />{/if}</span>{:else}ATK 2{#if selectedPlayer.mutantData.atk2IsAoe}<img src={textureUrl('/genes/atk_multiple.webp')} alt={t('stats.aoeAlt', locale)} class="aoe-icon-inline" />{/if}{/if}
                </span>
                <span class="stat-val">{selectedPlayer.atk2}</span>
              </div>
              {#if selectedPlayer.mutantData.speed}
                <div class="stat-row">
                  <span class="stat-label">⚡ SPD</span>
                  <span class="stat-val">{selectedPlayer.mutantData.speed}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {:else}
        <div class="no-tandem">
          <p>{t('topEvo.mutantNotFound', locale).replace('{name}', selectedPlayer.tandem)}</p>
        </div>
      {/if}

      {#if selectedPlayer.socials?.some((s: any) => s.source === 'profile')}
        <div class="socials-section">
          <div class="socials-header">{t('topEvo.profileLinkHeader', locale)}</div>
          <div class="socials-grid">
            {#each selectedPlayer.socials.filter((s: any) => s.source === 'profile') as social}
              <a href={safeUrl(social.url)} target="_blank" rel="noopener noreferrer" class="social-btn {social.type}">
                <div class="btn-content">
                  <span class="btn-icon">
                    {#if social.type === 'tg'}✈️
                    {:else if social.type === 'vk'}vk
                    {:else if social.type === 'fb'}f
                    {:else}🔗{/if}
                  </span>
                  <span class="btn-label">{social.type === 'link' ? t('topEvo.genericLinkLabel', locale) : social.label}</span>
                </div>
                <span class="btn-arrow">→</span>
              </a>
            {/each}
          </div>
        </div>
      {/if}

      {#if selectedPlayer.socials?.some((s: any) => s.source === 'contact')}
        <div class="socials-section">
          <div class="socials-header">{t('topEvo.contactHeader', locale)}</div>
          <div class="socials-grid">
            {#each selectedPlayer.socials.filter((s: any) => s.source === 'contact') as social}
              {#if social.type === 'text'}
                <div class="social-text">{social.label}</div>
              {:else}
                <a href={safeUrl(social.url)} target="_blank" rel="noopener noreferrer" class="social-btn {social.type}">
                  <div class="btn-content">
                    <span class="btn-icon">
                      {#if social.type === 'tg'}✈️
                      {:else if social.type === 'vk'}vk
                      {:else if social.type === 'fb'}f
                      {:else}🔗{/if}
                    </span>
                    <span class="btn-label">{social.type === 'link' ? t('topEvo.genericLinkLabel', locale) : social.label}</span>
                  </div>
                  <span class="btn-arrow">→</span>
                </a>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showHelpModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={() => (showHelpModal = false)}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-card help-card" onclick={(e) => e.stopPropagation()}>
      <button class="modal-close" onclick={() => (showHelpModal = false)}>×</button>
      <h2 class="help-title">{t('topEvo.howToAddButton', locale)}</h2>
      <p class="help-intro">{t('topEvo.howToAddIntro', locale)}</p>
      <ol class="help-steps">
        <li>{t('topEvo.howToAddStep1', locale)}</li>
        <li>{t('topEvo.howToAddStep2', locale)}</li>
        <li>{t('topEvo.howToAddStep3', locale)}</li>
        <li>{t('topEvo.howToAddStep4', locale)}</li>
      </ol>
      <p class="help-outro">{t('topEvo.howToAddOutro', locale)}</p>
    </div>
  </div>
{/if}

<style>
  .cta-banner { max-width: 800px; margin: 0 auto 2rem; text-align: center; }
  .cta-banner a { display: inline-flex; align-items: center; gap: 0.75rem; background: linear-gradient(90deg, rgb(59, 130, 246), rgb(147, 51, 234)); border: 1px solid rgb(147, 51, 234); padding: 0.8rem 1.5rem; border-radius: var(--radius-lg); text-decoration: none; color: #fff; font-size: 0.95rem; transition: transform 0.2s, box-shadow 0.2s; font-weight: 600; }
  .cta-banner a:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(147, 51, 234, 0.2); border-color: rgba(147, 51, 234, 0.6); }
  .cta-link { color: #38bdf8; font-weight: 700; text-decoration: underline; text-underline-offset: 4px; }

  .leaderboard-container { max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
  .search-bar { position: relative; width: 100%; margin-bottom: 0.5rem; }
  .search-bar input { width: 100%; padding: 14px 16px 14px 48px; border-radius: var(--radius-lg); background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; font-size: 1rem; outline: none; transition: all 0.2s; box-sizing: border-box; }
  .search-bar input:focus { background: rgba(30, 41, 59, 0.9); border-color: #3b82f6; }
  .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); opacity: 0.5; }

  .toolbar-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .tandem-filter { display: flex; align-items: center; gap: 0.6rem; color: #cbd5f5; font-size: 0.9rem; font-weight: 600; cursor: pointer; user-select: none; }
  .checkbox-wrap { position: relative; width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; }
  .checkbox-wrap input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
  .checkbox-box { position: absolute; inset: 0; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(15, 23, 42, 0.8); display: flex; align-items: center; justify-content: center; transition: background 0.2s, border-color 0.2s; }
  .checkbox-mark { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 2.5; opacity: 0; transition: opacity 0.15s; }
  .checkbox-wrap input:checked ~ .checkbox-box { background: #3b82f6; border-color: #3b82f6; }
  .checkbox-wrap input:checked ~ .checkbox-box .checkbox-mark { opacity: 1; }
  .checkbox-wrap input:hover ~ .checkbox-box { border-color: rgba(59, 130, 246, 0.6); }
  .checkbox-wrap input:focus-visible ~ .checkbox-box { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5); }
  .help-btn { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.15); color: #cbd5f5; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
  .help-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; border-color: rgba(255, 255, 255, 0.3); }

  .list { display: flex; flex-direction: column; gap: 0.75rem; }
  .list-header { display: grid; grid-template-columns: 72px 1.5fr 1fr 100px; column-gap: 0.75rem; padding: 0 1.5rem; color: #e5e7eb; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .col-lvl { text-align: right; }

  .row { position: relative; display: grid; grid-template-columns: 72px 1.5fr 1fr 100px; column-gap: 0.75rem; align-items: center; background: rgb(30, 41, 59); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: var(--radius-lg); padding: 1rem 1.5rem; transition: transform 0.2s, background 0.2s; cursor: pointer; }
  .row:hover { background: rgba(30, 41, 59, 0.8); transform: scale(1.01); }

  .rank-gold { background: linear-gradient(90deg, rgb(234, 179, 8), rgb(30, 41, 59)); border-color: rgb(234, 179, 8); transition: background-color 0.3s ease, opacity 0.3s ease; }
  .rank-silver { background: linear-gradient(90deg, rgb(148, 163, 184), rgb(30, 41, 59)); border-color: rgb(148, 163, 184); transition: background-color 0.3s ease, opacity 0.3s ease; }
  .rank-bronze { background: linear-gradient(90deg, rgb(217, 119, 6), rgb(30, 41, 59)); border-color: rgb(217, 119, 6); transition: background-color 0.3s ease, opacity 0.3s ease; }

  .cell.rank { display: flex; align-items: center; font-weight: 800; font-size: 1.2rem; color: #64748b; position: relative; width: 100%; }
  .rank-gold .cell.rank { color: #facc15; }
  .rank-silver .cell.rank { color: #e2e8f0; }
  .rank-bronze .cell.rank { color: #fbbf24; }

  .rank-badge { position: absolute; left: -55px; top: 50%; transform: translateY(-50%); font-size: 1.5rem; white-space: nowrap; }
  .cell.rank span { display: inline-block; padding-left: 15px; padding-right: 8px; white-space: nowrap; }

  .cell.name { font-weight: 600; color: #f1f5f9; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"; }
  .cell.tandem { color: #e5e7eb; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"; }
  .cell.level { text-align: right; font-family: monospace; font-size: 1.2rem; font-weight: 700; color: #38bdf8; }

  .load-more { width: 100%; padding: 1rem; border-radius: var(--radius-lg); background: rgba(255,255,255,0.05); border: none; color: #94a3b8; cursor: pointer; font-weight: 600; }
  .load-more:hover { background: rgba(255,255,255,0.1); color: #fff; }
  .empty-state { text-align: center; padding: 3rem; color: #64748b; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .modal-card { background: #1e293b; width: 100%; max-width: 400px; border-radius: 24px; padding: 2rem; position: relative; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); border: 1px solid rgba(255,255,255,0.1); animation: popIn 0.2s ease-out; }
  @keyframes popIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }

  .modal-close { position: absolute; top: 1rem; right: 1rem; background: transparent; border: none; color: #64748b; font-size: 1.5rem; cursor: pointer; }
  .modal-header { text-align: center; }
  .modal-rank { font-size: 2rem; margin-bottom: 0.5rem; }
  .modal-name { font-size: 1.5rem; color: #fff; margin: 0; }
  .modal-level { color: #38bdf8; font-weight: 700; font-size: 1.1rem; margin-top: 0.25rem; }
  .modal-divider { height: 1px; background: rgba(255,255,255,0.1); margin: 1.5rem 0; }

  .tandem-section { text-align: center; }
  .tandem-section h3 { color: #94a3b8; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 1rem; }
  .tandem-name { color: #fff; font-weight: 700; }

  .mutant-preview { width: 140px; height: 140px; margin: 0 auto 1.5rem; border-radius: 20px; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1); }
  .mutant-preview img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 5px 10px rgba(0,0,0,0.5)); }
  .no-image { font-size: 2rem; color: #475569; }

  .mutant-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 0.5rem; background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: var(--radius-md); }
  .stat-row { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; }
  .stat-label { display: flex; align-items: center; gap: 4px; font-size: 0.7rem; color: #94a3b8; }
  .stat-val { color: #fff; font-weight: 700; font-size: 0.95rem; word-break: break-word; }
  .gene-ico { position: relative; display: inline-flex; width: 20px; height: 20px; vertical-align: middle; }
  .gene-icon { width: 100%; height: 100%; object-fit: contain; }
  .gene-aoe { position: absolute; right: -5px; top: 0; bottom: 0; margin: auto 0; height: 100%; width: auto; pointer-events: none; filter: drop-shadow(0 1px 1px rgba(0,0,0,.55)); }
  .aoe-icon-inline { width: 14px; height: 14px; object-fit: contain; vertical-align: middle; margin-left: 2px; }

  .no-tandem { text-align: center; color: #64748b; font-style: italic; }

  .sad-title { color: #f87171; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 0.05em; margin-bottom: 1rem; text-align: center; }
  .sad-preview { border-color: rgba(248, 113, 113, 0.3); background: rgba(248, 113, 113, 0.05); }
  .sad-icon { width: 64px !important; height: 64px !important; opacity: 0.8; }
  .sad-text { text-align: center; color: #94a3b8; font-size: 0.9rem; font-style: italic; }

  .socials-section { margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; }
  .socials-header { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 0.75rem; text-align: center; }
  .socials-grid { display: flex; flex-direction: column; gap: 0.75rem; width: 100%; }
  .social-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box; padding: 0.9rem 1.2rem; border-radius: var(--radius-lg); text-decoration: none; font-weight: 600; font-size: 0.95rem; transition: transform 0.2s, filter 0.2s; color: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
  .social-btn:hover { transform: translateY(-2px); filter: brightness(1.1); }
  .btn-content { display: flex; align-items: center; gap: 0.75rem; }
  .btn-icon { font-size: 1.1rem; width: 24px; text-align: center; }
  .btn-arrow { opacity: 0.6; font-weight: 400; }
  .social-btn.fb { background: #1877f2; }
  .social-btn.vk { background: #0077ff; }
  .social-btn.tg { background: #24A1DE; }
  .social-btn.link { background: #475569; }
  .social-text { width: 100%; box-sizing: border-box; padding: 0.9rem 1.2rem; border-radius: var(--radius-lg); background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.15); color: #cbd5f5; font-size: 0.9rem; font-style: italic; text-align: center; }

  .help-card { max-width: 460px; }
  .help-title { font-size: 1.25rem; color: #fff; margin: 0 0 1rem; text-align: center; padding-right: 1.5rem; }
  .help-intro, .help-outro { color: #cbd5f5; font-size: 0.9rem; line-height: 1.5; }
  .help-outro { margin-top: 1rem; font-style: italic; color: #94a3b8; }
  .help-steps { color: #e2e8f0; font-size: 0.9rem; line-height: 1.6; padding-left: 1.5rem; margin: 0.75rem 0; list-style: decimal; }
  .help-steps li { padding-left: 0.25rem; margin-bottom: 0.5rem; }
  .help-steps li:last-child { margin-bottom: 0; }

  .mobile-only { display: none; }
  @media (max-width: 640px) {
    .mobile-hidden { display: none; }
    .mobile-only { display: inline; }
    .row { display: flex; gap: 1rem; padding: 0.75rem 1rem; }
    .cell.rank { width: 40px; font-size: 1rem; }
    .rank-badge { display: none; }
    .cell.name { flex: 1; }
    .cell.level { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
    .lvl-label { font-size: 0.65rem; color: #64748b; margin-bottom: 2px; }
  }
</style>
