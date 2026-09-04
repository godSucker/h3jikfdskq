// Одноразовый наполнитель /announcements тестовыми данными на ~3 месяца
// назад - страница пока СКРЫТА (нет ссылки в навигации), это чисто для
// визуальной оценки дизайна фида по всем категориям разом. Берёт РЕАЛЬНЫЕ
// id из данных репозитория (не выдумывает), помечает title префиксом
// "🧪 [ТЕСТ]" чтобы не спутать с настоящими анонсами при будущей уборке.
// НЕ трогает ledger (announced-ids-cache.json) - реальная авто-детекция
// не видит эти записи и не будет их дублировать/скипать.
//
// Запуск: npx tsx scripts/simulate-announcements-page-data.ts
// Уборка перед тем как открывать страницу публично: удалить все записи
// с id, начинающимся на "test-", из src/data/announcements.json.

import fs from 'fs/promises'
import path from 'path'

const ROOT = process.cwd()
const ANNOUNCEMENTS_PATH = path.join(ROOT, 'src/data/announcements.json')

interface AnnouncementItem {
  id: string
  name: string
  image?: string | null
  price?: { amount: number; type: 'hardcurrency' | 'softcurrency' | 'usd' } | null
  ribbon?: string | null
}
interface Announcement {
  id: string
  date: string
  category: string
  title: string
  items: AnnouncementItem[]
  link?: string | null
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf-8'))
  } catch {
    return fallback
  }
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

