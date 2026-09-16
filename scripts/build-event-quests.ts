import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'

// Ивентовые задания для /guides (таб "Квесты", секция "Ивентовые задания") и для
// авто-анонсов. Отдельный скрипт, а НЕ расширение build-quests.ts: тот держит
// ровно 297 обычных квестов под regression guard, и их title/caption уже
// переведены на 9 языков через content-i18n.json - трогать его генерацию
// опасно. Разведка и решения юзера - Obsidian, "Задания (missions.xml) -
// разведка ивентовых квестов (2026-09-16)".
//
// Устройство missions.xml, от которого тут всё пляшет:
// - ивентовая цепочка = миссии с одним <Filter> (это и есть привязка к ивенту);
// - настоящее задание помечено <Tag key="missionStyle" value="events"/>;
// - между заданиями в той же цепочке prevMissions стоят ДЕСЯТКИ диалоговых
//   реплик (caption="DialogPVE_Story_*", title="", без objectives) - у
//   Анализатора тайны 38 записей и только 6 заданий. Диалоги тег events не
//   несут, поэтому фильтр по нему их уже отсекает;
// - текст условия лежит в caption ОБЪЕКТИВА (caption_win_pve_obj1 = "Победить
//   в PvE-сражениях"), а caption самой миссии - флейвор-реплика персонажа;
// - требуемый уровень ("Required fame") лежит в <Condition type="level"> в
//   ПЕРВОЙ записи цепочки, а она обычно диалоговая - идём по prevMissions назад.

const MISSIONS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/missions.xml'
const LOC_URL = (lang: string) => `https://s-beta.kobojo.com/mutants/gameconfig/localisation_${lang}.txt`
const ICON_BASE = 'https://s-ak.kobojo.com/mutants/assets/mobile/icon-quest/'

export const LOCALES = ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
export type Locale = (typeof LOCALES)[number]
export type I18nText = Record<Locale, string>

const OUT_PATH = path.join(process.cwd(), 'src/data/guides/event-quests.json')
const NAMES_PATH = path.join(process.cwd(), 'src/data/guides/event-quest-names.json')

// Та же разметка категорий, что в build-quests.ts (сверена там по реальным
// caption). Дублируется намеренно - импорт из build-quests.ts запустил бы его
// main() побочным эффектом.
const ACTION_CATEGORY: Record<string, string> = {
  killSpecimen: 'battle', killBetterTeamThanMeInPve: 'battle',
  killMoreThanOneMutantsWithOneAttack: 'battle', sameKillerForAllOpponents: 'battle',
  specimenKilledBeforeAttack: 'battle', setDamages: 'battle',
  winFightWithLessThanHundredLife: 'battle', loseMutant: 'battle', winPve: 'battle',
  winPveLadder: 'battle', losePve: 'battle', teamFullAfterPveFight: 'battle', launchAssist: 'battle',
  finishPvpFight: 'pvp', winPvp: 'pvp', losePvp: 'pvp', winPvpStraight: 'pvp',
  teamFullAfterPvpFight: 'pvp', openFight: 'pvp',
  launchCraft: 'craft', launchCraftPlus: 'craft', openCraft: 'craft',
  launchHybridation: 'breeding', hybridationOver: 'breeding', duplicateBreed: 'breeding',
  hoursBreeding: 'breeding', showbreedingitems: 'breeding',
  hoursIncubating: 'incubation', fillMutosterone: 'incubation',
  specimenlevelup: 'incubation', accelerate: 'incubation',
  accelerateHabitatLevelOne: 'building', collectHabitat: 'building', buyExtension: 'building',
  updateTechCenter: 'building', placeCreature: 'building', refillHpWithHc: 'building',
  sendGift: 'social', openMutoDex: 'social',
}
const CONDITION_CATEGORY: Record<string, string> = { level: 'level', custom: 'collection', ownEntity: 'collection' }

