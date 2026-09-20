// Generate src/data/mutants/skins.json from the game's gacha.xml + current base
// stats in mutants.json, using the reverse-engineered skin stat formula.
//
// Source of truth for WHICH skins exist: the rendered full textures
// (public/textures_by_skins/textures_by_skin/full/FULL_<code>_<skin>.png).
// If the texture is there, the skin is real -> we emit stats for it.
//
// Formula (verified against 204/245 hand-written entries, Ghidra + Frida):
//   lvl1.hp   = floor(hp_base   * (LF - bonus) / 100)
//   lvl1.atkN = floor(atkN_base * (bonus + 100) * LF / 10000)
//   lvlM      = floor(lvl1 * base.lvlM / base.lvl1)   per stat
// where LF is the star multiplier x100: {0:100,1:110,2:130,3:175,4:200},
// and (stars, bonus) come from the GachaSpecimen entry for (specimen, skin).
//
// Usage:
//   npx tsx scripts/build-skins.ts              build + write skins.json (fetch gacha from CDN)
//   npx tsx scripts/build-skins.ts --check      build + diff vs current skins.json, DO NOT write
//   npx tsx scripts/build-skins.ts --gacha PATH use a local gacha.xml instead of the CDN

import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

const REPO = process.cwd()
const GACHA_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gacha.xml'
const SKIN_BASE = 'textures_by_skins/textures_by_skin'
const FULL_DIR = path.join(REPO, 'public', SKIN_BASE, 'full')
const SEMI_DIR = path.join(REPO, 'public', SKIN_BASE, 'semi-full')
const MUTANTS = path.join(REPO, 'src/data/mutants/mutants.json')
const SKINS_OUT = path.join(REPO, 'src/data/mutants/skins.json')
const OVERRIDES = path.join(REPO, 'src/data/mutants/skins-overrides.json')

const LEVEL_FACTOR: Record<number, number> = { 0: 100, 1: 110, 2: 130, 3: 175, 4: 200 }
const STAR_NAME: Record<number, string> = {
  0: 'none',
  1: 'bronze',
  2: 'silver',
  3: 'gold',
  4: 'platinum',
}

const calcHP = (base: number, stars: number, bonus: number) =>
  Math.floor((base * (LEVEL_FACTOR[stars] - bonus)) / 100)
const calcATK = (base: number, stars: number, bonus: number) =>
  Math.floor((base * (bonus + 100) * LEVEL_FACTOR[stars]) / 10000)
// Scale a floored lvl1 value by the base mutant's own per-stat level curve.
const scale = (lvl1: number, baseLvl1: number, baseLvlM: number) =>
  baseLvl1 > 0 ? Math.floor((lvl1 * baseLvlM) / baseLvl1) : 0

// basic - запись из <BasicElements> (сам скин), иначе <CompletionReward>
// (утешительная награда за сбор набора, у неё свои stars/bonus и к скину она
// отношения не имеет - в fallback ниже такие не годятся).
type GachaEntry = { stars: number; bonus: number; basic: boolean }

// Parse gacha.xml into a map keyed by "<code>|<skin>" -> {stars, bonus}.
// code is the lowercased specimen without the Specimen_ prefix (a_01),
// skin is the Gacha id attribute (japan, girl, ...). Works on minified XML.
function parseGacha(xml: string): Map<string, GachaEntry> {
  const map = new Map<string, GachaEntry>()
  const gachaRe = /<Gacha\s+id="([^"]+)"[\s\S]*?<\/Gacha>/g
  let g: RegExpExecArray | null
  while ((g = gachaRe.exec(xml))) {
    const skin = g[1]
    const block = g[0]
    const basicBlock = block.match(/<BasicElements>[\s\S]*?<\/BasicElements>/)?.[0] ?? ''
    const specRe = /<GachaSpecimen[^>]*specimen="([^"]+)"[^>]*?\/>/g
    let s: RegExpExecArray | null
    while ((s = specRe.exec(block))) {
      const tag = s[0]
      const code = s[1].replace(/^Specimen_/i, '').toLowerCase()
      const stars = Number(tag.match(/stars="([^"]*)"/)?.[1] ?? 0)
      const bonus = Number(tag.match(/bonus="([^"]*)"/)?.[1] ?? 0)
      map.set(`${code}|${skin}`, { stars, bonus, basic: basicBlock.includes(tag) })
    }
  }
  return map
}

