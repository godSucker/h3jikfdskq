import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'
import sharp from 'sharp'
import { calculateFinalStats as calcFinalStatsUnified } from '../src/lib/stats/unified-calculator'

// ==================== КОНФИГУРАЦИЯ ====================

const CONFIG = {
  LOC_RU_URL: 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt',
  GAME_DEFS_URL: 'https://s-beta.kobojo.com/mutants/gameconfig/gamedefinitions.xml',
  GACHA_URL: 'https://s-beta.kobojo.com/mutants/gameconfig/gacha.xml',
  KOBOJO_IMG_BASE: 'https://s-beta.kobojo.com/mutants/assets/thumbnails/',

  DATA_DIR: path.join(process.cwd(), 'src/data/mutants'),
  TEXTURES_DIR: path.join(process.cwd(), 'public/textures_by_mutant'),
  TEMP_DIR: path.join(process.cwd(), 'temp'),
  // Не под scripts/.cache/ (тот в .gitignore целиком) — этот файл должен
  // коммититься и переживать прогоны CI, иначе негативный кэш бесполезен.
  MISSING_TEXTURE_CACHE_PATH: path.join(process.cwd(), 'scripts/missing-textures-cache.json'),
  // Раз в столько дней повторно пробуем скачать текстуру, отмеченную отсутствующей
  // (вдруг Kobojo всё-таки добавили арт) — не бесконечно доверяем негативному кэшу.
  MISSING_TEXTURE_RECHECK_DAYS: 14,

  RATINGS: ['normal', 'bronze', 'silver', 'gold', 'platinum'] as const,
  MULTIPLIERS: {
    normal: 1.0,
    bronze: 1.1,
    silver: 1.3,
    gold: 1.75,
    platinum: 2.0,
  } as Record<string, number>,
}

type Rating = (typeof CONFIG.RATINGS)[number]

// ==================== ТИПЫ ====================

interface BaseStatsCalc {
  hp_base: number
  atk1_base: number
  atk1p_base: number
  atk2_base: number
  atk2p_base: number
  speed_base: number
  bank_base: number
  abilityPct1: number
  abilityPct2: number
}

interface StatsResult {
  hp: number
  atk1: number
  atk2: number
  ability: number
  speed: number
  silver: number
}

interface StarInfo {
  images: string[]
  multiplier?: number
}

interface UnifiedMutant {
  id: string
  name: string
  genes: string[]
  base_stats: any
  abilities: any[]
  stars: Record<string, StarInfo>
  type: string
  incub_time: number
  orbs: { normal: number; special: number }
  bingo: string[]
  chance: number
  bank: number
  tier: string
  name_attack1: string
  name_attack2: string
  name_attack3: string
  name_lore: string
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function roundSpeed(speed: number): number {
  return Math.round(speed * 100) / 100
}

// Слабые стартовые варианты (Specimen_A_02/B_02/C_02 = Слабый Робот/Зомби/Воин)
// никогда не парсятся и не пишутся в mutants.json. ID-сет — основной бэкстоп;
// проверка по локализации ("слабый"/"weak") дополнительно ловит другие такие же
// варианты по имени, если игра когда-нибудь добавит ещё — но НЕ заменяет ID-сет,
// так как локализация может отсутствовать/быть пустой для конкретного id.
const WEAK_MUTANT_IDS = new Set(['SPECIMEN_A_02', 'SPECIMEN_B_02', 'SPECIMEN_C_02'])

function isWeakMutant(descriptorId: string, locMap: Map<string, string>): boolean {
  if (WEAK_MUTANT_IDS.has(descriptorId.toUpperCase())) return true
  const locName = (locMap.get(descriptorId.toLowerCase()) || '').toLowerCase()
  return locName.includes('слабый') || locName.includes('weak')
}

// Негативный кэш "текстуры точно нет на Kobojo" — ключ specimen_id_rating,
// значение — ISO-таймстамп последней подтверждённой проверки. Без него парсер
// каждый день заново дожидается 15с таймаута axios на КАЖДУЮ комбинацию
// мутант+рейтинг, которых физически нет на CDN (и таких сотни).
let missingTextureCache: Record<string, string> | null = null
let missingTextureCacheDirty = false

async function loadMissingTextureCache(): Promise<Record<string, string>> {
  if (missingTextureCache) return missingTextureCache
  try {
    missingTextureCache = JSON.parse(await fs.readFile(CONFIG.MISSING_TEXTURE_CACHE_PATH, 'utf-8'))
  } catch {
    missingTextureCache = {}
  }
  return missingTextureCache!
}

async function saveMissingTextureCache(): Promise<void> {
  if (!missingTextureCache || !missingTextureCacheDirty) return
  await fs.writeFile(
    CONFIG.MISSING_TEXTURE_CACHE_PATH,
    JSON.stringify(missingTextureCache, null, 2) + '\n',
  )
}

// Гарантирует, что файл существует на диске ещё до того, как парсер что-либо
// найдёт. Иначе на прогоне без единой пропущенной текстуры (dirty так и не
// станет true) file_pattern в sync-cron.yml, ссылающийся на этот путь, падает
// с "pathspec did not match any files" и валит весь commit-шаг git-auto-commit-action.
async function ensureMissingTextureCacheFile(): Promise<void> {
  try {
    await fs.access(CONFIG.MISSING_TEXTURE_CACHE_PATH)
  } catch {
    await fs.writeFile(CONFIG.MISSING_TEXTURE_CACHE_PATH, '{}\n')
  }
}

function isMissingTextureCacheFresh(isoTimestamp: string): boolean {
  const ageMs = Date.now() - new Date(isoTimestamp).getTime()
  return ageMs < CONFIG.MISSING_TEXTURE_RECHECK_DAYS * 24 * 60 * 60 * 1000
}

async function downloadFile(url: string, targetPath: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.status === 200) {
      await fs.writeFile(targetPath, res.data)
      return true
    }
  } catch {
    return false
  }
  return false
}

async function loadLocalFiles() {
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true })
  const xmlPath = path.join(CONFIG.TEMP_DIR, 'gamedefinitions.xml')
  const txtPath = path.join(CONFIG.TEMP_DIR, 'localisation_ru.txt')

  console.log('[SETUP] Загрузка данных из CDN...')
  await downloadFile(CONFIG.GAME_DEFS_URL, xmlPath)
  await downloadFile(CONFIG.LOC_RU_URL, txtPath)

  const xmlContent = await fs.readFile(xmlPath, 'utf-8')
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    trimValues: true,
  })
  const gameDefs = parser.parse(xmlContent)

  const txtContent = await fs.readFile(txtPath, 'utf-8')
  const locMap = new Map<string, string>()
  txtContent.split(/\r?\n/).forEach((line) => {
    const parts = line.split(';')
    if (parts.length >= 2) {
      locMap.set(parts[0].trim().toLowerCase(), parts.slice(1).join(';').trim())
    }
  })

  return { gameDefs, locMap }
}

