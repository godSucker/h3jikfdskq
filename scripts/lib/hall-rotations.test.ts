import { describe, expect, it } from 'vitest'
import {
  CONFIRM_RUNS,
  observeHall,
  parseHallRewards,
  parseMysteryRewards,
  pickRotationDate,
  type HallObservation,
  type HallState,
  type NewsWindow,
} from './hall-rotations'

const obs = (a: string, b: string, c: string): HallObservation => ({
  slots: { READY_04: a, READY_07: b, READY_09: c },
  amounts: { READY_04: 40, READY_07: 100, READY_09: 180 },
})
const A = obs('specimen_aa', 'specimen_bb', 'specimen_cc')
const B = obs('specimen_dd', 'specimen_ee', 'specimen_ff')
const block = (n: number, start: string, end: string | null = null): NewsWindow => ({
  name: `Daily_news_challenge_hall_block_${n}_2026`,
  start,
  end,
})

function run(state: HallState | undefined, o: HallObservation | null, now: string, hint = {}) {
  return observeHall(state, o, now, hint, 3)
}

describe('observeHall', () => {
  it('первый состав становится ротацией только после CONFIRM_RUNS прогонов', () => {
    let r = run(undefined, A, '2026-11-12T11:49:00Z')
    expect(r.event).toEqual({ kind: 'candidate', runs: 1 })
    expect(r.state.rotations).toHaveLength(0)
    for (let i = 1; i < CONFIRM_RUNS; i++) r = run(r.state, A, '2026-11-12T12:49:00Z')
    expect(r.event.kind).toBe('rotation')
    // firstSeen - момент ПЕРВОГО наблюдения, не подтверждения
    expect(r.state.rotations[0].firstSeen).toBe('2026-11-12T11:49:00Z')
    expect(r.state.rotations[0].date).toBe('2026-11-12')
    expect(r.state.rotations[0].dateSource).toBe('first-seen')
  })

  it('неполный разбор XML не создаёт ротацию и не трогает состояние', () => {
    const r1 = run(undefined, A, '2026-11-12T11:00:00Z')
    const r2 = run(
      r1.state,
      { slots: { READY_04: 'specimen_aa' }, amounts: {} },
      '2026-11-12T12:00:00Z',
    )
    expect(r2.event.kind).toBe('skipped')
    expect(r2.state).toEqual(r1.state)
    expect(run(r1.state, null, '2026-11-12T12:00:00Z').event.kind).toBe('skipped')
  })

  it('откат к прежнему составу до подтверждения сбрасывает кандидата', () => {
    let r = run(undefined, A, '2026-11-01T10:00:00Z')
    r = run(r.state, A, '2026-11-01T11:00:00Z')
    r = run(r.state, B, '2026-11-12T10:00:00Z') // кандидат B, runs 1
    expect(r.state.candidate?.fp).toContain('specimen_dd')
    r = run(r.state, A, '2026-11-12T11:00:00Z') // вернулся A
    expect(r.event.kind).toBe('unchanged')
    expect(r.state.candidate).toBeUndefined()
    expect(r.state.rotations).toHaveLength(1)
  })

  it('новая ротация закрывает прежнюю по первому наблюдению нового состава', () => {
    let r = run(undefined, A, '2026-11-01T10:00:00Z')
    r = run(r.state, A, '2026-11-01T11:00:00Z')
    r = run(r.state, B, '2026-11-12T10:00:00Z')
    r = run(r.state, B, '2026-11-12T11:00:00Z')
    expect(r.event.kind).toBe('rotation')
    expect(r.state.rotations).toHaveLength(2)
    expect(r.state.rotations[0].endedAt).toBe('2026-11-12T10:00:00Z')
    expect(r.state.rotations[1].endedAt).toBeUndefined()
  })

  it('дата повышается до окна новостного блока, когда оно появилось позже', () => {
    let r = run(undefined, A, '2026-11-12T11:49:00Z')
    r = run(r.state, A, '2026-11-12T12:00:00Z')
    expect(r.state.rotations[0].dateSource).toBe('first-seen')
    // окно блока пришло в 13:03 и стартует в 00:00 того же дня
    const hint = { newsWindows: [block(7, '2026-11-12T00:00:00.000Z', '2026-11-17T10:00:00.000Z')] }
    r = run(r.state, A, '2026-11-12T13:05:00Z', hint)
    expect(r.event.kind).toBe('date-updated')
    expect(r.state.rotations[0]).toMatchObject({
      date: '2026-11-12',
      dateSource: 'kartel-news',
      block: 'Daily_news_challenge_hall_block_7_2026',
    })
    // дальше kartel-news не пересматривается
    r = run(r.state, A, '2026-11-12T14:05:00Z', { newsWindows: [] })
    expect(r.event.kind).toBe('unchanged')
    expect(r.state.rotations[0].dateSource).toBe('kartel-news')
  })

  it('manual-дата не перезаписывается', () => {
    const state: HallState = {
      rotations: [
        {
          fp: 'READY_04:specimen_aa,READY_07:specimen_bb,READY_09:specimen_cc',
          slots: A.slots,
          amounts: A.amounts,
          firstSeen: '2026-11-12T11:49:57Z',
          lastSeen: '2026-11-12T11:49:57Z',
          date: '2026-11-13',
          dateSource: 'manual',
        },
      ],
    }
    const hint = { newsWindows: [block(7, '2026-11-12T00:00:00.000Z')] }
    const r = run(state, A, '2026-11-13T10:00:00Z', hint)
    expect(r.event.kind).toBe('unchanged')
    expect(r.state.rotations[0].date).toBe('2026-11-13')
  })
})

