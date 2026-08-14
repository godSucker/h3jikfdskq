// Батч 11 (3): пересборка obtain.json's "where" на целевую локаль для
// bundle/box записей. НЕ простая подмена всей строки резолвленным по itemId
// именем - "where" состоит из трёх частей: префикс-лейбл ("Набор:"/
// "Лаки-бокс:"/"Мистери-бокс:"), имя товара (резолвится по itemId через
// obtain-names.{lang}.json) и суффикс-модификатор (цена/тир/скин - НЕ имя
// товара, а метаданные конкретной записи, добавленные куратором поверх
// официального названия). Замена всей строки на голое resolved-имя теряла
// суффикс целиком - "Лаки-бокс: Контейнер новичка (бронза)"/"(серебро)"/
// "(золото)"/"(платина)" превращались в 4 неразличимых "Mystery-Box Starter"
// (баг найден живым тестом 2026-08-14, до фикса).
//
// Собрано по live-данным obtain.json: суффиксов всего 6 закрытых паттернов
// (N золота/N серебра/от $N.NN/голый тир/N★+скин/N★ или скин по отдельности) -
// не открытый список произвольного текста, чем и оправдан разбор регулярками
// вместо LLM.

import type { Locale } from './i18n'
import { STAR_DICT, STAR_LABEL, BINGO_RU, bingoLabelL } from './mutant-dicts'
import mutants from '@/data/mutants/mutants.json'

const PREFIX_DICT: Record<string, Partial<Record<Locale, string>>> = {
  Набор: {
    en: 'Bundle',
    es: 'Paquete',
    fr: 'Pack',
    de: 'Paket',
    pt: 'Pacote',
    it: 'Pacchetto',
    tr: 'Paket',
    nl: 'Pakket',
  },
  'Лаки-бокс': {
    en: 'Lucky Box',
    es: 'Caja de la suerte',
    fr: 'Boîte chanceuse',
    de: 'Glücksbox',
    pt: 'Caixa da Sorte',
    it: 'Scatola fortunata',
    tr: 'Şanslı Kutu',
    nl: 'Geluksdoos',
  },
  'Мистери-бокс': {
    en: 'Mystery Box',
    es: 'Caja misteriosa',
    fr: 'Boîte mystère',
    de: 'Mysterybox',
    pt: 'Caixa Misteriosa',
    it: 'Scatola misteriosa',
    tr: 'Gizem Kutusu',
    nl: 'Mysteriedoos',
  },
}

const CURRENCY_DICT: Record<'gold' | 'silver' | 'credits', Partial<Record<Locale, string>>> = {
  gold: {
    en: 'gold',
    es: 'oro',
    fr: 'or',
    de: 'Gold',
    pt: 'ouro',
    it: 'oro',
    tr: 'altın',
    nl: 'goud',
  },
  silver: {
    en: 'silver',
    es: 'plata',
    fr: 'argent',
    de: 'Silber',
    pt: 'prata',
    it: 'argento',
    tr: 'gümüş',
    nl: 'zilver',
  },
  credits: {
    en: 'silver/credits',
    es: 'plata/créditos',
    fr: 'argent/crédits',
    de: 'Silber/Kredite',
    pt: 'prata/créditos',
    it: 'argento/crediti',
    tr: 'gümüş/kredi',
    nl: 'zilver/credits',
  },
}

// gold_shop/credits_shop: "версия: {прилагательное}" - прилагательная форма
// тира, не существительная (STAR_LABEL). Ключи - те же, что в STAR_DICT.
const TIER_ADJ_TO_KEY: Record<string, string> = {
  обычный: 'normal', бронзовый: 'bronze', серебряный: 'silver', золотой: 'gold', платиновый: 'platinum',
}

const SHOP_TEMPLATE: Partial<Record<Locale, string>> = {
  en: 'Shop for {n} {currency} ({tier})',
  es: 'Tienda por {n} de {currency} ({tier})',
  fr: 'Boutique pour {n} {currency} ({tier})',
  de: 'Shop für {n} {currency} ({tier})',
  pt: 'Loja por {n} de {currency} ({tier})',
  it: 'Negozio per {n} {currency} ({tier})',
  tr: '{n} {currency} karşılığında mağaza ({tier})',
  nl: 'Winkel voor {n} {currency} ({tier})',
}