// GACHA-мутанты (Reactor) - их "коробочные" статы в gamedefinitions.xml (atk1/
// atk2/lifePoint) не всегда равны тому, что реально показывает игра. Нашли
// 2026-08-08 (запрос юзера "проеб по статам у GACHA"): у части GACHA-мутантов
// в gacha.xml на КАЖДОЙ их <GachaSpecimen specimen="Specimen_XX_NN".../> записи
// (across all <Gacha id="..."> реактор-пулов, куда они когда-либо попадали)
// стоит одинаковый bonus != 0 - это не опциональный косметический скин, это
// часть постоянной "паспортной" силы мутанта. Формула (та же, что уже
// verified Ghidra+Frida для скинов, см. scripts/build-skins.ts и память
// skins-generation-pipeline): hp = hp_base*(LF-bonus)/100, atk = atk_base*
// (bonus+100)*LF/10000, где LF = множитель звезды *100 (175 gold/200 platinum).
// Чтобы не трогать calculateFinalStats() и всех его потребителей (модалка,
// калькулятор, скриншоты, топ-мутантов, тир-лист), поправку вносим ЗДЕСЬ -
// в сами hp_base/atk1_base/atk2_base/atk1p_base/atk2p_base перед записью в
// mutants.json, оставляя множитель звезды (gachaMult) и формулу расчёта по
// уровням нетронутыми. Проверено на Зевсе (specimen_ec_06, bonus=10,
// LF=175): даёт hp=1551, atk=906 - точное совпадение с конкурентом.
type GachaBonusEntry = { stars: number; bonus: number }
function parseGachaBonusMap(xml: string): Map<string, GachaBonusEntry> {
  const map = new Map<string, GachaBonusEntry>()
  const specRe = /<GachaSpecimen[^>]*specimen="Specimen_([^"]+)"[^>]*\/>/gi
  let m: RegExpExecArray | null
  while ((m = specRe.exec(xml))) {
    const code = m[1].toLowerCase()
    const tag = m[0]
    const stars = Number(tag.match(/stars="([^"]*)"/)?.[1] ?? 0)
    const bonus = Number(tag.match(/bonus="([^"]*)"/)?.[1] ?? 0)
    // Один и тот же specimen встречается в нескольких реактор-пулах с
    // одинаковым bonus/stars (перепроверено на Белом Ханзо - 42 вхождения,
    // все bonus=10) - берём первое, остальные для проверки не нужны.
    if (!map.has(code)) map.set(code, { stars, bonus })
  }
  return map
}

async function loadGachaBonusMap(): Promise<Map<string, GachaBonusEntry>> {
  try {
    const res = await axios.get<string>(CONFIG.GACHA_URL, { responseType: 'text', timeout: 30000 })
    const map = parseGachaBonusMap(String(res.data))
    console.log(`[GACHA-BONUS] Загружено ${map.size} записей из gacha.xml`)
    return map
  } catch (err) {
    console.warn(
      `[GACHA-BONUS] Не удалось загрузить gacha.xml (${err instanceof Error ? err.message : err}) - GACHA-мутанты посчитаются без поправки bonus`,
    )
    return new Map()
  }
}

/**
 * Скачивает specimen текстуру с Kobojo CDN если её нет на диске.
 * Возвращает true если текстура доступна (была или скачана).
 */
// ВАЖНО: имя файла всегда с суффиксом рейтинга (в т.ч. _normal) — именно такой
// путь пишет buildImagePaths() в mutants.json и проверяет режим stats.
// Раньше normal сохранялся без суффикса (specimen_x.webp), из-за чего у новых
// мутантов JSON ссылался на несуществующий specimen_x_normal.webp. Единственное
// место, где строится это имя — раньше оно дублировалось в getAvailableRatings()
// 'stats'-ветке и уже один раз разъехалось с этим неймингом.
function specimenIconPath(
  mutantId: string,
  rating: string,
): { targetDir: string; iconPath: string } {
  const idLower = mutantId.toLowerCase()
  const targetDir = path.join(CONFIG.TEXTURES_DIR, idLower)
  const iconName = `specimen_${idLower}_${rating}.webp`
  return { targetDir, iconPath: path.join(targetDir, iconName) }
}

async function downloadSpecimen(
  mutantId: string,
  rating: string,
  bypassNegativeCache = false,
): Promise<boolean> {
  const idLower = mutantId.toLowerCase()
  const { targetDir, iconPath } = specimenIconPath(mutantId, rating)
  const suffix = `_${rating}`
  const iconName = `specimen_${idLower}${suffix}.webp`

  try {
    await fs.access(iconPath)
    return true
  } catch {
    // Not found
  }

  // Самолечение: legacy-файл normal без суффикса (specimen_x.webp) -> копируем
  // под каноничным именем, без похода в сеть.
  if (rating === 'normal') {
    const legacyPath = path.join(targetDir, `specimen_${idLower}.webp`)
    try {
      await fs.copyFile(legacyPath, iconPath)
      console.log(`[TEXTURE HEAL] ${idLower}: specimen_${idLower}.webp -> ${iconName}`)
      return true
    } catch {
      // legacy-файла нет — качаем
    }
  }

  // Негативный кэш: если уже подтверждали недавно, что этой текстуры нет на
  // Kobojo — не ходим в сеть заново, экономим 15с таймаут на пустышку.
  // bypassNegativeCache=true для мутантов, которых ЕЩЁ НЕТ в mutants.json:
  // для них кэш "текстуры нет" не просто экономит время, а блокирует появление
  // мутанта на сайте целиком до истечения MISSING_TEXTURE_RECHECK_DAYS (баг,
  // поймавший specimen_ef_15 — задескрипторен 2026-07-29 раньше арта, попал в
  // негативный кэш, и не подхватился бы до ~12 августа несмотря на появившийся арт).
  const cache = await loadMissingTextureCache()
  const cacheKey = `${idLower}${suffix}`
  const cachedAt = cache[cacheKey]
  if (!bypassNegativeCache && cachedAt && isMissingTextureCacheFresh(cachedAt)) {
    return false
  }

  // На Kobojo normal-портрет лежит без суффикса
  const remoteSuffix = rating === 'normal' ? '' : suffix
  const kobojoUrl = `${CONFIG.KOBOJO_IMG_BASE}specimen_${idLower}${remoteSuffix}.png`
  try {
    const res = await axios.get(kobojoUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.status === 200 && res.data.length > 100) {
      await fs.mkdir(targetDir, { recursive: true })
      await sharp(res.data).webp({ quality: 95 }).toFile(iconPath)
      if (cacheKey in cache) {
        delete cache[cacheKey]
        missingTextureCacheDirty = true
        // Пишем сразу, а не в конце main(): если процесс убьют по CI-таймауту
        // (как и произошло в прошлый раз), накопленный в памяти кэш иначе пропадёт.
        await saveMissingTextureCache()
      }
      return true
    }
  } catch {}

  cache[cacheKey] = new Date().toISOString()
  missingTextureCacheDirty = true
  await saveMissingTextureCache()
  return false
}

