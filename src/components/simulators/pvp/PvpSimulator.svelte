<script lang="ts">
  import mutantsRaw from '@/data/mutants/mutants.json'
  import TeamBuilder from './TeamBuilder.svelte'
  import BattleView from './BattleView.svelte'
  import DarkCheckbox from './DarkCheckbox.svelte'
  import { buildBattleUnit, type CombatUnit } from '@/lib/pvp/battle-profile'
  import { createBattleSession, BattleSession, type FighterMode, type TurnChoice } from '@/lib/pvp/fight-engine'
  import { simulateBatch, type BatchResult } from '@/lib/pvp/simulate-batch'
  import { textureUrl } from '@/lib/texture-cdn'

  const FIRST_MUTANT_ID = (mutantsRaw as any[])[0]?.id ?? ''

  interface SlotConfig {
    mutantId: string
    level: number
    star: 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
    basicOrbIds: (string | null)[]
    specialOrbId: string | null
  }

  const FIRST_MUTANT = (mutantsRaw as any[])[0]
  const FIRST_MUTANT_STAR: SlotConfig['star'] = FIRST_MUTANT?.stars?.platinum
    ? 'platinum'
    : (Object.keys(FIRST_MUTANT?.stars || {})[0] as SlotConfig['star']) || 'normal'
  const FIRST_MUTANT_ORB_SLOTS = Math.max(1, Number(FIRST_MUTANT?.orbs?.normal) || 1)

  function defaultSlot(): SlotConfig {
    return {
      mutantId: FIRST_MUTANT_ID,
      level: 30,
      star: FIRST_MUTANT_STAR,
      basicOrbIds: Array.from({ length: FIRST_MUTANT_ORB_SLOTS }, () => null),
      specialOrbId: null,
    }
  }

  let myTeam = $state<SlotConfig[]>([defaultSlot(), defaultSlot(), defaultSlot()])
  let enemyTeam = $state<SlotConfig[]>([defaultSlot(), defaultSlot(), defaultSlot()])
  let myMode = $state<FighterMode>('manual')
  let enemyMode = $state<FighterMode>('ai')
  // Крит/антикрит-чармы - аккаунтные бустеры (активируются на весь аккаунт на N дней),
  // не экипировка отдельного мутанта - поэтому один переключатель на команду, не на слот.
  let myCritCharm = $state(false)
  let myAnticritCharm = $state(false)
  let enemyCritCharm = $state(false)
  let enemyAnticritCharm = $state(false)

  let session = $state<BattleSession | null>(null)
  let tick = $state(0) // бампается после каждой мутации session, чтобы $derived перечитали её состояние

  let units = $derived.by(() => {
    tick
    return session ? session.getUnits() : []
  })
  let turnLog = $derived.by(() => {
    tick
    // Копия, не сама ссылка: BattleSession.turnLog мутируется через push() на месте,
    // ссылка не меняется - Svelte 5 сравнивает $derived по идентичности и без
    // копии не считает значение изменившимся, лог не перерисовывается.
    return session ? [...session.turnLog] : []
  })
  let currentTurn = $derived.by(() => {
    tick
    return session ? session.currentTurn() : null
  })
  let winner = $derived.by(() => {
    tick
    return session ? session.winner() : null
  })

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI']

  /** Три одинаковых "Робот" в команде было не различить ни в списке юнитов, ни
   *  в логе - нумеруем ТОЛЬКО дубликаты внутри одной стороны (не через обе сразу:
   *  на зеркальном матчапе это дало бы "Робот I" на обеих сторонах одновременно,
   *  что снова читалось бы как самоатака - см. sideTag в fight-engine.ts, который
   *  как раз этот конкретный случай и закрывает). */
  function disambiguateNames(units: CombatUnit[]): CombatUnit[] {
    const counts = new Map<string, number>()
    for (const u of units) counts.set(u.name, (counts.get(u.name) || 0) + 1)
    const seen = new Map<string, number>()
    return units.map((u) => {
      if ((counts.get(u.name) || 0) <= 1) return u
      const idx = (seen.get(u.name) || 0) + 1
      seen.set(u.name, idx)
      return { ...u, name: `${u.name} ${ROMAN[idx - 1] || idx}` }
    })
  }

  function buildTeam(
    slots: SlotConfig[],
    side: 'mine' | 'enemy',
    critCharmActive: boolean,
    anticritCharmActive: boolean
  ) {
    const units = slots.map((s, i) =>
      buildBattleUnit(s.mutantId, {
        level: s.level,
        star: s.star,
        side,
        orbs: { basicOrbIds: s.basicOrbIds, specialOrbId: s.specialOrbId },
        critCharmActive,
        anticritCharmActive,
        instanceId: `${side}-${i}`,
      })
    )
    return disambiguateNames(units)
  }

  function startFight() {
    const mine = buildTeam(myTeam, 'mine', myCritCharm, myAnticritCharm)
    const enemy = buildTeam(enemyTeam, 'enemy', enemyCritCharm, enemyAnticritCharm)
    session = createBattleSession(mine, enemy, myMode, enemyMode)
    tick += 1
  }

  function resolveTurn(choice?: TurnChoice) {
    session?.resolveTurn(choice)
    tick += 1
  }

  function autoPlay() {
    if (!session) return
    // "Прогнать бой до конца" - буквально до конца, включая ручные стороны (см.
    // BattleSession.playToEnd) - раньше эта кнопка тихо останавливалась на первом
    // же ходе ручной стороны, что при зеркальной сборке по умолчанию (равные
    // скорости) выглядело как "кнопка не работает".
    session.playToEnd()
    tick += 1
  }

  function reset() {
    session = null
    tick += 1
  }

  // Батч-оценка шансов - N боёв ИИ vs ИИ (независимо от выставленных режимов, чтобы
  // не требовать ручного ввода на 200 повторов), см. src/lib/pvp/simulate-batch.ts.
  const BATCH_RUNS_DEFAULT = 500
  let batchRuns = $state(BATCH_RUNS_DEFAULT)
  let batchResult = $state<BatchResult | null>(null)
  let batchRunning = $state(false)

  // Клэмп на КАЖДОЕ чтение (не только по клику) - $derived, а не просто константа,
  // т.к. bind:value на пустом/нечисловом инпуте даёт NaN, и подпись кнопки не должна
  // на миг показывать "Оценить шансы (NaN симуляций)" пока поле не в фокусе.
  // Верхний предел 5000 - замерено (~650мс в движке на 3×3 бой), выше ощутимо
  // подвисает "Считаю..." без прогресс-индикации внутри самого прогона.
  let clampedBatchRuns = $derived(
    Math.max(10, Math.min(5000, Math.floor(batchRuns) || BATCH_RUNS_DEFAULT)),
  )

  function runBatch() {
    batchRunning = true
    batchResult = null
    const runs = clampedBatchRuns
    // Отдать браузеру кадр на отрисовку "считаю...", прежде чем занять поток синхронным прогоном.
    setTimeout(() => {
      batchResult = simulateBatch(
        () => buildTeam(myTeam, 'mine', myCritCharm, myAnticritCharm),
        () => buildTeam(enemyTeam, 'enemy', enemyCritCharm, enemyAnticritCharm),
        runs
      )
      batchRunning = false
    }, 20)
  }
