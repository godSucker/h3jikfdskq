import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'

// Fluid Compute reuses warm function instances between requests, so we keep
// one Chromium process alive at module scope instead of launching/closing it
// per request - @sparticuz/chromium's cold start (extracting + spawning the
// binary) was the dominant chunk of the reported 6-12s screenshot latency.
// Shared by every api/screenshot*.ts endpoint - one warm instance serves all
// of them instead of each launching its own (module scope survives across
// routes within the same warm function instance). All SSR routes ship in one
// Vercel function, so a per-request launch() next to this warm browser meant
// two Chromiums fighting over the same memory and /tmp: the first heavy
// render passed, every launch after it on that instance died within a second
// ("browser has been closed" / ERR_INSUFFICIENT_RESOURCES), and the failures
// were not cached, so each visitor hit the same wall again (the ~1% error
// rate of 2026-09-21, almost all of it api/screenshot-bingo).
//
// launchPersistentContext, not launch(): a plain chromium.launch() lets
// Playwright pick its own /tmp/playwright_chromiumdev_profile-* dir and only
// removes it on a graceful close() - if the process dies instead (OOM,
// --single-process crash from an unrelated concurrent page), that profile is
// orphaned until cleanupStalePlaywrightProfiles' age-based sweep catches it
// 2+ minutes later. Under back-to-back requests (e.g. testing tier-poster
// generation repeatedly) crashes can outpace that sweep and fill /tmp's fixed
// tmpfs before the next one runs - confirmed cause of a live incident
// (2026-08-07, took down every screenshot endpoint at once) and, later, the
// preview cascade where tier-poster crashes started throwing screenshot.ts
// 500s too (same shared launch path, same /tmp). A persistent context gives
// us an explicit, self-chosen userDataDir we can rm the moment 'close' fires
// (crash or not) instead of waiting on the age sweep - the sweep stays too,
// as a backstop for the case where the process is killed hard enough that no
// event fires at all.
let contextPromise: Promise<BrowserContext> | null = null
let launchingPromise: Promise<BrowserContext> | null = null

async function launchContext(): Promise<BrowserContext> {
  await cleanupStalePlaywrightProfiles()
  const Chromium = (await import('@sparticuz/chromium')).default
  const execPath = await Chromium.executablePath()
  const userDataDir = `/tmp/pw-persistent-ctx-${randomUUID()}`
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: execPath,
    args: Chromium.args,
    // Every caller wants the same 2x - a persistent context only has one
    // deviceScaleFactor for every page it opens (unlike plain
    // launch()+newPage(options), there's no per-page override for this one
    // setting), so this is the single source instead of each caller passing
    // its own. Viewport *does* differ between callers and *is* settable
    // per-page - withPage() below applies it after context.newPage().
    deviceScaleFactor: 2,
  })
  context.on('close', () => {
    if (contextPromise === launchingPromise) contextPromise = null
    fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })
  return context
}

export async function getBrowser(): Promise<BrowserContext> {
  if (contextPromise) {
    try {
      const existing = await contextPromise
      if (!existing.isClosed()) return existing
    } catch {
      // previous launch failed - fall through and retry below
    }
    contextPromise = null
  }
  launchingPromise = launchContext()
  contextPromise = launchingPromise
  return contextPromise
}

export function forceRelaunch(): void {
  contextPromise = null
}

// ERR_INSUFFICIENT_RESOURCES: the browser process is still up but can no
// longer open anything - same remedy as a dead one.
export function isBrowserDiedError(message: string): boolean {
  return /has been closed|disconnected|Target closed|ERR_INSUFFICIENT_RESOURCES/i.test(message)
}

// Runs `fn` on a fresh page of the shared browser and always closes the page
// afterwards. If the shared browser turns out to be dead, relaunches it and
// retries once - a warm instance can inherit a browser that crashed under an
// unrelated earlier request. Anything else is rethrown for the caller's own
// error response.
export async function withPage<T>(
  viewport: { width: number; height: number },
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let page: Page | undefined
    try {
      const context = await getBrowser()
      page = await context.newPage()
      await page.setViewportSize(viewport)
      return await fn(page)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (attempt === 0 && isBrowserDiedError(message)) {
        forceRelaunch()
        continue
      }
      throw err
    } finally {
      try {
        await page?.close()
      } catch {}
    }
  }
}
