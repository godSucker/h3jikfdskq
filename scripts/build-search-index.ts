// Строит public/search-index/{locale}.json (9 файлов) - лёгкие индексы для
// сайтового поиска (SearchBox.svelte). Работает только с заголовками/
// ссылками/ключевыми словами, никаких стат-блоков или описаний - цель
// держать каждый файл далеко под 200 КБ, т.к. его дёргает fetch() на
// клиенте при первом клике в поиск.
//
// ДО 2026-08-17 генерировался ОДИН public/search-index.json (только RU) -
// поиск на всех 8 не-RU языках показывал RU-заголовки И вёл по ссылкам БЕЗ
// locale-префикса (клик на результат уводил на RU-версию страницы). См.
// память i18n-final-audit-2026-08-16. Теперь по одному файлу на локаль,
// переиспользует уже готовые locale-aware источники (names.{lang}.json,
// materials-i18n.json, GACHA_NAME_EN, bingoLabelL, getBoxName) - без LLM.
//
// ВАЖНО: этот файл НЕ импортируется в BaseLayout.astro/SearchBox.svelte
// напрямую - он лежит в public/, чтобы попасть в статические ассеты сборки
// (см. гочу "SSR + fs.readFileSync в Vercel" в CLAUDE.md: src/data/ на
// рантайме недоступен, только dist/ и то, что было в public/).
//
// Запуск: npx tsx scripts/build-search-index.ts
// Автоматически перед `npm run build` (см. "prebuild" в package.json).

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bingoLabelL } from '@/lib/mutant-dicts'
import { t, type Locale } from '@/lib/i18n'
import { getLocalizedMutantNames } from '@/lib/mutant-names-i18n'
import { getItemName } from '@/lib/materials-i18n'
import { getBoxName } from '@/lib/boxes-i18n'
import { GACHA_NAME_RU, GACHA_NAME_EN } from '@/lib/reactor-gacha'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public/search-index')

const LOCALES: Locale[] = ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl']

interface SearchEntry {
  title: string
  category: string
  href: string
  keywords?: string
}

interface SearchEntryOut {
  title: string
  category: string
  href: string
  keywords?: string[]
}

async function readJson<T>(relPath: string): Promise<T> {
  const raw = await fs.readFile(path.join(ROOT, relPath), 'utf-8')
  return JSON.parse(raw) as T
}

// Страницы без locale-обёртки (src/pages/{locale}/...) - НЕ добавлять
// префикс, иначе ссылка ведёт на несуществующий маршрут (404). /announcements
// не входит в i18n-эпик (не выяснено, публичная ли это страница вообще).
const NO_PREFIX_PATHS = new Set(['/announcements'])

