// Дописывает scripts/journals/obtain-first-seen.json: какие записи obtain.json появились
// с прошлого коммита и когда. Логика и ограничения - в scripts/lib/obtain-first-seen.ts.
// Без git-истории (нет HEAD) или без obtain.json - пропуск, файл не трогаем.
import { execFileSync } from 'node:child_process'
import { journalPath, readJson, writeJsonIfChanged } from './lib/journals'
import { obtainKeys, recordNewKeys, type ObtainLike } from './lib/obtain-first-seen'
import { runMain } from './lib/run-main'

const OBTAIN = 'src/data/mutants/obtain.json'

async function main() {
  const current = await readJson<ObtainLike | null>(OBTAIN, null)
  if (!current) {
    console.warn('[obtain-first-seen] obtain.json не прочитан - пропуск')
    return
  }
  let previous: ObtainLike
  try {
    previous = JSON.parse(
      execFileSync('git', ['show', `HEAD:${OBTAIN}`], { maxBuffer: 64 * 1024 * 1024 }).toString(),
    )
  } catch (e) {
    console.warn('[obtain-first-seen] нет HEAD-версии obtain.json - пропуск:', (e as Error).message)
    return
  }
  const file = journalPath('obtain-first-seen.json')
  const journal = await readJson<Record<string, string>>(file, {})
  const { next, added } = recordNewKeys(
    journal,
    obtainKeys(current),
    obtainKeys(previous),
    new Date().toISOString(),
  )
  const wrote = added > 0 ? await writeJsonIfChanged(file, next) : false
  console.log(
    `[obtain-first-seen] новых записей: ${added}, файл ${wrote ? 'обновлён' : 'без изменений'}`,
  )
}

runMain(import.meta.url, 'obtain-first-seen', main)
