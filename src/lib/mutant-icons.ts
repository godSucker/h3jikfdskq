export const STAR_MULTIPLIERS: Record<string, number> = {
  normal: 1.0,
  bronze: 1.1,
  silver: 1.3,
  gold: 1.75,
  platinum: 2.0,
}

export const STAR_ICONS: Record<string, string> = {
  normal: '/stars/no_stars.webp',
  bronze: '/stars/star_bronze.webp',
  silver: '/stars/star_silver.webp',
  gold: '/stars/star_gold.webp',
  platinum: '/stars/star_platinum.webp',
}

export const STAR_KEYS = ['normal', 'bronze', 'silver', 'gold', 'platinum'] as const
export type StarKey = (typeof STAR_KEYS)[number]

export const STAR_IMAGE_KEYWORDS: Record<string, string[]> = {
  normal: ['_normal', 'normal'],
  bronze: ['_bronze', 'bronze'],
  silver: ['_silver', 'silver'],
  gold: ['_gold', 'gold'],
  platinum: ['_platinum', '_plat', 'platinum', 'plat'],
}

export const GENE_NAMES: Record<string, string> = {
  A: 'Киборг',
  B: 'Нежить',
  C: 'Рубака',
  D: 'Зверь',
  E: 'Галактик',
  F: 'Мифик',
}

export const GENE_ICONS: Record<string, string> = {
  '': '/genes/gene_all.webp',
  a: '/genes/gene_a.webp',
  b: '/genes/gene_b.webp',
  c: '/genes/gene_c.webp',
  d: '/genes/gene_d.webp',
  e: '/genes/gene_e.webp',
  f: '/genes/gene_f.webp',
  neutro: '/genes/gene_all.webp',
  neutral: '/genes/gene_all.webp',
  none: '/genes/gene_all.webp',
  all: '/genes/gene_all.webp',
  A: '/genes/gene_a.webp',
  B: '/genes/gene_b.webp',
  C: '/genes/gene_c.webp',
  D: '/genes/gene_d.webp',
  E: '/genes/gene_e.webp',
  F: '/genes/gene_f.webp',
}

export function getGeneIcon(code?: string | null): string | null {
  if (!code) return null
  const k = String(code).trim().toLowerCase()
  if (k === 'neutral' || k === 'none' || k === 'all') return GENE_ICONS.neutro
  return GENE_ICONS[k] ?? null
}

export const TYPE_ICONS: Record<string, string> = {
  default: '/mut_icons/icon_special.webp',
  special: '/mut_icons/icon_special.webp',
  heroic: '/mut_icons/icon_heroic.webp',
  legend: '/mut_icons/icon_legendary.webp',
  legends: '/mut_icons/icon_legendary.webp',
  legendary: '/mut_icons/icon_legendary.webp',
  gacha: '/mut_icons/icon_gacha.webp',
  reactor: '/mut_icons/icon_gacha.webp',
  pvp: '/mut_icons/icon_pvp.webp',
  seasonal: '/mut_icons/icon_seasonal.webp',
  recipe: '/mut_icons/icon_recipe.webp',
  videogame: '/mut_icons/icon_videogame.webp',
  video_game: '/mut_icons/icon_videogame.webp',
  morphology: '/mut_icons/icon_morphology.webp',
  zodiac: '/mut_icons/icon_zodiac.webp',
  limited: '/mut_icons/limited.webp',
  community: '/mut_icons/icon_special.webp',
  реактор: '/mut_icons/icon_gacha.webp',
}

export function getTypeIcon(type?: string | null): string | null {
  const t = String(type ?? '').toLowerCase()
  if (!t || t === 'default') return '/mut_icons/icon_morphology.webp'
  if (t === 'legend') return '/mut_icons/icon_legendary.webp'
  if (t === 'recipe') return '/mut_icons/icon_recipe.webp'
  if (t === 'community') return '/mut_icons/icon_special.webp'
  return TYPE_ICONS[t] ?? `/mut_icons/icon_${t}.webp`
}