/**
 * Возвращает список доступных рейтингов для мутанта.
 * В режиме 'full' скачивает недостающие текстуры.
 * В режиме 'stats' только проверяет наличие.
 */
async function getAvailableRatings(
  mutantId: string,
  mode: 'full' | 'stats',
  isGacha: boolean,
  bypassNegativeCache = false,
): Promise<string[]> {
  const ratingsToCheck = isGacha ? ['normal'] : CONFIG.RATINGS
  const found: string[] = []

  for (const rating of ratingsToCheck) {
    if (mode === 'full') {
      const ok = await downloadSpecimen(mutantId, rating, bypassNegativeCache)
      if (ok) found.push(rating)
    } else {
      const { iconPath } = specimenIconPath(mutantId, rating)
      try {
        await fs.access(iconPath)
        found.push(rating)
      } catch {}
    }
  }

  return found
}

function findAllEntityDescriptors(obj: any): any[] {
  let results: any[] = []
  if (!obj || typeof obj !== 'object') return results
  if (obj.EntityDescriptor) {
    results = results.concat(
      Array.isArray(obj.EntityDescriptor) ? obj.EntityDescriptor : [obj.EntityDescriptor],
    )
  }
  for (const key in obj) {
    if (key === '?xml') continue
    results = results.concat(findAllEntityDescriptors(obj[key]))
  }
  return results
}

function parseTags(descriptor: any): Record<string, any> {
  const tags: Record<string, any> = {}
  if (descriptor?.Tag) {
    const tagList = Array.isArray(descriptor.Tag) ? descriptor.Tag : [descriptor.Tag]
    for (const tag of tagList) {
      tags[tag.key] = tag.value
    }
  }
  return tags
}

// ==================== ЛОКАЛИЗАЦИЯ ====================

function findLocalizedText(locMap: Map<string, string>, id: string, suffix: string = ''): string {
  const mutantId = id.replace('Specimen_', '').replace('specimen_', '').toLowerCase()
  const key = `specimen_${mutantId}${suffix}`.toLowerCase()
  return locMap.get(key) || ''
}

// ==================== РАСЧЕТ СТАТОВ ====================

// Формула живёт в ЕДИНСТВЕННОМ источнике правды: src/lib/stats/unified-calculator.ts.
// Здесь только клампим уровень (парсер оперирует диапазоном игры 1..30)
// и округляем скорость как раньше.
function calculateFinalStats(
  baseStats: BaseStatsCalc,
  level: number,
  starMultiplier: number,
): StatsResult {
  const lvl = Math.max(1, Math.min(30, level))
  const result = calcFinalStatsUnified(baseStats, lvl, starMultiplier)
  return { ...result, speed: roundSpeed(result.speed) }
}

// ==================== ОПРЕДЕЛЕНИЕ РЕЙТИНГА ====================

function getTrueRating(type: string, multiplier: number): Rating {
  const typeUpper = type.toUpperCase()

  if (typeUpper === 'GACHA') {
    if (multiplier >= 2.0) return 'platinum'
    if (multiplier >= 1.75) return 'gold'
    if (multiplier >= 1.3) return 'silver'
    if (multiplier >= 1.1) return 'bronze'
    return 'normal'
  }

  return 'normal'
}

// ==================== ТЕКСТУРЫ ====================

function buildImagePaths(mutantId: string, rating: string): string[] {
  const idLower = mutantId.toLowerCase()
  return [
    `textures_by_mutant/${idLower}/specimen_${idLower}_${rating}.webp`,
    `textures_by_mutant/${idLower}/larva_${idLower}.webp`,
  ]
}

// ==================== ВАЛИДАЦИЯ ====================

function validateEntry(entry: UnifiedMutant): {
  errors: string[]
  warnings: string[]
  isValid: boolean
} {
  const warnings: string[] = []
  const errors: string[] = []

  if (entry.base_stats.lvl1.hp === 0) errors.push('HP lvl1 = 0')
  if (entry.base_stats.lvl1.atk1 === 0) errors.push('ATK1 lvl1 = 0')
  if (!entry.name || entry.name === entry.id) errors.push('Имя не найдено')

  if (!entry.name_attack1 || entry.name_attack1.includes('Атака 1'))
    warnings.push('attack1 не найдена')
  if (!entry.name_attack2 || entry.name_attack2.includes('Атака 2'))
    warnings.push('attack2 не найдена')
  if (!entry.name_lore || entry.name_lore.includes('Описание для'))
    warnings.push('описание не найдено')
  if (entry.abilities.length === 0) warnings.push('способности отсутствуют')

  return { errors, warnings, isValid: errors.length === 0 }
}

// ==================== DIFF ENGINE ====================

// Структурная запись одного изменения стата (для rebalance-history.json)
interface StatChange {
  stat: 'hp' | 'atk1' | 'atk2' | 'speed' | 'abilities'
  level: 1 | 30 | null
  old: number | null
  new: number | null
  // Только для stat === 'abilities': какая способность и какое её числовое
  // поле изменилось - без этого abilities схлопывались бы в один плоский
  // булев флаг "изменены" без конкретных цифр.
  ability?: string
  field?: 'pct' | 'atk1' | 'atk2'
}

