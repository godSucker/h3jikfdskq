// Журнал PvP-сезонов (scripts/journals/pvp-seasons.jsonl) + додополнение
// src/data/guides/pvp-seasons.json (гайд, раньше вёлся только руками -
// коммиты 7aa46ace1/b3ae6204b/d3364d3b2 "подбор по датам"/"из телеграм-чата",
// оборван на сезоне 348) + obtain.json (мутант-награда сезона, формат
// "PVP: Сезон N" - уже есть у Дрея за сезоны 165/254/274/298, но не
// автоматизирован: detect-new-reactors.ts и соседи ловят ПЕРВЫЙ релиз мутанта
// в PvP (News_release_pvp_* в dailypopup.xml), не КАЖДОЕ его возвращение
// топ-наградой сезона).
//
// Источник - scripts/live-pvp-info.json (пишет scripts/kartel/fetch-pvp-info.py,
// см. его докстринг про находку команды getPvPInfo). Additive-only везде,
// как и остальной пайплайн: журнал пишется на КАЖДЫЙ прогон (даже без нового
// сезона - это видимость/дрейф ED со временем), гайд и obtain.json - только
// когда сезон реально новый.
import fs from 'node:fs/promises'
import path from 'node:path'
import { journalPath, readJson, appendJsonl } from './lib/journals'
import { runMain } from './lib/run-main'

const ROOT = process.cwd()
const LIVE_PATH = path.join(ROOT, 'scripts/live-pvp-info.json')
const GUIDE_PATH = path.join(ROOT, 'src/data/guides/pvp-seasons.json')
const OBTAIN_PATH = path.join(ROOT, 'src/data/mutants/obtain.json')
const MUTANTS_PATH = path.join(ROOT, 'src/data/mutants/mutants.json')
const JOURNAL_FILE = journalPath('pvp-seasons.jsonl')
const MAX_JOURNAL_LINES = 2000

interface LivePvpInfo {
  fetchedAt: string
  season: number | null
  endsAt: string | null
  pvpEnable: boolean
  rewardTiers: { tier: number; items: { amount: number; id: string }[] }[]
}

interface GuideEntry {
  season: number
  mutantId: string
}

type ObtainMap = Record<string, { type: string; where: string }[]>

async function main() {
  const info = await readJson<LivePvpInfo | null>(LIVE_PATH, null)
  if (!info || !info.season) {
    console.log(
      '[pvp-seasons] live-pvp-info.json нет или без сезона (fetch-pvp-info.py упал/пропущен) - пропуск',
    )
    return
  }

  const mutants = await readJson<{ id: string }[]>(MUTANTS_PATH, [])
  const knownIds = new Set(mutants.map((m) => m.id))

  const topTier = info.rewardTiers.reduce<LivePvpInfo['rewardTiers'][number] | null>(
    (best, t) => (!best || t.tier > best.tier ? t : best),
    null,
  )
  const topMutantRaw = topTier?.items.find((it) => /^specimen_/i.test(it.id))?.id
  // mutants.json ключуется строчным id (sync-mutants.ts), сырой id с сервера -
  // смешанного регистра ("Specimen_DE_11").
  const topMutantId =
    topMutantRaw && knownIds.has(topMutantRaw.toLowerCase()) ? topMutantRaw.toLowerCase() : null

  // 1. Журнал - каждый прогон, не только новые сезоны: видимость конца сезона
  // и дрейф ED нужны именно по серии наблюдений, не по разовым точкам.
  await appendJsonl(
    JOURNAL_FILE,
    [
      {
        seenAt: info.fetchedAt,
        season: info.season,
        endsAt: info.endsAt,
        pvpEnable: info.pvpEnable,
        topMutantId,
      },
    ],
    MAX_JOURNAL_LINES,
  )

  // 2. Гайд-список сезонов (additive-only, тот же формат {season, mutantId},
  // что уже вручную вели до сезона 348).
  const guide = await readJson<GuideEntry[]>(GUIDE_PATH, [])
  const guideHasSeason = guide.some((g) => g.season === info.season)
  if (!guideHasSeason && topMutantId) {
    guide.push({ season: info.season, mutantId: topMutantId })
    guide.sort((a, b) => b.season - a.season)
    await fs.writeFile(GUIDE_PATH, JSON.stringify(guide, null, 2) + '\n', 'utf-8')
    console.log(`[pvp-seasons] guides/pvp-seasons.json: сезон ${info.season} -> ${topMutantId}`)
  } else if (!guideHasSeason) {
    console.log(
      `[pvp-seasons] сезон ${info.season}: топ-тир без мутанта (только жетоны/золото) - в гайд не идёт`,
    )
  }

  // 3. obtain.json - источник получения ИМЕННО этого сезона, тот же формат,
  // что у ручных записей Дрея ("PVP: Сезон 165" и т.п.). Не только при новом
  // сезоне - идемпотентно на случай ретрая прошлого прогона.
  if (topMutantId) {
    const obtain = await readJson<ObtainMap>(OBTAIN_PATH, {})
    const entries = obtain[topMutantId] ?? []
    const where = `PVP: Сезон ${info.season}`
    if (!entries.some((e) => e.type === 'pvp' && e.where === where)) {
      obtain[topMutantId] = [...entries, { type: 'pvp', where }]
      await fs.writeFile(OBTAIN_PATH, JSON.stringify(obtain, null, 2) + '\n', 'utf-8')
      console.log(`[pvp-seasons] obtain.json: ${topMutantId} <- "${where}"`)
    }
  }
}

runMain(import.meta.url, 'pvp-seasons', main)
