import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'

// Квесты для /guides (таб "Квесты") - строится из missions.xml (s-beta). Первая
// версия (коммит e62603800) держала только id/title/caption/rewards и отбрасывала
// prevMissions/type/objectives - без них нельзя было сгруппировать квесты по
// цепочкам и показать триггер (что именно нужно сделать). Этот скрипт возвращает
// ТОТ ЖЕ набор из 297 id (см. ASSERT ниже - regression guard) и добавляет:
// chainType (achievement/story), prevId (связь в цепочке), trigger (категория +
// порог). title/caption генерируются СТРОГО как раньше - они уже переведены на
// 9 языков через content-i18n.json (см. память guides-json-batch-2026-08-15),
// менять эту логику нельзя, иначе перевод осиротеет.

const MISSIONS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/missions.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const ACHIEVEMENTS_ASSET_BASE = 'https://s-beta.kobojo.com/mutants/assets/achievements/'
// Живой Frida-захват (2026-08-25) поймал реальные quest_*-иконки, загружаемые
// клиентом с ДРУГОГО хоста (s-ak, не s-beta) БЕЗ хэша - путь, который раньше
// не пробовали. Проверено все 97 нужных имён - 97/97 отдают 200.
const STORY_ICON_ASSET_BASE = 'https://s-ak.kobojo.com/mutants/assets/mobile/icon-quest/'

const OUT_PATH = path.join(process.cwd(), 'src/data/guides/quests.json')
const ACHIEVEMENT_ICON_DIR = path.join(process.cwd(), 'public/quests/achievements')
const STORY_ICON_DIR = path.join(process.cwd(), 'public/quests/story')

// Сезонные/ивентовые Filter-значения - квесты с ними исключены из гайда (то же,
// что делал оригинальный скрипт "Filter tag keyword match"). НЕ включает
// Feature_* (структурные фичи-гейты вроде Feature_Hospital - это часть основной
// сюжетки, не ивент).
const EVENT_FILTER_RE =
  /^filter_dungeon_|event|anniversary|easter|halloween|valentines|xmas|dailymissions|test_intro/i

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

// Каждое сопоставление проверено по РЕАЛЬНЫМ caption квестов, использующих
// это действие (не угадано по названию) - см. сессию редизайна квестов.
const ACTION_CATEGORY: Record<string, TriggerCategory> = {
  killSpecimen: 'battle',
  killBetterTeamThanMeInPve: 'battle',
  killMoreThanOneMutantsWithOneAttack: 'battle',
  sameKillerForAllOpponents: 'battle',
  specimenKilledBeforeAttack: 'battle',
  setDamages: 'battle',
  winFightWithLessThanHundredLife: 'battle',
  loseMutant: 'battle',
  winPve: 'battle',
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

const CONDITION_CATEGORY: Record<string, TriggerCategory> = {
  level: 'level',
  custom: 'collection',
  ownEntity: 'collection',
}

interface RewardRaw {
  type: string | null
  id: string | null
  amount: string | null
}

interface QuestOut {
  id: string
  title: string
  caption: string
  rewards: RewardRaw[]
  chainType: 'story' | 'achievement'
  prevId: string | null
  trigger: { category: TriggerCategory; amount: string | null }
  icon: string | null
}

function arr<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}

