import { describe, expect, it } from 'vitest'
import { obtainKeys, recordNewKeys } from './obtain-first-seen'

const cur = obtainKeys({
  a: [{ type: 'box', where: 'X' }],
  b: [{ type: 'event_hall', where: 'Зал обмена — 40 жетонов ивента' }],
})
const prev = obtainKeys({ a: [{ type: 'box', where: 'X' }] })

describe('recordNewKeys', () => {
  it('записывает только то, чего не было в предыдущей версии', () => {
    const r = recordNewKeys({}, cur, prev, '2026-11-14T10:00:00Z')
    expect(r.added).toBe(1)
    expect(r.next).toEqual({
      'b|event_hall|Зал обмена — 40 жетонов ивента': '2026-11-14T10:00:00Z',
    })
  })
  it('не сдвигает уже записанную дату первого появления', () => {
    const j = { 'b|event_hall|Зал обмена — 40 жетонов ивента': '2026-11-01T00:00:00Z' }
    const r = recordNewKeys(j, cur, prev, '2026-11-14T10:00:00Z')
    expect(r.added).toBe(0)
    expect(r.next).toEqual(j)
  })
  it('одинаковые версии - ничего нового', () => {
    expect(recordNewKeys({}, cur, cur, 'x').added).toBe(0)
  })
})
