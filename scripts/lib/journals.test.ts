import { describe, expect, it } from 'vitest'
import {
  buildKartelRun,
  dateSnap,
  diffDateChanges,
  extractXmlStructure,
  kartelLeadDays,
  methodAccuracy,
  observeWindows,
  promoTransitions,
  sameStructure,
  type AnnouncementLike,
  type PromoJournal,
  type WindowsJournal,
} from './journals'

const NOW = '2026-10-16T18:00:00.000Z'

const ann = (items: AnnouncementLike['items'], id = 'dailyNews-1', sprintKey = '260') =>
  ({ id, category: 'dailyNews', sprintKey, items }) as AnnouncementLike

describe('diffDateChanges', () => {
  it('logs a new item with its first date and source', () => {
    const after = [
      ann([
        {
          id: '260|x',
          exactDateLabel: '≈ 9 — 11 ноября',
          exactDateStart: '2026-11-10T10:00:00.000Z',
          exactDateApprox: true,
          exactDateUncertainDays: 1,
          exactDateSource: 'neighbor',
        },
      ]),
    ]
    const out = diffDateChanges([], after, NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      cat: 'dailyNews',
      sprint: '260',
      item: '260|x',
      from: null,
      to: { start: '2026-11-10T10:00:00.000Z', approx: true, unc: 1, src: 'neighbor' },
    })
  })

  it('logs approximate -> kartel exact with both snapshots', () => {
    const before = [
      ann([
        {
          id: 'a',
          exactDateLabel: '≈ 15 октября',
          exactDateStart: '2026-10-15T10:00:00.000Z',
          exactDateApprox: true,
          exactDateSource: 'neighbor',
        },
      ]),
    ]
    const after = [
      ann([
        {
          id: 'a',
          exactDateLabel: '16 — 19 октября',
          exactDateStart: '2026-10-16T10:00:00+00:00',
          exactDateEnd: '2026-10-19T10:00:00+00:00',
          exactDateApprox: false,
          exactDateSource: 'kartel',
        },
      ]),
    ]
    const out = diffDateChanges(before, after, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].from).toMatchObject({ start: '2026-10-15T10:00:00.000Z', src: 'neighbor' })
    expect(out[0].to).toMatchObject({
      start: '2026-10-16T10:00:00.000Z',
      end: '2026-10-19T10:00:00.000Z',
      approx: false,
      src: 'kartel',
    })
  })

  it('does not log the same instant written in a different format', () => {
    const item = (s: string) => ({ id: 'a', exactDateLabel: 'x', exactDateStart: s })
    const out = diffDateChanges(
      [ann([item('2026-10-22T10:00:00.000Z')])],
      [ann([item('2026-10-22T10:00:00+00:00')])],
      NOW,
    )
    expect(out).toEqual([])
  })

  it('logs a date that disappeared (a wipe is a bug signal)', () => {
    const before = [ann([{ id: 'a', exactDateLabel: 'x', exactDateStart: '2026-10-22T10:00:00Z' }])]
    const after = [ann([{ id: 'a' }])]
    const out = diffDateChanges(before, after, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].to).toBeNull()
    expect(out[0].from?.start).toBe('2026-10-22T10:00:00.000Z')
  })

  it('ignores items that never had a date and unchanged items', () => {
    const same = [
      ann([{ id: 'a' }, { id: 'b', exactDateLabel: 'x', exactDateStart: '2026-10-22T10:00:00Z' }]),
    ]
    expect(diffDateChanges(same, same, NOW)).toEqual([])
  })
})

describe('dateSnap', () => {
  it('is null for an item without any date', () => {
    expect(dateSnap({ id: 'a' })).toBeNull()
  })
})

