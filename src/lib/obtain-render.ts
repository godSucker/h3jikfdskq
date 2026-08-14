// Батч 11 (3): пересборка obtain.json's "where" на целевую локаль для
// bundle/box записей. НЕ простая подмена всей строки резолвленным по itemId
// именем - "where" состоит из трёх частей: префикс-лейбл ("Набор:"/
// "Лаки-бокс:"/"Мистери-бокс:"), имя товара (резолвится по itemId через
// obtain-names.{lang}.json) и суффикс-модификатор (цена/тир/скин - НЕ имя
// товара, а метаданные конкретной записи, добавленные куратором поверх
// официального названия). Замена всей строки на голое resolved-имя теряла
// суффикс целиком - "Лаки-бокс: Контейнер новичка (бронза)"/"(серебро)"/
// "(золото)"/"(платина)" превращались в 4 неразличимых "Mystery-Box Starter"
// (баг найден живым тестом 2026-08-14, до фикса).
//
// Собрано по live-данным obtain.json: суффиксов всего 6 закрытых паттернов
// (N золота/N серебра/от $N.NN/голый тир/N★+скин/N★ или скин по отдельности) -
// не открытый список произвольного текста, чем и оправдан разбор регулярками
// вместо LLM.

import type { Locale } from './i18n'
import { STAR_DICT, STAR_LABEL } from './mutant-dicts'

const PREFIX_DICT: Record<string, Partial<Record<Locale, string>>> = {
  Набор: {
    en: 'Bundle', es: 'Paquete', fr: 'Pack',
    de: 'Paket', pt: 'Pacote', it: 'Pacchetto', tr: 'Paket', nl: 'Pakket',
  },
  'Лаки-бокс': {
    en: 'Lucky Box', es: 'Caja de la suerte', fr: 'Boîte chanceuse',
    de: 'Glücksbox', pt: 'Caixa da Sorte', it: 'Scatola fortunata', tr: 'Şanslı Kutu', nl: 'Geluksdoos',
  },
  'Мистери-бокс': {
    en: 'Mystery Box', es: 'Caja misteriosa', fr: 'Boîte mystère',
    de: 'Mysterybox', pt: 'Caixa Misteriosa', it: 'Scatola misteriosa', tr: 'Gizem Kutusu', nl: 'Mysteriedoos',
  },
}

const CURRENCY_DICT: Record<'gold' | 'silver', Partial<Record<Locale, string>>> = {
  gold: { en: 'gold', es: 'oro', fr: 'or', de: 'Gold', pt: 'ouro', it: 'oro', tr: 'altın', nl: 'goud' },
  silver: { en: 'silver', es: 'plata', fr: 'argent', de: 'Silber', pt: 'prata', it: 'argento', tr: 'gümüş', nl: 'zilver' },
}

const SKIN_LABEL_DICT: Partial<Record<Locale, string>> = {
  en: 'skin', es: 'skin', fr: 'skin', de: 'Skin', pt: 'skin', it: 'skin', tr: 'skin', nl: 'skin',
}

const FROM_LABEL_DICT: Partial<Record<Locale, string>> = {
  en: 'from', es: 'desde', fr: 'à partir de', de: 'ab', pt: 'a partir de', it: 'a partire da', tr: 'başlangıç', nl: 'vanaf',
}

// Обратный индекс STAR_LABEL (RU: {normal:'Обычный',...}) - суффиксы в
// obtain.json приходят в нижнем регистре ("бронза", не "Бронза").
const RU_TIER_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(STAR_LABEL).map(([key, ru]) => [ru.toLowerCase(), key]),
)

function renderSuffix(raw: string, locale: Locale): string {
  let m = raw.match(/^([\d\s,]+)\s*(золота|серебра)$/)
  if (m) {
    const n = Number(m[1].replace(/[\s,]/g, ''))
    const currency: 'gold' | 'silver' = m[2] === 'золота' ? 'gold' : 'silver'
    const numStr = new Intl.NumberFormat(locale).format(n)
    const word = CURRENCY_DICT[currency][locale] ?? CURRENCY_DICT[currency].en ?? m[2]
    return `${numStr} ${word}`
  }

  m = raw.match(/^от\s*(\$[\d.,]+)$/)
  if (m) {
    const from = FROM_LABEL_DICT[locale] ?? FROM_LABEL_DICT.en ?? 'from'
    return `${from} ${m[1]}`
  }

  const tierKey = RU_TIER_TO_KEY[raw.toLowerCase()]
  if (tierKey) {
    const dict = STAR_DICT[locale] ?? STAR_DICT.en ?? STAR_LABEL
    return dict[tierKey] ?? STAR_DICT.en?.[tierKey] ?? raw
  }

  m = raw.match(/^(\d+)★,\s*скин\s*«([^»]+)»$/)
  if (m) {
    const skinLabel = SKIN_LABEL_DICT[locale] ?? SKIN_LABEL_DICT.en ?? 'skin'
    return `${m[1]}★, ${skinLabel} «${m[2]}»`
  }

  m = raw.match(/^скин\s*«([^»]+)»$/)
  if (m) {
    const skinLabel = SKIN_LABEL_DICT[locale] ?? SKIN_LABEL_DICT.en ?? 'skin'
    return `${skinLabel} «${m[1]}»`
  }

  // "N★" отдельно (без скина) - число+звезда универсальны, перевода не требуют.
  if (/^\d+★$/.test(raw)) return raw

  // Неизвестный паттерн - оставляем RU-текст как есть внутри уже переведённой
  // рамки (лучше частичный перевод, чем полный откат на RU или выдумывание).
  return raw
}

/**
 * Пересобирает "where" на целевую локаль: префикс + резолвленное по itemId
 * имя + переведённый суффикс. Если нет itemId или нет перевода имени для
 * него - возвращает RU "where" как есть целиком (не собирает "франкенштейна"
 * из переведённой рамки вокруг непереведённого RU-имени).
 */
export function renderObtainWhere(
  entry: { type: string; where: string; itemId?: string },
  locale: Locale,
  obtainNames: Record<string, string>,
): string {
  if (locale === 'ru' || (entry.type !== 'bundle' && entry.type !== 'box')) return entry.where
  if (!entry.itemId) return entry.where
  const translatedName = obtainNames[entry.itemId]
  if (!translatedName) return entry.where

  const prefixMatch = entry.where.match(/^(Набор|Лаки-бокс|Мистери-бокс):\s*/)
  const prefixRu = prefixMatch?.[1]
  const rest = prefixMatch ? entry.where.slice(prefixMatch[0].length) : entry.where

  const suffixMatch = rest.match(/\s*\(([^()]*)\)\s*$/)
  const suffixRaw = suffixMatch?.[1]

  const prefix = prefixRu ? (PREFIX_DICT[prefixRu]?.[locale] ?? PREFIX_DICT[prefixRu]?.en ?? prefixRu) : ''
  const suffix = suffixRaw ? renderSuffix(suffixRaw, locale) : ''

  return `${prefix ? `${prefix}: ` : ''}${translatedName.trim()}${suffix ? ` (${suffix})` : ''}`
}
