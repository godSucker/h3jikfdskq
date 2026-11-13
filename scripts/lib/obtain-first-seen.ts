// Журнал "когда запись впервые появилась в obtain.json" (scripts/journals/obtain-first-seen.json).
// obtain.json копится только вперёд (additive-only) и дат не хранит, поэтому о записи
// нельзя сказать, когда её увидел пайплайн. Журнал пишется diff'ом: ключи текущего
// obtain.json минус ключи его версии в HEAD (то есть то, что добавили шаги workflow
// после прошлого коммита). Записи, существовавшие до введения журнала, в нём
// отсутствуют по построению: "нет в журнале" = раньше, чем журнал начали вести.
// Переименование подписи выглядит как новая запись.

export type ObtainLike = Record<string, { type: string; where: string }[]>

export const obtainKey = (mutantId: string, type: string, where: string) =>
  `${mutantId}|${type}|${where}`

export function obtainKeys(obtain: ObtainLike): Set<string> {
  const keys = new Set<string>()
  for (const [id, entries] of Object.entries(obtain)) {
    for (const e of entries) keys.add(obtainKey(id, e.type, e.where))
  }
  return keys
}

// Новые записи -> журнал (уже записанные не трогаем: дата первого появления не сдвигается).
export function recordNewKeys(
  journal: Record<string, string>,
  current: Set<string>,
  previous: Set<string>,
  nowIso: string,
): { next: Record<string, string>; added: number } {
  const next = { ...journal }
  let added = 0
  for (const key of [...current].sort()) {
    if (previous.has(key) || key in next) continue
    next[key] = nowIso
    added += 1
  }
  return { next, added }
}