describe('observeWindows', () => {
  const live = {
    f1: { start: '2026-10-20T10:00:00+00:00', end: '2026-10-23T10:00:00+00:00' },
    f2: { start: '2026-10-25T10:00:00+00:00', end: null },
    f3: { start: null, end: null },
  }

  it('bootstrap records windows with first=null (real first sighting unknown)', () => {
    const { next, added } = observeWindows(null, live, NOW)
    expect(added).toBe(2)
    expect(next.bootstrapAt).toBe(NOW)
    expect(next.filters.f1.first).toBeNull()
    expect(next.filters.f3).toBeUndefined()
  })

  it('a window seen later gets first=now (usable for lead time)', () => {
    const prev: WindowsJournal = {
      version: 1,
      bootstrapAt: '2026-10-01T00:00:00.000Z',
      filters: {
        f1: { first: null, start: '2026-10-20T10:00:00.000Z', end: '2026-10-23T10:00:00.000Z' },
      },
    }
    const { next, added } = observeWindows(
      prev,
      { ...live, f4: { start: '2026-10-30T10:00:00Z' } },
      NOW,
    )
    expect(added).toBe(2) // f2 and f4
    expect(next.filters.f4.first).toBe(NOW)
    expect(next.filters.f1.first).toBeNull()
    expect(next.bootstrapAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it('records a changed window and keeps the first sighting', () => {
    const prev: WindowsJournal = {
      version: 1,
      bootstrapAt: 'b',
      filters: {
        f1: {
          first: '2026-10-10T00:00:00.000Z',
          start: '2026-10-20T10:00:00.000Z',
          end: '2026-10-23T10:00:00.000Z',
        },
      },
    }
    const { next, changed } = observeWindows(
      prev,
      { f1: { start: '2026-10-21T10:00:00Z', end: '2026-10-23T10:00:00Z' } },
      NOW,
    )
    expect(changed).toBe(1)
    expect(next.filters.f1.first).toBe('2026-10-10T00:00:00.000Z')
    expect(next.filters.f1.changes?.[0]).toMatchObject({
      ts: NOW,
      start: '2026-10-21T10:00:00.000Z',
    })
  })

  it('prunes windows older than the retention period', () => {
    const prev: WindowsJournal = {
      version: 1,
      bootstrapAt: 'b',
      filters: {
        old: { first: null, start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' },
      },
    }
    expect(observeWindows(prev, {}, NOW).next.filters.old).toBeUndefined()
  })
})

describe('promoTransitions', () => {
  it('first run only records a baseline, no fake "started" events', () => {
    const { next, changes } = promoTransitions(null, { a: 60 }, NOW)
    expect(changes).toEqual([])
    expect(next.active).toEqual({ a: 60 })
  })

  it('logs start, change and end of a promo', () => {
    let j: PromoJournal = promoTransitions(null, { keep: 1 }, NOW).next
    j = promoTransitions(j, { keep: 1, evo: 60 }, NOW).next
    j = promoTransitions(j, { keep: 1, evo: 70 }, NOW).next
    j = promoTransitions(j, { keep: 1 }, NOW).next
    expect(j.log.map((c) => [c.name, c.from, c.to])).toEqual([
      ['evo', null, 60],
      ['evo', 60, 70],
      ['evo', 70, null],
    ])
  })

  it('an empty response is a failed request and ends nothing', () => {
    const j = promoTransitions(null, { evo: 60 }, NOW).next
    const r = promoTransitions(j, {}, NOW)
    expect(r.changes).toEqual([])
    expect(r.next.active).toEqual({ evo: 60 })
  })
})

describe('buildKartelRun', () => {
  it('computes the horizon in days ahead', () => {
    const run = buildKartelRun({
      nowIso: NOW,
      fetchOutcome: 'success',
      status: 'full',
      meta: { requestedCount: 4481, returnedCount: 249, failedSources: [] },
      filters: {
        a: { start: '2026-10-23T18:00:00.000Z' },
        b: { start: '2026-10-17T00:00:00.000Z' },
      },
      promoCount: 10,
    })
    expect(run).toMatchObject({
      fetch: 'success',
      requested: 4481,
      returned: 249,
      horizonDays: 7,
      promoActive: 10,
    })
  })

  it('has a null horizon without any window', () => {
    expect(
      buildKartelRun({
        nowIso: NOW,
        fetchOutcome: 'failure',
        status: 'missing',
        meta: null,
        filters: {},
        promoCount: null,
      }).horizonDays,
    ).toBeNull()
  })
})

describe('extractXmlStructure', () => {
  const shop = `<ShopItems>
    <ShopItem itemId="----------------------------// SPRINT 260 \\\\----------------------------" hidden="true"><Path/></ShopItem>
    <ShopItem itemId="Pack_A"><Filter>Shop_Pack_A</Filter></ShopItem>
    <ShopItem itemId="Specimen_X_01"><Filter>Shop_Specimen_X_01</Filter><Path cat="special" subCat="dailyoffer" /></ShopItem>
    <ShopItem itemId="----------------------------// SPRINT 259 \\\\----------------------------" hidden="true"></ShopItem>
    <ShopItem itemId="Pack_B"><Filter>Shop_Pack_B</Filter></ShopItem>
    <ShopItem itemId="bundle_orbs_z"><Filter>f_z</Filter><Path cat="special" subCat="dailyoffer" /></ShopItem>
  </ShopItems>`
  const popup = `<DailyPopUp>
  <OfferWindow>
    <!-- DEBUT SPRINT 260 -->
    <Offer image="hud/daily_news/news_a$$.jpg"><Filter>Shop_Pack_A</Filter><Tag key="entity" value="Pack_A" /></Offer>
    <!-- DEBUT SPRINT 259 -->
    <Offer image="hud/daily_news/news_b$$.jpg"><Filter>filter_b</Filter></Offer>
  </OfferWindow>
  <Promotions>
    <!-- DEBUT SPRINT 260 -->
    <!--
    <ShopItem itemId="Specimen_Z_09_Gold"><Filter>Shop_Specimen_Z_09_Gold</Filter></ShopItem>
    <ShopItem itemId="LuckyBox_Y"><Filter>shop_lucky_y</Filter></ShopItem>
    -->
    <!-- DEBUT SPRINT 259 -->
    <!-- -->
  </Promotions>
  </DailyPopUp>`

  it('captures block order, pool order and popup offers', () => {
    const s = extractXmlStructure(shop, popup, NOW)
    // фильтр Shop_<itemId> хранится как null, отличающийся - как есть
    expect(s.shopitems['260']).toEqual([
      ['Pack_A', null],
      ['Specimen_X_01', null],
    ])
    expect(s.shopitems['259']).toEqual([
      ['Pack_B', null],
      ['bundle_orbs_z', 'f_z'],
    ])
    expect(s.dailyPool).toEqual([
      ['Specimen_X_01', null],
      ['bundle_orbs_z', 'f_z'],
    ])
    expect(s.dailypopup['260']).toEqual([['Shop_Pack_A', 'Pack_A', 'news_a']])
    expect(s.dailypopup['259']).toEqual([['filter_b', null, 'news_b']])
  })

  it('reads the commented-out Promotions section and does not mix it into banners', () => {
    const s = extractXmlStructure(shop, popup, NOW)
    expect(s.promotions['260']).toEqual([
      ['Specimen_Z_09_Gold', null],
      ['LuckyBox_Y', 'shop_lucky_y'],
    ])
    expect(s.promotions['259']).toEqual([])
    // повторяющиеся маркеры спринтов не затирают заполненный блок баннеров
    expect(s.dailypopup['260']).toHaveLength(1)
  })

  it('keeps only the most recent sprints', () => {
    const s = extractXmlStructure(shop, popup, NOW, 1)
    expect(Object.keys(s.shopitems)).toEqual(['260'])
    expect(Object.keys(s.dailypopup)).toEqual(['260'])
    expect(Object.keys(s.promotions)).toEqual(['260'])
  })

  it('sameStructure ignores the capture time', () => {
    const a = extractXmlStructure(shop, popup, NOW)
    const b = extractXmlStructure(shop, popup, '2026-10-17T00:00:00.000Z')
    expect(sameStructure(a, b)).toBe(true)
    expect(sameStructure(null, b)).toBe(false)
  })
})

describe('methodAccuracy', () => {
  const ch = (ts: string, to: any, item = 'a') =>
    ({ ts, cat: 'dailyNews', ann: 'x', sprint: '260', item, from: null, to }) as any

  it('pairs the last guess before the first exact date and reports its method', () => {
    const rows = methodAccuracy([
      ch('2026-10-02T10:00:00Z', {
        start: '2026-10-14T10:00:00.000Z',
        end: null,
        approx: true,
        unc: 1,
        src: 'neighbor',
      }),
      ch('2026-10-05T10:00:00Z', {
        start: '2026-10-15T10:00:00.000Z',
        end: null,
        approx: true,
        unc: 1,
        src: 'neighbor',
      }),
      ch('2026-10-10T09:00:00Z', {
        start: '2026-10-16T10:00:00.000Z',
        end: null,
        approx: false,
        unc: 0,
        src: 'kartel',
      }),
    ])
    expect(rows).toEqual([
      { item: 'a', method: 'neighbor', errDays: 1, leadDays: expect.closeTo(4.96, 1) },
    ])
  })

  it('skips items that never had a guess or never got an exact date', () => {
    expect(
      methodAccuracy([
        ch('2026-10-10T09:00:00Z', {
          start: '2026-10-16T10:00:00.000Z',
          end: null,
          approx: false,
          unc: 0,
          src: 'kartel',
        }),
      ]),
    ).toEqual([])
    expect(
      methodAccuracy([
        ch('2026-10-02T10:00:00Z', {
          start: '2026-10-14T10:00:00.000Z',
          end: null,
          approx: true,
          unc: 0,
          src: 'ladder',
        }),
      ]),
    ).toEqual([])
  })
})

describe('kartelLeadDays', () => {
  it('counts only windows with a real first sighting', () => {
    const j: WindowsJournal = {
      version: 1,
      bootstrapAt: 'b',
      filters: {
        a: { first: '2026-10-10T09:00:00.000Z', start: '2026-10-16T10:00:00.000Z', end: null },
        b: { first: null, start: '2026-10-16T10:00:00.000Z', end: null },
        c: { first: '2026-10-12T10:00:00.000Z', start: '2026-10-14T10:00:00.000Z', end: null },
      },
    }
    expect(kartelLeadDays(j)).toEqual([2, 6.04].map((x) => expect.closeTo(x, 1)))
  })
})