const PVP_TEMPLATE: Partial<Record<Locale, string>> = {
  en: 'PVP: Season {n}',
  es: 'PVP: Temporada {n}',
  fr: 'PVP : Saison {n}',
  de: 'PVP: Saison {n}',
  pt: 'PVP: Temporada {n}',
  it: 'PVP: Stagione {n}',
  tr: 'PVP: Sezon {n}',
  nl: 'PVP: Seizoen {n}',
}

// Зал обмена: "N {описание жетонов}". Закрытый список - 10 уникальных
// описаний на живых данных (см. Батч 11 (3)), не открытый текст.
const EXCHANGE_HALL_LABEL: Partial<Record<Locale, string>> = {
  en: 'Exchange Hall', es: 'Sala de intercambio', fr: "Salle d'échange",
  de: 'Tauschhalle', pt: 'Sala de Troca', it: 'Sala scambi', tr: 'Değişim Salonu', nl: 'Ruilhal',
}
const EXCHANGE_TOKEN_DESC: Record<string, Partial<Record<Locale, string>>> = {
  'жетонов Hexcity': { en: 'Hexcity tokens', es: 'fichas de Hexcity', fr: 'jetons Hexcity', de: 'Hexcity-Marken', pt: 'fichas Hexcity', it: 'gettoni Hexcity', tr: 'Hexcity jetonu', nl: 'Hexcity-tokens' },
  'новогодних жетонов 2025': { en: 'New Year tokens 2025', es: 'fichas de Año Nuevo 2025', fr: "jetons du Nouvel An 2025", de: 'Neujahrsmarken 2025', pt: 'fichas de Ano Novo 2025', it: "gettoni di Capodanno 2025", tr: '2025 Yılbaşı jetonu', nl: 'Nieuwjaarstokens 2025' },
  'новогодних жетонов 2024': { en: 'New Year tokens 2024', es: 'fichas de Año Nuevo 2024', fr: "jetons du Nouvel An 2024", de: 'Neujahrsmarken 2024', pt: 'fichas de Ano Novo 2024', it: "gettoni di Capodanno 2024", tr: '2024 Yılbaşı jetonu', nl: 'Nieuwjaarstokens 2024' },
  'зимнего угля': { en: 'winter coal', es: 'carbón de invierno', fr: "charbon d'hiver", de: 'Winterkohle', pt: 'carvão de inverno', it: 'carbone invernale', tr: 'kış kömürü', nl: 'winterkolen' },
  'зимних апельсинов': { en: 'winter oranges', es: 'naranjas de invierno', fr: "oranges d'hiver", de: 'Winterorangen', pt: 'laranjas de inverno', it: 'arance invernali', tr: 'kış portakalı', nl: 'wintersinaasappels' },
  'жетонов джекпота': { en: 'jackpot tokens', es: 'fichas de bote', fr: 'jetons jackpot', de: 'Jackpot-Marken', pt: 'fichas de jackpot', it: 'gettoni jackpot', tr: 'jackpot jetonu', nl: 'jackpot-tokens' },
  'жетонов капсул': { en: 'capsule tokens', es: 'fichas de cápsula', fr: 'jetons capsule', de: 'Kapsel-Marken', pt: 'fichas de cápsula', it: 'gettoni capsula', tr: 'kapsül jetonu', nl: 'capsuletokens' },
  'жетонов игрушек': { en: 'toy tokens', es: 'fichas de juguete', fr: 'jetons jouet', de: 'Spielzeug-Marken', pt: 'fichas de brinquedo', it: 'gettoni giocattolo', tr: 'oyuncak jetonu', nl: 'speelgoedtokens' },
  'пасхальных жетонов 2026': { en: 'Easter tokens 2026', es: 'fichas de Pascua 2026', fr: 'jetons de Pâques 2026', de: 'OsterMarken 2026', pt: 'fichas de Páscoa 2026', it: 'gettoni di Pasqua 2026', tr: '2026 Paskalya jetonu', nl: 'Paastokens 2026' },
  'жетонов ивента': { en: 'event tokens', es: 'fichas de evento', fr: "jetons d'événement", de: 'Event-Marken', pt: 'fichas de evento', it: 'gettoni evento', tr: 'etkinlik jetonu', nl: 'evenemententokens' },
}

