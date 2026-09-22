import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { runMain } from './lib/run-main'
import { XMLParser } from 'fast-xml-parser'
import {
  isEventFilter,
  LOCALES,
  TEST_FILTER_RE,
  arr,
  buildDonors,
  fixCondition,
  isEmpty,
  loadLocalisations,
  objectivesOf,
  translate,
  type I18nText,
} from './quest-text'

// Сюжетные квесты и достижения для /guides (таб "Квесты") из missions.xml.
// Ивентовые задания собирает build-event-quests.ts; тексты и починка условий у
// обоих общие (quest-text.ts).
//
// С 2026-09-17 тексты берутся на всех 9 языках прямо из localisation_{lang}.txt
// Kobojo. Раньше в файл шёл только русский, а остальные языки подбирались на
// сайте по русской строке через content-i18n.json - любая новая цепочка
// (Анализатор тайны) и любая починка текста условия оставались без перевода.
//
// Что лежит в квесте:
// - chainType (achievement/story) и prevId - ближайший видимый предок в
//   цепочке (через отфильтрованные миссии, см. resolveVisibleAncestor);
// - trigger - категория и порог первого объектива;
// - requiredLevel - уровень, с которого квест открывается: <Condition
//   type="level"> на самой миссии или на ближайшем предке по prevMissions;
// - unlock - прочие условия открытия с самой миссии: нужный мутант (секретные
//   рецепты), уровень Техцентра, здание. "Пройти обучение" (tutoOver/ftuOver)
//   не показываем - его проходит каждый.

const MISSIONS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/missions.xml'
// Иконки берём прямо с CDN Kobojo, как у ивентовых заданий: новой цепочке не
// нужно ждать ручной заливки файла на наш CDN.
const STORY_ICON_BASE = 'https://s-ak.kobojo.com/mutants/assets/mobile/icon-quest/'
const ACHIEVEMENT_ICON_BASE = 'https://s-ak.kobojo.com/mutants/assets/achievements/'

const OUT_PATH = path.join(process.cwd(), 'src/data/guides/quests.json')

type TriggerCategory =
  | 'battle'
  | 'pvp'
  | 'craft'
  | 'breeding'
  | 'incubation'
  | 'building'
  | 'level'
  | 'collection'
  | 'social'
  | 'misc'

interface RewardRaw {
  type: string | null
  id: string | null
  amount: string | null
}

type Unlock =
  | { type: 'specimen'; id: string }
  // techCenterLevel - это Эволюционный центр (Building_Tech), имя - официальное.
  | { type: 'techCenter'; level: number; name: I18nText }
  | { type: 'building'; id: string }
  // Цепочка - отдельный пакет заданий, который открывается после квеста другой
  // цепочки (см. разрыв связей в resolveVisibleAncestor).
  | { type: 'afterQuest'; id: string; title: I18nText }

interface QuestOut {
  id: string
  title: I18nText
  caption: I18nText
  rewards: RewardRaw[]
  chainType: 'story' | 'achievement'
  prevId: string | null
  trigger: { category: TriggerCategory; amount: string | null }
  requiredLevel: number | null
  unlock: Unlock[]
  icon: string | null
}

// Старый разбор разрывов строк в русской локализации: "/" перед заглавной
// буквой у Kobojo означает перенос.
const ruBreaks = (t: I18nText): I18nText => ({ ...t, ru: t.ru.replace(/\s*\/(?=[А-ЯЁ])/g, '\n') })

