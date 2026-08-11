import { chromium, type Browser } from 'playwright-core'
import { cleanupStalePlaywrightProfiles } from '@/lib/chromium-tmp-cleanup'

// Fluid Compute reuses warm function instances between requests, so we keep
// one Chromium process alive at module scope instead of launching/closing it
// per request - @sparticuz/chromium's cold start (extracting + spawning the
// binary) was the dominant chunk of the reported 6-12s screenshot latency.
// Shared between api/screenshot.ts and api/tier-poster.ts - one warm instance
// serves both instead of each keeping its own (module scope survives across
// routes within the same warm function instance).
let browserPromise: Promise<Browser> | null = null
let launchingPromise: Promise<Browser> | null = null

async function launchBrowser(): Promise<Browser> {
  await cleanupStalePlaywrightProfiles()
  const Chromium = (await import('@sparticuz/chromium')).default
  const execPath = await Chromium.executablePath()
  const browser = await chromium.launch({
    executablePath: execPath,
    args: Chromium.args,
  })
  // Chromium runs --single-process for the serverless binary, so a crash in
  // any one concurrent page can take the whole shared instance down. Drop the
  // cached promise immediately so the next getBrowser() call relaunches
  // instead of handing out a reference nobody can open new pages on.
  browser.on('disconnected', () => {
    if (browserPromise === launchingPromise) browserPromise = null
  })
  return browser
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const existing = await browserPromise
      if (existing.isConnected()) return existing
    } catch {
      // previous launch failed - fall through and retry below
    }
    browserPromise = null
  }
  launchingPromise = launchBrowser()
  browserPromise = launchingPromise
  return browserPromise
}

export function forceRelaunch(): void {
  browserPromise = null
}

export function isBrowserDiedError(message: string): boolean {
  return /has been closed|disconnected|Target closed/i.test(message)
}
