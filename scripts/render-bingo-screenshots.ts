// Рендерит скриншоты досок бинго для карточек анонсов ОДИН раз и кладёт их в
// public/bingo-screenshots/ (дальше - на CDN шагом воркфлоу), а в
// src/data/bingo-screenshots.json записывает, какой файл какой версии доски
// соответствует. Карточка анонса показывает готовый PNG.
//
// Зачем: раньше карточка встраивала <img src="/api/screenshot-bingo">, и
// headless Chromium на Vercel запускался на трафике посетителей. Он регулярно
// падал, ошибка не кэшировалась, и каждый следующий посетитель снова ловил
// 500 - это был почти весь ~1% ошибок на Vercel (2026-09-21), а в анонсе
// висела битая картинка.
//
// Доска перерендеривается, когда меняется её содержимое (отпечаток
// bingoBoardHash). Рендерим только когда живая /bingo уже отдаёт ту же версию
// доски, что лежит в репо: скрин снимается с прода, и до деплоя там старая
// версия. Не совпало - пропускаем, следующий прогон (админ-бот ходит каждые
// 5 минут) подхватит.
//
// Комментарии без длинного тире: tsx спотыкается на нём (Gotchas в CLAUDE.md).

import fs from 'node:fs/promises'
import path from 'node:path'
import { bingoBoardHash } from '../src/lib/bingo-board-hash'

const SITE = 'https://archivist-library.com'
const ROOT = process.cwd()
const ANNOUNCEMENTS_PATH = path.join(ROOT, 'src/data/announcements.json')
const BINGOS_PATH = path.join(ROOT, 'src/data/bingos.json')
const MANIFEST_PATH = path.join(ROOT, 'src/data/bingo-screenshots.json')
const PUBLIC_DIR = path.join(ROOT, 'public')
const SHOTS_DIR = 'bingo-screenshots'
const SUMMARY_PATH = path.join(ROOT, 'scripts/.cache/bingo-screenshots-summary.md')

// Холодный @sparticuz/chromium отвечает до ~90с (см. process-pending-screenshots.ts).
const RENDER_TIMEOUT_MS = 100_000
const RENDER_ATTEMPTS = 2
// Настоящий скрин доски весит сотни КБ; меньше - значит пришла заглушка/ошибка.
const MIN_PNG_BYTES = 20_000

type Board = { id: string }
type Announcement = { category?: string; items?: { id?: string }[] }
type ManifestEntry = { hash: string; file: string; renderedAt: string }
type Manifest = Record<string, ManifestEntry>

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

// Отпечатки досок с живой /bingo: data-bingo-id и data-bingo-hash на панели.
async function fetchLiveHashes(): Promise<Map<string, string>> {
  const res = await fetch(`${SITE}/bingo`, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`/bingo ответил ${res.status}`)
  const html = await res.text()
  const hashes = new Map<string, string>()
  for (const tag of html.match(/<div[^>]*class="bingo-panel"[^>]*>/g) ?? []) {
    const id = tag.match(/data-bingo-id="([^"]+)"/)?.[1]
    const hash = tag.match(/data-bingo-hash="([^"]+)"/)?.[1]
    if (id && hash) hashes.set(id, hash)
  }
  return hashes
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
}

async function renderBoard(boardId: string): Promise<Buffer | string> {
  let lastError = ''
  for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${SITE}/api/screenshot-bingo?board=${encodeURIComponent(boardId)}`, {
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      })
      const buffer = Buffer.from(await res.arrayBuffer())
      if (res.ok && isPng(buffer) && buffer.length >= MIN_PNG_BYTES) return buffer
      lastError = `HTTP ${res.status}, ${buffer.length} байт: ${buffer.subarray(0, 160).toString('utf-8').replace(/\s+/g, ' ')}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  return lastError
}

async function main(): Promise<void> {
  const announcements = await readJson<Announcement[]>(ANNOUNCEMENTS_PATH, [])
  const boards = await readJson<Board[]>(BINGOS_PATH, [])
  const manifest = await readJson<Manifest>(MANIFEST_PATH, {})
  const boardsById = new Map(boards.map((b) => [b.id, b]))

  const wanted = new Set<string>()
  for (const a of announcements) {
    if (a.category !== 'bingo') continue
    for (const item of a.items ?? []) if (item.id) wanted.add(item.id)
  }

  const lines: string[] = ['### Скриншоты досок бинго для анонсов']
  let liveHashes: Map<string, string> | null = null
  let dirty = false

  for (const boardId of [...wanted].sort()) {
    const board = boardsById.get(boardId)
    if (!board) {
      lines.push(`- \`${boardId}\`: доски нет в bingos.json, пропуск`)
      continue
    }
    const hash = bingoBoardHash(board)
    const file = `/${SHOTS_DIR}/${boardId}-${hash}.png`
    const current = manifest[boardId]
    if (current?.hash === hash && (await fileExists(path.join(PUBLIC_DIR, current.file)))) continue

    liveHashes ??= await fetchLiveHashes()
    const liveHash = liveHashes.get(boardId)
    if (liveHash !== hash) {
      lines.push(`- \`${boardId}\`: на проде ещё другая версия доски (${liveHash ?? 'нет'} вместо ${hash}), жду деплоя`)
      continue
    }

    const result = await renderBoard(boardId)
    if (typeof result === 'string') {
      lines.push(`- \`${boardId}\`: ⚠️ рендер не удался (${result}), повтор в следующий прогон`)
      continue
    }

    await fs.mkdir(path.join(PUBLIC_DIR, SHOTS_DIR), { recursive: true })
    await fs.writeFile(path.join(PUBLIC_DIR, file), result)
    // Старую версию скрина из репо убираем; на CDN она остаётся лежать
    // сиротой, это безвредно.
    if (current?.file && current.file !== file) {
      await fs.rm(path.join(PUBLIC_DIR, current.file), { force: true })
    }
    manifest[boardId] = { hash, file, renderedAt: new Date().toISOString() }
    dirty = true
    lines.push(`- \`${boardId}\`: ✅ отрендерена (${Math.round(result.length / 1024)} КБ)`)
  }

  if (dirty) {
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf-8')
  }
  if (lines.length === 1) lines.push('✅ Все скриншоты актуальны')

  await fs.mkdir(path.dirname(SUMMARY_PATH), { recursive: true })
  await fs.writeFile(SUMMARY_PATH, lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error('[BINGO-SCREENSHOTS] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
