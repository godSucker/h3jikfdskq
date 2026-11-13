<script lang="ts">
  import { onMount } from 'svelte';
  import EvoRows from '../data/evotech-data.js';
  import evoDiscount from '../data/evo-discount.json';
  import { t, type Locale } from '@/lib/i18n';
  import {
    MIN_LEVEL,
    MAX_LEVEL,
    createEvoModel,
    solveForward,
    solveReverse,
    validateLevels,
    type EvoError,
    type ForwardResult,
    type ReverseResult,
    type Range,
  } from '@/lib/evotech';

  type TechTile = { start: string; end: string | null; approx: boolean };
  let { locale = 'ru' as Locale, techTiles = [] as TechTile[] }: { locale?: Locale; techTiles?: TechTile[] } = $props();

  // Тот же приём, что INTL_LOCALE в TopMutantsBrowser.svelte (не общий модуль).
  const INTL_LOCALE: Record<Locale, string> = {
    ru: 'ru-RU', en: 'en-US', es: 'es-ES', fr: 'fr-FR',
    de: 'de-DE', pt: 'pt-BR', it: 'it-IT', tr: 'tr-TR', nl: 'nl-NL',
  };

  // Актуальная скидка из игры (src/data/evo-discount.json, обновляется часовым пайплайном):
  // HC - золото, SC - серебро, независимо. null = акции нет.
  const liveGold: number | null = evoDiscount.gold;
  const liveSilver: number | null = evoDiscount.silver;
  const liveActive = liveGold !== null || liveSilver !== null;
  // Без активной акции скидка по умолчанию 0%: 70% давало бы завышенный результат,
  // когда акции на самом деле нет.
  const DEFAULT_DISCOUNT = '0';

  // UI
  let mode = $state('forward'); // 'forward' | 'reverse'
  let startLevel = $state('');
  let targetLevel = $state('');
  let silver = $state('');
  let gold = $state('');
  let discountSilver = $state(liveActive ? String(liveSilver ?? 0) : DEFAULT_DISCOUNT);
  let discountGold = $state(liveActive ? String(liveGold ?? 0) : DEFAULT_DISCOUNT);
  const differsFromLive = $derived(
    liveActive &&
      (discountSilver !== String(liveSilver ?? 0) || discountGold !== String(liveGold ?? 0)),
  );
  const discountOptions = [
    ...new Set([0, 50, 60, 70, 80, liveSilver ?? 0, liveGold ?? 0].map(Number)),
  ].sort((x, y) => x - y);
  function applyLive() {
    discountSilver = String(liveSilver ?? 0);
    discountGold = String(liveGold ?? 0);
  }

  // Ближайшая скидка по плиткам анонсов. Считается после монтирования: build-time данные
  // против времени посетителя, иначе SSR и клиент разошлись бы.
  let mounted = $state(false);
  onMount(() => { mounted = true; });
  const INTL_DATE = () => INTL_LOCALE[locale] ?? 'ru-RU';
  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(INTL_DATE(), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso));
  const nextDiscountLabel = $derived.by(() => {
    if (!mounted) return '';
    const now = Date.now();
    const next = techTiles
      .filter((x) => Date.parse(x.start) > now)
      .sort((x, y) => Date.parse(x.start) - Date.parse(y.start))[0];
    if (!next) return '';
    return (next.approx ? '≈ ' : '') + fmtDay(next.start) + (next.end ? ' – ' + fmtDay(next.end) : '');
  });

  let errorMsg = $state('');
  let busy = $state(false);

  // Результаты
  let fwd: ForwardResult | null = $state(null);
  let rev: ReverseResult | null = $state(null);
  // Тот же расчёт при скидке 80% (только факт для сравнения, без советов). null - не показываем.
  let fwd80: ForwardResult | null = $state(null);
  let rev80: ReverseResult | null = $state(null);
  let revOwned = $state(false); // игрок указал свои ресурсы

  // =======================
  // Утилиты чисел/строк
  // =======================
  const toBig = (v: unknown): bigint => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.max(0, Math.floor(v || 0)));
    const s = String(v ?? '').trim().replace(/[^\d]/g, '');
    return s ? BigInt(s) : 0n;
  }

  // Группировка тысяч по локали (BigInt.toLocaleString поддерживает
  // произвольную точность, в отличие от Number).
  const fmt = (big: bigint) => big.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU');

  // Автоформат ввода с сохранением позиции курсора
  const addCommasFromDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function formatWithCaret(e: Event, setter: (v: string) => void) {
    const el = e.currentTarget as HTMLInputElement;
    const raw = el.value ?? '';
    const selEnd = typeof el.selectionEnd === 'number' ? el.selectionEnd : raw.length;

    // Сколько ЦИФР было слева от курсора в исходной строке
    let digitsBefore = 0;
    for (let i = 0; i < selEnd; i++) {
      const code = raw.charCodeAt(i);
      if (code >= 48 && code <= 57) digitsBefore++;
    }

    const digitsAll = raw.replace(/[^\d]/g, '');
    const formatted = addCommasFromDigits(digitsAll);
    setter(formatted);

    // Восстановить каретку: ставим её после тех же digitsBefore цифр
    let pos = 0, count = 0;
    while (pos < formatted.length) {
      const code = formatted.charCodeAt(pos);
      if (code >= 48 && code <= 57) {
        count++;
        if (count === digitsBefore) { pos++; break; }
      }
      pos++;
    }
    const newPos = pos;

    // Отложить, чтобы значение успело обновиться
    requestAnimationFrame(() => {
      try { el.setSelectionRange(newPos, newPos); } catch {}
    });
  }

  const onInputStartLevel  = (e: Event) => formatWithCaret(e, (v: string) => { startLevel  = v; });
  const onInputTargetLevel = (e: Event) => formatWithCaret(e, (v: string) => { targetLevel = v; });
  const onInputSilver      = (e: Event) => formatWithCaret(e, (v: string) => { silver      = v; });
  const onInputGold        = (e: Event) => formatWithCaret(e, (v: string) => { gold        = v; });

  // =======================
  // Расчёты (логика - в @/lib/evotech)
  // =======================
  const ERROR_KEYS: Record<EvoError, string> = {
    minLevel: 'evotech.errorMinLevel',
    targetLessThanStart: 'evotech.errorTargetLessThanStart',
    maxLevel: 'evotech.errorMaxLevel',
    badConstPrice: 'evotech.errorBadConstPrice',
  };
  const errorText = (e: EvoError) =>
    t(ERROR_KEYS[e], locale)
      .replace('{min}', String(MIN_LEVEL))
      .replace('{max}', MAX_LEVEL.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU'))
      .replace('{n}', '328');

  const toLevel = (v: string) => Number(String(v).replace(/[^\d]/g, '') || '0');
  const buildModel = () =>
    createEvoModel(EvoRows, {
      silver: Number(discountSilver || 0),
      gold: Number(discountGold || 0),
    });

  const fmtRanges = (ranges: Range[]) =>
    ranges.length === 0
      ? '—'
      : ranges
          .map(([a, b]) => {
            const f = (n: number) => n.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU');
            return a === b ? f(a) : `${f(a)}–${f(b)}`;
          })
          .join(', ');

  const below80 = () => Number(discountSilver || 0) < 80 || Number(discountGold || 0) < 80;
  const model80 = () => createEvoModel(EvoRows, { silver: 80, gold: 80 });

  function calculate() {
    errorMsg = '';
    fwd = null;
    rev = null;
    fwd80 = null;
    rev80 = null;
    busy = true;
    try {
      const start = toLevel(startLevel);
      const isReverse = mode === 'reverse';
      const target = isReverse ? toLevel(targetLevel) : null;
      const bad = validateLevels(start, target);
      if (bad) {
        errorMsg = errorText(bad);
        return;
      }
      const model = buildModel();
      if (model.badConstPrice) {
        errorMsg = errorText('badConstPrice');
        return;
      }
      if (isReverse) {
        revOwned = toBig(silver) > 0n || toBig(gold) > 0n;
        rev = solveReverse(model, start, target as number, toBig(silver), toBig(gold));
        if (below80()) {
          rev80 = solveReverse(model80(), start, target as number, toBig(silver), toBig(gold));
        }
      } else {
        fwd = solveForward(model, start, toBig(silver), toBig(gold));
        if (below80()) {
          const alt = solveForward(model80(), start, toBig(silver), toBig(gold));
          if (alt.endLevel > fwd.endLevel) fwd80 = alt;
        }
      }
    } catch {
      errorMsg = t('evotech.errorCalc', locale);
    } finally {
      busy = false;
    }
  }
</script>

<div class="max-w-5xl mx-auto p-4">
  <h1 class="text-2xl md:text-3xl font-bold text-sky-100">{t('evotech.heading', locale)}</h1>
  <p class="text-sky-200/80 mt-1">
    {#if mode === 'forward'}
      {t('evotech.subtitleForward', locale)}
    {:else}
      {t('evotech.subtitleReverse', locale)}
    {/if}
  </p>

  <div class="mt-4 inline-flex rounded-xl border border-slate-700/70 bg-slate-950/60 p-1">
    <button type="button" onclick={() => { mode = 'forward'; errorMsg = ''; }}
      class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors {mode === 'forward' ? 'bg-sky-600 text-white' : 'text-sky-300/80 hover:text-sky-100'}">
      {t('evotech.modeForward', locale)}
    </button>
    <button type="button" onclick={() => { mode = 'reverse'; errorMsg = ''; }}
      class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors {mode === 'reverse' ? 'bg-sky-600 text-white' : 'text-sky-300/80 hover:text-sky-100'}">
      {t('evotech.modeReverse', locale)}
    </button>
  </div>

  <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-4 backdrop-blur">
      <h2 class="text-sky-100 font-bold mb-3">{t('evotech.inputTitle', locale)}</h2>
      <div class="space-y-3">
        <label class="block">
          <span class="text-sky-300/80 text-sm">{t('evotech.startLevelLabel', locale).replace('{min}', String(MIN_LEVEL))}</span>
          <input id="evo-start-level" name="evo-start-level" type="text" bind:value={startLevel} oninput={onInputStartLevel} inputmode="numeric" placeholder={t('evotech.startLevelPlaceholder', locale)}
            class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
        </label>

        {#if mode === 'reverse'}
          <label class="block">
            <span class="text-sky-300/80 text-sm">{t('evotech.targetLevelLabel', locale)}</span>
            <input id="evo-target-level" name="evo-target-level" type="text" bind:value={targetLevel} oninput={onInputTargetLevel} inputmode="numeric" placeholder={t('evotech.targetLevelPlaceholder', locale)}
              class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
          </label>
        {/if}

        <label class="block">
          <span class="text-sky-300/80 text-sm">{t('evotech.silverLabel', locale)}</span>
           <input id="evo-silver" name="evo-silver" type="text" bind:value={silver} oninput={onInputSilver} inputmode="numeric" placeholder={t('evotech.silverPlaceholder', locale)}
            class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
        </label>

        <label class="block">
          <span class="text-sky-300/80 text-sm">{t('evotech.goldLabel', locale)}</span>
           <input id="evo-gold" name="evo-gold" type="text" bind:value={gold} oninput={onInputGold} inputmode="numeric" placeholder={t('evotech.goldPlaceholder', locale)}
              class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
        </label>
        {#if mode === 'reverse'}
          <p class="text-sky-200/60 text-xs">{t('evotech.ownedHint', locale)}</p>
        {/if}

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-sky-300/80 text-sm">{t('evotech.discountSilverLabel', locale)}</span>
            <select id="evo-discount-silver" name="evo-discount-silver" bind:value={discountSilver}
                class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad">
              {#each discountOptions as d (d)}
                <option value={String(d)}>{d}%</option>
              {/each}
            </select>
          </label>
          <label class="block">
            <span class="text-sky-300/80 text-sm">{t('evotech.discountGoldLabel', locale)}</span>
            <select id="evo-discount-gold" name="evo-discount-gold" bind:value={discountGold}
                class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad">
              {#each discountOptions as d (d)}
                <option value={String(d)}>{d}%</option>
              {/each}
            </select>
          </label>
        </div>
        {#if liveActive}
          <p class="text-emerald-300/90 text-sm">
            {t('evotech.discountHintActive', locale)
              .replace('{gold}', String(liveGold ?? 0))
              .replace('{silver}', String(liveSilver ?? 0))}
          </p>
          {#if differsFromLive}
            <button type="button" onclick={applyLive}
                    class="px-3 py-1.5 rounded-lg text-sm bg-emerald-700/70 hover:bg-emerald-600 text-white ring-1 ring-white/10">
              {t('evotech.discountApplyBtn', locale)}
            </button>
          {/if}
        {:else}
          <p class="text-sky-200/60 text-sm">{t('evotech.discountHintNone', locale)}</p>
        {/if}
        {#if nextDiscountLabel}
          <p class="text-sky-300/80 text-sm">{t('evotech.nextDiscount', locale).replace('{date}', nextDiscountLabel)}</p>
        {/if}

        <div class="pt-2">
          <button onclick={calculate}
                  class="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white ring-1 ring-white/10 disabled:opacity-60"
                  disabled={busy}>
            {busy ? t('evotech.calculating', locale) : t('evotech.calculateBtn', locale)}
          </button>
        </div>
      </div>
    </div>

    <div class="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-4 backdrop-blur">
      <h2 class="text-sky-100 font-bold mb-3">{t('evotech.resultTitle', locale)}</h2>
      {#if errorMsg}
        <div class="text-rose-300/90">{errorMsg}</div>
      {:else if mode === 'forward' && fwd}
        <div class="space-y-1.5">
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.finalLevel', locale)}</span><strong>{fwd.endLevel.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU')}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.upgradesLabel', locale)}</span><strong>{fwd.upgrades.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU')}</strong></div>
          <hr class="my-2 border-slate-700/70" />
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.spentSilverLabel', locale)}</span><strong>{fmt(fwd.spentSilver)}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.spentGoldLabel', locale)}</span><strong>{fmt(fwd.spentGold)}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.leftSilverLabel', locale)}</span><strong>{fmt(fwd.leftSilver)}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.leftGoldLabel', locale)}</span><strong>{fmt(fwd.leftGold)}</strong></div>
        </div>
        {#if fwd.upgrades > 0}
          <div class="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3 text-sm space-y-1">
            <div class="text-sky-100 font-semibold">{t('evotech.planTitle', locale)}</div>
            {#if fwd.silverRanges.length > 0}
              <div class="text-sky-200/90">{t('evotech.planSilver', locale).replace('{ranges}', fmtRanges(fwd.silverRanges))}</div>
            {/if}
            {#if fwd.goldRanges.length > 0}
              <div class="text-sky-200/90">{t('evotech.planGold', locale).replace('{ranges}', fmtRanges(fwd.goldRanges))}</div>
            {/if}
            <div class="text-sky-200/60 text-xs pt-1">{t('evotech.planNote', locale)}</div>
          </div>
        {/if}
        {#if fwd80}
          <p class="mt-3 text-sky-200/80 text-sm">
            {t('evotech.at80Forward', locale)
              .replace('{level}', fwd80.endLevel.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU'))
              .replace('{now}', fwd.endLevel.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU'))}
          </p>
        {/if}
        {#if fwd.next}
          <p class="mt-3 text-sky-200/80 text-sm">
            {t('evotech.nextShortfall', locale)
              .replace('{level}', fwd.next.level.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU'))
              .replace('{gold}', fmt(fwd.next.extraGold))
              .replace('{silver}', fmt(fwd.next.extraSilver))}
          </p>
        {/if}
        <p class="mt-3 text-sky-200/70 text-sm">
          {t('evotech.forwardNote', locale)}
        </p>
        {#if fwd.hitCap}
          <p class="mt-1 text-sky-300/80 text-sm">{t('evotech.hitCapNote', locale)}</p>
        {/if}
      {:else if mode === 'reverse' && rev}
        <div class="space-y-1.5">
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.neededSilverLabel', locale)}</span><strong>{fmt(rev.allSilver)}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">{t('evotech.neededGoldLabel', locale)}</span><strong>{fmt(rev.allGold)}</strong></div>
        </div>
        <p class="mt-2 text-sky-200/60 text-xs">{t('evotech.reverseAltNote', locale)}</p>
        {#if rev80}
          <p class="mt-3 text-sky-200/80 text-sm">
            {t('evotech.at80Reverse', locale)
              .replace('{silver}', fmt(rev80.allSilver))
              .replace('{gold}', fmt(rev80.allGold))
              .replace('{saveSilver}', fmt(rev.allSilver - rev80.allSilver))
              .replace('{saveGold}', fmt(rev.allGold - rev80.allGold))}
          </p>
          {#if revOwned}
            <p class="text-sky-200/70 text-sm">
              {#if rev80.enough}
                {t('evotech.at80Enough', locale)}
              {:else}
                {t('evotech.at80Shortfall', locale)
                  .replace('{gold}', fmt(rev80.extraGold))
                  .replace('{silver}', fmt(rev80.extraSilver))}
              {/if}
            </p>
          {/if}
        {/if}
        {#if revOwned}
          <div class="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3 text-sm space-y-1">
            {#if rev.enough}
              <div class="text-emerald-300/90 font-semibold">{t('evotech.reverseEnough', locale)}</div>
              <div class="text-sky-100 font-semibold pt-1">{t('evotech.planTitle', locale)}</div>
              {#if rev.silverRanges.length > 0}
                <div class="text-sky-200/90">{t('evotech.planSilver', locale).replace('{ranges}', fmtRanges(rev.silverRanges))}</div>
              {/if}
              {#if rev.goldRanges.length > 0}
                <div class="text-sky-200/90">{t('evotech.planGold', locale).replace('{ranges}', fmtRanges(rev.goldRanges))}</div>
              {/if}
            {:else}
              <div class="text-amber-300/90 font-semibold">
                {t('evotech.reverseShortfall', locale)
                  .replace('{gold}', fmt(rev.extraGold))
                  .replace('{silver}', fmt(rev.extraSilver))}
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <div class="text-sky-200/60 text-sm">—</div>
      {/if}
    </div>
  </div>
</div>
<style>
.evo-pad { padding-left: 16px; }
</style>