function compareStats(
  oldEntry: any,
  newEntry: any,
): { hasChanges: boolean; changes: string[]; details: StatChange[] } {
  if (!oldEntry) return { hasChanges: true, changes: ['NEW'], details: [] }

  const changes: string[] = []
  const details: StatChange[] = []
  const diffStat = (
    stat: StatChange['stat'],
    level: 1 | 30 | null,
    oldVal: number,
    newVal: number,
    label: string,
  ) => {
    if (oldVal !== newVal) {
      changes.push(`${label}: ${oldVal}→${newVal}`)
      details.push({ stat, level, old: oldVal, new: newVal })
    }
  }

  const oldL1 = oldEntry.base_stats.lvl1
  const newL1 = newEntry.base_stats.lvl1
  // level: null - скорость не разбита на lvl1/lvl30 в игре, один-единственный
  // показатель, так же трактуется на странице /rebalance.
  diffStat('speed', null, oldL1.speed, newL1.speed, 'speed')

  const oldL30 = oldEntry.base_stats.lvl30
  const newL30 = newEntry.base_stats.lvl30
  // HP: показываем статы 1 уровня (как в игре у только что заведённого
  // мутанта) - единственный из статов, где lvl1/lvl30 в base_stats
  // действительно означает уровень персонажа, а не переключатель
  // "обычная"/"усиленная" версия, как у атак ниже.
  diffStat('hp', 1, oldL1.hp, newL1.hp, 'hp1')
  // Атака 1/2: unified-calculator переключает atk1_base -> atk1p_base ("усиленная"/
  // retaliate версия атаки) на level>=10/15 соответственно - это НЕ прокачка одного
  // и того же числа, а два разных игровых стата. lvl1 здесь = обычный atk*_base,
  // lvl30 = atk*p_base. Показываем только усиленную (lvl30) версию по решению автора
  // сайта - "обычная" atk1_base/atk2_base читателю не нужна, отдельного растущего
  // от lvl1 к lvl30 показателя атаки в игре нет.
  diffStat('atk1', 1, oldEntry.base_stats.atk1p_base, newEntry.base_stats.atk1p_base, 'атк1р')
  diffStat('atk2', 1, oldEntry.base_stats.atk2p_base, newEntry.base_stats.atk2p_base, 'атк2р')

  // Способности: сравниваем по названию (пары old/new с одинаковым name),
  // диффим числовые поля по отдельности - раньше был один булев флаг
  // "изменены" без единой цифры, теперь то же было/стало/Δ, что и у статов.
  // Только "_plus"-варианты (ability_shield_plus и т.п.) - базовая способность
  // без "+" по решению автора сайта не показывается вообще, только усиленная.
  // Аналогично атакам, её atk1/atk2 берём из *_lvl30 (тот же переключатель на
  // atk1p_base/atk2p_base), *_lvl1 (обычный atk*_base) отбрасываем.
  type Ability = {
    name: string
    pct?: number
    value_atk1_lvl30?: number
    value_atk2_lvl30?: number
  }
  const oldAbilities: Ability[] = (oldEntry.abilities ?? []).filter((a: Ability) =>
    a.name.endsWith('_plus'),
  )
  const newAbilities: Ability[] = (newEntry.abilities ?? []).filter((a: Ability) =>
    a.name.endsWith('_plus'),
  )
  const abilityNames = new Set([
    ...oldAbilities.map((a) => a.name),
    ...newAbilities.map((a) => a.name),
  ])
  const abilityFieldKey: Record<string, keyof Ability> = {
    pct: 'pct',
    atk1: 'value_atk1_lvl30',
    atk2: 'value_atk2_lvl30',
  }
  for (const name of abilityNames) {
    const oldAbility = oldAbilities.find((a) => a.name === name) ?? null
    const newAbility = newAbilities.find((a) => a.name === name) ?? null
    for (const field of ['pct', 'atk1', 'atk2'] as const) {
      const key = abilityFieldKey[field]
      const oldVal = oldAbility ? ((oldAbility[key] as number | undefined) ?? null) : null
      const newVal = newAbility ? ((newAbility[key] as number | undefined) ?? null) : null
      if (oldVal !== newVal) {
        changes.push(`ability:${name}:${field}: ${oldVal}→${newVal}`)
        details.push({
          stat: 'abilities',
          level: null,
          old: oldVal,
          new: newVal,
          ability: name,
          field,
        })
      }
    }
  }

  if (
    oldEntry.name_attack1 !== newEntry.name_attack1 &&
    newEntry.name_attack1 &&
    !newEntry.name_attack1.includes('Атака')
  ) {
    changes.push('loc:attack1')
  }
  if (
    oldEntry.name_attack2 !== newEntry.name_attack2 &&
    newEntry.name_attack2 &&
    !newEntry.name_attack2.includes('Атака')
  ) {
    changes.push('loc:attack2')
  }

  return { hasChanges: changes.length > 0, changes, details }
}

// ==================== ГЛАВНАЯ ФУНКЦИЯ ====================

