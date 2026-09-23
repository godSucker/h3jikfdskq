// Оффлайн-проверка инвариантов announcements-пайплайна (этап 0 аудита Opus 5.5).
//
// Гоняет НАСТОЯЩИЙ scripts/build-announcements.ts в копии данных во временной
// папке, без правки прод-кода: сеть подменяет offline-preload.mjs (игровые XML
// записываются на первом прогоне и воспроизводятся на остальных, Telegram
// заглушён). Проверяет ровно те вещи, которые уже ломались на проде:
//   - повторный прогон на тех же входах ничего не меняет (идемпотентность);
//   - без живых дат / с частичными датами / без процентов скидок уже известные
//     exactDate*/featuredMutant/discountPercent не стираются, а айтемы и
//     анонсы не пропадают;
//   - журнал опубликованных id только растёт;
//   - в карточке нет дублей id, одиночные категории не склеиваются в пачку;
//   - ни один детектор не упал.
//
// Нужен реальный снимок живых дат (scripts/live-filter-dates.json и
// scripts/live-promo-percents.json из CI - kartel локально не дёргаем). По
// умолчанию берётся артефакт live-snapshots последнего успешного прогона
// announcements-hourly.yml, либо --snapshot-dir <папка с этими файлами>.
//
// Плюс статическая проверка, что все скрипты воркфлоу грузятся без Vite
// (import-check.ts).
//
// Запуск: npm run check:pipeline [-- --snapshot-dir DIR] [-- --keep]
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSingleItemCategory } from '../../src/lib/announcement-categories'
import type { Announcement } from '../../src/lib/announcement-schema'
import { checkImports, workflowScripts } from './import-check'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TSX = path.join(REPO, 'node_modules/.bin/tsx')
const PRELOAD = path.join(REPO, 'scripts/pipeline-check/offline-preload.mjs')
const SCRIPT = path.join(REPO, 'scripts/build-announcements.ts')
const LIVE_DATES = 'scripts/live-filter-dates.json'
const LIVE_PROMO = 'scripts/live-promo-percents.json'
const STATE_FILES = [
  'src/data/announcements.json',
  'scripts/announced-ids-cache.json',
  'scripts/pending-screenshots.json',
]
const LIVE_FIELDS = [
  'exactDateLabel',
  'exactDateStart',
  'exactDateEnd',
  'exactDateApprox',
  'exactDateOpenEnd',
  'featuredMutant',
  'discountPercent',
] as const

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const snapshotArg = args.includes('--snapshot-dir')
  ? args[args.indexOf('--snapshot-dir') + 1]
  : null

const failures: string[] = []
const fail = (msg: string) => {
  failures.push(msg)
  console.log(`  ✗ ${msg}`)
}

function fetchSnapshotFromCi(into: string): string {
  const runId = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--workflow=announcements-hourly.yml',
      '--status=success',
      '--limit=10',
      '--json',
      'databaseId',
      '-q',
      '.[].databaseId',
    ],
    { cwd: REPO, encoding: 'utf-8' },
  )
    .split('\n')
    .filter(Boolean)
  for (const id of runId) {
    const r = spawnSync('gh', ['run', 'download', id, '-n', 'live-snapshots', '-D', into], {
      cwd: REPO,
      encoding: 'utf-8',
    })
    if (r.status === 0 && fs.existsSync(path.join(into, 'live-filter-dates.json'))) {
      console.log(`снимок живых дат: артефакт прогона ${id}`)
      return into
    }
  }
  throw new Error(
    'не нашёл артефакт live-snapshots в последних успешных прогонах announcements-hourly.yml - ' +
      'передай --snapshot-dir с live-filter-dates.json (и live-promo-percents.json)',
  )
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function copyInto(ws: string, rel: string, from: string) {
  const dst = path.join(ws, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(from, dst, { recursive: true })
}

function runBuild(ws: string, fixtures: string, mode: 'record' | 'replay'): string {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('TELEGRAM_')) delete env[k]
  env.PIPELINE_CHECK_MODE = mode
  env.PIPELINE_CHECK_FIXTURES = fixtures
  env.TSX_TSCONFIG_PATH = path.join(REPO, 'tsconfig.json')
  const r = spawnSync(TSX, ['--import', PRELOAD, SCRIPT], {
    cwd: ws,
    env,
    encoding: 'utf-8',
    timeout: 240_000,
  })
  const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  if (r.status !== 0)
    fail(`build-announcements завершился с кодом ${r.status}\n${log.slice(-2000)}`)
  for (const line of log.split('\n')) {
    if (/Детектор .* упал/.test(line)) fail(`детектор упал: ${line.trim().slice(0, 300)}`)
    if (line.includes('[pipeline-check] no recorded response')) fail(line.trim())
    if (line.includes('[pipeline-check] unexpected fetch')) fail(line.trim())
  }
  const blocked = log.split('\n').filter((l) => l.includes('telegram call blocked')).length
  if (blocked) console.log(`  (заглушено вызовов Telegram: ${blocked})`)
  return log
}

