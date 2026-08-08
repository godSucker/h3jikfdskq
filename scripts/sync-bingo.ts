import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'

// Полная автоматизация бинго: тянет манифест + все доски morphology с s-beta,
// добавляет новые доски и доливает мутантов в уже существующие "в процессе"
// доски (те, что и в самой игре ещё не полностью заполнены - см. Specimen_FF_98
// плейсхолдер в 2026_events/mutants/skins). Additive-only:
// - существующим доскам НИКОГДА не трогаем уже реальные (не-плейсхолдер) слоты,
//   награды, columns, archived-флаг;
// - новую доску добавляем только если нет ни точного совпадения по title, ни
//   уверенного совпадения по составу мутантов с чем-то существующим (иначе это
//   не новая доска, а просто иначе названный файл того же контента - см. кейс
//   morphology_xmas2016.xmz -> bingos.json id "event_xmas2016").

const CSV_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/content_mb.csv'
const BOARD_URL = (id: string) =>
  `https://s-beta.kobojo.com/mutants/gameconfig/morphology/morphology_${id}.xml`

const BINGOS_PATH = path.join(process.cwd(), 'src/data/bingos.json')
const MUTANTS_PATH = path.join(process.cwd(), 'src/data/mutants/mutants.json')

// QA-заглушки, не реальные бинго-доски (см. коммит 50d3cbb22:
// "S_basicTest_*"/"S_skinTest_*" reward id).
const KNOWN_QA_ONLY = new Set(['season_basic', 'season_nains_skin'])

const MORPHOLOGY_LINE = /^gamedata\/morphology\/morphology_([a-zA-Z0-9_]+)\.xmz;(\S+)/

// Совпадение по составу мутантов должно быть решительным, иначе не трогаем -
// пусть человек разбирается руками (см. sync-bingo-summary в step summary).
const CONTENT_MATCH_MIN_OVERLAP = 0.7
const CONTENT_MATCH_MIN_MARGIN = 0.15

interface BingoMutant {
  specimenId: string
  skin: string
}
interface BingoReward {
  name: string
  amount: number
  type: string
}
interface BingoEntry {
  title: string
  id: string
  mutants: BingoMutant[]
  rewards: BingoReward[]
  columns?: number
  archived?: boolean
}

interface ParsedBoard {
  sourceId: string
  mutants: BingoMutant[]
  rewards: BingoReward[]
  columns: number
}

const ensureArray = <T>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]
const stripTitleDashes = (t: string) => t.replace(/^-+/, '')

async function fetchManifestIds(): Promise<string[]> {
  const { data: csv } = await axios.get<string>(CSV_URL, { responseType: 'text' })
  const ids: string[] = []
  for (const line of csv.split('\n')) {
    const m = line.match(MORPHOLOGY_LINE)
    if (m && !KNOWN_QA_ONLY.has(m[1])) ids.push(m[1])
  }
  if (ids.length === 0) {
    throw new Error(
      'content_mb.csv не содержит ни одной записи gamedata/morphology/ - формат манифеста мог измениться',
    )
  }
  return ids
}

function rewardName(id: string, type: string): string {
  if (id !== '') return id
  if (type === 'hardcurrency') return 'gold'
  return type !== '' ? type : 'unknown'
}