export interface EventQuestStep {
  id: string
  part: string | null
  title: I18nText
  condition: I18nText
  amount: number | null
  category: string
  rewards: { id: string | null; type: string | null; amount: number }[]
}

export interface EventQuestChain {
  filter: string
  name: I18nText
  // localisation - официальное имя из игры; authored - написано нами по
  // контексту фильтра (юзер разрешил 2026-09-16 именно для имён ивентов);
  // fallback - ни того ни другого, показываем причёсанный фильтр.
  nameSource: 'localisation' | 'authored' | 'fallback'
  requiredLevel: number | null
  icon: string | null
  steps: EventQuestStep[]
}

function arr<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

async function loadLocalisations(): Promise<Record<Locale, Map<string, string>>> {
  const raws = await Promise.all(
    LOCALES.map((l) => axios.get<string>(LOC_URL(l), { responseType: 'text', timeout: 60000 })),
  )
  const out = {} as Record<Locale, Map<string, string>>
  LOCALES.forEach((l, i) => {
    const m = new Map<string, string>()
    for (const rawLine of raws[i].data.split(/\r?\n/)) {
      const idx = rawLine.indexOf(';')
      if (idx === -1) continue
      m.set(
        rawLine.slice(0, idx).trim().toLowerCase(),
        rawLine.slice(idx + 1).trim().replace(/\\n/g, '\n').replace(/\/n/g, '\n'),
      )
    }
    out[l] = m
  })
  return out
}

// Переводит ключ локализации на все 9 языков. Нет перевода на языке - берём
// русский (на крайний случай английский), чтобы в карточке не зияла дыра.
function translate(locs: Record<Locale, Map<string, string>>, key: string | undefined | null): I18nText {
  const k = (key ?? '').toLowerCase()
  const ru = k ? (locs.ru.get(k) ?? '') : ''
  const en = k ? (locs.en.get(k) ?? '') : ''
  const out = {} as I18nText
  for (const l of LOCALES) out[l] = (k && locs[l].get(k)) || ru || en
  return out
}

function isEmpty(t: I18nText): boolean {
  return !t.ru && !t.en
}

// Тема ивента из фильтра: filter_dungeon_halloween25 -> halloween,
// Missions_Event_Jungle_Bells_2017 -> jungle_bells.
function filterTheme(filter: string): string {
  return filter
    .toLowerCase()
    .replace(/^(filter_dungeon_|filter_missions_|filter_mission_|filter_quests_|missions_event_challenge_|missions_event_|missions_|patch_building_|patch_)/, '')
    .replace(/_?(pt)?\d+(_\d+)*$/, '')
    .replace(/_\d+$/, '')
}

function prettifyFilter(filter: string): string {
  return filter
    .replace(/^(filter_dungeon_|filter_missions_|filter_mission_|filter_quests_|Missions_|Patch_)/i, '')
    .replace(/_/g, ' ')
    .trim()
}