async function loadGacha(): Promise<string> {
  const argIdx = process.argv.indexOf('--gacha')
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    const p = process.argv[argIdx + 1]
    console.log(`[gacha] local file: ${p}`)
    return fs.readFileSync(p, 'utf-8')
  }
  console.log(`[gacha] fetching ${GACHA_URL}`)
  const res = await axios.get(GACHA_URL, { responseType: 'text', timeout: 30000 })
  return String(res.data)
}

type SkinRecord = {
  id: string
  name: string
  genes: string[]
  base_stats: {
    lvl1: { hp: number; atk1: number; atk2: number }
    lvl30: { hp: number; atk1: number; atk2: number }
  }
  star: string
  skin: string
  image: string[]
}

function loadOverrides(): Record<string, Partial<SkinRecord>> {
  if (!fs.existsSync(OVERRIDES)) return {}
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES, 'utf-8'))
  } catch (e) {
    console.warn(`[overrides] cannot parse ${OVERRIDES}: ${(e as Error).message}`)
    return {}
  }
}

// Звезда скина из магазинных боксов (src/data/boxes.json, собран из
// shopitems.xml): <ArticleItem typeId="Specimen_DD_05"><Tag key="skin"
// value="spring"/><Tag key="stars" value="3"/> - для пары, которой нет в
// gacha.xml, это единственное прямое свидетельство звезды. Бонуса там нет, и
// его нет нигде: отдельного конфига скинов у игры не существует (проверен
// весь content_mb.csv), то есть у такой пары бонуса нет и в самом клиенте -
// скин чисто косметический, статы совпадают с базовым мутантом этой звезды.
const TIER_STARS: Record<string, number> = {
  обычный: 0,
  бронза: 1,
  серебро: 2,
  золото: 3,
  платина: 4,
}

function loadBoxSkinStars(): Map<string, number> {
  const out = new Map<string, number>()
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(path.join(REPO, 'src/data/boxes.json'), 'utf-8'))
  } catch {
    return out
  }
  const walk = (node: any): void => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v)
      return
    }
    if (!node || typeof node !== 'object') return
    const id = typeof node.id === 'string' ? node.id.toLowerCase() : ''
    const skin = typeof node.skin === 'string' ? node.skin.toLowerCase() : ''
    const stars = TIER_STARS[String(node.tier ?? '').toLowerCase()]
    if (id.startsWith('specimen_') && skin && stars !== undefined) {
      out.set(`${id.replace(/^specimen_/, '')}|${skin}`, stars)
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(data)
  return out
}

