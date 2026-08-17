// Вынесено из [gachaId].astro (2026-08-15) при переводе /simulators/reactor
// на 9 локалей: getStaticPaths() должна жить в каждом файле страницы (Astro
// не позволяет реэкспортировать её из компонента), но сама логика (апгрейд
// текстуры до FULL-версии, сборка props) одна и та же для всех 9 языков —
// различается только вызов getGachaMeta(id, locale) внутри listGachas(locale)
// (локализованная обложка реактора, см. gacha-covers-i18n.json).
import fs from 'node:fs'
import path from 'node:path'
import { listGachas } from './reactor-gacha'
import { getMutantTexture, getSkinTextures } from './mutant-textures'
import type { Locale } from './i18n-locales'

const PUB = path.join(process.cwd(), 'public')
const exists = (rel: string) => fs.existsSync(path.join(PUB, rel.replace(/^\//, '')))

function upgradeToFull(specimenId: string, texture: string | null): string | null {
  const code = String(specimenId)
    .replace(/^Specimen_/i, '')
    .toLowerCase()

  if (texture) {
    const m = texture.match(/\/semi-full\/specimen_(.+)\.webp$/)
    if (m) {
      const full = `/textures_by_skins/textures_by_skin/full/FULL_${m[1]}.png`
      if (exists(full)) return full
    }
    if (texture.includes('/full/FULL_')) return texture
  }

  const mutantFull = `/textures_by_mutant/${code}/FULL_${code}.png`
  if (exists(mutantFull)) return mutantFull

  return texture
}

export function buildReactorStaticPaths(locale: Locale) {
  return listGachas(locale)
    .filter((gacha): gacha is NonNullable<typeof gacha> => gacha !== null)
    .map((gacha) => {
      const baseIds = gacha.basic_elements.map((reward) => reward.specimen)
      const baseTextures = getSkinTextures(baseIds)
      for (const id of baseIds) {
        baseTextures[id] = upgradeToFull(id, baseTextures[id])
      }
      const completionTexture = gacha.completion_reward
        ? upgradeToFull(
            gacha.completion_reward.specimen,
            getMutantTexture(gacha.completion_reward.specimen),
          )
        : null

      return {
        params: { gachaId: gacha.id },
        props: { gacha, baseTextures, completionTexture },
      }
    })
}