const SECRET_BREEDING_LABEL: Partial<Record<Locale, string>> = {
  en: 'Secret breeding', es: 'Cría secreta', fr: 'Élevage secret',
  de: 'Geheime Zucht', pt: 'Cria secreta', it: 'Incrocio segreto', tr: 'Gizli üretim', nl: 'Geheime fokkerij',
}

const ROULETTE_LABEL: Partial<Record<Locale, string>> = {
  en: 'Roulette', es: 'Ruleta', fr: 'Roulette',
  de: 'Roulette', pt: 'Roleta', it: 'Roulette', tr: 'Rulet', nl: 'Roulette',
}

const BINGO_REWARD_LABEL: Partial<Record<Locale, string>> = {
  en: 'Bingo reward', es: 'Recompensa de bingo', fr: 'Récompense bingo',
  de: 'Bingo-Belohnung', pt: 'Recompensa de bingo', it: 'Ricompensa bingo', tr: 'Bingo ödülü', nl: 'Bingobeloning',
}

const QUEST_LABEL: Partial<Record<Locale, string>> = {
  en: 'Quest', es: 'Misión', fr: 'Quête',
  de: 'Quest', pt: 'Missão', it: 'Missione', tr: 'Görev', nl: 'Quest',
}

const DIVISION_LABEL: Partial<Record<Locale, string>> = {
  en: 'Division', es: 'División', fr: 'Division',
  de: 'Division', pt: 'Divisão', it: 'Divisione', tr: 'Bölüm', nl: 'Divisie',
}
const DIVISION_NAME_DICT: Record<string, Partial<Record<Locale, string>>> = {
  Альфа: { en: 'Alpha', es: 'Alfa', fr: 'Alpha', de: 'Alpha', pt: 'Alfa', it: 'Alfa', tr: 'Alfa', nl: 'Alpha' },
  Бета: { en: 'Beta', es: 'Beta', fr: 'Bêta', de: 'Beta', pt: 'Beta', it: 'Beta', tr: 'Beta', nl: 'Bèta' },
  Гига: { en: 'Giga', es: 'Giga', fr: 'Giga', de: 'Giga', pt: 'Giga', it: 'Giga', tr: 'Giga', nl: 'Giga' },
  Омега: { en: 'Omega', es: 'Omega', fr: 'Oméga', de: 'Omega', pt: 'Ômega', it: 'Omega', tr: 'Omega', nl: 'Omega' },
}
// Названия локаций дивизий - авторский текст сайта (не игровые данные),
// переведён вручную (4 записи).
const DIVISION_LOCATION_DICT: Record<string, Partial<Record<Locale, string>>> = {
  Детройт: { en: 'Detroit', es: 'Detroit', fr: 'Détroit', de: 'Detroit', pt: 'Detroit', it: 'Detroit', tr: 'Detroit', nl: 'Detroit' },
  'Безымянные руины': { en: 'Unnamed Ruins', es: 'Ruinas sin nombre', fr: 'Ruines sans nom', de: 'Namenlose Ruinen', pt: 'Ruínas sem nome', it: 'Rovine senza nome', tr: 'İsimsiz Harabeler', nl: 'Naamloze Ruïnes' },
  'Новый Нью-Дели': { en: 'New New Delhi', es: 'Nueva Nueva Delhi', fr: 'Nouvelle New Delhi', de: 'Neu-Neu-Delhi', pt: 'Nova Nova Delhi', it: 'Nuova Nuova Delhi', tr: 'Yeni Yeni Delhi', nl: 'Nieuw New Delhi' },
}

