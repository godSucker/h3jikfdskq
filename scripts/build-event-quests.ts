import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { runMain } from './lib/run-main'
import { XMLParser } from 'fast-xml-parser'
import { loadFilterDates, loadDateLedger, hasLiveFilterData } from './kartel-filter-dates'
import {
  isEventFilter,
  LOCALES,
  TEST_FILTER_RE,
  arr,
  buildDonors,
  fixCondition,
  isEmpty,
  loadLocalisations,
  objectiveOf,
  translate,
  type I18nText,
  type Locale,
} from './quest-text'

// Ивентовые задания для /guides (таб "Квесты", секция "Ивентовые задания") и для
// авто-анонсов. Сюжетные квесты и ачивки собирает build-quests.ts, тексты и
// починка условий у обоих общие (quest-text.ts). Разведка и решения юзера -
// Obsidian, "Задания (missions.xml) - разведка ивентовых квестов (2026-09-16)".
//
// Устройство missions.xml, от которого тут всё пляшет:
// - ивентовая цепочка = миссии с одним <Filter> (это и есть привязка к ивенту);
// - настоящее задание помечено <Tag key="missionStyle" value="events"/> (у
//   ивентов 2016-2017 - "hard", в архиве встречается "repeat"). Тег Kobojo
//   иногда забывает: у Хеллоуина 2025 без него остались этапы 8/15, 12/15 и
//   14/15, поэтому заданием считаем и миссию без тега, если она лежит в
//   фильтре ивента и у неё есть objectives и title (см. isQuestStep);
// - между заданиями в той же цепочке prevMissions стоят ДЕСЯТКИ диалоговых
//   реплик (caption="DialogPVE_Story_*", title="", без objectives) - у
//   Анализатора тайны 38 записей и только 6 заданий. Их отсекает отсутствие
//   objectives;
// - в одном фильтре обычно НЕСКОЛЬКО параллельных линий заданий со своей
//   нумерацией в <Tag key="part">: у годовщины 2026 (часть 2) это линии на 5,
//   4, 3, 5 и 6 этапов, и вторая открывается после 1-го этапа первой. Линии
//   восстанавливает splitIntoLines;
// - текст условия лежит в caption ОБЪЕКТИВА (caption_win_pve_obj1 = "Победить
//   в PvE-сражениях"), а caption самой миссии - флейвор-реплика персонажа;
// - требуемый уровень ("Required fame") лежит в <Condition type="level"> в
//   ПЕРВОЙ записи цепочки, а она обычно диалоговая - идём по prevMissions назад.

const MISSIONS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/missions.xml'
const ICON_BASE = 'https://s-ak.kobojo.com/mutants/assets/mobile/icon-quest/'

const OUT_PATH = path.join(process.cwd(), 'src/data/guides/event-quests.json')
const NAMES_PATH = path.join(process.cwd(), 'src/data/guides/event-quest-names.json')

export interface EventQuestStep {
  id: string
  part: string | null
  // Номер линии внутри цепочки (0, 1, ...). steps идут подряд по линиям, внутри
  // линии - в порядке прохождения; нумерация этапов на сайте своя в каждой линии.
  line: number
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
  // Постоянная цепочка, а не ивент: патч с новым зданием (Patch_Building_Mystery)
  // или сюжетное обновление. На /guides она живёт в "Сюжете" (её собирает и
  // build-quests.ts), а здесь остаётся ради анонса новых заданий.
  permanent: boolean
  requiredLevel: number | null
  icon: string | null
  // Окно ивента по Filter-тегу цепочки (kartel через live-filter-dates.json,
  // либо только старт из date-ledger.json). null - kartel про ивент не знает:
  // у старых цепочек это норма, дат за прошлые годы сервер не отдаёт.
  dateStart: string | null
  dateEnd: string | null
  steps: EventQuestStep[]
}