function structural(label: string, anns: Announcement[]) {
  for (const a of anns) {
    const ids = a.items.map((it) => it.id)
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
    if (dup.length) fail(`${label}: дубли id в анонсе ${a.id}: ${[...new Set(dup)].join(', ')}`)
    if (isSingleItemCategory(a.category) && a.items.length > 1)
      fail(
        `${label}: одиночная категория ${a.category} склеена в пачку (${a.id}, ${a.items.length} шт.)`,
      )
  }
}

function ledgerGrows(
  label: string,
  before: Record<string, string[]>,
  after: Record<string, string[]>,
) {
  for (const [cat, ids] of Object.entries(before)) {
    const now = new Set(after[cat] ?? [])
    const lost = ids.filter((id) => !now.has(id))
    if (lost.length) fail(`${label}: из журнала категории ${cat} пропало ${lost.length} id`)
  }
}

// Ничего из известного в baseline не пропало и не обнулилось.
function noWipe(
  label: string,
  base: Announcement[],
  now: Announcement[],
  fields: readonly string[],
) {
  const nowById = new Map(now.map((a) => [a.id, a]))
  let checked = 0
  for (const a of base) {
    const b = nowById.get(a.id)
    if (!b) {
      fail(`${label}: пропал анонс ${a.id}`)
      continue
    }
    const itemsNow = new Map(b.items.map((it) => [it.id, it]))
    for (const it of a.items) {
      const it2 = itemsNow.get(it.id)
      if (!it2) {
        fail(`${label}: из анонса ${a.id} пропал айтем ${it.id}`)
        continue
      }
      for (const f of fields) {
        const v = (it as unknown as Record<string, unknown>)[f]
        if (v === null || v === undefined) continue
        checked++
        const v2 = (it2 as unknown as Record<string, unknown>)[f]
        // "…T10:00:00+00:00" и "…T10:00:00.000Z" - один и тот же момент.
        const same =
          f === 'exactDateStart' || f === 'exactDateEnd'
            ? typeof v === 'string' && typeof v2 === 'string' && Date.parse(v) === Date.parse(v2)
            : JSON.stringify(v2) === JSON.stringify(v)
        if (!same)
          fail(
            `${label}: ${a.id} / ${it.id}: ${f} было ${JSON.stringify(v)}, стало ${JSON.stringify(v2)}`,
          )
      }
    }
  }
  console.log(`  проверено известных живых значений: ${checked}`)
}