async function build() {
  const check = process.argv.includes('--check')

  const mutants = JSON.parse(fs.readFileSync(MUTANTS, 'utf-8')) as any[]
  const baseById = new Map<string, any>()
  for (const m of mutants) baseById.set(String(m.id).toLowerCase(), m)

  const boxSkinStars = loadBoxSkinStars()
  const gacha = parseGacha(await loadGacha())
  console.log(`[gacha] parsed ${gacha.size} (specimen, skin) entries`)

  if (!fs.existsSync(FULL_DIR)) {
    throw new Error(`Full-texture dir missing: ${FULL_DIR}. Run the character-texture build first.`)
  }
  const fullFiles = fs.readdirSync(FULL_DIR).filter((f) => /^FULL_.+\.png$/i.test(f))
  console.log(`[textures] ${fullFiles.length} full skin textures found`)

  const overrides = loadOverrides()
  const skins: SkinRecord[] = []
  const skipped: string[] = []

  for (const file of fullFiles) {
    const m = file.match(/^FULL_([a-z]+_\d+)_(.+)\.png$/i)
    if (!m) {
      skipped.push(`${file} (unparseable name)`)
      continue
    }
    const code = m[1].toLowerCase()
    const skin = m[2]

    let entry = gacha.get(`${code}|${skin}`)
    if (!entry) {
      // Бинго-доска знает пару "мутант+скин", которой в gacha.xml нет:
      // cyberweek у Kobojo записан на Specimen_EA_06 (Кранк), а доска "Скины
      // 2025" и реальный атлас (a_e_06_cyberweek.png на CDN игры) говорят про
      // Specimen_AE_06 (Марв) - см. skins_from_bingos() в
      // scripts/character-textures/sync_characters.py. Текстура у нас уже
      // отрендерена, значит скин настоящий; параметры берём из единственной
      // гача-строки этого скина - она задаёт звезду и бонус самого скина, а
      // ошибочен в ней только id мутанта. Если строк несколько и они
      // расходятся - не гадаем, пропускаем как раньше.
      const sameSkin = [...gacha.entries()].filter(([k, v]) => k.endsWith(`|${skin}`) && v.basic)
      const variants = new Set(sameSkin.map(([, v]) => `${v.stars}|${v.bonus}`))
      if (sameSkin.length > 0 && variants.size === 1) {
        entry = sameSkin[0][1]
        console.log(
          `[gacha-fallback] ${code}|${skin}: строки нет, беру параметры скина из ` +
            `${sameSkin.map(([k]) => k.split('|')[0]).join(',')} (stars=${entry.stars}, bonus=${entry.bonus})`,
        )
      } else {
        const boxStars = boxSkinStars.get(`${code}|${skin}`)
        if (boxStars !== undefined) {
          entry = { stars: boxStars, bonus: 0, basic: true }
          console.log(
            `[box-fallback] ${code}|${skin}: в gacha.xml пары нет, звезду беру из бокса ` +
              `(stars=${boxStars}), бонус 0 - у игры его тоже негде взять`,
          )
        } else {
          skipped.push(`${file} (no gacha entry for ${code}|${skin})`)
          continue
        }
      }
    }
    const base = baseById.get(`specimen_${code}`)
    if (!base) {
      skipped.push(`${file} (no base mutant specimen_${code})`)
      continue
    }

    const { stars, bonus } = entry

    // GACHA/HEROIC-мутанты существуют ТОЛЬКО в гача-форме: у них ровно одна
    // звезда, и она совпадает со звездой этой записи. Тогда "скин" - это сам
    // мутант, а не альтернатива: отдельная запись породила бы лишний
    // переключатель скина в модалке и сломала показ полной текстуры.
    const starKeys = Object.keys(base.stars ?? {})
    const starName = STAR_NAME[stars] ?? 'none'
    if (starKeys.length === 1 && starKeys[0] === starName) {
      skipped.push(`${file} (гача-форма самого мутанта, не отдельный скин)`)
      continue
    }

    const bs = base.base_stats
    const hp1 = calcHP(bs.hp_base, stars, bonus)
    const a11 = calcATK(bs.atk1_base, stars, bonus)
    const a21 = calcATK(bs.atk2_base, stars, bonus)

    const rec: SkinRecord = {
      id: `Specimen_${code.toUpperCase()}`,
      name: base.name,
      genes: base.genes,
      base_stats: {
        lvl1: { hp: hp1, atk1: a11, atk2: a21 },
        lvl30: {
          hp: scale(hp1, bs.lvl1.hp, bs.lvl30.hp),
          atk1: scale(a11, bs.lvl1.atk1, bs.lvl30.atk1),
          atk2: scale(a21, bs.lvl1.atk2, bs.lvl30.atk2),
        },
      },
      star: STAR_NAME[stars] ?? 'none',
      skin,
      image: [`${SKIN_BASE}/full/${file}`],
    }
    // Head/semi-full only enters image[] if the file actually exists, so the
    // modal never points at a missing thumbnail.
    const semiName = `specimen_${code}_${skin}.webp`
    if (fs.existsSync(path.join(SEMI_DIR, semiName))) {
      rec.image.push(`${SKIN_BASE}/semi-full/${semiName}`)
    }

    const ov = overrides[`${rec.id}|${skin}`]
    skins.push(ov ? { ...rec, ...ov } : rec)
  }

  skins.sort((a, b) => a.id.localeCompare(b.id) || a.skin.localeCompare(b.skin))

  if (skipped.length) {
    console.log(`[skipped] ${skipped.length} textures:`)
    for (const s of skipped.slice(0, 20)) console.log(`  - ${s}`)
    if (skipped.length > 20) console.log(`  ... +${skipped.length - 20} more`)
  }

  if (check) {
    diffAgainstCurrent(skins)
    console.log('\n[check] no file written (--check).')
    return
  }

  fs.writeFileSync(SKINS_OUT, JSON.stringify({ specimens: skins }, null, 2) + '\n', 'utf-8')
  console.log(`\n[write] ${skins.length} skins -> ${SKINS_OUT}`)
}