async function main() {
  const [{ data: xml }, locs] = await Promise.all([
    axios.get<string>(MISSIONS_URL, { responseType: 'text', timeout: 60000 }),
    loadLocalisations(),
  ])

  let authored: Record<string, Partial<I18nText>> = {}
  try {
    authored = JSON.parse(await fs.readFile(NAMES_PATH, 'utf-8'))
  } catch {
    authored = {}
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  })
  const missions: Record<string, any>[] = arr(parser.parse(xml)?.Missions?.missions?.Mission)
  const byId = new Map(missions.map((m) => [String(m.id), m]))

  const tagOf = (m: Record<string, any>, key: string): string | undefined =>
    arr(m.Tag).find((t: any) => t?.key === key)?.value

  // Требуемый уровень цепочки: от первого задания идём по prevMissions назад
  // до корня и берём первое встреченное <Condition type="level">.
  function requiredLevelFor(firstId: string): number | null {
    let cur: string | undefined = firstId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const m = byId.get(cur)
      if (!m) break
      const cond = arr(m.Condition).find((c: any) => c?.type === 'level')
      if (cond?.amount) return Number(cond.amount)
      cur = (m.prevMissions as string | undefined)?.split(',')[0]?.trim() || undefined
    }
    return null
  }

  const groups = new Map<string, Record<string, any>[]>()
  for (const m of missions) {
    if (tagOf(m, 'missionStyle') !== 'events') continue
    const filter = arr(m.Filter)[0]
    if (!filter || typeof filter !== 'string') continue
    if (!groups.has(filter)) groups.set(filter, [])
    groups.get(filter)!.push(m)
  }

  const chains: EventQuestChain[] = []
  const unnamed: string[] = []

  for (const [filter, list] of groups) {
    list.sort((a, b) => Number(a.id) - Number(b.id))

    const steps: EventQuestStep[] = list.map((m) => {
      const objectives = m.objectives ?? {}
      const objs = [
        ...arr(objectives.ClientObjective),
        ...arr(objectives.ConditionObjective),
        ...arr(objectives.ActionObjective),
        ...arr(objectives.SellObjective),
      ] as Record<string, any>[]
      const o = objs[0] ?? {}
      const action = arr(o.clientAction)[0] as string | undefined
      const cond = o.Condition as Record<string, any> | undefined
      const category = action
        ? (ACTION_CATEGORY[action] ?? 'misc')
        : cond?.type
          ? (CONDITION_CATEGORY[cond.type] ?? 'misc')
          : 'misc'
      const amountRaw = (o.amount as string | undefined) ?? (cond?.amount as string | undefined)
      return {
        id: String(m.id),
        part: tagOf(m, 'part') ?? null,
        title: translate(locs, m.title),
        condition: translate(locs, o.caption),
        amount: amountRaw ? Number(amountRaw) : null,
        category,
        rewards: arr(m.reward).map((r: any) => ({
          id: r?.id ?? null,
          type: r?.type ?? (r?.id ? 'entity' : null),
          amount: r?.amount ? Number(r.amount) : 1,
        })),
      }
    })

    const theme = filterTheme(filter)
    let name = translate(locs, `event_name_${theme}`)
    let nameSource: EventQuestChain['nameSource'] = 'localisation'
    if (isEmpty(name)) name = translate(locs, `building_${theme}`)
    if (isEmpty(name)) {
      const a = authored[filter]
      if (a?.ru) {
        const out = {} as I18nText
        for (const l of LOCALES) out[l] = a[l] || a.en || a.ru
        name = out
        nameSource = 'authored'
      } else {
        const p = prettifyFilter(filter)
        name = Object.fromEntries(LOCALES.map((l) => [l, p])) as I18nText
        nameSource = 'fallback'
        unnamed.push(filter)
      }
    }

    const icon = list.map((m) => m.icon as string | undefined).find(Boolean)
    chains.push({
      filter,
      name,
      nameSource,
      requiredLevel: requiredLevelFor(String(list[0].id)),
      icon: icon ? `${ICON_BASE}${icon}.png` : null,
      steps,
    })
  }

  // Свежие ивенты сверху: у цепочек нет дат в самом файле, но id миссий
  // монотонно растут со временем добавления - этого достаточно для порядка.
  chains.sort((a, b) => Number(b.steps[0].id) - Number(a.steps[0].id))

  await fs.writeFile(OUT_PATH, JSON.stringify(chains, null, 2) + '\n')
  const stepsTotal = chains.reduce((s, c) => s + c.steps.length, 0)
  const bySource = chains.reduce<Record<string, number>>((acc, c) => {
    acc[c.nameSource] = (acc[c.nameSource] ?? 0) + 1
    return acc
  }, {})
  console.log(`[EVENT-QUESTS] цепочек: ${chains.length}, заданий: ${stepsTotal}, имена: ${JSON.stringify(bySource)}`)
  if (unnamed.length) console.log(`[EVENT-QUESTS] без имени (нужен event-quest-names.json): ${unnamed.join(', ')}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[EVENT-QUESTS] упал:', err)
    process.exit(1)
  })
}