// Квесты/кроссоверы - куратор-авторский текст сайта (не игровые данные),
// маленький закрытый набор (6+4), переведён вручную одним разом.
const QUEST_TEXT_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Желтые усилители!': { en: 'Yellow boosters!', es: '¡Potenciadores amarillos!', fr: 'Boosters jaunes !', de: 'Gelbe Booster!', pt: 'Reforços amarelos!', it: 'Potenziatori gialli!', tr: 'Sarı güçlendiriciler!', nl: 'Gele boosters!' },
  'Зима пришла!': { en: 'Winter has come!', es: '¡Llegó el invierno!', fr: "L'hiver est arrivé !", de: 'Der Winter ist da!', pt: 'O inverno chegou!', it: "L'inverno è arrivato!", tr: 'Kış geldi!', nl: 'De winter is gekomen!' },
  'Охоться на этих кроликов!': { en: 'Hunt these rabbits!', es: '¡Caza a estos conejos!', fr: 'Chassez ces lapins !', de: 'Jage diese Hasen!', pt: 'Caçe estes coelhos!', it: 'Dai la caccia a questi conigli!', tr: 'Bu tavşanları avla!', nl: 'Jaag op deze konijnen!' },
  'Синие усилители!': { en: 'Blue boosters!', es: '¡Potenciadores azules!', fr: 'Boosters bleus !', de: 'Blaue Booster!', pt: 'Reforços azuis!', it: 'Potenziatori blu!', tr: 'Mavi güçlendiriciler!', nl: 'Blauwe boosters!' },
  Фиолетовые: { en: 'Purple ones', es: 'Los morados', fr: 'Les violets', de: 'Die Lila', pt: 'Os roxos', it: 'I viola', tr: 'Morlar', nl: 'De paarse' },
  'Фиолетовые усилители!': { en: 'Purple boosters!', es: '¡Potenciadores morados!', fr: 'Boosters violets !', de: 'Lila Booster!', pt: 'Reforços roxos!', it: 'Potenziatori viola!', tr: 'Mor güçlendiriciler!', nl: 'Paarse boosters!' },
}
const CROSSOVER_TEXT_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Кроссовер — награда за 23 уровень в Primal Legends, уже не получить': {
    en: 'Crossover - level 23 reward in Primal Legends, no longer obtainable',
    es: 'Crossover: recompensa del nivel 23 en Primal Legends, ya no se puede obtener',
    fr: 'Crossover - récompense du niveau 23 dans Primal Legends, plus disponible',
    de: 'Crossover - Belohnung für Level 23 in Primal Legends, nicht mehr erhältlich',
    pt: 'Crossover - recompensa do nível 23 em Primal Legends, não disponível',
    it: 'Crossover - ricompensa livello 23 in Primal Legends, non più ottenibile',
    tr: "Crossover - Primal Legends'de 23. seviye ödülü, artık elde edilemiyor",
    nl: 'Crossover - level 23-beloning in Primal Legends, niet meer verkrijgbaar',
  },
  'Кроссовер — победа над боссом Нимродом на стадии Babel Tower в Celsius Heroes (Celsius Online), уже не получить': {
    en: 'Crossover - defeating boss Nimrod at the Babel Tower stage in Celsius Heroes (Celsius Online), no longer obtainable',
    es: 'Crossover: derrotar al jefe Nimrod en la etapa Babel Tower de Celsius Heroes (Celsius Online), ya no se puede obtener',
    fr: 'Crossover - vaincre le boss Nimrod au stade Babel Tower dans Celsius Heroes (Celsius Online), plus disponible',
    de: 'Crossover - Sieg über Boss Nimrod in der Babel-Tower-Stufe in Celsius Heroes (Celsius Online), nicht mehr erhältlich',
    pt: 'Crossover - derrotar o chefe Nimrod no estágio Babel Tower em Celsius Heroes (Celsius Online), não disponível',
    it: 'Crossover - sconfitta del boss Nimrod nella fase Babel Tower in Celsius Heroes (Celsius Online), non più ottenibile',
    tr: "Crossover - Celsius Heroes'de (Celsius Online) Babel Tower aşamasında Nimrod patronunu yenmek, artık elde edilemiyor",
    nl: 'Crossover - baas Nimrod verslaan in de Babel Tower-fase in Celsius Heroes (Celsius Online), niet meer verkrijgbaar',
  },
  'Кроссовер — получить через игру Mutants: Genesis в Steam': {
    en: 'Crossover - obtainable via the game Mutants: Genesis on Steam',
    es: 'Crossover: se obtiene a través del juego Mutants: Genesis en Steam',
    fr: 'Crossover - à obtenir via le jeu Mutants: Genesis sur Steam',
    de: 'Crossover - erhältlich über das Spiel Mutants: Genesis auf Steam',
    pt: 'Crossover - obtido através do jogo Mutants: Genesis na Steam',
    it: 'Crossover - ottenibile tramite il gioco Mutants: Genesis su Steam',
    tr: "Crossover - Steam'deki Mutants: Genesis oyunu üzerinden elde edilir",
    nl: 'Crossover - verkrijgbaar via de game Mutants: Genesis op Steam',
  },
  'Кроссовер — прогресс до локации Asyrith Mines в Celsius Heroes (Celsius Online), уже не получить': {
    en: 'Crossover - progress to the Asyrith Mines location in Celsius Heroes (Celsius Online), no longer obtainable',
    es: 'Crossover: progreso hasta la ubicación Asyrith Mines en Celsius Heroes (Celsius Online), ya no se puede obtener',
    fr: "Crossover - progression jusqu'au lieu Asyrith Mines dans Celsius Heroes (Celsius Online), plus disponible",
    de: 'Crossover - Fortschritt bis zum Ort Asyrith Mines in Celsius Heroes (Celsius Online), nicht mehr erhältlich',
    pt: 'Crossover - progresso até o local Asyrith Mines em Celsius Heroes (Celsius Online), não disponível',
    it: 'Crossover - progressione fino alla location Asyrith Mines in Celsius Heroes (Celsius Online), non più ottenibile',
    tr: "Crossover - Celsius Heroes'de (Celsius Online) Asyrith Mines konumuna ilerleme, artık elde edilemiyor",
    nl: 'Crossover - voortgang naar de Asyrith Mines-locatie in Celsius Heroes (Celsius Online), niet meer verkrijgbaar',
  },
}