// Тема ивента из фильтра: filter_dungeon_halloween25 -> halloween,
// Missions_Event_Jungle_Bells_2017 -> jungle_bells.
function filterTheme(filter: string): string {
  return filter
    .toLowerCase()
    .replace(
      /^(filter_dungeon_|filter_missions_|filter_mission_|filter_quests_|missions_event_challenge_|missions_event_|missions_|patch_building_|patch_)/,
      '',
    )
    .replace(/_?(pt)?\d+(_\d+)*$/, '')
    .replace(/_\d+$/, '')
}

// ИМЕНА ИВЕНТОВ ПО КОНТЕКСТУ ФИЛЬТРА. Официального имени у большинства цепочек
// нет (event_name_* в локализации есть только у тематических лесенок), и юзер
// 2026-09-16 разрешил писать их самим по смыслу фильтра - пример юзера:
// filter_missions_anniversary26_2 -> "Годовщина 2026, часть 2". Шаблоны, а не
// ручной список на 121 запись: новый ивент того же вида (скажем,
// filter_dungeon_halloween26) получит имя сам. Точечные правки - через
// event-quest-names.json, он приоритетнее.
type Words = Record<Locale, string>
const W = {
  event: {
    ru: 'Ивент',
    en: 'Event',
    es: 'Evento',
    fr: 'Événement',
    de: 'Event',
    pt: 'Evento',
    it: 'Evento',
    tr: 'Etkinlik',
    nl: 'Evenement',
  },
  challenge: {
    ru: 'Испытание',
    en: 'Challenge',
    es: 'Desafío',
    fr: 'Défi',
    de: 'Herausforderung',
    pt: 'Desafio',
    it: 'Sfida',
    tr: 'Meydan okuma',
    nl: 'Uitdaging',
  },
  anniversary: {
    ru: 'Годовщина',
    en: 'Anniversary',
    es: 'Aniversario',
    fr: 'Anniversaire',
    de: 'Jubiläum',
    pt: 'Aniversário',
    it: 'Anniversario',
    tr: 'Yıl dönümü',
    nl: 'Jubileum',
  },
  xmas: {
    ru: 'Рождество',
    en: 'Christmas',
    es: 'Navidad',
    fr: 'Noël',
    de: 'Weihnachten',
    pt: 'Natal',
    it: 'Natale',
    tr: 'Noel',
    nl: 'Kerstmis',
  },
  easter: {
    ru: 'Пасха',
    en: 'Easter',
    es: 'Pascua',
    fr: 'Pâques',
    de: 'Ostern',
    pt: 'Páscoa',
    it: 'Pasqua',
    tr: 'Paskalya',
    nl: 'Pasen',
  },
  valentines: {
    ru: 'День святого Валентина',
    en: "Valentine's Day",
    es: 'San Valentín',
    fr: 'Saint-Valentin',
    de: 'Valentinstag',
    pt: 'Dia dos Namorados',
    it: 'San Valentino',
    tr: 'Sevgililer Günü',
    nl: 'Valentijnsdag',
  },
  halloween: {
    ru: 'Хеллоуин',
    en: 'Halloween',
    es: 'Halloween',
    fr: 'Halloween',
    de: 'Halloween',
    pt: 'Halloween',
    it: 'Halloween',
    tr: 'Cadılar Bayramı',
    nl: 'Halloween',
  },
  weirdtech: {
    ru: 'Странные технологии',
    en: 'Weird Tech',
    es: 'Tecnología extraña',
    fr: 'Technologie étrange',
    de: 'Seltsame Technik',
    pt: 'Tecnologia estranha',
    it: 'Tecnologia strana',
    tr: 'Tuhaf teknoloji',
    nl: 'Vreemde technologie',
  },
  part: {
    ru: 'часть',
    en: 'part',
    es: 'parte',
    fr: 'partie',
    de: 'Teil',
    pt: 'parte',
    it: 'parte',
    tr: 'bölüm',
    nl: 'deel',
  },
  day: {
    ru: 'день',
    en: 'day',
    es: 'día',
    fr: 'jour',
    de: 'Tag',
    pt: 'dia',
    it: 'giorno',
    tr: 'gün',
    nl: 'dag',
  },
  story: {
    ru: 'сюжет',
    en: 'story',
    es: 'historia',
    fr: 'histoire',
    de: 'Story',
    pt: 'história',
    it: 'storia',
    tr: 'hikaye',
    nl: 'verhaal',
  },
  storyUpdate: {
    ru: 'Сюжетное обновление',
    en: 'Story update',
    es: 'Actualización de la historia',
    fr: "Mise à jour de l'histoire",
    de: 'Story-Update',
    pt: 'Atualização da história',
    it: 'Aggiornamento della storia',
    tr: 'Hikaye güncellemesi',
    nl: 'Verhaalupdate',
  },
  ended: {
    ru: 'Завершённые ивенты',
    en: 'Ended events',
    es: 'Eventos finalizados',
    fr: 'Événements terminés',
    de: 'Beendete Events',
    pt: 'Eventos encerrados',
    it: 'Eventi conclusi',
    tr: 'Sona eren etkinlikler',
    nl: 'Afgelopen evenementen',
  },
  feature: {
    ru: 'Новые функции',
    en: 'New features',
    es: 'Nuevas funciones',
    fr: 'Nouvelles fonctionnalités',
    de: 'Neue Funktionen',
    pt: 'Novos recursos',
    it: 'Nuove funzionalità',
    tr: 'Yeni özellikler',
    nl: 'Nieuwe functies',
  },
  test: {
    ru: 'Тестовые задания',
    en: 'Test missions',
    es: 'Misiones de prueba',
    fr: 'Missions de test',
    de: 'Testmissionen',
    pt: 'Missões de teste',
    it: 'Missioni di prova',
    tr: 'Test görevleri',
    nl: 'Testmissies',
  },
} satisfies Record<string, Words>

