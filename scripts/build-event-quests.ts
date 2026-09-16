import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'
import { loadFilterDates, loadDateLedger, hasLiveFilterData } from './kartel-filter-dates'
import { numbersIn, hasNumber } from '../src/lib/event-quest-text'

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
  // Окно ивента по Filter-тегу цепочки (kartel через live-filter-dates.json,
  // либо только старт из date-ledger.json). null - kartel про ивент не знает:
  // у старых цепочек это норма, дат за прошлые годы сервер не отдаёт.
  dateStart: string | null
  dateEnd: string | null
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

type Locs = Record<Locale, Map<string, string>>

// ТЕКСТ УСЛОВИЯ. Kobojo ошибается в ивентовых заданиях двумя способами
// (разбор 2026-09-17):
// 1) ключа caption нет ни в одном из 9 файлов локализации - 25 заданий
//    (caption_reach120_obj1, caption_hybridize_6h, опечатка caption_m0674_obj1
//    вместо caption_m674_obj1). В карточке оставался пустой этап с одним "×120";
// 2) текст скопирован с другого задания вместе со старым числом - 40 заданий
//    ("Создать 50 предметов" при amount=5). Засчитывает игра по amount из XML,
//    поэтому верным считаем его.
// Оба случая чиним официальным текстом того же типа условия (clientAction или
// Condition type/id), где число заменено на amount. Своих формулировок нет -
// меняются только цифры.

function enOrdinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return 'th'
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
}

// Русские существительные, которые встречаются после числа в чинимых текстах.
// Число мы подставили сами - значит, и согласование за нами: образец с "5
// часов" при amount=2 иначе дал бы "2 часов".
const RU_COUNTED: [string, string, string][] = [
  ['час', 'часа', 'часов'],
  ['предмет', 'предмета', 'предметов'],
  ['подарок', 'подарка', 'подарков'],
]

// Заменяет каждое вхождение числа from на to во всех языках. null - если хоть
// в одном языке числа from нет (текст переведён иначе, подставлять некуда).
// Английский порядковый суффикс пересчитывается ("80th" -> "3rd"); в остальных
// языках он от числа не зависит ("80-е", "80ème", "80.").
function renumber(text: I18nText, from: string, to: number): I18nText | null {
  const out = {} as I18nText
  for (const l of LOCALES) {
    const re = new RegExp(`(?<!\\d)${from}(?!\\d)`, 'g')
    if (!re.test(text[l])) return null
    let s = text[l].replace(re, String(to))
    if (l === 'en') s = s.replace(new RegExp(`(?<!\\d)${to}(st|nd|rd|th)\\b`, 'g'), `${to}${enOrdinal(to)}`)
    if (l === 'ru') {
      const form = { one: 0, few: 1, many: 2 }[ruPluralClass(to)]
      for (const forms of RU_COUNTED) {
        const word = new RegExp(`(?<!\\d)${to} (${forms.join('|')})(?![а-яё])`, 'gi')
        s = s.replace(word, `${to} ${forms[form]}`)
      }
    }
    out[l] = s
  }
  return out
}

// Форма русского существительного после числа: 1 час / 2 часа / 5 часов.
function ruPluralClass(n: number): 'one' | 'few' | 'many' {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'one'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'few'
  return 'many'
}

interface ObjectiveInfo {
  // Тип условия: "client:hoursBreeding", "cond:custom:experimentladder".
  sig: string
  captionKey: string
  amount: number | null
  category: string
}

function objectiveOf(m: Record<string, any>): ObjectiveInfo {
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
    sig: action ? `client:${action}` : cond?.type ? `cond:${cond.type}:${cond.id ?? ''}` : 'other',
    captionKey: typeof o.caption === 'string' ? o.caption : '',
    amount: amountRaw ? Number(amountRaw) : null,
    category,
  }
}

interface Donor {
  key: string
  amount: number
  text: I18nText
  // Сколько миссий файла ссылаются на этот ключ: самый ходовой текст обычно
  // вычитан лучше редких ("текущего Эксперимент" встречается лишь в паре).
  uses: number
}