const DONATE_LABEL: Partial<Record<Locale, string>> = {
  en: 'Donation - starter pack', es: 'Donación: paquete inicial', fr: 'Don - pack de démarrage',
  de: 'Spende - Starterpaket', pt: 'Doação - pacote inicial', it: 'Donazione - pacchetto iniziale', tr: 'Bağış - başlangıç paketi', nl: 'Donatie - startpakket',
}

const STATIC_STRING_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Скрещивание — можно вывести': {
    en: 'Breeding - can be bred', es: 'Cría: se puede criar', fr: 'Élevage - peut être élevé',
    de: 'Zucht - kann gezüchtet werden', pt: 'Cria - pode ser criado', it: 'Incrocio - può essere allevato', tr: 'Üretim - üretilebilir', nl: 'Fokken - kan gefokt worden',
  },
  'Скрещивание НЕ даёт первую копию — только размножает уже имеющегося мутанта (один из родителей должен быть им самим)': {
    en: 'Breeding does NOT give the first copy - it only duplicates a mutant you already own (one parent must be itself)',
    es: 'La cría NO da la primera copia, solo duplica un mutante que ya tienes (uno de los padres debe ser él mismo)',
    fr: "L'élevage ne donne PAS la première copie - il duplique seulement un mutant déjà possédé (un parent doit être lui-même)",
    de: 'Zucht liefert NICHT die erste Kopie - sie vervielfältigt nur einen bereits vorhandenen Mutanten (ein Elternteil muss er selbst sein)',
    pt: 'A criação NÃO dá a primeira cópia - apenas duplica um mutante que você já possui (um dos pais deve ser ele mesmo)',
    it: "L'incrocio NON dà la prima copia - duplica solo un mutante già posseduto (un genitore deve essere se stesso)",
    tr: 'Üretim ilk kopyayı VERMEZ - yalnızca zaten sahip olduğunuz bir mutantı çoğaltır (ebeveynlerden biri kendisi olmalı)',
    nl: 'Fokken geeft NIET de eerste kopie - het verdubbelt alleen een mutant die je al bezit (een ouder moet zichzelf zijn)',
  },
  'Уже не получить': {
    en: 'No longer obtainable', es: 'Ya no se puede obtener', fr: 'Plus disponible',
    de: 'Nicht mehr erhältlich', pt: 'Não disponível', it: 'Non più ottenibile', tr: 'Artık elde edilemiyor', nl: 'Niet meer verkrijgbaar',
  },
}

