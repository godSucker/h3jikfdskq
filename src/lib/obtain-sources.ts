import type { Locale } from './i18n'

// Названия источников получения мутанта (поле `type` в obtain.json) для
// фильтра "Источник" на /mutants.
//
// Зачем отдельно от фильтра "Тип": `type` у мутанта - это игровой тег из
// gamedefinitions.xml, и он рассказывает не то, что ждёт игрок. Пример: игра
// перестала помечать тегом PVP мутантов ПвП-сезонов примерно с 90-го сезона,
// поэтому под "Тип: ПВП" попадают 32 мутанта, хотя в ПвП выдавали 51. Тег
// трогать нельзя (на нём завязан расчёт рейтинга в парсере), поэтому "откуда
// мутант" - отдельное измерение, и считается оно по obtain.json.
//
// Формулировки намеренно совпадают со словарями obtain-render.ts и ключами
// src/i18n/*.json (nav.boxes, nav.bingo, nav.breeding,
// announcements.hall.jackpot, guides.tab.quests, announcements.category.raid),
// чтобы один и тот же источник назывался в карточке и в фильтре одинаково.

export const OBTAIN_SOURCE_LABEL: Record<string, Record<Locale, string>> = {
  pvp: {
    ru: 'PVP',
    en: 'PVP',
    es: 'PVP',
    fr: 'PVP',
    de: 'PVP',
    pt: 'PVP',
    it: 'PVP',
    tr: 'PVP',
    nl: 'PVP',
  },
  gacha: {
    ru: 'Реактор',
    en: 'Reactor',
    es: 'Reactor',
    fr: 'Réacteur',
    de: 'Reaktor',
    pt: 'Reator',
    it: 'Reattore',
    tr: 'Reaktör',
    nl: 'Reactor',
  },
  roulette: {
    ru: 'Рулетка',
    en: 'Roulette',
    es: 'Ruleta',
    fr: 'Roulette',
    de: 'Roulette',
    pt: 'Roleta',
    it: 'Roulette',
    tr: 'Rulet',
    nl: 'Roulette',
  },
  box: {
    ru: 'Боксы',
    en: 'Boxes',
    es: 'Cajas',
    fr: 'Boîtes',
    de: 'Boxen',
    pt: 'Caixas',
    it: 'Scatole',
    tr: 'Kutular',
    nl: 'Dozen',
  },
  bundle: {
    ru: 'Наборы',
    en: 'Bundles',
    es: 'Paquetes',
    fr: 'Packs',
    de: 'Pakete',
    pt: 'Pacotes',
    it: 'Pacchetti',
    tr: 'Paketler',
    nl: 'Pakketten',
  },
  gold_shop: {
    ru: 'Магазин за золото',
    en: 'Shop for gold',
    es: 'Tienda por oro',
    fr: 'Boutique contre or',
    de: 'Shop für Gold',
    pt: 'Loja por ouro',
    it: 'Negozio per oro',
    tr: 'Altınla mağaza',
    nl: 'Winkel voor goud',
  },
  credits_shop: {
    ru: 'Магазин за кредиты',
    en: 'Shop for silver/credits',
    es: 'Tienda por plata/créditos',
    fr: 'Boutique contre argent/crédits',
    de: 'Shop für Silber/Kredite',
    pt: 'Loja por prata/créditos',
    it: 'Negozio per argento/crediti',
    tr: 'Gümüş/kredi ile mağaza',
    nl: 'Winkel voor zilver/credits',
  },
  donate: {
    ru: 'Донат',
    en: 'Donation',
    es: 'Donación',
    fr: 'Don',
    de: 'Spende',
    pt: 'Doação',
    it: 'Donazione',
    tr: 'Bağış',
    nl: 'Donatie',
  },
  breeding: {
    ru: 'Скрещивание',
    en: 'Breeding',
    es: 'Cría',
    fr: 'Élevage',
    de: 'Zucht',
    pt: 'Reprodução',
    it: 'Allevamento',
    tr: 'Üreme',
    nl: 'Fokkerij',
  },
  breeding_duplicate: {
    ru: 'Скрещивание (только дубликат)',
    en: 'Breeding (duplicate only)',
    es: 'Cría (solo duplicado)',
    fr: 'Élevage (duplicata seulement)',
    de: 'Zucht (nur Duplikat)',
    pt: 'Reprodução (apenas duplicata)',
    it: 'Allevamento (solo duplicato)',
    tr: 'Üreme (yalnızca kopya)',
    nl: 'Fokkerij (alleen duplicaat)',
  },
  secret_breeding: {
    ru: 'Секретное скрещивание',
    en: 'Secret breeding',
    es: 'Cría secreta',
    fr: 'Élevage secret',
    de: 'Geheime Zucht',
    pt: 'Cria secreta',
    it: 'Incrocio segreto',
    tr: 'Gizli üretim',
    nl: 'Geheime fokkerij',
  },
  event_raid: {
    ru: 'Рейды',
    en: 'Raids',
    es: 'Incursiones',
    fr: 'Raids',
    de: 'Raids',
    pt: 'Raides',
    it: 'Raid',
    tr: 'Baskınlar',
    nl: 'Raids',
  },
  // Не тип obtain.json, а выделенная из event_raid часть - см. obtainSourceKey.
  event_ladder: {
    ru: 'Лесенки',
    en: 'Ladders',
    es: 'Escaleras',
    fr: 'Échelles',
    de: 'Leitern',
    pt: 'Escadas',
    it: 'Scale',
    tr: 'Merdivenler',
    nl: 'Ladders',
  },
  jackpot_hall: {
    ru: 'Обменный пункт',
    en: 'Exchange office',
    es: 'Oficina de cambio',
    fr: 'Bureau de change',
    de: 'Wechselstube',
    pt: 'Agência de câmbio',
    it: 'Ufficio cambi',
    tr: 'Döviz bürosu',
    nl: 'Wisselkantoor',
  },
  event_hall: {
    ru: 'Зал обмена (ивент)',
    en: 'Exchange Hall (event)',
    es: 'Sala de intercambio (evento)',
    fr: "Salle d'échange (événement)",
    de: 'Tauschhalle (Event)',
    pt: 'Sala de Troca (evento)',
    it: 'Sala scambi (evento)',
    tr: 'Değişim Salonu (etkinlik)',
    nl: 'Ruilhal (evenement)',
  },
  bingo: {
    ru: 'Бинго',
    en: 'Bingo',
    es: 'Bingo',
    fr: 'Bingo',
    de: 'Bingo',
    pt: 'Bingo',
    it: 'Bingo',
    tr: 'Bingo',
    nl: 'Bingo',
  },
  quest: {
    ru: 'Квесты',
    en: 'Quests',
    es: 'Misiones',
    fr: 'Quêtes',
    de: 'Quests',
    pt: 'Missões',
    it: 'Missioni',
    tr: 'Görevler',
    nl: 'Quests',
  },
  campaign: {
    ru: 'Кампания',
    en: 'Campaign',
    es: 'Campaña',
    fr: 'Campagne',
    de: 'Kampagne',
    pt: 'Campanha',
    it: 'Campagna',
    tr: 'Kampanya',
    nl: 'Campagne',
  },
  crossover: {
    ru: 'Кроссовер',
    en: 'Crossover',
    es: 'Crossover',
    fr: 'Crossover',
    de: 'Crossover',
    pt: 'Crossover',
    it: 'Crossover',
    tr: 'Crossover',
    nl: 'Crossover',
  },
  unavailable: {
    ru: 'Уже не получить',
    en: 'No longer obtainable',
    es: 'Ya no se puede obtener',
    fr: 'Plus disponible',
    de: 'Nicht mehr erhältlich',
    pt: 'Não disponível',
    it: 'Non più ottenibile',
    tr: 'Artık elde edilemiyor',
    nl: 'Niet meer verkrijgbaar',
  },
}