const join = (fn: (l: Locale) => string): I18nText =>
  Object.fromEntries(LOCALES.map((l) => [l, fn(l)])) as I18nText

function authoredName(filter: string): I18nText | null {
  const f = filter.toLowerCase()
  if (f === 'missions_event_ended') return join((l) => W.ended[l])
  if (f === 'missions_event_feature') return join((l) => W.feature[l])
  if (f.startsWith('missions_test_')) {
    const tail = filter.slice('Missions_Test_'.length).replace(/_/g, ' ')
    return join((l) => `${W.test[l]}: ${tail}`)
  }

  let m = f.match(/storypatch_(\d+)/)
  if (m) return join((l) => `${W.storyUpdate[l]}, ${W.part[l]} ${m![1]}`)

  if (f.includes('jungle_bells')) {
    const y = f.match(/(20\d\d)/)?.[1]
    return join(() => (y ? `Jungle Bells ${y}` : 'Jungle Bells'))
  }

  m = f.match(/event_challenge_(\d+)$/)
  if (m) return join((l) => `${W.challenge[l]} #${m![1]}`)
  m = f.match(/^missions_event_(\d+)$/)
  if (m) return join((l) => `${W.event[l]} #${m![1]}`)

  const theme = (
    ['anniversary', 'valentines', 'halloween', 'weirdtech', 'easter', 'xmas'] as const
  ).find((t) => f.includes(t))
  if (!theme) return null

  // Хвост после темы: "26_2", "_24_1", "_2018_pt1", "20_1", "_day_1".
  const tail = f.slice(f.indexOf(theme) + theme.length)
  const nums = [...tail.matchAll(/\d+/g)].map((x) => x[0])
  let year: string | null = null
  let part: string | null = null
  if (nums[0] && (nums[0].length === 4 || nums[0].length === 2)) {
    year = nums[0].length === 4 ? nums[0] : `20${nums[0]}`
    part = nums[1] ?? null
  } else if (nums[0]) {
    part = nums[0]
  }
  const isDay = /_day_/.test(tail)
  const suffix =
    f.includes('_story_') || f.startsWith('filter_story_')
      ? 'story'
      : f.includes('pvp')
        ? 'pvp'
        : null

  return join((l) => {
    let s = W[theme][l]
    if (year) s += ` ${year}`
    if (suffix === 'story') s += ` — ${W.story[l]}`
    if (suffix === 'pvp') s += ' — PvP'
    if (part) s += isDay ? ` — ${W.day[l]} ${part}` : `, ${W.part[l]} ${part}`
    return s
  })
}

