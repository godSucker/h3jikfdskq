<script lang="ts">
  import type { CombatUnit } from '@/lib/pvp/battle-profile'
  import type { CurrentTurnInfo, TurnChoice, TurnLogGroup } from '@/lib/pvp/fight-engine'
  import { textureUrl } from '@/lib/texture-cdn'
  import { geneLabelL } from '@/lib/mutant-dicts'
  import { GENE_BUTTON_BASE_CLASS, geneButtonStyle } from '@/lib/pvp/gene-colors'
  import { t, type Locale } from '@/lib/i18n'

  let {
    units,
    turnLog,
    currentTurn,
    winner,
    turnQueue,
    onResolve,
    onAutoPlay,
    locale = 'ru' as Locale,
  }: {
    units: CombatUnit[]
    turnLog: TurnLogGroup[]
    currentTurn: CurrentTurnInfo | null
    winner: 'mine' | 'enemy' | null
    turnQueue: CombatUnit[]
    onResolve: (choice?: TurnChoice) => void
    onAutoPlay: () => void
    locale?: Locale
  } = $props()

  function orbIcon(id: string | null, kind: 'basic' | 'special'): string | null {
    return id ? `/orbs/${kind}/${id}.webp` : null
  }

  function unitOrbIcons(u: CombatUnit): { icon: string; kind: 'basic' | 'special' }[] {
    const icons: { icon: string; kind: 'basic' | 'special' }[] = []
    for (const id of u.basicOrbIds) {
      const icon = orbIcon(id, 'basic')
      if (icon) icons.push({ icon, kind: 'basic' })
    }
    const special = orbIcon(u.specialOrbId, 'special')
    if (special) icons.push({ icon: special, kind: 'special' })
    return icons
  }

  let pendingAttack = $state<'atk1' | 'atk2' | null>(null)

  function pickAttack(attack: 'atk1' | 'atk2') {
    const action = currentTurn?.validActions.find((a) => a.attack === attack)
    if (action?.isAOE) {
      onResolve({ attack })
      pendingAttack = null
    } else {
      pendingAttack = attack
    }
  }

  function pickTarget(targetId: string) {
    if (!pendingAttack) return
    onResolve({ attack: pendingAttack, targetId })
    pendingAttack = null
  }

  function hpPct(u: CombatUnit): number {
    return u.maxHp > 0 ? Math.max(0, Math.round((u.hp / u.maxHp) * 100)) : 0
  }

  function attackLabel(u: CombatUnit, attack: 'atk1' | 'atk2'): string {
    return attack === 'atk1' ? u.attack1Name : u.attack2Name
  }

  function attackGene(u: CombatUnit, attack: 'atk1' | 'atk2') {
    return attack === 'atk1' ? u.atk1Gene : u.atk2Gene
  }

  function attackValue(u: CombatUnit, attack: 'atk1' | 'atk2'): number {
    return attack === 'atk1' ? u.atk1 : u.atk2
  }
</script>

