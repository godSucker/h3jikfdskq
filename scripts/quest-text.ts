import axios from 'axios'
import { numbersIn, hasNumber } from '../src/lib/event-quest-text'

// Тексты заданий из missions.xml и localisation_{lang}.txt: перевод на 9
// языков и починка кривых условий Kobojo. Общий код для ивентовых заданий
// (build-event-quests.ts) и для сюжетных квестов с ачивками (build-quests.ts).

const LOC_URL = (lang: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/localisation_${lang}.txt`

export const LOCALES = ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
export type Locale = (typeof LOCALES)[number]
export type I18nText = Record<Locale, string>

// Категория условия по действию клиента. Каждое сопоставление сверено по
// реальным caption квестов, использующих это действие (сессия редизайна
// квестов), а не угадано по названию.
export const ACTION_CATEGORY: Record<string, string> = {
  killSpecimen: 'battle',
  killBetterTeamThanMeInPve: 'battle',
  killMoreThanOneMutantsWithOneAttack: 'battle',
  sameKillerForAllOpponents: 'battle',
  specimenKilledBeforeAttack: 'battle',
  setDamages: 'battle',
  winFightWithLessThanHundredLife: 'battle',
  loseMutant: 'battle',
  winPve: 'battle',
  winPveLadder: 'battle',
  losePve: 'battle',
  teamFullAfterPveFight: 'battle',
  launchAssist: 'battle',
  finishPvpFight: 'pvp',
  winPvp: 'pvp',
  losePvp: 'pvp',
  winPvpStraight: 'pvp',
  teamFullAfterPvpFight: 'pvp',
  openFight: 'pvp',
  launchCraft: 'craft',
  launchCraftPlus: 'craft',
  openCraft: 'craft',
  launchHybridation: 'breeding',
  hybridationOver: 'breeding',
  duplicateBreed: 'breeding',
  hoursBreeding: 'breeding',
  showbreedingitems: 'breeding',
  hoursIncubating: 'incubation',
  fillMutosterone: 'incubation',
  specimenlevelup: 'incubation',
  accelerate: 'incubation',
  accelerateHabitatLevelOne: 'building',
  collectHabitat: 'building',
  buyExtension: 'building',
  updateTechCenter: 'building',
  placeCreature: 'building',
  refillHpWithHc: 'building',
  sendGift: 'social',
  openMutoDex: 'social',
}
export const CONDITION_CATEGORY: Record<string, string> = {
  level: 'level',
  custom: 'collection',
  ownEntity: 'collection',
}

export function arr<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

export async function loadLocalisations(): Promise<Record<Locale, Map<string, string>>> {
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
        rawLine
          .slice(idx + 1)
          .trim()
          .replace(/\\n/g, '\n')
          .replace(/\/n/g, '\n'),
      )
    }
    out[l] = m
  })
  return out
}

// Переводит ключ локализации на все 9 языков. Нет перевода на языке - берём
// русский (на крайний случай английский), чтобы в карточке не зияла дыра.
export function translate(
  locs: Record<Locale, Map<string, string>>,
  key: string | undefined | null,
): I18nText {
  const k = (key ?? '').toLowerCase()
  const ru = k ? (locs.ru.get(k) ?? '') : ''
  const en = k ? (locs.en.get(k) ?? '') : ''
  const out = {} as I18nText
  for (const l of LOCALES) out[l] = (k && locs[l].get(k)) || ru || en
  return out
}

export function isEmpty(t: I18nText): boolean {
  return !t.ru && !t.en
}

export type Locs = Record<Locale, Map<string, string>>

// ТЕКСТ УСЛОВИЯ. Kobojo ошибается в условиях заданий несколькими способами
// (разбор 2026-09-17):
// 1) ключа caption нет ни в одном из 9 файлов локализации - 25 заданий
//    (caption_reach120_obj1, caption_hybridize_6h, опечатка caption_m0674_obj1
//    вместо caption_m674_obj1). В карточке оставался пустой этап с одним "×120";
// 2) текст скопирован с другого задания вместе со старым числом - 40 заданий
//    ("Создать 50 предметов" при amount=5). Засчитывает игра по amount из XML,
//    поэтому верным считаем его;
// 3) плейсхолдер "X" вместо числа (caption_hybridize_hours);
// 4) вместо условия стоит название задания ("Больше крови!").
// Первые два случая чиним официальным текстом того же типа условия (clientAction или
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

// Плейсхолдер вместо числа: caption_hybridize_hours = "Потратить X часа на
// скрещивание" на всех 9 языках - игра подставляет amount сама.
const PLACEHOLDER = '(?<![\\p{L}\\d])X(?![\\p{L}\\d])'

// Заменяет каждое вхождение числа from (или PLACEHOLDER) на to во всех языках.
// null - если хоть в одном языке его нет (текст переведён иначе, подставлять
// некуда).
// Английский порядковый суффикс пересчитывается ("80th" -> "3rd"); в остальных
// языках он от числа не зависит ("80-е", "80ème", "80.").
export function renumber(text: I18nText, from: string, to: number): I18nText | null {
  const out = {} as I18nText
  for (const l of LOCALES) {
    const re =
      from === PLACEHOLDER
        ? new RegExp(PLACEHOLDER, 'gu')
        : new RegExp(`(?<!\\d)${from}(?!\\d)`, 'g')
    if (!re.test(text[l])) return null
    let s = text[l].replace(re, String(to))
    if (l === 'en')
      s = s.replace(new RegExp(`(?<!\\d)${to}(st|nd|rd|th)\\b`, 'g'), `${to}${enOrdinal(to)}`)
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
export function ruPluralClass(n: number): 'one' | 'few' | 'many' {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'one'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'few'
  return 'many'
}

export interface ObjectiveInfo {
  // Тип условия: "client:hoursBreeding", "cond:custom:experimentladder".
  sig: string
  captionKey: string
  amount: number | null
  category: string
}

// Все объективы миссии в порядке документа. Помимо Client/Condition/Action/Sell
// встречается BuyObjective (архивное "купи 2 пропуска").
export function objectivesOf(m: Record<string, any>): ObjectiveInfo[] {
  const objectives = m.objectives && typeof m.objectives === 'object' ? m.objectives : {}
  return Object.entries(objectives).flatMap(([kind, v]) =>
    arr(v as any)
      .filter((o) => o && typeof o === 'object')
      .map((o: Record<string, any>) => {
        const action = arr(o.clientAction)[0] as string | undefined
        const cond = o.Condition as Record<string, any> | undefined
        // ActionObjective - контракты в медлаборатории (здание), SellObjective -
        // продажа своих образцов (коллекция); разметка из build-quests.ts.
        const category = action
          ? (ACTION_CATEGORY[action] ?? 'misc')
          : cond?.type
            ? (CONDITION_CATEGORY[cond.type] ?? 'misc')
            : kind === 'ActionObjective'
              ? 'building'
              : kind === 'SellObjective'
                ? 'collection'
                : 'misc'
        const amountRaw = (o.amount as string | undefined) ?? (cond?.amount as string | undefined)
        return {
          // Для прочих видов в сигнатуру идёт сам вид и предмет: иначе "купи 2
          // пропуска" (BuyObjective) взял бы образец у "сделай 2 заказа" (ActionObjective).
          sig: action
            ? `client:${action}`
            : cond?.type
              ? `cond:${cond.type}:${cond.id ?? ''}`
              : `${kind}:${arr(o.entity)[0] ?? arr(o.action)[0] ?? ''}`,
          captionKey: typeof o.caption === 'string' ? o.caption : '',
          amount: amountRaw ? Number(amountRaw) : null,
          category,
        }
      }),
  )
}

export function objectiveOf(m: Record<string, any>): ObjectiveInfo {
  return objectivesOf(m)[0] ?? { sig: 'none', captionKey: '', amount: null, category: 'misc' }
}

// Сезонные/ивентовые фильтры: такие миссии - ивентовые задания
// (build-event-quests.ts), а не сюжет. Feature_* сюда НЕ входит: это
// структурные гейты основной сюжетки (Feature_Hospital). Постоянные цепочки
// патчей (Patch_Building_Mystery, Missions_storypatch_*) - сюжет.
export const EVENT_FILTER_RE =
  /^filter_dungeon_|event|anniversary|easter|halloween|valentines|xmas|dailymissions|test_intro/i
export const TEST_FILTER_RE = /(^|_)test_/i

// Фильтры, которые попадают под EVENT_FILTER_RE только из-за слова в имени, а
// ивентом не являются. Missions_Event_Feature - ветка "Новые функции"
// (открытие Зала испытаний, здание Building_Event_1 - отсюда "Event" в
// имени): сервер держит этот фильтр включённым постоянно, без окна дат
// (проверено живым getuser 2026-09-18), то есть это обычная сюжетная ветка.
const NOT_EVENT_FILTER_RE = /^missions_event_feature$/i

export function isEventFilter(filter: string): boolean {
  return EVENT_FILTER_RE.test(filter) && !NOT_EVENT_FILTER_RE.test(filter)
}

export interface Donor {
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
export function buildDonors(missions: Record<string, any>[], locs: Locs) {
  const donors = new Map<string, Map<string, Donor>>()
  const agree = new Map<string, Set<string>>()
  const disagree = new Map<string, Set<string>>()
  // Названия всех миссий (ru) и официальные тексты условий по типу, которые
  // названиями не являются, - для правила "условие = название" в fixCondition.
  const titles = new Set(
    missions
      .map((m) => locs.ru.get(String(m.title ?? '').toLowerCase()))
      .filter((t): t is string => !!t),
  )
  const plainTexts = new Map<string, Map<string, { key: string; text: I18nText; uses: number }>>()
  for (const m of missions) {
    const info = objectiveOf(m)
    const captionKey = info.captionKey.toLowerCase()
    const ruText = captionKey ? locs.ru.get(captionKey) : undefined
    if (ruText && !titles.has(ruText) && LOCALES.every((l) => locs[l].get(captionKey))) {
      if (!plainTexts.has(info.sig)) plainTexts.set(info.sig, new Map())
      const bySig = plainTexts.get(info.sig)!
      const known = bySig.get(captionKey)
      if (known) known.uses++
      else bySig.set(captionKey, { key: captionKey, text: translate(locs, captionKey), uses: 1 })
    }

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
  return { donors, trusted, titles, plainTexts }
}

const keyShape = (k: string) => k.toLowerCase().replace(/\d+/g, '#')

// Выбор образца детерминирован (иначе JSON менялся бы на каждом прогоне):
// 1) та же русская форма после числа, что нужна для amount - "2 часа", а не
//    "2 часов" из образца с пятью часами;
// 2) самый ходовой ключ;
// 3) ключ той же формы, что исходный (caption_hybridize_6h -> _12h);
// 4) по алфавиту.
export function fixCondition(
  info: ObjectiveInfo,
  raw: I18nText,
  pool: ReturnType<typeof buildDonors>,
): { text: I18nText; fix: 'missing' | 'renumbered' | 'placeholder' | 'titleLike' | null } {
  const amount = info.amount
  // Вместо условия стоит название задания: caption_m0197_obj1 = "Больше
  // крови!" (70 заданий, это же название миссии 197). Берём самый ходовой
  // официальный текст того же типа условия, который названием не является
  // ("Нанесите урон!"), при наличии его на всех 9 языках.
  if (raw.ru && pool.titles.has(raw.ru)) {
    const alt = [...(pool.plainTexts.get(info.sig)?.values() ?? [])].sort(
      (a, b) => b.uses - a.uses || a.key.localeCompare(b.key),
    )[0]
    if (alt) return { text: alt.text, fix: 'titleLike' }
  }
  if (amount && !isEmpty(raw)) {
    const filled = renumber(raw, PLACEHOLDER, amount)
    if (filled) return { text: filled, fix: 'placeholder' }
  }
  const { donors, trusted } = pool
  if (!amount || amount <= 1 || !trusted(info.sig)) return { text: raw, fix: null }
  const missing = isEmpty(raw)
  if (!missing) {
    const nums = numbersIn(raw.ru)
    if (nums.length !== 1 || nums[0] === String(amount)) return { text: raw, fix: null }
  }
  const shape = keyShape(info.captionKey)
  const plural = ruPluralClass(amount)
  const rank = (d: Donor) => [
    Number(ruPluralClass(d.amount) !== plural),
    -d.uses,
    Number(keyShape(d.key) !== shape),
  ]
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
