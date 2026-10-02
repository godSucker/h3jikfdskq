// Английские подписи к скринам анонсов для англоязычной Telegram-группы
// (process-pending-screenshots.ts, цель 'en'). Имена берём из тех же
// locale-словарей, что рисует /en/announcements (buildAnnouncementContext('en')),
// без LLM. Если имя не нашлось на английском (в данных осталась кириллица) -
// подпись выходит без имени, только с типом анонса: лучше пусто, чем RU в EN-чате.
// Только листовые i18n-модули: announcements-render.ts тянет за собой
// craft-simulator/localisation (.txt через Vite-raw-плагин), голый tsx их не грузит.
import boxesData from '../../src/data/boxes.json'
import materialData from '../../src/data/materials/material.json'
import raidsData from '../../src/data/guides/raids.json'
import specialLaddersData from '../../src/data/guides/special-ladders.json'
import { getBoxName } from '../../src/lib/boxes-i18n'
import { getItemName } from '../../src/lib/materials-i18n'
import { getDungeonName } from '../../src/lib/guides-content-i18n'
import { getLocalizedMutantNames } from '../../src/lib/mutant-names-i18n'

const TYPE_EN: Record<string, string> = {
  mutant: 'New mutant',
  skin: 'New skin',
  box: 'New box',
  raid: 'New raid',
  ladder: 'New ladder',
  reactor: 'Reactor rotation',
  token: 'New token',
  exchange: 'Exchange hall update',
  bingo: 'Bingo update',
  shopForecast: 'Shop forecast',
  dailyNews: 'Coming soon',
  eventQuests: 'Event quests',
}

const CYRILLIC = /[А-Яа-яЁё]/
const MAX_NAMES = 4

function clean(name: string | null | undefined): string | null {
  const n = name?.trim()
  return n && !CYRILLIC.test(n) ? n : null
}

interface NamedEntry {
  id: string
  name?: string
}

function ruNameById(list: NamedEntry[], id: string): string | undefined {
  return list.find((x) => x.id === id)?.name
}

export function englishCaptionTitle(category: string, itemIds: string[]): string {
  const typeLabel = TYPE_EN[category] ?? 'Update'
  let names: string[] = []
  try {
    const mutantName = (id: string) => getLocalizedMutantNames('en').names[id.toLowerCase()]?.name
    if (category === 'mutant') {
      names = itemIds.map((id) => clean(mutantName(id)) ?? '')
    } else if (category === 'skin') {
      names = itemIds.map((id) => {
        const [base, key] = id.split('|')
        const mutant = clean(mutantName(base))
        return mutant ? (key ? `${mutant} — ${key}` : mutant) : ''
      })
    } else if (category === 'box') {
      const boxes = boxesData as unknown as { itemId: string; name: string }[]
      names = itemIds.map((id) => {
        const box = boxes.find((b) => b.itemId === id || b.itemId.toLowerCase() === id.toLowerCase())
        return box ? (clean(getBoxName(box.itemId, 'en', box.name)) ?? '') : ''
      })
    } else if (category === 'raid' || category === 'ladder') {
      const special = specialLaddersData as unknown as {
        experiment: NamedEntry[]
        challenge: NamedEntry[]
      }
      // Ключи имён - те же, что в announcements-render.ts: рейды по голому id,
      // особые лесенки по "<группа>/<id>".
      const all: { id: string; key: string; name?: string }[] = [
        ...(raidsData as unknown as NamedEntry[]).map((d) => ({ ...d, key: d.id })),
        ...special.experiment.map((d) => ({ ...d, key: `experiment/${d.id}` })),
        ...special.challenge.map((d) => ({ ...d, key: `challenge/${d.id}` })),
      ]
      names = itemIds.map((id) => {
        const d = all.find((x) => x.id === id)
        return d?.name ? (clean(getDungeonName(d.key, 'en', d.name)) ?? '') : ''
      })
    } else if (category === 'token') {
      const mats = materialData as unknown as NamedEntry[]
      names = itemIds.map((id) => {
        const ru = ruNameById(mats, id)
        return ru ? (clean(getItemName(id, 'en', ru)) ?? '') : ''
      })
    }
  } catch (err) {
    console.error('[ADMIN-BOT] EN caption names failed:', err instanceof Error ? err.message : err)
  }
  const shown = names.filter(Boolean)
  if (shown.length === 0) return typeLabel
  const more = shown.length > MAX_NAMES ? ` +${shown.length - MAX_NAMES}` : ''
  const plural = shown.length > 1 && (category === 'mutant' || category === 'skin') ? 's' : ''
  return `${typeLabel}${plural}: ${shown.slice(0, MAX_NAMES).join(', ')}${more}`
}