function withLocale(href: string, locale: Locale): string {
  if (locale === 'ru') return href
  const pathPart = href.split(/[?#]/)[0]
  if (NO_PREFIX_PATHS.has(pathPart)) return href
  return `/${locale}${href}`
}

async function build(locale: Locale): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = []
  const isRu = locale === 'ru'
  const { names } = getLocalizedMutantNames(locale)

  // --- Статические страницы сайта ---
  const STATIC: SearchEntry[] = [
    { title: t('nav.home', locale), category: t('search.category.site', locale), href: '/' },
    {
      title: t('nav.mutants', locale),
      category: t('search.category.mutants', locale),
      href: '/mutants',
      keywords: isRu ? 'каталог вики список всех мутантов' : undefined,
    },
    {
      title: t('nav.bingo', locale),
      category: t('search.category.site', locale),
      href: '/bingo',
      keywords: isRu ? 'морфология награды' : undefined,
    },
    {
      title: t('nav.tierList', locale),
      category: t('search.category.site', locale),
      href: '/tier-list',
      keywords: isRu ? 'tier list пвп рейтинг' : 'tier list pvp ranking',
    },
    {
      title: t('nav.rebalance', locale),
      category: t('search.category.site', locale),
      href: '/rebalance',
      keywords: isRu ? 'история изменений статов баланс' : undefined,
    },
    {
      title: t('nav.topMutants', locale),
      category: t('search.category.site', locale),
      href: '/top-mutants',
      keywords: isRu ? 'рейтинг лучшие мутанты' : 'ranking best mutants',
    },
    {
      title: t('nav.topEvo', locale),
      category: t('search.category.site', locale),
      href: '/top-evo',
      keywords: isRu ? 'лидерборд эволюция' : 'leaderboard evolution',
    },
    { title: t('nav.credits', locale), category: t('search.category.site', locale), href: '/credits' },
    { title: t('search.announcements', locale), category: t('search.category.site', locale), href: '/announcements' },
    {
      title: t('nav.statsCalculator', locale),
      category: t('search.category.calculators', locale),
      href: '/simulators/stats',
      keywords: isRu ? 'статы уровень звёзды сферы сравнение' : undefined,
    },
    {
      title: t('nav.evoCalculator', locale),
      category: t('search.category.calculators', locale),
      href: '/evolution/evotech-calculator',
      keywords: isRu ? 'эволюция ресурсы evotech' : 'evolution resources evotech',
    },
    { title: t('search.simulatorsHub', locale), category: t('search.category.simulators', locale), href: '/simulators' },
    {
      title: t('simulatorsIndex.card.breeding.title', locale),
      category: t('search.category.simulators', locale),
      href: '/simulators/breeding',
      keywords: isRu ? 'скрещивание гены секретные рецепты breeding' : 'breeding genes secrets recipes',
    },
    {
      title: t('simulatorsIndex.card.craft.title', locale),
      category: t('search.category.simulators', locale),
      href: '/simulators/craft',
      keywords: 'black hole craft lab',
    },
    {
      title: t('simulatorsIndex.card.pvp.title', locale),
      category: t('search.category.simulators', locale),
      href: '/simulators/pvp',
      keywords: isRu ? 'пвп бой арена' : 'pvp battle arena',
    },
    {
      title: t('search.reactorHub', locale),
      category: t('search.category.simulators', locale),
      href: '/simulators/reactor',
      keywords: isRu ? 'гача reactor генераторы' : 'gacha reactor generators',
    },
    { title: t('search.rouletteHub', locale), category: t('search.category.simulators', locale), href: '/simulators/roulette' },
    // Бренд-названия рулеток остаются английскими на всех языках (официально
    // непереводимо, тот же паттерн что GACHA_NAME_EN - см. попытка
    // reactor-gacha.ts / память i18n-known-coverage-gaps).
    { title: 'Cash Frenzy', category: t('search.category.simulators', locale), href: '/simulators/roulette/cash' },
    { title: 'Lucky Slots', category: t('search.category.simulators', locale), href: '/simulators/roulette/lucky' },
    { title: 'Mutants Madness', category: t('search.category.simulators', locale), href: '/simulators/roulette/madness' },
  ]
  entries.push(...STATIC.map((e) => ({ ...e, href: withLocale(e.href, locale) })))

  // --- Мутанты (src/data/mutants/mutants.json) ---
  interface MutantRaw {
    id: string
    name?: string
  }
  const mutants = await readJson<MutantRaw[]>('src/data/mutants/mutants.json')
  for (const m of mutants) {
    if (!m.id || !m.name) continue
    const name = (!isRu && names[m.id]?.name) || m.name
    entries.push({
      title: name,
      category: t('search.category.mutants', locale),
      href: withLocale(`/mutants?mutant=${encodeURIComponent(m.id)}`, locale),
    })
  }

  // --- Реактор: отдельные генераторы ---
  interface GachaDefinition {
    [key: string]: unknown
  }
  const gachaMap = await readJson<Record<string, GachaDefinition>>(
    'src/data/simulators/reactor/gacha.json',
  )
  for (const id of Object.keys(gachaMap)) {
    const name = isRu ? (GACHA_NAME_RU[id] ?? id) : (GACHA_NAME_EN[id] ?? GACHA_NAME_RU[id] ?? id)
    entries.push({
      title: `${name} — ${t('search.reactorSuffix', locale)}`,
      category: t('search.category.simulators', locale),
      href: withLocale(`/simulators/reactor/${encodeURIComponent(id)}`, locale),
      keywords: isRu ? 'реактор гача генератор' : 'reactor gacha generator',
    })
  }

  // --- Гайды: хаб + каждая вкладка ---
  interface GuideTab {
    key: string
    label: string
    ready: boolean
  }
  const guideTabs = await readJson<GuideTab[]>('src/data/guides/tabs.json')
  entries.push({ title: t('guides.pageTitle', locale), category: t('search.category.guides', locale), href: '/guides' })
  for (const tab of guideTabs) {
    if (!tab.ready) continue
    const key = `guides.tab.${tab.key}`
    const translated = t(key, locale)
    entries.push({
      title: translated !== key ? translated : tab.label,
      category: t('search.category.guides', locale),
      href: withLocale(`/guides#${tab.key}`, locale),
    })
  }

  // --- Материалы: страницы + отдельные вкладки, обогащённые именами предметов ---
  interface NamedItem {
    id?: string
    name?: string
  }
  const orbs = await readJson<NamedItem[]>('src/data/materials/orbs.json')
  const charms = await readJson<NamedItem[]>('src/data/materials/charms.json')
  const material = await readJson<NamedItem[]>('src/data/materials/material.json')
  const buildings = await readJson<NamedItem[]>('src/data/materials/buildings.json')
  const zones = await readJson<{ normal?: NamedItem[]; luxe?: NamedItem[] }>(
    'src/data/materials/zones.json',
  )
  const localizedNames = (list: NamedItem[] | undefined) =>
    (list ?? [])
      .map((x) => {
        if (!x.name) return null
        if (isRu || !x.id) return x.name
        return getItemName(x.id, locale, x.name)
      })
      .filter(Boolean)
      .join(' ')

  entries.push({
    title: t('materials.tab.orbs', locale),
    category: t('search.category.materials', locale),
    href: withLocale('/materials/orbs', locale),
    keywords: `${isRu ? 'орбы бонусы' : 'orbs bonuses'} ${localizedNames(orbs)}`,
  })
  entries.push({
    title: t('materials.tab.charms', locale),
    category: t('search.category.materials', locale),
    href: withLocale('/materials/charms', locale),
    keywords: `${isRu ? 'чармы бустеры' : 'charms boosters'} ${localizedNames(charms)}`,
  })
  entries.push({
    title: t('materials.tab.materials', locale),
    category: t('search.category.materials', locale),
    href: withLocale('/materials?tab=materials', locale),
    keywords: `${isRu ? 'жетоны ресурсы' : 'tokens resources'} ${localizedNames(material)}`,
  })
  entries.push({
    title: t('materials.tab.buildings', locale),
    category: t('search.category.materials', locale),
    href: withLocale('/materials?tab=buildings', locale),
    keywords: `${isRu ? 'постройки' : 'buildings'} ${localizedNames(buildings)}`,
  })
  entries.push({
    title: t('materials.tab.zones', locale),
    category: t('search.category.materials', locale),
    href: withLocale('/materials?tab=zones', locale),
    keywords: `${isRu ? 'зоны обитания' : 'habitat zones'} ${localizedNames(zones.normal)} ${localizedNames(zones.luxe)}`,
  })

  // --- Бинго: хаб + каждая доска отдельно ---
  interface BingoRaw {
    id: string
    title: string
  }
  const bingos = await readJson<BingoRaw[]>('src/data/bingos.json')
  function bingoTitle(raw: BingoRaw): string {
    const byId = bingoLabelL(raw.id, locale)
    if (byId && byId !== raw.id) return byId
    const byTitle = bingoLabelL(raw.title, locale)
    if (byTitle && byTitle !== raw.title) return byTitle
    return raw.title
      .replace(/^--------/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  }
  for (const b of bingos) {
    if (!b.id) continue
    entries.push({
      title: bingoTitle(b),
      category: t('search.category.bingo', locale),
      href: withLocale(`/bingo?board=${encodeURIComponent(b.id)}`, locale),
    })
  }

  // --- Боксы: только хаб ---
  interface BoxRaw {
    id?: string
    name?: string
  }
  const boxes = await readJson<BoxRaw[]>('src/data/boxes.json')
  const boxNames = boxes
    .map((b) => (b.id && b.name ? (isRu ? b.name : getBoxName(b.id, locale, b.name)) : null))
    .filter(Boolean)
    .join(' ')
  entries.push({
    title: t('nav.boxes', locale),
    category: t('search.category.site', locale),
    href: withLocale('/boxes', locale),
    keywords: boxNames,
  })

  return entries
}

function toOutput(entries: SearchEntry[]): SearchEntryOut[] {
  return entries.map((e) => ({
    ...e,
    keywords: e.keywords ? e.keywords.split(/\s+/).filter(Boolean) : undefined,
  }))
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  for (const locale of LOCALES) {
    const entries = toOutput(await build(locale))
    const json = JSON.stringify(entries)
    const outPath = path.join(OUT_DIR, `${locale}.json`)
    await fs.writeFile(outPath, json, 'utf-8')
    const kb = (Buffer.byteLength(json) / 1024).toFixed(1)
    console.log(
      `[search-index] ${locale}: wrote ${entries.length} entries, ${kb} KB -> ${path.relative(ROOT, outPath)}`,
    )
  }
}

main().catch((err) => {
  console.error('[search-index] failed:', err)
  process.exitCode = 1
})
