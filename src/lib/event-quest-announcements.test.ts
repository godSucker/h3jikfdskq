import { describe, it, expect } from 'vitest'
import { isEmptyQuestItem } from './event-quest-announcements'

describe('isEmptyQuestItem', () => {
  const chain = new Set(['1', '2', '3'])
  it('a chain missing from the data is empty', () => {
    expect(isEmptyQuestItem({}, undefined)).toBe(true)
    expect(isEmptyQuestItem({}, new Set())).toBe(true)
  })
  it('a new-chain card with steps is fine', () => {
    expect(isEmptyQuestItem({}, chain)).toBe(false)
  })
  it('added steps that are gone make the card empty (the 2026-10-22 ghosts)', () => {
    expect(isEmptyQuestItem({ addedStepIds: ['7', '8'] }, chain)).toBe(true)
  })
  it('one surviving added step keeps the card', () => {
    expect(isEmptyQuestItem({ addedStepIds: ['7', '2'] }, chain)).toBe(false)
  })
})
