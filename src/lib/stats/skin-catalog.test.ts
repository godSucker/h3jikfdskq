import { describe, it, expect } from 'vitest'
import skinsRaw from '@/data/mutants/skins.json'
import mutantsRaw from '@/data/mutants/mutants.json'
import { skinsForMutant, skinPhrases, skinLabel, textContainsPhrase } from './skin-catalog'

const SKINS = (skinsRaw as { specimens: any[] }).specimens

describe('skins.json', () => {
  it('has exactly one record per (mutant, skin) pair', () => {
    const keys = SKINS.map((s) => `${String(s.id).toLowerCase()}|${s.skin}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('carries an integer bonus on every record', () => {
    for (const s of SKINS) expect(Number.isInteger(s.bonus), `${s.id} ${s.skin}`).toBe(true)
  })

  it('every skin belongs to a real mutant and has a thumbnail', () => {
    const ids = new Set((mutantsRaw as any[]).map((m) => String(m.id).toLowerCase()))
    for (const s of SKINS) {
      expect(ids.has(String(s.id).toLowerCase()), s.id).toBe(true)
      expect(s.image.length, `${s.id} ${s.skin}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('every skin code has a Russian display name', () => {
    for (const code of new Set(SKINS.map((s) => s.skin))) {
      expect(skinLabel(code), code).not.toBe(code)
    }
  })

  it('maps skins to their mutant', () => {
    const list = skinsForMutant('specimen_a_01')
    expect(list.map((s) => s.skin)).toContain('japan')
  })
})

describe('skin phrases', () => {
  it('match word-bounded and tolerate е/ё and separators', () => {
    const p = skinPhrases().find((x) => x.skin === 'beach' && x.text === 'Тропическое лето')!
    expect(textContainsPhrase('робот тропическое лето 20ур', p)).toBe(true)
    expect(textContainsPhrase('робот тропическое-лето', p)).toBe(true)
    expect(textContainsPhrase('робот тропическоелето', p)).toBe(false)
  })

  it('are ordered longest first so the full name beats a shorter one', () => {
    const phrases = skinPhrases()
    const full = phrases.findIndex((x) => x.skin === 'beach' && x.text === 'Тропическое лето')
    const short = phrases.findIndex((x) => x.skin === 'summer' && x.text === 'Лето')
    expect(full).toBeLessThan(short)
  })
})
