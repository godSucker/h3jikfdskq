import { getItemTexture, translateItemId } from './craft-simulator'
import { getMutantTexture, getSkinTexture } from './mutant-textures'
import { normalizeSearch } from '@/lib/search-normalize'
import { getItemName } from '@/lib/materials-i18n'
import { t, type Locale } from '@/lib/i18n'
import type { MutantNameEntry } from '@/lib/mutant-names-i18n'

import { normalizeMutantId } from '@/lib/utils'

/**
 * Получает путь к текстуре мутанта с правильными fallback'ами
 */
export function getMutantTexturePath(
  specimenId: string,
  skin: string = '_any',
  variant: 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum' = 'normal',
): string {
  if (!specimenId) return ''

  // Handle case where rarity is passed as skin
  const rarities = ['bronze', 'silver', 'gold', 'platinum']
  let effectiveVariant = variant
  let effectiveSkin = skin

  if (skin && rarities.includes(skin.toLowerCase())) {
    effectiveVariant = skin.toLowerCase() as 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
    effectiveSkin = '_any'
  }

  // Если указан конкретный скин (не _any), используем текстуру скина
  if (effectiveSkin && effectiveSkin !== '_any' && effectiveSkin.trim() !== '') {
    // Используем существующую функцию для получения текстуры скина
    const skinName = effectiveSkin.toLowerCase()
    const skinPath = getSkinTexture(specimenId, skinName)
    if (skinPath) {
      // getSkinTexture(id, skin) уже ищет точное совпадение по skins.json,
      // но на случай fallback на старый skinTextureMap - подстрахуемся проверкой пути.
      if (skinPath.toLowerCase().includes(skinName)) {
        return skinPath
      }
    }

    // Если скин задан, но его нет в маппинге, мы НЕ должны пытаться угадать путь,
    // так как это часто ведет к 404 (например BF_04_starwars).
    // Вместо этого лучше сразу вернуть обычную версию мутанта (fallback),
    // чем показывать битую картинку.

    // Однако, мы можем проверить пару известных исключений или паттернов, если нужно.
    // Но для надежности - пропускаем ручное конструирование пути скина и идем к вариантам/нормалу.
  }

  // Используем существующую функцию для получения текстуры мутанта (только для normal)
  if (effectiveVariant === 'normal') {
    const mutantPath = getMutantTexture(specimenId)
    if (mutantPath) {
      return mutantPath
    }
  }

  // Fallback: строим путь вручную (для вариантов или если normal не найден)
  const { folder, fileId } = normalizeMutantId(specimenId)
  if (!folder || !fileId) return ''

  const suffix = effectiveVariant === 'normal' ? 'normal' : effectiveVariant
  const specimenPath = `/textures_by_mutant/${folder}/specimen_${folder}_${suffix}.webp`
  return specimenPath
}

/**
 * Получает все возможные fallback пути для мутанта
 */
export function getMutantTextureFallbacks(
  specimenId: string,
  skin: string = '_any',
  variant: 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum' = 'normal',
): string[] {
  const { folder, fileId } = normalizeMutantId(specimenId)
  if (!folder || !fileId) return []

  // Handle case where rarity is passed as skin
  const rarities = ['bronze', 'silver', 'gold', 'platinum']
  let effectiveVariant = variant
  let effectiveSkin = skin

  if (skin && rarities.includes(skin.toLowerCase())) {
    effectiveVariant = skin.toLowerCase() as 'normal' | 'bronze' | 'silver' | 'gold' | 'platinum'
    effectiveSkin = '_any'
  }

  const fallbacks: string[] = []

  if (effectiveSkin && effectiveSkin !== '_any' && effectiveSkin.trim() !== '') {
    const skinName = effectiveSkin.toLowerCase()
    // Добавляем fallback для скинов
    fallbacks.push(
      `/textures_by_skins/textures_by_skin/semi-full/specimen_${folder}_${skinName}.webp`,
    )
    fallbacks.push(`/textures_by_skins/textures_by_skin/full-char/${fileId}_${skinName}.webp`)
  }

  // Fallback на текстуру с вариантом
  const suffix = effectiveVariant === 'normal' ? 'normal' : effectiveVariant
  fallbacks.push(`/textures_by_mutant/${folder}/specimen_${folder}_${suffix}.webp`)

  // Если вариант не normal, добавляем normal как самый последний fallback
  if (effectiveVariant !== 'normal') {
    fallbacks.push(`/textures_by_mutant/${folder}/${fileId}_normal.webp`)
  }

  return fallbacks
}

