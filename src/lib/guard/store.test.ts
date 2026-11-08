import { describe, expect, it } from 'vitest'
import { createMemoryStore, nextCheckAt, RETENTION_SEC } from './store'

describe('nextCheckAt', () => {
  it('hourly during the first day, every 6 hours after', () => {
    expect(nextCheckAt(1000, 1000)).toBe(1000 + 3600)
    expect(nextCheckAt(1000 + 86400 + 5, 1000)).toBe(1000 + 86400 + 5 + 6 * 3600)
  })
})

describe('memory store (same contract as the Redis one)', () => {
  it('due returns only people whose time has come, oldest first, up to the limit', async () => {
    const s = createMemoryStore()
    await s.recordJoin('c', 1, 1000)
    await s.recordJoin('c', 2, 2000)
    await s.recordJoin('other', 3, 1000)
    expect(await s.due('c', 1000 + 3599, 10)).toEqual([])
    expect((await s.due('c', 9999, 10)).map((d) => d.userId)).toEqual([1, 2])
    expect(await s.due('c', 9999, 1)).toHaveLength(1)
  })

  it('people older than the retention are dropped, not returned', async () => {
    const s = createMemoryStore()
    await s.recordJoin('c', 1, 1000)
    expect(await s.due('c', 1000 + RETENTION_SEC + 10, 10)).toEqual([])
    expect(await s.joinedAt('c', 1)).toBeNull()
  })

  it('forget reports whether this caller removed the record', async () => {
    const s = createMemoryStore()
    await s.recordJoin('c', 1, 1000)
    expect(await s.forget('c', 1)).toBe(true)
    expect(await s.forget('c', 1)).toBe(false)
  })

  it('a message check can be claimed once per window; exemptions stick', async () => {
    const s = createMemoryStore()
    expect(await s.claimMessageCheck('c', 1)).toBe(true)
    expect(await s.claimMessageCheck('c', 1)).toBe(false)
    expect(await s.isExempt(1)).toBe(false)
    await s.exempt(1)
    expect(await s.isExempt(1)).toBe(true)
  })
})