const MUTANT_ID_BY_RU_NAME: Record<string, string> = Object.fromEntries(
  (mutants as Array<{ id: string; name: string }>).map((m) => [m.name, m.id]),
)

const SKIN_LABEL_DICT: Partial<Record<Locale, string>> = {
  en: 'skin',
  es: 'skin',
  fr: 'skin',
  de: 'Skin',
  pt: 'skin',
  it: 'skin',
  tr: 'skin',
  nl: 'skin',
}

const FROM_LABEL_DICT: Partial<Record<Locale, string>> = {
  en: 'from',
  es: 'desde',
  fr: 'à partir de',
  de: 'ab',
  pt: 'a partir de',
  it: 'a partire da',
  tr: 'başlangıç',
  nl: 'vanaf',
}

// Обратный индекс STAR_LABEL (RU: {normal:'Обычный',...}) - суффиксы в
// obtain.json приходят в нижнем регистре ("бронза", не "Бронза").
const RU_TIER_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(STAR_LABEL).map(([key, ru]) => [ru.toLowerCase(), key]),
)

function renderSuffix(raw: string, locale: Locale): string {
  let m = raw.match(/^([\d\s,]+)\s*(золота|серебра)$/)
  if (m) {
    const n = Number(m[1].replace(/[\s,]/g, ''))
    const currency: 'gold' | 'silver' = m[2] === 'золота' ? 'gold' : 'silver'
    const numStr = new Intl.NumberFormat(locale).format(n)
    const word = CURRENCY_DICT[currency][locale] ?? CURRENCY_DICT[currency].en ?? m[2]
    return `${numStr} ${word}`
  }

  m = raw.match(/^от\s*(\$[\d.,]+)$/)
  if (m) {
    const from = FROM_LABEL_DICT[locale] ?? FROM_LABEL_DICT.en ?? 'from'
    return `${from} ${m[1]}`
  }

  const tierKey = RU_TIER_TO_KEY[raw.toLowerCase()]
  if (tierKey) {
    const dict = STAR_DICT[locale] ?? STAR_DICT.en ?? STAR_LABEL
    return dict[tierKey] ?? STAR_DICT.en?.[tierKey] ?? raw
  }

  m = raw.match(/^(\d+)★,\s*скин\s*«([^»]+)»$/)
  if (m) {
    const skinLabel = SKIN_LABEL_DICT[locale] ?? SKIN_LABEL_DICT.en ?? 'skin'
    return `${m[1]}★, ${skinLabel} «${m[2]}»`
  }

  m = raw.match(/^скин\s*«([^»]+)»$/)
  if (m) {
    const skinLabel = SKIN_LABEL_DICT[locale] ?? SKIN_LABEL_DICT.en ?? 'skin'
    return `${skinLabel} «${m[1]}»`
  }

  // "N★" отдельно (без скина) - число+звезда универсальны, перевода не требуют.
  if (/^\d+★$/.test(raw)) return raw

  // Неизвестный паттерн - оставляем RU-текст как есть внутри уже переведённой
  // рамки (лучше частичный перевод, чем полный откат на RU или выдумывание).
  return raw
}