describe('pickRotationDate', () => {
  const fs = '2026-11-12T11:49:00Z'
  it('игнорирует окна блоков, далёких от первого наблюдения', () => {
    const old = block(6, '2026-10-01T00:00:00.000Z', '2026-10-06T10:00:00.000Z')
    expect(pickRotationDate(fs, { newsWindows: [old] }).dateSource).toBe('first-seen')
  })
  it('игнорирует уже закрытое к моменту наблюдения окно', () => {
    const closed = block(6, '2026-11-11T00:00:00.000Z', '2026-11-12T10:00:00.000Z')
    expect(pickRotationDate(fs, { newsWindows: [closed] }).dateSource).toBe('first-seen')
  })
  it('из нескольких подходящих берёт блок с наибольшим номером', () => {
    const w = [block(6, '2026-11-10T00:00:00.000Z'), block(7, '2026-11-12T00:00:00.000Z')]
    expect(pickRotationDate(fs, { newsWindows: w })).toMatchObject({ date: '2026-11-12' })
  })
  it('без новостей использует старт окна фильтров слотов, иначе первое наблюдение', () => {
    expect(
      pickRotationDate(fs, {
        filterStart: { date: '2026-10-30', name: 'Building_Jackpot_2026_10' },
      }),
    ).toMatchObject({ date: '2026-10-30', dateSource: 'filter-window' })
    expect(pickRotationDate(fs, {})).toMatchObject({ date: '2026-11-12', dateSource: 'first-seen' })
  })
})

describe('parseHallRewards', () => {
  const xml = `<EntityDescriptor id="Building_Event_1" x="1">
    <InteractiveAction x="1" target="WORKING_04" id="CONTRACT_04"><Cost amount="40" type="entity" id="Material_Event_Token" /><Filter>Building_Challenge_Deactivable</Filter></InteractiveAction>
    <InteractiveAction x="1" target="WORKING_05" id="CONTRACT_05"><Cost amount="50" type="entity" id="Material_Event_Token" /></InteractiveAction>
    <State id="WORKING_04"><TimeAction target="READY_04" /></State>
    <State id="WORKING_05"><TimeAction target="READY_05" /></State>
    <State id="READY_04"><InteractiveAction id="RECOLT"><Reward id="Specimen_BE_10" /></InteractiveAction></State>
    <State id="READY_05"><InteractiveAction id="RECOLT"><Reward amount="2" id="Star_Gold" /></InteractiveAction></State>
  </EntityDescriptor>`
  it('берёт только награды-мутанты вместе с ценой и фильтром', () => {
    expect(parseHallRewards(xml, 'Building_Event_1')).toEqual([
      {
        slot: 'READY_04',
        spec: 'Specimen_BE_10',
        amount: 40,
        tokenId: 'Material_Event_Token',
        filter: 'Building_Challenge_Deactivable',
      },
    ])
  })
  it('нет здания - пустой список', () => {
    expect(parseHallRewards(xml, 'Building_Nope')).toEqual([])
    expect(parseMysteryRewards(xml)).toEqual([])
  })
})