function prettifyFilter(filter: string): string {
  return filter
    .replace(
      /^(filter_dungeon_|filter_missions_|filter_mission_|filter_quests_|Missions_|Patch_)/i,
      '',
    )
    .replace(/_/g, ' ')
    .trim()
}

const QUEST_STYLES = new Set(['events', 'hard', 'repeat'])
// Архив завершённых заданий: 229 миссий без тега там - это старые обычные
// квесты, перенесённые Kobojo, а не этапы ивентов. В архиве берём только
// помеченные.
const ARCHIVE_FILTER = 'missions_event_ended'

function filterKey(m: Record<string, any>): string | null {
  const f = arr(m.Filter)[0]
  return typeof f === 'string' && f ? f.toLowerCase() : null
}

function hasObjectives(m: Record<string, any>): boolean {
  return !!m.objectives && typeof m.objectives === 'object' && Object.keys(m.objectives).length > 0
}

function isQuestStep(
  m: Record<string, any>,
  eventFilters: Set<string>,
  style: string | undefined,
): boolean {
  const f = filterKey(m)
  if (!f || !hasObjectives(m) || !m.title) return false
  if (style && QUEST_STYLES.has(style)) return true
  return eventFilters.has(f) && f !== ARCHIVE_FILTER
}

interface PartTag {
  i: number
  // "?" - Kobojo не указал общее число ("3/?").
  n: string
}

function parsePart(raw: string | null | undefined): PartTag | null {
  const m = /^(\d+)\/(\d+|\?)$/.exec(raw ?? '')
  return m ? { i: Number(m[1]), n: m[2] } : null
}

