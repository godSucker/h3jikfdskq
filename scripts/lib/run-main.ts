// Единая точка входа для скриптов, вызываемых из GitHub Actions
// (`npx tsx scripts/foo.ts`), но также импортируемых другими скриптами как
// библиотека (напр. finish-pending.ts импортирует parseGachaXml из
// detect-new-reactors.ts, не должен попутно триггерить полный прогон
// детектора).
//
// НАЙДЕНО (Opus 5.5 audit, 2026-09-22): такой guard был только в 5 из 16
// hourly-скриптов, у остальных main() вызывался безусловно при импорте. Плюс
// сам паттерн `import.meta.url === \`file://${process.argv[1]}\`` хрупкий -
// при пробелах в пути или симлинке сравнение строк ложно, и скрипт молча
// ничего не делает без единого предупреждения в логе. pathToFileURL() кодирует
// путь по правилам URL (как и import.meta.url), а не голой склейкой строки.
import { pathToFileURL } from 'url'

export function runMain(moduleUrl: string, label: string, main: () => Promise<void>): void {
  const invokedDirectly =
    process.argv[1] != null && pathToFileURL(process.argv[1]).href === moduleUrl
  if (!invokedDirectly) {
    // Раньше это было тихо (см. описание выше) - CI-лог теперь явно показывает
    // случай "main() пропущен", а не отсутствие любого вывода вообще.
    console.warn(`[${label}] импортирован как модуль (не запущен напрямую) - main() пропущен.`)
    return
  }
  main().catch((err) => {
    console.error(`[${label}] Ошибка:`, err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
