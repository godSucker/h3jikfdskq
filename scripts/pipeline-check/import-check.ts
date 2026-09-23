// Статическая проверка: каждый TS-скрипт, который запускают воркфлоу
// (`npx tsx scripts/...`), грузится голым Node/tsx без Vite. Класс поломки из
// аудита Opus 5.5 (находка I): скрипт транзитивно импортирует модуль с
// Vite-only импортом (`?raw` .txt через announcements-render ->
// craft-simulator) - в Vite/Astro всё работает, а в CI скрипт падает с
// ERR_UNKNOWN_FILE_EXTENSION (так трижды подряд ронялся finish-pending.yml).
//
// Скрипты НЕ выполняются: граф импортов собирается esbuild'ом (metafile), и
// проверяется, что в нём нет Vite-only суффиксов и файлов, которые голый Node
// не загрузит. Выполнять их нельзя - часть без main()-guard и пишет по путям
// от __dirname, то есть прямо в репозиторий.
import { build, type Plugin } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NODE_LOADABLE = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'])

export function workflowScripts(): string[] {
  const dir = path.join(REPO, '.github/workflows')
  const found = new Set<string>()
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf-8')
    for (const m of text.matchAll(/npx tsx (scripts\/[A-Za-z0-9_/.-]+\.ts)/g)) found.add(m[1])
  }
  return [...found].sort()
}

const viteOnly: Plugin = {
  name: 'vite-only-imports',
  setup(b) {
    b.onResolve({ filter: /\?(raw|url|inline|worker)$/ }, (a) => ({
      errors: [{ text: `Vite-only импорт "${a.path}" (из ${path.relative(REPO, a.importer)})` }],
    }))
  },
}

export async function checkImports(): Promise<string[]> {
  const problems: string[] = []
  for (const rel of workflowScripts()) {
    try {
      const res = await build({
        entryPoints: [path.join(REPO, rel)],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        metafile: true,
        logLevel: 'silent',
        packages: 'external',
        absWorkingDir: REPO,
        plugins: [viteOnly],
      })
      for (const input of Object.keys(res.metafile.inputs)) {
        const ext = path.extname(input.split('?')[0])
        if (!NODE_LOADABLE.has(ext))
          problems.push(`${rel}: тянет ${input} - голый Node его не загрузит`)
      }
    } catch (err) {
      const msgs = (err as { errors?: { text: string }[] }).errors?.map((e) => e.text) ?? [
        String(err),
      ]
      for (const m of msgs) problems.push(`${rel}: ${m}`)
    }
  }
  return problems
}