// Реальные фоны профиля мутанта из игры (extract из APK, assets/mobile/hud/m_m_m/
// profil_bg_*.png - "m_m_m" = "My Mutant Modal" по контексту, тот самый экран
// карточки одного мутанта). SPECIAL и COMMUNITY - буквально один и тот же файл
// в игре (community-тип всего у одного мутанта, "Мастер Лапа" - разработчик не
// стал рисовать отдельный фон под один экземпляр), поэтому оба ключа указывают
// на profil_bg_captainpeace.webp, дублировать байты не нужно.
export const TYPE_BACKGROUNDS: Record<string, string> = {
  default: '/mut_backgrounds/profil_bg_normal.webp',
  special: '/mut_backgrounds/profil_bg_captainpeace.webp',
  community: '/mut_backgrounds/profil_bg_captainpeace.webp',
  heroic: '/mut_backgrounds/profil_bg_heroic.webp',
  legend: '/mut_backgrounds/profil_bg_legend.webp',
  legends: '/mut_backgrounds/profil_bg_legend.webp',
  legendary: '/mut_backgrounds/profil_bg_legend.webp',
  gacha: '/mut_backgrounds/profil_bg_gacha.webp',
  reactor: '/mut_backgrounds/profil_bg_gacha.webp',
  pvp: '/mut_backgrounds/profil_bg_pvp.webp',
  seasonal: '/mut_backgrounds/profil_bg_seasonal.webp',
  recipe: '/mut_backgrounds/profil_bg_recipe.webp',
  videogame: '/mut_backgrounds/profil_bg_videogame.webp',
  video_game: '/mut_backgrounds/profil_bg_videogame.webp',
  zodiac: '/mut_backgrounds/profil_bg_zodiac.webp',
  реактор: '/mut_backgrounds/profil_bg_gacha.webp',
}

export function getTypeBackground(type?: string | null): string {
  const t = String(type ?? '').toLowerCase()
  return TYPE_BACKGROUNDS[t] ?? TYPE_BACKGROUNDS.default
}

export const STAT_ICONS: Record<string, string> = {
  hp: '/etc/icon_hp.webp',
  atk: '/etc/icon_atk.webp',
  speed: '/etc/icon_speed.webp',
}

export const ABILITY_ICONS: Record<string, string> = {
  weaken: '/ability/ability_weaken.webp',
  curse: '/ability/ability_weaken.webp',
  strengthen: '/ability/ability_strengthen.webp',
  buff: '/ability/ability_strengthen.webp',
  slash: '/ability/ability_slash.webp',
  wound: '/ability/ability_slash.webp',
  bleed: '/ability/ability_slash.webp',
  shield: '/ability/ability_shield.webp',
  protect: '/ability/ability_shield.webp',
  retaliate: '/ability/ability_retaliate.webp',
  counter: '/ability/ability_retaliate.webp',
  regenerate: '/ability/ability_regenerate.webp',
  lifesteal: '/ability/ability_regenerate.webp',
  life_drain: '/ability/ability_regenerate.webp',
  drain: '/ability/ability_regenerate.webp',
  regen: '/ability/ability_regenerate.webp',
}

export const ABILITY_ALIASES: Record<string, string> = {
  проклятие: 'weaken',
  усиление: 'strengthen',
  рана: 'slash',
  кровотечение: 'slash',
  щит: 'shield',
  отражение: 'retaliate',
  'вытягивание жизни': 'regenerate',
  регенерация: 'regenerate',
}

export type StarSwitcherItem = { key: StarKey; icon: string; label: string }

export const STAR_SWITCHER_MUTANTS: StarSwitcherItem[] = [
  { key: 'normal', icon: '/stars/no_stars.webp', label: 'Обычные' },
  { key: 'bronze', icon: '/stars/star_bronze.webp', label: 'Бронза' },
  { key: 'silver', icon: '/stars/star_silver.webp', label: 'Серебро' },
  { key: 'gold', icon: '/stars/star_gold.webp', label: 'Золото' },
  { key: 'platinum', icon: '/stars/star_platinum.webp', label: 'Платина' },
]

export type SkinStarKey = 'any' | StarKey
export type StarSwitcherSkinsItem = { key: SkinStarKey; icon?: string; label: string }

export const STAR_SWITCHER_SKINS: StarSwitcherSkinsItem[] = [
  { key: 'any', label: 'Все' },
  { key: 'normal', icon: '/stars/no_stars.webp', label: 'Обычные' },
  { key: 'bronze', icon: '/stars/star_bronze.webp', label: 'Бронза' },
  { key: 'silver', icon: '/stars/star_silver.webp', label: 'Серебро' },
  { key: 'gold', icon: '/stars/star_gold.webp', label: 'Золото' },
  { key: 'platinum', icon: '/stars/star_platinum.webp', label: 'Платина' },
]