/**
 * Получает путь к текстуре награды
 */
export function getRewardTexturePath(reward: {
  name: string
  type: 'entity' | 'hardcurrency' | 'softcurrency'
  amount?: number
  skin?: string
}): string | null {
  // Используем существующую функцию для entity
  if (reward.type === 'entity') {
    const name = reward.name

    // 1. Проверяем, не является ли награда мутантом
    if (name.startsWith('Specimen_') || name.startsWith('specimen_')) {
      // Пытаемся получить текстуру мутанта.
      const skin = reward.skin || '_any'
      const mutantTex = getMutantTexturePath(name, skin)
      if (mutantTex) return mutantTex

      // Попробуем поиск по нормализованному имени (без апострофов и спецсимволов)
      const normalizedName = normalizeSearch(name)
      if (normalizedName && normalizedName !== name.toLowerCase()) {
        const normTex = getMutantTexturePath(normalizedName, skin)
        if (normTex) return normTex
      }
    }

    // 2. Проверяем Orbs
    if (name.toLowerCase().includes('orb_')) {
      // Проверяем common paths
      // В public/orbs/special/ или public/orbs/
      // Так как мы не можем проверить существование файла, вернем наиболее вероятный,
      // но лучше если мы знаем точное имя.
      // В find мы видели: public/orbs/special/orb_special_addregenerate.webp

      // Попробуем угадать папку по имени
      if (name.includes('special')) {
        return `/orbs/special/${name}.webp`
      }
      // Basic orbs? Мы не видели папку basic, но видели orb_basic в именах?
      // Нет, в find results были только special и boosters.
      // Но `orb_basic_xp_04` был в списке.
      // Если он не найден, попробуем вернуть просто в /materials/ или /items/?
      // В списке файлов я не видел orb_basic...

      // Стоп, я видел 'public/orbs/special/orb_slot_spe.webp' и кучу 'orb_special...'.
      // 'orb_basic_...' я НЕ видел в выводе find.
      // Значит orb_basic, вероятно, отсутствует или называется иначе.
      // Но я добавлю путь /orbs/basic/ на всякий случай.
      if (name.includes('basic')) {
        return `/orbs/basic/${name}.webp`
      }
      return `/orbs/${name}.webp`
    }

    // 3. Проверяем Charms/Boosters
    if (name.toLowerCase().includes('charm_') || name.toLowerCase().includes('booster_')) {
      // Charms лежат в public/boosters/ и имеют lowercase имена
      return `/boosters/${name.toLowerCase()}.webp`
    }

    // 4. Проверяем известные материалы
    const texture = getItemTexture(name)
    if (texture) return texture

    // Специальные случаи для звезд
    if (name === 'Star_Bronze') return '/stars/star_bronze.webp'
    if (name === 'Star_Silver') return '/stars/star_silver.webp'
    if (name === 'Star_Gold') return '/stars/star_gold.webp'
    if (name === 'Star_Platinum') return '/stars/star_platinum.webp'

    // Специальный фикс для Energy
    if (name === 'Material_Energy25') return '/materials/icon_ticket.webp'
    // Фикс для XP
    if (name === 'Material_XP1000') return '/materials/normal_xp.webp'

    // Фиксы для зданий (пути должны совпадать с buildings.json - раньше
    // ссылались на несуществующие /buildings/gold_hc1.webp и gold_hc2.webp,
    // из-за чего иконка золотоплавильни не отображалась ни на одной доске бинго)
    if (name === 'Building_HC_1') return '/buildings/forge_hc1.png'
    if (name === 'Building_HC_2') return '/buildings/gold_furnace_hc2.png'

    // Фиксы для Хабитатов (Luxe)
    if (name.toLowerCase().includes('habitat_') && name.toLowerCase().includes('_hc')) {
      return `/zones/luxe/${name.toLowerCase()}.webp`
    }

    // Fallback для материалов: пробуем найти в /materials/
    // Приводим к lowercase, так как многие файлы там lowercase (material_jackpot_token.webp)
    // Но некоторые uppercase (Material_Antimatter.webp).
    // Мы вернем исходный вариант, а браузер попытается загрузить.
    // Если 404, можно было бы onError, но здесь мы возвращаем строку.
    // Попробуем вернуть точное совпадение сначала.

    // Хак: для токенов часто используется lowercase
    if (name.includes('Token') || name.includes('token')) {
      return `/materials/${name.toLowerCase()}.webp`
    }

    return `/materials/${name}.webp`
  }

  // Для валюты
  if (reward.type === 'hardcurrency') {
    const amount = reward.amount || 0
    if (amount >= 5000) return '/cash/g5000.webp'
    if (amount >= 2000) return '/cash/g2000.webp'
    if (amount >= 1000) return '/cash/g1000.webp'
    if (amount >= 500) return '/cash/g500.webp'
    if (amount >= 200) return '/cash/g200.webp'
    if (amount >= 100) return '/cash/g100.webp'
    if (amount >= 80) return '/cash/g80.webp'
    if (amount >= 50) return '/cash/g50.webp'
    if (amount >= 40) return '/cash/g40.webp'
    if (amount >= 30) return '/cash/g30.webp'
    if (amount >= 20) return '/cash/g20.webp'
    if (amount >= 10) return '/cash/g10.webp'
    return '/cash/hardcurrency.webp'
  }

  if (reward.type === 'softcurrency') {
    const amount = reward.amount || 0
    if (amount >= 10000000000) return '/cash/s10000000000.webp'
    if (amount >= 1000000000) return '/cash/s5000000000.webp'
    if (amount >= 100000000) return '/cash/s10000000000.webp'
    if (amount >= 10000000) return '/cash/s10000000.webp'
    if (amount >= 1000000) return '/cash/s1000000.webp'
    if (amount >= 100000) return '/cash/s100000.webp'
    if (amount >= 75000) return '/cash/s75000.webp'
    if (amount >= 50000) return '/cash/s50000.webp'
    if (amount >= 10000) return '/cash/s10000.webp'
    if (amount >= 1000) return '/cash/s1000.webp'
    if (amount >= 500) return '/cash/s500.webp'
    if (amount >= 100) return '/cash/s100.webp'
    return '/cash/softcurrency.webp'
  }

  return null
}

