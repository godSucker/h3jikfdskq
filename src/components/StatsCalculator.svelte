<script lang="ts">
  // --- ИМПОРТЫ ДАННЫХ ---
  import mutantsRaw from '@/data/mutants/mutants.json';
  import orbsRaw from '@/data/materials/orbs.json';
  import { orbingMap } from '@/lib/orbing-map';
  import { ABILITY_RU, TYPE_RU, abilityLabelL, typeLabelL, geneLabelL, starLabelL } from '@/lib/mutant-dicts';
  import { normalizeSearch } from '@/lib/search-normalize';
  import { calculateFinalStats, maxLevelForHp } from '@/lib/stats/unified-calculator';
  import { sortMutantsByGene } from '@/lib/mutant-sort';
  import { applySpeedSphere } from '@/lib/stats/speed-sphere-table';
  import { textureUrl } from '@/lib/texture-cdn';
  import { t, type Locale } from '@/lib/i18n';
  import {
    GENE_NAMES,
    GENE_ICONS,
    STAR_KEYS,
    STAR_ICONS,
    STAT_ICONS,
    TYPE_ICONS,
  } from '@/lib/mutant-icons';
  import { baseMutantId } from '@/lib/utils';

  // --- УТИЛИТЫ И КОНСТАНТЫ ---
  let { renderState, locale = 'ru' as Locale, names = {} }: { renderState?: string; locale?: Locale; names?: Record<string, { name: string; atk1Name: string; atk2Name: string }> } = $props();
  // BCP47-теги для Intl/toLocaleString (разделители разрядов и т.п.), не UI-словарь.
  const NUM_LOCALE: Record<Locale, string> = {
    ru: 'ru-RU', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
    pt: 'pt-BR', it: 'it-IT', tr: 'tr-TR', nl: 'nl-NL',
  };
  const numLocale = NUM_LOCALE[locale] ?? 'en-US';
  const renderParams = renderState ? JSON.parse(decodeURIComponent(renderState)) : null;
  // Словари иконок — единый источник: src/lib/mutant-icons.ts
  const GENE_NAME = GENE_NAMES;
  const GENE_ICON = GENE_ICONS;
  const ATTACK_GENE_ICON = GENE_ICONS;
  // Числовой индекс звезды (0..4) -> иконка
  const STAR_ICON = Object.fromEntries(STAR_KEYS.map((k, i) => [i, STAR_ICONS[k]]));
  const STAT_ICON = STAT_ICONS;
  const TYPE_ICON = TYPE_ICONS;

  const SPECIAL_SLOT_COUNT = 1;

  const byGene = sortMutantsByGene;

  // --- ЛОГИКА ОБРАБОТКИ ДАННЫХ ---
  function normalizeMutants(raw) {
    return raw.map((m) => {
      const bId = baseIdOf(m);
      const genesRaw = Array.isArray(m.genes) ? m.genes : [m.genes];
      const genes = genesRaw
        .filter(Boolean)
        .flatMap((g) => String(g || '').toUpperCase().split(''))
        .filter(Boolean);
      const geneKey = genes.join('');
      // Use stars.normal images first, fallback to old image field
      const starValues = Object.values(m.stars ?? {});
      const defaultStarImgs = m.stars?.normal?.images ?? (starValues[0] ? starValues[0].images : undefined);
      const images = normalizeImages(m.image?.length ? m.image : defaultStarImgs);
      const baseStats = m.base_stats || {};
      const lvl1 = baseStats.lvl1 || {};
      const lvl30 = baseStats.lvl30 || {};
      const hpBase = numberOr(baseStats.hp_base, numberOr(lvl1.hp, 0));
      const atk1Base = numberOr(baseStats.atk1_base, numberOr(lvl1.atk1, 0));
      const atk1pBase = numberOr(baseStats.atk1p_base, numberOr(lvl30.atk1, atk1Base));
      const atk2Base = numberOr(baseStats.atk2_base, numberOr(lvl1.atk2, 0));
      const atk2pBase = numberOr(baseStats.atk2p_base, numberOr(lvl30.atk2, atk2Base));
      const speed = numberOr(baseStats.speed_base, numberOr(lvl30.spd, numberOr(lvl1.spd, m.speed)));
      const bankBase = numberOr(baseStats.bank_base, 0);
      const abilityPct1 = numberOr(baseStats.abilityPct1, 0);
      const abilityPct2 = numberOr(baseStats.abilityPct2, 0);

      const typeRaw = tag(m, 'type') ?? m.type ?? '';
      const tierRaw = tag(m, 'tier') ?? m.tier ?? '';
      const typeKey = String(typeRaw || '').trim();
      const typeKind = typeKey.toLowerCase();
      const typeLabel = readableType(typeRaw);
      const tierLabel = readableTier(tierRaw);
      const basicSlotCount = Number.isFinite(m.orbs?.normal) ? m.orbs.normal : slotsForType(typeKind);
      
      // Build available stars from m.stars object
      const availableStars = new Set();
      const mStars = m.stars ?? {};
      if (mStars.normal) availableStars.add(0);
      if (mStars.bronze) availableStars.add(1);
      if (mStars.silver) availableStars.add(2);
      if (mStars.gold) availableStars.add(3);
      if (mStars.platinum) availableStars.add(4);

      const starMultipliers = {
        0: 1.0,
        1: 1.1,
        2: 1.3,
        3: 1.75,
        4: 2.0,
      };
      return {
        id: bId,
        baseId: bId,
        name: (locale !== 'ru' && names[bId]?.name) || m.name,
        type: typeRaw,
        typeKey,
        typeLabel,
        tier: tierRaw,
        tierLabel,
        genes,
        geneKey,
        images,
        hpBase,
        atk1Base,
        atk1PlusBase: atk1pBase,
        atk2Base,
        atk2PlusBase: atk2pBase,
        speed,
        bankBase,
        abilityPct1,
        abilityPct2,
        abilities: normalizeAbilities(m),
        starMultipliers,
        availableStars,
        basicSlotCount,
        specialSlotCount: Number.isFinite(m.orbs?.special) ? m.orbs.special : SPECIAL_SLOT_COUNT,
        attackMeta: buildAttackMeta(m),
        _rawStars: m.stars ?? {},
      };
    });
  }


  function slotsForType(type){
    const key = String(type || '').trim().toLowerCase();
    if (key === 'default') return 1;
    if (key === 'heroic') return 3;
    return 2;
  }
  function baseIdOf(m){
    return baseMutantId(String(m?.id ?? m?.slug ?? m?.specimen ?? m?.name ?? '').trim());
  }
  function readableType(raw){
    const val = String(raw || '').trim();
    if (!val) return '—';
    return TYPE_RU[val] ? typeLabelL(val, locale) : niceLabel(val);
  }
  function readableTier(raw){
    const val = String(raw || '').trim();
    if (!val) return '—';
    // Не через niceLabel(): у тиров "-" — значимый суффикс (1-, 2-, 3-),
    // а niceLabel заменяет его на пробел и триммит, теряя минус.
    return val
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function normalizeImages(img){
    const arr = Array.isArray(img) ? img : [img];
    return arr
      .map((p) => {
        const s = String(p || '').trim();
        if (!s) return '';
        const clean = s.replace(/^\/+/, '');
        return `/${clean}`;
      })
      .filter(Boolean);
  }
  function numberOr(val, fallback){
    const num = Number(val);
    return Number.isFinite(num) ? num : (fallback ?? 0);
  }
  function tag(m, key) {
    if (m.tags && Array.isArray(m.tags)) {
      const t = m.tags.find(t => t.key === key);
      return t?.value ?? null;
    }
    return m[key] ?? null;
  }

  function buildAttackMeta(mutant){
    const base = mutant?.base_stats ?? {};
    const lvl1 = base?.lvl1 ?? {};
    const lvl30 = base?.lvl30 ?? {};
    const meta = {};
    for (const idx of [1, 2]) {
      const geneRaw = firstDefined(
        mutant?.[`atk${idx}_gene`], // Check directly on the mutant object first
        base?.[`atk${idx}_gene`],
        lvl30?.[`atk${idx}_gene`],
        lvl1?.[`atk${idx}_gene`]
      );
      const aoeRaw = firstDefined(
        base?.[`atk${idx}_AOE`],
        lvl30?.[`atk${idx}_AOE`],
        lvl1?.[`atk${idx}_AOE`]
      );
      const localizedAtkName = locale !== 'ru' ? names[baseMutantId(mutant?.id)]?.[`atk${idx}Name`] : null;
      const nameRaw = localizedAtkName || firstDefined(
        mutant?.[`name_attack${idx}`],
        base?.[`atk${idx}_name`],
        lvl30?.[`atk${idx}_name`],
        lvl1?.[`atk${idx}_name`]
      );
      const gene = normalizeAttackGene(geneRaw);
      meta[idx] = {
        gene,
        geneIcon: attackGeneIconPath(gene),
        isAoe: toBoolean(aoeRaw),
        label: niceAttackLabel(idx, nameRaw),
      };
    }
    return meta;
  }

  function firstDefined(...values){
    for (const val of values) {
      if (val === undefined || val === null) continue;
      if (typeof val === 'string' && val.trim() === '') continue;
      return val;
    }
    return null;
  }

  function normalizeAttackGene(raw){
    const val = String(raw ?? '').trim();
    if (!val) return '';
    const lower = val.toLowerCase();
    if (lower === 'neutral' || lower === 'none' || lower === 'all') return 'neutro';
    return lower;
  }

  function attackGeneIconPath(code){
    const key = normalizeAttackGene(code);
    if (!key) return '';
    return ATTACK_GENE_ICON[key] || '';
  }

  function niceAttackLabel(index, rawName){
    const label = String(rawName ?? '').trim();
    if (label) return label;
    return t('stats.attackFallback', locale).replace('{n}', String(index));
  }

  function toBoolean(value){
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (!lower) return false;
      if (['false', 'no', '0'].includes(lower)) return false;
      return true;
    }
    return Boolean(value);
  }
  function abilitySource(m){
    const raw = m?.abilities ?? tag(m, 'abilities') ?? [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') return raw.split(/[;,]/);
    return [];
  }

  function normalizeAbilities(m){
    return abilitySource(m)
      .map((entry) => normalizeAbilityEntry(entry))
      .filter(Boolean);
  }

  function normalizeAbilityEntry(entry){
    if (!entry) return null;
    if (typeof entry === 'string') {
      const code = cleanAbilityCode(entry);
      if (!code) return null;
      return {
        code,
        label: abilityLabel(code),
        baseCode: abilityBaseCode(code),
        tier: abilityUpgradeTier(code),
        pct: null,
        hasAtk1: true,
        hasAtk2: true,
        raw: null,
      };
    }
    if (typeof entry === 'object') {
      const code = cleanAbilityCode(entry.name ?? entry.id ?? entry.code ?? '');
      if (!code) return null;
      const pct = toNumber(entry.pct ?? entry.percent ?? entry.percentage ?? entry.value);
      let hasAtk1 = abilityAppliesTo(entry, 'atk1');
      let hasAtk2 = abilityAppliesTo(entry, 'atk2');
      if (code.includes('retaliate')) {
        hasAtk2 = false;
      }
      return {
        code,
        label: abilityLabel(code),
        baseCode: abilityBaseCode(code),
        tier: abilityUpgradeTier(code),
        pct,
        hasAtk1,
        hasAtk2,
        raw: entry,
      };
    }
    return null;
  }

  function abilityUpgradeTier(code){
    const lower = String(code || '').toLowerCase();
    if (!lower) return 0;
    if (lower.endsWith('_plus_plus')) return 2;
    if (lower.endsWith('_plus')) return 1;
    return 0;
  }

  function abilityBaseCode(code){
    return String(code || '')
      .toLowerCase()
      .replace(/_plus_plus$/i, '')
      .replace(/_plus$/i, '');
  }

  function cleanAbilityCode(raw){
    const name = String(raw || '').trim();
    if (!name) return '';
    const match = name.match(/^([a-zA-Z0-9_]+)/);
    return (match ? match[1] : name).toLowerCase();
  }

  function abilityLabel(code){
    if (!code) return '—';
    // ABILITY_RU[code] был RU-only - abilityLabelL уже используется в
    // остальных местах компонента, здесь его просто забыли подключить.
    const resolved = abilityLabelL(code, locale);
    const ru = resolved !== code ? resolved : niceLabel(code);
    const lower = code.toLowerCase();
    if (lower.endsWith('_plus_plus')) return `${ru} ++`;
    if (lower.endsWith('_plus')) return `${ru} +`;
    return ru;
  }

  function abilityBaseKey(raw){
    const base = String(raw || '')
      .trim()
      .toLowerCase()
      .split('#')[0];
    if (!base) return '';
    return abilityBaseCode(base);
  }

  function abilityCodeFromOrbId(id){
    const normalized = String(id || '')
      .trim()
      .toLowerCase();
    if (!normalized) return '';
    if (normalized.includes('regenerate')) return 'ability_regen';
    if (normalized.includes('retaliate')) return 'ability_retaliate';
    if (normalized.includes('shield')) return 'ability_shield';
    if (normalized.includes('slash')) return 'ability_slash';
    if (normalized.includes('strengthen')) return 'ability_strengthen';
    if (normalized.includes('weaken')) return 'ability_weaken';
    return '';
  }

  function abilityAppliesTo(entry, key){
    const lowerKey = String(key || '').toLowerCase();
    if (lowerKey === 'atk1') {
      return hasAbilityValue(entry, 'value_atk1') || hasAbilityValue(entry, 'atk1');
    }
    if (lowerKey === 'atk2') {
      return hasAbilityValue(entry, 'value_atk2') || hasAbilityValue(entry, 'atk2');
    }
    return true;
  }

  function hasAbilityValue(entry, prefix){
    if (!entry || typeof entry !== 'object') return false;
    const keys = Object.keys(entry);
    return keys.some((k) => k.toLowerCase().startsWith(String(prefix).toLowerCase()) && entry[k] != null && entry[k] !== '');
  }

  function toNumber(value){
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function niceLabel(value){
    const s = String(value || '').trim();
    if (!s) return '—';
    return s
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Списки сфер
  const ORBS = buildOrbCatalog(orbsRaw);

  function buildOrbCatalog(raw){
    const list = Array.isArray(raw) ? raw : [];
    const basic = [];
    const special = [];
    for (const orb of list) {
      if (isTemporaryOrb(orb)) continue;
      
      const id = String(orb.id || '').trim();
      // Убираем сферы 0-2 лвл (обычные и особые)
      // Обычные: orb_basic_attack (0), _01 (1), _02 (2)
      // Особые: orb_special_... (0), _01 (1), _02 (2)
      if (id.endsWith('attack') || id.endsWith('attack_01') || id.endsWith('attack_02') ||
          id.endsWith('life') || id.endsWith('life_01') || id.endsWith('life_02') ||
          id.endsWith('speed') || id.endsWith('speed_01') || id.endsWith('speed_02') ||
          id.includes('critical') || // По задаче убираем все 0-2, критические обычно тоже имеют уровни, но в коде выше они не типизированы явно под расчет статов, но уберем их тоже если они попадают под паттерн.
          id.includes('regenerate') || id.includes('retaliate') || id.includes('shield') ||
          id.includes('slash') || id.includes('strengthen') || id.includes('weaken')) {
        
        // Проверяем уровень по суффиксу
        if (!id.includes('_03') && !id.includes('_04') && !id.includes('_05') && !id.includes('_06') && !id.includes('_07')) {
           // Если это сфера уровня 0 (без суффикса), 1 (_01) или 2 (_02), пропускаем
           if (id.match(/(_01|_02)$/) || !id.match(/_\d+$/)) continue;
        }
      }

      const item = enrichOrb(orb);
      if (!item) continue;
      if (item.category === 'special') special.push(item);
      else basic.push(item);
    }
    return { basic, special };
  }

  // Пресеты сфер из "сферовок" мутанта (вики-данные, та же карта, что и в
  // модалке мутанта) - resolve по id из имени файла ("basic/orb_xxx_04.webp"
  // -> "orb_xxx_04") в объекты каталога ORBS, чтобы применить одним кликом.
  function findOrbingEntry(mutant){
    if (!mutant) return null;
    const id = String(mutant.id || '');
    if (orbingMap[id]) return orbingMap[id];
    const entry = Object.entries(orbingMap).find(([k]) => k.toLowerCase() === id.toLowerCase());
    if (entry) return entry[1];
    const bId = baseMutantId(id);
    const entryBase = Object.entries(orbingMap).find(([k]) => k.toLowerCase() === bId.toLowerCase());
    if (entryBase) return entryBase[1];
    return null;
  }

  function resolveOrbCell(cell){
    const file = Array.isArray(cell) ? cell[0] : cell;
    const m = /^(?:basic|special)\/(.+)\.webp$/.exec(String(file || ''));
    if (!m) return null;
    const id = m[1];
    if (id === 'orb_slot' || id === 'orb_slot_spe') return null; // пустой слот-плейсхолдер
    return ORBS.basic.find((o) => o.id === id) || ORBS.special.find((o) => o.id === id) || null;
  }

  function getOrbingPresets(mutant){
    const data = findOrbingEntry(mutant);
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const presets = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length === 0) continue;
      const resolved = row.map(resolveOrbCell);
      if (resolved.every((o) => o === null)) continue; // строка целиком из плейсхолдеров - не реальный пресет
      const special = resolved[resolved.length - 1];
      const basic = resolved.slice(0, -1);
      presets.push({ basic, special });
    }
    return presets;
  }

  function isTemporaryOrb(orb){
    const id = String(orb?.id || '').toLowerCase();
    if (!id) return false;
    return id.includes('ephemeral') || id.includes('temporary');
  }

  function enrichOrb(orb){
    if (!orb) return null;
    const id = String(orb.id || '').trim();
    if (!id) return null;
    const category = id.startsWith('orb_special') ? 'special' : 'basic';
    const percent = Number(orb.percent ?? orb.pct ?? orb.percentage ?? 0);
    const specialAbility = specialAbilityFromOrb(id, percent);
    const effects = orbEffectsFromId(id, percent, specialAbility);
    return {
      ...orb,
      ...effects,
      percent,
      category,
      icon: `/orbs/${category}/${id}.webp`,
      type: category,
      specialAbility,
    };
  }

  function orbEffectsFromId(id, percent, specialAbility = null){
    const pct = Number.isFinite(percent) ? percent : 0;
    const abs = Math.abs(pct);
    const key = id.toLowerCase();
    if (key.includes('attack')) return { atkPct: pct };
    if (key.includes('health') || key.includes('_hp') || key.includes('life')) return { hpPct: pct };
    if (key.includes('speed')) return { speedPct: pct };
    if (!specialAbility) {
      const abilityCode = abilityCodeFromOrbId(id);
      if (abilityCode) {
        const baseCode = abilityBaseCode(abilityCode);
        return {
          abilityPct: abs,
          abilityCode,
          abilityBaseCode: baseCode,
          abilityLabel: abilityLabel(abilityCode),
        };
      }
    }
    return {};
  }

  function specialAbilityFromOrb(id, percent){
    const match = String(id || '')
      .toLowerCase()
      .match(/^orb_special_add([a-z_]+)/);
    if (!match) return null;
    const abilityKey = match[1];
    const code = specialAbilityCode(abilityKey);
    if (!code) return null;
    const pct = toNumber(percent);
    if (!Number.isFinite(pct)) return null;
    const base = abilityBaseCode(code);
    const label = abilityLabel(code);
    const hasAtk1 = true;
    const hasAtk2 = !base.includes('retaliate');
    return {
      code,
      label,
      baseCode: base,
      tier: 0,
      pct,
      hasAtk1,
      hasAtk2,
      raw: { source: 'special-orb', id },
    };
  }

  function specialAbilityCode(key){
    const normalized = String(key || '')
      .trim()
      .toLowerCase();
    if (!normalized) return '';
    if (normalized.startsWith('regenerate')) return 'ability_regen';
    if (normalized.startsWith('retaliate')) return 'ability_retaliate';
    if (normalized.startsWith('shield')) return 'ability_shield';
    if (normalized.startsWith('slash')) return 'ability_slash';
    if (normalized.startsWith('strengthen')) return 'ability_strengthen';
    if (normalized.startsWith('weaken')) return 'ability_weaken';
    return '';
  }

  // Приводим мутантов
  const ALL_MUTANTS = normalizeMutants(mutantsRaw);

  // --- РЕАКТИВНОЕ СОСТОЯНИЕ UI ---
  let query = $state('');                      // строка поиска
  let geneFilter = $state('');                 // '' = все, 'A'..'F' = конкретный ген (single select!)
  let gene2Filter = $state('');                // '' = все, 'A'..'F' = конкретный, 'neutral' = одногенный
  let selected = $state(ALL_MUTANTS[0]);       // текущий мутант
  let level = $state(30);                      // уровень из инпута
  let stars = $state(0);                       // 0..4
  // выбранные сферы: массив из N базовых и 1 спец
  let basicSlots = $state([]);                 // длина = selected.basicSlotCount
  let specialSlot = $state(null);

  // Множители урона для каждой атаки (1 / 0.5 / 0.75 / 1.25 / 1.5)
  let atkMultipliers = $state({ 1: 1, 2: 1 });

  // Состояние интерфейса
  let showCatalog = $state(true); // Показывать ли поиск/каталог слева
  let isCopying = $state(false);  // Состояние "Копируется..."
  let dropdownHost = $state(null as HTMLElement | null);
  let dropdownHost2 = $state(null as HTMLElement | null);
  let openDropdown = $state(null as string | null); // 'basic-i' | 'special' | null
  let collapsedCats = $state(new Set(['attack','health','speed','critical','xp','shield','regenerate','retaliate','slash','strengthen','weaken','other'].flatMap(k => [`basic-${k}`, `special-${k}`]))); // все категории свёрнуты по умолчанию
  let lastMutantId = $state(null as string | null); // Для отслеживания смены мутанта

  // --- РЕЖИМ СРАВНЕНИЯ ---
  let compareMode = $state(false);
  let selected2 = $state(null as any);
  let level2 = $state(30);
  let stars2 = $state(0);
  let basicSlots2 = $state([] as any[]);
  let specialSlot2 = $state(null as any);
  let openDropdown2 = $state(null as string | null);
  let lastMutantId2 = $state(null as string | null);
  let query2 = $state('');
  let showSearch2 = $state(false);
  let showSearch1 = $state(false);
  let atkMultipliers2 = $state({ 1: 1, 2: 1 });

  // --- ИНИЦИАЛИЗАЦИЯ ДЛЯ РЕЖИМА РЕНДЕРА ---
  if (renderParams) {
    const m = ALL_MUTANTS.find((x: any) => x.id === renderParams.id);
    if (m) { lastMutantId = m.id; selected = m; }
    if (renderParams.level) level = renderParams.level;
    if (renderParams.stars != null) stars = renderParams.stars;
    showCatalog = false;
    if (renderParams.orbs) {
      basicSlots = renderParams.orbs.map((id: string | null) => id ? ORBS.basic.find((o) => o.id === id) || ORBS.special.find((o) => o.id === id) || null : null);
    }
    if (renderParams.special) {
      specialSlot = ORBS.special.find((o) => o.id === renderParams.special) || ORBS.basic.find((o) => o.id === renderParams.special) || null;
    }
    if (renderParams.atkMultipliers) atkMultipliers = renderParams.atkMultipliers;
    if (renderParams.compare && renderParams.id2) {
      compareMode = true;
      const m2 = ALL_MUTANTS.find((x: any) => x.id === renderParams.id2);
      if (m2) { lastMutantId2 = m2.id; selected2 = m2; }
      if (renderParams.level2) level2 = renderParams.level2;
      if (renderParams.stars2 != null) stars2 = renderParams.stars2;
      if (renderParams.orbs2) {
        basicSlots2 = renderParams.orbs2.map((id: string | null) => id ? ORBS.basic.find((o) => o.id === id) || ORBS.special.find((o) => o.id === id) || null : null);
      }
      if (renderParams.special2) {
        specialSlot2 = ORBS.special.find((o) => o.id === renderParams.special2) || ORBS.basic.find((o) => o.id === renderParams.special2) || null;
      }
      if (renderParams.atkMultipliers2) atkMultipliers2 = renderParams.atkMultipliers2;
    }
  }

  // --- РАСЧЕТЫ ---
  // фильтрация + сортировка + поиск
  // Auto-reset gene2Filter when geneFilter is cleared
  $effect(() => { if (!geneFilter) gene2Filter = ''; });

  let filtered = $derived(ALL_MUTANTS
      .filter(m => {
        // If geneFilter is empty (meaning "ALL"), show all mutants that match the search
        if (!geneFilter) {
          if (query.trim()) {
            const normalizedQuery = normalizeSearch(query);
            const normalizedName = normalizeSearch(m.name);
            if (!normalizedName.includes(normalizedQuery)) return false;
          }
          return true;
        }
        
        // If geneFilter is set, apply gene filtering
        const firstGene = m.genes[0];
        if (firstGene !== geneFilter) return false;
        
        // If gene2Filter is empty (meaning "ALL"), show all mutants with the selected primary gene
        if (!gene2Filter) {
          if (query.trim()) {
            const normalizedQuery = normalizeSearch(query);
            const normalizedName = normalizeSearch(m.name);
            if (!normalizedName.includes(normalizedQuery)) return false;
          }
          return true;
        }
        
        // Apply secondary gene filter
        if (gene2Filter === 'neutral') {
          // Show only single-gene mutants (exactly one gene)
          if (m.genes.length !== 1) return false;
        } else {
          // Show only exact gene pairs
          if (m.genes.length < 2 || m.genes[1] !== gene2Filter) return false;
        }
        
        // Apply search filter
        if (query.trim()) {
          const normalizedQuery = normalizeSearch(query);
          const normalizedName = normalizeSearch(m.name);
          if (!normalizedName.includes(normalizedQuery)) return false;
        }
        return true;
      })
      .sort(byGene)); // Always use genetic sorting

  // Фильтрованные списки для режима сравнения (без лимита)
  let filtered1 = $derived(
    query.trim()
      ? ALL_MUTANTS.filter(m => normalizeSearch(m.name).includes(normalizeSearch(query))).sort(byGene)
      : ALL_MUTANTS.slice().sort(byGene)
  );
  let filtered2 = $derived(
    query2.trim()
      ? ALL_MUTANTS.filter(m => normalizeSearch(m.name).includes(normalizeSearch(query2))).sort(byGene)
      : ALL_MUTANTS.slice().sort(byGene)
  );

  // смена выбранного мутанта — сбрасываем слоты по его типу и выбираем макс. звезду
  $effect(() => { if (selected && selected.id !== lastMutantId) {
    const count = Number.isFinite(selected.basicSlotCount) ? selected.basicSlotCount : 3;
    basicSlots = Array(count).fill(null);
    specialSlot = null;
    // Auto-select max available star ONLY when mutant changes
    const availableArray = Array.from(selected.availableStars);
    if (availableArray.length > 0) {
      stars = Math.max(...availableArray);
      lastMutantId = selected.id;
    }
  }});

  // Второй мутант: сброс слотов при смене
  $effect(() => { if (selected2 && selected2.id !== lastMutantId2) {
    const count = Number.isFinite(selected2.basicSlotCount) ? selected2.basicSlotCount : 3;
    basicSlots2 = Array(count).fill(null);
    specialSlot2 = null;
    const availableArray = Array.from(selected2.availableStars);
    if (availableArray.length > 0) {
      stars2 = Math.max(...availableArray);
      lastMutantId2 = selected2.id;
    }
  }});

  let orbingPresets = $derived(getOrbingPresets(selected));

  let allowedAbilityBases = $derived(buildAllowedAbilityBases(selected, specialSlot));
  let basicOrbOptions = $derived(filterBasicOrbs(ORBS.basic, allowedAbilityBases));
  let specialOrbOptions = $derived(ORBS.special.filter(o => !isOrbConflicting(o, selected)));
  $effect(() => { if (Array.isArray(basicSlots)) {
    const sanitized = basicSlots.map((orb) => allowOrbForAbilities(orb, allowedAbilityBases) ? orb : null);
    if (!arraysEqual(sanitized, basicSlots)) {
      basicSlots = sanitized;
    }
  }});

  // Второй мутант: orb options
  let orbingPresets2 = $derived(getOrbingPresets(selected2));
  let allowedAbilityBases2 = $derived(buildAllowedAbilityBases(selected2, specialSlot2));
  let basicOrbOptions2 = $derived(filterBasicOrbs(ORBS.basic, allowedAbilityBases2));
  let specialOrbOptions2 = $derived(ORBS.special.filter(o => !isOrbConflicting(o, selected2)));
  $effect(() => { if (Array.isArray(basicSlots2)) {
    const sanitized = basicSlots2.map((orb) => allowOrbForAbilities(orb, allowedAbilityBases2) ? orb : null);
    if (!arraysEqual(sanitized, basicSlots2)) {
      basicSlots2 = sanitized;
    }
  }});

  function figureImage(m, stars){
    if (!m) return '';
    return starTexture(m, stars) || portraitImage(m);
  }

  function portraitImage(m){
    if (!m) return '';
    return findImageByKeywords(m.images, ['specimen', 'icon', 'portrait', 'head']);
  }

  function listThumbnail(m){
    return portraitImage(m) || firstTexture(m.images);
  }

  function starTexture(m, stars){
    if (!m) return '';
    const key = STAR_KEYS[stars] ?? 'normal';
    const starData = m._rawStars?.[key];
    if (starData?.images?.length) {
      const imgs = normalizeImages(starData.images);
      const specimen = findImageByKeywords(imgs, ['specimen']);
      if (specimen) return specimen;
      return imgs[0];
    }
    if (key === 'normal') {
      return baseTexture(m);
    }
    const specimen = findImageByKeywords(m.images, ['specimen']);
    if (specimen) return specimen;
    return baseTexture(m);
  }

  function baseTexture(m){
    if (!m) return '';
    const specimen = findImageByKeywords(m.images, ['specimen']);
    if (specimen) return specimen;
    return (
      findImageByKeywords(m.images, ['normal', 'default'])
      || firstTexture(m.images)
    );
  }

  function firstTexture(list, keyword = null){
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return '';
    if (keyword) {
      const keywords = Array.isArray(keyword) ? keyword : [keyword];
      for (const key of keywords) {
        const lower = String(key || '').toLowerCase();
        const match = arr.find((p) => p && p.toLowerCase().includes(lower));
        if (match) return match;
      }
    }
    return arr[0];
  }

  function findImageByKeywords(list, keywords){
    const arr = Array.isArray(list) ? list : [];
    const keys = Array.isArray(keywords) ? keywords : [];
    for (const key of keys) {
      const lower = String(key || '').toLowerCase();
      const found = arr.find((p) => p && p.toLowerCase().includes(lower));
      if (found) return found;
    }
    return '';
  }

  function typeIconPath(typeKey){
    const raw = String(typeKey || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (TYPE_ICON[lower]) return TYPE_ICON[lower];
    const prefixed = `/mut_icons/icon_${lower}.webp`;
    return prefixed;
  }

  function abilityIconPath(code){
    const raw = String(code || '').trim().toLowerCase();
    if (!raw) return '';
    const stripped = raw
      .replace(/_plus_plus$/i, '')
      .replace(/_plus$/i, '');
    if (stripped === 'ability_regen') {
      return '/ability/ability_regenerate.webp';
    }
    return `/ability/${stripped}.webp`;
  }

  // Применение модификаторов сфер (проценты)
  function calcOrbModifiers(basic, special) {
    const mods = { hpPct: 0, atk1Pct: 0, atk2Pct: 0, speedPct: 0, abilityBonus: {} };
    const basicList = Array.isArray(basic) ? basic.filter(Boolean) : [];
    const all = special ? [...basicList, special] : [...basicList];
    for (const orb of all) {
      if (!orb) continue;
      const hp = toNumber(orb.hpPct ?? orb.hp_percent ?? orb.hp ?? orb.healthPct ?? orb.health);
      if (hp) mods.hpPct += hp;

      const atkCommon = toNumber(orb.atkPct ?? orb.attackPct ?? orb.atk ?? orb.attack);
      if (atkCommon) {
        mods.atk1Pct += atkCommon;
        mods.atk2Pct += atkCommon;
      }

      const atk1 = toNumber(orb.atk1Pct ?? orb.attack1Pct ?? orb.attack_1);
      if (atk1) mods.atk1Pct += atk1;

      const atk2 = toNumber(orb.atk2Pct ?? orb.attack2Pct ?? orb.attack_2);
      if (atk2) mods.atk2Pct += atk2;

      const speed = toNumber(orb.speedPct ?? orb.spdPct ?? orb.speed ?? orb.spd);
      if (speed) mods.speedPct += speed;

      const ability = toNumber(orb.abilityPct ?? orb.ability ?? orb.skillPct ?? orb.skills);
      if (ability) {
        const abilityBase = abilityBaseKey(orb.abilityBaseCode || orb.abilityCode);
        if (abilityBase) {
          mods.abilityBonus[abilityBase] = (mods.abilityBonus[abilityBase] || 0) + ability;
        } else {
          mods.abilityBonus.__all = (mods.abilityBonus.__all || 0) + ability;
        }
      }
    }
    return mods;
  }

  function starMulOf(m, s){
    return m?.starMultipliers?.[s] ?? 1.0;
  }

  // Реального лимита уровня в игре нет - единственный настоящий потолок это int32-баг
  // HP (см. HP_OVERFLOW_THRESHOLD в unified-calculator.ts, тот же порог что и в PvP-
  // калькуляторе). "Серебро" (bank_base × level, без звезды/орбов) считалось отдельно
  // на предмет того же риска: bank_base в данных 42..340, что даёт порог переполнения
  // серебра от ~6.3М до ~51М уровня - на 1-2 порядка выше HP-порога для ЛЮБОГО реального
  // мутанта/звезды/орбов (HP переполняется первым всегда), так что клэмпа по HP тут
  // достаточно, отдельный клэмп по серебру не нужен.
  function computeMaxLevel(m, s, mods){
    if (!m) return 1;
    const starMul = starMulOf(m, s);
    const hpPct = mods?.hpPct || 0;
    return maxLevelForHp((m.hpBase || 0) * starMul * (1 + hpPct / 100));
  }

  function calcStats(m, lvl, s, mods){
    // Use unified smart stats calculator with debug
    const starMul = starMulOf(m, s);
    const baseStats = {
      hp_base: m.hpBase,
      atk1_base: m.atk1Base,
      atk1p_base: m.atk1PlusBase,
      atk2_base: m.atk2Base,
      atk2p_base: m.atk2PlusBase,
      speed_base: m.speed,
      bank_base: m.bankBase,
      abilityPct1: m.abilityPct1,
      abilityPct2: m.abilityPct2,
    };
    const result = calculateFinalStats(baseStats, lvl, starMul);

    // Apply orb modifiers if present
    let finalStats = { ...result };
    if (mods) {
      if (mods.hpPct) finalStats.hp = Math.round(result.hp * (1 + mods.hpPct / 100));
      if (mods.atk1Pct) finalStats.atk1 = Math.round(result.atk1 * (1 + mods.atk1Pct / 100));
      if (mods.atk2Pct) finalStats.atk2 = Math.round(result.atk2 * (1 + mods.atk2Pct / 100));
      if (mods.speedPct) finalStats.speed = applySpeedSphere(result.speed, mods.speedPct);
    }

    return {
      hp: finalStats.hp,
      atk1: finalStats.atk1,
      atk2: finalStats.atk2,
      speed: finalStats.speed,
      bank: finalStats.silver,
    };
  }

  let orbModifiers = $derived(calcOrbModifiers(basicSlots, specialSlot));
  let stats = $derived(selected ? calcStats(selected, level, stars, orbModifiers) : {hp:0, atk1:0, atk2:0, speed:0, bank: 0});
  let abilityRows = $derived(selected ? calcAbilityRows(selected, stats, orbModifiers, level, specialSlot) : []);
  let attackRows = $derived(buildAttackRows(selected, stats, abilityRows));
  let maxLevel = $derived(selected ? computeMaxLevel(selected, stars, orbModifiers) : 1);

  // --- ВТОРОЙ МУТАНТ (сравнение) ---
  let orbModifiers2 = $derived(calcOrbModifiers(basicSlots2, specialSlot2));
  let stats2 = $derived(selected2 ? calcStats(selected2, level2, stars2, orbModifiers2) : {hp:0, atk1:0, atk2:0, speed:0, bank: 0});
  let abilityRows2 = $derived(selected2 ? calcAbilityRows(selected2, stats2, orbModifiers2, level2, specialSlot2) : []);
  let attackRows2 = $derived(buildAttackRows(selected2, stats2, abilityRows2));
  let typeIconCurrent = $derived(selected ? typeIconPath(selected.typeKey || selected.type) : '');
  let typeIconCurrent2 = $derived(selected2 ? typeIconPath(selected2.typeKey || selected2.type) : '');
  let maxLevel2 = $derived(selected2 ? computeMaxLevel(selected2, stars2, orbModifiers2) : 1);

  // Кап уровня зависит от мутанта/звезды/HP-орбов и может ПОНИЗИТЬСЯ после того, как
  // уровень уже был выставлен (смена звезды на более сильную, добавление HP-орба, смена
  // самого мутанта) - тот же паттерн клэмпа, что в TeamBuilder.svelte (PvP-калькулятор).
  $effect(() => {
    if (!(level >= 1)) level = 1;
    else if (level > maxLevel) level = maxLevel;
  });
  $effect(() => {
    if (!(level2 >= 1)) level2 = 1;
    else if (level2 > maxLevel2) level2 = maxLevel2;
  });

  function buildAttackRows(mutant, statLine, abilityList){
    if (!mutant) return [];
    const rows = [1, 2].map((idx) => {
      const meta = mutant?.attackMeta?.[idx] ?? {};
      const damage = Number(statLine?.[`atk${idx}`] ?? 0);
      const effects = [];
      if (Array.isArray(abilityList)) {
        abilityList.forEach((ability) => {
          if (!ability) return;
          const hit = Array.isArray(ability.values)
            ? ability.values.find((val) => val?.attack === idx)
            : null;
          if (!hit) return;
          effects.push({
            label: ability.label,
            percent: ability.percent,
            value: hit.value,
            icon: ability.icon || '',
          });
        });
      }
      const geneIcon = meta.geneIcon || '';
      const isAoe = Boolean(meta.isAoe);
      const label = meta.label || t('stats.attackFallback', locale).replace('{n}', String(idx));
      const gene = meta.gene || '';
      return {
        attack: idx,
        label,
        geneIcon,
        isAoe,
        gene,
        damage,
        effects,
      };
    });
    return rows.filter((row) => row.label || row.damage || row.effects.length);
  }

  function calcAbilityRows(mutant, statLine, mods, lvl, specialOrb){
    const baseList = Array.isArray(mutant?.abilities) ? mutant.abilities : [];
    const combined = [...baseList];
    const orbAbility = specialOrbAbilityEntry(specialOrb);
    if (orbAbility) combined.push(orbAbility);
    if (!combined.length) return [];
    const level = Number(lvl) || 1;
    const result = [];
    const abilityBoosts = mods?.abilityBonus ?? {};
    const atkValues = {
      1: statLine?.atk1 ?? 0,
      2: statLine?.atk2 ?? 0,
    };
    const grouped = new Map();
    for (const ability of combined) {
      if (!ability) continue;
      const base = ability.baseCode || ability.code;
      if (!grouped.has(base)) grouped.set(base, []);
      grouped.get(base).push(ability);
    }

    for (const [, entries] of grouped) {
      if (!entries.length) continue;
      const sorted = [...entries].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
      // Formula override for Wiki-sync data
      const ability = level >= 25 ? sorted[sorted.length - 1] : sorted[0];
      
      let basePct = 0;
      if (ability.raw?.source === 'special-orb') {
        basePct = toNumber(ability.pct);
      } else {
        basePct = level < 25 ? (mutant.abilityPct1 || 0) : (mutant.abilityPct2 || 0);
      }

      if (!Number.isFinite(basePct)) continue;
      const baseKey = abilityBaseKey(ability.baseCode || ability.code);
      const abilityBoost = Math.abs(abilityBoosts[baseKey] ?? abilityBoosts.__all ?? 0);
      const signedPct = basePct >= 0
        ? basePct + abilityBoost
        : -(Math.abs(basePct) + abilityBoost);

      const values = [];
      const isRetaliate = ability.code.toLowerCase().includes('retaliate');

      if (ability.hasAtk1) {
        const meta = mutant?.attackMeta?.[1] ?? {};
        const value = Math.floor(Math.abs((atkValues[1] || 0) * signedPct / 100));
        values.push({
          attack: 1,
          value,
          label: meta.label ?? t('stats.attackFallback', locale).replace('{n}', '1'),
          geneIcon: meta.geneIcon || '',
          isAoe: Boolean(meta.isAoe),
          attackPower: Math.floor(Math.abs(atkValues[1] || 0)),
        });
      }
      if (ability.hasAtk2) {
        const meta = mutant?.attackMeta?.[2] ?? {};
        const value = isRetaliate ? 0 : Math.floor(Math.abs((atkValues[2] || 0) * signedPct / 100));
        if (value || ability.hasAtk1 === false || !values.length || isRetaliate) {
          values.push({
            attack: 2,
            value,
            label: meta.label ?? t('stats.attackFallback', locale).replace('{n}', '2'),
            geneIcon: meta.geneIcon || '',
            isAoe: Boolean(meta.isAoe),
            attackPower: Math.floor(Math.abs(atkValues[2] || 0)),
          });
        }
      }

      if (!values.length) continue;
      result.push({
        code: ability.code,
        label: ability.label,
        values,
        icon: abilityIconPath(ability.code),
        percent: Math.abs(signedPct),
      });
    }
    return result;
  }

  function specialOrbAbilityEntry(orb){
    if (!orb || !orb.specialAbility) return null;
    const ability = orb.specialAbility;
    return {
      ...ability,
      code: ability.code,
      label: ability.label,
      baseCode: ability.baseCode,
      tier: ability.tier ?? 0,
      pct: ability.pct,
      hasAtk1: ability.hasAtk1 !== false,
      hasAtk2: ability.hasAtk2 !== false,
      raw: ability.raw ?? { source: 'special-orb', id: orb.id },
    };
  }

  function buildAllowedAbilityBases(mutant, specialOrb){
    const set = new Set();
    const baseList = Array.isArray(mutant?.abilities) ? mutant.abilities : [];
    for (const ability of baseList) {
      const base = abilityBaseKey(ability?.baseCode || ability?.code);
      if (base) set.add(base);
    }
    const extra = specialOrb?.specialAbility;
    if (extra) {
      const base = abilityBaseKey(extra.baseCode || extra.code);
      if (base) set.add(base);
    }
    return set;
  }

  function allowOrbForAbilities(orb, allowed){
    if (!orb) return true;
    const base = abilityBaseKey(orb.abilityBaseCode || orb.abilityCode);
    if (!base) return true;
    if (!(allowed instanceof Set) || !allowed.size) return false;
    return allowed.has(base);
  }

  function filterBasicOrbs(list, allowed){
    const arr = Array.isArray(list) ? list : [];
    return arr.filter((orb) => allowOrbForAbilities(orb, allowed));
  }

  const CAT_ORDER = ['attack', 'health', 'speed', 'critical', 'xp', 'shield', 'regenerate', 'retaliate', 'slash', 'strengthen', 'weaken', 'other'];

  // Ключи shield/regenerate/retaliate/slash/strengthen/weaken переиспользуют
  // ABILITY_DICT через abilityLabelL (те же названия способностей, единый
  // источник перевода на всех языках).
  const CAT_ABILITY_CODE: Record<string, string> = {
    shield: 'ability_shield',
    regenerate: 'ability_regen',
    retaliate: 'ability_retaliate',
    slash: 'ability_slash',
    strengthen: 'ability_strengthen',
    weaken: 'ability_weaken',
  };
  function catLabel(key: string): string {
    const abilityCode = CAT_ABILITY_CODE[key];
    if (abilityCode) return abilityLabelL(abilityCode, locale);
    return t(`stats.category.${key}`, locale);
  }

  const STAR_KEY_BY_INDEX: Record<number, string> = { 1: 'bronze', 2: 'silver', 3: 'gold', 4: 'platinum' };
  function starTitle(s: number): string {
    if (s === 0) return t('pvp.star.none', locale);
    return starLabelL(STAR_KEY_BY_INDEX[s], locale);
  }

  const CAT_ICONS: Record<string, string> = {
    attack: '/orbs/basic/orb_basic_attack_03.webp',
    health: '/orbs/basic/orb_basic_life_03.webp',
    speed: '/orbs/basic/orb_basic_speed_03.webp',
    critical: '/orbs/basic/orb_basic_critical_03.webp',
    xp: '/orbs/basic/orb_basic_xp_03.webp',
    shield: '/orbs/basic/orb_basic_shield_03.webp',
    regenerate: '/orbs/basic/orb_basic_regenerate_03.webp',
    retaliate: '/orbs/basic/orb_basic_retaliate_03.webp',
    slash: '/orbs/basic/orb_basic_slash_03.webp',
    strengthen: '/orbs/basic/orb_basic_strengthen_03.webp',
    weaken: '/orbs/basic/orb_basic_weaken_03.webp',
  };

  function orbCategoryKey(orb: any): string {
    const id = String(orb?.id || '').toLowerCase();
    if (id.includes('attack')) return 'attack';
    if (id.includes('health') || id.includes('_hp') || id.includes('life')) return 'health';
    if (id.includes('speed')) return 'speed';
    if (id.includes('critical') || id.includes('crit')) return 'critical';
    if (id.includes('xp') || id.includes('experience')) return 'xp';
    if (id.includes('shield')) return 'shield';
    if (id.includes('regenerate')) return 'regenerate';
    if (id.includes('retaliate')) return 'retaliate';
    if (id.includes('slash')) return 'slash';
    if (id.includes('strengthen')) return 'strengthen';
    if (id.includes('weaken')) return 'weaken';
    return 'other';
  }

  function groupOrbsByCategory(list: any[], prefix: string = 'basic'): { key: string; label: string; icon: string; items: any[] }[] {
    const map = new Map<string, any[]>();
    for (const orb of list) {
      const key = orbCategoryKey(orb);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(orb);
    }
    const result: { key: string; label: string; icon: string; items: any[] }[] = [];
    for (const k of CAT_ORDER) {
      const items = map.get(k);
      if (items && items.length > 0) {
        const fallback = CAT_ICONS[k] ? CAT_ICONS[k].replace('/orbs/basic/', `/orbs/${prefix}/`) : '';
        const icon = items[0]?.icon || fallback;
        result.push({ key: k, label: catLabel(k), icon, items });
      }
    }
    return result;
  }

  function toggleCat(prefix: string, key: string) {
    const id = `${prefix}-${key}`;
    const next = new Set(collapsedCats);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedCats = next;
  }

  function isCatOpen(prefix: string, key: string): boolean {
    return !collapsedCats.has(`${prefix}-${key}`);
  }

  function arraysEqual(a, b){
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function formatSpeed(value){
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const hasFraction = Math.round(abs * 100) !== Math.round(abs) * 100;
    return Number(value).toLocaleString(numLocale, {
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    });
  }

  // --- ХЭНДЛЕРЫ UI ---
  function toggleGene(letter){
    if (letter === 'all') {
      geneFilter = '';
      gene2Filter = '';
    } else {
      geneFilter = geneFilter === letter ? '' : letter;
    }
  }
  function toggleGene2(g){
    if (g === 'all') {
      gene2Filter = '';
    } else {
      gene2Filter = gene2Filter === g ? '' : g;
    }
  }
  function selectMutant(m){
    selected = m;
  }
  function selectMutant1(m){
    selected = m;
    query = m.name;
    showSearch1 = false;
  }
  function selectMutant2(m){
    selected2 = m;
    query2 = m.name;
    showSearch2 = false;
  }
  function pickBasic(slotIndex, orb){
    const choice = allowOrbForAbilities(orb, allowedAbilityBases) ? orb : null;
    basicSlots = basicSlots.map((v,i)=> i===slotIndex ? choice : v);
    openDropdown = null;
  }
  function pickSpecial(orb){
    if (isOrbConflicting(orb, selected)) return;
    specialSlot = orb;
    openDropdown = null;
  }

  function applyOrbingPreset(preset){
    if (!preset) return;
    const count = Number.isFinite(selected.basicSlotCount) ? selected.basicSlotCount : 3;
    const basic = Array.from({ length: count }, (_, i) => preset.basic[i] ?? null);
    basicSlots = basic;
    specialSlot = isOrbConflicting(preset.special, selected) ? null : preset.special;
    openDropdown = null;
  }
  function applyOrbingPreset2(preset){
    if (!preset || !selected2) return;
    const count = Number.isFinite(selected2.basicSlotCount) ? selected2.basicSlotCount : 3;
    const basic = Array.from({ length: count }, (_, i) => preset.basic[i] ?? null);
    basicSlots2 = basic;
    specialSlot2 = isOrbConflicting(preset.special, selected2) ? null : preset.special;
    openDropdown2 = null;
  }

  function getMutantAbilityBases(mutant): Set<string> {
    const set = new Set<string>();
    const baseList = Array.isArray(mutant?.abilities) ? mutant.abilities : [];
    for (const ability of baseList) {
      const base = abilityBaseKey(ability?.baseCode || ability?.code);
      if (base) set.add(base);
    }
    return set;
  }

  function isOrbConflicting(orb, mutant): boolean {
    if (!orb || !mutant) return false;
    const ability = orb.specialAbility;
    if (!ability) return false;
    const orbBase = abilityBaseKey(ability.baseCode || ability.code);
    if (!orbBase) return false;
    const mutantBases = getMutantAbilityBases(mutant);
    return mutantBases.has(orbBase);
  }
  function clearSlot(kind, i=null){
    if (kind==='basic') basicSlots = basicSlots.map((v,idx)=> idx===i ? null : v);
    else specialSlot = null;
  }

  // Закрытие открытых выпадашек по клику вне
  function windowClick(e){
    if (openDropdown && dropdownHost && !dropdownHost.contains(e.target)) openDropdown = null;
    if (openDropdown2 && dropdownHost2 && !dropdownHost2.contains(e.target)) openDropdown2 = null;
    const target = e.target as HTMLElement;
    if (showSearch1 && !target?.closest('.compare-search-wrap[data-slot="1"]')) showSearch1 = false;
    if (showSearch2 && !target?.closest('.compare-search-wrap[data-slot="2"]')) showSearch2 = false;
  }

  // Орб-дропдауны и compare-поиск закрывались раньше ТОЛЬКО кликом вне (windowClick выше) -
  // с клавиатуры их было не закрыть никак (Tab уводил фокус дальше по странице, оставляя
  // список открытым). Escape - стандартное ожидание для любого попап-виджета.
  function windowKeydown(e: KeyboardEvent){
    if (e.key !== 'Escape') return;
    if (openDropdown) openDropdown = null;
    if (openDropdown2) openDropdown2 = null;
    if (showSearch1) showSearch1 = false;
    if (showSearch2) showSearch2 = false;
  }

  // --- NEW CODE: Логика скрытия каталога и скриншота ---

  function toggleCatalog() {
    showCatalog = !showCatalog;
  }
  
  // Show notification when screenshot is saved
  function showNotification(message) {
    // Remove any existing notifications
    const existingNotifications = document.querySelectorAll('.notification-toast');
    existingNotifications.forEach(el => el.remove());
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification-toast';
    notification.textContent = message;
    
    // Style the notification
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      backgroundColor: '#22c55e', // green-500
      color: 'white',
      padding: '12px 20px',
      borderRadius: '8px',
      zIndex: '9999',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      fontWeight: '600',
      fontSize: '14px',
      maxWidth: '300px',
      wordWrap: 'break-word',
      animation: 'slideInRight 0.3s ease-out'
    });
    
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.animation = 'fadeOut 0.5s ease-out';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.remove();
          }
        }, 500);
      }
    }, 3000);
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- ФУНКЦИЯ СКРИНШОТА ---
  async function shareScreenshot() {
    if (!selected || isCopying) return;
    isCopying = true;

    try {
      const isCompare = compareMode && selected2;
      const state: Record<string, any> = {
        id: selected.id,
        level,
        stars,
        orbs: basicSlots.map((o: any) => o?.id || null),
        special: specialSlot?.id || null,
        atkMultipliers,
      };
      if (isCompare) {
        state.compare = true;
        state.id2 = selected2.id;
        state.level2 = level2;
        state.stars2 = stars2;
        state.orbs2 = basicSlots2.map((o: any) => o?.id || null);
        state.special2 = specialSlot2?.id || null;
        state.atkMultipliers2 = atkMultipliers2;
      }

      const stateStr = encodeURIComponent(JSON.stringify(state));
      const filename = isCompare
        ? `${selected.name || 'mutant'}-vs-${selected2?.name || 'mutant'}-stats.png`
        : `${selected.name || 'mutant'}-stats.png`;

      // Запрос идёт дольше, чем живёт "user activation" от клика, поэтому любой
      // await до clipboard.write ломает копирование (первый клик уходил в скачивание).
      // Отдаём ClipboardItem сам промис и вызываем write сразу.
      let pending: Promise<Blob> | null = null;
      const fetchBlob = () => {
        if (!pending) {
          pending = (async () => {
            let res: Response | null = null;
            for (let attempt = 0; attempt < 2; attempt++) {
              res = await fetch(`/api/screenshot?state=${stateStr}&locale=${locale}`);
              if (res.ok) break;
              if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
            }
            if (!res || !res.ok) throw new Error(`Screenshot API error: ${res?.status}`);
            return await res.blob();
          })();
        }
        return pending;
      };

      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': fetchBlob() })]);
          showNotification(t('stats.screenshotCopied', locale));
          return;
        } catch (err) {
          // Если упал сам запрос — пробрасываем ошибку в общий catch, а не скачиваем битый файл.
          await fetchBlob();
          console.warn('[Screenshot] clipboard unavailable, falling back to download', err);
        }
      }
      downloadBlob(await fetchBlob(), filename);
      showNotification(t('stats.screenshotDownloaded', locale));
    } catch (error) {
      console.error('[Screenshot]', error);
      showNotification(t('stats.screenshotError', locale));
    } finally {
      isCopying = false;
    }
  }

