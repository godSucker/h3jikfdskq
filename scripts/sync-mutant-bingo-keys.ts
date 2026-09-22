// Пересобирает поле `bingo` у мутантов в mutants.json из bingos.json.
//
// Зачем: bingos.json синкается автоматически (sync-bingo.ts, каждый час), а
// `bingo` у мутанта раньше не обновлял никто. Из-за этого фильтр "Бинго" на
// /mutants и список досок в карточке мутанта отставали от реальных досок:
// на 2026-09-21 в выпадашке было 40 досок из 53, а 13 (все новогодние
// 2016-2025, anniversary_21/24, event_2023) не показывали ни одного мутанта.
//
// Слияние ADDITIVE-ONLY, как и сам синк досок: ключи только добавляются,
// существующие не удаляются даже если мутанта убрали с доски.
//
// Комментарии в этом файле только ASCII: esbuild/tsx спотыкается на em dash
// в .ts-скриптах (см. Gotchas в CLAUDE.md).

import fs from 'node:fs/promises'
import path from 'node:path'
import { runMain } from './lib/run-main'

const BINGOS_PATH = path.join(process.cwd(), 'src/data/bingos.json')
const MUTANTS_PATH = path.join(process.cwd(), 'src/data/mutants/mutants.json')
const SUMMARY_PATH = path.join(process.cwd(), 'scripts/.cache/bingo-keys-summary.md')

type BingoEntry = { specimenId?: string; skin?: string }
type BingoBoard = { id: string; mutants?: BingoEntry[] }
type Mutant = { id: string; bingo?: unknown }

function toMutantId(specimenId: string): string {
  return `specimen_${specimenId.replace(/^Specimen_/i, '').toLowerCase()}`
}

function readKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) =>
        typeof x === 'string'
          ? x
          : x && typeof x === 'object' && typeof (x as any).key === 'string'
            ? (x as any).key
            : '',
      )
      .filter(Boolean)
  }
  if (raw && typeof raw === 'object') return Object.keys(raw as Record<string, unknown>)
  return []
}

async function main(): Promise<void> {
  const boards: BingoBoard[] = JSON.parse(await fs.readFile(BINGOS_PATH, 'utf-8'))
  const mutants: Mutant[] = JSON.parse(await fs.readFile(MUTANTS_PATH, 'utf-8'))

  const byId = new Map(mutants.map((m) => [m.id, m]))

  // Порядок досок в bingos.json задаёт порядок новых ключей у мутанта.
  const membership = new Map<string, string[]>()
  const unknownSpecimens = new Map<string, number>()

  for (const board of boards) {
    if (!board?.id || !Array.isArray(board.mutants)) continue
    for (const entry of board.mutants) {
      if (!entry?.specimenId) continue
      const mutantId = toMutantId(entry.specimenId)
      if (!byId.has(mutantId)) {
        // Плейсхолдер-слоты вроде Specimen_FF_98: сущность есть в
        // gamedefinitions.xml, но без локализованного имени, в каталог такие
        // не попадают.
        unknownSpecimens.set(mutantId, (unknownSpecimens.get(mutantId) ?? 0) + 1)
        continue
      }
      const list = membership.get(mutantId) ?? []
      if (!list.includes(board.id)) list.push(board.id)
      membership.set(mutantId, list)
    }
  }

  const addedPerBoard = new Map<string, number>()
  let touchedMutants = 0

  for (const mutant of mutants) {
    const current = readKeys(mutant.bingo)
    const wanted = membership.get(mutant.id) ?? []
    const added = wanted.filter((key) => !current.includes(key))
    if (added.length === 0) continue

    mutant.bingo = [...current, ...added]
    touchedMutants += 1
    for (const key of added) addedPerBoard.set(key, (addedPerBoard.get(key) ?? 0) + 1)
  }

  const lines: string[] = ['### Ключи бинго у мутантов (mutants.json)']
  if (touchedMutants === 0) {
    lines.push('✅ Без изменений')
  } else {
    const total = [...addedPerBoard.values()].reduce((a, b) => a + b, 0)
    lines.push(`🎯 Проставлено ${total} ключ(ей) у ${touchedMutants} мутант(ов):`)
    for (const [board, count] of [...addedPerBoard.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${board}\`: ${count}`)
    }
    await fs.writeFile(MUTANTS_PATH, JSON.stringify(mutants, null, 2), 'utf-8')
  }

  if (unknownSpecimens.size > 0) {
    const listed = [...unknownSpecimens.entries()]
      .map(([id, count]) => `\`${id}\` (${count})`)
      .join(', ')
    lines.push(`ℹ️ Слоты досок без мутанта в каталоге: ${listed}`)
  }

  await fs.mkdir(path.dirname(SUMMARY_PATH), { recursive: true })
  await fs.writeFile(SUMMARY_PATH, lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

runMain(import.meta.url, 'BINGO-KEYS', main)
