// Recompute the DERIVED numeric fields of mutants.json from its stored raw bases
// with the shared exact formula - no network. Run as the LAST step before a push
// (after pulling the daily sync commits) so stored values and code agree and the
// next sync produces no false rebalance entries.
//
// Derived fields: base_stats.lvl1/lvl30 {hp, atk1, atk2, ability, speed, silver}
// and abilities[].value_atk1/2_lvl1/lvl30. Raw bases, genes, AOE flags etc. are
// never touched. Uses the same star-less (x1.0) convention as sync-mutants.
//
//   npx tsx scripts/recompute-derived-stats.ts            write
//   npx tsx scripts/recompute-derived-stats.ts --check    report only
import fs from 'node:fs'
import path from 'node:path'
import { calculateFinalStats } from '../src/lib/stats/unified-calculator'

const FILE = path.join(process.cwd(), 'src/data/mutants/mutants.json')
const check = process.argv.includes('--check')

const roundSpeed = (v: number) => Math.round(v * 100) / 100

function main() {
  const mutants = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as any[]
  const changedFields: Record<string, number> = {}
  let changedMutants = 0
  const bump = (k: string) => (changedFields[k] = (changedFields[k] ?? 0) + 1)

  for (const m of mutants) {
    const bs = m.base_stats
    if (!bs) continue
    // Stored bases (for GACHA: the adjusted ones, as in sync-mutants) - NOT passport.
    const base = {
      hp_base: bs.hp_base,
      atk1_base: bs.atk1_base,
      atk1p_base: bs.atk1p_base,
      atk2_base: bs.atk2_base,
      atk2p_base: bs.atk2p_base,
      speed_base: bs.speed_base,
      bank_base: bs.bank_base,
      abilityPct1: bs.abilityPct1,
      abilityPct2: bs.abilityPct2,
      unlock: bs.unlock,
    }
    let touched = false
    const calc = (lvl: number) => {
      const { atk2Unlocked: _u, ...r } = calculateFinalStats(base, lvl, 1.0)
      return { ...r, speed: roundSpeed(r.speed) }
    }
    for (const [key, lvl] of [['lvl1', 1], ['lvl30', 30]] as const) {
      const fresh = calc(lvl)
      for (const f of Object.keys(fresh) as Array<keyof typeof fresh>) {
        if (bs[key]?.[f] !== fresh[f]) {
          bump(`${key}.${f}`)
          touched = true
          if (!check) bs[key][f] = fresh[f]
        }
      }
    }
    for (const a of m.abilities ?? []) {
      const idx = String(a.name).includes('_plus') ? 2 : 1
      const pct = Math.abs(idx === 1 ? bs.abilityPct1 : bs.abilityPct2)
      const retaliate = String(a.name).includes('retaliate')
      for (const [suffix, lvl] of [['lvl1', 1], ['lvl30', 30]] as const) {
        const s = calc(lvl)
        const v1 = Math.floor((s.atk1 * pct) / 100)
        const v2 = retaliate ? 0 : Math.floor((s.atk2 * pct) / 100)
        for (const [k, v] of [[`value_atk1_${suffix}`, v1], [`value_atk2_${suffix}`, v2]] as const) {
          if (a[k] !== undefined && a[k] !== v) {
            bump(`ability.${k}`)
            touched = true
            if (!check) a[k] = v
          }
        }
      }
    }
    if (touched) changedMutants++
  }

  console.log(`[recompute] mutants ${mutants.length}, with changes ${changedMutants}`)
  console.log('[recompute] changed fields:', changedFields)
  if (check) return console.log('[recompute] --check: nothing written')
  fs.writeFileSync(FILE, JSON.stringify(mutants, null, 2) + '\n', 'utf-8')
  console.log('[recompute] written')
}

main()