async function main() {
  console.log(
    `[0/5] скрипты воркфлоу грузятся голым tsx (без Vite): ${workflowScripts().length} шт.`,
  )
  for (const p of await checkImports()) fail(p)

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-check-'))
  const ws = path.join(tmp, 'ws')
  const fixtures = path.join(tmp, 'fixtures')
  const snapDir = snapshotArg ?? fetchSnapshotFromCi(path.join(tmp, 'snapshot'))
  const liveDates = path.join(snapDir, 'live-filter-dates.json')
  const livePromo = path.join(snapDir, 'live-promo-percents.json')
  if (!fs.existsSync(liveDates)) throw new Error(`нет ${liveDates}`)

  copyInto(ws, 'src/data', path.join(REPO, 'src/data'))
  for (const f of fs.readdirSync(path.join(REPO, 'scripts'))) {
    if (f.endsWith('.json') && !f.startsWith('live-'))
      copyInto(ws, `scripts/${f}`, path.join(REPO, 'scripts', f))
  }
  copyInto(
    ws,
    'scripts/kartel/date-ledger.json',
    path.join(REPO, 'scripts/kartel/date-ledger.json'),
  )

  const setLive = (dates: unknown | null, promo: boolean) => {
    const d = path.join(ws, LIVE_DATES)
    const p = path.join(ws, LIVE_PROMO)
    fs.rmSync(d, { force: true })
    fs.rmSync(p, { force: true })
    if (dates) fs.writeFileSync(d, JSON.stringify(dates))
    if (promo && fs.existsSync(livePromo)) fs.copyFileSync(livePromo, p)
  }
  const readState = () =>
    Object.fromEntries(STATE_FILES.map((f) => [f, readJson(path.join(ws, f), null)]))
  const restore = (state: Record<string, unknown>) => {
    for (const [f, v] of Object.entries(state))
      fs.writeFileSync(path.join(ws, f), JSON.stringify(v, null, 2) + '\n')
  }
  const anns = () => readJson<Announcement[]>(path.join(ws, 'src/data/announcements.json'), [])
  const ledger = () =>
    readJson<Record<string, string[]>>(path.join(ws, 'scripts/announced-ids-cache.json'), {})

  const full = readJson<{ filters: Record<string, unknown>; meta?: unknown }>(liveDates, {
    filters: {},
  })
  const ledger0 = ledger()

  console.log('\n[1/5] эталон: полные живые данные (игровые XML записываются)')
  setLive(full, true)
  const baseLog = runBuild(ws, fixtures, 'record')
  const shadow = baseLog.split('\n').find((l) => l.startsWith('### Резолвер дат'))
  if (shadow) console.log(`  ${shadow.replace('### ', '')}`)
  // Если перехват сети не сработал, "воспроизведение" молча ходило бы в
  // живую сеть и всё равно зеленело - проверяем, что снимок XML записан.
  const recorded = fs.existsSync(fixtures) ? fs.readdirSync(fixtures).length : 0
  if (recorded === 0) fail('перехват сети не сработал: ни один игровой XML не записан')
  else console.log(`  записано ответов игровых XML: ${recorded}`)
  const baseline = readState()
  const base = anns()
  const baseLedger = ledger()
  structural('эталон', base)
  ledgerGrows('эталон', ledger0, baseLedger)
  console.log(`  анонсов: ${base.length}, айтемов: ${base.reduce((n, a) => n + a.items.length, 0)}`)

  console.log('\n[2/5] повторный прогон на тех же входах - ничего не должно измениться')
  runBuild(ws, fixtures, 'replay')
  for (const f of STATE_FILES) {
    const was = JSON.stringify(baseline[f])
    const now = JSON.stringify(readJson(path.join(ws, f), null))
    if (was !== now) fail(`повторный прогон изменил ${f}`)
  }

  const scenarios: {
    title: string
    dates: unknown | null
    promo: boolean
    fields: readonly string[]
  }[] = [
    { title: '[3/5] живых дат нет совсем', dates: null, promo: true, fields: LIVE_FIELDS },
    {
      title: '[4/5] живые даты частичные (половина фильтров, упал источник имён)',
      dates: {
        ...full,
        filters: Object.fromEntries(Object.entries(full.filters).filter((_, i) => i % 2 === 0)),
        meta: { requestedCount: 1, returnedCount: 1, failedSources: ['dungeons'] },
      },
      promo: true,
      fields: LIVE_FIELDS,
    },
    { title: '[5/5] нет процентов скидок', dates: full, promo: false, fields: ['discountPercent'] },
  ]
  for (const s of scenarios) {
    console.log(`\n${s.title}`)
    restore(baseline)
    setLive(s.dates, s.promo)
    runBuild(ws, fixtures, 'replay')
    const now = anns()
    structural(s.title, now)
    ledgerGrows(s.title, baseLedger, ledger())
    noWipe(s.title, base, now, s.fields)
  }

  if (keep) console.log(`\nрабочая папка сохранена: ${tmp}`)
  else fs.rmSync(tmp, { recursive: true, force: true })

  if (failures.length) {
    console.log(`\n❌ ИНВАРИАНТЫ НАРУШЕНЫ: ${failures.length}`)
    process.exit(1)
  }
  console.log('\n✅ все инварианты соблюдены')
}

await main()