function renderBundleBoxWhere(
  entry: { where: string; itemId?: string },
  locale: Locale,
  obtainNames: Record<string, string>,
): string {
  if (!entry.itemId) return entry.where
  const translatedName = obtainNames[entry.itemId]
  if (!translatedName) return entry.where

  const prefixMatch = entry.where.match(/^(Набор|Лаки-бокс|Мистери-бокс):\s*/)
  const prefixRu = prefixMatch?.[1]
  const rest = prefixMatch ? entry.where.slice(prefixMatch[0].length) : entry.where

  const suffixMatch = rest.match(/\s*\(([^()]*)\)\s*$/)
  const suffixRaw = suffixMatch?.[1]

  const prefix = prefixRu
    ? (PREFIX_DICT[prefixRu]?.[locale] ?? PREFIX_DICT[prefixRu]?.en ?? prefixRu)
    : ''
  const suffix = suffixRaw ? renderSuffix(suffixRaw, locale) : ''

  return `${prefix ? `${prefix}: ` : ''}${translatedName.trim()}${suffix ? ` (${suffix})` : ''}`
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
}

function tierLabel(ruWord: string, key: string, locale: Locale): string {
  const dict = STAR_DICT[locale] ?? STAR_DICT.en ?? STAR_LABEL
  return dict[key] ?? STAR_DICT.en?.[key] ?? ruWord
}

/**
 * Пересобирает "where" на целевую локаль. Bundle/box - через itemId
 * (renderBundleBoxWhere, см. выше). Остальные типы - Bucket 1 (Батч 11 (3)):
 * gold_shop/credits_shop/pvp - чистые шаблоны из чисел (Intl.NumberFormat,
 * без риска дрейфа, растут сами при новых сезонах/ценах); jackpot_hall/
 * event_hall/secret_breeding/bingo/roulette/campaign/quest/crossover/
 * breeding* - закрытые маленькие словари (авторский текст сайта, не
 * игровые данные, переведены руками одним разом - см. коммит).
 *
 * mutantNames - уже резолвленный для этой локали словарь id->{name,...}
 * (тот же, что MutantModal получает пропом `names`) - нужен для
 * secret_breeding, чтобы перевести имена мутантов из пары "X + Y".
 *
 * Неизвестный/непокрытый случай - RU "where" как есть (лучше частичный
 * перевод сайта, чем выдуманный текст).
 */
