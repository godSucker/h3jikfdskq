// Отчёт точности приблизительных дат анонсов (shopForecast + dailyNews).
//
// Для каждого оффера берёт ПЕРВУЮ приблизительную дату ("≈ ...") и ИТОГОВУЮ
// точную (окно kartel) из истории коммитов announcements.json и считает
// разницу в днях. Нужен, чтобы любое новое правило датирования проверять на
// реальных данных до выкладки, а не на ощущениях.
//
//   npx tsx scripts/date-accuracy-report.ts [--since=2026-09-04] [--worst=10]
//
// Ограничения (читать перед выводами):
// - в выборку попадают только офферы, у которых точная дата в итоге появилась;
// - ошибка меряется относительно ПЕРВОЙ догадки, поэтому в неё входит и срок,
//   за который она была сделана (у раннего прогноза хуже, чем у позднего);
// - правки логики по ходу истории не разделены: старые догадки сделаны старым
//   кодом. Для проверки нового правила его надо отдельно прогнать на исходных
//   данных, этот отчёт только измеряет то, что уже опубликовано.
// - +-14 суток у 24h-баннеров 257a/b это правка от 18.09, а не промах прогноза.
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const FILE = 'src/data/announcements.json'

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const SINCE = arg('since', '2026-09-04')
const WORST = Number(arg('worst', '10'))

interface Point {
  ts: number
  label: string | null
  start: string | null
  approx: boolean
  category: string
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 })

export function kindOf(name: string): string {
  if (/weekend|madness/i.test(name)) return 'weekend'
  if (/shop_24h/i.test(name)) return '24h'
  if (/tech/i.test(name)) return 'tech'
  if (/exchange/i.test(name)) return 'exchange'
  if (/paywall|bank/i.test(name)) return 'paywall/bank'
  if (/^-*#?specimen_/i.test(name)) return 'specimen'
  return 'pack/box/bundle'
}

const dayOf = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000)

function collect(): Map<string, Point[]> {
  const commits = git('log', '--reverse', '--format=%H %ct', `--since=${SINCE}`, '--', FILE)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' '))
  const timelines = new Map<string, Point[]>()
  for (const [hash, ts] of commits) {
    let data: any[]
    try {
      data = JSON.parse(git('show', `${hash}:${FILE}`))
    } catch {
      continue
    }
    for (const a of data) {
      if (a.category !== 'shopForecast' && a.category !== 'dailyNews') continue
      for (const it of a.items ?? []) {
        if (!String(it.id).includes('|')) continue
        const list = timelines.get(it.id) ?? []
        list.push({
          ts: Number(ts),
          label: it.exactDateLabel ?? null,
          start: it.exactDateStart ?? null,
          approx: !!it.exactDateApprox,
          category: a.category,
        })
        timelines.set(it.id, list)
      }
    }
  }
  return timelines
}

interface Row {
  id: string
  category: string
  kind: string
  err: number
  guess: string
  real: string
  leadDays: number
}

function rows(timelines: Map<string, Point[]>): Row[] {
  const out: Row[] = []
  for (const [id, pts] of timelines) {
    const sorted = [...pts].sort((a, b) => a.ts - b.ts)
    const exact = sorted.filter((p) => p.label && !p.approx && p.start)
    const approx = sorted.filter((p) => p.label && p.approx && p.start)
    if (!exact.length || !approx.length) continue
    const fe = exact[exact.length - 1]
    const fa = approx[0]
    if (fa.ts > fe.ts) continue // догадка после точной даты - это не прогноз
    out.push({
      id,
      category: fe.category,
      kind: kindOf(id.split('|', 2)[1] ?? id),
      err: dayOf(fe.start!) - dayOf(fa.start!),
      guess: fa.start!.slice(0, 10),
      real: fe.start!.slice(0, 10),
      leadDays: (fe.ts - fa.ts) / 86_400,
    })
  }
  return out
}

function line(title: string, sel: Row[]) {
  if (!sel.length) return
  const errs = sel.map((r) => r.err)
  const exact = errs.filter((e) => e === 0).length
  const within1 = errs.filter((e) => Math.abs(e) <= 1).length
  const meanAbs = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length
  const hist: Record<number, number> = {}
  for (const e of errs) hist[e] = (hist[e] ?? 0) + 1
  const histStr = Object.keys(hist)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => `${k}:${hist[k]}`)
    .join(' ')
  console.log(
    `${title.padEnd(22)} n=${String(sel.length).padStart(3)} ` +
      `exact=${((exact / sel.length) * 100).toFixed(0).padStart(3)}% ` +
      `within1d=${((within1 / sel.length) * 100).toFixed(0).padStart(3)}% ` +
      `mean_abs=${meanAbs.toFixed(2)}d  {${histStr}}`,
  )
}

function main() {
  const all = rows(collect())
  console.log(`Офферов с догадкой раньше точной даты (с ${SINCE}): ${all.length}\n`)
  line('ALL', all)
  for (const c of ['shopForecast', 'dailyNews'])
    line(
      c,
      all.filter((r) => r.category === c),
    )
  console.log()
  for (const k of [...new Set(all.map((r) => r.kind))].sort()) {
    line(
      `kind=${k}`,
      all.filter((r) => r.kind === k),
    )
  }
  console.log(`\nХудшие ${WORST}:`)
  for (const r of [...all].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, WORST)) {
    console.log(
      `  ${String(r.err).padStart(3)}d ${r.category.padEnd(12)} ${r.id.slice(0, 56).padEnd(56)} ` +
        `догадка ${r.guess} -> факт ${r.real} (за ${r.leadDays.toFixed(1)} сут.)`,
    )
  }
}

if (process.argv[1]?.endsWith('date-accuracy-report.ts')) main()