async function sync(options: {
  skipExisting: boolean
  forceStatUpdate: boolean
  compareBeforeUpdate: boolean
}) {
  const { skipExisting, forceStatUpdate, compareBeforeUpdate } = options
  const { gameDefs, locMap } = await loadLocalFiles()
  const gachaBonusMap = await loadGachaBonusMap()

  // Загрузка bingos.json для маппинга мутантов к бинго
  const bingoMap = new Map<string, string[]>()
  try {
    const bingosPath = path.join(process.cwd(), 'src/data/bingos.json')
    const bingosData = JSON.parse(await fs.readFile(bingosPath, 'utf-8'))
    for (const bingo of bingosData) {
      if (!bingo.mutants || !Array.isArray(bingo.mutants)) continue
      for (const mutant of bingo.mutants) {
        const specId = String(mutant.specimenId || '').toUpperCase()
        if (!specId) continue
        if (!bingoMap.has(specId)) {
          bingoMap.set(specId, [])
        }
        bingoMap.get(specId)!.push(bingo.id)
      }
    }
    console.log(`[BINGO] Загружено ${bingoMap.size} мутантов с бинго данными`)
  } catch {
    console.warn('[BINGO] Не удалось загрузить bingos.json, bingo поля будут пустыми')
  }

  // Загрузка существующих данных — единый файл
  const existingData = new Map<string, UnifiedMutant>()
  const processedIds = new Set<string>()

  try {
    const data = JSON.parse(await fs.readFile(path.join(CONFIG.DATA_DIR, 'mutants.json'), 'utf-8'))
    for (const m of data) {
      existingData.set(m.id, m)
      processedIds.add(m.id.replace(/^specimen_/, '').toUpperCase())
    }
  } catch {
    console.log('[INFO] mutants.json не найден, создаём с нуля')
  }

  const stats = {
    added: 0,
    updatedStats: 0,
    updatedLocalization: 0,
    newStars: 0,
    skipped: 0,
    errors: 0,
    warnings: 0,
    deleted: 0,
  }

  // История ребаланса: копится в режиме rebalance и дописывается в
  // src/data/mutants/rebalance-history.json (его коммитят те же workflow)
  const rebalanceEntries: { id: string; name: string; changes: StatChange[] }[] = []

  if (skipExisting) console.log(`[INFO] Режим FULL: Пропуск существующих мутантов`)
  if (compareBeforeUpdate)
    console.log(`[INFO] Режим REBALANCE: Обновление только изменившихся данных`)

  const descriptors = findAllEntityDescriptors(gameDefs)
  const specimenDescriptors = descriptors.filter((d) => {
    if (!d.id || !d.id.startsWith('Specimen_')) return false
    return !isWeakMutant(d.id, locMap)
  })

  let modifiedCount = 0
  console.log(`[SYNC] Найдено ${specimenDescriptors.length} записей. Обработка...\n`)

  const xmlMutantIds = new Set<string>()
  // Новые мутанты в порядке встречи в XML - используется ниже для
  // дописывания release-order.json (нумерация по дате выхода для /tier-table).
  const newBaseIds: string[] = []

  for (const desc of specimenDescriptors) {
    const fullId = desc.id
    const mutantId = fullId.replace('Specimen_', '')
    const baseId = `specimen_${mutantId.toLowerCase()}`
    xmlMutantIds.add(mutantId.toUpperCase())

    const tags = parseTags(desc)
    const hpBase = parseInt(tags.lifePoint || '0')
    if (hpBase === 0) continue

    const typeUpper = (tags.type || '').toUpperCase()
    const isGacha = typeUpper === 'GACHA'

    const existingEntry = existingData.get(baseId)

    // Режим FULL: проверяем наличие текстур у существующих мутантов
    let newTexturesDownloaded = false
    let ratingsFromExistingCheck: string[] | null = null
    if (skipExisting && processedIds.has(mutantId.toUpperCase())) {
      const ratings = await getAvailableRatings(mutantId, 'full', isGacha)
      ratingsFromExistingCheck = ratings
      const neededRatings = isGacha ? ['normal'] : CONFIG.RATINGS
      const missing = neededRatings.filter((r) => !ratings.includes(r))
      if (missing.length === 0) {
        stats.skipped++
        continue
      } else {
        // ВАЖНО: missing.length > 0 значит только "чего-то не хватает", а не
        // "что-то реально скачалось" - у хронически неполных мутантов (звёзд,
        // которых физически нет на Kobojo) missing никогда не станет пустым, и
        // без этой проверки [STARS UPDATED]/stats.newStars врали бы каждый день
        // на записях без единой новой звезды. Настоящий сигнал - появление
        // рейтинга, которого раньше не было в existingEntry.stars.
        const existingRatings = new Set(Object.keys(existingEntry?.stars ?? {}))
        newTexturesDownloaded = ratings.some((r) => !existingRatings.has(r))
        console.log(`[TEXTURES MISSING] ${mutantId}: не найдены текстуры для ${missing.join(', ')}`)
      }
    }

    // Переиспользуем результат проверки выше вместо повторного похода в сеть за
    // теми же самыми рейтингами (раньше это удваивало сетевые запросы на каждого
    // мутанта с неполным набором звёзд — основная причина раздувания времени прогона).
    // Мутант ещё не в mutants.json (ratingsFromExistingCheck не считался) - живая
    // проверка без негативного кэша, см. комментарий в downloadSpecimen().
    const textureRatings =
      ratingsFromExistingCheck ??
      (await getAvailableRatings(mutantId, skipExisting ? 'full' : 'stats', isGacha, true))

    if (textureRatings.length === 0) {
      console.log(`[SKIP] ${mutantId}: текстуры не найдены`)
      continue
    }

    const speedValRaw = parseFloat(tags.spX100 || '0')
    const speedValFinal = speedValRaw > 0 ? roundSpeed(1000 / speedValRaw) : 0
    const bankVal = parseInt(tags.bank || tags.silverReward || tags.productionFactor || '10')
    const xmlMultiplier = parseFloat(
      tags.multiplier || tags.statMulti || tags.statMultiplier || '0',
    )

    const baseStatsForCalc: BaseStatsCalc = {
      hp_base: hpBase,
      atk1_base: parseInt(tags.atk1 || '0'),
      atk1p_base: parseInt(tags.atk1p || '0'),
      atk2_base: parseInt(tags.atk2 || '0'),
      atk2p_base: parseInt(tags.atk2p || '0'),
      speed_base: speedValFinal,
      bank_base: bankVal,
      abilityPct1: parseInt(tags.abilityPct1 || '0'),
      abilityPct2: parseInt(tags.abilityPct2 || '0'),
    }

    // Определение множителя для GACHA
    let gachaMult = 1.0
    if (xmlMultiplier > 0) {
      gachaMult = xmlMultiplier
    } else if (isGacha) {
      const hideSkins = String(tags.hideSkins || '').toLowerCase()
      gachaMult = hideSkins.includes('platinum') ? 1.75 : 2.0
    }

    // Поправка на "паспортный" bonus из gacha.xml (см. parseGachaBonusMap) -
    // без неё GACHA-мутанты со старым bonus!=0 (Зевс, Неоурбан и т.д.)
    // считались по голой формуле и расходились с реальными статами игры.
    if (isGacha) {
      const gachaBonus = gachaBonusMap.get(mutantId.toLowerCase())?.bonus ?? 0
      if (gachaBonus !== 0) {
        const lf = gachaMult * 100
        const atkFactor = (gachaBonus + 100) / 100
        baseStatsForCalc.hp_base = Math.round((baseStatsForCalc.hp_base * (lf - gachaBonus)) / lf)
        baseStatsForCalc.atk1_base = Math.round(baseStatsForCalc.atk1_base * atkFactor)
        baseStatsForCalc.atk1p_base = Math.round(baseStatsForCalc.atk1p_base * atkFactor)
        baseStatsForCalc.atk2_base = Math.round(baseStatsForCalc.atk2_base * atkFactor)
        baseStatsForCalc.atk2p_base = Math.round(baseStatsForCalc.atk2p_base * atkFactor)
      }
    }

    // Определяем какие звёзды доступны
    const starsObj: Record<string, StarInfo> = {}

    // CAPTAINPEACE ("особые" одиночные мутанты вроде Ахерона/Капитана Ахаба) не
    // проходят через систему звёзд в игре вообще - у них нет <Star>-тегов в XML,
    // а bronze/silver/gold/platinum иногда всё равно находятся среди текстур на
    // CDN (случайные лишние файлы) и раньше ошибочно добавлялись сюда с
    // множителем как у настоящих звёзд. Берём только normal, как и для
    // подавляющего большинства CAPTAINPEACE-мутантов, у которых лишних текстур нет.
    if (isGacha) {
      const trueRating = getTrueRating(typeUpper, gachaMult)
      starsObj[trueRating] = {
        images: buildImagePaths(mutantId, 'normal'),
        ...(trueRating !== 'normal' && { multiplier: gachaMult }),
      }
    } else if (typeUpper === 'CAPTAINPEACE') {
      starsObj.normal = { images: buildImagePaths(mutantId, 'normal') }
    } else {
      for (const rating of textureRatings) {
        starsObj[rating] = {
          images: buildImagePaths(mutantId, rating),
          ...(rating !== 'normal' && { multiplier: CONFIG.MULTIPLIERS[rating] }),
        }
      }
    }

    // Статы при множителе 1.0x (raw)
    const statsLvl1 = calculateFinalStats(baseStatsForCalc, 1, 1.0)
    const statsLvl30 = calculateFinalStats(baseStatsForCalc, 30, 1.0)

    // Способности при 1.0x
    const abilitiesRaw = String(tags.abilities || '').split(';')
    const abilities = abilitiesRaw
      .map((a) => {
        const parts = a.split(':')
        if (parts.length < 2) return null
        const abilityIndex = parseInt(parts[0]) || 1
        const abilityName = parts[1]
        const isRetaliate = abilityName.includes('retaliate')
        const abilityPct =
          abilityIndex === 1 ? baseStatsForCalc.abilityPct1 : baseStatsForCalc.abilityPct2

        const calcValues = (lvl: number) => {
          const s = calculateFinalStats(baseStatsForCalc, lvl, 1.0)
          const val_atk1 = s.atk1 * (Math.abs(abilityPct) / 100)
          const val_atk2 = s.atk2 * (Math.abs(abilityPct) / 100)
          return { val_atk1, val_atk2 }
        }
        const v1 = calcValues(1)
        const v30 = calcValues(30)

        return {
          name: abilityName,
          pct: Math.abs(abilityPct),
          value_atk1_lvl1: Math.round(v1.val_atk1),
          value_atk2_lvl1: isRetaliate ? 0 : Math.round(v1.val_atk2),
          value_atk1_lvl30: Math.round(v30.val_atk1),
          value_atk2_lvl30: isRetaliate ? 0 : Math.round(v30.val_atk2),
        }
      })
      .filter(Boolean)

    let rarity = tags.type || 'default'
    if (rarity === 'CAPTAINPEACE') rarity = 'SPECIAL'

    const name = findLocalizedText(locMap, fullId) || mutantId
    const lore =
      locMap.get(`caption_${fullId.toLowerCase()}`) ||
      locMap.get(`desc_${fullId.toLowerCase()}`) ||
      findLocalizedText(locMap, fullId, '_description') ||
      `Описание для ${name}`

    const atk1Name = findLocalizedText(locMap, fullId, '_attack_1') || `Атака 1`
    const atk2Name = findLocalizedText(locMap, fullId, '_attack_2') || `Атака 2`

    const genesChar = String(tags.dna || '')
    const atk1AOE =
      String(tags.atk1 || '').includes('AOE') || String(tags.atk1p || '').includes('AOE')
    const atk2AOE =
      String(tags.atk2 || '').includes('AOE') || String(tags.atk2p || '').includes('AOE')

    // Парсим unlockAttack для точных генов атак
    const unlockAttackStr = String(tags.unlockAttack || '')
    let parsedAtk1Gene = ''
    let parsedAtk2Gene = ''
    if (unlockAttackStr) {
      for (const part of unlockAttackStr.split(';')) {
        const [atkType, , gene] = part.split(':')
        if (atkType === '1' && gene)
          parsedAtk1Gene = gene === 'neutre' ? 'neutro' : gene.toLowerCase()
        if (atkType === '2' && gene)
          parsedAtk2Gene = gene === 'neutre' ? 'neutro' : gene.toLowerCase()
      }
    }
    const atk1Gene = parsedAtk1Gene || genesChar[0]?.toLowerCase() || 'neutro'
    const atk2Gene = parsedAtk2Gene || genesChar[1]?.toLowerCase() || 'neutro'

    // Сохраняем tier из существующей записи (не затираем)
    const preservedTier = existingEntry?.tier ?? ''

    const entry: UnifiedMutant = {
      id: baseId,
      name: name,
      genes: genesChar.split(''),
      base_stats: {
        lvl1: {
          ...statsLvl1,
          atk1_gene: atk1Gene,
          atk2_gene: atk2Gene,
          atk1_AOE: atk1AOE,
          atk2_AOE: atk2AOE,
        },
        lvl30: {
          ...statsLvl30,
          atk1_gene: atk1Gene,
          atk2_gene: atk2Gene,
          atk1_AOE: atk1AOE,
          atk2_AOE: atk2AOE,
        },
        hp_base: baseStatsForCalc.hp_base,
        atk1_base: baseStatsForCalc.atk1_base,
        atk1p_base: baseStatsForCalc.atk1p_base,
        atk2_base: baseStatsForCalc.atk2_base,
        atk2p_base: baseStatsForCalc.atk2p_base,
        speed_base: baseStatsForCalc.speed_base,
        bank_base: baseStatsForCalc.bank_base,
        abilityPct1: baseStatsForCalc.abilityPct1,
        abilityPct2: baseStatsForCalc.abilityPct2,
      },
      abilities: abilities,
      stars: starsObj,
      type: rarity,
      incub_time: parseInt(tags.incubMin || '0'),
      orbs: {
        normal: String(tags.orbSlots || '').split('n').length - 1,
        special: String(tags.orbSlots || '').split('s').length - 1,
      },
      bingo: bingoMap.get(fullId.toUpperCase()) || [],
      chance: parseInt(tags.odds || '0'),
      bank: bankVal,
      tier: preservedTier,
      name_attack1: atk1Name,
      name_attack2: atk2Name,
      name_attack3: '',
      name_lore: lore,
    }

    // Валидация
    const validation = validateEntry(entry)
    if (!validation.isValid) {
      console.log(`[ERROR] ${baseId}: ${validation.errors.join(', ')}`)
      stats.errors++
      continue
    }
    if (validation.warnings.length > 0) {
      stats.warnings += validation.warnings.length
    }

    // Обновление/добавление
    if (existingEntry) {
      if (skipExisting) {
        if (newTexturesDownloaded) {
          // Текстуры были скачаны — обновляем stars в JSON (статы/локализация НЕ трогаются)
          existingEntry.stars = { ...existingEntry.stars, ...entry.stars }
          existingData.set(baseId, existingEntry)
          modifiedCount++
          stats.newStars++
          console.log(`[STARS UPDATED] ${baseId}: добавлены новые звёзды`)
        } else {
          stats.skipped++
        }
        continue
      }

      if (compareBeforeUpdate) {
        const diff = compareStats(existingEntry, entry)
        if (!diff.hasChanges) {
          stats.skipped++
          continue
        }

        // Сохраняем существующие звёзды и tier, добавляем новые
        entry.stars = { ...existingEntry.stars, ...entry.stars }
        entry.tier = existingEntry.tier || preservedTier
        existingData.set(baseId, entry)
        modifiedCount++

        const hasStatsChanges = diff.changes.some((c) => !c.startsWith('loc:'))
        const hasLocChanges = diff.changes.some((c) => c.startsWith('loc:'))

        if (hasStatsChanges) {
          stats.updatedStats++
          if (diff.details.length > 0) {
            rebalanceEntries.push({ id: baseId, name: entry.name, changes: diff.details })
          }
          console.log(`[REBALANCE] ${baseId}: ${diff.changes.join(', ')}`)
        } else if (hasLocChanges) {
          stats.updatedLocalization++
          console.log(`[LOC] ${baseId}`)
        }
      } else if (forceStatUpdate) {
        // Сохраняем существующие звёзды и tier, добавляем/обновляем новые
        entry.stars = { ...existingEntry.stars, ...entry.stars }
        entry.tier = existingEntry.tier || preservedTier
        existingData.set(baseId, entry)
        modifiedCount++
        stats.updatedStats++
      }
    } else {
      existingData.set(baseId, entry)
      modifiedCount++
      stats.added++
      newBaseIds.push(baseId)
      console.log(`[NEW] ${baseId}`)
    }
  }

  // Удаление мутантов без текстур
  if (!skipExisting) {
    const existingCountBeforeDelete = existingData.size
    // Страховка от частично оборванной загрузки gamedefinitions.xml: массовое
    // снятие мутантов из игры за один день реально не происходит, а Kobojo
    // теоретически может отдать усечённый ответ (downloadFile() не проверяет
    // размер тела для XML, в отличие от текстур). Если из XML пришло заметно
    // меньше id, чем уже в mutants.json - это почти наверняка сбой загрузки,
    // а не легитимное удаление; пропускаем проход и громко предупреждаем,
    // а не тихо стираем половину ростера.
    const MIN_XML_COVERAGE_RATIO = 0.9
    if (xmlMutantIds.size < existingCountBeforeDelete * MIN_XML_COVERAGE_RATIO) {
      console.log(
        `[WARN] XML содержит только ${xmlMutantIds.size} id против ${existingCountBeforeDelete} в mutants.json — похоже на обрыв загрузки. Удаление отсутствующих пропущено.`,
      )
    } else {
      for (const id of existingData.keys()) {
        const mutId = id.replace(/^specimen_/, '').toUpperCase()
        if (!xmlMutantIds.has(mutId)) {
          console.log(`[DELETE] ${id}: отсутствует в XML`)
          existingData.delete(id)
          stats.deleted++
          // Раньше удаление не увеличивало modifiedCount, поэтому прогон, где
          // единственное изменение - легитимное удаление, ничего не записывал
          // на диск (см. if (modifiedCount > 0) ниже).
          modifiedCount++
        }
      }
    }
  }

  // Статистика
  console.log('\n' + '='.repeat(60))
  console.log('ИТОГОВАЯ СТАТИСТИКА:')
  console.log('='.repeat(60))
  if (stats.added > 0) console.log(`Добавлено: ${stats.added}`)
  if (stats.updatedStats > 0) console.log(`Обновлено (статы): ${stats.updatedStats}`)
  if (stats.updatedLocalization > 0)
    console.log(`Обновлено (локализация): ${stats.updatedLocalization}`)
  if (stats.newStars > 0) console.log(`Новые head-версии/звёзды: ${stats.newStars}`)
  if (stats.deleted > 0) console.log(`Удалено: ${stats.deleted}`)
  if (stats.skipped > 0) console.log(`Пропущено: ${stats.skipped}`)
  if (stats.warnings > 0) console.log(`Предупреждений: ${stats.warnings}`)
  if (stats.errors > 0) console.log(`Ошибок: ${stats.errors}`)

  const totalProcessed =
    stats.added +
    stats.updatedStats +
    stats.updatedLocalization +
    stats.newStars +
    stats.skipped +
    stats.errors +
    stats.deleted
  console.log(`\nВсего обработано: ${totalProcessed} записей`)
  console.log('='.repeat(60) + '\n')

  // Markdown-сводка для $GITHUB_STEP_SUMMARY — тот же паттерн, что и у
  // sync_characters.py (scripts/character-textures/.cache/summary.md):
  // пишем в файл, а не напрямую в переменную окружения, чтобы финальный шаг
  // workflow сам решал порядок склейки секций.
  try {
    const modeLabel = skipExisting ? 'FULL' : forceStatUpdate ? 'STATS' : 'REBALANCE'
    const lines = [`### Парсер мутантов (${modeLabel}, статы/данные)`]
    if (totalProcessed === 0) {
      lines.push('ℹ️ Мутанты не обработаны (пустой XML или ошибка загрузки)')
    } else {
      lines.push(`🆕 Новых мутантов: ${stats.added}`)
      lines.push(`📈 Обновлено (статы): ${stats.updatedStats}`)
      lines.push(`🌐 Обновлено (локализация): ${stats.updatedLocalization}`)
      lines.push(`🖼️ Новые head-версии/звёзды: ${stats.newStars}`)
      lines.push(`🗑️ Удалено (нет в XML): ${stats.deleted}`)
      lines.push(`⏭️ Пропущено (без изменений): ${stats.skipped}`)
      lines.push(`⚠️ Предупреждений: ${stats.warnings}`)
      lines.push(`❌ Ошибок: ${stats.errors}`)
      lines.push('')
      lines.push(`Всего обработано: ${totalProcessed} записей`)
    }
    const cacheDir = path.join(process.cwd(), 'scripts/.cache')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(path.join(cacheDir, 'parser-summary.md'), lines.join('\n') + '\n', 'utf-8')
  } catch {
    // Сводка — не критичный шаг, не должна ронять сам синк.
  }

  if (modifiedCount > 0) {
    console.log(`[SAVE] Сохранение ${modifiedCount} изменений...`)
    const outputArray = Array.from(existingData.values())
    const filePath = path.join(CONFIG.DATA_DIR, 'mutants.json')
    await fs.writeFile(filePath, JSON.stringify(outputArray, null, 2), 'utf-8')
    console.log(`[DONE] mutants.json обновлён! (${outputArray.length} мутантов)`)
  } else {
    console.log('[DONE] Нет изменений.')
  }

  // Дописываем release-order.json (additive only, как bingos.json) - новым
  // мутантам присваивается следующий свободный номер, в порядке встречи в XML.
  // Номер закрепляется навсегда за specimen_id при первом появлении, файл
  // никогда не перезаписывается целиком (см. prompt_tablica_combined_final.md).
  if (newBaseIds.length > 0) {
    const releaseOrderPath = path.join(CONFIG.DATA_DIR, 'release-order.json')
    let releaseOrder: Record<string, number> = {}
    try {
      releaseOrder = JSON.parse(await fs.readFile(releaseOrderPath, 'utf-8'))
    } catch {
      console.warn('[RELEASE-ORDER] release-order.json не найден - создаю с нуля')
    }
    let nextNum = Object.values(releaseOrder).reduce((max, n) => Math.max(max, n), 0) + 1
    for (const baseId of newBaseIds) {
      if (releaseOrder[baseId] != null) continue
      releaseOrder[baseId] = nextNum
      nextNum++
    }
    await fs.writeFile(releaseOrderPath, JSON.stringify(releaseOrder, null, 2) + '\n', 'utf-8')
    console.log(`[RELEASE-ORDER] Присвоены номера новым мутантам: ${newBaseIds.length}`)
  }

  // Дописываем историю ребаланса (append-only, новые записи в начало)
  if (compareBeforeUpdate && rebalanceEntries.length > 0) {
    const historyPath = path.join(CONFIG.DATA_DIR, 'rebalance-history.json')
    let history: unknown[] = []
    try {
      const parsed = JSON.parse(await fs.readFile(historyPath, 'utf-8'))
      if (Array.isArray(parsed)) history = parsed
    } catch {
      // файла ещё нет
    }
    history.unshift({
      date: new Date().toISOString(),
      entries: rebalanceEntries,
    })
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8')
    console.log(`[REBALANCE HISTORY] Записано изменений: ${rebalanceEntries.length} мутантов`)
  }
}