async function main() {
  const { fetchShopForecast } = await import('./detect-shop-forecast')
  const { fetchDailyNewsForecast } = await import('./detect-daily-news')
  const [shopForecast, dailyNewsForecast] = await Promise.all([
    fetchShopForecast().catch(() => null),
    fetchDailyNewsForecast().catch(() => null),
  ])

  const [
    mutants,
    skinsData,
    raids,
    special,
    reactors,
    gachaCovers,
    tokens,
    boxes,
    bingos,
    dungeonCovers,
  ] = await Promise.all([
    loadJson<{ id: string; name: string; stars?: Record<string, { images?: string[] }> }[]>(
      'src/data/mutants/mutants.json',
      [],
    ),
    loadJson<{ specimens: { id: string; name: string; skin: string; image?: string[] }[] }>(
      'src/data/mutants/skins.json',
      { specimens: [] },
    ),
    loadJson<{ id: string; name: string; fightCount: number }[]>('src/data/guides/raids.json', []),
    loadJson<{
      experiment: { id: string; name: string; fightCount: number }[]
      challenge: { id: string; name: string; fightCount: number }[]
    }>('src/data/guides/special-ladders.json', { experiment: [], challenge: [] }),
    loadJson<Record<string, string>>('src/data/simulators/reactor/gacha-name-ru.json', {}),
    loadJson<Record<string, string>>('src/data/simulators/reactor/gacha-covers.json', {}),
    loadJson<{ id: string; name: string; texture?: string | null }[]>(
      'src/data/materials/material.json',
      [],
    ),
    loadJson<{ itemId: string; name: string; icon?: string }[]>('src/data/boxes.json', []),
    loadJson<{ id: string; title: string }[]>('src/data/bingos.json', []),
    loadJson<Record<string, string | null>>('src/data/guides/dungeon-covers.json', {}),
  ])

  const tokenList = tokens.filter((t) => /token/i.test(t.id))
  const skinList = skinsData.specimens.filter((s) => s.skin && !['_any', 'none'].includes(s.skin))
  const ladderList = [...special.experiment, ...special.challenge]

  const firstImg = (stars?: Record<string, { images?: string[] }>) => {
    if (!stars) return null
    for (const k of ['normal', 'bronze', 'silver', 'gold', 'platinum']) {
      const img = stars[k]?.images?.[0]
      if (img) return img
    }
    return null
  }

  type Gen = () => Announcement | null
  let mi = 0,
    si = 0,
    ri = 0,
    li = 0,
    gi = 0,
    ti = 0,
    bxi = 0,
    bgi = 0

  const gens: Record<string, Gen> = {
    mutant: () => {
      const m = mutants[mi++ % mutants.length]
      return {
        id: `test-mutant-${mi}`,
        date: '',
        category: 'mutant',
        title: m.name,
        items: [{ id: m.id, name: m.name, image: firstImg(m.stars) }],
        link: '/mutants',
      }
    },
    skin: () => {
      if (skinList.length === 0) return null
      const s = skinList[si++ % skinList.length]
      return {
        id: `test-skin-${si}`,
        date: '',
        category: 'skin',
        title: `${s.name} — скин`,
        items: [
          { id: `${s.id}|${s.skin}`, name: `${s.name} — ${s.skin}`, image: s.image?.[0] ?? null },
        ],
        link: '/mutants',
      }
    },
    raid: () => {
      if (raids.length === 0) return null
      const r = raids[ri++ % raids.length]
      const cover = dungeonCovers[r.id]
      return {
        id: `test-raid-${ri}`,
        date: '',
        category: 'raid',
        title: `Рейд «${r.name}»`,
        items: [
          { id: r.id, name: `Рейд «${r.name}» (${r.fightCount} боёв)`, image: cover ?? null },
        ],
        link: '/guides',
      }
    },
    ladder: () => {
      if (ladderList.length === 0) return null
      const l = ladderList[li++ % ladderList.length]
      const cover = dungeonCovers[l.id]
      return {
        id: `test-ladder-${li}`,
        date: '',
        category: 'ladder',
        title: `Лесенка «${l.name}»`,
        items: [
          { id: l.id, name: `Лесенка «${l.name}» (${l.fightCount} боёв)`, image: cover ?? null },
        ],
        link: '/guides',
      }
    },
    reactor: () => {
      const entries = Object.entries(reactors)
      if (entries.length === 0) return null
      const [id, name] = entries[gi++ % entries.length]
      return {
        id: `test-reactor-${gi}`,
        date: '',
        category: 'reactor',
        title: name,
        items: [{ id, name, image: gachaCovers[id] ?? null }],
        link: '/simulators/reactor',
      }
    },
    token: () => {
      if (tokenList.length === 0) return null
      const t = tokenList[ti++ % tokenList.length]
      return {
        id: `test-token-${ti}`,
        date: '',
        category: 'token',
        title: t.name,
        items: [{ id: t.id, name: t.name, image: t.texture ?? null }],
        link: '/materials',
      }
    },
    box: () => {
      if (boxes.length === 0) return null
      const b = boxes[bxi++ % boxes.length]
      return {
        id: `test-box-${bxi}`,
        date: '',
        category: 'box',
        title: b.name,
        items: [{ id: b.itemId, name: b.name, image: b.icon ?? null }],
        link: '/boxes',
      }
    },
    bingo: () => {
      if (bingos.length === 0) return null
      const b = bingos[bgi++ % bingos.length]
      return {
        id: `test-bingo-${bgi}`,
        date: '',
        category: 'bingo',
        title: b.title,
        items: [{ id: b.id, name: b.title, image: null }],
        link: '/bingo',
      }
    },
    shopForecast: () => {
      if (!shopForecast) return null
      return {
        id: `test-shopForecast-${shopForecast.sprint}`,
        date: '',
        category: 'shopForecast',
        title: `Прогноз магазина (${shopForecast.dateRangeLabel})`,
        items: shopForecast.items.map((it) => ({
          id: `${shopForecast.sprint}|${it.itemId}`,
          name: it.name,
          image: it.image,
          price: it.price,
          ribbon: it.ribbon,
        })),
        link: '/announcements',
      }
    },
    dailyNews: () => {
      if (!dailyNewsForecast) return null
      return {
        id: `test-dailyNews-${dailyNewsForecast.sprint}`,
        date: '',
        category: 'dailyNews',
        title: `Скоро в игре (${dailyNewsForecast.dateRangeLabel})`,
        items: dailyNewsForecast.items.map((it) => ({
          id: `${dailyNewsForecast.sprint}|${it.filter}`,
          name: it.name,
          image: it.image ?? dailyNewsForecast.coverImage,
          price: it.price,
          ribbon: it.ribbon,
        })),
        link: '/announcements',
      }
    },
  }

  const categoryCycle = Object.keys(gens)
  const announcements = await loadJson<Announcement[]>('src/data/announcements.json', [])
  const existing = announcements.filter((a) => !a.id.startsWith('test-'))

  const fresh: Announcement[] = []
  // 12 недель назад -> сегодня, 1-2 категории в неделю, по кругу - так на
  // 3 месяца набегает несколько записей на каждую категорию.
  for (let week = 12; week >= 0; week--) {
    const day = week * 7 + Math.floor(Math.random() * 3)
    const perWeek = 1 + (week % 2)
    for (let k = 0; k < perWeek; k++) {
      const cat = categoryCycle[(week * 3 + k) % categoryCycle.length]
      const a = gens[cat]()
      // shopForecast/dailyNews не циклятся по образцам как остальные категории
      // (генератор всегда отдаёт ТЕКУЩИЙ живой спринт) - при повторном выпадении
      // в цикле недель id совпадёт, пропускаем дубль.
      if (a && !fresh.some((f) => f.id === a.id)) {
        a.date = daysAgo(day)
        fresh.push(a)
      }
    }
  }

  const merged = [...existing, ...fresh]
  await fs.writeFile(ANNOUNCEMENTS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
  console.log(
    `[SIMULATE-PAGE] Добавлено ${fresh.length} тестовых записей (id начинаются с "test-").`,
  )
}

main().catch((err) => {
  console.error('[SIMULATE-PAGE] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
