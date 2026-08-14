<script lang="ts">
  import mutantsRaw from '@/data/mutants/mutants.json'
  import TeamBuilder from './TeamBuilder.svelte'
  import BattleView from './BattleView.svelte'
  import DarkCheckbox from './DarkCheckbox.svelte'
  import { buildBattleUnit, type CombatUnit } from '@/lib/pvp/battle-profile'
  import { createBattleSession, BattleSession, type FighterMode, type TurnChoice } from '@/lib/pvp/fight-engine'
  import { simulateBatch, type BatchResult } from '@/lib/pvp/simulate-batch'
  import { textureUrl } from '@/lib/texture-cdn'
  import { t, type Locale } from '@/lib/i18n'

  let { locale = 'ru' as Locale }: { locale?: Locale } = $props()

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

  // Диапазон уровней команды оппонента - альтернатива фиксированному level на слот.
  // Применяется только к enemyTeam (для неё же buildBattleUnit и так клэмпит по
  // maxLevelForHp конкретного мутанта, так что выход за его личный кап не страшен).
  // Роллится заново на каждый вызов buildTeam(..., true) - и на ручной "Начать бой"
  // (один раз на слот), и на КАЖДЫЙ прогон батч-симуляции (simulate-batch.ts зовёт
  // buildEnemy() свежо в цикле - см. его шапку про "юниты нужно строить заново").
  let enemyLevelRange = $state({ enabled: false, min: 150, max: 300 })

  function rollEnemyLevel(slotLevel: number): number {
    if (!enemyLevelRange.enabled) return slotLevel
    const lo = Math.max(1, Math.min(enemyLevelRange.min, enemyLevelRange.max) || 1)
    const hi = Math.max(lo, enemyLevelRange.max || lo)
    return lo + Math.floor(Math.random() * (hi - lo + 1))
  }
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
  let turnQueue = $derived.by(() => {
    tick
    return session ? session.upcomingQueue(20) : []
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
    anticritCharmActive: boolean,
    randomizeLevel = false
  ) {
    const units = slots.map((s, i) =>
      buildBattleUnit(s.mutantId, {
        level: randomizeLevel ? rollEnemyLevel(s.level) : s.level,
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
    const enemy = buildTeam(enemyTeam, 'enemy', enemyCritCharm, enemyAnticritCharm, true)
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
        () => buildTeam(enemyTeam, 'enemy', enemyCritCharm, enemyAnticritCharm, true),
        runs
      )
      batchRunning = false
    }, 20)
  }
</script>

<div class="max-w-6xl mx-auto p-4">
  <h1 class="text-2xl md:text-3xl font-bold text-sky-100">{t('simulatorsIndex.card.pvp.title', locale)}</h1>
  <p class="text-sky-200/80 mt-1">
    {t('pvp.intro', locale)}
  </p>

  {#if !session}
    <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="space-y-3">
        <TeamBuilder title={t('pvp.team.mine', locale)} bind:slots={myTeam} {locale} />
        <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 p-3 space-y-2">
          <label class="flex items-center gap-2 text-sky-200/80 text-sm">
            {t('pvp.mode.mine', locale)}
            <select bind:value={myMode} class="rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1">
              <option value="manual">{t('pvp.mode.manual', locale)}</option>
              <option value="ai">{t('pvp.mode.ai', locale)}</option>
            </select>
          </label>
          <div class="flex gap-4">
            <DarkCheckbox
              bind:checked={myCritCharm}
              icon={textureUrl('/boosters/charm_critical_1.webp')}
              label={t('pvp.charm.crit', locale)}
            />
            <DarkCheckbox
              bind:checked={myAnticritCharm}
              icon={textureUrl('/boosters/charm_anticritical_1.webp')}
              label={t('pvp.charm.anticrit', locale)}
            />
          </div>
        </div>
      </div>
      <div class="space-y-3">
        <TeamBuilder title={t('pvp.team.opponent', locale)} bind:slots={enemyTeam} disableLevelInputs={enemyLevelRange.enabled} {locale} />
        <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 p-3 space-y-2">
          <DarkCheckbox
            bind:checked={enemyLevelRange.enabled}
            label={t('pvp.enemyLevel.random', locale)}
          />
          {#if enemyLevelRange.enabled}
            <div class="flex items-center gap-2 text-sm text-sky-200/80">
              <label class="flex items-center gap-1">
                {t('pvp.enemyLevel.from', locale)}
                <input
                  type="number"
                  min="1"
                  bind:value={enemyLevelRange.min}
                  class="w-20 rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1"
                />
              </label>
              <label class="flex items-center gap-1">
                {t('pvp.enemyLevel.to', locale)}
                <input
                  type="number"
                  min="1"
                  bind:value={enemyLevelRange.max}
                  class="w-20 rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1"
                />
              </label>
              <span class="text-sky-300/60 text-xs">
                {t('pvp.enemyLevel.hint', locale)}
              </span>
            </div>
          {/if}
          <label class="flex items-center gap-2 text-sky-200/80 text-sm">
            {t('pvp.mode.opponent', locale)}
            <select bind:value={enemyMode} class="rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 px-2 py-1">
              <option value="manual">{t('pvp.mode.manual', locale)}</option>
              <option value="ai">{t('pvp.mode.ai', locale)}</option>
            </select>
          </label>
          <div class="flex gap-4">
            <DarkCheckbox
              bind:checked={enemyCritCharm}
              icon={textureUrl('/boosters/charm_critical_1.webp')}
              label={t('pvp.charm.crit', locale)}
            />
            <DarkCheckbox
              bind:checked={enemyAnticritCharm}
              icon={textureUrl('/boosters/charm_anticritical_1.webp')}
              label={t('pvp.charm.anticrit', locale)}
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
        {t('pvp.startFight', locale)}
      </button>
      <button
        type="button"
        onclick={runBatch}
        disabled={batchRunning}
        class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white ring-1 ring-white/10"
      >
        {batchRunning ? t('pvp.estimateOdds.running', locale) : t('pvp.estimateOdds.button', locale).replace('{n}', String(clampedBatchRuns))}
      </button>
      <label class="flex items-center gap-1.5 text-xs text-sky-300/70">
        {t('pvp.estimateOdds.runsLabel', locale)}
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
          {t('pvp.estimateOdds.result', locale)
            .replace('{pct}', String(batchResult.mineWinRatePct))
            .replace('{wins}', String(batchResult.mineWins))
            .replace('{runs}', String(batchResult.runs))}
        </div>
        <div class="h-2 rounded bg-slate-800 overflow-hidden mb-2">
          <div class="h-full bg-indigo-500" style={`width:${batchResult.mineWinRatePct}%`}></div>
        </div>
        <div class="text-indigo-200/70 text-xs space-y-0.5">
          <div>{t('pvp.estimateOdds.avgTurns', locale).replace('{n}', String(batchResult.avgTurns))}</div>
          <div>{t('pvp.estimateOdds.avgHpMine', locale).replace('{pct}', String(batchResult.avgMineHpPctOnWin))}</div>
          <div>{t('pvp.estimateOdds.avgHpEnemy', locale).replace('{pct}', String(batchResult.avgEnemyHpPctOnWin))}</div>
        </div>
      </div>
    {/if}
  {:else}
    <div class="mt-6">
      <BattleView {units} {turnLog} {currentTurn} {winner} {turnQueue} onResolve={resolveTurn} onAutoPlay={autoPlay} {locale} />
      <div class="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onclick={startFight}
          class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white ring-1 ring-white/10"
        >
          {t('pvp.startFightAgain', locale)}
        </button>
        <button
          type="button"
          onclick={reset}
          class="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white"
        >
          {t('pvp.resetTeams', locale)}
        </button>
      </div>
    </div>
  {/if}
</div>