// Образцы текста по типу условия - из ВСЕХ миссий файла, не только ивентовых.
// Образец годится, только если на всех 9 языках в нём ровно одно число и оно
// равно amount своей миссии. trusted - в этом типе условия число в тексте
// действительно означает amount (ключей-подтверждений больше, чем ключей с
// другим числом): у killSpecimen, например, числом бывает уровень мутанта, и
// такие тексты перенумеровывать нельзя.
function buildDonors(missions: Record<string, any>[], locs: Locs) {
  const donors = new Map<string, Map<string, Donor>>()
  const agree = new Map<string, Set<string>>()
  const disagree = new Map<string, Set<string>>()
  for (const m of missions) {
    const info = objectiveOf(m)
    const key = info.captionKey.toLowerCase()
    if (!key || !info.amount || info.amount <= 1) continue
    const ru = locs.ru.get(key)
    if (!ru || numbersIn(ru).length !== 1) continue
    const bucket = hasNumber(ru, info.amount) ? agree : disagree
    if (!bucket.has(info.sig)) bucket.set(info.sig, new Set())
    bucket.get(info.sig)!.add(key)

    const text = {} as I18nText
    let ok = true
    for (const l of LOCALES) {
      const v = locs[l].get(key)
      if (!v || numbersIn(v).length !== 1 || !hasNumber(v, info.amount)) {
        ok = false
        break
      }
      text[l] = v
    }
    if (!ok) continue
    if (!donors.has(info.sig)) donors.set(info.sig, new Map())
    const bySig = donors.get(info.sig)!
    const known = bySig.get(key)
    if (known) known.uses++
    else bySig.set(key, { key, amount: info.amount, text, uses: 1 })
  }
  const trusted = (sig: string) => (agree.get(sig)?.size ?? 0) > (disagree.get(sig)?.size ?? 0)
  return { donors, trusted }
}

const keyShape = (k: string) => k.toLowerCase().replace(/\d+/g, '#')

// Выбор образца детерминирован (иначе JSON менялся бы на каждом прогоне):
// 1) та же русская форма после числа, что нужна для amount - "2 часа", а не
//    "2 часов" из образца с пятью часами;
// 2) самый ходовой ключ;
// 3) ключ той же формы, что исходный (caption_hybridize_6h -> _12h);
// 4) по алфавиту.
function fixCondition(
  info: ObjectiveInfo,
  raw: I18nText,
  { donors, trusted }: ReturnType<typeof buildDonors>,
): { text: I18nText; fix: 'missing' | 'renumbered' | null } {
  const amount = info.amount
  if (!amount || amount <= 1 || !trusted(info.sig)) return { text: raw, fix: null }
  const missing = isEmpty(raw)
  if (!missing) {
    const nums = numbersIn(raw.ru)
    if (nums.length !== 1 || nums[0] === String(amount)) return { text: raw, fix: null }
  }
  const shape = keyShape(info.captionKey)
  const plural = ruPluralClass(amount)
  const rank = (d: Donor) => [Number(ruPluralClass(d.amount) !== plural), -d.uses, Number(keyShape(d.key) !== shape)]
  const candidates = [...(donors.get(info.sig)?.values() ?? [])].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a.key.localeCompare(b.key)
  })
  for (const d of candidates) {
    const text = renumber(d.text, String(d.amount), amount)
    if (text) return { text, fix: missing ? 'missing' : 'renumbered' }
  }
  return { text: raw, fix: null }
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