async function main() {
  const [{ data: xml }, { data: locRaw }] = await Promise.all([
    axios.get<string>(MISSIONS_URL, { responseType: 'text' }),
    axios.get<string>(LOC_RU_URL, { responseType: 'text' }),
  ])

  const loc = new Map<string, string>()
  for (const rawLine of locRaw.split(/\r?\n/)) {
    const i = rawLine.indexOf(';')
    if (i === -1) continue
    const key = rawLine.slice(0, i).trim()
    const value = rawLine
      .slice(i + 1)
      .trim()
      .replace(/\\n/g, '\n')
      .replace(/\/n/g, '\n')
      .replace(/\s*\/(?=[А-ЯЁ])/g, '\n')
    loc.set(key, value)
  }
  const lookup = (key: string | undefined | null): string => (key ? (loc.get(key) ?? '') : '')

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  })
  const parsed = parser.parse(xml)
  const missions: Record<string, unknown>[] = arr(parsed?.Missions?.missions?.Mission)
  console.log(`[QUESTS] Missions.xml: ${missions.length} миссий всего`)

  // prevMissions ВСЕХ 5438 миссий (не только прошедших фильтр) - нужно, чтобы
  // "перепрыгнуть" через отфильтрованные миссии (event/test/сезонные - их 21
  // из 297 связей) и найти БЛИЖАЙШЕГО видимого предка, а не разрывать цепочку
  // молча. Без этого прошедшая фильтр миссия видит несуществующего в
  // итоговом наборе родителя и превращается в ложный корень новой цепочки -
  // ровно так 51 реальная цепочка ломалась на 66 фрагментов при первой версии.
  const prevMissionsById = new Map<string, string | null>()
  for (const m of missions) {
    const id = m.id as string | undefined
    if (!id) continue
    const prevRaw = m.prevMissions as string | undefined
    prevMissionsById.set(id, prevRaw ? prevRaw.split(',')[0].trim() || null : null)
  }

  function normalizeReward(r: Record<string, unknown>): RewardRaw {
    const type = (r.type as string) ?? null
    const id = (r.id as string) ?? null
    const amount = (r.amount as string) ?? null
    return { type: type ?? (id ? 'entity' : null), id, amount }
  }

  // 4 варианта тега objective встречаются в данных: ClientObjective (действие в
  // клиенте, clientAction), ConditionObjective (декларативное условие Condition
  // type/amount/id), ActionObjective (взаимодействие со зданием - entity+action,
  // все 6 наблюдений - контракты в госпитале), SellObjective (продажа образцов,
  // entity=Specimen_*). Собираем ВСЕ 4 в порядке встречи в документе - смешения
  // разных тегов внутри одной миссии не встречено ни разу в данных.
  function allObjectives(
    objectives: Record<string, unknown> | undefined,
  ): Record<string, unknown>[] {
    if (!objectives) return []
    return [
      ...arr(objectives.ClientObjective as any),
      ...arr(objectives.ConditionObjective as any),
      ...arr(objectives.ActionObjective as any),
      ...arr(objectives.SellObjective as any),
    ] as Record<string, unknown>[]
  }

  function objectiveTrigger(o: Record<string, unknown>): {
    category: TriggerCategory
    amount: string | null
  } {
    // ClientObjective иногда несёт НЕСКОЛЬКО <clientAction> (напр. launchCraft +
    // launchCraftPlus, winPve + winPveLadder - основное действие + вариант) -
    // fast-xml-parser даёт массив вместо строки в этом случае. Категория берётся
    // по первому - у наблюдаемых пар оба варианта всё равно одной категории.
    const clientActionRaw = o.clientAction as string | string[] | undefined
    const clientAction = Array.isArray(clientActionRaw) ? clientActionRaw[0] : clientActionRaw
    if (clientAction)
      return {
        category: ACTION_CATEGORY[clientAction] ?? 'misc',
        amount: (o.amount as string) ?? null,
      }
    const cond = o.Condition as Record<string, unknown> | undefined
    if (cond) {
      const type = cond.type as string | undefined
      return {
        category: (type && CONDITION_CATEGORY[type]) || 'misc',
        amount: (cond.amount as string) ?? null,
      }
    }
    // ActionObjective (entity+action, все наблюдения - контракты в госпитале) -
    // building. SellObjective (entity=Specimen_*, продажа мутантов) - collection,
    // это тоже управление своими образцами, просто в другую сторону.
    if (o.action) return { category: 'building', amount: (o.amount as string) ?? null }
    if (o.entity) return { category: 'collection', amount: (o.amount as string) ?? null }
    return { category: 'misc', amount: (o.amount as string) ?? null }
  }

  // Достижения (chainType==='achievement') резолвят caption через caption на
  // САМОЙ Mission (caption_achieve_XXXXa) - у objective-уровня caption для них
  // ключа в локализации нет вообще (проверено на живых данных). Сюжетные
  // квесты - наоборот, caption собирается из caption КАЖДОГО objective
  // (caption_m{id}_obj{n}), склеенных "; " в порядке документа - у Mission-
  // уровня caption там указывает на нерелевантный флейвор-текст диалога.
  function buildCaption(
    isAchievement: boolean,
    missionCaptionKey: string | undefined,
    objectives: Record<string, unknown> | undefined,
  ): string {
    if (isAchievement) return lookup(missionCaptionKey)
    return allObjectives(objectives)
      .map((o) => lookup(o.caption as string | undefined))
      .filter(Boolean)
      .join('; ')
  }

  const quests: QuestOut[] = []
  for (const m of missions) {
    const id = m.id as string | undefined
    const titleKey = m.title as string | undefined
    if (!id || !titleKey) continue

    const title = lookup(titleKey)
    if (!title) continue

    const rewardsRaw = arr(m.reward as any).map((r) =>
      normalizeReward(r as Record<string, unknown>),
    )
    if (rewardsRaw.length === 0) continue

    const filterVal = arr(m.Filter as any).join(' ')
    if (EVENT_FILTER_RE.test(filterVal)) continue

    const chainType: 'story' | 'achievement' = m.type === 'Achievement' ? 'achievement' : 'story'
    const objs = allObjectives(m.objectives as Record<string, unknown> | undefined)
    const caption = buildCaption(
      chainType === 'achievement',
      m.caption as string | undefined,
      m.objectives as any,
    )
    const trigger =
      objs.length > 0
        ? objectiveTrigger(objs[0])
        : { category: 'misc' as TriggerCategory, amount: null }

    // Сырое имя иконки миссии - для achievement это реально скачиваемый PNG
    // (assets/achievements/<name>.png на CDN, качается ниже). Для story это
    // ТОЛЬКО данные - файла для большинства нет ни на CDN, ни в статике игры
    // (они докачиваются в рантайме по хэшу, известному только живому клиенту -
    // см. сессию редизайна квестов). Небольшая часть (10 из 97 имён) всё же
    // нашлась в preload-ассетах APK и вручную добавлена в public/quests/story/ -
    // какие именно доступны, решает STORY_ICON_ALLOWLIST во фронтенде
    // (QuestsTab.svelte), не этот скрипт.
    const icon = (m.icon as string) ?? null

    // prevId временный (сырое prevMissions) - "перепрыгивается" через
    // отфильтрованных предков ниже, когда известен финальный набор id.
    quests.push({
      id,
      title,
      caption,
      rewards: rewardsRaw,
      chainType,
      prevId: prevMissionsById.get(id) ?? null,
      icon,
      trigger,
    })
  }

  console.log(`[QUESTS] Прошли фильтр (title+reward, не event): ${quests.length}`)

  const includedIds = new Set(quests.map((q) => q.id))
  function resolveVisibleAncestor(startId: string): string | null {
    let cur = prevMissionsById.get(startId) ?? null
    const seen = new Set<string>() // защита от случайного цикла в данных
    while (cur && !includedIds.has(cur)) {
      if (seen.has(cur)) return null
      seen.add(cur)
      cur = prevMissionsById.get(cur) ?? null
    }
    return cur
  }
  for (const q of quests) q.prevId = resolveVisibleAncestor(q.id)

  // Regression guard: сверяем набор id с текущим quests.json (если файл уже
  // существует с прошлой версией схемы) - scope квестов должен остаться ТЕМ ЖЕ,
  // меняется только состав полей.
  try {
    const prevRaw = await fs.readFile(OUT_PATH, 'utf-8')
    const prev = JSON.parse(prevRaw) as { id: string }[]
    const prevIds = new Set(prev.map((q) => q.id))
    const newIds = new Set(quests.map((q) => q.id))
    const missing = [...prevIds].filter((id) => !newIds.has(id))
    const added = [...newIds].filter((id) => !prevIds.has(id))
    if (missing.length || added.length) {
      console.log(`[QUESTS] ⚠ РАСХОЖДЕНИЕ с прошлым набором id!`)
      console.log(`  Пропали (${missing.length}):`, missing.slice(0, 30))
      console.log(`  Новые (${added.length}):`, added.slice(0, 30))
    } else {
      console.log(`[QUESTS] ✓ Набор id идентичен прошлой версии (${prevIds.size})`)
    }
  } catch {
    console.log('[QUESTS] Прошлый quests.json не найден или не JSON - пропускаю regression guard')
  }

  // Скачиваем иконки ачивок (реальные игровые PNG, лежат на CDN как есть).
  // ТОЛЬКО achievement - story-иконок на этом CDN-пути нет (см. комментарий
  // у поля icon выше), качать их отсюда бессмысленно (97 гарантированных 404
  // на каждый прогон).
  async function downloadIcons(names: string[], dir: string, baseUrl: string, label: string) {
    await fs.mkdir(dir, { recursive: true })
    let downloaded = 0
    let failed = 0
    for (const name of names) {
      const dest = path.join(dir, `${name}.png`)
      try {
        await fs.access(dest)
        continue
      } catch {
        // не скачано - продолжаем
      }
      try {
        const res = await axios.get<ArrayBuffer>(`${baseUrl}${name}.png`, {
          responseType: 'arraybuffer',
          timeout: 15000,
        })
        await fs.writeFile(dest, Buffer.from(res.data))
        downloaded++
      } catch {
        failed++
        console.log(`[QUESTS] ✗ не удалось скачать иконку ${label} ${name}`)
      }
    }
    console.log(
      `[QUESTS] Иконок ${label}: ${names.length} уникальных, докачано ${downloaded}, ошибок ${failed}`,
    )
  }

  const achievementIconNames = [
    ...new Set(
      quests
        .filter((q) => q.chainType === 'achievement')
        .map((q) => q.icon)
        .filter((x): x is string => !!x),
    ),
  ]
  await downloadIcons(achievementIconNames, ACHIEVEMENT_ICON_DIR, ACHIEVEMENTS_ASSET_BASE, 'ачивок')

  // s-ak/assets/mobile/icon-quest/ - найдено живым Frida-захватом 2026-08-25
  // (см. комментарий у STORY_ICON_ASSET_BASE), 97/97 нужных имён отдают 200.
  const storyIconNames = [
    ...new Set(
      quests
        .filter((q) => q.chainType === 'story')
        .map((q) => q.icon)
        .filter((x): x is string => !!x),
    ),
  ]
  await downloadIcons(storyIconNames, STORY_ICON_DIR, STORY_ICON_ASSET_BASE, 'квестов')

  await fs.writeFile(OUT_PATH, JSON.stringify(quests, null, 2) + '\n', 'utf-8')

  const byChain: Record<string, number> = {}
  for (const q of quests) byChain[q.chainType] = (byChain[q.chainType] ?? 0) + 1
  console.log(`[QUESTS] Итого: ${quests.length} (${JSON.stringify(byChain)})`)
}

main().catch((err) => {
  console.error('[BUILD-QUESTS] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