/**
 * Получает название награды для отображения
 */
// Слова "золота"/"серебра" переведены на все 9 языков - сами имена предметов
// (translateItemId, ITEM_TRANSLATIONS в craft-simulator.ts) остаются RU, это
// общий для всего сайта пробел (см. память i18n-known-coverage-gaps).
export const GOLD_WORD: Record<Locale, string> = {
  ru: 'золота',
  en: 'gold',
  es: 'oro',
  fr: "d'or",
  de: 'Gold',
  pt: 'ouro',
  it: 'oro',
  tr: 'altın',
  nl: 'goud',
}
export const SILVER_WORD: Record<Locale, string> = {
  ru: 'серебра',
  en: 'silver',
  es: 'plata',
  fr: "d'argent",
  de: 'Silber',
  pt: 'prata',
  it: 'argento',
  tr: 'gümüş',
  nl: 'zilver',
}
export const INTL_LOCALE: Record<Locale, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  it: 'it-IT',
  tr: 'tr-TR',
  nl: 'nl-NL',
}

// Общий форматтер "N золота/серебра" - переиспользуется getRewardLabel() ниже
// и BoxModal.svelte (цена бокса - та же валютная фраза, другой контекст).
export function formatCurrencyAmount(
  amount: number,
  type: 'hardcurrency' | 'softcurrency',
  locale: Locale = 'ru',
): string {
  const n = amount.toLocaleString(INTL_LOCALE[locale] ?? 'ru-RU')
  const word =
    type === 'hardcurrency'
      ? (GOLD_WORD[locale] ?? GOLD_WORD.ru)
      : (SILVER_WORD[locale] ?? SILVER_WORD.ru)
  return `${n} ${word}`
}