// ==================== TEXTURES ONLY РЕЖИМ ====================

async function syncTexturesOnly() {
  console.log('[TEXTURES ONLY] Проверка и докачка недостающих текстур у всех мутантов...\n')

  const { gameDefs, locMap } = await loadLocalFiles()

  const existingData = new Map<string, UnifiedMutant>()
  try {
    const data = JSON.parse(await fs.readFile(path.join(CONFIG.DATA_DIR, 'mutants.json'), 'utf-8'))
    for (const m of data) {
      existingData.set(m.id, m)
    }
    console.log(`[INFO] Загружено ${existingData.size} мутантов из mutants.json`)
  } catch {
    console.error('[ERROR] Не удалось загрузить mutants.json')
    return
  }

  const descriptors = findAllEntityDescriptors(gameDefs)
  const specimenDescriptors = descriptors.filter((d) => {
    if (!d.id || !d.id.startsWith('Specimen_')) return false
    return !isWeakMutant(d.id, locMap)
  })

  const stats = { checked: 0, complete: 0, errors: 0 }

  for (const desc of specimenDescriptors) {
    const mutantId = desc.id.replace('Specimen_', '')
    const tags = parseTags(desc)
    const hpBase = parseInt(tags.lifePoint || '0')
    if (hpBase === 0) continue

    const typeUpper = (tags.type || '').toUpperCase()
    const isGacha = typeUpper === 'GACHA'

    stats.checked++

    // TEXTURES ONLY - режим ручной докачки, живая проверка без негативного
    // кэша (весь смысл режима - обойти "мы уже проверяли и её там нет").
    const ratings = await getAvailableRatings(mutantId, 'full', isGacha, true)
    const neededRatings = isGacha ? ['normal'] : CONFIG.RATINGS
    const missing = neededRatings.filter((r) => !ratings.includes(r))

    if (missing.length === 0) {
      stats.complete++
    } else {
      stats.errors++
      console.log(`[MISSING] ${mutantId}: не найдены текстуры для ${missing.join(', ')}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('ИТОГИ ПРОВЕРКИ ТЕКСТУР:')
  console.log('='.repeat(60))
  console.log(`Проверено: ${stats.checked}`)
  console.log(`Полные: ${stats.complete}`)
  console.log(`Проблемные: ${stats.errors}`)
  console.log('='.repeat(60) + '\n')
}

// ==================== MAIN ====================

async function main() {
  const mode = process.argv[2] || 'full'
  console.log(`\n${'='.repeat(60)}`)
  console.log(`ПАРСЕР V4 | РЕЖИМ: ${mode.toUpperCase()}`)
  console.log('='.repeat(60) + '\n')

  await ensureMissingTextureCacheFile()

  switch (mode) {
    case 'full':
      console.log('Скачивание текстур + добавление новых мутантов')
      console.log('Существующие: пропускаются (с проверкой текстур)\n')
      await sync({ skipExisting: true, forceStatUpdate: false, compareBeforeUpdate: false })
      break

    case 'stats':
      console.log('Полное обновление всех мутантов')
      console.log('Статы и локализация: обновляются\n')
      await sync({ skipExisting: false, forceStatUpdate: true, compareBeforeUpdate: false })
      break

    case 'rebalance':
      console.log('Умное обновление (только изменения)')
      console.log('Обновляются только измененные данные\n')
      await sync({ skipExisting: false, forceStatUpdate: false, compareBeforeUpdate: true })
      break

    case 'textures-only':
      console.log('Проверка и докачка текстур у всех мутантов')
      console.log('mutants.json не изменяется\n')
      await syncTexturesOnly()
      break

    default:
      console.error('Неизвестный режим!')
      console.error('\nДоступные режимы:')
      console.error('  full          - Добавление новых + текстуры (существующие с проверкой)')
      console.error('  stats         - Полное обновление статов и локализации')
      console.error('  rebalance     - Быстрое обновление (только изменения)')
      console.error('  textures-only - Проверка и докачка текстур у всех мутантов')
      process.exit(1)
  }

  console.log('\n' + '='.repeat(60))
  console.log('ЗАВЕРШЕНО')
  console.log('='.repeat(60) + '\n')
}

main().catch(console.error)
