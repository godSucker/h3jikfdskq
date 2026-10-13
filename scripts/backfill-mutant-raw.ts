// Backfill the raw additive fields of mutants.json (spX100, unlock, passport)
// from the live gamedefinitions.xml + gacha.xml WITHOUT touching anything else.
//
// Why a separate script: sync-mutants skips mutants whose compared stats did not
// change, so existing entries would never receive newly added raw fields.
//
//   npx tsx scripts/backfill-mutant-raw.ts            write
//   npx tsx scripts/backfill-mutant-raw.ts --check    report only
//
// Fields (all under base_stats):
//   spX100   raw integer speed tag (displayed speed 1000/spX100 is ambiguous)
//   unlock   own attack unlock levels, ONLY when not the default 1/5/10/15
//   passport GACHA mutants with a gacha bonus: raw bases + bonus (the plain
//            hp_base/atk*_base have the bonus baked in with rounding)
import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

const REPO = process.cwd()
const MUTANTS = path.join(REPO, 'src/data/mutants/mutants.json')
const DEFS = 'https://s-beta.kobojo.com/mutants/gameconfig/gamedefinitions.xml'
const GACHA = 'https://s-beta.kobojo.com/mutants/gameconfig/gacha.xml'

const check = process.argv.includes('--check')

function parseTags(block: string): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const m of block.matchAll(/<Tag key="([^"]*)" value="([^"]*)"/g)) tags[m[1]] = m[2]
  return tags
}

function parseUnlock(raw: string): Record<string, number> | undefined {
  if (!raw) return undefined
  const key: Record<string, string> = { '1': 'atk1', '2': 'atk2', '1p': 'atk1p', '2p': 'atk2p' }
  const out: Record<string, number> = {}
  for (const part of raw.split(';')) {
    const [name, level] = part.split(':')
    const n = Number(level)
    if (key[name] && Number.isFinite(n)) out[key[name]] = n
  }
  const std: Record<string, number> = { atk1: 1, atk2: 5, atk1p: 10, atk2p: 15 }
  return Object.keys(std).every((k) => (out[k] ?? std[k]) === std[k]) ? undefined : out
}

async function main() {
  const [defs, gacha] = await Promise.all([
    axios.get<string>(DEFS, { responseType: 'text', timeout: 60000 }),
    axios.get<string>(GACHA, { responseType: 'text', timeout: 60000 }),
  ])

  // First gacha bonus per specimen code (same rule as sync-mutants.parseGachaBonusMap).
  const gachaBonus = new Map<string, number>()
  for (const m of String(gacha.data).matchAll(/<GachaSpecimen[^>]*specimen="Specimen_([^"]+)"[^>]*\/>/gi)) {
    const code = m[1].toLowerCase()
    if (!gachaBonus.has(code)) gachaBonus.set(code, Number(m[0].match(/bonus="([^"]*)"/)?.[1] ?? 0))
  }

  const tagsById = new Map<string, Record<string, string>>()
  for (const m of String(defs.data).matchAll(
    /<EntityDescriptor[^>]*id="(Specimen_[A-Za-z0-9_]+)"[\s\S]*?<\/EntityDescriptor>/g,
  )) {
    tagsById.set(m[1].toLowerCase(), parseTags(m[0]))
  }

  const mutants = JSON.parse(fs.readFileSync(MUTANTS, 'utf-8')) as any[]
  const stat = { sp: 0, unlock: 0, passport: 0, missing: 0, changed: 0, passportMismatch: [] as string[] }

  for (const m of mutants) {
    const tags = tagsById.get(String(m.id).toLowerCase())
    if (!tags) {
      stat.missing++
      continue
    }
    const bs = m.base_stats
    const before = JSON.stringify([bs.spX100, bs.unlock, bs.passport])

    const sp = Math.round(Number(tags.spX100 || 0))
    if (sp > 0) {
      bs.spX100 = sp
      stat.sp++
    }
    const unlock = parseUnlock(String(tags.unlockAttack || ''))
    if (unlock) {
      bs.unlock = unlock
      stat.unlock++
    } else delete bs.unlock

    delete bs.passport
    if (String(m.type).toUpperCase() === 'GACHA') {
      const bonus = gachaBonus.get(String(m.id).toLowerCase().replace(/^specimen_/, '')) ?? 0
      if (bonus !== 0) {
        const raw = {
          bonus,
          hp_base: parseInt(tags.lifePoint || '0'),
          atk1_base: parseInt(tags.atk1 || '0'),
          atk1p_base: parseInt(tags.atk1p || '0'),
          atk2_base: parseInt(tags.atk2 || '0'),
          atk2p_base: parseInt(tags.atk2p || '0'),
        }
        bs.passport = raw
        stat.passport++
        // sanity: the stored (adjusted) hp_base must be raw*(lf-bonus)/lf for the single star
        const mult = Object.values(m.stars ?? {}).map((s: any) => s.multiplier).find(Boolean) ?? 1
        const lf = mult * 100
        const adj = Math.round((raw.hp_base * (lf - bonus)) / lf)
        if (adj !== bs.hp_base) stat.passportMismatch.push(`${m.id}: stored ${bs.hp_base}, from raw ${adj}`)
      }
    }
    if (JSON.stringify([bs.spX100, bs.unlock, bs.passport]) !== before) stat.changed++
  }

  console.log(
    `[backfill] mutants ${mutants.length}, no definition ${stat.missing}, spX100 ${stat.sp}, ` +
      `custom unlock ${stat.unlock}, passport ${stat.passport}, entries changed ${stat.changed}`,
  )
  if (stat.passportMismatch.length)
    console.log(`[backfill] passport sanity mismatches (${stat.passportMismatch.length}):\n  ` + stat.passportMismatch.join('\n  '))
  if (check) return console.log('[backfill] --check: nothing written')
  fs.writeFileSync(MUTANTS, JSON.stringify(mutants, null, 2) + '\n', 'utf-8')
  console.log('[backfill] written')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
