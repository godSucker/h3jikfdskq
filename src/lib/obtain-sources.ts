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
    ru: 'ПвП',
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
    ru: 'Рейды и лесенки',
    en: 'Raids and ladders',
    es: 'Incursiones y escaleras',
    fr: 'Raids et échelles',
    de: 'Raids und Leitern',
    pt: 'Raides e escadas',
    it: 'Raid e scale',
    tr: 'Baskınlar ve merdivenler',
    nl: 'Raids en ladders',
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

// Иконки источников. Всё из уже залитых на CDN ассетов игры: отдельной
// отрисовки не потребовалось, проверено curl'ом (все 19 отдают 200).
// Подбор под размер 20px в дропдауне - изометрические здания и детальные
// ачивки на этом размере превращаются в кашу, поэтому взяты плоские
// символьные иконки.
export const OBTAIN_SOURCE_ICON: Record<string, string> = {
  pvp: '/mut_icons/icon_pvp.webp',
  gacha: '/mut_icons/icon_gacha.webp',
  roulette: '/sims/roulette.webp',
  box: '/boxes/lucky_box_1.png',
  bundle: '/quests/achievements/achivement_gift.png',
  gold_shop: '/cash/hardcurrency.webp',
  credits_shop: '/cash/softcurrency.webp',
  donate: '/mut_icons/donate.png',
  breeding: '/sims/larva.webp',
  breeding_duplicate: '/quests/achievements/achivement_duplicate.png',
  secret_breeding: '/mut_icons/icon_recipe.webp',
  event_raid: '/mut_icons/icon_seasonal.webp',
  event_hall: '/tokens/material_event_token.webp',
  jackpot_hall: '/cash/jackpot.webp',
  bingo: '/etc/icon_bingo.webp',
  quest: '/quests/story/quest_mutodex.png',
  campaign: '/quests/story/quest_pve_d.png',
  crossover: '/mut_icons/icon_videogame.webp',
  unavailable: '/mut_icons/limited.webp',
}

// Путь отдаётся без CDN-префикса: вызывающий оборачивает в textureUrl()
// (см. .icon-property-паттерн в CLAUDE.md).
export function obtainSourceIcon(type: string): string | null {
  return OBTAIN_SOURCE_ICON[type] ?? null
}

// Незнакомый источник (новый тип в obtain.json) не прячем - показываем ключ
// как есть, чтобы фильтр не начал тихо терять мутантов.
export function obtainSourceLabelL(type: string, locale: Locale = 'ru'): string {
  return OBTAIN_SOURCE_LABEL[type]?.[locale] ?? OBTAIN_SOURCE_LABEL[type]?.ru ?? type
}
