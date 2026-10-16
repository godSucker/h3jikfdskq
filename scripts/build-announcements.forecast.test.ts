import { describe, expect, it } from 'vitest'
import { splitForecastSprints } from './build-announcements'

type F = { sprint: number; items: { id: string }[] }
const toItems = (f: F) => f.items.map((i) => ({ id: `${f.sprint}|${i.id}`, name: i.id }))
const forecast = (sprint: number, n = 2): F => ({
  sprint,
  items: Array.from({ length: n }, (_, i) => ({ id: `o${i}` })),
})

describe('splitForecastSprints +2', () => {
  it('публикует блок "+2" в этом же прогоне, если "+1" уже в ledger', () => {
    const r = splitForecastSprints(
      ['258', '259'],
      forecast(258),
      forecast(259),
      toItems,
      forecast(260),
    )
    expect(r.sprintKey).toBe('260')
    expect(r.newIds).toEqual(['258', '259', '260'])
    expect(r.items).toHaveLength(2)
    expect(r.updateExisting?.map((u) => u.sprintKey).sort()).toEqual(['258', '259'])
  })

  it('у "+1" приоритет: пока он не опубликован, "+2" ждёт следующего прогона', () => {
    const r = splitForecastSprints(['258'], forecast(258), forecast(259), toItems, forecast(260))
    expect(r.sprintKey).toBe('259')
    expect(r.newIds).toEqual(['258', '259'])
  })

  it('уже опубликованный "+2" дозаполняется, а не дублируется', () => {
    const r = splitForecastSprints(
      ['258', '259', '260'],
      forecast(258),
      forecast(259),
      toItems,
      forecast(260),
    )
    expect(r.sprintKey).toBeUndefined()
    expect(r.items).toEqual([])
    expect(r.updateExisting?.map((u) => u.sprintKey).sort()).toEqual(['258', '259', '260'])
  })

  it('пустой блок "+2" (маркер раньше офферов) не публикуется и не попадает в ledger', () => {
    const r = splitForecastSprints(
      ['258', '259'],
      forecast(258),
      forecast(259),
      toItems,
      forecast(260, 0),
    )
    expect(r.items).toEqual([])
    expect(r.newIds).toEqual(['258', '259'])
  })

  it('пустой "+2" уже опубликованного спринта не затирает запись', () => {
    const r = splitForecastSprints(
      ['258', '259', '260'],
      forecast(258),
      forecast(259),
      toItems,
      forecast(260, 0),
    )
    expect(r.updateExisting?.map((u) => u.sprintKey).sort()).toEqual(['258', '259'])
  })

  it('без "+2" поведение прежнее', () => {
    const r = splitForecastSprints(['258'], forecast(258), forecast(259), toItems)
    expect(r.sprintKey).toBe('259')
    const r2 = splitForecastSprints(['258', '259'], forecast(258), forecast(259), toItems, null)
    expect(r2.items).toEqual([])
  })
})