function diffAgainstCurrent(generated: SkinRecord[]) {
  const cur = JSON.parse(fs.readFileSync(SKINS_OUT, 'utf-8'))
  const curArr: any[] = cur.specimens ?? cur
  // Сопоставление старых записей с новыми. Раньше ключом было (id, star) -
  // это осталось со времён, когда имена скинов были рукописные и массово
  // правились по гаче. Но у одного мутанта бывает НЕСКОЛЬКО скинов одной
  // звезды, и такой ключ склеивал их между собой: отчёт каждый прогон писал
  // фантомные "ребалансы" вида (xinnian->halloween), хотя сверка по паре
  // (id, skin) показывает ноль изменений (найдено 2026-09-20).
  // Теперь основной ключ - (id, skin), а (id, star) остаётся вторым проходом
  // для честного случая переименования скина, и только среди ещё не занятых
  // записей.
  const curByIdSkin = new Map<string, any>()
  const curByIdStar = new Map<string, any[]>()
  for (const c of curArr) {
    curByIdSkin.set(`${c.id}|${c.skin}`, c)
    const bucket = curByIdStar.get(`${c.id}|${c.star}`) ?? []
    bucket.push(c)
    curByIdStar.set(`${c.id}|${c.star}`, bucket)
  }
  const usedCur = new Set<any>()
  const matchCurrent = (g: any) => {
    const exact = curByIdSkin.get(`${g.id}|${g.skin}`)
    if (exact && !usedCur.has(exact)) {
      usedCur.add(exact)
      return exact
    }
    // Запись старого файла годится как "переименованная" только если её
    // собственного скина в новой сборке нет - иначе её заберёт точный ключ.
    const renamed = (curByIdStar.get(`${g.id}|${g.star}`) ?? []).find(
      (c) => !usedCur.has(c) && !generatedSkins.has(`${g.id}|${c.skin}`),
    )
    if (renamed) {
      usedCur.add(renamed)
      return renamed
    }
    return undefined
  }

  let fullMatch = 0
  let lvl30Only = 0 // lvl1 identical, lvl30 differs (rounding noise / partial rebalance)
  let lvl1Diff = 0 // lvl1 differs -> genuine rebalance
  let nameChange = 0
  let newSkins = 0
  const rebal: string[] = []
  // Скины, которые есть в новой сборке: запись из старого файла с таким же
  // скином ниже нельзя считать "переименованной" - она найдётся точным ключом.
  const generatedSkins = new Set(generated.map((g: any) => `${g.id}|${g.skin}`))

  const eq = (a: any, b: any) => a.hp === b.hp && a.atk1 === b.atk1 && a.atk2 === b.atk2

  for (const g of generated) {
    const c = matchCurrent(g)
    if (!c) {
      newSkins++
      continue
    }
    const l1same = eq(c.base_stats.lvl1, g.base_stats.lvl1)
    const l30same = eq(c.base_stats.lvl30, g.base_stats.lvl30)
    if (l1same && l30same) fullMatch++
    else if (l1same) lvl30Only++
    else {
      lvl1Diff++
      if (rebal.length < 30)
        rebal.push(
          `  ${g.id} ${g.star} (${c.skin}->${g.skin})  lvl1 old ${JSON.stringify(c.base_stats.lvl1)} new ${JSON.stringify(g.base_stats.lvl1)}`,
        )
    }
    if (c.skin !== g.skin) nameChange++
  }

  const removed = curArr.filter((c) => !usedCur.has(c))

  console.log('\n=== DIFF vs current skins.json ===')
  console.log(`current entries : ${curArr.length}`)
  console.log(`generated       : ${generated.length}`)
  console.log(`FULL match (lvl1+lvl30 identical) : ${fullMatch}`)
  console.log(
    `lvl30-only delta (lvl1 identical) : ${lvl30Only}  (rounding / minor curve, cosmetic)`,
  )
  console.log(`lvl1 CHANGED (genuine rebalance)  : ${lvl1Diff}`)
  console.log(`name corrected  : ${nameChange}`)
  console.log(`NEW skins       : ${newSkins}`)
  console.log(`removed (in current, not generated): ${removed.length}`)
  if (rebal.length) {
    console.log('\n--- genuine rebalances (lvl1 changed, first 30) ---')
    for (const c of rebal) console.log(c)
  }
  if (removed.length) {
    console.log('\n--- removed (in current, no full texture) ---')
    for (const r of removed) console.log(`  ${r.id} ${r.skin} ${r.star}`)
  }
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