// Раскладывает задания одного фильтра по параллельным линиям. Опора - связи
// prevMissions (через диалоговые реплики до ближайшего задания) и тег part.
// Kobojo в part ошибается ("1/4 -> 2/3 -> 3/4", дважды "3/4", "1/8 -> 2/10"),
// поэтому правила терпимые:
// - шаг с part i>1 продолжает линию родителя, если у них одно общее число и
//   i не меньше, либо общее число разное, но i ровно на 1 больше (опечатка);
// - "1/N" всегда начинает новую линию;
// - шаг без part идёт в линию родителя (старые ивенты part не несут вовсе);
// - связь потеряна (родитель в другом фильтре) - ищем единственную линию с тем
//   же общим числом, где уже есть предыдущий номер.
// Внутри линии порядок по part, затем по id; линии - по первому id.
function splitIntoLines(
  list: Record<string, any>[],
  prevQuestsOf: (m: Record<string, any>) => string[],
  tagOf: (m: Record<string, any>, key: string) => string | undefined,
): Record<string, any>[][] {
  const ids = new Set(list.map((m) => String(m.id)))
  const byId = new Map(list.map((m) => [String(m.id), m]))
  const partOf = (m: Record<string, any>) => parsePart(tagOf(m, 'part'))
  const root = new Map(list.map((m) => [String(m.id), String(m.id)]))
  const find = (x: string): string => {
    while (root.get(x) !== x) {
      root.set(x, root.get(root.get(x)!)!)
      x = root.get(x)!
    }
    return x
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) root.set(rb, ra)
  }

  const sorted = [...list].sort((a, b) => Number(a.id) - Number(b.id))
  for (const m of sorted) {
    const id = String(m.id)
    const s = partOf(m)
    const parents = prevQuestsOf(m).filter((x) => ids.has(x))
    let linked = false
    for (const pid of parents) {
      const q = partOf(byId.get(pid)!)
      if (!s) {
        union(pid, id)
        linked = true
        continue
      }
      if (s.i === 1) continue
      if (!q) {
        union(pid, id)
        linked = true
        continue
      }
      const sameTotal = s.n === q.n && s.i >= q.i
      const typo = s.n !== q.n && s.n !== '?' && q.n !== '?' && s.i === q.i + 1
      if (sameTotal || typo) {
        union(pid, id)
        linked = true
      }
    }
    if (s && s.i > 1 && !linked) {
      const lower = sorted.filter((o) => {
        const p = partOf(o)
        return Number(o.id) < Number(id) && p?.n === s.n && p.i < s.i
      })
      const lines = new Map<string, Record<string, any>[]>()
      for (const o of lower) {
        const r = find(String(o.id))
        const taken = sorted.some(
          (x) => Number(x.id) < Number(id) && find(String(x.id)) === r && partOf(x)?.i === s.i,
        )
        if (!taken) lines.set(r, [...(lines.get(r) ?? []), o])
      }
      if (lines.size === 1) union([...lines.keys()][0], id)
    }
  }

  const groups = new Map<string, Record<string, any>[]>()
  for (const m of sorted) {
    const r = find(String(m.id))
    groups.set(r, [...(groups.get(r) ?? []), m])
  }
  return [...groups.values()]
    .map((g) =>
      g.sort(
        (a, b) =>
          (partOf(a)?.i ?? Number.MAX_SAFE_INTEGER) - (partOf(b)?.i ?? Number.MAX_SAFE_INTEGER) ||
          Number(a.id) - Number(b.id),
      ),
    )
    .sort(
      (a, b) => Math.min(...a.map((m) => Number(m.id))) - Math.min(...b.map((m) => Number(m.id))),
    )
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

  // Группируем по фильтру БЕЗ учёта регистра: у Kobojo один и тот же ивент
  // бывает записан в двух регистрах (Missions_Event_Challenge_48 - 1 задание,
  // Missions_Event_challenge_48 - ещё 13), и иначе он разваливался на две
  // карточки с одинаковым именем "Испытание #48".
  const eventFilters = new Set(
    missions
      .filter((m) => QUEST_STYLES.has(tagOf(m, 'missionStyle') ?? ''))
      .map(filterKey)
      .filter((f): f is string => !!f),
  )
  const questIds = new Set<string>()
  const groups = new Map<string, { filter: string; list: Record<string, any>[] }>()
  for (const m of missions) {
    if (!isQuestStep(m, eventFilters, tagOf(m, 'missionStyle'))) continue
    const filter = arr(m.Filter)[0] as string
    const key = filter.toLowerCase()
    questIds.add(String(m.id))
    if (!groups.has(key)) groups.set(key, { filter, list: [] })
    groups.get(key)!.list.push(m)
  }

  // Ближайшие предыдущие ЗАДАНИЯ: идём по prevMissions через диалоговые реплики.
  const prevQuestsOf = (m: Record<string, any>): string[] => {
    const found = new Set<string>()
    const seen = new Set<string>()
    const queue = String(m.prevMissions ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    while (queue.length) {
      const id = queue.shift()!
      if (seen.has(id)) continue
      seen.add(id)
      if (questIds.has(id)) {
        found.add(id)
        continue
      }
      const prev = byId.get(id)
      if (prev)
        queue.push(
          ...String(prev.prevMissions ?? '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        )
    }
    return [...found]
  }

  const chains: EventQuestChain[] = []
  const unnamed: string[] = []
  const donorPool = buildDonors(missions, locs)
  const fixes: Record<'missing' | 'renumbered' | 'placeholder' | 'titleLike', string[]> = {
    missing: [],
    renumbered: [],
    placeholder: [],
    titleLike: [],
  }

  for (const { filter, list } of groups.values()) {
    const lines = splitIntoLines(list, prevQuestsOf, tagOf)
    const lineOf = new Map(lines.flatMap((l, i) => l.map((m) => [String(m.id), i] as const)))

    const steps: EventQuestStep[] = lines.flat().map((m) => {
      const info = objectiveOf(m)
      const fixed = fixCondition(info, translate(locs, info.captionKey), donorPool)
      const fix = fixed.fix
      // Текста условия нет вовсе и собрать не из чего - показываем название
      // задания, а не пустую строку с одним "×N".
      const condition = isEmpty(fixed.text) ? translate(locs, m.title) : fixed.text
      if (fix) fixes[fix].push(`${m.id} [${info.sig} ${info.amount}] ${condition.ru}`)
      return {
        id: String(m.id),
        part: tagOf(m, 'part') ?? null,
        line: lineOf.get(String(m.id))!,
        title: translate(locs, m.title),
        condition,
        amount: info.amount,
        category: info.category,
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
    // Официальное имя темы у ежегодных ивентов одно на все годы
    // ("Кошмар Хеллоуина" для 2020..2025) - без года шесть карточек подряд
    // неразличимы. Год берём из фильтра, если он там есть.
    if (!isEmpty(name)) {
      const yearTail = filter
        .toLowerCase()
        .slice(filter.toLowerCase().indexOf(theme) + theme.length)
      const yy = yearTail.match(/^_?(\d{4}|\d{2})(?!\d)/)?.[1]
      if (yy) {
        const year = yy.length === 4 ? yy : `20${yy}`
        name = Object.fromEntries(LOCALES.map((l) => [l, `${name[l]} ${year}`])) as I18nText
      }
      // Missions_Halloween_2018_Pt1 / _Pt2 - иначе обе части сливаются в одно имя.
      const pt = yearTail.match(/_pt(\d+)$/)?.[1]
      if (pt) {
        name = Object.fromEntries(
          LOCALES.map((l) => [l, `${name[l]}, ${W.part[l]} ${pt}`]),
        ) as I18nText
      }
    }
    if (isEmpty(name)) name = translate(locs, `building_${theme}`)
    if (isEmpty(name)) {
      const a = authored[filter]
      if (a?.ru) {
        const out = {} as I18nText
        for (const l of LOCALES) out[l] = a[l] || a.en || a.ru
        name = out
        nameSource = 'authored'
      } else {
        const generated = authoredName(filter)
        if (generated) {
          name = generated
          nameSource = 'authored'
        } else {
          const p = prettifyFilter(filter)
          name = Object.fromEntries(LOCALES.map((l) => [l, p])) as I18nText
          nameSource = 'fallback'
          unnamed.push(filter)
        }
      }
    }

    const icon = list.map((m) => m.icon as string | undefined).find(Boolean)
    chains.push({
      filter,
      name,
      nameSource,
      permanent: !isEventFilter(filter) && !TEST_FILTER_RE.test(filter),
      requiredLevel: requiredLevelFor(String(lines[0][0].id)),
      icon: icon ? `${ICON_BASE}${icon}.png` : null,
      dateStart: null,
      dateEnd: null,
      steps,
    })
  }

  // Даты. Missions_Event_Ended - не ивент, а архивная "свалка" завершённых
  // заданий под общим тегом: его окно у kartel к конкретным заданиям отношения
  // не имеет, поэтому дату ему не ставим вообще.
  // Если в этом прогоне живых kartel-данных нет совсем (шаг fetch-filters.py
  // упал или не запускался) - уже известную дату НЕ стираем: ровно так
  // однажды молча обнулились даты прогноза магазина (см. hasLiveFilterData).
  const [live, ledger, liveOk] = await Promise.all([
    loadFilterDates(),
    loadDateLedger(),
    hasLiveFilterData(),
  ])
  const liveLower = new Map(Object.entries(live).map(([k, v]) => [k.toLowerCase(), v]))
  const ledgerLower = new Map(Object.entries(ledger).map(([k, v]) => [k.toLowerCase(), v]))
  let prevByFilter = new Map<string, EventQuestChain>()
  try {
    const prev = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8')) as EventQuestChain[]
    prevByFilter = new Map(prev.map((c) => [c.filter.toLowerCase(), c]))
  } catch {
    // первый прогон - файла ещё нет
  }
  let dated = 0
  for (const c of chains) {
    const key = c.filter.toLowerCase()
    if (key === 'missions_event_ended') continue
    const range = liveLower.get(key)
    if (range?.start) {
      c.dateStart = range.start
      c.dateEnd = range.end ?? null
    } else if (ledgerLower.get(key)) {
      c.dateStart = ledgerLower.get(key)!
    } else if (!liveOk) {
      const prev = prevByFilter.get(key)
      c.dateStart = prev?.dateStart ?? null
      c.dateEnd = prev?.dateEnd ?? null
    }
    if (c.dateStart) dated++
  }
  console.log(
    `[EVENT-QUESTS] с датой: ${dated}${liveOk ? '' : ' (живых kartel-данных нет - старые даты сохранены)'}`,
  )

  // Свежие ивенты сверху: у цепочек нет дат в самом файле, но id миссий
  // монотонно растут со временем добавления - этого достаточно для порядка.
  const firstId = (c: EventQuestChain) => Math.min(...c.steps.map((st) => Number(st.id)))
  chains.sort((a, b) => firstId(b) - firstId(a))

  // Страховка от битой выгрузки: обрезанный missions.xml или пустая
  // локализация дали бы валидный, но почти пустой JSON - и /guides молча
  // потерял бы задания, а детектор анонсов принял бы это за норму. Прошлый
  // файл в таком случае не трогаем.
  const prevSteps = [...prevByFilter.values()].reduce((sum, c) => sum + c.steps.length, 0)
  const newSteps = chains.reduce((sum, c) => sum + c.steps.length, 0)
  if (
    prevByFilter.size > 0 &&
    (chains.length < prevByFilter.size * 0.8 || newSteps < prevSteps * 0.8)
  ) {
    throw new Error(
      `подозрительно мало данных: цепочек ${chains.length} (было ${prevByFilter.size}), ` +
        `заданий ${newSteps} (было ${prevSteps}) - файл не перезаписан`,
    )
  }
  if (locs.ru.size < 10000 || locs.en.size < 10000) {
    throw new Error(
      `локализация неполная (ru ${locs.ru.size}, en ${locs.en.size} ключей) - файл не перезаписан`,
    )
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(chains, null, 2) + '\n')
  const stepsTotal = chains.reduce((s, c) => s + c.steps.length, 0)
  const bySource = chains.reduce<Record<string, number>>((acc, c) => {
    acc[c.nameSource] = (acc[c.nameSource] ?? 0) + 1
    return acc
  }, {})
  console.log(
    `[EVENT-QUESTS] цепочек: ${chains.length}, заданий: ${stepsTotal}, имена: ${JSON.stringify(bySource)}`,
  )
  const multiLine = chains.filter((c) => c.steps.some((st) => st.line > 0))
  console.log(
    `[EVENT-QUESTS] линий: ${chains.reduce((sum, c) => sum + new Set(c.steps.map((st) => st.line)).size, 0)}, ` +
      `цепочек из нескольких линий: ${multiLine.length}`,
  )
  console.log(
    `[EVENT-QUESTS] условия: восстановлено пустых ${fixes.missing.length}, исправлено число ${fixes.renumbered.length}, подставлено вместо X ${fixes.placeholder.length}, название вместо условия ${fixes.titleLike.length}`,
  )
  const stillEmpty = chains.flatMap((c) =>
    c.steps.filter((st) => isEmpty(st.condition)).map((st) => st.id),
  )
  if (stillEmpty.length) console.log(`[EVENT-QUESTS] без текста условия: ${stillEmpty.join(', ')}`)
  if (process.env.EVENT_QUESTS_VERBOSE) {
    for (const [kind, list] of Object.entries(fixes))
      for (const row of list) console.log(`  ${kind}: ${row}`)
  }
  if (unnamed.length)
    console.log(`[EVENT-QUESTS] без имени (нужен event-quest-names.json): ${unnamed.join(', ')}`)
}

runMain(import.meta.url, 'EVENT-QUESTS', main)