// Иконки источников. По возможности те же, что у строк "Как получить" в
// карточке мутанта (OBTAIN_ICON в MutantModal.svelte), чтобы один источник
// выглядел одинаково в фильтре и в карточке. Всё лежит на нашем CDN.
export const OBTAIN_SOURCE_ICON: Record<string, string> = {
  pvp: '/mut_icons/icon_pvp.webp',
  event_raid: '/etc/icon_atk.webp',
  // Тот же меч, что у рейдов, перекрашенный в синий - чтобы различать.
  event_ladder: '/etc/icon_atk_ladder.png',
  // Значок последнего дивизиона (Гига), скачан с Kobojo к нам на CDN.
  campaign: '/etc/division_6.png',
  gacha: '/mut_icons/icon_gacha.webp',
  roulette: '/sims/roulette.webp',
  bingo: '/etc/icon_bingo.webp',
  breeding: '/sims/larva.webp',
  breeding_duplicate: '/sims/larva.webp',
  secret_breeding: '/mut_icons/icon_recipe.webp',
  jackpot_hall: '/materials/Material_Jackpot_Token.png',
  event_hall: '/materials/Material_Event_Token.png',
  gold_shop: '/cash/hardcurrency.webp',
  credits_shop: '/cash/softcurrency.webp',
  bundle: '/quests/achievements/achivement_gift.png',
  box: '/boxes/lucky_box_1.png',
  donate: '/mut_icons/donate.png',
  quest: '/quests/story/quest_mutodex.png',
  crossover: '/mut_icons/limited.webp',
  unavailable: '/etc/icon_timer.webp',
}

