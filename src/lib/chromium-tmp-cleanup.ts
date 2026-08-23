import fs from 'fs/promises'
import path from 'path'

// headless-browser.ts now launches via launchPersistentContext with an
// explicit userDataDir (/tmp/pw-persistent-ctx-*) and removes it itself the
// moment the context's 'close' event fires - crash or graceful close alike.
// This sweep is the backstop for the one case that handler can't cover: the
// container getting killed hard enough that no event fires at all. It also
// still matches the OLD playwright_chromiumdev_profile-* naming (what a
// plain chromium.launch() used to produce, before this fix) in case any
// pre-fix orphans are still sitting in a warm container's /tmp across the
// deploy that ships this change.
//
// Contained incident (2026-08-23): tier-poster's heavier renders (many more
// images per screenshot than a single stats panel) crashed the shared
// --single-process Chromium; the resulting orphaned profile wasn't old
// enough for this sweep to catch it before the NEXT crash added another -
// /tmp filled up and every endpoint sharing headless-browser.ts (tier-poster
// AND screenshot.ts) started 500ing until the container recycled. The
// persistent-context rm-on-close is the actual fix (shrinks the orphan
// window from "next sweep, up to 2 minutes" to "immediately"); this sweep
// remains the last-resort backstop, not the primary defense anymore.
//
// MIN_AGE_MS: контейнер тёплый и может параллельно обслуживать несколько
// запросов (Fluid Compute) - слепое удаление ВСЕХ playwright-профилей
// сносило бы профиль, которым прямо сейчас пользуется ЧУЖОЙ ещё не
// завершившийся запрос (гонка, а не только сироты от аварийных завершений).
// Каждый скриншот-эндпоинт укладывается в ~30-40s суммы своих внутренних
// таймаутов - профиль старше 2 минут гарантированно осиротел, а не просто
// используется медленным соседним запросом.
const MIN_AGE_MS = 2 * 60 * 1000
const STALE_PROFILE_PREFIXES = ['playwright_chromiumdev_profile-', 'pw-persistent-ctx-']

export async function cleanupStalePlaywrightProfiles(): Promise<void> {
  try {
    const entries = await fs.readdir('/tmp')
    const now = Date.now()
    await Promise.all(
      entries
        .filter((f) => STALE_PROFILE_PREFIXES.some((prefix) => f.startsWith(prefix)))
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