async function main() {
  const [{ data: xml }, locs] = await Promise.all([
    axios.get<string>(MISSIONS_URL, { responseType: 'text', timeout: 60000 }),
    loadLocalisations(),
  ])
  if (locs.ru.size < 10000 || locs.en.size < 10000) {
    throw new Error(`локализация неполная (ru ${locs.ru.size}, en ${locs.en.size} ключей)`)
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  })
  const missions: Record<string, any>[] = arr(parser.parse(xml)?.Missions?.missions?.Mission)
  console.log(`[QUESTS] missions.xml: ${missions.length} миссий`)
  const byId = new Map(missions.map((m) => [String(m.id), m]))

  // prevMissions ВСЕХ миссий (не только прошедших фильтр) - нужно, чтобы
  // "перепрыгнуть" через отфильтрованные миссии и найти ближайшего видимого
  // предка, а не разрывать цепочку молча (так 51 цепочка когда-то ломалась на
  // 66 фрагментов).
  const prevOf = (id: string): string | null => {
    const raw = byId.get(id)?.prevMissions as string | undefined
    return raw ? raw.split(',')[0].trim() || null : null
  }

  function requiredLevelFor(id: string): number | null {
    let cur: string | null = id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const level = arr(byId.get(cur)?.Condition).find((c: any) => c?.type === 'level')
      // amount="-1" у стартовых квестов = без ограничения, как и 1-й уровень.
      if (level?.amount) return Number(level.amount) > 1 ? Number(level.amount) : null
      cur = prevOf(cur)
    }
    return null
  }

  function unlockOf(m: Record<string, any>): Unlock[] {
    const out: Unlock[] = []
    for (const c of arr(m.Condition) as Record<string, any>[]) {
      if (c?.type === 'custom' && typeof c.id === 'string' && /^Specimen_/.test(c.id)) {
        out.push({ type: 'specimen', id: c.id })
      } else if (c?.type === 'custom' && c.id === 'techCenterLevel' && c.amount) {
        out.push({
          type: 'techCenter',
          level: Number(c.amount),
          name: translate(locs, 'Building_Tech'),
        })
      } else if (c?.type === 'ownEntity' && typeof c.id === 'string' && !c.id.includes('*')) {
        // "Habitat_*" - любые 4 среды обитания, они есть у каждого к этому моменту.
        out.push({ type: 'building', id: c.id })
      }
    }
    return out
  }

  const donorPool = buildDonors(missions, locs)
  const fixes: Record<string, number> = {}

  const quests: QuestOut[] = []
  for (const m of missions) {
    const id = m.id as string | undefined
    const titleKey = m.title as string | undefined
    if (!id || !titleKey || !locs.ru.get(titleKey.toLowerCase())) continue

    const rewards = arr(m.reward).map((r: any) => {
      const rid = (r?.id as string) ?? null
      return {
        type: (r?.type as string) ?? (rid ? 'entity' : null),
        id: rid,
        amount: (r?.amount as string) ?? null,
      }
    })
    if (rewards.length === 0) continue

    const filterVal = arr(m.Filter).join(' ')
    if (isEventFilter(filterVal) || TEST_FILTER_RE.test(filterVal)) continue

    const chainType: 'story' | 'achievement' = m.type === 'Achievement' ? 'achievement' : 'story'
    const objectives = objectivesOf(m)

    // Достижения берут текст с САМОЙ миссии (caption_achieve_XXXXa): у их
    // объективов ключей в локализации нет. Сюжет - наоборот, текст каждого
    // объектива, склеенный "; ": caption миссии там - флейвор-реплика диалога.
    let caption: I18nText
    if (chainType === 'achievement') {
      caption = translate(locs, m.caption)
    } else {
      const parts = objectives
        .map((info) => {
          const fixed = fixCondition(info, translate(locs, info.captionKey), donorPool)
          if (fixed.fix) fixes[fixed.fix] = (fixes[fixed.fix] ?? 0) + 1
          return fixed.text
        })
        .filter((t) => !isEmpty(t))
      caption = Object.fromEntries(
        LOCALES.map((l) => [
          l,
          parts
            .map((t) => t[l])
            .filter(Boolean)
            .join('; '),
        ]),
      ) as I18nText
    }

    const first = objectives[0]
    quests.push({
      id,
      title: ruBreaks(translate(locs, titleKey)),
      caption: ruBreaks(caption),
      rewards,
      chainType,
      prevId: prevOf(id),
      trigger: {
        category: (first?.category as TriggerCategory) ?? 'misc',
        amount: first?.amount != null ? String(first.amount) : null,
      },
      requiredLevel: requiredLevelFor(id),
      unlock: unlockOf(m),
      icon: m.icon
        ? `${chainType === 'achievement' ? ACHIEVEMENT_ICON_BASE : STORY_ICON_BASE}${m.icon}.png`
        : null,
    })
  }
  console.log(
    `[QUESTS] прошли фильтр: ${quests.length}, починено условий: ${JSON.stringify(fixes)}`,
  )

  const includedIds = new Set(quests.map((q) => q.id))
  function resolveVisibleAncestor(startId: string): string | null {
    let cur = prevOf(startId)
    const seen = new Set<string>() // защита от цикла в данных
    while (cur && !includedIds.has(cur)) {
      if (seen.has(cur)) return null
      seen.add(cur)
      cur = prevOf(cur)
    }
    return cur
  }
  // Отдельный пакет заданий (Patch_Building_Mystery, Missions_Craft_Blackhole)
  // Kobojo открывает после квеста ДРУГОЙ цепочки. Связь по prevMissions
  // прицепляла его хвостом к чужому дереву - Анализатор тайны терялся внутри
  // крафтовой ветки. Такой пакет - своя цепочка с условием "после квеста X".
  // Feature_* не отрываем: это гейты основной сюжетки (Feature_Hospital).
  const filterOf = (id: string) => arr(byId.get(id)?.Filter).join(',')
  const byQuestId = new Map(quests.map((q) => [q.id, q]))
  for (const q of quests) {
    const parent = resolveVisibleAncestor(q.id)
    const own = filterOf(q.id)
    if (parent && own && !/^Feature_/i.test(own) && own !== filterOf(parent)) {
      q.prevId = null
      q.unlock.push({ type: 'afterQuest', id: parent, title: byQuestId.get(parent)!.title })
    } else {
      q.prevId = parent
    }
  }

  // Сверка с прошлым файлом: новые и пропавшие id - в лог, а резкая потеря
  // (обрезанный missions.xml) - отказ перезаписывать файл.
  try {
    const prev = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8')) as { id: string }[]
    const prevIds = new Set(prev.map((q) => q.id))
    const added = [...includedIds].filter((x) => !prevIds.has(x))
    const missing = [...prevIds].filter((x) => !includedIds.has(x))
    console.log(
      `[QUESTS] было ${prevIds.size}, стало ${includedIds.size}; новые: ${added.join(', ') || '-'}; пропали: ${missing.join(', ') || '-'}`,
    )
    if (quests.length < prevIds.size * 0.8) {
      throw new Error(
        `квестов стало подозрительно мало (${quests.length} против ${prevIds.size}) - файл не перезаписан`,
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('не перезаписан')) throw err
    console.log('[QUESTS] прошлого quests.json нет - сверку пропускаю')
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(quests, null, 2) + '\n', 'utf-8')
  const byChain: Record<string, number> = {}
  for (const q of quests) byChain[q.chainType] = (byChain[q.chainType] ?? 0) + 1
  const leveled = quests.filter(
    (q) => q.chainType === 'story' && !q.prevId && q.requiredLevel,
  ).length
  console.log(
    `[QUESTS] итого ${quests.length} (${JSON.stringify(byChain)}), корней сюжета с уровнем: ${leveled}`,
  )
}

runMain(import.meta.url, 'BUILD-QUESTS', main)