async function fetchBoard(sourceId: string): Promise<ParsedBoard | null> {
  let xml: string
  try {
    const res = await axios.get<string>(BOARD_URL(sourceId), { responseType: 'text' })
    xml = res.data
  } catch {
    return null
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
  const parsed = parser.parse(xml)
  const season = parsed.season
  if (!season) return null

  const headerCols = ensureArray(season.headers?.cols?.col)
  const columns = headerCols.length

  const gridLines = ensureArray(season.line).sort(
    (a: any, b: any) => Number(a.indexY) - Number(b.indexY),
  )
  const mutants: BingoMutant[] = []
  for (const line of gridLines) {
    const cols = ensureArray(line.col).sort((a: any, b: any) => Number(a.indexX) - Number(b.indexX))
    for (const col of cols) {
      mutants.push({ specimenId: col.specimenId, skin: col.skin })
    }
  }

  const rewardsBlock = season.rewards ?? {}
  const rewardEls = [
    ...ensureArray(rewardsBlock.line),
    ...ensureArray(rewardsBlock.col),
    ...ensureArray(rewardsBlock.special),
  ]
  const rewards: BingoReward[] = rewardEls.map((r: any) => ({
    // String(r.type) на отсутствующем атрибуте даёт БУКВАЛЬНУЮ строку
    // "undefined" (не JS-значение) - rewardName() тогда ставит её как
    // видимое имя награды в bingos.json. ?? '' + явный фолбэк ниже чинят это
    // (найдено код-ревью 2026-08-08).
    name: rewardName(String(r.id ?? ''), String(r.type ?? '')),
    amount: Number(r.amount),
    type: String(r.type ?? 'unknown'),
  }))

  return { sourceId, mutants, rewards, columns }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const x of a) if (b.has(x)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

async function main() {
  const [manifestIds, bingos, mutantIds] = await Promise.all([
    fetchManifestIds(),
    fs.readFile(BINGOS_PATH, 'utf-8').then((t) => JSON.parse(t) as BingoEntry[]),
    fs
      .readFile(MUTANTS_PATH, 'utf-8')
      .then(
        (t) => new Set<string>((JSON.parse(t) as { id: string }[]).map((m) => m.id.toLowerCase())),
      ),
  ])

  const isPlaceholder = (specimenId: string) => !mutantIds.has(specimenId.toLowerCase())
  const realSpecimenSet = (m: BingoMutant[]) =>
    new Set(m.filter((x) => !isPlaceholder(x.specimenId)).map((x) => x.specimenId.toLowerCase()))

  const titleMap = new Map<string, BingoEntry>()
  for (const b of bingos) titleMap.set(stripTitleDashes(b.title), b)

  const matchedThisRun = new Set<BingoEntry>()
  const added: string[] = []
  const filled: { id: string; count: number }[] = []
  const needsReview: string[] = []
  let dirty = false

  for (const sourceId of manifestIds) {
    const board = await fetchBoard(sourceId)
    if (!board) {
      needsReview.push(`${sourceId} (не удалось скачать/распарсить)`)
      continue
    }

    const exact = titleMap.get(`morphology_${sourceId}`)
    let target: BingoEntry | undefined = exact

    if (!target) {
      const sourceSet = realSpecimenSet(board.mutants)
      let best: BingoEntry | undefined
      let bestScore = 0
      let secondScore = 0
      for (const candidate of bingos) {
        if (matchedThisRun.has(candidate)) continue
        const score = jaccard(sourceSet, realSpecimenSet(candidate.mutants))
        if (score > bestScore) {
          secondScore = bestScore
          bestScore = score
          best = candidate
        } else if (score > secondScore) {
          secondScore = score
        }
      }
      if (
        best &&
        bestScore >= CONTENT_MATCH_MIN_OVERLAP &&
        bestScore - secondScore >= CONTENT_MATCH_MIN_MARGIN
      ) {
        target = best
      }
    }

    if (target) {
      matchedThisRun.add(target)
      let filledCount = 0
      const len = Math.min(target.mutants.length, board.mutants.length)
      for (let i = 0; i < len; i++) {
        const slot = target.mutants[i]
        const fresh = board.mutants[i]
        if (isPlaceholder(slot.specimenId) && !isPlaceholder(fresh.specimenId)) {
          target.mutants[i] = { specimenId: fresh.specimenId, skin: fresh.skin }
          filledCount++
        }
      }
      if (filledCount > 0) {
        filled.push({ id: target.id, count: filledCount })
        dirty = true
      }
      continue
    }

    // Ни точного, ни уверенного совпадения по составу - действительно новая доска.
    // columns опускаем, если он и так совпадает с авто-вычислением в bingo.astro
    // (getBingoLayout: cols = Math.ceil(Math.sqrt(count))) - меньше шума в данных.
    const autoCols = board.mutants.length === 12 ? 4 : Math.ceil(Math.sqrt(board.mutants.length))
    const newEntry: BingoEntry = {
      title: `morphology_${sourceId}`,
      id: sourceId,
      mutants: board.mutants,
      rewards: board.rewards,
      ...(board.columns !== autoCols ? { columns: board.columns } : {}),
    }
    bingos.push(newEntry)
    matchedThisRun.add(newEntry)
    added.push(sourceId)
    dirty = true
  }

  if (dirty) {
    await fs.writeFile(BINGOS_PATH, JSON.stringify(bingos, null, 2) + '\n', 'utf-8')
  }

  const lines: string[] = ['### Бинго-доски (morphology, авто-синк)']
  if (added.length === 0 && filled.length === 0 && needsReview.length === 0) {
    lines.push('✅ Без изменений')
  } else {
    if (added.length > 0) {
      lines.push(
        `🆕 Добавлены новые доски (${added.length}): ${added.map((id) => `\`${id}\``).join(', ')}`,
      )
    }
    if (filled.length > 0) {
      lines.push(`♻️ Дозаполнены плейсхолдер-слоты:`)
      for (const f of filled) lines.push(`- \`${f.id}\`: ${f.count} слот(ов)`)
    }
    if (needsReview.length > 0) {
      lines.push(`⚠️ Требуют ручной проверки: ${needsReview.join(', ')}`)
    }
  }

  const cacheDir = path.join(process.cwd(), 'scripts/.cache')
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, 'bingo-summary.md'), lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error('[BINGO-SYNC] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