// ИМЕНА ИВЕНТОВ ПО КОНТЕКСТУ ФИЛЬТРА. Официального имени у большинства цепочек
// нет (event_name_* в локализации есть только у тематических лесенок), и юзер
// 2026-09-16 разрешил писать их самим по смыслу фильтра - пример юзера:
// filter_missions_anniversary26_2 -> "Годовщина 2026, часть 2". Шаблоны, а не
// ручной список на 121 запись: новый ивент того же вида (скажем,
// filter_dungeon_halloween26) получит имя сам. Точечные правки - через
// event-quest-names.json, он приоритетнее.
type Words = Record<Locale, string>
const W = {
  event: { ru: 'Ивент', en: 'Event', es: 'Evento', fr: 'Événement', de: 'Event', pt: 'Evento', it: 'Evento', tr: 'Etkinlik', nl: 'Evenement' },
  challenge: { ru: 'Испытание', en: 'Challenge', es: 'Desafío', fr: 'Défi', de: 'Herausforderung', pt: 'Desafio', it: 'Sfida', tr: 'Meydan okuma', nl: 'Uitdaging' },
  anniversary: { ru: 'Годовщина', en: 'Anniversary', es: 'Aniversario', fr: 'Anniversaire', de: 'Jubiläum', pt: 'Aniversário', it: 'Anniversario', tr: 'Yıl dönümü', nl: 'Jubileum' },
  xmas: { ru: 'Рождество', en: 'Christmas', es: 'Navidad', fr: 'Noël', de: 'Weihnachten', pt: 'Natal', it: 'Natale', tr: 'Noel', nl: 'Kerstmis' },
  easter: { ru: 'Пасха', en: 'Easter', es: 'Pascua', fr: 'Pâques', de: 'Ostern', pt: 'Páscoa', it: 'Pasqua', tr: 'Paskalya', nl: 'Pasen' },
  valentines: { ru: 'День святого Валентина', en: "Valentine's Day", es: 'San Valentín', fr: 'Saint-Valentin', de: 'Valentinstag', pt: 'Dia dos Namorados', it: 'San Valentino', tr: 'Sevgililer Günü', nl: 'Valentijnsdag' },
  halloween: { ru: 'Хеллоуин', en: 'Halloween', es: 'Halloween', fr: 'Halloween', de: 'Halloween', pt: 'Halloween', it: 'Halloween', tr: 'Cadılar Bayramı', nl: 'Halloween' },
  weirdtech: { ru: 'Странные технологии', en: 'Weird Tech', es: 'Tecnología extraña', fr: 'Technologie étrange', de: 'Seltsame Technik', pt: 'Tecnologia estranha', it: 'Tecnologia strana', tr: 'Tuhaf teknoloji', nl: 'Vreemde technologie' },
  part: { ru: 'часть', en: 'part', es: 'parte', fr: 'partie', de: 'Teil', pt: 'parte', it: 'parte', tr: 'bölüm', nl: 'deel' },
  day: { ru: 'день', en: 'day', es: 'día', fr: 'jour', de: 'Tag', pt: 'dia', it: 'giorno', tr: 'gün', nl: 'dag' },
  story: { ru: 'сюжет', en: 'story', es: 'historia', fr: 'histoire', de: 'Story', pt: 'história', it: 'storia', tr: 'hikaye', nl: 'verhaal' },
  storyUpdate: { ru: 'Сюжетное обновление', en: 'Story update', es: 'Actualización de la historia', fr: "Mise à jour de l'histoire", de: 'Story-Update', pt: 'Atualização da história', it: 'Aggiornamento della storia', tr: 'Hikaye güncellemesi', nl: 'Verhaalupdate' },
  ended: { ru: 'Завершённые ивенты', en: 'Ended events', es: 'Eventos finalizados', fr: 'Événements terminés', de: 'Beendete Events', pt: 'Eventos encerrados', it: 'Eventi conclusi', tr: 'Sona eren etkinlikler', nl: 'Afgelopen evenementen' },
  feature: { ru: 'Новые функции', en: 'New features', es: 'Nuevas funciones', fr: 'Nouvelles fonctionnalités', de: 'Neue Funktionen', pt: 'Novos recursos', it: 'Nuove funzionalità', tr: 'Yeni özellikler', nl: 'Nieuwe functies' },
  test: { ru: 'Тестовые задания', en: 'Test missions', es: 'Misiones de prueba', fr: 'Missions de test', de: 'Testmissionen', pt: 'Missões de teste', it: 'Missioni di prova', tr: 'Test görevleri', nl: 'Testmissies' },
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

  const theme = (['anniversary', 'valentines', 'halloween', 'weirdtech', 'easter', 'xmas'] as const).find((t) =>
    f.includes(t),
  )
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
  const suffix = f.includes('_story_') || f.startsWith('filter_story_')
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

  // Группируем по фильтру БЕЗ учёта регистра: у Kobojo один и тот же ивент
  // бывает записан в двух регистрах (Missions_Event_Challenge_48 - 1 задание,
  // Missions_Event_challenge_48 - ещё 13), и иначе он разваливался на две
  // карточки с одинаковым именем "Испытание #48".
  const groups = new Map<string, { filter: string; list: Record<string, any>[] }>()
  for (const m of missions) {
    if (tagOf(m, 'missionStyle') !== 'events') continue
    const filter = arr(m.Filter)[0]
    if (!filter || typeof filter !== 'string') continue
    const key = filter.toLowerCase()
    if (!groups.has(key)) groups.set(key, { filter, list: [] })
    groups.get(key)!.list.push(m)
  }

  const chains: EventQuestChain[] = []
  const unnamed: string[] = []
  const donorPool = buildDonors(missions, locs)
  const fixes: Record<'missing' | 'renumbered', string[]> = { missing: [], renumbered: [] }

  for (const { filter, list } of groups.values()) {
    list.sort((a, b) => Number(a.id) - Number(b.id))

    const steps: EventQuestStep[] = list.map((m) => {
      const info = objectiveOf(m)
      const { text: condition, fix } = fixCondition(info, translate(locs, info.captionKey), donorPool)
      if (fix) fixes[fix].push(`${m.id} [${info.sig} ${info.amount}] ${condition.ru}`)
      return {
        id: String(m.id),
        part: tagOf(m, 'part') ?? null,
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
      const yearTail = filter.toLowerCase().slice(filter.toLowerCase().indexOf(theme) + theme.length)
      const yy = yearTail.match(/^_?(\d{4}|\d{2})(?!\d)/)?.[1]
      if (yy) {
        const year = yy.length === 4 ? yy : `20${yy}`
        name = Object.fromEntries(LOCALES.map((l) => [l, `${name[l]} ${year}`])) as I18nText
      }
      // Missions_Halloween_2018_Pt1 / _Pt2 - иначе обе части сливаются в одно имя.
      const pt = yearTail.match(/_pt(\d+)$/)?.[1]
      if (pt) {
        name = Object.fromEntries(LOCALES.map((l) => [l, `${name[l]}, ${W.part[l]} ${pt}`])) as I18nText
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
      requiredLevel: requiredLevelFor(String(list[0].id)),
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
  const [live, ledger, liveOk] = await Promise.all([loadFilterDates(), loadDateLedger(), hasLiveFilterData()])
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
  console.log(`[EVENT-QUESTS] с датой: ${dated}${liveOk ? '' : ' (живых kartel-данных нет - старые даты сохранены)'}`)

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
  console.log(
    `[EVENT-QUESTS] условия: восстановлено пустых ${fixes.missing.length}, исправлено число ${fixes.renumbered.length}`,
  )
  const stillEmpty = chains.flatMap((c) => c.steps.filter((st) => isEmpty(st.condition)).map((st) => st.id))
  if (stillEmpty.length) console.log(`[EVENT-QUESTS] без текста условия: ${stillEmpty.join(', ')}`)
  if (process.env.EVENT_QUESTS_VERBOSE) {
    for (const [kind, list] of Object.entries(fixes)) for (const row of list) console.log(`  ${kind}: ${row}`)
  }
  if (unnamed.length) console.log(`[EVENT-QUESTS] без имени (нужен event-quest-names.json): ${unnamed.join(', ')}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[EVENT-QUESTS] упал:', err)
    process.exit(1)
  })
}