export function getRewardLabel(
  reward: {
    name: string
    type: 'entity' | 'hardcurrency' | 'softcurrency'
    amount?: number
  },
  locale: Locale = 'ru',
  names?: Record<string, MutantNameEntry>,
): string {
  if (reward.type === 'hardcurrency' || reward.type === 'softcurrency') {
    return formatCurrencyAmount(reward.amount ?? 0, reward.type, locale)
  }

  // Для entity используем перевод из craft-simulator (RU-only), прогнанный
  // через materials-i18n для не-RU локалей - тот же баг и фикс, что был
  // в /guides (translateItemId игнорировал locale), см. память
  // i18n-known-coverage-gaps.md раздел /bingo. Specimen_* id - отдельный
  // случай: materials-i18n не покрывает мутантов вообще, поэтому падал
  // молча на RU-имя (найдено live-прогоном "тесты везде" 2026-08-17,
  // completion-reward мутант на /bingo был русским на всех не-RU языках).
  const ru = translateItemId(reward.name)
  let translated = ru
  if (locale !== 'ru') {
    if (reward.name.startsWith('Specimen_')) {
      translated = names?.[reward.name.toLowerCase()]?.name ?? ru
    } else if (reward.name.startsWith('Habitat_') || reward.name.startsWith('Building_')) {
      // Habitat_*_HC/Building_*_HC (люкс-зоны) не покрыты materials-i18n -
      // тот же паттерн, что уже решён в guides-resolve.ts: размер зоны
      // важнее гена-специфичного названия, generic-фолбэк лучше RU-утечки.
      const match = reward.name.match(/_(\d+)_HC$/)
      translated = match ? t('guides.reward.luxZone', locale).replace('{n}', String(Number(match[1]) + 1)) : getItemName(reward.name, locale, ru)
    } else {
      translated = getItemName(reward.name, locale, ru)
    }
  }
  if (reward.amount && reward.amount > 1) {
    return `${translated} ×${reward.amount}`
  }
  return translated
}

const BINGO_ICON_BASE = 'https://cdn.archivist-library.com/bingo/'

// Соответствие id бинго -> иконка. Продублировано из CSS-классов .icon-<id>
// в src/pages/bingo.astro (там это background-image, здесь нужен голый URL
// для JS-компонентов вроде дропдауна фильтра на /mutants).
const BINGO_ICON_FILE: Record<string, string> = {
  '2025_skins': 'bingo_2025_skins.webp',
  '2025_mutants': 'bingo_mutants_2025.webp',
  anniversary_25: 'bingo_anniversery.webp',
  anniversary_26: 'bingo_anniversery.webp',
  cross_mutation: 'bingo_cross_mutation.webp',
  research_1: 'bingo_1.webp',
  research_2: 'bingo_2.webp',
  research_3: 'bingo_3.webp',
  research_4: 'bingo_4.webp',
  research_5: 'bingo_5.webp',
  research_6: 'bingo_6.webp',
  research_7: 'bingo_7.webp',
  research_8: 'bingo_8.webp',
  research_9: 'bingo_9.webp',
  research_10: 'bingo_10.webp',
  research_11: 'bingo_11.webp',
  reactor: 'bingo_reactor.webp',
  legend: 'bingo_legendary.webp',
  rumble: 'bingo_rumble.webp',
  heroic: 'bingo_heroic.webp',
  event_2019: 'bingo_special.webp',
  event_2020: 'bingo_special.webp',
  event_2021: 'bingo_special.webp',
  event_2022: 'bingo_special.webp',
  event_2023: 'bingo_special.webp',
  event_2024: 'bingo_special.webp',
  '10years': 'bingo_special.webp',
  events: 'bingo_special.webp',
  '2025_events': 'bingo_2025_events.webp',
  '2026_events': 'bingo_2025_events.webp',
  '2026_skins': 'bingo_2025_skins.webp',
  '2026_mutants': 'bingo_mutants_2025.webp',
  zodiac: 'bingo_zodiac.webp',
  zodiac_silver: 'bingo_silver_zodiac.webp',
  amazons: 'bingo_amazons.webp',
  bingo_bronze: 'bingo_bronze.webp',
  bingo_silver: 'bingo_silver.webp',
  bingo_gold: 'bingo_gold.webp',
  bingo_plat: 'bingo_platinum.webp',
  starter_plat: 'bingo_starter_platinum.webp',
  Starter: 'bingo_starter.webp',
}

export function bingoIconUrl(id: string): string {
  const file = BINGO_ICON_FILE[id]
  return file ? `${BINGO_ICON_BASE}${file}` : '/etc/icon_bingo.webp'
}