export function renderObtainWhere(
  entry: { type: string; where: string; itemId?: string },
  locale: Locale,
  obtainNames: Record<string, string>,
  mutantNames: Record<string, { name: string }> = {},
): string {
  if (locale === 'ru') return entry.where

  if (entry.type === 'bundle' || entry.type === 'box') {
    return renderBundleBoxWhere(entry, locale, obtainNames)
  }

  if (entry.type === 'gold_shop' || entry.type === 'credits_shop') {
    const m = entry.where.match(/^Магазин за ([\d\s]+) (золота|серебра\/кредитов) \(версия: (\S+)\)$/)
    if (!m) return entry.where
    const n = Number(m[1].replace(/\s/g, ''))
    const currencyKey: 'gold' | 'credits' = m[2] === 'золота' ? 'gold' : 'credits'
    const tierKey = TIER_ADJ_TO_KEY[m[3]]
    const tpl = SHOP_TEMPLATE[locale] ?? SHOP_TEMPLATE.en
    if (!tpl || !tierKey) return entry.where
    return fillTemplate(tpl, {
      n: new Intl.NumberFormat(locale).format(n),
      currency: CURRENCY_DICT[currencyKey][locale] ?? CURRENCY_DICT[currencyKey].en ?? m[2],
      tier: tierLabel(m[3], tierKey, locale),
    })
  }

  if (entry.type === 'pvp') {
    const m = entry.where.match(/^PVP: Сезон (\d+)$/)
    if (!m) return entry.where
    const tpl = PVP_TEMPLATE[locale] ?? PVP_TEMPLATE.en
    return tpl ? fillTemplate(tpl, { n: m[1] }) : entry.where
  }

  if (entry.type === 'jackpot_hall' || entry.type === 'event_hall') {
    const m = entry.where.match(/^Зал обмена — (\d+) (.+)$/)
    if (!m) return entry.where
    const label = EXCHANGE_HALL_LABEL[locale] ?? EXCHANGE_HALL_LABEL.en
    const desc = EXCHANGE_TOKEN_DESC[m[2]]?.[locale] ?? EXCHANGE_TOKEN_DESC[m[2]]?.en
    if (!label || !desc) return entry.where
    return `${label} — ${new Intl.NumberFormat(locale).format(Number(m[1]))} ${desc}`
  }

  if (entry.type === 'secret_breeding') {
    const m = entry.where.match(/^Секретное скрещивание: (.+) \+ (.+)$/)
    if (!m) return entry.where
    const label = SECRET_BREEDING_LABEL[locale] ?? SECRET_BREEDING_LABEL.en
    if (!label) return entry.where
    const nameA = mutantNames[MUTANT_ID_BY_RU_NAME[m[1]] ?? '']?.name ?? m[1]
    const nameB = mutantNames[MUTANT_ID_BY_RU_NAME[m[2]] ?? '']?.name ?? m[2]
    return `${label}: ${nameA} + ${nameB}`
  }

  if (entry.type === 'bingo') {
    const m = entry.where.match(/^Награда за бинго «([^»]+)»$/)
    if (!m) return entry.where
    const label = BINGO_REWARD_LABEL[locale] ?? BINGO_REWARD_LABEL.en
    const bingoKey = Object.entries(BINGO_RU).find(([, v]) => v === m[1])?.[0]
    if (!label || !bingoKey) return entry.where
    return `${label}: «${bingoLabelL(bingoKey, locale)}»`
  }

  if (entry.type === 'roulette') {
    const m = entry.where.match(/^Рулетка «([^»]+)»$/)
    if (!m) return entry.where
    const label = ROULETTE_LABEL[locale] ?? ROULETTE_LABEL.en
    return label ? `${label} «${m[1]}»` : entry.where
  }

  if (entry.type === 'campaign') {
    const m = entry.where.match(/^Дивизион (\S+): (.+)$/)
    if (!m) return entry.where
    const label = DIVISION_LABEL[locale] ?? DIVISION_LABEL.en
    const name = DIVISION_NAME_DICT[m[1]]?.[locale] ?? DIVISION_NAME_DICT[m[1]]?.en
    const place = DIVISION_LOCATION_DICT[m[2]]?.[locale] ?? DIVISION_LOCATION_DICT[m[2]]?.en ?? m[2]
    if (!label || !name) return entry.where
    return `${label} ${name}: ${place}`
  }

  if (entry.type === 'quest') {
    const m = entry.where.match(/^Квест: (.+)$/)
    if (!m) return entry.where
    const label = QUEST_LABEL[locale] ?? QUEST_LABEL.en
    const text = QUEST_TEXT_DICT[m[1]]?.[locale] ?? QUEST_TEXT_DICT[m[1]]?.en
    if (!label || !text) return entry.where
    return `${label}: ${text}`
  }

  if (entry.type === 'crossover') {
    return CROSSOVER_TEXT_DICT[entry.where]?.[locale] ?? CROSSOVER_TEXT_DICT[entry.where]?.en ?? entry.where
  }

  if (entry.type === 'breeding' || entry.type === 'breeding_duplicate' || entry.type === 'unavailable') {
    return STATIC_STRING_DICT[entry.where]?.[locale] ?? STATIC_STRING_DICT[entry.where]?.en ?? entry.where
  }

  if (entry.type === 'donate') {
    const m = entry.where.match(/^Донат — стартовый набор \((от\s*\$[\d.,]+)\)$/)
    if (!m) return entry.where
    const label = DONATE_LABEL[locale] ?? DONATE_LABEL.en
    if (!label) return entry.where
    return `${label} (${renderSuffix(m[1], locale)})`
  }

  return entry.where
}
