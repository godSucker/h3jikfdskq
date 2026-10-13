import { describe, it, expect } from 'vitest'
import {
  SPEED_SPHERE_TABLE,
  applySpeedSphere,
  applySpeedSphereExact,
} from './speed-sphere-table'

const PCT = { lvl3: 15, lvl4: 18, lvl5: 20 } as const

// spX100 candidates that display as `base` (1000/x rounded half-up to 2 decimals).
function candidates(base: string): number[] {
  const out: number[] = []
  for (let x = 20; x < 3000; x++) if ((Math.round((1000 / x) * 100) / 100).toFixed(2) === base) out.push(x)
  return out
}

describe('speed sphere: table and exact formula agree', () => {
  it('the exact integer rule reproduces every table cell (150/150)', () => {
    let cells = 0
    for (const [base, row] of Object.entries(SPEED_SPHERE_TABLE)) {
      const cs = candidates(base)
      expect(cs.length, base).toBeGreaterThan(0)
      for (const lvl of ['lvl3', 'lvl4', 'lvl5'] as const) {
        cells++
        const ok = cs.some((sp) => applySpeedSphereExact(Number(base), PCT[lvl], sp) === row[lvl])
        expect(ok, `${base} ${lvl}`).toBe(true)
      }
    }
    expect(cells).toBe(150)
  })

  it('table stays primary for a single orb on a tabulated speed', () => {
    expect(applySpeedSphere(4.0, 15)).toBe(4.61)
    expect(applySpeedSphere(3.13, 15)).toBe(3.6)
  })

  it('falls back to the exact rule (not naive percent math) off-table and for orb sums', () => {
    // 4.00 (spX100 250) with +33% (two orbs): floor(25000/133) = 187 -> 5.35
    expect(applySpeedSphere(4.0, 33, 250)).toBe(5.35)
    expect(applySpeedSphere(4.0, 33, 250)).not.toBe(4 * 1.33)
  })
})
