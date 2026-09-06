import fs from 'fs/promises'
import path from 'path'

// Сторож, не генератор: obtain.json - кураторские данные (7 коммитов ручной калибровки
// 2026-07-31: наследование vs реальный обтейн, "больше недоступен", fallback иконок).
// Этот скрипт НИКОГДА не пишет в obtain.json - только сообщает, каких мутантов там нет,
// чтобы они не лежали молча без секции "Как получить" в MutantModal.svelte.

interface MutantEntry {
  id: string
}

async function main() {
  const mutantsPath = path.join(process.cwd(), 'src/data/mutants/mutants.json')
  const obtainPath = path.join(process.cwd(), 'src/data/mutants/obtain.json')

  const mutants: MutantEntry[] = JSON.parse(await fs.readFile(mutantsPath, 'utf-8'))
  const obtain: Record<string, unknown> = JSON.parse(await fs.readFile(obtainPath, 'utf-8'))

  const missing = mutants.map((m) => m.id).filter((id) => !(id in obtain))

  const lines: string[] = ['### "Как получить" (obtain.json)']
  if (missing.length === 0) {
    lines.push(`✅ Все ${mutants.length} мутантов имеют obtain-данные`)
  } else {
    lines.push(`⚠️ Без obtain-данных (${missing.length} из ${mutants.length}):`)
    for (const id of missing) lines.push(`- \`${id}\``)
    lines.push('')
    lines.push(
      'Этих мутантов не заполнил ни `autofill-obtain.ts` (магазин/PvP-релиз), ни ' +
        '`detect-exchange-rotation.ts` (обменники) - механического источника нет. ' +
        'Способ получения (скрещивание/бинго/квест/реактор/донат-пак) нужно вписать ' +
        'руками, это кураторские данные.',
    )
  }

  const cacheDir = path.join(process.cwd(), 'scripts/.cache')
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, 'obtain-summary.md'), lines.join('\n') + '\n', 'utf-8')
  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error('[OBTAIN-DETECT] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
