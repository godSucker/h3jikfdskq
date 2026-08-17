<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    STAR_COLOR,
    ABILITY_RU,
    geneLabelL,
    bingoLabelL,
    typeLabelL,
    abilityLabelL,
    starLabelL,
  } from '@/lib/mutant-dicts';
  import { orbingMap } from '@/lib/orbing-map';
  import { getSkinName } from '@/lib/localisation';
  import { calculateFinalStats } from '@/lib/stats/unified-calculator';
  import { textureUrl } from '@/lib/texture-cdn';
  import {
    STAR_MULTIPLIERS,
    STAR_ICONS,
    TYPE_ICONS,
    ABILITY_ICONS,
    ABILITY_ALIASES,
    getGeneIcon,
  } from '@/lib/mutant-icons';
  import { baseMutantId as baseId } from '@/lib/utils';
  import { renderObtainWhere } from '@/lib/obtain-render';
  import obtainData from '@/data/mutants/obtain.json';
  import toplistsData from '@/data/mutants/toplists.json';
  import skinIconsData from '@/data/mutants/skin-icons.json';
  import { t, type Locale } from '@/lib/i18n';

  // Топ/анти-топ бейджи - берём только "текущий" (последний) снапшот toplists.json,
  // который пересобирается build-toplists.ts при каждом обновлении mutants.json,
  // поэтому теги всегда актуальны без отдельной ручной синхронизации.
  // i18n-пилот (Батч 11): метки локале-осознанные, поэтому функция, не const.
  function rankCategories(locale: Locale): { key: string; label: string; abilities?: boolean }[] {
    return [
      { key: 'atk1', label: t('modal.statLabel.attack', locale) },
      { key: 'atk2', label: t('modal.statLabel.aoeAttack', locale) },
      { key: 'hp', label: t('modal.statLabel.hp', locale) },
      { key: 'speed', label: t('modal.statLabel.speed', locale) },
      { key: 'silver', label: t('modal.statLabel.silver', locale) },
      { key: 'ability_shield_plus', label: abilityLabelL('ability_shield_plus', locale), abilities: true },
      { key: 'ability_regen_plus', label: abilityLabelL('ability_regen_plus', locale), abilities: true },
      { key: 'ability_retaliate_plus', label: abilityLabelL('ability_retaliate_plus', locale), abilities: true },
      { key: 'ability_slash_plus', label: abilityLabelL('ability_slash_plus', locale), abilities: true },
      { key: 'ability_strengthen_plus', label: abilityLabelL('ability_strengthen_plus', locale), abilities: true },
      { key: 'ability_weaken_plus', label: abilityLabelL('ability_weaken_plus', locale), abilities: true },
    ];
  }
  const RANK_BADGE_THRESHOLD = 10;

  function computeRankBadges(mutantId: string | undefined, locale: Locale): { label: string; rank: number; total: number; worst: boolean }[] {
    if (!mutantId) return [];
    const current = (toplistsData as any[]).find((s) => s.id === 'current');
    if (!current) return [];
    const bucket = current.levels['30'];
    const badges: { label: string; rank: number; total: number; worst: boolean }[] = [];
    for (const cat of rankCategories(locale)) {
      const list = cat.abilities ? bucket.abilities[cat.key] : bucket[cat.key];
      if (!list?.length) continue;
      const idx = list.findIndex((e: any) => e.id === mutantId);
      if (idx === -1) continue;
      const rank = idx + 1;
      const total = list.length;
      // Серебро - плоский показатель уровня, а не боевая эффективность:
      // анти-топ по нему бессмыслен (см. TopMutantsBrowser.svelte).
      if (rank <= RANK_BADGE_THRESHOLD) badges.push({ label: cat.label, rank, total, worst: false });
      else if (cat.key !== 'silver' && rank > total - RANK_BADGE_THRESHOLD)
        badges.push({ label: cat.label, rank: total - rank + 1, total, worst: true });
    }
    return badges.sort((a, b) => a.rank - b.rank).slice(0, 4);
  }

  const OBTAIN_ICON: Record<string, string> = {
    gold_shop: '/cash/hardcurrency.webp',
    credits_shop: '/cash/softcurrency.webp',
    donate: '/mut_icons/donate.png',
    jackpot_hall: '/materials/Material_Jackpot_Token.png',
    event_hall: '/materials/Material_Event_Token.png',
    bingo: '/etc/icon_bingo.webp',
    gacha: '/mut_icons/icon_gacha.webp',
    secret_breeding: '/mut_icons/icon_recipe.webp',
    breeding: '/buildings/breeding_center_1.png',
    breeding_duplicate: '/buildings/breeding_center_1.png',
    box: '/buildings/building_mystery.png',
    bundle: '/mut_icons/donate.png',
    event_raid: '/etc/icon_atk.webp',
    pvp: '/mut_icons/icon_pvp.webp',
    roulette: '/sims/roulette.webp',
    crossover: '/mut_icons/limited.webp',
    unavailable: '/etc/icon_timer.webp',
  };

  let { open = false, mutant = null, star = 'normal', skins = [], onclose = undefined, locale = 'ru' as Locale, names = {} as Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>, obtainNames = {} as Record<string, string> }: {
    open?: boolean;
    mutant?: any;
    star?: string;
    skins?: any[];
    onclose?: () => void;
    locale?: Locale;
    names?: Record<string, { name: string; lore: string; atk1Name: string; atk2Name: string }>;
    obtainNames?: Record<string, string>;
  } = $props();

  // Батч 11 (3): пересборка "where" (не голая подмена - теряла префикс
  // "Набор:"/"Лаки-бокс:" и суффикс-модификатор цены/тира/скина, см.
  // src/lib/obtain-render.ts). obtainNames - obtain-names.{lang}.json,
  // фолбэк target->en уже свёрнут в MutantsPage.astro.
  function displayObtainWhere(o: { type: string; where: string; itemId?: string }): string {
    return renderObtainWhere(o, locale, obtainNames, names);
  }

  const close = () => onclose?.();

  // i18n-пилот (Батч 11): mutants.json остаётся RU-каноном, names.{lang}.json -
  // сиблинг-перевод, ключи - id из mutants.json (всегда lowercase). skins.json
  // хранит id в другом регистре (напр. "Specimen_A_01" vs "specimen_a_01") -
  // без нормализации лукап молча промахивается для любого выбранного скина
  // (найдено 2026-08-14 живым тестом: атаки откатывались на RU только при
  // переключении скина, не звезды - там id всегда из mutants.json). RU-фолбэк,
  // если для конкретного id перевода нет.
  function namesFor(id: unknown): { name: string; lore: string; atk1Name: string; atk2Name: string } | undefined {
    return names[String(id ?? '').toLowerCase()];
  }
  function displayName(it: any): string {
    return namesFor(it?.id)?.name || it?.name || '';
  }
  function displayLore(it: any): string {
    return namesFor(it?.id)?.lore || it?.name_lore || '';
  }

  const rankBadges = $derived(computeRankBadges(mutant?.id, locale));

  // ===== Star switching =====
  const STAR_SWITCHER_BLOCKED = new Set(['specimen_bf_11', 'specimen_ce_10']);
  let selectedStar = $state('normal');

  $effect(() => {
    if (mutant?.stars) {
      const available = Object.keys(mutant.stars);
      if (available.includes(star)) {
        selectedStar = star;
      } else if (available.length > 0) {
        selectedStar = available[0];
      }
    } else {
      selectedStar = star || 'normal';
    }
  });

  let availableStars = $derived(mutant?.stars ? (() => {
    const stars = ['normal', 'bronze', 'silver', 'gold', 'platinum'];
    return stars.filter(s => mutant.stars?.[s]);
  })() : []);
  let currentMultiplier = $derived(mutant?.stars?.[selectedStar]?.multiplier ?? STAR_MULTIPLIERS[selectedStar] ?? 1.0);
  // Ряд звёзд рисуем, если звёзд больше одной ИЛИ есть скины (тогда единственная
  // звезда служит кнопкой «убрать скин»). Заблокированные мутанты — без ряда.
  let showStarRow = $derived(
    availableStars.length > 0 &&
    (availableStars.length > 1 || skins.length > 0) &&
    !STAR_SWITCHER_BLOCKED.has(mutant?.id)
  );

  // ===== Skin switching =====
  let selectedSkin = $state(null);

  $effect(() => {
    if (mutant?.id) {
      selectedSkin = null;
    }
  });

  let displayMutant = $derived(selectedSkin ?? mutant);
  // В skins.json отсутствие звезды записано как "none" — это не ключ STAR_LABEL/stars.
  const normStar = (s?: string | null) =>
    !s || s === 'none' ? 'normal' : s;
  let skinStar = $derived(normStar(selectedSkin?.star));
  // Метка звезды в шапке: у скина своя звезда, она главнее выбранной вручную.
  let shownStar = $derived(selectedSkin ? skinStar : selectedStar);
  // Кандидаты главной картинки + указатель на текущий; onerror двигает указатель.
  let heroSrcs = $derived(
    selectedSkin
      ? heroCandidates(selectedSkin, skinStar)
      : heroCandidates(mutant, selectedStar)
  );
  let heroIdx = $state(0);
  // Сброс при смене мутанта/скина/звезды: heroSrcs пересобирается -> начинаем с лучшего.
  $effect(() => {
    void heroSrcs; // зависимость: пересборка кандидатов сбрасывает указатель
    heroIdx = 0;
  });
  // Skin uses its own star for multiplier; base mutant uses selectedStar
  let displayMultiplier = $derived(
    selectedSkin
      ? (mutant?.stars?.[skinStar]?.multiplier ?? STAR_MULTIPLIERS[skinStar] ?? 1.0)
      : currentMultiplier
  );

  // Иконки скинов - официальный арт игры (assets/gachacontent/icon_<gachaId>.png на
  // Kobojo CDN), .png. Ключ = живой gachaId, тот же id, что хранится в skins.json
  // (skin-поле, генерится из gacha.xml). Карта живёт в data/mutants/skin-icons.json,
  // а не здесь - её умеет пополнять scripts/sync-skin-icons.ts. Часть skin id НЕ
  // имеют иконки на CDN игры вообще (404, не баг сайта) - для них skinIcon() вернёт
  // null, кнопка скина откатится на текстуру скина через onerror-фолбэк (см. память
  // skin-icons-cdn).
  const SKIN_ICON: Record<string, string> = skinIconsData;
  const skinIcon = (skinName: string) => {
    if (!skinName) return null;
    if (SKIN_ICON[skinName]) return SKIN_ICON[skinName];
    const lower = skinName.toLowerCase();
    if (SKIN_ICON[lower]) return SKIN_ICON[lower];
    // Normalize Unicode apostrophes and special chars
    const normalized = lower.replace(/[\u2018\u2019\u201A\uFF07]/g, "'").replace(/[^a-z0-9'_ ]/g, '');
    for (const [key, val] of Object.entries(SKIN_ICON)) {
      const normKey = key.toLowerCase().replace(/[\u2018\u2019\u201A\uFF07]/g, "'").replace(/[^a-z0-9'_ ]/g, '');
      if (normKey === normalized) return val;
    }
    return null;
  };

  // ===== helpers =====

  // Bingo from mutant data directly
  let displayBingo = $derived((() => {
    const raw = displayMutant?.bingo;
    let arr: string[] = [];
    if (Array.isArray(raw)) {
      arr = raw.map((x: any) =>
        typeof x === 'string' ? x : (x && typeof x === 'object' && typeof x.key === 'string' ? x.key : '')
      ).filter(Boolean);
    } else if (raw && typeof raw === 'object') {
      arr = Object.keys(raw);
    }
    return arr;
  })());

  // Иконки типов/генов/способностей — единый источник: src/lib/mutant-icons.ts
  const typeIcon = (t?: string | null) => TYPE_ICONS[String(t ?? '').toLowerCase()] ?? null;

  const geneIcon = (code?: string | null) => getGeneIcon(code);

  const ABILITY_RU_INV: Record<string, string> = {};
  for (const k in (ABILITY_RU as any)) {
    const v = (ABILITY_RU as any)[k];
    if (typeof v === 'string') ABILITY_RU_INV[v.toLowerCase()] = k.toLowerCase();
  }
  const abilityIcon = (name?: string | null): string | null => {
    if (!name) return null;
    const raw = String(name).trim().toLowerCase();
    if (ABILITY_ICONS[raw]) return ABILITY_ICONS[raw];
    const ruToCode = ABILITY_RU_INV[raw];
    if (ruToCode && ABILITY_ICONS[ruToCode]) return ABILITY_ICONS[ruToCode];
    const a = ABILITY_ALIASES[raw];
    return a ? (ABILITY_ICONS[a] ?? null) : null;
  };

  // Names (i18n-пилот, Батч 11: names.{lang}.json -> m?.name_attackN -> "Атака N")
  const attackName = (m: any, which: 1 | 2): string => {
    const nm = namesFor(m?.id);
    const translated = nm ? (which === 1 ? nm.atk1Name : nm.atk2Name) : '';
    if (translated) return translated;
    const local = which === 1 ? m?.name_attack1 : m?.name_attack2;
    if (local) return String(local);
    return t(`modal.attack${which}`, locale);
  };
  const abilityLabel = (name?: string) => abilityLabelL(String(name ?? ''), locale);
  const rankBadgeText = (b: { rank: number; label: string; worst: boolean }) =>
    t(b.worst ? 'modal.rankBadge.worst' : 'modal.rankBadge.top', locale)
      .replace('{rank}', String(b.rank)).replace('{label}', b.label);

  // Base fields — reactive to skin selection
  let baseStats = $derived(displayMutant?.base_stats ?? {});

  // Для скинов: hp/atk1/atk2 из skins.json, остальное (speed, silver и т.д.) из mutants.json
  // Скины уже содержат финальные значения на нужном уровне, не нужно применять level scaling
  function getSkinStats(skin: any, mutantBaseStats: any, level: number) {
    const lvl = level === 1 ? 'lvl1' : 'lvl30';
    const skinStats = skin?.base_stats?.[lvl] ?? {};
    const mutantStats = mutantBaseStats?.[lvl] ?? {};
    const abilities = displayMutant?.abilities ?? [];
    const abilityPct = level < 25
      ? (abilities[0]?.pct ?? 0)
      : (abilities[abilities.length > 1 ? 1 : 0]?.pct ?? 0);
    return {
      hp: skinStats.hp ?? 0,
      atk1: skinStats.atk1 ?? 0,
      atk2: skinStats.atk2 ?? 0,
      ability: Math.round((skinStats.atk1 ?? 0) * Math.abs(abilityPct) / 100),
      speed: mutantStats.speed ?? 0,
      silver: mutantStats.silver ?? 0,
    };
  }
  let genes = $derived(Array.isArray(displayMutant?.genes) ? displayMutant.genes[0] : '');

  let displayType = $derived(displayMutant?.type);

  // Reactive stats — recalculated when displayMutant or displayMultiplier change
  // For skins: values are already final in skins.json, no scaling needed
  let statsLvl1 = $derived(selectedSkin
    ? getSkinStats(selectedSkin, mutant?.base_stats, 1)
    : calculateFinalStats(baseStats, 1, displayMultiplier));
  let statsLvl30 = $derived(selectedSkin
    ? getSkinStats(selectedSkin, mutant?.base_stats, 30)
    : calculateFinalStats(baseStats, 30, displayMultiplier));
  let speedDisplay = $derived(Math.round(statsLvl1.speed * 100) / 100);
  let bankLvl1 = $derived(Math.round(statsLvl1.silver));

  // Способность мутанта хранится как база (tier 0, до lvl25) + "plus" (tier 1, с lvl25)
  // ОДНОЙ и той же способности — не отдельная способность на атаку (источник истины:
  // unified-calculator.ts abilityPct1/abilityPct2 и StatsCalculator.svelte calcAbilityRows,
  // где активный тир выбирается ЦЕЛИКОМ по уровню: level>=25 -> plus, иначе база).
  // ВСЕГДА считаем от s1/s30.atk{1,2} (уже отмасштабированы под displayMultiplier), НЕ от
  // предрасчитанных value_atk{1,2}_lvl{1,30} в данных — те посчитаны sync-mutants.ts при
  // множителе 1.0x (см. "Статы при множителе 1.0x (raw)") и НЕ реагируют на смену звезды.
  // Раньше читались напрямую как "быстрый путь" - баг: переключение звезды в модалке
  // масштабировало статы, но не абилку (звезда всегда показывала способность как на
  // обычной/normal), несмотря на то что калькулятор статов считает её правильно.
  const getAbilityValue = (level: number, tierIndex: number, atkSlot: 1 | 2, s1: any, s30: any): number => {
    const abilities = displayMutant?.abilities ?? [];
    const ability = abilities[tierIndex];
    if (!ability) return 0;
    // retaliate работает только через ATK1 - ATK2-слот всегда 0, чтобы вторая строка
    // самогасла (see getRows: value2 === 0 -> ab2 = null), как раньше давали заранее
    // зануленные value_atk2_lvl* в данных.
    if (atkSlot === 2 && String(ability.name || '').toLowerCase().includes('retaliate')) return 0;
    const atk = atkSlot === 1
      ? (level < 25 ? s1.atk1 : s30.atk1)
      : (level < 25 ? s1.atk2 : s30.atk2);
    return Math.round(atk * (Math.abs(ability.pct ?? 0) / 100));
  };

  // Texture — specimen (head) only
  const imgSrc = (m: any, starKey: string) => {
    const starInfo = m?.stars?.[starKey];
    if (starInfo?.images) {
      const list = starInfo.images;
      const specimen = list.find((p: string) => p.includes('specimen'));
      if (specimen) return specimen.startsWith('/') ? specimen : `/${specimen}`;
      const pick = list[0];
      if (pick) return pick.startsWith('/') ? pick : `/${pick}`;
    }
    const list: string[] = m?.image ?? [];
    // Prefer semi-full specimen path for skins
    const semiFull = list.find((p) => p.includes('semi-full'));
    if (semiFull) return semiFull.startsWith('/') ? semiFull : `/${semiFull}`;
    const specimen = list.find((p) => p.includes('specimen'));
    if (specimen) return specimen.startsWith('/') ? specimen : `/${specimen}`;
    const pick = list[0];
    if (!pick) return '/placeholder-mutant.webp';
    return pick.startsWith('/') ? pick : `/${pick}`;
  };

  // Цепочка кандидатов для главной картинки, от лучшего к запасному:
  //   full со звездой -> full без звезды -> голова.
  // Второй шаг обязателен: у мутантов, существующих в одной форме (GACHA),
  // отрендерен только FULL_<code>.png без суффикса звезды.
  const heroCandidates = (m: any, starKey: string): string[] => {
    const abs = (p: string) => (p.startsWith('/') ? p : `/${p}`);
    const out: string[] = [];
    const skinFull = (m?.image ?? []).find((p: string) => p.includes('/full/'));
    if (skinFull) {
      out.push(abs(skinFull));
    } else {
      const code = String(m?.id ?? '')
        .replace(/^specimen[_-]/i, '')
        .replace(/_+(?:normal|bronze|silver|gold|plat.*)$/i, '')
        .toLowerCase();
      if (code) {
        const star = String(starKey || 'normal').toLowerCase();
        if (star && star !== 'normal') out.push(`/textures_by_mutant/${code}/FULL_${code}_${star}.png`);
        out.push(`/textures_by_mutant/${code}/FULL_${code}.png`);
      }
    }
    out.push(imgSrc(m, starKey));
    return out;
  };

  // formatting - тот же приём, что INTL_LOCALE в GuidesPage.astro/EvotechCalculator.svelte
  // (не общий модуль). Раньше fmt()/fmtNoSign() были хардкожены на 'ru-RU' на ВСЕХ
  // локалях (найдено систематическим i18n-аудитом 2026-08-17) - числа на стат-панели
  // рендерились с русской группировкой разрядов независимо от языка страницы.
  const INTL_LOCALE: Record<Locale, string> = {
    ru: 'ru-RU', en: 'en-US', es: 'es-ES', fr: 'fr-FR',
    de: 'de-DE', pt: 'pt-BR', it: 'it-IT', tr: 'tr-TR', nl: 'nl-NL',
  };
  function fmt(n: any): string {
    if (n === undefined || n === null || n === '' || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU');
  }
  function fmtNoSign(v: any): string {
    if (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return '—';
    const num = Number(v);
    if (Number.isFinite(num)) return Math.abs(num).toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU');
    return String(v).replace(/^-+/, '');
  }

  // rows
  type Row = {
    atkName: string;
    dmg: any;
    abCode: string | null;
    abName: string;
    value: any;
    pct: any;
    gene?: string | null;
    isAoe?: boolean;
  };

  function getRows(level: number, s1: any, s30: any) {
    const s = level < 25 ? s1 : s30;
    const atk1 = s.atk1;
    const atk2 = s.atk2;

    const baseLvl = level === 1 ? baseStats.lvl1 : baseStats.lvl30;
    const baseLvl30 = baseStats.lvl30;

    const gene1 =
      baseLvl30?.atk1_gene ?? baseLvl?.atk1_gene ??
      (Array.isArray(genes) && genes[0] ? String(genes[0]).toLowerCase() : 'neutro');

    const gene2 =
      baseLvl30?.atk2_gene ?? baseLvl?.atk2_gene ?? gene1;

    const aoe1 = baseLvl30?.atk1_AOE ?? baseLvl?.atk1_AOE ?? false;
    const aoe2 = baseLvl30?.atk2_AOE ?? baseLvl?.atk2_AOE ?? false;

    const list = (Array.isArray(displayMutant?.abilities) ? displayMutant.abilities : []) as any[];
    const rows: Row[] = [];

    // Тир выбирается один раз по уровню и применяется к обеим строкам (атака1/атака2) —
    // для retaliate getAbilityValue сама возвращает 0 для ATK2-слота, поэтому вторая
    // строка гаснет сама (value2 === 0 -> ab2 = null), без отдельной ветки здесь.
    const tierIndex = level < 25 ? 0 : (list[1] ? 1 : 0);
    const ab1 = list[tierIndex];

    if (ab1) {
      const value1 = getAbilityValue(level, tierIndex, 1, s1, s30);
      rows.push({
        atkName: attackName(displayMutant, 1),
        dmg: atk1,
        abCode: ab1.name || null,
        abName: ab1.name ? abilityLabel(ab1.name) : '—',
        value: value1,
        pct: ab1.pct,
        gene: gene1,
        isAoe: aoe1
      });
    }

    const value2 = ab1 ? getAbilityValue(level, tierIndex, 2, s1, s30) : 0;
    const ab2 = value2 > 0 ? ab1 : null;
    rows.push({
      atkName: attackName(displayMutant, 2),
      dmg: atk2,
      abCode: ab2?.name || null,
      abName: ab2?.name ? abilityLabel(ab2.name) : '—',
      value: value2,
      pct: ab2?.pct ?? 0,
      gene: gene2,
      isAoe: aoe2
    });

    return rows;
  }

  let rowsLvl1 = $derived(getRows(1, statsLvl1, statsLvl30));
  let rowsLvl30 = $derived(getRows(30, statsLvl1, statsLvl30));

  // Misc
  let incubTime = $derived(
    displayMutant?.incub_time ??
    displayMutant?.incubation ??
    displayMutant?.incubation_time ??
    displayMutant?.incubationTime ??
    displayMutant?.incubation_hours ??
    displayMutant?.hatch_time ??
    null
  );

  // Orbing
  const getOrbingImages = (m: any) => {
    if (!m) return null;
    const id = String(m.id || '');
    if (orbingMap[id]) return orbingMap[id];
    const entry = Object.entries(orbingMap).find(([k]) => k.toLowerCase() === id.toLowerCase());
    if (entry) return entry[1];
    const bId = baseId(id);
    const entryBase = Object.entries(orbingMap).find(([k]) => k.toLowerCase() === bId.toLowerCase());
    if (entryBase) return entryBase[1];
    return null;
  };

  let orbingImages = $derived(getOrbingImages(displayMutant));

  // ===== a11y: focus trap =====
  let modalRef: HTMLElement = $state() as HTMLElement;
  let closeBtn: HTMLButtonElement = $state() as HTMLButtonElement;

  function focusFirst() {
    if (!modalRef) return;
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const list = Array.from(modalRef.querySelectorAll<HTMLElement>(selectors))
      .filter((el) => el.offsetParent !== null);
    (list[0] || closeBtn)?.focus();
  }

  function onKeydownTrap(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const items = Array.from(modalRef.querySelectorAll<HTMLElement>(selectors))
      .filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }

  // ESC
  let escHandler: (e: KeyboardEvent) => void;
  onMount(() => {
    escHandler = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', escHandler);
  });
  onDestroy(() => window.removeEventListener('keydown', escHandler));

  $effect(() => {
    if (open) {
      (async () => {
        await tick();
        try { modalRef?.scrollTo({ top: 0, behavior: 'auto' }); } catch {}
        focusFirst();
        // Картинки (герой, сферовки) догружаются после первого тика и могут
        // сдвинуть высоту контента ниже точки скролла - браузер иногда
        // компенсирует это автоскроллом (scroll anchoring). Переустанавливаем
        // scrollTop ещё раз после загрузки всех img внутри модалки - но только
        // пока пользователь ещё не сам поскроллил (короткое окно после
        // открытия), иначе будем мешать обычному скроллу вниз.
        const openedAt = Date.now();
        let userScrolled = false;
        const onUserScroll = () => { userScrolled = true; };
        modalRef?.addEventListener('wheel', onUserScroll, { passive: true, once: true });
        modalRef?.addEventListener('touchmove', onUserScroll, { passive: true, once: true });
        const imgs = Array.from(modalRef?.querySelectorAll('img') ?? []) as HTMLImageElement[];
        for (const img of imgs) {
          if (img.complete) continue;
          img.addEventListener(
            'load',
            () => {
              if (userScrolled || Date.now() - openedAt > 1500) return;
              try { modalRef?.scrollTo({ top: 0, behavior: 'auto' }); } catch {}
            },
            { once: true },
          );
        }
      })();
    }
  });
</script>

{#if open}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-start justify-center p-2 md:p-3 overflow-y-auto overscroll-contain"
  onclick={(e) => { if (e.target === e.currentTarget) close(); }}
  aria-hidden="false"
>
  <div
    bind:this={modalRef}
    role="dialog"
    aria-modal="true"
    aria-labelledby="mutant-title"
    onkeydown={onKeydownTrap}
    tabindex="-1"
    style="overflow-anchor: none;"
    class="modal-2k relative w-full max-w-5xl grid grid-rows-[auto_auto_1fr] md:grid-rows-none md:grid-cols-[minmax(0,38%)_minmax(0,62%)] gap-2 md:gap-4 bg-slate-800/70 rounded-2xl min-h-[96svh] md:min-h-0 md:my-auto md:h-auto md:max-h-[92svh] overflow-y-auto ring-1 ring-white/10"
  >
    <!-- Mobile close button -->
    <button
      class="mobile-close-btn"
      onclick={close}
      aria-label={t('modal.close', locale)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <!-- Left -->
    <div class="bg-gradient-to-b from-slate-900/80 to-slate-800/70 rounded-xl p-2 md:p-3 flex flex-col items-center ring-1 ring-white/10">
      <!-- Звёзды и скины в одном ряду (сбоку друг от друга). -->
      <!-- Ряд звёзд показываем и при единственной звезде, если есть скины: -->
      <!-- эта кнопка работает как «убрать скин» (Крушила и другие SPECIAL с GACHA-скином). -->
      {#if showStarRow || skins.length > 0}
        <div class="flex gap-2 mb-2 flex-wrap justify-center items-center">
          {#if showStarRow}
            {#each availableStars as s}
              <button
                class="star-switch-btn {selectedStar === s && !selectedSkin ? 'active' : ''}"
                onclick={() => { selectedStar = s; selectedSkin = null; }}
                title={starLabelL(s, locale)}
              >
                <img src={textureUrl(STAR_ICONS[s] ?? '/stars/no_stars.webp')} alt={s} class="w-9 h-9 object-contain" />
              </button>
            {/each}
          {/if}
          {#each skins as s}
            <button
              class="skin-switch-btn {selectedSkin === s ? 'active' : ''}"
              onclick={() => { selectedSkin = (selectedSkin === s ? null : s); }}
              title={getSkinName(s.skin, locale) ?? s.skin}
            >
              <!-- Иконка гачи; если её нет на CDN — откатываемся на текстуру самого скина. -->
              <img
                src={textureUrl(skinIcon(s.skin) ?? imgSrc(s, normStar(s.star)))}
                data-fallback-src={textureUrl(imgSrc(s, normStar(s.star)))}
                onerror={(e) => {
                  const t = e.currentTarget as HTMLImageElement;
                  if (!t.dataset.fellBack && t.dataset.fallbackSrc) {
                    t.dataset.fellBack = '1';
                    t.src = t.dataset.fallbackSrc;
                  }
                }}
                alt="" class="w-9 h-9 object-contain" loading="lazy" decoding="async" draggable="false" />

              <span class="text-[9px] leading-tight">{s.skin}</span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="flex-1 flex items-center justify-center w-full">
          <img
            alt={displayMutant?.name}
            src={textureUrl(heroSrcs[Math.min(heroIdx, heroSrcs.length - 1)])}
            onerror={() => {
              // Двигаемся по цепочке: full со звездой -> full без звезды -> голова.
              if (heroIdx < heroSrcs.length - 1) heroIdx += 1
            }}
            oncontextmenu={(e) => e.preventDefault()}
            draggable="false"
            class="mutant-hero-img max-w-full max-h-[55vh] w-auto h-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.55)] image-rendering-auto"
            loading="lazy"
            decoding="async"
          />
      </div>
    </div>

    <!-- Right -->
    <div class="space-y-2 md:space-y-3 p-2 md:p-3 min-w-0">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 id="mutant-title" class="text-lg md:text-xl font-bold tracking-wide break-words">{displayName(mutant)}{selectedSkin ? ` — ${getSkinName(selectedSkin.skin, locale) ?? selectedSkin.skin}` : ''}</h2>
          <div class="mt-0.5 text-xs md:text-sm text-slate-300 flex items-center gap-2 flex-wrap">
            {#if typeIcon(displayType)}
              <span class="inline-flex items-center gap-1 break-words">
                <img class="type-icon opacity-90" src={textureUrl(typeIcon(displayType))} alt="" aria-hidden="true" loading="lazy" decoding="async" />
                {typeLabelL(displayType, locale)}
              </span>
            {:else}
              <span class="break-words">{typeLabelL(displayType, locale)}</span>
            {/if}
            {#if genes}
              <span class="opacity-70">•</span>{geneLabelL(genes, locale)}
            {/if}
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {#if mutant?.tier}
            <span class="px-2 py-1 rounded-full text-[11px] bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-500/40">{t('modal.tierBadge', locale).replace('{n}', String(mutant.tier))}</span>
          {/if}
          <span class={`px-2 py-1 rounded-full text-[10px] ring-1 ${STAR_COLOR[shownStar]}`}>{starLabelL(shownStar, locale)}</span>
        </div>
      </div>

      {#if rankBadges.length}
        <div class="flex flex-wrap gap-1.5">
          {#each rankBadges as b}
            <span class={`px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${b.worst ? 'bg-red-500/15 text-red-200 ring-red-500/40' : 'bg-amber-400/15 text-amber-200 ring-amber-400/40'}`}>
              {b.worst ? '⚠️' : '🏆'} {rankBadgeText(b)}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Lvl 1 -->
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-white/10 px-2 py-1.5 overflow-hidden">
        <div class="text-xs text-slate-300 mb-1.5">{t('modal.statsLvl1', locale)}</div>
        <dl class="grid grid-cols-2 gap-y-[2px] text-sm mb-1">
          <dt class="mut-dt"><span class="row-icon"><img class="stat-icon" src={textureUrl("/etc/icon_hp.webp")} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.hp', locale)}</span></dt><dd class="mut-dd whitespace-nowrap pl-1">{fmt(statsLvl1.hp)}</dd>
          <dt class="mut-dt"><span class="row-icon"><img class="stat-icon" src={textureUrl("/etc/icon_speed.webp")} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.speed', locale)}</span></dt><dd class="mut-dd whitespace-nowrap pl-1">{fmt(speedDisplay)}</dd>
        </dl>

        <div class="mt-1 grid grid-cols-[26px_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-[2px] text-sm min-w-0">
          {#each rowsLvl1 as r}
            <div class="contents group">
              <div class="flex items-center">
                {#if geneIcon(r.gene)}
                  <span class="gene-ico">
                    <img src={textureUrl(geneIcon(r.gene))} alt="" aria-hidden="true" class="w-full h-full" loading="lazy" decoding="async" />
                    {#if r.isAoe}
                      <img src={textureUrl("/genes/atk_multiple.webp")} alt="" aria-hidden="true" class="gene-aoe" loading="lazy" decoding="async" />
                    {/if}
                  </span>
                {/if}
              </div>
              <div class="mut-dt break-words">{r.atkName}</div>
              <div class="mut-dd whitespace-nowrap pl-1">{fmt(r.dmg)}</div>
              <div class="mut-dt break-words flex items-center gap-1.5">
                {#if abilityIcon(r.abCode) || abilityIcon(r.abName)}
                  <img class="ability-icon align-middle" src={textureUrl(abilityIcon(r.abCode) || abilityIcon(r.abName))} alt="" aria-hidden="true" loading="lazy" decoding="async" />
                {/if}
                {r.abName}
              </div>
              <div class="mut-dd text-right min-w-0">
                <div class="break-words">{fmtNoSign(r.value)}</div>
              </div>
            </div>
          {/each}
          {#if !rowsLvl1.length}
            <div class="col-span-5 text-sm text-slate-300">—</div>
          {/if}
        </div>
      </div>

      <!-- Lvl 30 -->
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-white/10 px-2 py-1.5 overflow-hidden">
        <div class="text-xs text-slate-300 mb-1.5">{t('modal.statsLvl30', locale)}</div>
        <dl class="grid grid-cols-2 gap-y-[2px] text-sm mb-1">
          <dt class="mut-dt"><span class="row-icon"><img class="stat-icon" src={textureUrl("/etc/icon_hp.webp")} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.hp', locale)}</span></dt><dd class="mut-dd whitespace-nowrap pl-1">{fmt(statsLvl30.hp)}</dd>
          <dt class="mut-dt"><span class="row-icon"><img class="stat-icon" src={textureUrl("/etc/icon_speed.webp")} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.speed', locale)}</span></dt><dd class="mut-dd whitespace-nowrap pl-1">{fmt(speedDisplay)}</dd>
        </dl>

        <div class="mt-1 grid grid-cols-[26px_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-[2px] text-sm min-w-0">
          {#each rowsLvl30 as r}
            <div class="contents group">
              <div class="flex items-center">
                {#if geneIcon(r.gene)}
                  <span class="gene-ico">
                    <img src={textureUrl(geneIcon(r.gene))} alt="" aria-hidden="true" class="w-full h-full" loading="lazy" decoding="async" />
                    {#if r.isAoe}
                      <img src={textureUrl("/genes/atk_multiple.webp")} alt="" aria-hidden="true" class="gene-aoe" loading="lazy" decoding="async" />
                    {/if}
                  </span>
                {/if}
              </div>
              <div class="mut-dt break-words">{r.atkName}</div>
              <div class="mut-dd whitespace-nowrap pl-1">{fmt(r.dmg)}</div>
              <div class="mut-dt break-words flex items-center gap-1.5">
                {#if abilityIcon(r.abCode) || abilityIcon(r.abName)}
                  <img class="ability-icon align-middle" src={textureUrl(abilityIcon(r.abCode) || abilityIcon(r.abName))} alt="" aria-hidden="true" loading="lazy" decoding="async" />
                {/if}
                {r.abName}
              </div>
              <div class="mut-dd text-right min-w-0">
                <div class="break-words">{fmtNoSign(r.value)}</div>
              </div>
            </div>
          {/each}
          {#if !rowsLvl30.length}
            <div class="col-span-5 text-sm text-slate-300">—</div>
          {/if}
        </div>
      </div>

      <!-- Bingo -->
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-2 overflow-hidden">
        <div class="text-xs text-slate-300 mb-1"><span class="row-icon"><img class="stat-icon" src={textureUrl("/etc/icon_bingo.webp")} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.bingo', locale)}</span></div>
        {#if displayBingo.length}
          <div class="flex flex-wrap gap-2">
              {#each displayBingo as b}
              <span class="text-[11px] px-2 py-1 rounded-full bg-indigo-500/15 ring-1 ring-indigo-500/40 text-indigo-100 break-words">{bingoLabelL(b, locale)}</span>
            {/each}
          </div>
        {:else}
          <div class="text-sm text-slate-300">—</div>
        {/if}
      </div>

      <!-- Способы получения -->
      {#if mutant?.id && obtainData[mutant.id]?.length}
        <details class="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-2 overflow-hidden">
          <summary class="text-xs text-slate-300 cursor-pointer select-none list-none flex items-center justify-between">
            <span class="row-icon"><img class="stat-icon" src={textureUrl('/cash/hardcurrency.webp')} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.howToObtain', locale)} ({obtainData[mutant.id].length})</span>
            <span class="details-chevron text-slate-400">▾</span>
          </summary>
          <div class="flex flex-col gap-1.5 mt-2">
            {#each obtainData[mutant.id] as o}
              <div class="flex items-center gap-2 text-[12px] text-slate-200">
                <span class="w-11 h-11 shrink-0 flex items-center justify-center">
                  <img class={`${o.type === 'box' || o.type === 'breeding' || o.type === 'breeding_duplicate' ? 'w-11 h-11' : 'w-7 h-7'} object-contain rounded`} src={textureUrl(o.icon ?? OBTAIN_ICON[o.type] ?? '/etc/icon_bingo.webp')} alt="" aria-hidden="true" loading="lazy" decoding="async" />
                </span>
                <span class="break-words">{displayObtainWhere(o)}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}

      <!-- Misc -->
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-2 overflow-hidden">
        <div class="text-xs text-slate-300 mb-1">{t('modal.other', locale)}</div>
        <div class="text-sm text-slate-200 space-y-1">
          <div class="flex items-center gap-2 leading-tight">
            <span class="row-icon"><img class="stat-icon" src={textureUrl("/cash/softcurrency.webp")} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.silverLvl1', locale)}</span>
            <span class="text-white">{fmt(bankLvl1)}</span>
          </div>
          <div class="flex items-center gap-2 leading-tight">
            <span class="row-icon"><img class="stat-icon" src={textureUrl("/etc/icon_timer.webp")} alt="" aria-hidden="true" loading="lazy" decoding="async" />{t('modal.incubation', locale)}</span>
            <span class="text-white">{incubTime ?? '—'}</span>{#if incubTime != null}<span class="opacity-80">{t('modal.minutesShort', locale)}</span>{/if}
          </div>
        </div>
      </div>

      <!-- Description -->
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-2 overflow-hidden">
        <div class="text-xs text-slate-300 mb-1">{t('modal.description', locale)}</div>
        <div class="text-sm text-slate-300 leading-relaxed break-words">
          { displayLore(mutant).trim() || '—' }
        </div>
      </div>

      <!-- Spheres -->
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-2 overflow-hidden">
        <div class="text-xs text-slate-300 mb-2">{t('modal.orbing', locale)}</div>
        {#if orbingImages && orbingImages.rows}
          <div class="flex flex-col items-center gap-3 py-2">
            {#each orbingImages.rows as row}
              <div class="flex items-center justify-center gap-3">
                {#each row as orbFile}
                  <div class="w-12 h-12 md:w-16 md:h-16 flex-shrink-0 relative group">
                    {#if Array.isArray(orbFile)}
                      <img
                        src={textureUrl(orbFile[0].startsWith('special/') ? '/orbs/special/orb_slot_spe.webp' : '/orbs/basic/orb_slot.webp')}
                        alt=""
                        class="absolute inset-0 w-full h-full opacity-40"
                      />
                      <img
                        src={textureUrl(`/orbs/${orbFile[0]}`)}
                        alt="Orb"
                        class="absolute inset-0 z-10 w-full h-full drop-shadow-md transition-transform group-hover:scale-110"
                        style="clip-path: inset(0 50% 0 0);"
                        loading="lazy"
                      />
                      <img
                        src={textureUrl(`/orbs/${orbFile[1]}`)}
                        alt="Orb"
                        class="absolute inset-0 z-10 w-full h-full drop-shadow-md transition-transform group-hover:scale-110"
                        style="clip-path: inset(0 0 0 50%);"
                        loading="lazy"
                      />
                    {:else}
                      <img
                        src={textureUrl(orbFile.startsWith('special/') ? '/orbs/special/orb_slot_spe.webp' : '/orbs/basic/orb_slot.webp')}
                        alt=""
                        class="absolute inset-0 w-full h-full opacity-40"
                      />
                      <img
                        src={textureUrl(`/orbs/${orbFile}`)}
                        alt="Orb"
                        class="relative z-10 w-full h-full drop-shadow-md transition-transform group-hover:scale-110"
                        loading="lazy"
                      />
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-sm text-slate-300 italic flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-500/50 animate-pulse"></span>
            {t('modal.orbingSoon', locale)}
          </div>
        {/if}
      </div>

      <!-- Close -->
      <div class="mt-0 flex items-center justify-end">
        <button
          bind:this={closeBtn}
          class="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 ring-1 ring-indigo-400/50"
          onclick={close}
        >
          {t('modal.close', locale)}
        </button>
      </div>
    </div>
  </div>
</div>
{/if}

<style>
  .stat-icon { width: 24px; height: 24px; display:inline-block; }
  .type-icon { width: 26px; height: 26px; display:inline-block; }
  .ability-icon { width: 24px; height: 24px; display:inline-block; vertical-align: middle; }
  .row-icon { display: inline-flex; align-items: center; gap: .45rem; }
  .mut-dt { color: rgba(255,255,255,.6); }
  .mut-dd { color: rgba(255,255,255,.9); }
  .break-words { overflow-wrap: break-word; word-break: break-word; }
  summary::-webkit-details-marker { display: none; }
  .details-chevron { transition: transform 0.15s ease; }
  details[open] .details-chevron { transform: rotate(180deg); }

  .gene-ico {
    position: relative;
    width: 26px;
    height: 26px;
    display: inline-block;
  }

  .gene-aoe {
    position: absolute;
    right: -6px;
    top: 0;
    bottom: 0;
    margin: auto 0;
    height: 100%;
    width: auto;
    pointer-events: none;
    filter: drop-shadow(0 1px 1px rgba(0,0,0,.55));
    opacity: .88;
    transition: opacity .12s linear;
  }
  .group:hover .gene-aoe { opacity: .96; }

  /* Star switcher */
  .star-switch-btn {
    padding: 4px;
    border-radius: 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    cursor: pointer;
    opacity: 0.5;
    transition: all 0.2s;
  }
  .star-switch-btn:hover { opacity: 0.8; background: rgba(255,255,255,0.1); }
  .star-switch-btn.active {
    opacity: 1;
    background: rgba(6,182,212,0.2);
    border-color: rgba(6,182,212,0.5);
  }

  /* Skin switcher */
  .skin-switch-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    cursor: pointer;
    opacity: 0.5;
    transition: all 0.2s;
    color: rgba(255,255,255,0.6);
  }
  .skin-switch-btn:hover { opacity: 0.8; background: rgba(255,255,255,0.1); }
  .skin-switch-btn.active {
    opacity: 1;
    background: rgba(6,182,212,0.2);
    border-color: rgba(6,182,212,0.5);
    color: #fff;
  }

  @media (max-width: 1200px) {
    .stat-icon { width: 18px; height: 18px; }
    .type-icon { width: 20px; height: 20px; }
    .ability-icon { width: 18px; height: 18px; }
    .gene-ico { width: 20px; height: 20px; }
    .gene-aoe { right: -3px; }
  }

  @media (max-width: 640px) {
    .stat-icon { width: 16px; height: 16px; }
    .type-icon { width: 18px; height: 18px; }
    .ability-icon { width: 16px; height: 16px; }
    .gene-ico { width: 18px; height: 18px; }
    .mut-dt, .mut-dd { font-size: 11px; }
  }

  @media (max-width: 400px) {
    .stat-icon { width: 14px; height: 14px; }
    .type-icon { width: 16px; height: 16px; }
    .ability-icon { width: 14px; height: 14px; }
    .gene-ico { width: 16px; height: 16px; }
    .mut-dt, .mut-dd { font-size: 10px; }
  }

  .mobile-close-btn {
    display: none;
  }
  @media (max-width: 768px) {
    .mobile-close-btn {
      display: flex;
      position: sticky;
      top: 0;
      float: right;
      z-index: 10;
      width: 28px;
      height: 28px;
      align-items: center;
      justify-content: center;
      border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(15,23,42,0.85);
      backdrop-filter: blur(8px);
      color: #ef4444;
      cursor: pointer;
      margin: 4px 4px 0 0;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .mobile-close-btn:active {
      background: rgba(99,102,241,0.3);
      color: #fff;
      transform: scale(0.92);
    }
  }
</style>
