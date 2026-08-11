import fs from 'fs/promises'
import path from 'path'

// Playwright создаёт свежий --user-data-dir на КАЖДЫЙ chromium.launch()
// (видно в Vercel-логах как /tmp/playwright_chromiumdev_profile-XXXXXX) и
// удаляет его при штатном browser.close(). Если запрос падает ДО close()
// (ошибка ресурсов, таймаут) - профиль остаётся сиротой. Контейнер Vercel
// живёт warm между вызовами, /tmp у него - tmpfs фиксированного размера, так
// что несколько таких сирот за сессию интенсивного тестирования (2026-08-07 -
// один "живой прогон" уронил ВСЕ скриншот-эндпоинты сразу, включая давно
// работавший screenshot-bingo) забивают его до нуля свободного места -
// новый Chromium не может выделить shared memory и падает на старте.
// Подметаем перед КАЖДЫМ launch, не полагаясь только на finally-close.
//
// MIN_AGE_MS: контейнер тёплый и может параллельно обслуживать несколько
// запросов (Fluid Compute) - слепое удаление ВСЕХ playwright_* директорий
// сносило бы профиль, которым прямо сейчас пользуется ЧУЖОЙ ещё не
// завершившийся запрос (гонка, а не только сироты от аварийных завершений).
// Каждый скриншот-эндпоинт укладывается в ~30-40s суммы своих внутренних
// таймаутов - профиль старше 2 минут гарантированно осиротел, а не просто
// используется медленным соседним запросом.
const MIN_AGE_MS = 2 * 60 * 1000

export async function cleanupStalePlaywrightProfiles(): Promise<void> {
  try {
    const entries = await fs.readdir('/tmp')
    const now = Date.now()
    await Promise.all(
      entries
        .filter((f) => f.startsWith('playwright_chromiumdev_profile-'))
        .map(async (f) => {
          const full = path.join('/tmp', f)
          try {
            const stat = await fs.stat(full)
            if (now - stat.mtimeMs < MIN_AGE_MS) return
            await fs.rm(full, { recursive: true, force: true })
          } catch {
            // Директория уже исчезла/недоступна - гонка неопасна, пропускаем
          }
        }),
    )
  } catch {
    // /tmp недоступен/пуст - нечего убирать
  }
}
