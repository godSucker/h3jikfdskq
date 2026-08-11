// Эндпоинт для /tier-table: сохраняет/сбрасывает src/data/mutants/tier-table.json
// через GitHub Contents API (тот же паттерн, что telegram-webhook.ts использует
// для правки mutants.json) - НЕ трогает mutants.json, полностью изолирован.
//
// Защита: сама страница/эндпоинт рассчитаны на то, что живут за Vercel
// Deployment Protection превью-домена (решение принято явно, не auth-less
// по умолчанию) - см. память tier-table-pipeline.

import type { APIRoute } from 'astro'
import mutantsData from '@/data/mutants/mutants.json'

const TIER_TABLE_PATH = 'src/data/mutants/tier-table.json'
// tier-table.json живёт ТОЛЬКО на ветке preview (не в main, см. память
// tier-table-preview-pipeline) - Contents API без ?ref= читает дефолтную
// ветку репозитория (main), где файла нет -> 404 -> "не удалось прочитать".
const BRANCH = 'preview'
const VALID_TIERS = new Set(['1+', '1', '1-', '2+', '2', '2-', '3+', '3', '3-', '4', '-'])

interface Mutant {
  id: string
  tier?: string | null
}
type TierTable = Record<string, { before: string; after: string }>

async function fetchGithubJsonFile(
  githubToken: string,
  owner: string,
  repo: string,
  path: string,
  branch: string = BRANCH,
): Promise<{ json: unknown; sha: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${githubToken}` } },
  )
  if (!res.ok) return null
  const data = await res.json()
  let text: string
  if (data.content && data.content.length > 0) {
    text = Buffer.from(data.content, 'base64').toString('utf-8')
  } else if (data.download_url) {
    const downloadRes = await fetch(data.download_url)
    if (!downloadRes.ok) return null
    text = await downloadRes.text()
  } else {
    return null
  }
  return { json: JSON.parse(text), sha: data.sha }
}

async function putGithubJsonFile(
  githubToken: string,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  json: unknown,
  message: string,
  branch: string = BRANCH,
): Promise<boolean> {
  const content = Buffer.from(JSON.stringify(json, null, 2) + '\n', 'utf-8').toString('base64')
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, sha, branch }),
  })
  return res.ok
}

const MUTANTS_PATH = 'src/data/mutants/mutants.json'
const TIER_UPDATED_AT_PATH = 'src/data/mutants/tier-updated-at.json'
const MAIN_BRANCH = 'main'

// Диф между текущим состоянием колонки "после" в таблице и живым mutants.json
// в main - используется и для превью перед пушем (без записи), и для самого
// коммита (с записью). '-' в таблице значит "без тира" -> поле tier удаляется
// целиком (в mutants.json нет значения-заглушки вроде 'un-tired', см. память).
function computeTierDiff(
  liveMutants: Array<{ id: string; tier?: string | null; name?: string }>,
  desiredTiers: Record<string, string>,
): {
  set: number
  changed: number
  cleared: number
  unchanged: number
  details: { id: string; name: string; from: string; to: string }[]
} {
  let set = 0
  let changed = 0
  let cleared = 0
  let unchanged = 0
  const details: { id: string; name: string; from: string; to: string }[] = []
  for (const m of liveMutants) {
    if (!(m.id in desiredTiers)) continue
    const from = m.tier ?? '-'
    const to = desiredTiers[m.id] && VALID_TIERS.has(desiredTiers[m.id]) ? desiredTiers[m.id] : '-'
    if (from === to) {
      unchanged++
      continue
    }
    if (from === '-') set++
    else if (to === '-') cleared++
    else changed++
    details.push({ id: m.id, name: m.name ?? m.id, from, to })
  }
  return { set, changed, cleared, unchanged, details }
}

export const POST: APIRoute = async ({ request }) => {
  const GITHUB_TOKEN = import.meta.env.GITHUB_TOKEN
  const REPO_OWNER = import.meta.env.REPO_OWNER
  const REPO_NAME = import.meta.env.REPO_NAME
  if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    return new Response(
      JSON.stringify({ error: 'Сервер не настроен (нет GITHUB_TOKEN/REPO_OWNER/REPO_NAME)' }),
      {
        status: 500,
      },
    )
  }

  let body: {
    action?: string
    changes?: Record<string, { before?: string; after?: string }>
    tiers?: Record<string, string>
  }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Некорректный JSON' }), { status: 400 })
  }

  // Публикация текущей колонки "после" из тир-таблицы в прод (mutants.json на
  // main) - отдельная ветка, читает/пишет ДРУГОЙ файл на ДРУГОЙ ветке, не
  // трогает tier-table.json. 'tier-diff' - только просчёт разницы для
  // подтверждения на клиенте, 'sync-to-prod' - реальный коммит (со своим
  // свежим sha, читается непосредственно перед записью).
  if (body.action === 'tier-diff' || body.action === 'sync-to-prod') {
    if (!body.tiers) return new Response(JSON.stringify({ error: 'Нет tiers' }), { status: 400 })
    const mutantsFile = await fetchGithubJsonFile(
      GITHUB_TOKEN,
      REPO_OWNER,
      REPO_NAME,
      MUTANTS_PATH,
      MAIN_BRANCH,
    )
    if (!mutantsFile) {
      return new Response(JSON.stringify({ error: 'Не удалось прочитать mutants.json из main' }), {
        status: 502,
      })
    }
    const liveMutants = mutantsFile.json as Array<{
      id: string
      tier?: string | null
      name?: string
    }>
    const diff = computeTierDiff(liveMutants, body.tiers)

    if (body.action === 'tier-diff') {
      return new Response(JSON.stringify({ ok: true, diff }), { status: 200 })
    }

    for (const d of diff.details) {
      const idx = liveMutants.findIndex((m) => m.id === d.id)
      if (idx === -1) continue
      if (d.to === '-') delete liveMutants[idx].tier
      else liveMutants[idx].tier = d.to
    }
    const ok = await putGithubJsonFile(
      GITHUB_TOKEN,
      REPO_OWNER,
      REPO_NAME,
      MUTANTS_PATH,
      mutantsFile.sha,
      liveMutants,
      `🛠️ Tier Table → прод: ${diff.set} новых, ${diff.changed} изменено, ${diff.cleared} снято`,
      MAIN_BRANCH,
    )
    if (!ok)
      return new Response(
        JSON.stringify({ error: 'Коммит не прошёл (устаревший sha? перезагрузи страницу)' }),
        { status: 409 },
      )

    // Best-effort: сами тиры уже опубликованы (главное дело сделано), метка
    // даты на /tier-list - не критичный побочный эффект. Тот же файл, что
    // обновляет телеграм-вебхук - оба писателя тиров держат её актуальной,
    // иначе дата снова начнёт расходиться с реальностью (см. git-историю
    // tier-list/index.astro - там и до этого была захардкожена).
    try {
      const stampFile = await fetchGithubJsonFile(
        GITHUB_TOKEN,
        REPO_OWNER,
        REPO_NAME,
        TIER_UPDATED_AT_PATH,
        MAIN_BRANCH,
      )
      if (stampFile) {
        await putGithubJsonFile(
          GITHUB_TOKEN,
          REPO_OWNER,
          REPO_NAME,
          TIER_UPDATED_AT_PATH,
          stampFile.sha,
          { updatedAt: new Date().toISOString() },
          `🛠️ Tier Table → прод: tier-updated-at`,
          MAIN_BRANCH,
        )
      }
    } catch {
      // Не роняем ответ из-за побочной метки - тиры уже успешно записаны выше.
    }

    return new Response(JSON.stringify({ ok: true, diff }), { status: 200 })
  }

  const file = await fetchGithubJsonFile(GITHUB_TOKEN, REPO_OWNER, REPO_NAME, TIER_TABLE_PATH)
  if (!file) {
    return new Response(
      JSON.stringify({ error: 'Не удалось прочитать tier-table.json из репозитория' }),
      {
        status: 502,
      },
    )
  }
  const table = file.json as TierTable

  if (body.action === 'refresh') {
    // "Обновить тиры" - жёсткий пересинк ОБЕИХ колонок из актуального тир-листа
    // (mutants.json.tier), затирая ручные правки. Поведение специально такое,
    // см. prompt_tablica_mutantov.md раздел 3.
    const mutants = mutantsData as Mutant[]
    const fresh: TierTable = {}
    for (const m of mutants) {
      const tier = String(m.tier ?? '').trim() || '-'
      fresh[m.id] = { before: tier, after: tier }
    }
    const ok = await putGithubJsonFile(
      GITHUB_TOKEN,
      REPO_OWNER,
      REPO_NAME,
      TIER_TABLE_PATH,
      file.sha,
      fresh,
      '🛠️ Tier Table: пересинк тиров из тир-листа',
    )
    if (!ok)
      return new Response(JSON.stringify({ error: 'Коммит не прошёл (устаревший sha?)' }), {
        status: 409,
      })
    return new Response(JSON.stringify({ ok: true, table: fresh }), { status: 200 })
  }

  if (body.action === 'save' && body.changes) {
    for (const [id, change] of Object.entries(body.changes)) {
      const existing = table[id] ?? { before: '-', after: '-' }
      const before =
        change.before != null && VALID_TIERS.has(change.before) ? change.before : existing.before
      const after =
        change.after != null && VALID_TIERS.has(change.after) ? change.after : existing.after
      table[id] = { before, after }
    }
    const ok = await putGithubJsonFile(
      GITHUB_TOKEN,
      REPO_OWNER,
      REPO_NAME,
      TIER_TABLE_PATH,
      file.sha,
      table,
      `🛠️ Tier Table: ручная правка (${Object.keys(body.changes).length} мутантов)`,
    )
    if (!ok)
      return new Response(
        JSON.stringify({ error: 'Коммит не прошёл (устаревший sha? перезагрузи страницу)' }),
        { status: 409 },
      )
    return new Response(JSON.stringify({ ok: true, table }), { status: 200 })
  }

  return new Response(JSON.stringify({ error: 'Неизвестное action' }), { status: 400 })
}
