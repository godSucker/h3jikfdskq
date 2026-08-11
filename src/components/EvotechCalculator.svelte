<script lang="ts">
  // ВАЖНО: Импорт без alias. Файл должен существовать: src/data/evotech-data.js
  // Формат ожидается как default export массива: [ null, {id:1,gold:...,silver:...}, ... ]
  import EvoRows from '../data/evotech-data.js';

  const MIN_LEVEL = 5;
  const MAX_LEVEL = 1_000_000;
  const PRICE_CONST_FROM_LEVEL = 328;

  // UI
  let mode = $state('forward'); // 'forward' | 'reverse'
  let startLevel = $state('');
  let targetLevel = $state('');
  let silver = $state('');
  let gold = $state('');
  let discount = $state('70'); // 0 | 60 | 70 | 80

  let errorMsg = $state('');
  let busy = $state(false);

  // Результаты (прямой режим)
  let endLevel = $state('—');
  let upgrades = $state('—');
  let spentSilver = $state('—');
  let spentGold = $state('—');
  let leftSilver = $state('—');
  let leftGold = $state('—');
  let hitCap = $state(false);

  // Результаты (обратный режим)
  let neededSilver = $state('—');
  let neededGold = $state('—');

  // =======================
  // Утилиты чисел/строк
  // =======================
  const toBig = (v) => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.max(0, Math.floor(v || 0)));
    const s = String(v ?? '').trim().replace(/[^\d]/g, '');
    return s ? BigInt(s) : 0n;
  }

  // Группировка тысяч — запятыми
  const fmt = (big) => big.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Автоформат ввода с сохранением позиции курсора
  const addCommasFromDigits = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function formatWithCaret(e, setter) {
    const el = e.currentTarget;
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

  const onInputStartLevel  = (e) => formatWithCaret(e, (v) => { startLevel  = v; });
  const onInputTargetLevel = (e) => formatWithCaret(e, (v) => { targetLevel = v; });
  const onInputSilver      = (e) => formatWithCaret(e, (v) => { silver      = v; });
  const onInputGold        = (e) => formatWithCaret(e, (v) => { gold        = v; });

  // =======================
  // Расчёты
  // =======================
  function roundUpPct(x, pct) {
    // применяем скидку: price - pct%
    // итог округляем вверх до целого
    const mul = (100n - BigInt(Math.max(0, Math.min(100, Number(pct || 0))))) ;
    const num = x * mul;
    const den = 100n;
    return num % den === 0n ? (num / den) : (num / den + 1n);
  }

  function getRow(level) {
    const rows = EvoRows;
    if (!Array.isArray(rows) || rows.length < 2) return null;
    // прямой доступ
    if (rows[level] && typeof rows[level].gold === 'number' && typeof rows[level].silver === 'number') {
      return rows[level];
    }

    // fallback: найти последнюю валидную строку ниже уровня
    for (let l = Math.min(level, rows.length - 1); l >= 1; l--) {
      const r = rows[l];
      if (r && typeof r.gold === 'number' && typeof r.silver === 'number') {
        return r;
      }
    }
    return null;
  }

  function costPairAt(level, discountPct) {
    const row = getRow(level);
    if (!row) return { s: 0n, g: 0n };
    const s0 = BigInt(Math.max(0, Math.floor(row.silver || 0)));
    const g0 = BigInt(Math.max(0, Math.floor(row.gold || 0)));
    const d  = BigInt(Math.max(0, Math.min(100, Number(discountPct || 0))));
    const s = roundUpPct(s0, d);
    const g = roundUpPct(g0, d);
    return { s, g };
  }

  function safeConstPair(discountPct) {
    let pair = costPairAt(PRICE_CONST_FROM_LEVEL, discountPct);
    if (pair.s > 0n || pair.g > 0n) return pair;
    // ищем ближайшую ненулевую пару вниз
    for (let l = PRICE_CONST_FROM_LEVEL - 1; l >= MIN_LEVEL + 1; l--) {
      pair = costPairAt(l, discountPct);
      if (pair.s > 0n || pair.g > 0n) return pair;
    }
    return { s: 0n, g: 0n };
  }

  // Обратный режим: сколько ресурсов нужно, чтобы пройти start -> target.
  // Чистая функция (никаких $state-побочек) - суммирует те же costPairAt/safeConstPair,
  // которыми питается прямой simulate(), поэтому оба режима гарантированно согласованы.
  // На каждом уровне серебро и золото - АЛЬТЕРНАТИВНЫЕ цены одного апгрейда (не сумма
  // двух валют), поэтому результат - это "если платить только серебром" и "если платить
  // только золотом" по отдельности, а не один смешанный бюджет.
  function reverseCost(startLevelStr, targetLevelStr, discountStr) {
    const start  = Number(String(startLevelStr).replace(/[^\d]/g, '') || '0');
    const target = Number(String(targetLevelStr).replace(/[^\d]/g, '') || '0');
    const dIn = Number(discountStr || 0);

    if (!Number.isFinite(start) || start < MIN_LEVEL) {
      return { error: `Минимальный стартовый уровень — ${MIN_LEVEL}.` };
    }
    if (!Number.isFinite(target) || target <= start) {
      return { error: 'Целевой уровень должен быть больше стартового.' };
    }
    if (target > MAX_LEVEL) {
      return { error: `Максимальный уровень — ${MAX_LEVEL.toLocaleString('ru-RU')}.` };
    }

    let totalSilver = 0n;
    let totalGold = 0n;

    // До 328 — по строкам файла (как в forward-цикле simulate())
    const loopEnd = Math.min(target, PRICE_CONST_FROM_LEVEL);
    for (let lvl = Math.floor(start) + 1; lvl <= loopEnd; lvl++) {
      const { s, g } = costPairAt(lvl, dIn);
      totalSilver += s;
      totalGold += g;
    }

    // После 328 — постоянная цена (как в constPair-фазе simulate())
    if (target > PRICE_CONST_FROM_LEVEL) {
      const constStart = Math.max(Math.floor(start), PRICE_CONST_FROM_LEVEL);
      const remainLevels = BigInt(target - constStart);
      if (remainLevels > 0n) {
        const { s: sConst, g: gConst } = safeConstPair(dIn);
        if (sConst === 0n && gConst === 0n) {
          return { error: 'Данные стоимости некорректны (нулевая цена после 328).' };
        }
        totalSilver += sConst * remainLevels;
        totalGold += gConst * remainLevels;
      }
    }

    return { silver: totalSilver, gold: totalGold };
  }

  function simulate(startLevelStr, silverStr, goldStr, discountStr) {
    // Вход
    const start = Number(String(startLevelStr).replace(/[^\d]/g, '') || '0');
    const sIn   = toBig(silverStr);
    const gIn   = toBig(goldStr);
    const dIn   = Number(discountStr || 0);

    if (!Number.isFinite(start) || start < MIN_LEVEL) {
      return { error: `Минимальный стартовый уровень — ${MIN_LEVEL}.`, endLevel: MIN_LEVEL };
    }

    let lvl = Math.max(MIN_LEVEL, Math.floor(start));
    let S = sIn;
    let G = gIn;
    let ups = 0;

    const constPair = safeConstPair(dIn);

    // --- До 328 — по строкам файла ---
    while (lvl < PRICE_CONST_FROM_LEVEL) {
      const next = lvl + 1;
      const { s, g } = costPairAt(next, dIn);

      // обе цены нулевые — данных нет; пытаемся двигаться дальше
      if (s === 0n && g === 0n) {
        lvl = next;
        ups++;
        if (lvl >= PRICE_CONST_FROM_LEVEL) break;
        continue;
      }

      // Пытаемся заплатить СНАЧАЛА серебром, потом золотом
      if (s > 0n && S >= s) {
        S -= s; spentS += s; lvl = next; ups++;
        if (lvl >= MAX_LEVEL) break;
        continue;
      }
      if (g > 0n && G >= g) {
        G -= g; spentG += g; lvl = next; ups++;
        if (lvl >= MAX_LEVEL) break;
        continue;
      }
      // не хватает ни той, ни другой — стоп
      break;
    }

    // --- После 328 — массово, по постоянной цене ---
    if (lvl < MAX_LEVEL) {
      const { s: sConst, g: gConst } = constPair;

      // если обе цены нулевые — данные некорректные (иначе бесконечный ап)
      if (sConst === 0n && gConst === 0n) {
        return { error: 'Данные стоимости некорректны (нулевая цена после 328).', endLevel: lvl };
      }

      const remainLevels = BigInt(MAX_LEVEL - lvl);

      // Сколько уровней можно купить серебром по sConst и золотом по gConst
      const canBySilver = sConst > 0n ? (S / sConst) : 0n;
      const canByGold   = gConst > 0n ? (G / gConst) : 0n;

      let add = canBySilver + canByGold;
      if (add > remainLevels) add = remainLevels;

      // Оплатим приоритетно серебром, раз остался порядок — это не критично
      let need = add;
      if (sConst > 0n) {
        const takeS = need;                 // заплатим серебром столько уровней, сколько сможем
        const costS = takeS * sConst;
        const payS  = costS <= S ? costS : (S - (S % sConst));
        const levelsByS = sConst > 0n ? (payS / sConst) : 0n;
        S -= payS; spentS += payS; lvl += Number(levelsByS); ups += Number(levelsByS);
        need -= levelsByS;
      }
      if (need > 0n && gConst > 0n) {
        const costG = need * gConst;
        const payG  = costG <= G ? costG : (G - (G % gConst));
        const levelsByG = gConst > 0n ? (payG / gConst) : 0n;
        G -= payG; spentG += payG; lvl += Number(levelsByG); ups += Number(levelsByG);
        need -= levelsByG;
      }
    }

    const hitCap = lvl >= MAX_LEVEL;

    return {
      endLevel: lvl,
      upgrades: ups,
      leftSilver: S,
      leftGold: G,
      spentSilver: spentS,
      spentGold: spentG,
      hitCap,
    };
  }

  let spentS = $state(0n);
  let spentG = $state(0n);

  async function calculateForward() {
    errorMsg = '';
    busy = true;
    spentS = 0n;
    spentG = 0n;

    try {
      const res = simulate(startLevel, silver, gold, discount);
      if (res.error) {
        errorMsg = res.error;
        endLevel = '—';
        upgrades = '—';
        spentSilver = '—';
        spentGold = '—';
        leftSilver = '—';
        leftGold = '—';
        hitCap = false;
        busy = false;
        return;
      }

      endLevel     = res.endLevel.toLocaleString('ru-RU');
      upgrades     = res.upgrades.toLocaleString('ru-RU');
      spentSilver  = fmt(res.spentSilver);
      spentGold    = fmt(res.spentGold);
      leftSilver   = fmt(res.leftSilver);
      leftGold     = fmt(res.leftGold);
      hitCap       = res.hitCap;

      busy = false;
    } catch {
      errorMsg = 'Ошибка расчёта.';
      busy = false;
    }
  }

  async function calculateReverse() {
    errorMsg = '';
    busy = true;

    try {
      const res = reverseCost(startLevel, targetLevel, discount);
      if (res.error) {
        errorMsg = res.error;
        neededSilver = '—';
        neededGold = '—';
        busy = false;
        return;
      }

      neededSilver = fmt(res.silver);
      neededGold   = fmt(res.gold);
      busy = false;
    } catch {
      errorMsg = 'Ошибка расчёта.';
      busy = false;
    }
  }

  function calculate() {
    if (mode === 'reverse') return calculateReverse();
    return calculateForward();
  }
</script>

<div class="max-w-5xl mx-auto p-4">
  <h1 class="text-2xl md:text-3xl font-bold text-sky-100">Калькулятор эво</h1>
  <p class="text-sky-200/80 mt-1">
    {#if mode === 'forward'}
      Введите стартовый уровень и ресурсы — калькулятор посчитает финальный уровень.
    {:else}
      Введите стартовый и целевой уровень — калькулятор посчитает, сколько ресурсов нужно.
    {/if}
  </p>

  <div class="mt-4 inline-flex rounded-xl border border-slate-700/70 bg-slate-950/60 p-1">
    <button type="button" onclick={() => { mode = 'forward'; errorMsg = ''; }}
      class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors {mode === 'forward' ? 'bg-sky-600 text-white' : 'text-sky-300/80 hover:text-sky-100'}">
      Ресурсы → уровень
    </button>
    <button type="button" onclick={() => { mode = 'reverse'; errorMsg = ''; }}
      class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors {mode === 'reverse' ? 'bg-sky-600 text-white' : 'text-sky-300/80 hover:text-sky-100'}">
      Уровень → ресурсы
    </button>
  </div>

  <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-4 backdrop-blur">
      <h2 class="text-sky-100 font-bold mb-3">Ввод данных</h2>
      <div class="space-y-3">
        <label class="block">
          <span class="text-sky-300/80 text-sm">Стартовый уровень (≥ 5)</span>
          <input id="evo-start-level" name="evo-start-level" type="text" bind:value={startLevel} oninput={onInputStartLevel} inputmode="numeric" placeholder="Например, 120"
            class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
        </label>

        {#if mode === 'forward'}
          <label class="block">
            <span class="text-sky-300/80 text-sm">Серебро</span>
             <input id="evo-silver" name="evo-silver" type="text" bind:value={silver} oninput={onInputSilver} inputmode="numeric" placeholder="Можно оставить пустым"
              class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
          </label>

          <label class="block">
            <span class="text-sky-300/80 text-sm">Золото</span>
             <input id="evo-gold" name="evo-gold" type="text" bind:value={gold} oninput={onInputGold} inputmode="numeric" placeholder="Можно оставить пустым"
                class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
          </label>
        {:else}
          <label class="block">
            <span class="text-sky-300/80 text-sm">Целевой уровень</span>
            <input id="evo-target-level" name="evo-target-level" type="text" bind:value={targetLevel} oninput={onInputTargetLevel} inputmode="numeric" placeholder="Например, 400"
              class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad"/>
          </label>
        {/if}

        <label class="block">
          <span class="text-sky-300/80 text-sm">Скидка</span>
           <select id="evo-discount" name="evo-discount" bind:value={discount}
               class="mt-1 w-full rounded-xl border border-slate-700/70 bg-slate-950/60 text-sky-100 outline-none focus:ring-2 focus:ring-sky-500/60 evo-pad">
            <option value="0">0%</option>
            <option value="60">60%</option>
            <option value="70">70%</option>
            <option value="80">80%</option>
          </select>
        </label>

        <div class="pt-2">
          <button onclick={calculate}
                  class="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white ring-1 ring-white/10 disabled:opacity-60"
                  disabled={busy}>
            {busy ? 'Считаю…' : 'Рассчитать'}
          </button>
        </div>
      </div>
    </div>

    <div class="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-4 backdrop-blur">
      <h2 class="text-sky-100 font-bold mb-3">Результат</h2>
      {#if errorMsg}
        <div class="text-rose-300/90">{errorMsg}</div>
      {:else if mode === 'forward'}
        <div class="space-y-1.5">
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Финальный уровень:</span><strong>{endLevel}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Поднятно уровней:</span><strong>{upgrades}</strong></div>
          <hr class="my-2 border-slate-700/70" />
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Потрачено серебра:</span><strong>{spentSilver}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Потрачено золота:</span><strong>{spentGold}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Остаток серебра:</span><strong>{leftSilver}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Остаток золота:</span><strong>{leftGold}</strong></div>
        </div>
        <p class="mt-3 text-sky-200/70 text-sm">
          Можно вводить только золото или только серебро — калькулятор сам поймёт.
        </p>
        {#if hitCap}
          <p class="mt-1 text-sky-300/80 text-sm">Достигнут верхний предел уровня.</p>
        {/if}
      {:else}
        <div class="space-y-1.5">
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Нужно серебра:</span><strong>{neededSilver}</strong></div>
          <div class="flex justify-between gap-2"><span class="text-sky-300/80">Нужно золота:</span><strong>{neededGold}</strong></div>
        </div>
      {/if}
    </div>
  </div>
</div>
<style>
.evo-pad { padding-left: 16px; }
</style>