</script>

<div class="max-w-6xl mx-auto p-4">
  <h1 class="text-2xl md:text-3xl font-bold text-sky-100">Симулятор PvP-боя</h1>
  <p class="text-sky-200/80 mt-1">
    Собери свою команду и команду оппонента (3×3), выбери кто ходит вручную, а кто — под ИИ, и прогони бой.
  </p>

  {#if !session}
    <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="space-y-3">
        <TeamBuilder title="Моя команда" bind:slots={myTeam} />
        <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 p-3 space-y-2">
          <label class="flex items-center gap-2 text-sky-200/80 text-sm">
            Режим моей команды:
            <select bind:value={myMode} class="rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1">
              <option value="manual">Ручной</option>
              <option value="ai">ИИ</option>
            </select>
          </label>
          <div class="flex gap-4">
            <DarkCheckbox
              bind:checked={myCritCharm}
              icon={textureUrl('/boosters/charm_critical_1.webp')}
              label="Крит-бустер на аккаунте"
            />
            <DarkCheckbox
              bind:checked={myAnticritCharm}
              icon={textureUrl('/boosters/charm_anticritical_1.webp')}
              label="Антикрит-бустер на аккаунте"
            />
          </div>
        </div>
      </div>
      <div class="space-y-3">
        <TeamBuilder title="Команда оппонента" bind:slots={enemyTeam} />
        <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 p-3 space-y-2">
          <label class="flex items-center gap-2 text-sky-200/80 text-sm">
            Режим оппонента:
            <select bind:value={enemyMode} class="rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1">
              <option value="manual">Ручной</option>
              <option value="ai">ИИ</option>
            </select>
          </label>
          <div class="flex gap-4">
            <DarkCheckbox
              bind:checked={enemyCritCharm}
              icon={textureUrl('/boosters/charm_critical_1.webp')}
              label="Крит-бустер на аккаунте"
            />
            <DarkCheckbox
              bind:checked={enemyAnticritCharm}
              icon={textureUrl('/boosters/charm_anticritical_1.webp')}
              label="Антикрит-бустер на аккаунте"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-3 items-start">
      <button
        type="button"
        onclick={startFight}
        class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white ring-1 ring-white/10"
      >
        Начать бой
      </button>
      <button
        type="button"
        onclick={runBatch}
        disabled={batchRunning}
        class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white ring-1 ring-white/10"
      >
        {batchRunning ? 'Считаю...' : `Оценить шансы (${clampedBatchRuns} симуляций)`}
      </button>
      <label class="flex items-center gap-1.5 text-xs text-sky-300/70">
        Прогонов:
        <input
          type="number"
          min="10"
          max="5000"
          step="10"
          bind:value={batchRuns}
          class="w-20 rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1.5"
        />
      </label>
    </div>

    {#if batchResult}
      <div class="mt-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 max-w-md">
        <div class="text-indigo-200 font-semibold text-sm mb-2">
          Победа моей команды: {batchResult.mineWinRatePct}% ({batchResult.mineWins} из {batchResult.runs})
        </div>
        <div class="h-2 rounded bg-slate-800 overflow-hidden mb-2">
          <div class="h-full bg-indigo-500" style={`width:${batchResult.mineWinRatePct}%`}></div>
        </div>
        <div class="text-indigo-200/70 text-xs space-y-0.5">
          <div>Средняя длительность боя: {batchResult.avgTurns} ходов</div>
          <div>При победе моей команды остаётся ~{batchResult.avgMineHpPctOnWin}% HP</div>
          <div>При победе оппонента у него остаётся ~{batchResult.avgEnemyHpPctOnWin}% HP</div>
        </div>
      </div>
    {/if}
  {:else}
    <div class="mt-6">
      <BattleView {units} {turnLog} {currentTurn} {winner} onResolve={resolveTurn} onAutoPlay={autoPlay} />
      <button
        type="button"
        onclick={reset}
        class="mt-3 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white"
      >
        Собрать заново
      </button>
    </div>
  {/if}
</div>
