// Строит public/search-index.json - лёгкий индекс для сайтового поиска
// (SearchBox.svelte). Работает только с заголовками/ссылками/ключевыми
// словами, никаких стат-блоков или описаний - цель держать файл далеко под
// 200 КБ, т.к. его дёргает fetch() на клиенте при первом клике в поиск.
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
import { bingoLabel } from '@/lib/mutant-dicts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_PATH = path.join(ROOT, 'public/search-index.json')

interface SearchEntry {
  title: string
  category: string
  href: string
  keywords?: string
}

// Итоговая форма, которую реально пишем в JSON: keywords - массив отдельных
// слов, а не одна длинная строка. Fuse.js (см. SearchBox.svelte) считает
// score по каждому элементу string[]-ключа независимо и берёт лучший -
// склеенная в одну строку "Материалы — база" (сотни имён предметов) иначе
// топит релевантное совпадение в шуме и вообще не находится по фразе вроде
// "джекпот" (проверено вручную: score 0.9 против 0.13 с массивом).
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

async function build(): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = []

  // --- Статические страницы сайта (стабильные адреса, руками) ---
  const STATIC: SearchEntry[] = [
    { title: 'Главная', category: 'Сайт', href: '/' },
    {
      title: 'Мутанты — вики',
      category: 'Мутанты',
      href: '/mutants',
      keywords: 'каталог вики список всех мутантов',
    },
    { title: 'Бинго', category: 'Сайт', href: '/bingo', keywords: 'морфология награды' },
    {
      title: 'Тир-лист мутантов',
      category: 'Сайт',
      href: '/tier-list',
      keywords: 'tier list пвп рейтинг',
    },
    {
      title: 'Ребаланс мутантов',
      category: 'Сайт',
      href: '/rebalance',
      keywords: 'история изменений статов баланс',
    },
    {
      title: 'Топ мутантов',
      category: 'Сайт',
      href: '/top-mutants',
      keywords: 'рейтинг лучшие мутанты',
    },
    { title: 'Топ по Эво', category: 'Сайт', href: '/top-evo', keywords: 'лидерборд эволюция' },
    { title: 'Создатели', category: 'Сайт', href: '/credits', keywords: 'разработчики авторы' },
    {
      title: 'Анонсы',
      category: 'Сайт',
      href: '/announcements',
      keywords: 'новости события акции',
    },
    {
      title: 'Калькулятор статов',
      category: 'Калькуляторы',
      href: '/simulators/stats',
      keywords: 'статы уровень звёзды сферы сравнение',
    },
    {
      title: 'Калькулятор эво',
      category: 'Калькуляторы',
      href: '/evolution/evotech-calculator',
      keywords: 'эволюция ресурсы evotech',
    },
    { title: 'Симуляторы — все', category: 'Симуляторы', href: '/simulators' },
    {
      title: 'Симулятор скрещивания',
      category: 'Симуляторы',
      href: '/simulators/breeding',
      keywords: 'скрещивание гены секретные рецепты breeding',
    },
    {
      title: 'Black Hole Craft Lab — симулятор крафта',
      category: 'Симуляторы',
      href: '/simulators/craft',
      keywords: 'крафт black hole лаборатория',
    },
    {
      title: 'Симулятор PvP-боя',
      category: 'Симуляторы',
      href: '/simulators/pvp',
      keywords: 'пвп бой арена',
    },
    {
      title: 'Реактор — выбор генератора',
      category: 'Симуляторы',
      href: '/simulators/reactor',
      keywords: 'гача reactor генераторы',
    },
    {
      title: 'Рулетки — выбор симулятора',
      category: 'Симуляторы',
      href: '/simulators/roulette',
      keywords: 'рулетка',
    },
    {
      title: 'Cash Frenzy — симулятор рулетки',
      category: 'Симуляторы',
      href: '/simulators/roulette/cash',
      keywords: 'кэш машина рулетка',
    },
    {
      title: 'Lucky Slots — симулятор рулетки',
      category: 'Симуляторы',
      href: '/simulators/roulette/lucky',
      keywords: 'лаки слотс рулетка',
    },
    {
      title: 'Mutants Madness — симулятор рулетки',
      category: 'Симуляторы',
      href: '/simulators/roulette/madness',
      keywords: 'безумие мутантов рулетка',
    },
  ]
  entries.push(...STATIC)

  // --- Мутанты (src/data/mutants/mutants.json) ---
  // Только заголовок + ссылка на диплинк модалки (?mutant=<id>, см.
  // MutantsBrowser.svelte) - НЕ базовые статы/абилки/тексты, файл-источник
  // весит ~1.2 МБ, сюда должно попасть в 500-1000 раз меньше на запись.
  interface MutantRaw {
    id: string
    name?: string
  }
  const mutants = await readJson<MutantRaw[]>('src/data/mutants/mutants.json')
  for (const m of mutants) {
    if (!m.id || !m.name) continue
    entries.push({
      title: m.name,
      category: 'Мутанты',
      href: `/mutants?mutant=${encodeURIComponent(m.id)}`,
    })
  }

  // --- Реактор: отдельные генераторы (src/data/simulators/reactor) ---
  interface GachaDefinition {
    [key: string]: unknown
  }
  const gachaMap = await readJson<Record<string, GachaDefinition>>(
    'src/data/simulators/reactor/gacha.json',
  )
  const gachaNameRu = await readJson<Record<string, string>>(
    'src/data/simulators/reactor/gacha-name-ru.json',
  )
  for (const id of Object.keys(gachaMap)) {
    const name = gachaNameRu[id] ?? id
    entries.push({
      title: `${name} — реактор`,
      category: 'Симуляторы',
      href: `/simulators/reactor/${encodeURIComponent(id)}`,
      keywords: 'реактор гача генератор',
    })
  }

  // --- Гайды: хаб + каждая вкладка (src/data/guides/tabs.json) ---
  // Общий источник с GuidesBrowser.svelte - ссылки бьют на /guides#<key>,
  // компонент на маунте читает location.hash и сразу открывает нужную вкладку.
  interface GuideTab {
    key: string
    label: string
    ready: boolean
  }
  const guideTabs = await readJson<GuideTab[]>('src/data/guides/tabs.json')
  entries.push({ title: 'Полезности — гайды', category: 'Гайды', href: '/guides' })
  for (const tab of guideTabs) {
    if (!tab.ready) continue
    entries.push({
      title: tab.label,
      category: 'Гайды',
      href: `/guides#${tab.key}`,
    })
  }

  // --- Материалы: страницы + отдельные вкладки хаба /materials, обогащённые
  // именами предметов как ключевыми словами (сами предметы отдельными
  // результатами не показываем - у них нет собственного URL/якоря, это
  // увеличило бы индекс без пользы). /materials?tab=<key> - РЕАЛЬНЫЙ
  // существующий механизм диплинка (src/pages/materials/index.astro читает
  // ?tab= при заходе, не что-то новое придуманное под поиск). ---
  interface NamedItem {
    name?: string
  }
  const orbs = await readJson<NamedItem[]>('src/data/materials/orbs.json')
  const charms = await readJson<NamedItem[]>('src/data/materials/charms.json')
  const material = await readJson<NamedItem[]>('src/data/materials/material.json')
  const buildings = await readJson<NamedItem[]>('src/data/materials/buildings.json')
  const zones = await readJson<{ normal?: NamedItem[]; luxe?: NamedItem[] }>(
    'src/data/materials/zones.json',
  )
  const names = (list: NamedItem[] | undefined) =>
    (list ?? [])
      .map((x) => x.name)
      .filter(Boolean)
      .join(' ')

  // Тайтлы - ДОСЛОВНО те же лейблы, что в TABS-массиве src/pages/materials/index.astro
  // (Сферы/Бустеры/Материалы/Здания/Зоны) - не придумываем свои формулировки, категория
  // "Материалы" уже показана заголовком секции в дропдауне, повторять её в тайтле не нужно.
  entries.push({
    title: 'Сферы',
    category: 'Материалы',
    href: '/materials/orbs',
    keywords: `орбы бонусы ${names(orbs)}`,
  })
  entries.push({
    title: 'Бустеры',
    category: 'Материалы',
    href: '/materials/charms',
    keywords: `чармы бустеры ${names(charms)}`,
  })
  entries.push({
    title: 'Материалы',
    category: 'Материалы',
    href: '/materials?tab=materials',
    keywords: `жетоны ресурсы ${names(material)}`,
  })
  entries.push({
    title: 'Здания',
    category: 'Материалы',
    href: '/materials?tab=buildings',
    keywords: `постройки ${names(buildings)}`,
  })
  entries.push({
    title: 'Зоны',
    category: 'Материалы',
    href: '/materials?tab=zones',
    keywords: `зоны обитания ${names(zones.normal)} ${names(zones.luxe)}`,
  })

  // --- Бинго: хаб + каждая доска отдельно (src/data/bingos.json), реальный
  // деплинк-механизм /bingo?board=<id> (уже существует - см. bingo.astro, кнопка
  // "Поделиться" строит такую же ссылку). Тайтл строим той же логикой, что и сама
  // страница (formatBingoTitle в bingo.astro): bingoLabel(id) -> bingoLabel(title) ->
  // фолбэк на raw title без "--------"-префикса (см. гочу CLAUDE.md про dash-префиксы).
  interface BingoRaw {
    id: string
    title: string
  }
  const bingos = await readJson<BingoRaw[]>('src/data/bingos.json')
  function bingoTitle(raw: BingoRaw): string {
    const byId = bingoLabel(raw.id)
    if (byId && byId !== raw.id) return byId
    const byTitle = bingoLabel(raw.title)
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
      category: 'Бинго',
      href: `/bingo?board=${encodeURIComponent(b.id)}`,
    })
  }

  // --- Боксы: только хаб (src/data/boxes.json) - на /boxes нет диплинка на
  // конкретный бокс (проверено: нет чтения URL-параметра в boxes.astro), поэтому
  // не придумываем несуществующий якорь, просто добавляем имена боксов в keywords
  // хаб-страницы, как уже сделано для материалов. ---
  const boxes = await readJson<NamedItem[]>('src/data/boxes.json')
  entries.push({
    title: 'Боксы',
    category: 'Сайт',
    href: '/boxes',
    keywords: names(boxes),
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
  const entries = toOutput(await build())
  const json = JSON.stringify(entries)
  await fs.writeFile(OUT_PATH, json, 'utf-8')
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1)
  console.log(
    `[search-index] wrote ${entries.length} entries, ${kb} KB -> ${path.relative(ROOT, OUT_PATH)}`,
  )
}

main().catch((err) => {
  console.error('[search-index] failed:', err)
  process.exitCode = 1
})