<div class="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-4 backdrop-blur space-y-4">
  <h2 class="text-sky-100 font-bold">{t('pvp.battle.title', locale)}</h2>

  {#if !winner && turnQueue.length > 0}
    <div class="rounded-lg border border-slate-700/50 bg-slate-950/40 p-2">
      <div class="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{t('pvp.battle.turnQueue', locale)}</div>
      <div class="flex items-end gap-2.5 overflow-x-auto px-1.5 pb-0.5">
        {#each turnQueue as u, i (u.instanceId + '-' + i)}
          <div class="flex flex-col items-center gap-1 shrink-0">
            {#if i === 0}
              <span class="text-[9px] font-bold text-amber-300 leading-none">{t('pvp.battle.now', locale)}</span>
            {/if}
            <div
              class={`rounded-lg overflow-hidden ring-2 ${i === 0 ? 'w-12 h-12 ring-amber-400' : 'w-8 h-8 ring-transparent opacity-80'} ${
                u.side === 'mine' ? 'bg-sky-950' : 'bg-rose-950'
              }`}
            >
              <img
                src={textureUrl(u.portraitUrl)}
                alt={u.name}
                title={`${u.name} (${u.side === 'mine' ? t('pvp.battle.mineLower', locale) : t('pvp.battle.opponentLower', locale)})`}
                loading="lazy"
                class="w-full h-full object-cover"
              />
            </div>
            <span class={`block w-full h-1.5 rounded-full ${u.side === 'mine' ? 'bg-sky-500' : 'bg-rose-500'}`}></span>
          </div>
        {/each}
      </div>
      <div class="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
        <span class="flex items-center gap-1"><span class="w-2.5 h-1.5 rounded-full bg-sky-500"></span>{t('pvp.battle.mineLower', locale)}</span>
        <span class="flex items-center gap-1"><span class="w-2.5 h-1.5 rounded-full bg-rose-500"></span>{t('pvp.battle.opponentLower', locale)}</span>
      </div>
    </div>
  {/if}

  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    {#each ['mine', 'enemy'] as side (side)}
      <div class="space-y-1.5">
        <div class="text-xs text-sky-300/70">{side === 'mine' ? t('pvp.team.mine', locale) : t('pvp.battle.opponentCap', locale)}</div>
        {#each units.filter((u) => u.side === side) as u (u.instanceId)}
          <div
            class="rounded-lg border px-2 py-1.5 text-xs flex gap-2"
            class:border-emerald-500={pendingAttack && u.side !== units.find((x) => x.instanceId === currentTurn?.unit.instanceId)?.side && u.isAlive}
            class:border-sky-500={currentTurn?.unit.instanceId === u.instanceId && u.isAlive}
            class:border-slate-700={!(pendingAttack && u.isAlive) && currentTurn?.unit.instanceId !== u.instanceId}
            class:opacity-40={!u.isAlive}
          >
            {#if u.portraitUrl}
              <img
                src={textureUrl(u.portraitUrl)}
                alt={u.name}
                loading="lazy"
                class="w-10 h-10 rounded-md object-cover border border-slate-700/60 bg-slate-950/60 shrink-0"
              />
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex justify-between text-sky-100">
                <span class="flex items-center gap-1 truncate">
                  {#if u.gene !== 'neutro'}
                    <img
                      src={textureUrl(`/genes/icon_gene_${u.gene.toLowerCase()}.webp`)}
                      alt={geneLabelL(u.gene.toUpperCase(), locale) || ''}
                      class="w-3.5 h-3.5 shrink-0"
                    />
                  {/if}
                  {#if u.gene2}
                    <img
                      src={textureUrl(`/genes/icon_gene_${u.gene2.toLowerCase()}.webp`)}
                      alt={geneLabelL(u.gene2.toUpperCase(), locale) || ''}
                      class="w-3.5 h-3.5 shrink-0"
                    />
                  {/if}
                  <span class="truncate">{u.name}</span>
                  {#each unitOrbIcons(u) as o, oi (oi)}
                    <img
                      src={textureUrl(o.icon)}
                      alt=""
                      class={`w-3.5 h-3.5 shrink-0 rounded-sm ${o.kind === 'special' ? 'ring-1 ring-amber-400/70' : ''}`}
                    />
                  {/each}
                </span>
                <span class="shrink-0">{u.hp} / {u.maxHp}</span>
              </div>
              <div class="mt-1 h-1.5 rounded bg-slate-800 overflow-hidden">
                <div class="h-full bg-sky-500" style={`width:${hpPct(u)}%`}></div>
              </div>
              {#if u.shieldPool > 0 || u.strengthenCharges > 0 || u.weakenCharge || u.slashDot > 0}
                <div class="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {#if u.shieldPool > 0}
                    <span class="rounded bg-sky-900/60 text-sky-300 px-1 py-0.5">🛡 {u.shieldPool}</span>
                  {/if}
                  {#if u.strengthenCharges > 0}
                    <span class="rounded bg-emerald-900/60 text-emerald-300 px-1 py-0.5">↑ ×{u.strengthenCharges}</span>
                  {/if}
                  {#if u.weakenCharge}
                    <span class="rounded bg-amber-900/60 text-amber-300 px-1 py-0.5">↓ -{u.weakenPct}%</span>
                  {/if}
                  {#if u.slashDot > 0}
                    <span class="rounded bg-rose-900/60 text-rose-300 px-1 py-0.5">🩸 {u.slashDot}{t('pvp.battle.perTurn', locale)}</span>
                  {/if}
                </div>
              {/if}
              {#if pendingAttack && u.isAlive && u.side !== currentTurn?.unit.side}
                <button
                  type="button"
                  onclick={() => pickTarget(u.instanceId)}
                  class="mt-1 w-full rounded bg-rose-600/80 hover:bg-rose-500 text-white text-[11px] py-0.5"
                >
                  {t('pvp.battle.attackButton', locale)}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  {#if winner}
    <div class="text-center text-sky-100 font-bold py-2">
      {winner === 'mine' ? t('pvp.battle.win', locale) : t('pvp.battle.lose', locale)}
    </div>
  {:else if currentTurn}
    <div class="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3">
      <div class="text-sky-300/80 text-sm mb-2 flex items-center gap-2">
        {#if currentTurn.unit.portraitUrl}
          <img
            src={textureUrl(currentTurn.unit.portraitUrl)}
            alt=""
            class="w-6 h-6 rounded object-cover border border-slate-700/60"
          />
        {/if}
        {t('pvp.battle.turnOf', locale).replace('{name}', currentTurn.unit.name)}
      </div>
      {#if currentTurn.needsInput}
        {#if pendingAttack}
          <div class="text-xs text-sky-300/70 mb-2">{t('pvp.battle.pickTarget', locale)}</div>
          <button
            type="button"
            onclick={() => (pendingAttack = null)}
            class="text-xs text-sky-400 underline"
          >
            {t('pvp.battle.cancel', locale)}
          </button>
        {:else}
          <div class="flex gap-2">
            {#each currentTurn.validActions as action (action.attack)}
              {@const gene = attackGene(currentTurn.unit, action.attack)}
              <button
                type="button"
                onclick={() => pickAttack(action.attack)}
                style={geneButtonStyle(gene)}
                class={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${GENE_BUTTON_BASE_CLASS}`}
              >
                {#if gene !== 'neutro'}
                  <img src={textureUrl(`/genes/icon_gene_${gene.toLowerCase()}.webp`)} alt="" class="w-3.5 h-3.5" />
                {/if}
                {attackLabel(currentTurn.unit, action.attack)}{action.isAOE ? t('pvp.battle.aoeSuffix', locale) : ''}
                <span class="text-white/70 font-normal">({attackValue(currentTurn.unit, action.attack)})</span>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <button
          type="button"
          onclick={() => onResolve()}
          class="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm"
        >
          {t('pvp.battle.aiTurnButton', locale)}
        </button>
      {/if}
    </div>
    <button
      type="button"
      onclick={onAutoPlay}
      class="w-full px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm ring-1 ring-white/10 shadow-lg shadow-amber-900/30 transition-colors"
    >
      {t('pvp.battle.autoPlayButton', locale)}
    </button>
  {/if}

  <div class="max-h-64 overflow-y-auto rounded-lg border border-slate-700/50 bg-slate-950/40 p-2 space-y-1.5">
    {#each turnLog as group, i (group.turnNumber)}
      <div
        class={`rounded-md border-l-2 pl-2 pr-1.5 py-1 ${group.attackerSide === 'mine' ? 'border-sky-500' : 'border-rose-500'} ${i % 2 === 0 ? 'bg-slate-900/50' : ''}`}
      >
        <div class="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
          {t('pvp.battle.turnLogLabel', locale).replace('{n}', String(group.turnNumber)).replace('{name}', group.attackerName)}
        </div>
        {#each group.lines as line, j (j)}
          <div class="text-xs text-sky-200/70 leading-snug">{line}</div>
        {/each}
      </div>
    {/each}
  </div>
</div>
