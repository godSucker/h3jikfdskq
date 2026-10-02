import skinsI18n from '@/data/mutants/skins-i18n.json'
import skinsRuCurated from '@/data/mutants/skins-ru-curated.json'
import type { Locale } from './i18n'

// Листовой модуль без .txt-импортов: его берут и голый tsx (scripts через
// obtain-render.ts), и Vite. Локализованное имя скина на 9 языках, см.
// scripts/sync-skin-names.ts: 33 слага имеют официальный ключ (skins-i18n.json).
const SKINS_I18N = skinsI18n as Record<string, Partial<Record<Locale, string>>>

// Остальные слаги без официального ключа Kobojo: RU-названия написаны вручную
// по явной просьбе владельца сайта (2026-10-03, "перевести сам все ключи
// скинов") - точечное исключение из правила "не придумывать имена". Только RU:
// на остальных языках по-прежнему null (вызывающий код показывает слаг), чтобы
// русский текст не утекал в чужие локали.
const SKINS_RU_CURATED = skinsRuCurated as Record<string, string>

function lookup(slug: string): string {
  return slug in SKINS_I18N || slug in SKINS_RU_CURATED ? slug : slug.toLowerCase()
}

export function getSkinName(slug: string | null | undefined, locale: Locale): string | null {
  if (!slug) return null
  const key = lookup(slug)
  const dict = SKINS_I18N[key]
  if (dict) return dict[locale] ?? dict.en ?? dict.ru ?? null
  return locale === 'ru' ? (SKINS_RU_CURATED[key] ?? null) : null
}

// RU-имя -> слаг (обратный поиск): в данных (obtain.json, announcements.json)
// ссылка на скин лежит то слагом ("oktoberfest"), то уже русским именем
// ("Хеллоуин"), в зависимости от того, когда запись создана.
const RU_NAME_TO_SLUG = new Map<string, string>()
for (const [slug, dict] of Object.entries(SKINS_I18N)) {
  if (dict.ru) RU_NAME_TO_SLUG.set(dict.ru, slug)
}
for (const [slug, name] of Object.entries(SKINS_RU_CURATED)) {
  if (!RU_NAME_TO_SLUG.has(name)) RU_NAME_TO_SLUG.set(name, slug)
}

// Имя скина из данных (слаг ИЛИ RU-имя) -> имя на языке страницы. Не нашлось -
// возвращается как есть (лучше частичный перевод, чем выдумка).
export function localizeSkinRef(ref: string, locale: Locale): string {
  const slug = RU_NAME_TO_SLUG.get(ref) ?? ref
  return getSkinName(slug, locale) ?? ref
}