// Порядок пунктов в выпадашке: по смыслу, а не по алфавиту (иначе, например,
// два обменника разъезжаются по разным концам списка). Группы разделяются
// линией. Источник, которого здесь нет (новый тип в obtain.json), уходит в
// конец списка.
export const OBTAIN_SOURCE_GROUPS: string[][] = [
  ['pvp', 'event_raid', 'event_ladder', 'campaign'],
  ['gacha', 'roulette', 'bingo'],
  ['breeding', 'breeding_duplicate', 'secret_breeding'],
  ['jackpot_hall', 'event_hall'],
  ['gold_shop', 'credits_shop', 'bundle', 'box', 'donate'],
  ['quest', 'crossover', 'unavailable'],
]

const SOURCE_POSITION = new Map<string, { group: number; index: number }>()
OBTAIN_SOURCE_GROUPS.forEach((group, g) =>
  group.forEach((type, i) => SOURCE_POSITION.set(type, { group: g, index: i })),
)

export function obtainSourceGroup(type: string): number {
  return SOURCE_POSITION.get(type)?.group ?? OBTAIN_SOURCE_GROUPS.length
}

export function compareObtainSources(a: string, b: string): number {
  const pa = SOURCE_POSITION.get(a)
  const pb = SOURCE_POSITION.get(b)
  if (pa && pb) return pa.group - pb.group || pa.index - pb.index
  if (pa) return -1
  if (pb) return 1
  return a.localeCompare(b)
}

// Путь отдаётся без CDN-префикса: вызывающий оборачивает в textureUrl()
// (см. .icon-property-паттерн в CLAUDE.md).
export function obtainSourceIcon(type: string): string | null {
  return OBTAIN_SOURCE_ICON[type] ?? null
}

// Ключ источника для записи obtain.json. Обычно это просто её тип, но рейды
// и лесенки в данных лежат под одним типом event_raid, а игроки ищут их
// порознь. Различаются они по тексту записи ("Рейд: ..." / "Лесенки: ...",
// включая "Лесенки: Яма: ...") - тот же признак, по которому их различает
// renderObtainWhere в obtain-render.ts.
export function obtainSourceKey(record: { type?: string; where?: string }): string | undefined {
  if (record.type === 'event_raid' && record.where?.startsWith('Лесенки')) return 'event_ladder'
  return record.type
}

// Незнакомый источник (новый тип в obtain.json) не прячем - показываем ключ
// как есть, чтобы фильтр не начал тихо терять мутантов.
export function obtainSourceLabelL(type: string, locale: Locale = 'ru'): string {
  return OBTAIN_SOURCE_LABEL[type]?.[locale] ?? OBTAIN_SOURCE_LABEL[type]?.ru ?? type
}