</script>


<svelte:window onclick={windowClick} onkeydown={windowKeydown} />

<div class="stats-page" class:single-col={!showCatalog && !compareMode} class:compare-active={compareMode}>

  <!-- ЛЕВАЯ КОЛОНКА: КАТАЛОГ (Скрывается по условию) -->
  {#if showCatalog}
    <aside class="catalog">
      <!-- Ген 1 -->
      <div class="filters-row">
        <button
          class="filter-chip {geneFilter === '' && gene2Filter === '' ? 'active' : ''}"
          onclick={() => toggleGene('all')}>
          <span>{t('mutants.gene1.all', locale)}</span>
        </button>
        {#each ['A','B','C','D','E','F'] as g}
          <button
            class="gene-chip"
            class:active={geneFilter===g}
            onclick={() => toggleGene(g)}
            title={geneLabelL(g, locale)}>
            <img src={textureUrl(GENE_ICON[g] || GENE_ICON[''])} alt={g} />
          </button>
        {/each}
      </div>

      <!-- Ген 2 -->
      <div class="filters-row gene2-row" class:disabled={!geneFilter}>
        <button
          class="filter-chip {gene2Filter === '' && geneFilter ? 'active' : ''}"
          disabled={!geneFilter}
          onclick={() => toggleGene2('all')}>
          <span>{t('mutants.gene2.all', locale)}</span>
        </button>
        <button
          class="gene-chip"
          class:active={gene2Filter==='neutral'}
          disabled={!geneFilter}
          onclick={() => toggleGene2('neutral')}
          title={t('mutants.gene.neutral', locale)}>
          <img src={textureUrl("/genes/gene_all.webp")} alt={t('mutants.gene.neutral', locale)} />
        </button>
        {#each ['A','B','C','D','E','F'] as g}
          <button
            class="gene-chip"
            class:active={gene2Filter===g}
            disabled={!geneFilter}
            onclick={() => toggleGene2(g)}
            title={geneLabelL(g, locale)}>
            <img src={textureUrl(GENE_ICON[g] || GENE_ICON[''])} alt={g} />
          </button>
        {/each}
      </div>

      <input
        id="stats-search"
        name="stats-search"
        class="search"
        type="text"
        placeholder={t('mutants.search.placeholder', locale)}
        bind:value={query}
      />

      <div class="list">
        {#each filtered as m (m.id)}
          <button class="mut-row {selected?.id===m.id ? 'active' : ''}" onclick={() => selectMutant(m)}>
            <img class="mut-icon" src={textureUrl(listThumbnail(m) || '')} alt={m.name} loading="lazy" decoding="async" />
            <div class="mut-meta">
              <div class="name">{m.name}</div>
              <div class="genes">
                {#each m.genes as g}
                  <img src={textureUrl(GENE_ICON[g] || GENE_ICON[''])} alt={g} title={geneLabelL(g, locale)} />
                {/each}
              </div>
            </div>
            <div class="rar">{m.typeLabel}</div>
          </button>
        {/each}
      </div>
    </aside>
  {/if}

  <!-- ПРАВАЯ КОЛОНКА: КАРТОЧКА -->
  <section class="panel">
    {#if selected}
      <!-- Хедер панели с кнопками управления -->
      <div class="panel-header">
         <!-- Кнопка показа/скрытия каталога (только вне сравнения) -->
         <div class="header-left">
            {#if !compareMode}
            <button class="tool-btn" onclick={toggleCatalog} title={showCatalog ? t('stats.hideSearch', locale) : t('stats.showSearch', locale)}>
               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  {#if showCatalog}
                     <line x1="18" y1="6" x2="6" y2="18"></line>
                     <line x1="6" y1="6" x2="18" y2="18"></line>
                  {:else}
                     <line x1="3" y1="12" x2="21" y2="12"></line>
                     <line x1="3" y1="6" x2="21" y2="6"></line>
                     <line x1="3" y1="18" x2="21" y2="18"></line>
                  {/if}
               </svg>
            </button>
            {/if}
         </div>

         {#if compareMode}
            <header class="title">{selected.name}</header>
           <div class="compare-search-wrap" data-slot="1">
             <input
               id="stats-compare-search-1"
               name="stats-compare-search-1"
               class="compare-search-input"
               type="text"
               placeholder={t('stats.compareSearchPlaceholder', locale)}
               bind:value={query}
               onfocus={() => showSearch1 = true}
               oninput={() => showSearch1 = true}
             />
             {#if query}
               <button class="compare-search-clear" onclick={() => { query = ''; showSearch1 = true; }} title={t('stats.clear', locale)}>×</button>
             {/if}
             {#if showSearch1 && filtered1.length > 0}
               <div class="compare-search-dropdown">
                 {#each filtered1 as m (m.id)}
                   <button
                     class="compare-search-row"
                     class:active={selected?.id === m.id}
                     onclick={() => selectMutant1(m)}
                   >
                     <img class="compare-search-icon" src={textureUrl(listThumbnail(m) || '')} alt="" loading="lazy" />
                     <div class="compare-search-meta">
                       <span class="compare-search-name">{m.name}</span>
                       <span class="compare-search-genes">
                         {#each m.genes as g}
                           <img src={textureUrl(GENE_ICON[g] || GENE_ICON[''])} alt={g} />
                         {/each}
                       </span>
                     </div>
                   </button>
                 {/each}
               </div>
             {/if}
           </div>
         {:else}
           <header class="title">{selected.name}</header>
         {/if}
      </div>

      <!-- Кнопки инструментов (скриншот / сравнение) -->
      <div class="header-tools-row">
        <button class="tool-btn share-btn" onclick={shareScreenshot} disabled={isCopying} title={t('stats.saveAsImage', locale)}>
           {#if isCopying}
             <span>{t('stats.saving', locale)}</span>
           {:else}
             <span>{t('stats.makeScreenshot', locale)}</span>
           {/if}
        </button>
        <button class="tool-btn compare-btn" class:active={compareMode} onclick={() => { compareMode = !compareMode; if (compareMode && !selected2) selected2 = ALL_MUTANTS[1]; }}>
          <span>{compareMode ? t('stats.compareExit', locale) : t('stats.compare', locale)}</span>
        </button>
      </div>

      <div class="hero-section">
      <div class="hero-genes">
          {#each selected.genes as g}
            <img src={textureUrl(GENE_ICON[g] || GENE_ICON[''])} alt={g} />
          {/each}
        </div>
        <div class="mut-figure">
          <img class="texture" src={textureUrl(figureImage(selected, stars))} alt={selected.name} />
        </div>

        <div class="hero-controls" bind:this={dropdownHost}>
          {#if orbingPresets.length > 0}
            <div class="orbing-presets">
              <span class="orbing-presets-label">{t('pvp.orbingPreset.wiki', locale)}</span>
              {#each orbingPresets as preset, i}
                <button class="orbing-preset-btn" onclick={() => applyOrbingPreset(preset)} title={t('pvp.orbingPreset.applyTitle', locale)}>
                  {t('pvp.orbingPreset.label', locale).replace('{n}', String(i + 1))}
                </button>
              {/each}
            </div>
          {/if}
          <div class="slots">
            <!-- базовые -->
            {#each basicSlots as orb, i}
              <div class="slot">
                <button
                  class="slot-btn"
                  aria-haspopup="true"
                  aria-expanded={openDropdown === `basic-${i}`}
                  onclick={() => openDropdown = openDropdown === `basic-${i}` ? null : `basic-${i}`}
                >
                  <img class="slot-bg" src={textureUrl("/orbs/basic/orb_slot.webp")} alt="slot" />
                  {#if orb}<img class="orb" src={textureUrl(orb.icon)} alt={orb.id} />{/if}
                </button>
                {#if orb}
                  <button class="x" title={t('pvp.orb.remove', locale)} onclick={() => clearSlot('basic', i)}>×</button>
                {/if}
                {#if openDropdown === `basic-${i}`}
                  <div class="dropdown">
                    {#each groupOrbsByCategory(basicOrbOptions, 'basic') as cat}
                      <button class="cat-header" class:collapsed={!isCatOpen('basic', cat.key)} aria-expanded={isCatOpen('basic', cat.key)} onclick={() => toggleCat('basic', cat.key)}>
                        <span class="cat-arrow">{isCatOpen('basic', cat.key) ? '▾' : '▸'}</span>
                        {#if cat.icon}<img class="cat-icon" src={textureUrl(cat.icon)} alt="" />{/if}
                        {cat.label}
                        <span class="cat-count">{cat.items.length}</span>
                      </button>
                      {#if isCatOpen('basic', cat.key)}
                        {#each cat.items as o}
                          <button class="orb-row" onclick={() => pickBasic(i, o)}>
                            <img src={textureUrl(o.icon)} alt={o.id} /> <span>{o.name || o.id}</span>
                          </button>
                        {/each}
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}

            <!-- спец-слот -->
            {#if selected.specialSlotCount > 0}
            <div class="slot">
              <button
                class="slot-btn"
                aria-haspopup="true"
                aria-expanded={openDropdown === 'special'}
                onclick={() => openDropdown = openDropdown === 'special' ? null : 'special'}
              >
                <img class="slot-bg" src={textureUrl("/orbs/special/orb_slot_spe.webp")} alt="special" />
                {#if specialSlot}<img class="orb" src={textureUrl(specialSlot.icon)} alt={specialSlot.id} />{/if}
              </button>
              {#if specialSlot}
                <button class="x" title={t('pvp.orb.remove', locale)} onclick={() => clearSlot('special')}>×</button>
              {/if}
              {#if openDropdown === 'special'}
                <div class="dropdown">
                  {#each groupOrbsByCategory(specialOrbOptions, 'special') as cat}
                    <button class="cat-header" class:collapsed={!isCatOpen('special', cat.key)} aria-expanded={isCatOpen('special', cat.key)} onclick={() => toggleCat('special', cat.key)}>
                      <span class="cat-arrow">{isCatOpen('special', cat.key) ? '▾' : '▸'}</span>
                      {#if cat.icon}<img class="cat-icon" src={textureUrl(cat.icon)} alt="" />{/if}
                      {cat.label}
                      <span class="cat-count">{cat.items.length}</span>
                    </button>
                    {#if isCatOpen('special', cat.key)}
                      {#each cat.items as o}
                        <button class="orb-row" onclick={() => pickSpecial(o)}>
                          <img src={textureUrl(o.icon)} alt={o.id} /> <span>{o.name || o.id}</span>
                        </button>
                      {/each}
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
            {/if}
          </div>

          <div class="controls">
              <div class="control">
              <span class="control-label">{t('pvp.level.label', locale).replace('{n}', String(maxLevel))}</span>
              <input
                class="lvl"
                type="number"
                min="1"
                max={maxLevel}
                bind:value={level}
                onkeydown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === '+') e.preventDefault(); }}
                oninput={(e) => { if (e.target.value < 0) level = 0; }}
              />
            </div>
            <div class="control">
              <span class="control-label">{t('stats.starRating', locale)}</span>
              <div class="stars">
                {#each [0,1,2,3,4] as s}
                  <button
                    class="star"
                    class:selected={stars === s}
                    disabled={!selected.availableStars.has(s)}
                    onclick={() => stars = s}
                    aria-pressed={stars === s}
                    title={starTitle(s)}>
                    <img src={textureUrl(STAR_ICON[s])} alt="*" />
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>

        <div class="stats">
          <div class="row">
            <span class="label">
              {#if typeIconCurrent}
                <img class="label-icon type-icon" src={textureUrl(typeIconCurrent)} alt={t('mutants.filter.type', locale)} />
              {/if}
              {t('mutants.filter.type', locale)}
            </span>
            <b>{selected.typeLabel || selected.type || '—'}</b>
          </div>
          <div class="row"><span class="label">{t('stats.tier', locale)}</span><b>{selected.tierLabel || selected.tier || '—'}</b></div>
          <div class="row">
            <span class="label">
              <img class="label-icon" src={textureUrl(STAT_ICON.hp)} alt="HP" />
              HP
            </span>
            <b>{stats.hp.toLocaleString(numLocale)}</b>
          </div>

          {#each attackRows as attack (attack.attack)}
            <div class="row attack-row">
              {#if attack.gene !== 'neutro'}
              <div class="atk-mult-bar">
                {#each [-0.5, -0.25, 0, 0.25, 0.5] as delta}
                  {@const active = (atkMultipliers[attack.attack] ?? 1) === (1 + delta)}
                  <button
                    class="atk-mult-btn"
                    class:active
                    class:m-beige={delta === -0.25}
                    class:m-orange={delta === 0.25}
                    class:m-red={delta === 0.5}
                    title={delta === 0 ? t('stats.noChanges', locale) : `${delta > 0 ? '+' : ''}${delta * 100}%`}
                    onclick={() => atkMultipliers[attack.attack] = active ? 1 : 1 + delta}
                  >{delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta * 100}%`}</button>
                {/each}
              </div>
              {/if}
              <div class="attack-side">
                <span class="attack-gene" class:empty={!attack.geneIcon}>
                  {#if attack.geneIcon}
                    <img class="gene-icon" src={textureUrl(attack.geneIcon)} alt="" aria-hidden="true" />
                  {/if}
                  {#if attack.isAoe}
                    <img class="attack-aoe" src={textureUrl("/genes/atk_multiple.webp")} alt={t('stats.aoeAlt', locale)} />
                  {/if}
                </span>
                <div class="attack-info">
                  <span class="attack-label">{attack.label}</span>
                  <div class="attack-dmg-group">
                    <span class="attack-damage"
                      class:m-cyan={(atkMultipliers[attack.attack] ?? 1) === 0.5}
                      class:m-beige={(atkMultipliers[attack.attack] ?? 1) === 0.75}
                      class:m-orange={(atkMultipliers[attack.attack] ?? 1) === 1.25}
                      class:m-red={(atkMultipliers[attack.attack] ?? 1) === 1.5}
                    >{attack.damage ? Math.round(attack.damage * (atkMultipliers[attack.attack] ?? 1)).toLocaleString(numLocale) : '—'}</span>
                    {#if attack.gene !== 'neutro'}
                    <div class="atk-mult-btns">
                      {#each [-0.5, -0.25, 0, 0.25, 0.5] as delta}
                        {@const active = (atkMultipliers[attack.attack] ?? 1) === (1 + delta)}
                        <button
                          class="atk-mult-btn"
                          class:active
                          class:m-beige={delta === -0.25}
                          class:m-orange={delta === 0.25}
                          class:m-red={delta === 0.5}
                          title={delta === 0 ? t('stats.noChanges', locale) : `${delta > 0 ? '+' : ''}${delta * 100}%`}
                          onclick={() => atkMultipliers[attack.attack] = active ? 1 : 1 + delta}
                        >{delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta * 100}%`}</button>
                      {/each}
                    </div>
                    {/if}
                  </div>
                </div>
              </div>
              <span class="ability-divider" class:empty={!attack.effects.length} aria-hidden="true"></span>
              <div class="effect-side">
                {#if attack.effects.length}
                  {#each attack.effects as effect, i (effect.label + effect.value + effect.percent + i)}
                    <div class="effect-row">
                      {#if effect.icon}
                        <img class="ability-icon" src={textureUrl(effect.icon)} alt={effect.label} />
                      {/if}
                      <span class="effect-name">
                        {effect.label}
                        {#if effect.percent != null}
                          <span class="effect-percent">{effect.percent.toLocaleString(numLocale)}%</span>
                        {/if}
                      </span>
                      <span class="effect-value">{Math.round(effect.value * (atkMultipliers[attack.attack] ?? 1)).toLocaleString(numLocale)}</span>
                    </div>
                  {/each}
                {:else}
                  <span class="effect-empty">—</span>
                {/if}
              </div>
            </div>
          {/each}

          <div class="row">
            <span class="label">
              <img class="label-icon" src={textureUrl(STAT_ICON.speed)} alt={catLabel('speed')} />
              {catLabel('speed')}
            </span>
            <b>{formatSpeed(stats.speed)}</b>
          </div>
          <div class="row">
            <span class="label">
              <img class="label-icon" src={textureUrl("/cash/softcurrency.webp")} alt={t('stats.silverLabel', locale)} />
              {t('stats.silverLabel', locale)}
            </span>
            <b>{stats.bank.toLocaleString(numLocale)}</b>
          </div>
        </div>
      </div>

    {/if}
  </section>

  <!-- ВТОРАЯ ПАНЕЛЬ (режим сравнения) -->
  {#if compareMode && selected2}
  <section class="panel panel-compare">
    {#if selected2}
      <div class="panel-header">
         <div class="header-left">
            <button class="tool-btn" onclick={() => { compareMode = false; }} title={t('stats.closeCompare', locale)}>
               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
               </svg>
            </button>
         </div>
            {#if selected2}<header class="title">{selected2.name}</header>{/if}
           <div class="compare-search-wrap" data-slot="2">
            <input
              id="stats-compare-search-2"
              name="stats-compare-search-2"
              class="compare-search-input"
              type="text"
              placeholder={t('stats.compareSearchPlaceholder', locale)}
              bind:value={query2}
              onfocus={() => showSearch2 = true}
              oninput={() => showSearch2 = true}
            />
            {#if query2}
              <button class="compare-search-clear" onclick={() => { query2 = ''; showSearch2 = true; }} title={t('stats.clear', locale)}>×</button>
            {/if}
            {#if showSearch2 && filtered2.length > 0}
             <div class="compare-search-dropdown">
               {#each filtered2 as m (m.id)}
                 <button
                   class="compare-search-row"
                   class:active={selected2?.id === m.id}
                   onclick={() => selectMutant2(m)}
                 >
                   <img class="compare-search-icon" src={textureUrl(listThumbnail(m) || '')} alt="" loading="lazy" />
                   <div class="compare-search-meta">
                     <span class="compare-search-name">{m.name}</span>
                     <span class="compare-search-genes">
                       {#each m.genes as g}
                         <img src={textureUrl(GENE_ICON[g] || GENE_ICON[''])} alt={g} />
                       {/each}
                     </span>
                   </div>
                 </button>
               {/each}
             </div>
           {/if}
         </div>
      </div>

      <!-- Невидимый клон кнопок первой панели: высота строки инструментов совпадает
           всегда, независимо от размеров шрифта/паддингов -> панели симметричны. -->
      <div class="header-tools-row" style="visibility:hidden" aria-hidden="true">
        <button class="tool-btn share-btn" tabindex="-1"><span>{t('stats.makeScreenshot', locale)}</span></button>
        <button class="tool-btn compare-btn" tabindex="-1"><span>{t('stats.compare', locale)}</span></button>
      </div>

      <div class="hero-section">
      <div class="hero-genes">
          {#each selected2.genes as g}
            <img src={textureUrl(GENE_ICON[g] || GENE_ICON[''])} alt={g} />
          {/each}
        </div>
        <div class="mut-figure">
          <img class="texture" src={textureUrl(figureImage(selected2, stars2))} alt={selected2.name} />
        </div>

        <div class="hero-controls" bind:this={dropdownHost2}>
          {#if orbingPresets2.length > 0}
            <div class="orbing-presets">
              <span class="orbing-presets-label">{t('pvp.orbingPreset.wiki', locale)}</span>
              {#each orbingPresets2 as preset, i}
                <button class="orbing-preset-btn" onclick={() => applyOrbingPreset2(preset)} title={t('pvp.orbingPreset.applyTitle', locale)}>
                  {t('pvp.orbingPreset.label', locale).replace('{n}', String(i + 1))}
                </button>
              {/each}
            </div>
          {/if}
          <div class="slots">
            {#each basicSlots2 as orb, i}
              <div class="slot">
                <button
                  class="slot-btn"
                  aria-haspopup="true"
                  aria-expanded={openDropdown2 === `basic2-${i}`}
                  onclick={() => openDropdown2 = openDropdown2 === `basic2-${i}` ? null : `basic2-${i}`}
                >
                  <img class="slot-bg" src={textureUrl("/orbs/basic/orb_slot.webp")} alt="slot" />
                  {#if orb}<img class="orb" src={textureUrl(orb.icon)} alt={orb.id} />{/if}
                </button>
                {#if orb}
                  <button class="x" title={t('pvp.orb.remove', locale)} onclick={() => { basicSlots2 = basicSlots2.map((v,idx)=> idx===i ? null : v); }}>×</button>
                {/if}
                {#if openDropdown2 === `basic2-${i}`}
                  <div class="dropdown">
                    {#each groupOrbsByCategory(basicOrbOptions2, 'basic') as cat}
                      <button class="cat-header" class:collapsed={!isCatOpen('basic', cat.key)} aria-expanded={isCatOpen('basic', cat.key)} onclick={() => toggleCat('basic', cat.key)}>
                        <span class="cat-arrow">{isCatOpen('basic', cat.key) ? '▾' : '▸'}</span>
                        {#if cat.icon}<img class="cat-icon" src={textureUrl(cat.icon)} alt="" />{/if}
                        {cat.label}
                        <span class="cat-count">{cat.items.length}</span>
                      </button>
                      {#if isCatOpen('basic', cat.key)}
                        {#each cat.items as o}
                          <button class="orb-row" onclick={() => { basicSlots2 = basicSlots2.map((v,idx)=> idx===i ? o : v); openDropdown2 = null; }}>
                            <img src={textureUrl(o.icon)} alt={o.id} /> <span>{o.name || o.id}</span>
                          </button>
                        {/each}
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}

            {#if selected2.specialSlotCount > 0}
            <div class="slot">
              <button
                class="slot-btn"
                aria-haspopup="true"
                aria-expanded={openDropdown2 === 'special2'}
                onclick={() => openDropdown2 = openDropdown2 === 'special2' ? null : 'special2'}
              >
                <img class="slot-bg" src={textureUrl("/orbs/special/orb_slot_spe.webp")} alt="special" />
                {#if specialSlot2}<img class="orb" src={textureUrl(specialSlot2.icon)} alt={specialSlot2.id} />{/if}
              </button>
              {#if specialSlot2}
                <button class="x" title={t('pvp.orb.remove', locale)} onclick={() => { specialSlot2 = null; }}>×</button>
              {/if}
              {#if openDropdown2 === 'special2'}
                <div class="dropdown">
                  {#each groupOrbsByCategory(specialOrbOptions2, 'special') as cat}
                    <button class="cat-header" class:collapsed={!isCatOpen('special', cat.key)} aria-expanded={isCatOpen('special', cat.key)} onclick={() => toggleCat('special', cat.key)}>
                      <span class="cat-arrow">{isCatOpen('special', cat.key) ? '▾' : '▸'}</span>
                      {#if cat.icon}<img class="cat-icon" src={textureUrl(cat.icon)} alt="" />{/if}
                      {cat.label}
                      <span class="cat-count">{cat.items.length}</span>
                    </button>
                    {#if isCatOpen('special', cat.key)}
                      {#each cat.items as o}
                        <button class="orb-row" onclick={() => { specialSlot2 = o; openDropdown2 = null; }}>
                          <img src={textureUrl(o.icon)} alt={o.id} /> <span>{o.name || o.id}</span>
                        </button>
                      {/each}
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
            {/if}
          </div>

          <div class="controls">
              <div class="control">
              <span class="control-label">{t('pvp.level.label', locale).replace('{n}', String(maxLevel2))}</span>
              <input
                class="lvl"
                type="number"
                min="1"
                max={maxLevel2}
                bind:value={level2}
                onkeydown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === '+') e.preventDefault(); }}
                oninput={(e) => { if (e.target.value < 0) level2 = 0; }}
              />
            </div>
            <div class="control">
              <span class="control-label">{t('stats.starRating', locale)}</span>
              <div class="stars">
                {#each [0,1,2,3,4] as s}
                  <button
                    class="star"
                    class:selected={stars2 === s}
                    disabled={!selected2.availableStars.has(s)}
                    onclick={() => stars2 = s}
                    aria-pressed={stars2 === s}
                    title={starTitle(s)}>
                    <img src={textureUrl(STAR_ICON[s])} alt="*" />
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </div>

        <div class="stats">
          <div class="row">
            <span class="label">
              {#if typeIconCurrent2}
                <img class="label-icon type-icon" src={textureUrl(typeIconCurrent2)} alt={t('mutants.filter.type', locale)} />
              {/if}
              {t('mutants.filter.type', locale)}
            </span>
            <b>{selected2.typeLabel || selected2.type || '—'}</b>
          </div>
          <div class="row"><span class="label">{t('stats.tier', locale)}</span><b>{selected2.tierLabel || selected2.tier || '—'}</b></div>
          <div class="row">
            <span class="label">
              <img class="label-icon" src={textureUrl(STAT_ICON.hp)} alt="HP" />
              HP
            </span>
            <b>{stats2.hp.toLocaleString(numLocale)}</b>
          </div>

          {#each attackRows2 as attack (attack.attack)}
            <div class="row attack-row">
              {#if attack.gene !== 'neutro'}
              <div class="atk-mult-bar">
                {#each [-0.5, -0.25, 0, 0.25, 0.5] as delta}
                  {@const active = (atkMultipliers2[attack.attack] ?? 1) === (1 + delta)}
                  <button
                    class="atk-mult-btn"
                    class:active
                    class:m-beige={delta === -0.25}
                    class:m-orange={delta === 0.25}
                    class:m-red={delta === 0.5}
                    title={delta === 0 ? t('stats.noChanges', locale) : `${delta > 0 ? '+' : ''}${delta * 100}%`}
                    onclick={() => atkMultipliers2[attack.attack] = active ? 1 : 1 + delta}
                  >{delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta * 100}%`}</button>
                {/each}
              </div>
              {/if}
              <div class="attack-side">
                <span class="attack-gene" class:empty={!attack.geneIcon}>
                  {#if attack.geneIcon}
                    <img class="gene-icon" src={textureUrl(attack.geneIcon)} alt="" aria-hidden="true" />
                  {/if}
                  {#if attack.isAoe}
                    <img class="attack-aoe" src={textureUrl("/genes/atk_multiple.webp")} alt={t('stats.aoeAlt', locale)} />
                  {/if}
                </span>
                <div class="attack-info">
                  <span class="attack-label">{attack.label}</span>
                  <div class="attack-dmg-group">
                    <span class="attack-damage"
                      class:m-cyan={(atkMultipliers2[attack.attack] ?? 1) === 0.5}
                      class:m-beige={(atkMultipliers2[attack.attack] ?? 1) === 0.75}
                      class:m-orange={(atkMultipliers2[attack.attack] ?? 1) === 1.25}
                      class:m-red={(atkMultipliers2[attack.attack] ?? 1) === 1.5}
                    >{attack.damage ? Math.round(attack.damage * (atkMultipliers2[attack.attack] ?? 1)).toLocaleString(numLocale) : '—'}</span>
                    {#if attack.gene !== 'neutro'}
                    <div class="atk-mult-btns">
                      {#each [-0.5, -0.25, 0, 0.25, 0.5] as delta}
                        {@const active = (atkMultipliers2[attack.attack] ?? 1) === (1 + delta)}
                        <button
                          class="atk-mult-btn"
                          class:active
                          class:m-beige={delta === -0.25}
                          class:m-orange={delta === 0.25}
                          class:m-red={delta === 0.5}
                          title={delta === 0 ? t('stats.noChanges', locale) : `${delta > 0 ? '+' : ''}${delta * 100}%`}
                          onclick={() => atkMultipliers2[attack.attack] = active ? 1 : 1 + delta}
                        >{delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta * 100}%`}</button>
                      {/each}
                    </div>
                    {/if}
                  </div>
                </div>
              </div>
              <span class="ability-divider" class:empty={!attack.effects.length} aria-hidden="true"></span>
              <div class="effect-side">
                {#if attack.effects.length}
                  {#each attack.effects as effect, i (effect.label + effect.value + effect.percent + i)}
                    <div class="effect-row">
                      {#if effect.icon}
                        <img class="ability-icon" src={textureUrl(effect.icon)} alt={effect.label} />
                      {/if}
                      <span class="effect-name">
                        {effect.label}
                        {#if effect.percent != null}
                          <span class="effect-percent">{effect.percent.toLocaleString(numLocale)}%</span>
                        {/if}
                      </span>
                      <span class="effect-value">{Math.round(effect.value * (atkMultipliers2[attack.attack] ?? 1)).toLocaleString(numLocale)}</span>
                    </div>
                  {/each}
                {:else}
                  <span class="effect-empty">—</span>
                {/if}
              </div>
            </div>
          {/each}

          <div class="row">
            <span class="label">
              <img class="label-icon" src={textureUrl(STAT_ICON.speed)} alt={catLabel('speed')} />
              {catLabel('speed')}
            </span>
            <b>{formatSpeed(stats2.speed)}</b>
          </div>
          <div class="row">
            <span class="label">
              <img class="label-icon" src={textureUrl("/cash/softcurrency.webp")} alt={t('stats.silverLabel', locale)} />
              {t('stats.silverLabel', locale)}
            </span>
            <b>{stats2.bank.toLocaleString(numLocale)}</b>
          </div>
        </div>

    {/if}
  </section>
  {/if}
</div>

<style>

/* --- ГЕНЫ НАД МУТАНТОМ --- */
  .hero-genes {
    display: flex;
    justify-content: center;
    gap: 4px;
    margin-bottom: 2px;
    z-index: 10;
    position: relative;
  }
  @media (min-width: 768px) {
    .hero-genes {
      gap: 6px;
      margin-bottom: 4px;
    }
  }

  .hero-genes img {
    width: 30px;
    height: 30px;
    object-fit: contain;
    filter: drop-shadow(0 4px 4px rgba(0,0,0,0.6));
    z-index: 10;
  }
  @media (min-width: 768px) {
    .hero-genes img {
      width: 36px;
      height: 36px;
    }
  }

  .stats-page{
    display:grid;
    grid-template-columns: 320px minmax(0,660px);
    gap:18px;
    font-family:"TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system,
                "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans",
                "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    font-weight:700;
  }

  /* Если сайдбар скрыт - одна колонка по центру */
  .stats-page.single-col {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  .stats-page.single-col .panel {
    width: 100%;
    max-width: 660px;
  }

  /* Режим сравнения: две панели рядом */
  .stats-page.compare-active {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .stats-page.compare-active .catalog {
    display: none;
  }
  .stats-page.compare-active .panel {
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
  }
  .stats-page.compare-active .panel .header-tools-row {
    margin-bottom: 0;
  }
  .stats-page.compare-active .panel .panel-header {
    margin-bottom: 0;
    flex-direction: column;
    gap: 4px;
    padding: 0;
  }
  .stats-page.compare-active .panel .title {
    width: 100%;
    max-width: 100%;
  }
  .stats-page.compare-active .panel .hero-section {
    gap: 2px;
  }
  .compare-btn {
    background: rgba(34, 197, 94, 0.2) !important;
    border: 1px solid rgba(34, 197, 94, 0.6) !important;
    border-radius: 6px !important;
    color: #86efac !important;
    width: auto !important;
    height: 22px !important;
    padding: 0 10px !important;
    font-size: 10px !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.05em !important;
    transition: all 0.2s ease !important;
  }
  .compare-btn.active {
    background: rgba(239, 68, 68, 0.2) !important;
    border: 1px solid rgba(239, 68, 68, 0.6) !important;
    color: #fca5a5 !important;
  }
  .compare-btn:hover {
    background: rgba(34, 197, 94, 0.35) !important;
    color: #ffffff !important;
    border-color: rgba(34, 197, 94, 0.8) !important;
    transform: translateY(-1px);
  }
  .compare-btn.active:hover {
    background: rgba(239, 68, 68, 0.35) !important;
    color: #ffffff !important;
    border-color: rgba(239, 68, 68, 0.8) !important;
    transform: translateY(-1px);
  }
  .compare-btn:active {
    transform: translateY(0);
  }
  .compare-select-wrap { flex: 1; display: flex; justify-content: center; }
  .compare-select {
    background: #1b212a;
    color: #e9eef6;
    border: 1px solid #3a475a;
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    max-width: 260px;
    width: 100%;
    cursor: pointer;
    text-align: center;
  }
  .compare-select option { background: #1b212a; color: #e9eef6; }

  /* --- Поиск мутанта в режиме сравнения --- */
  .compare-search-wrap {
    flex: 1;
    display: flex;
    justify-content: center;
    position: relative;
    max-width: 310px;
    width: 100%;
  }
  .compare-search-input {
    width: 100%;
    padding: 6px 24px 6px 12px;
    border-radius: 8px;
    border: 1px solid #3a475a !important;
    background: #1b212a !important;
    color: #e9eef6 !important;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    text-align: center;
    outline: none;
    transition: border-color 0.2s;
  }
  .compare-search-input:focus {
    border-color: #58a6ff;
  }
  .compare-search-input::placeholder {
    color: #6b7a8d;
  }
  .compare-search-clear {
    position: absolute;
    right: 3px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 100, 100, 0.3) !important;
    color: #ff6464 !important;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    z-index: 1;
    line-height: 1;
    padding: 0;
  }
  .compare-search-clear:hover {
    background: rgba(255, 100, 100, 0.5) !important;
  }
  .compare-search-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    max-height: 300px;
    overflow-y: auto;
    background: #1b212a;
    border: 1px solid #3a475a;
    border-radius: 10px;
    z-index: 9999;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  }
  .compare-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: none;
    color: #dfe7f3;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    transition: background 0.15s;
  }
  .compare-search-row:hover {
    background: rgba(88, 166, 255, 0.1);
  }
  .compare-search-row.active {
    background: rgba(88, 166, 255, 0.2);
    color: #58a6ff;
  }
  .compare-search-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: #0f1319;
    object-fit: cover;
    flex-shrink: 0;
  }
  .compare-search-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .compare-search-name {
    font-size: 13px;
    color: #e9eef6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compare-search-genes {
    display: flex;
    gap: 3px;
  }
  .compare-search-genes img {
    width: 16px;
    height: 16px;
  }
  @media (max-width: 1024px) {
    .stats-page.compare-active {
      flex-direction: column;
      align-items: stretch;
    }
    .stats-page.compare-active .panel { max-width: 95vw; margin: 0 auto; }
  }
  @media (max-width: 480px) {
    .compare-search-wrap { max-width: 80%; width: 100%; }
    .compare-search-input { font-size: 14px; padding: 6px 24px 6px 12px; }
    .compare-search-dropdown { max-height: 250px; }
  }

  .catalog{ background:#212832; border-radius:12px; padding:16px; display:flex; flex-direction:column; }
  .filters-row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
  .gene-chip{ width:28px; height:28px; padding:2px; border-radius:6px; background:#2b3442; border:1px solid #364456; cursor: pointer; }
  .gene-chip.active{ outline:2px solid #90f36b; }
  .gene-chip img{ width:100%; height:100%; object-fit:contain; }
  .filter-chip {
    height: 36px;
    padding: 0 0.8rem;
    border-radius: 8px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
    font-size: 0.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    cursor: pointer;
  }
  .filter-chip.active { background: #e2e8f0; color: #0f172a; border-color: #fff; transform: scale(1.05); }
  .gene2-row{ margin-bottom:8px; }
  .gene2-row.disabled{ opacity:0.3; pointer-events:none; }
  .gene2-label{ font-size:10px; color:#aab6c8; font-weight:700; }
  .sort-switch{ margin-left:auto; display:flex; gap:6px; }
  .sort-switch button{ background:#2b3442; border:1px solid #3a475a; border-radius:8px; padding:6px 10px; font-size:12px; cursor: pointer; color:#aab6c8; }
  .sort-switch .active{ background:#7a56ff; border-color:#7a56ff; color:white; }
  .search{ width:100%; margin:8px 0 12px; padding:8px 10px; border-radius:8px; border:1px solid #3a475a; background:#1b212a; color:#dfe7f3; }
  .list{ overflow:auto; max-height:70vh; display:flex; flex-direction:column; gap:6px; }
  .mut-row{ display:flex; align-items:center; gap:12px; background:#1b212a; border:1px solid #2e3948; border-radius:12px; padding:10px; width:100%; text-align: left; cursor: pointer; }
  .mut-row.active{ border-color:#90f36b; }
  .mut-icon{ width:44px; height:44px; border-radius:8px; background:#0f1319; object-fit:cover; flex-shrink: 0; }
  .mut-meta{ flex:1; min-width:0; display:flex; flex-direction:column; }
  .mut-meta .name{ font-size:13px; color:#e9eef6; }
  .mut-meta .genes{ display:flex; gap:4px; }
  .mut-meta .genes img{ width:20px; height:20px; }
  .rar{ font-size:11px; color:#aab6c8; flex-shrink:0; max-width:80px; text-align:right; }

  .panel{ background:#2a313c; border-radius:16px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; position: relative; }
  @media (min-width: 768px) {
    .panel { padding: 20px 22px; gap: 12px; }
  }

  /* Заголовок панели с кнопками */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: center; /* Центрируем контент (заголовок) */
    position: relative;      /* Чтобы кнопки позиционировать абсолютно внутри */
    margin-bottom: 2px;
    min-height: 28px;
    padding: 0 24px; /* Добавляем отступы по краям, чтобы заголовок не налезал на кнопки */
    width: 100%;
  }
  @media (min-width: 768px) {
    .panel-header {
      margin-bottom: 6px;
      min-height: 36px;
      padding: 0 40px;
    }
  }

  .header-left {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
  }

  /* Новая строка для доп. кнопок (скриншот) */
  .header-tools-row {
    display: flex;
    justify-content: center;
    gap: 8px;
    width: 100%;
    margin-bottom: 3px;
  }
  @media (min-width: 768px) {
    .header-tools-row { margin-bottom: 6px; }
  }

  /* Имя: яркое белое, с подсветкой */
  .title{
    font-size:26px;
    font-weight:800;
    color:#ffffff;
    text-shadow: 0 0 20px rgba(255, 255, 255, 0.25);
    text-align:center;
    line-height: 1.2;
    margin: 0;
    z-index: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
    max-width: 480px; /* Ограничиваем ширину текста */
  }
  
  /* Responsive title for smaller screens */
  @media (max-width: 768px) {
    .title {
      max-width: 90vw; /* Limit title width on small screens */
      font-size: 22px; /* Smaller font on mobile */
    }
  }

  .tool-btn {
    background: transparent;
    border: none;
    color: #aab6c8;
    cursor: pointer;
    padding: 8px;
    border-radius: 8px;
    transition: background 0.2s, color 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tool-btn:hover {
    background: #3a475a;
    color: white;
  }
  .tool-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* --- НОВЫЙ СТИЛЬ ДЛЯ КНОПКИ СКРИНШОТА --- */
  .share-btn {
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: #93c5fd;
    width: auto;
    height: 22px;
    padding: 0 10px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: all 0.2s ease;
  }

  .share-btn:hover {
    background: rgba(59, 130, 246, 0.3);
    color: #ffffff;
    border-color: rgba(59, 130, 246, 0.5);
    transform: translateY(-1px);
  }

  .share-btn:active {
    transform: translateY(0);
  }

  .hero-section{ display:flex; flex-direction:column; align-items:center; gap:3px; }
  @media (min-width: 768px) {
    .hero-section { gap: 5px; }
  }
  .mut-figure{ position:relative; display:flex; justify-content:center; margin-bottom:0; padding:0 0 12px; width:100%; }
  @media (min-width: 768px) {
    .mut-figure { padding: 0 0 16px; }
  }
  .mut-figure .texture{ max-width:100px; max-height:100px; object-fit:contain; image-rendering:auto; }

  .hero-controls{ width:100%; max-width:520px; margin:0 auto; display:flex; flex-direction:column; align-items:center; gap:2px; }
  @media (min-width: 768px) {
    .hero-controls { gap: 4px; }
  }

  .orbing-presets{ display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:6px; margin-bottom:2px; }
  .orbing-presets-label{ font-size:10px; color:#8b98ac; text-transform:uppercase; letter-spacing:0.04em; }
  .orbing-preset-btn{
    background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.35); color: #86efac;
    border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  }
  .orbing-preset-btn:hover{ background: rgba(34,197,94,0.28); border-color: rgba(34,197,94,0.55); transform: translateY(-1px); }
  .orbing-preset-btn:active{ transform: translateY(0); }

  /* СЛОТЫ: защита от сплющивания + фикс сфер */
  .slots{ display:flex; gap:10px; justify-content:center; margin:0 0 0; position:relative; flex-wrap:wrap; }
  @media (min-width: 768px) {
    .slots { gap: 12px; }
  }
  .slot{ position:relative; }
  .slot-btn{
    position:relative;
    width: 52px;
    height: 52px;
    min-width: 52px;
    min-height: 52px;
    flex-shrink: 0;

    border-radius:10px;
    background:transparent;
    border:none;
    padding:0;
    cursor: pointer;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  @media (min-width: 768px) {
    .slot-btn {
      width: var(--orb-size-container-large);
      height: var(--orb-size-container-large);
      min-width: var(--orb-size-container-large);
      min-height: var(--orb-size-container-large);
      border-radius: 12px;
    }
  }
  .slot-bg{ width:100%; height:100%; object-fit:cover; display: block; }
  /* Сфера заполняет 98% слота, центрирована */
  .orb {
    position: absolute;
    inset: 1%;
    object-fit: contain;
    border-radius: 10px;
  }
  @media (min-width: 768px) {
    .orb {
      border-radius: 12px;
    }
  }

  .x{ position:absolute; right:-6px; top:-6px; width:18px; height:18px; border-radius:50%; border:none; background:#ff6464; color:white; font-size:12px; cursor: pointer; z-index: 2; }
  @media (min-width: 768px) {
    .x { right: -8px; top: -8px; width: 22px; height: 22px; font-size: 14px; }
  }
  /* В режиме сравнения сдвигаем X-кнопку слотов левее, чтобы не наезжала на инпут поиска */
  .compare-active .slot .x { right: -10px !important; }
  @media (min-width: 768px) {
    .compare-active .slot .x { right: -12px !important; }
  }
  /* Уменьшаем padding кнопки X (close) в compare-active чтобы не наезжала на инпут */
  .compare-active .header-left .tool-btn {
    padding: 4px !important;
  }

   /* --- ИСПРАВЛЕННОЕ МЕНЮ СФЕР (ПО ЦЕНТРУ) --- */
  .dropdown {
    position: fixed; /* Фиксируем относительно всего экрана */
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%); /* Идеальная центровка */

    width: 320px;      /* Комфортная ширина */
    max-width: 90vw;   /* Отступ от краев на мобилках */
    max-height: 50vh;  /* Ограничение высоты */
    overflow-y: auto;  /* Скролл внутри, если сфер много */

    background: #212832; /* Чуть темнее фон для контраста */
    border: 1px solid #4b5975; /* Ярче граница */
    border-radius: 16px;
    padding: 12px;
    z-index: 9999; /* Чтобы точно было поверх всего */

    /* Сильная тень, чтобы затемнить фон под меню */
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.7), 0 10px 40px rgba(0,0,0, 0.8);
  }
  .orb-row{ display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; border-radius:10px; background:#242b36; margin:2px 0; border:none; color: #dfe7f3; cursor: pointer; text-align: left; }
  .orb-row:hover { background: #2e3948; }
  .orb-row img{ width:36px; height:36px; object-fit:contain; flex-shrink: 0; }
  @media (min-width: 768px) {
    .orb-row img { width: 44px; height: 44px; }
  }

  .cat-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    margin-top: 6px;
    border: none;
    border-radius: 10px;
    background: rgba(59, 130, 246, 0.1);
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: background 0.15s;
  }
  .cat-header:first-child { margin-top: 0; }
  .cat-header:hover { background: rgba(59, 130, 246, 0.2); }
  .cat-header.collapsed { color: #ffffff; }
  .cat-arrow { font-size: 12px; width: 14px; text-align: center; flex-shrink: 0; }
  .cat-icon { width: 26px; height: 26px; object-fit: contain; flex-shrink: 0; }
  .cat-count { margin-left: auto; font-size: 12px; color: #94a3b8; font-weight: 400; }

  .controls{ display:flex; gap:6px; justify-content:center; margin:0; flex-wrap:wrap; }
  @media (min-width: 768px) {
    .controls { gap: 8px; }
  }
  .control{ display:flex; align-items:center; gap:6px; color:#aab6c8; font-size:12px; background:#1b212a; border:1px solid #2e3948; border-radius:10px; padding:3px 10px; }
  .control .control-label{ white-space:nowrap; }

  .lvl{ width:64px; padding:3px 7px; border-radius:8px; border:1px solid #3a475a; background:#10161f; color:#e9eef6; font-size:13px; }

  /* Стили для статического уровня на скриншоте */
  :global(.lvl-static) {
    width: 64px;
    padding: 6px 7px;
    background: #10161f;
    color: #e9eef6;
    font-size: 14px;
    font-weight: bold;
    text-align: center;
    border-radius: 8px;
    border: 1px solid #3a475a;
    display: inline-block;
  }

  /* ЗВЕЗДЫ: защита от сплющивания */
  .stars{ display:flex; gap:4px; }
  @media (min-width: 768px) {
    .stars { gap: 6px; }
  }
  .star{
    width:26px; height:26px;
    min-width: 26px;
    flex-shrink: 0;

    border-radius:50%; background:transparent; border:none; padding:0; opacity:.45; transition:transform .15s ease, opacity .15s ease; cursor: pointer;
  }
  @media (min-width: 768px) {
    .star {
      width: 32px;
      height: 32px;
      min-width: 32px;
    }
  }
  .star.selected{ opacity:1; transform:scale(1.06); filter:drop-shadow(0 0 8px rgba(255,255,255,0.45)); }
  .star:disabled{ cursor: not-allowed; display: none; }
  .star img{ width:100%; height:100%; object-fit:contain; display: block; }
  .star:not(.selected) img{ filter:grayscale(1) brightness(0.6); }

  /* --- СТАТЫ (УПЛОТНЕННЫЕ) --- */
  .stats{ margin-top:0; display:flex; flex-direction:column; gap:4px; width:100%; max-width:520px; margin-left:auto; margin-right:auto; }
  @media (min-width: 768px) {
    .stats { gap: 6px; }
  }

  .row{
    display:flex;
    justify-content:space-between;
    align-items:center;
    background:#1b212a;
    border:1px solid #2e3948;
    border-radius:12px;
    padding:2px 10px;
    color:#dfe7f3;
    font-size:13px;
    min-height:32px;
  }
  @media (min-width: 768px) {
    .row {
      padding: 4px 14px;
      min-height: 38px;
      font-size: 14px;
    }
  }

  .row b {
    font-size: 15px;       /* Единый размер */
    font-weight: 700;      /* Одинаковая жирность */
    color: #e9eef6;        /* Одинаковый цвет */
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums; /* Чтобы цифры стояли ровно */
  }

  .row .label{ display:flex; align-items:center; gap:6px; color:#aab6c8; font-size:13px; }
  @media (min-width: 768px) {
    .row .label { gap: 10px; }
  }
  .row .label-icon{ width:18px; height:18px; object-fit:contain; flex-shrink: 0; }
  @media (min-width: 768px) {
    .row .label-icon { width: 20px; height: 20px; }
  }
  .row .type-icon{ width:22px; height:22px; flex-shrink: 0; }
  @media (min-width: 768px) {
    .row .type-icon { width: 26px; height: 26px; }
  }

  /* --- ОБНОВЛЕННЫЙ ДИЗАЙН АТАКИ --- */
  .row.attack-row{
    position: relative;
    align-items: stretch;
    gap: 6px;
    padding: 6px 10px;
  }
  @media (min-width: 768px) {
    .row.attack-row {
      gap: 10px;
      padding: 28px 14px 8px;
    }
  }

  /* Панель множителей — абсолютно в углу карточки (только ПК) */
  .atk-mult-bar {
    display: none;
  }
  @media (min-width: 768px) {
    .atk-mult-bar {
      display: flex;
      gap: 3px;
      position: absolute;
      top: 6px;
      left: 8px;
      z-index: 2;
    }
  }

  /* Кнопки внутри строки — только мобилка, на ПК скрыты */
  .atk-mult-btns {
    display: flex;
    gap: 2px;
  }
  @media (min-width: 768px) {
    .atk-mult-btns { display: none !important; }
  }

 /* --- ФИКС АТАКИ --- */
  .attack-gene {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
  }
  @media (min-width: 768px) {
    .attack-gene {
      width: 40px;
      height: 40px;
    }
  }

  /* Иконка гена */
  .attack-gene .gene-icon {
    width: 28px;
    height: 28px;
    object-fit: contain;
    display: block;
    position: relative;
    z-index: 2;
    filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));
  }
  @media (min-width: 768px) {
    .attack-gene .gene-icon {
      width: 34px;
      height: 34px;
    }
  }

  /* Иконка АОЕ */
  .attack-gene .attack-aoe {
    position: absolute;
    top: 50%;
    left: 80%;
    transform: translate(-50%, -50%);
    width: 36px;
    height: 36px;
    object-fit: contain;
    pointer-events: none;
    z-index: 1;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
  }
  @media (min-width: 768px) {
    .attack-gene .attack-aoe {
      width: 44px;
      height: 44px;
    }
  }

  .attack-gene.empty { opacity: 0; }

  .attack-side {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 1 1 0;
    min-width: 0;
  }
  @media (min-width: 768px) {
    .attack-side { gap: 5px; }
  }

  .attack-info {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }


  .attack-label {
    font-weight: 600;
    color: #aab6c8;
    font-size: 13px;
    white-space: normal;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
    text-align: left;
    flex: 1 1 auto;
    min-width: 80px;
  }

  .attack-dmg-group {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    flex-shrink: 1;
  }

  .attack-damage {
    font-size: 15px;
    font-weight: 700;
    color: #e9eef6;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .attack-damage.m-cyan { color: #7ec8e3; }
  .attack-damage.m-beige { color: #d4c49a; }
  .attack-damage.m-orange { color: #e8923a; }
  .attack-damage.m-red { color: #e05555; }

  .atk-mult-btns {
    display: flex;
    gap: 2px;
  }

  .atk-mult-btn {
    appearance: none;
    border: 1px solid #2e3948;
    background: #10161f;
    color: #6b7a8d;
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 9px;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .atk-mult-btn:hover {
    background: #1b212a;
    color: #aab6c8;
    border-color: #3a475a;
  }
  .atk-mult-btn.active {
    background: rgba(59,130,246,0.2);
    color: #60a5fa;
    border-color: rgba(59,130,246,0.4);
  }
  .atk-mult-btn.active.m-beige { color: #d4c49a; border-color: rgba(212,196,154,0.4); background: rgba(212,196,154,0.15); }
  .atk-mult-btn.active.m-orange { color: #e8923a; border-color: rgba(232,146,58,0.4); background: rgba(232,146,58,0.15); }
  .atk-mult-btn.active.m-red { color: #e05555; border-color: rgba(224,85,85,0.4); background: rgba(224,85,85,0.15); }
  @media (min-width: 768px) {
    .atk-mult-btn { padding: 2px 5px; font-size: 10px; }
    .atk-mult-btns { gap: 3px; }
  }

  .ability-divider{ width:1px; align-self:stretch; background:rgba(255,255,255,0.08); flex-shrink: 0; }
  .ability-divider.empty{ display:none; }

  .effect-side{ display:flex; flex-direction:column; gap:4px; min-width:0; flex:1 1 0; align-items:stretch; }
  @media (min-width: 768px) {
    .effect-side { gap: 6px; }
  }
  .effect-row{ display:flex; align-items:center; gap:6px; background:rgba(15,19,25,0.35); padding:4px 8px; border-radius:10px; width:100%; }
  @media (min-width: 768px) {
    .effect-row { gap: 8px; padding: 6px 10px; }
  }

  .ability-icon{ width:24px; height:24px; object-fit:contain; flex-shrink: 0; }
  @media (min-width: 768px) {
    .ability-icon { width: 28px; height: 28px; }
  }

  .effect-name{ display:flex; align-items:center; gap:4px; font-weight:600; color:#f0f6ff; flex:1 1 auto; font-size: 13px; }
  @media (min-width: 768px) {
    .effect-name { gap: 6px; }
  }
  .effect-percent{ font-size:13px; color:#90f36b; font-weight:600; white-space: nowrap; }
  .effect-value{ font-size:16px; color:#90f36b; font-weight:700; white-space: nowrap; }
  .effect-empty{ color:#94a2b9; font-size:13px; text-align:center; }

  @media (max-width: 1200px) {
    .stats-page{ grid-template-columns: 300px minmax(0,1fr); }
    .stats-page.single-col { grid-template-columns: minmax(0,1fr); }
  }

  @media (max-width: 1024px) {
    .stats-page{ grid-template-columns: minmax(0,1fr); gap:16px; }
    .panel{ order:1; }
    .catalog{ order:2; }
    .list{ max-height:360px; }
  }

  @media (max-width: 768px) {
    .stats-page {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      padding: 8px;
      justify-content: center;
    }
    .stats-page.single-col {
      grid-template-columns: 1fr;
      justify-content: center;
    }
    .panel {
      order: 1;
      padding: 8px 10px;
      margin: 0 auto; /* Center the panel */
      max-width: 95vw; /* Prevent from touching edges */
    }
    .catalog { order: 2; padding: 8px; }

    .row.attack-row { flex-direction: column; gap: 6px; padding: 8px; }
    .ability-divider { display: none !important; }
    .mut-figure { padding: 0 0 10px; }
    
    /* Увеличиваем иконки для мобильных для лучшей видимости */
    .hero-genes img { width: 28px; height: 28px; }
    .hero-genes { gap: 6px; margin-bottom: 2px; }
    .slot-btn { width: 48px; height: 48px; min-width: 48px; min-height: 48px; }
    .star { width: 26px; height: 26px; min-width: 26px; }
    .attack-gene { width: 34px; height: 34px; }
    .attack-gene .gene-icon { width: 26px; height: 26px; }
    .attack-gene .attack-aoe { width: 34px; height: 34px; }
    .ability-icon { width: 22px; height: 22px; }
    .row .label-icon { width: 18px; height: 18px; }
    .row .type-icon { width: 22px; height: 22px; }
  }

  @media (max-width: 480px) {
    .stats-page {
      grid-template-columns: 1fr;
      gap: 6px;
      padding: 6px;
      justify-content: center; /* Center the content */
    }
    .stats-page.single-col {
      grid-template-columns: 1fr;
      justify-content: center; /* Center the content */
    }

    /* Fix long name issue - make title responsive */
    .title {
      max-width: 90vw; /* Limit title width on small screens */
      font-size: 20px; /* Smaller font on mobile */
    }
    
    /* Увеличиваем иконки для очень маленьких экранов */
    .hero-genes img { width: 26px; height: 26px; }
    .hero-genes { gap: 5px; margin-bottom: 2px; }
    .slot-btn { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
    .star { width: 24px; height: 24px; min-width: 24px; }
    .attack-gene { width: 30px; height: 30px; }
    .attack-gene .gene-icon { width: 24px; height: 24px; }
    .attack-gene .attack-aoe { width: 30px; height: 30px; }
    .ability-icon { width: 20px; height: 20px; }
    .mut-figure { padding: 0 0 8px; }
  }
  
  /* Notification toast animations */
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes fadeOut {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  /* QHD upscaling */
  @media (min-width: 1921px) {
    .stats-page { grid-template-columns: 320px minmax(0, 900px); }
    .mut-icon { width: 55px; height: 55px; }
    .hero-genes img { width: 45px; height: 45px; }
    .hero-genes { gap: 8px; margin-bottom: 4px; }
    .star { width: 40px; height: 40px; min-width: 40px; }
    .slot-btn { width: 85px; height: 85px; min-width: 85px; min-height: 85px; }
    .slots { gap: 20px; }
    .attack-gene { width: 52px; height: 52px; }
    .attack-gene .gene-icon { width: 42px; height: 42px; }
    .attack-gene .attack-aoe { width: 52px; height: 52px; }
    .ability-icon { width: 35px; height: 35px; }
    .row .label-icon { width: 25px; height: 25px; }
    .row .type-icon { width: 33px; height: 33px; }
    .orb-row img { width: var(--orb-size-img); height: var(--orb-size-img); }
    .dropdown { width: 400px; }
    .controls { gap: 15px; }
    .stars { gap: 8px; }

    /* Текст был слишком мелким на 2K-мониторах */
    .row { font-size: 17px; min-height: 44px; }
    .row b { font-size: 19px; }
    .row .label { font-size: 16px; }
    .mut-meta .name { font-size: 15px; }
    .rar { font-size: 13px; }
    .effect-name { font-size: 15px; }
    .effect-percent { font-size: 15px; }
    .effect-value { font-size: 18px; }
    .effect-empty { font-size: 15px; }
    .control { font-size: 14px; }
    .lvl { font-size: 15px; }
    .gene2-label { font-size: 12px; }
  }
</style>
