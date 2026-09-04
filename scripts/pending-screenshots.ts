// Общий модуль очереди отложенных скриншотов для бот-скриншотера в
// админ-чат: build-announcements.ts ТОЛЬКО пишет (enqueueScreenshotJobs),
// scripts/process-pending-screenshots.ts читает/чистит очередь на отдельном
// 5-минутном cron'е. См. память auto-announcements-architecture.md.
//
// Задержка перед первой попыткой (минимум 5 минут, см.
// process-pending-screenshots.ts) существует НЕ из-за готовности данных -
// build-announcements.ts коммитит уже готовые данные (boxes.json/raids.json
// и т.п. читаются detectBoxes/detectDungeons ИЗ УЖЕ ЗАПИСАННЫХ файлов, не
// генерируют их сами) - а из-за того, что скриншот-эндпоинты бьют по ЖИВОМУ
// проду (https://archivist-library.com, хардкод в screenshot-*.ts), которому
// нужно время на Vercel-редеплой после пуша.
import fs from 'fs/promises'
import path from 'path'

const ROOT = process.cwd()
export const QUEUE_PATH = path.join(ROOT, 'scripts/pending-screenshots.json')

export interface PendingScreenshotJob {
  id: string // = Announcement.id
  category: string
  title: string
  itemIds: string[]
  createdAt: string // ISO
  attempts: number
}

// Категории, для которых вообще имеет смысл скриншотить (не дублируем
// сознательные решения из telegram-cross-post.ts: rebalance никогда не
// постится - "уже есть человек, который делает это вручную"; exchange -
// текстом, "и так норм", там нет одной репрезентативной карточки на
// несколько обменников разом).
const SCREENSHOT_CATEGORIES = new Set([
  'mutant',
  'skin',
  'reactor',
  'token',
  'box',
  'raid',
  'ladder',
  'bingo',
  'shopForecast',
  'dailyNews',
])

interface AnnouncementLike {
  id: string
  category?: string
  title?: string
  items?: { id: string; name: string }[] | null
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return fallback
  }
}

// Вызывается из build-announcements.ts::main() ПОСЛЕ записи
// announcements.json - добавляет по одной задаче на каждую свежую запись
// (не на каждый item внутри неё - см. process-pending-screenshots.ts, там
// это один альбом: карточка анонса + до 4 фото содержимого). Читает текущую
// очередь заново перед записью (не держит состояние между вызовами) - сама
// функция вызывается один раз за прогон build-announcements.ts, но файл
// может содержать задачи, ещё не разобранные process-pending-screenshots.ts
// с прошлых прогонов - их нельзя терять.
export async function enqueueScreenshotJobs(newlyAdded: AnnouncementLike[]): Promise<void> {
  const toQueue = newlyAdded.filter(
    (a) => a.category && SCREENSHOT_CATEGORIES.has(a.category) && (a.items?.length ?? 0) > 0,
  )
  if (toQueue.length === 0) return

  const queue = await loadJson<PendingScreenshotJob[]>(QUEUE_PATH, [])
  const now = new Date().toISOString()
  for (const a of toQueue) {
    queue.push({
      id: a.id,
      category: a.category!,
      title: a.title ?? a.items![0].name,
      itemIds: a.items!.map((it) => it.id),
      createdAt: now,
      attempts: 0,
    })
  }
  await fs.writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf-8')
}
