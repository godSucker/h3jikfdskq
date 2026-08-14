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
import { STAR_DICT, STAR_LABEL, BINGO_RU, bingoLabelL, GENE_RU, geneLabelL } from './mutant-dicts'
import mutants from '@/data/mutants/mutants.json'
import gachaEventI18n from '@/data/mutants/gacha-event-i18n.json'

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

// "версия: {прилагательное}" (gold_shop/credits_shop) и тир-префикс имени
// бандла ("Золотой X") - прилагательная форма тира, не существительная
// (STAR_LABEL). Все формы рода/числа - ключи те же, что в STAR_DICT.
// Лукап всегда через .toLowerCase() - источник данных нормализован по-разному
// в разных местах (gold_shop уже lowercase, префикс имени - с большой буквы).
const TIER_ADJ_TO_KEY: Record<string, string> = {
  обычный: 'normal',
  обычная: 'normal',
  бронзовый: 'bronze',
  бронзовая: 'bronze',
  бронзовые: 'bronze',
  серебряный: 'silver',
  серебряная: 'silver',
  серебряные: 'silver',
  золотой: 'gold',
  золотая: 'gold',
  золотые: 'gold',
  платиновый: 'platinum',
  платиновая: 'platinum',
  платиновые: 'platinum',
  // "брозновый" - опечатка в исходных RU-данных ("Брозновый Шнайдер"),
  // единственное вхождение - алиас на bronze, не новая форма слова.
  брозновый: 'bronze',
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

// Второй вариант pvp-записи (без номера сезона) - "Награда за прогресс в
// ПВП/арене". Авторский UI-текст сайта (не игровые данные), как и
// PVP_TEMPLATE выше.
const PVP_PROGRESS_LABEL: Partial<Record<Locale, string>> = {
  en: 'PVP/Arena progress reward',
  es: 'Recompensa de progreso en PVP/Arena',
  fr: 'Récompense de progression PVP/Arène',
  de: 'PVP/Arena-Fortschrittsbelohnung',
  pt: 'Recompensa de progresso em PVP/Arena',
  it: 'Ricompensa di progresso PVP/Arena',
  tr: 'PVP/Arena İlerleme Ödülü',
  nl: 'PVP/Arena-voortgangsbeloning',
}

// Зал обмена: "N {описание жетонов}". Закрытый список - 10 уникальных
// описаний на живых данных (см. Батч 11 (3)), не открытый текст.
const EXCHANGE_HALL_LABEL: Partial<Record<Locale, string>> = {
  en: 'Exchange Hall',
  es: 'Sala de intercambio',
  fr: "Salle d'échange",
  de: 'Tauschhalle',
  pt: 'Sala de Troca',
  it: 'Sala scambi',
  tr: 'Değişim Salonu',
  nl: 'Ruilhal',
}
const EXCHANGE_TOKEN_DESC: Record<string, Partial<Record<Locale, string>>> = {
  'жетонов Hexcity': {
    en: 'Hexcity tokens',
    es: 'fichas de Hexcity',
    fr: 'jetons Hexcity',
    de: 'Hexcity-Marken',
    pt: 'fichas Hexcity',
    it: 'gettoni Hexcity',
    tr: 'Hexcity jetonu',
    nl: 'Hexcity-tokens',
  },
  'новогодних жетонов 2025': {
    en: 'New Year tokens 2025',
    es: 'fichas de Año Nuevo 2025',
    fr: 'jetons du Nouvel An 2025',
    de: 'Neujahrsmarken 2025',
    pt: 'fichas de Ano Novo 2025',
    it: 'gettoni di Capodanno 2025',
    tr: '2025 Yılbaşı jetonu',
    nl: 'Nieuwjaarstokens 2025',
  },
  'новогодних жетонов 2024': {
    en: 'New Year tokens 2024',
    es: 'fichas de Año Nuevo 2024',
    fr: 'jetons du Nouvel An 2024',
    de: 'Neujahrsmarken 2024',
    pt: 'fichas de Ano Novo 2024',
    it: 'gettoni di Capodanno 2024',
    tr: '2024 Yılbaşı jetonu',
    nl: 'Nieuwjaarstokens 2024',
  },
  'зимнего угля': {
    en: 'winter coal',
    es: 'carbón de invierno',
    fr: "charbon d'hiver",
    de: 'Winterkohle',
    pt: 'carvão de inverno',
    it: 'carbone invernale',
    tr: 'kış kömürü',
    nl: 'winterkolen',
  },
  'зимних апельсинов': {
    en: 'winter oranges',
    es: 'naranjas de invierno',
    fr: "oranges d'hiver",
    de: 'Winterorangen',
    pt: 'laranjas de inverno',
    it: 'arance invernali',
    tr: 'kış portakalı',
    nl: 'wintersinaasappels',
  },
  'жетонов джекпота': {
    en: 'jackpot tokens',
    es: 'fichas de bote',
    fr: 'jetons jackpot',
    de: 'Jackpot-Marken',
    pt: 'fichas de jackpot',
    it: 'gettoni jackpot',
    tr: 'jackpot jetonu',
    nl: 'jackpot-tokens',
  },
  'жетонов капсул': {
    en: 'capsule tokens',
    es: 'fichas de cápsula',
    fr: 'jetons capsule',
    de: 'Kapsel-Marken',
    pt: 'fichas de cápsula',
    it: 'gettoni capsula',
    tr: 'kapsül jetonu',
    nl: 'capsuletokens',
  },
  'жетонов игрушек': {
    en: 'toy tokens',
    es: 'fichas de juguete',
    fr: 'jetons jouet',
    de: 'Spielzeug-Marken',
    pt: 'fichas de brinquedo',
    it: 'gettoni giocattolo',
    tr: 'oyuncak jetonu',
    nl: 'speelgoedtokens',
  },
  'пасхальных жетонов 2026': {
    en: 'Easter tokens 2026',
    es: 'fichas de Pascua 2026',
    fr: 'jetons de Pâques 2026',
    de: 'OsterMarken 2026',
    pt: 'fichas de Páscoa 2026',
    it: 'gettoni di Pasqua 2026',
    tr: '2026 Paskalya jetonu',
    nl: 'Paastokens 2026',
  },
  'жетонов ивента': {
    en: 'event tokens',
    es: 'fichas de evento',
    fr: "jetons d'événement",
    de: 'Event-Marken',
    pt: 'fichas de evento',
    it: 'gettoni evento',
    tr: 'etkinlik jetonu',
    nl: 'evenemententokens',
  },
}

const SECRET_BREEDING_LABEL: Partial<Record<Locale, string>> = {
  en: 'Secret breeding',
  es: 'Cría secreta',
  fr: 'Élevage secret',
  de: 'Geheime Zucht',
  pt: 'Cria secreta',
  it: 'Incrocio segreto',
  tr: 'Gizli üretim',
  nl: 'Geheime fokkerij',
}

const ROULETTE_LABEL: Partial<Record<Locale, string>> = {
  en: 'Roulette',
  es: 'Ruleta',
  fr: 'Roulette',
  de: 'Roulette',
  pt: 'Roleta',
  it: 'Roulette',
  tr: 'Rulet',
  nl: 'Roulette',
}

const BINGO_REWARD_LABEL: Partial<Record<Locale, string>> = {
  en: 'Bingo reward',
  es: 'Recompensa de bingo',
  fr: 'Récompense bingo',
  de: 'Bingo-Belohnung',
  pt: 'Recompensa de bingo',
  it: 'Ricompensa bingo',
  tr: 'Bingo ödülü',
  nl: 'Bingobeloning',
}

const QUEST_LABEL: Partial<Record<Locale, string>> = {
  en: 'Quest',
  es: 'Misión',
  fr: 'Quête',
  de: 'Quest',
  pt: 'Missão',
  it: 'Missione',
  tr: 'Görev',
  nl: 'Quest',
}

const DIVISION_LABEL: Partial<Record<Locale, string>> = {
  en: 'Division',
  es: 'División',
  fr: 'Division',
  de: 'Division',
  pt: 'Divisão',
  it: 'Divisione',
  tr: 'Bölüm',
  nl: 'Divisie',
}
const DIVISION_NAME_DICT: Record<string, Partial<Record<Locale, string>>> = {
  Альфа: {
    en: 'Alpha',
    es: 'Alfa',
    fr: 'Alpha',
    de: 'Alpha',
    pt: 'Alfa',
    it: 'Alfa',
    tr: 'Alfa',
    nl: 'Alpha',
  },
  Бета: {
    en: 'Beta',
    es: 'Beta',
    fr: 'Bêta',
    de: 'Beta',
    pt: 'Beta',
    it: 'Beta',
    tr: 'Beta',
    nl: 'Bèta',
  },
  Гига: {
    en: 'Giga',
    es: 'Giga',
    fr: 'Giga',
    de: 'Giga',
    pt: 'Giga',
    it: 'Giga',
    tr: 'Giga',
    nl: 'Giga',
  },
  Омега: {
    en: 'Omega',
    es: 'Omega',
    fr: 'Oméga',
    de: 'Omega',
    pt: 'Ômega',
    it: 'Omega',
    tr: 'Omega',
    nl: 'Omega',
  },
}
// Названия локаций дивизий - авторский текст сайта (не игровые данные),
// переведён вручную (4 записи).
const DIVISION_LOCATION_DICT: Record<string, Partial<Record<Locale, string>>> = {
  Детройт: {
    en: 'Detroit',
    es: 'Detroit',
    fr: 'Détroit',
    de: 'Detroit',
    pt: 'Detroit',
    it: 'Detroit',
    tr: 'Detroit',
    nl: 'Detroit',
  },
  'Безымянные руины': {
    en: 'Unnamed Ruins',
    es: 'Ruinas sin nombre',
    fr: 'Ruines sans nom',
    de: 'Namenlose Ruinen',
    pt: 'Ruínas sem nome',
    it: 'Rovine senza nome',
    tr: 'İsimsiz Harabeler',
    nl: 'Naamloze Ruïnes',
  },
  'Новый Нью-Дели': {
    en: 'New New Delhi',
    es: 'Nueva Nueva Delhi',
    fr: 'Nouvelle New Delhi',
    de: 'Neu-Neu-Delhi',
    pt: 'Nova Nova Delhi',
    it: 'Nuova Nuova Delhi',
    tr: 'Yeni Yeni Delhi',
    nl: 'Nieuw New Delhi',
  },
}

// Квесты/кроссоверы - куратор-авторский текст сайта (не игровые данные),
// маленький закрытый набор (6+4), переведён вручную одним разом.
const QUEST_TEXT_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Желтые усилители!': {
    en: 'Yellow boosters!',
    es: '¡Potenciadores amarillos!',
    fr: 'Boosters jaunes !',
    de: 'Gelbe Booster!',
    pt: 'Reforços amarelos!',
    it: 'Potenziatori gialli!',
    tr: 'Sarı güçlendiriciler!',
    nl: 'Gele boosters!',
  },
  'Зима пришла!': {
    en: 'Winter has come!',
    es: '¡Llegó el invierno!',
    fr: "L'hiver est arrivé !",
    de: 'Der Winter ist da!',
    pt: 'O inverno chegou!',
    it: "L'inverno è arrivato!",
    tr: 'Kış geldi!',
    nl: 'De winter is gekomen!',
  },
  'Охоться на этих кроликов!': {
    en: 'Hunt these rabbits!',
    es: '¡Caza a estos conejos!',
    fr: 'Chassez ces lapins !',
    de: 'Jage diese Hasen!',
    pt: 'Caçe estes coelhos!',
    it: 'Dai la caccia a questi conigli!',
    tr: 'Bu tavşanları avla!',
    nl: 'Jaag op deze konijnen!',
  },
  'Синие усилители!': {
    en: 'Blue boosters!',
    es: '¡Potenciadores azules!',
    fr: 'Boosters bleus !',
    de: 'Blaue Booster!',
    pt: 'Reforços azuis!',
    it: 'Potenziatori blu!',
    tr: 'Mavi güçlendiriciler!',
    nl: 'Blauwe boosters!',
  },
  Фиолетовые: {
    en: 'Purple ones',
    es: 'Los morados',
    fr: 'Les violets',
    de: 'Die Lila',
    pt: 'Os roxos',
    it: 'I viola',
    tr: 'Morlar',
    nl: 'De paarse',
  },
  'Фиолетовые усилители!': {
    en: 'Purple boosters!',
    es: '¡Potenciadores morados!',
    fr: 'Boosters violets !',
    de: 'Lila Booster!',
    pt: 'Reforços roxos!',
    it: 'Potenziatori viola!',
    tr: 'Mor güçlendiriciler!',
    nl: 'Paarse boosters!',
  },
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
  'Кроссовер — победа над боссом Нимродом на стадии Babel Tower в Celsius Heroes (Celsius Online), уже не получить':
    {
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
  'Кроссовер — прогресс до локации Asyrith Mines в Celsius Heroes (Celsius Online), уже не получить':
    {
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
  en: 'Donation - starter pack',
  es: 'Donación: paquete inicial',
  fr: 'Don - pack de démarrage',
  de: 'Spende - Starterpaket',
  pt: 'Doação - pacote inicial',
  it: 'Donazione - pacchetto iniziale',
  tr: 'Bağış - başlangıç paketi',
  nl: 'Donatie - startpakket',
}

const STATIC_STRING_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Скрещивание — можно вывести': {
    en: 'Breeding - can be bred',
    es: 'Cría: se puede criar',
    fr: 'Élevage - peut être élevé',
    de: 'Zucht - kann gezüchtet werden',
    pt: 'Cria - pode ser criado',
    it: 'Incrocio - può essere allevato',
    tr: 'Üretim - üretilebilir',
    nl: 'Fokken - kan gefokt worden',
  },
  'Скрещивание НЕ даёт первую копию — только размножает уже имеющегося мутанта (один из родителей должен быть им самим)':
    {
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

// Батч 11 (3), Bucket 4: gacha/event_raid - кураторские названия без
// официального источника ни на каком языке (проверено в
// detect-new-reactors.ts, см. память feedback-no-llm-authored-names). Эти
// 66 УЖЕ СУЩЕСТВУЮЩИХ имён переведены вручную одним разом (перевод
// решённого текста, не изобретение нового - разрешено). Новые записи
// дальше идут через расширенный .локал (RU+EN сразу, см.
// telegram-webhook.ts) - не автоматика.
const GACHA_LABEL: Partial<Record<Locale, string>> = {
  en: 'Reactor',
  es: 'Reactor',
  fr: 'Réacteur',
  de: 'Reaktor',
  pt: 'Reator',
  it: 'Reattore',
  tr: 'Reaktör',
  nl: 'Reactor',
}
const RAID_LABEL: Partial<Record<Locale, string>> = {
  en: 'Raid',
  es: 'Incursión',
  fr: 'Raid',
  de: 'Überfall',
  pt: 'Invasão',
  it: 'Raid',
  tr: 'Baskın',
  nl: 'Overval',
}
const LADDER_LABEL: Partial<Record<Locale, string>> = {
  en: 'Ladder',
  es: 'Escalera',
  fr: 'Échelle',
  de: 'Leiter',
  pt: 'Escada',
  it: 'Scala',
  tr: 'Merdiven',
  nl: 'Ladder',
}
const PIT_LABEL: Partial<Record<Locale, string>> = {
  en: 'Pit',
  es: 'Pozo',
  fr: 'Fosse',
  de: 'Grube',
  pt: 'Fosso',
  it: 'Fossa',
  tr: 'Çukur',
  nl: 'Kuil',
}

const GACHA_NAME_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Боги арены': {
    en: 'Gods of the Arena',
    es: 'Dioses de la arena',
    fr: "Dieux de l'arène",
    de: 'Götter der Arena',
    pt: 'Deuses da arena',
    it: "Dei dell'arena",
    tr: 'Arena Tanrıları',
    nl: 'Goden van de arena',
  },
  'Большой босс': {
    en: 'Big Boss',
    es: 'Gran jefe',
    fr: 'Big Boss',
    de: 'Big Boss',
    pt: 'Grande chefe',
    it: 'Grande capo',
    tr: 'Büyük Patron',
    nl: 'Grote baas',
  },
  Вестерн: {
    en: 'Western',
    es: 'Western',
    fr: 'Western',
    de: 'Western',
    pt: 'Faroeste',
    it: 'Western',
    tr: 'Vahşi Batı',
    nl: 'Western',
  },
  Готика: {
    en: 'Gothic',
    es: 'Gótico',
    fr: 'Gothique',
    de: 'Gotik',
    pt: 'Gótico',
    it: 'Gotico',
    tr: 'Gotik',
    nl: 'Gothic',
  },
  Диско: {
    en: 'Disco',
    es: 'Disco',
    fr: 'Disco',
    de: 'Disco',
    pt: 'Disco',
    it: 'Disco',
    tr: 'Disko',
    nl: 'Disco',
  },
  Кино: {
    en: 'Cinema',
    es: 'Cine',
    fr: 'Cinéma',
    de: 'Kino',
    pt: 'Cinema',
    it: 'Cinema',
    tr: 'Sinema',
    nl: 'Bioscoop',
  },
  'Команда элементалей': {
    en: 'Elemental Team',
    es: 'Equipo elemental',
    fr: 'Équipe élémentaire',
    de: 'Elementar-Team',
    pt: 'Time elemental',
    it: 'Squadra elementale',
    tr: 'Element Takımı',
    nl: 'Elementair team',
  },
  'Космические войны': {
    en: 'Space Wars',
    es: 'Guerras espaciales',
    fr: "Guerres de l'espace",
    de: 'Weltraumkriege',
    pt: 'Guerras espaciais',
    it: 'Guerre spaziali',
    tr: 'Uzay Savaşları',
    nl: 'Ruimteoorlogen',
  },
  'Кровавые игры': {
    en: 'Blood Games',
    es: 'Juegos de sangre',
    fr: 'Jeux de sang',
    de: 'Blutspiele',
    pt: 'Jogos de sangue',
    it: 'Giochi di sangue',
    tr: 'Kan Oyunları',
    nl: 'Bloedspelen',
  },
  "Мучачо's": {
    en: "Muchacho's",
    es: "Muchacho's",
    fr: "Muchacho's",
    de: "Muchacho's",
    pt: "Muchacho's",
    it: "Muchacho's",
    tr: "Muchacho's",
    nl: "Muchacho's",
  },
  'Патруль времени': {
    en: 'Time Patrol',
    es: 'Patrulla del tiempo',
    fr: 'Patrouille temporelle',
    de: 'Zeitpatrouille',
    pt: 'Patrulha do tempo',
    it: 'Pattuglia del tempo',
    tr: 'Zaman Devriyesi',
    nl: 'Tijdpatrouille',
  },
  Самоцветы: {
    en: 'Gems',
    es: 'Gemas',
    fr: 'Gemmes',
    de: 'Edelsteine',
    pt: 'Gemas',
    it: 'Gemme',
    tr: 'Değerli Taşlar',
    nl: 'Edelstenen',
  },
  Стимпанк: {
    en: 'Steampunk',
    es: 'Steampunk',
    fr: 'Steampunk',
    de: 'Steampunk',
    pt: 'Steampunk',
    it: 'Steampunk',
    tr: 'Steampunk',
    nl: 'Steampunk',
  },
  'Супер злодеи': {
    en: 'Super Villains',
    es: 'Supervillanos',
    fr: 'Super-vilains',
    de: 'Superschurken',
    pt: 'Supervilões',
    it: 'Super cattivi',
    tr: 'Süper Kötüler',
    nl: 'Superschurken',
  },
  Супергерои: {
    en: 'Superheroes',
    es: 'Superhéroes',
    fr: 'Super-héros',
    de: 'Superhelden',
    pt: 'Super-heróis',
    it: 'Supereroi',
    tr: 'Süper Kahramanlar',
    nl: 'Superhelden',
  },
  'Темное фентези': {
    en: 'Dark Fantasy',
    es: 'Fantasía oscura',
    fr: 'Fantasy sombre',
    de: 'Dark Fantasy',
    pt: 'Fantasia sombria',
    it: 'Fantasy oscuro',
    tr: 'Karanlık Fantezi',
    nl: 'Dark Fantasy',
  },
  'Тропическое лето': {
    en: 'Tropical Summer',
    es: 'Verano tropical',
    fr: 'Été tropical',
    de: 'Tropischer Sommer',
    pt: 'Verão tropical',
    it: 'Estate tropicale',
    tr: 'Tropik Yaz',
    nl: 'Tropische zomer',
  },
  Фотосинтез: {
    en: 'Photosynthesis',
    es: 'Fotosíntesis',
    fr: 'Photosynthèse',
    de: 'Photosynthese',
    pt: 'Fotossíntese',
    it: 'Fotosintesi',
    tr: 'Fotosentez',
    nl: 'Fotosynthese',
  },
  Хищницы: {
    en: 'Huntresses',
    es: 'Cazadoras',
    fr: 'Chasseuses',
    de: 'Jägerinnen',
    pt: 'Caçadoras',
    it: 'Cacciatrici',
    tr: 'Avcı Kadınlar',
    nl: 'Jaagsters',
  },
  Шахматы: {
    en: 'Chess',
    es: 'Ajedrez',
    fr: 'Échecs',
    de: 'Schach',
    pt: 'Xadrez',
    it: 'Scacchi',
    tr: 'Satranç',
    nl: 'Schaak',
  },
  Япония: {
    en: 'Japan',
    es: 'Japón',
    fr: 'Japon',
    de: 'Japan',
    pt: 'Japão',
    it: 'Giappone',
    tr: 'Japonya',
    nl: 'Japan',
  },
}

const RAID_NAME_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Jungle Bells 1': {
    en: 'Jungle Bells 1',
    es: 'Jungle Bells 1',
    fr: 'Jungle Bells 1',
    de: 'Jungle Bells 1',
    pt: 'Jungle Bells 1',
    it: 'Jungle Bells 1',
    tr: 'Jungle Bells 1',
    nl: 'Jungle Bells 1',
  },
  'Jungle Bells 2': {
    en: 'Jungle Bells 2',
    es: 'Jungle Bells 2',
    fr: 'Jungle Bells 2',
    de: 'Jungle Bells 2',
    pt: 'Jungle Bells 2',
    it: 'Jungle Bells 2',
    tr: 'Jungle Bells 2',
    nl: 'Jungle Bells 2',
  },
  'Jungle Bells 3': {
    en: 'Jungle Bells 3',
    es: 'Jungle Bells 3',
    fr: 'Jungle Bells 3',
    de: 'Jungle Bells 3',
    pt: 'Jungle Bells 3',
    it: 'Jungle Bells 3',
    tr: 'Jungle Bells 3',
    nl: 'Jungle Bells 3',
  },
  Uprising: {
    en: 'Uprising',
    es: 'Uprising',
    fr: 'Uprising',
    de: 'Uprising',
    pt: 'Uprising',
    it: 'Uprising',
    tr: 'Uprising',
    nl: 'Uprising',
  },
  'Адское пламя': {
    en: 'Hellfire',
    es: 'Fuego infernal',
    fr: "Feu de l'enfer",
    de: 'Höllenfeuer',
    pt: 'Fogo infernal',
    it: 'Fuoco infernale',
    tr: 'Cehennem Ateşi',
    nl: 'Hellevuur',
  },
  Амазонка: {
    en: 'Amazon',
    es: 'Amazona',
    fr: 'Amazone',
    de: 'Amazone',
    pt: 'Amazona',
    it: 'Amazzone',
    tr: 'Amazon',
    nl: 'Amazone',
  },
  Антарктика: {
    en: 'Antarctica',
    es: 'Antártida',
    fr: 'Antarctique',
    de: 'Antarktis',
    pt: 'Antártida',
    it: 'Antartide',
    tr: 'Antarktika',
    nl: 'Antarctica',
  },
  Вегас: {
    en: 'Vegas',
    es: 'Vegas',
    fr: 'Vegas',
    de: 'Vegas',
    pt: 'Vegas',
    it: 'Vegas',
    tr: 'Vegas',
    nl: 'Vegas',
  },
  Гиперборея: {
    en: 'Hyperborea',
    es: 'Hiperbórea',
    fr: 'Hyperborée',
    de: 'Hyperborea',
    pt: 'Hiperbórea',
    it: 'Iperborea',
    tr: 'Hiperborea',
    nl: 'Hyperborea',
  },
  'Гора Олимп': {
    en: 'Mount Olympus',
    es: 'Monte Olimpo',
    fr: 'Mont Olympe',
    de: 'Olymp',
    pt: 'Monte Olimpo',
    it: 'Monte Olimpo',
    tr: 'Olimpos Dağı',
    nl: 'Olympusberg',
  },
  Колизей: {
    en: 'Colosseum',
    es: 'Coliseo',
    fr: 'Colisée',
    de: 'Kolosseum',
    pt: 'Coliseu',
    it: 'Colosseo',
    tr: 'Kolezyum',
    nl: 'Colosseum',
  },
  Космопорт: {
    en: 'Spaceport',
    es: 'Puerto espacial',
    fr: 'Spatioport',
    de: 'Weltraumhafen',
    pt: 'Porto espacial',
    it: 'Spazioporto',
    tr: 'Uzay Limanı',
    nl: 'Ruimtehaven',
  },
  'Кошмар Хеллоуина': {
    en: 'Halloween Nightmare',
    es: 'Pesadilla de Halloween',
    fr: "Cauchemar d'Halloween",
    de: 'Halloween-Albtraum',
    pt: 'Pesadelo de Halloween',
    it: 'Incubo di Halloween',
    tr: 'Cadılar Bayramı Kâbusu',
    nl: 'Halloween Nachtmerrie',
  },
  Кризис: {
    en: 'Crisis',
    es: 'Crisis',
    fr: 'Crise',
    de: 'Krise',
    pt: 'Crise',
    it: 'Crisi',
    tr: 'Kriz',
    nl: 'Crisis',
  },
  Луна: {
    en: 'Moon',
    es: 'Luna',
    fr: 'Lune',
    de: 'Mond',
    pt: 'Lua',
    it: 'Luna',
    tr: 'Ay',
    nl: 'Maan',
  },
  Марс: {
    en: 'Mars',
    es: 'Marte',
    fr: 'Mars',
    de: 'Mars',
    pt: 'Marte',
    it: 'Marte',
    tr: 'Mars',
    nl: 'Mars',
  },
  'Небесное тело': {
    en: 'Celestial Body',
    es: 'Cuerpo celeste',
    fr: 'Corps céleste',
    de: 'Himmelskörper',
    pt: 'Corpo celeste',
    it: 'Corpo celeste',
    tr: 'Gök Cismi',
    nl: 'Hemellichaam',
  },
  Неон: {
    en: 'Neon',
    es: 'Neón',
    fr: 'Néon',
    de: 'Neon',
    pt: 'Néon',
    it: 'Neon',
    tr: 'Neon',
    nl: 'Neon',
  },
  'Первый эксперимент': {
    en: 'First Experiment',
    es: 'Primer experimento',
    fr: 'Première expérience',
    de: 'Erstes Experiment',
    pt: 'Primeiro experimento',
    it: 'Primo esperimento',
    tr: 'İlk Deney',
    nl: 'Eerste experiment',
  },
  'Пляжные бои Майами': {
    en: 'Miami Beach Battles',
    es: 'Batallas en la playa de Miami',
    fr: 'Batailles sur la plage de Miami',
    de: 'Miami-Beach-Kämpfe',
    pt: 'Batalhas na praia de Miami',
    it: 'Battaglie sulla spiaggia di Miami',
    tr: 'Miami Sahil Savaşları',
    nl: 'Miami Beach Gevechten',
  },
  'Рапа-Нуи': {
    en: 'Rapa Nui',
    es: 'Rapa Nui',
    fr: 'Rapa Nui',
    de: 'Rapa Nui',
    pt: 'Rapa Nui',
    it: 'Rapa Nui',
    tr: 'Rapa Nui',
    nl: 'Rapa Nui',
  },
  'Темный город': {
    en: 'Dark City',
    es: 'Ciudad oscura',
    fr: 'Ville sombre',
    de: 'Dunkle Stadt',
    pt: 'Cidade sombria',
    it: 'Città oscura',
    tr: 'Karanlık Şehir',
    nl: 'Duistere stad',
  },
  Япония: {
    en: 'Japan',
    es: 'Japón',
    fr: 'Japon',
    de: 'Japan',
    pt: 'Japão',
    it: 'Giappone',
    tr: 'Japonya',
    nl: 'Japan',
  },
  Архитектура: {
    en: 'Architecture',
    es: 'Arquitectura',
    fr: 'Architecture',
    de: 'Architektur',
    pt: 'Arquitetura',
    it: 'Architettura',
    tr: 'Mimari',
    nl: 'Architectuur',
  },
  Астероиды: {
    en: 'Asteroids',
    es: 'Asteroides',
    fr: 'Astéroïdes',
    de: 'Asteroiden',
    pt: 'Asteroides',
    it: 'Asteroidi',
    tr: 'Asteroitler',
    nl: 'Asteroïden',
  },
  Бездна: {
    en: 'Abyss',
    es: 'Abismo',
    fr: 'Abysse',
    de: 'Abgrund',
    pt: 'Abismo',
    it: 'Abisso',
    tr: 'Uçurum',
    nl: 'Afgrond',
  },
  'Безумие II': {
    en: 'Madness II',
    es: 'Locura II',
    fr: 'Folie II',
    de: 'Wahnsinn II',
    pt: 'Loucura II',
    it: 'Follia II',
    tr: 'Çılgınlık II',
    nl: 'Waanzin II',
  },
  'Библиотека II': {
    en: 'Library II',
    es: 'Biblioteca II',
    fr: 'Bibliothèque II',
    de: 'Bibliothek II',
    pt: 'Biblioteca II',
    it: 'Biblioteca II',
    tr: 'Kütüphane II',
    nl: 'Bibliotheek II',
  },
  'Верн II': {
    en: 'Verne II',
    es: 'Verne II',
    fr: 'Verne II',
    de: 'Verne II',
    pt: 'Verne II',
    it: 'Verne II',
    tr: 'Verne II',
    nl: 'Verne II',
  },
  'Вечные пески': {
    en: 'Everlasting Sands',
    es: 'Arenas eternas',
    fr: 'Sables éternels',
    de: 'Ewige Sande',
    pt: 'Areias eternas',
    it: 'Sabbie eterne',
    tr: 'Sonsuz Kumlar',
    nl: 'Eeuwige zanden',
  },
  'Дюма II': {
    en: 'Dumas II',
    es: 'Dumas II',
    fr: 'Dumas II',
    de: 'Dumas II',
    pt: 'Dumas II',
    it: 'Dumas II',
    tr: 'Dumas II',
    nl: 'Dumas II',
  },
  'Инферно II': {
    en: 'Inferno II',
    es: 'Infierno II',
    fr: 'Enfer II',
    de: 'Inferno II',
    pt: 'Inferno II',
    it: 'Inferno II',
    tr: 'Cehennem II',
    nl: 'Inferno II',
  },
  'Калевала II': {
    en: 'Kalevala II',
    es: 'Kalevala II',
    fr: 'Kalevala II',
    de: 'Kalevala II',
    pt: 'Kalevala II',
    it: 'Kalevala II',
    tr: 'Kalevala II',
    nl: 'Kalevala II',
  },
  'Криптид II': {
    en: 'Cryptid II',
    es: 'Críptido II',
    fr: 'Cryptide II',
    de: 'Kryptid II',
    pt: 'Críptico II',
    it: 'Criptide II',
    tr: 'Kriptid II',
    nl: 'Cryptide II',
  },
  Мафия: {
    en: 'Mafia',
    es: 'Mafia',
    fr: 'Mafia',
    de: 'Mafia',
    pt: 'Máfia',
    it: 'Mafia',
    tr: 'Mafya',
    nl: 'Maffia',
  },
  'Мусаси II': {
    en: 'Musashi II',
    es: 'Musashi II',
    fr: 'Musashi II',
    de: 'Musashi II',
    pt: 'Musashi II',
    it: 'Musashi II',
    tr: 'Musashi II',
    nl: 'Musashi II',
  },
  'Немертвые II': {
    en: 'Undying II',
    es: 'Los No Muertos II',
    fr: 'Morts-vivants II',
    de: 'Untote II',
    pt: 'Não-mortos II',
    it: 'Non Morti II',
    tr: 'Ölümsüzler II',
    nl: 'Ondoden II',
  },
  Пираты: {
    en: 'Pirates',
    es: 'Piratas',
    fr: 'Pirates',
    de: 'Piraten',
    pt: 'Piratas',
    it: 'Pirati',
    tr: 'Korsanlar',
    nl: 'Piraten',
  },
  'Фабрика II': {
    en: 'Factory II',
    es: 'Fábrica II',
    fr: 'Usine II',
    de: 'Fabrik II',
    pt: 'Fábrica II',
    it: 'Fabbrica II',
    tr: 'Fabrika II',
    nl: 'Fabriek II',
  },
}

const MUTANT_ID_BY_RU_NAME: Record<string, string> = Object.fromEntries(
  (mutants as Array<{ id: string; name: string }>).map((m) => [m.name, m.id]),
)

// Точечные алиасы для payload'ов obtain.json, где имя мутанта встречается
// НЕ в именительном падеже (русская грамматика бандлов - "Пакет
// Мегастрала" = родительный падеж от "Мегастрал") или на другом языке
// (Specimen_FB_05 в RU-каноне - "Аццкий металл", но конкретно в этом
// bundle-payload использовано игровое EN-имя "Bones 'n' Roses" - см.
// names.en.json). Верифицировано по mutants.json/names.en.json, не
// придумано - тот же принцип, что declined/alt-name резолв везде выше.
const MUTANT_ID_BY_PAYLOAD_ALIAS: Record<string, string> = {
  Центавра: 'specimen_ae_09', // родительный от "Центавр"
  Мегастрала: 'specimen_ee_09', // родительный от "Мегастрал"
  'Мага-дракона': 'specimen_fd_09', // родительный от "Маг-дракон"
  'Bones ‘n’ Roses': 'specimen_fb_05', // EN игровое имя вместо RU "Аццкий металл"
}

function mutantIdByAnyName(name: string): string | undefined {
  return MUTANT_ID_BY_RU_NAME[name] ?? MUTANT_ID_BY_PAYLOAD_ALIAS[name]
}

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

// Батч 11 (3), retired-бандлы (без живого itemId): резолв имени идёт в 4
// уровня, от самого дешёвого/надёжного к самому дорогому - см. коммит.
// 1) TIER + имя мутанта ("Золотой Гор") - механика, склонения не важны
//    (target-язык невариантен, та же логика что STAR_DICT).
// 2) Шаблон-обёртка + имя мутанта ("Пакет «X»", "Уникальный пакет X") -
//    17 шаблонов с >=2 вхождениями на живых данных, остальные (типы/опечатки
//    вроде "Брозновый X" единичные) намеренно не покрыты - падают на RU.
// 3) Полностью свободное имя без мутанта (110 строк) - переведено вручную.
// 4) Нет кириллицы вообще (сырые коды типа "ea 13 25ct", "Specimen AB 04
//    gold" - нерезолвленные исторические itemId) - показываются как есть,
//    это не текст ни на каком языке, переводить нечего.
// (TIER_ADJ_TO_KEY переиспользуется отсюда же, объявлен выше для gold_shop)

interface WrapperRule {
  re: RegExp
  build: (name: string, locale: Locale) => string | null
}

function wrap(
  tpl: Partial<Record<Locale, string>>,
): (name: string, locale: Locale) => string | null {
  return (name, locale) => {
    const t = tpl[locale] ?? tpl.en
    return t ? t.replace('{NAME}', name) : null
  }
}

const WRAPPER_RULES: WrapperRule[] = [
  // Специфичные (тир+модификатор зашиты в саму фразу) - проверяются первыми.
  {
    re: /^Зимний золотой (.+)$/,
    build: wrap({
      en: 'Winter Gold {NAME}',
      es: 'Oro de invierno {NAME}',
      fr: 'Or hivernal {NAME}',
      de: 'Wintergold-{NAME}',
      pt: 'Ouro de inverno {NAME}',
      it: 'Oro invernale {NAME}',
      tr: 'Kış Altın {NAME}',
      nl: 'Wintergoud {NAME}',
    }),
  },
  {
    re: /^Золотой (.+) Хеллоуина$/,
    build: wrap({
      en: 'Halloween Gold {NAME}',
      es: '{NAME} dorado de Halloween',
      fr: 'Halloween Or {NAME}',
      de: 'Halloween-Gold-{NAME}',
      pt: 'Halloween Ouro {NAME}',
      it: 'Halloween Oro {NAME}',
      tr: 'Cadılar Bayramı Altın {NAME}',
      nl: 'Halloween Goud {NAME}',
    }),
  },
  {
    re: /^св\. Валентина золотой (.+)$/,
    build: wrap({
      en: "Valentine's Gold {NAME}",
      es: 'Oro de San Valentín {NAME}',
      fr: 'Saint-Valentin Or {NAME}',
      de: 'Valentinstag-Gold-{NAME}',
      pt: 'Ouro Dia dos Namorados {NAME}',
      it: 'Oro San Valentino {NAME}',
      tr: 'Sevgililer Günü Altın {NAME}',
      nl: 'Valentijn Goud {NAME}',
    }),
  },
  {
    re: /^Пакет «Независимость» (.+)$/,
    build: wrap({
      en: 'Independence Pack {NAME}',
      es: 'Paquete Independencia {NAME}',
      fr: 'Pack Indépendance {NAME}',
      de: 'Unabhängigkeitspaket {NAME}',
      pt: 'Pacote Independência {NAME}',
      it: 'Pacchetto Indipendenza {NAME}',
      tr: 'Bağımsızlık Paketi {NAME}',
      nl: 'Onafhankelijkheidspakket {NAME}',
    }),
  },
  // Общие обёртки.
  {
    re: /^Уникальный пакет (.+)$/,
    build: wrap({
      en: 'Unique Pack {NAME}',
      es: 'Paquete único {NAME}',
      fr: 'Pack unique {NAME}',
      de: 'Einzigartiges Paket {NAME}',
      pt: 'Pacote único {NAME}',
      it: 'Pacchetto unico {NAME}',
      tr: 'Eşsiz Paket {NAME}',
      nl: 'Uniek pakket {NAME}',
    }),
  },
  {
    re: /^Пакет «([^»]+)»$/,
    build: wrap({
      en: 'Pack "{NAME}"',
      es: 'Paquete "{NAME}"',
      fr: 'Pack « {NAME} »',
      de: 'Paket „{NAME}“',
      pt: 'Pacote "{NAME}"',
      it: 'Pacchetto "{NAME}"',
      tr: '"{NAME}" Paketi',
      nl: 'Pakket "{NAME}"',
    }),
  },
  {
    re: /^Престижный пакет «([^»]+)»$/,
    build: wrap({
      en: 'Prestige Pack "{NAME}"',
      es: 'Paquete de prestigio "{NAME}"',
      fr: 'Pack prestige « {NAME} »',
      de: 'Prestige-Paket „{NAME}“',
      pt: 'Pacote de prestígio "{NAME}"',
      it: 'Pacchetto prestigio "{NAME}"',
      tr: 'Prestij Paketi "{NAME}"',
      nl: 'Prestigepakket "{NAME}"',
    }),
  },
  {
    re: /^Спецпредложение «([^»]+)»$/,
    build: wrap({
      en: 'Special Offer "{NAME}"',
      es: 'Oferta especial "{NAME}"',
      fr: 'Offre spéciale « {NAME} »',
      de: 'Sonderangebot „{NAME}“',
      pt: 'Oferta especial "{NAME}"',
      it: 'Offerta speciale "{NAME}"',
      tr: 'Özel Teklif "{NAME}"',
      nl: 'Speciale aanbieding "{NAME}"',
    }),
  },
  {
    re: /^Пакет ветерана «([^»]+)»$/,
    build: wrap({
      en: 'Veteran Pack "{NAME}"',
      es: 'Paquete de veterano "{NAME}"',
      fr: 'Pack vétéran « {NAME} »',
      de: 'Veteranenpaket „{NAME}“',
      pt: 'Pacote veterano "{NAME}"',
      it: 'Pacchetto veterano "{NAME}"',
      tr: 'Kıdemli Paketi "{NAME}"',
      nl: 'Veteranenpakket "{NAME}"',
    }),
  },
  // Ниже - варианты уже существующих правил выше (сокращение/род/лишний
  // токен в RU-payload'е), найдены живым тестом на остатке 3.7%
  // непереведённых записей obtain.json (2026-08-15). Шаблоны переиспользуют
  // тот же перевод, что и канонический вариант, а не изобретают новый.
  {
    // "Зимн. золот. X" - сокращённый вариант "Зимний золотой X".
    re: /^Зимн\.\s*золот\.\s*(.+)$/,
    build: wrap({
      en: 'Winter Gold {NAME}',
      es: 'Oro de invierno {NAME}',
      fr: 'Or hivernal {NAME}',
      de: 'Wintergold-{NAME}',
      pt: 'Ouro de inverno {NAME}',
      it: 'Oro invernale {NAME}',
      tr: 'Kış Altın {NAME}',
      nl: 'Wintergoud {NAME}',
    }),
  },
  {
    // "Зимняя золотая X" - женский род "Зимний золотой X".
    re: /^Зимняя золотая (.+)$/,
    build: wrap({
      en: 'Winter Gold {NAME}',
      es: 'Oro de invierno {NAME}',
      fr: 'Or hivernal {NAME}',
      de: 'Wintergold-{NAME}',
      pt: 'Ouro de inverno {NAME}',
      it: 'Oro invernale {NAME}',
      tr: 'Kış Altın {NAME}',
      nl: 'Wintergoud {NAME}',
    }),
  },
  {
    // "Золотая X Хеллоуина" - женский род "Золотой X Хеллоуина".
    re: /^Золотая (.+) Хеллоуина$/,
    build: wrap({
      en: 'Halloween Gold {NAME}',
      es: '{NAME} dorado de Halloween',
      fr: 'Halloween Or {NAME}',
      de: 'Halloween-Gold-{NAME}',
      pt: 'Halloween Ouro {NAME}',
      it: 'Halloween Oro {NAME}',
      tr: 'Cadılar Bayramı Altın {NAME}',
      nl: 'Halloween Goud {NAME}',
    }),
  },
  {
    // "1 апреля золотой X" - "1 апреля" уже официально переведено как имя
    // скина (см. skins-i18n.json, тот же ключ "aprilfools" в gacha.xml).
    re: /^1 апреля золотой (.+)$/,
    build: wrap({
      en: 'April 1st Gold {NAME}',
      es: 'Oro del 1 de abril {NAME}',
      fr: 'Or 1er Avril {NAME}',
      de: '1. April Gold {NAME}',
      pt: 'Ouro 1º de abril {NAME}',
      it: 'Oro 1 Aprile {NAME}',
      tr: '1 Nisan Altın {NAME}',
      nl: '1 april Goud {NAME}',
    }),
  },
  {
    // "Октоберфеста Золотой X" - Oktoberfest уже официально переведено как
    // имя скина (см. skins-i18n.json, ключ "oktoberfest").
    re: /^Октоберфеста Золотой (.+)$/,
    build: wrap({
      en: 'Oktoberfest Gold {NAME}',
      es: 'Oktoberfest Oro {NAME}',
      fr: 'Oktoberfest Or {NAME}',
      de: 'Oktoberfest Gold {NAME}',
      pt: 'Oktoberfest Ouro {NAME}',
      it: 'Oktoberfest Oro {NAME}',
      tr: 'Oktoberfest Altın {NAME}',
      nl: 'Oktoberfest Goud {NAME}',
    }),
  },
  {
    // Голое "Пакет X" (без кавычек) - тот же перевод, что квотированный
    // "Пакет «X»" выше, просто без кавычек в источнике.
    re: /^Пакет (.+)$/,
    build: wrap({
      en: 'Pack {NAME}',
      es: 'Paquete {NAME}',
      fr: 'Pack {NAME}',
      de: 'Paket {NAME}',
      pt: 'Pacote {NAME}',
      it: 'Pacchetto {NAME}',
      tr: '{NAME} Paketi',
      nl: 'Pakket {NAME}',
    }),
  },
  {
    re: /^Суперпакет (.+)$/,
    build: wrap({
      en: 'Super Pack {NAME}',
      es: 'Superpaquete {NAME}',
      fr: 'Super Pack {NAME}',
      de: 'Superpaket {NAME}',
      pt: 'Superpacote {NAME}',
      it: 'Superpacchetto {NAME}',
      tr: 'Süper {NAME} Paketi',
      nl: 'Superpakket {NAME}',
    }),
  },
  {
    re: /^Элитный пакет (.+)$/,
    build: wrap({
      en: 'Elite Pack {NAME}',
      es: 'Paquete de élite {NAME}',
      fr: 'Pack élite {NAME}',
      de: 'Elite-Paket {NAME}',
      pt: 'Pacote de elite {NAME}',
      it: 'Pacchetto elite {NAME}',
      tr: 'Elit {NAME} Paketi',
      nl: 'Elitepakket {NAME}',
    }),
  },
  {
    re: /^Паладин (.+)$/,
    build: wrap({
      en: 'Paladin {NAME}',
      es: 'Paladín {NAME}',
      fr: 'Paladin {NAME}',
      de: 'Paladin {NAME}',
      pt: 'Paladino {NAME}',
      it: 'Paladino {NAME}',
      tr: 'Paladin {NAME}',
      nl: 'Paladijn {NAME}',
    }),
  },
  {
    re: /^Демонический (.+)$/,
    build: wrap({
      en: 'Demonic {NAME}',
      es: 'Demoníaco {NAME}',
      fr: 'Démoniaque {NAME}',
      de: 'Dämonischer {NAME}',
      pt: 'Demoníaco {NAME}',
      it: 'Demoniaco {NAME}',
      tr: 'Şeytani {NAME}',
      nl: 'Demonische {NAME}',
    }),
  },
]

// Батч 11 (3): 110 полностью свободных названий бандлов без имени мутанта
// и без живого itemId (см. коммит - разведка показала, что это авторский
// маркетинговый текст сайта/куратора, не игровые данные). Переведено вручную
// одним разом на все 8 языков - LLM ок для перевода уже решённого текста
// (не для изобретения новых имён, см. память feedback-no-llm-authored-names).
const FREEFORM_PAYLOAD_DICT: Record<string, Partial<Record<Locale, string>>> = {
  'Бронзовая Принцесса Космоса': {
    en: 'Bronze Space Princess',
    es: 'Princesa del Espacio de bronce',
    fr: "Princesse de l'Espace bronze",
    de: 'Bronze-Weltraumprinzessin',
    pt: 'Princesa do Espaço de bronze',
    it: 'Principessa dello Spazio di bronzo',
    tr: 'Bronz Uzay Prensesi',
    nl: 'Bronzen Ruimteprinses',
  },
  'Бронзовый Трехглаз': {
    en: 'Bronze Three-Eye',
    es: 'Tres Ojos de bronce',
    fr: 'Troisœil bronze',
    de: 'Bronze-Dreiauge',
    pt: 'Três Olhos de bronze',
    it: 'Tre Occhi di bronzo',
    tr: 'Bronz Üçgöz',
    nl: 'Bronzen Drieoog',
  },
  'Ветеран Пасхальное предложение': {
    en: 'Veteran Easter Offer',
    es: 'Oferta de Pascua para veteranos',
    fr: 'Offre de Pâques vétéran',
    de: 'Veteranen-Osterangebot',
    pt: 'Oferta de Páscoa veterano',
    it: 'Offerta di Pasqua veterano',
    tr: 'Kıdemli Paskalya Teklifi',
    nl: 'Veteranen Paasaanbieding',
  },
  'Галактический контейнер': {
    en: 'Galactic Container',
    es: 'Contenedor galáctico',
    fr: 'Conteneur galactique',
    de: 'Galaktischer Container',
    pt: 'Contêiner galáctico',
    it: 'Contenitore galattico',
    tr: 'Galaktik Konteyner',
    nl: 'Galactische Container',
  },
  'Ежедневное предложение по случаю 10-летнего юбилея': {
    en: '10th Anniversary Daily Offer',
    es: 'Oferta diaria del 10.º aniversario',
    fr: 'Offre quotidienne du 10e anniversaire',
    de: 'Tägliches Angebot zum 10. Jubiläum',
    pt: 'Oferta diária do 10.º aniversário',
    it: 'Offerta giornaliera del 10° anniversario',
    tr: '10. Yıl Dönümü Günlük Teklifi',
    nl: '10-jarig jubileum dagelijkse aanbieding',
  },
  'Ежедневное предложение по случаю 11-летнего юбилея': {
    en: '11th Anniversary Daily Offer',
    es: 'Oferta diaria del 11.º aniversario',
    fr: 'Offre quotidienne du 11e anniversaire',
    de: 'Tägliches Angebot zum 11. Jubiläum',
    pt: 'Oferta diária do 11.º aniversário',
    it: "Offerta giornaliera dell'11° anniversario",
    tr: '11. Yıl Dönümü Günlük Teklifi',
    nl: '11-jarig jubileum dagelijkse aanbieding',
  },
  'Ежедневное предложение по случаю 12-летнего юбилея': {
    en: '12th Anniversary Daily Offer',
    es: 'Oferta diaria del 12.º aniversario',
    fr: 'Offre quotidienne du 12e anniversaire',
    de: 'Tägliches Angebot zum 12. Jubiläum',
    pt: 'Oferta diária do 12.º aniversário',
    it: 'Offerta giornaliera del 12° anniversario',
    tr: '12. Yıl Dönümü Günlük Teklifi',
    nl: '12-jarig jubileum dagelijkse aanbieding',
  },
  'Зимний контейнер': {
    en: 'Winter Container',
    es: 'Contenedor de invierno',
    fr: "Conteneur d'hiver",
    de: 'Wintercontainer',
    pt: 'Contêiner de inverno',
    it: 'Contenitore invernale',
    tr: 'Kış Konteyneri',
    nl: 'Wintercontainer',
  },
  'Золотой Рождественский подарок': {
    en: 'Gold Christmas Gift',
    es: 'Regalo de Navidad dorado',
    fr: 'Cadeau de Noël or',
    de: 'Goldenes Weihnachtsgeschenk',
    pt: 'Presente de Natal dourado',
    it: 'Regalo di Natale oro',
    tr: 'Altın Noel Hediyesi',
    nl: 'Gouden Kerstcadeau',
  },
  'Золотой контейнер героя': {
    en: 'Gold Hero Container',
    es: 'Contenedor de héroe dorado',
    fr: 'Conteneur héros or',
    de: 'Goldener Helden-Container',
    pt: 'Contêiner de herói dourado',
    it: "Contenitore dell'eroe oro",
    tr: 'Altın Kahraman Konteyneri',
    nl: 'Gouden Heldencontainer',
  },
  'Золотой легендарный контейнер х2': {
    en: 'Gold Legendary Container x2',
    es: 'Contenedor legendario dorado x2',
    fr: 'Conteneur légendaire or x2',
    de: 'Goldener legendärer Container x2',
    pt: 'Contêiner lendário dourado x2',
    it: 'Contenitore leggendario oro x2',
    tr: 'Altın Efsanevi Konteyner x2',
    nl: 'Gouden Legendarische Container x2',
  },
  'Золотой молниеносный пакет': {
    en: 'Gold Lightning Pack',
    es: 'Paquete relámpago dorado',
    fr: 'Pack éclair or',
    de: 'Goldenes Blitzpaket',
    pt: 'Pacote relâmpago dourado',
    it: 'Pacchetto fulmine oro',
    tr: 'Altın Yıldırım Paketi',
    nl: 'Gouden Bliksempakket',
  },
  'Золотой танковый пакет': {
    en: 'Gold Tank Pack',
    es: 'Paquete de tanque dorado',
    fr: 'Pack tank or',
    de: 'Goldenes Tank-Paket',
    pt: 'Pacote tanque dourado',
    it: 'Pacchetto tank oro',
    tr: 'Altın Tank Paketi',
    nl: 'Gouden Tankpakket',
  },
  'Комплект механика': {
    en: 'Mechanic Kit',
    es: 'Kit de mecánico',
    fr: 'Kit de mécanicien',
    de: 'Mechaniker-Set',
    pt: 'Kit de mecânico',
    it: 'Kit del meccanico',
    tr: 'Tamirci Seti',
    nl: 'Monteurkit',
  },
  'Контейнер «Зодиак»': {
    en: 'Container "Zodiac"',
    es: 'Contenedor "Zodiaco"',
    fr: 'Conteneur « Zodiaque »',
    de: 'Container „Zodiac“',
    pt: 'Contêiner "Zodíaco"',
    it: 'Contenitore "Zodiaco"',
    tr: '"Zodyak" Konteyneri',
    nl: 'Container "Zodiac"',
  },
  'Контейнер героя': {
    en: 'Hero Container',
    es: 'Contenedor de héroe',
    fr: 'Conteneur héros',
    de: 'Helden-Container',
    pt: 'Contêiner de herói',
    it: "Contenitore dell'eroe",
    tr: 'Kahraman Konteyneri',
    nl: 'Heldencontainer',
  },
  'Контейнер мификов': {
    en: 'Mythic Container',
    es: 'Contenedor mítico',
    fr: 'Conteneur mythique',
    de: 'Mythischer Container',
    pt: 'Contêiner mítico',
    it: 'Contenitore mitico',
    tr: 'Mitik Konteyner',
    nl: 'Mythische Container',
  },
  'Контейнер с мутантом-Молниеносный': {
    en: 'Container with Lightning Mutant',
    es: 'Contenedor con mutante Relámpago',
    fr: 'Conteneur avec mutant Éclair',
    de: 'Container mit Blitz-Mutant',
    pt: 'Contêiner com mutante Relâmpago',
    it: 'Contenitore con mutante Fulmine',
    tr: 'Yıldırım Mutantlı Konteyner',
    nl: 'Container met Bliksem-mutant',
  },
  'Контейнер с мутантом-танком': {
    en: 'Container with Tank Mutant',
    es: 'Contenedor con mutante tanque',
    fr: 'Conteneur avec mutant tank',
    de: 'Container mit Tank-Mutant',
    pt: 'Contêiner com mutante tanque',
    it: 'Contenitore con mutante tank',
    tr: 'Tank Mutantlı Konteyner',
    nl: 'Container met Tank-mutant',
  },
  'Легендарный Мертвякконтейнер': {
    en: 'Legendary Zombie Container',
    es: 'Contenedor zombi legendario',
    fr: 'Conteneur zombie légendaire',
    de: 'Legendärer Zombie-Container',
    pt: 'Contêiner zumbi lendário',
    it: 'Contenitore zombie leggendario',
    tr: 'Efsanevi Zombi Konteyneri',
    nl: 'Legendarische Zombiecontainer',
  },
  'Легендарный золотой контейнер': {
    en: 'Legendary Gold Container',
    es: 'Contenedor legendario dorado',
    fr: 'Conteneur légendaire or',
    de: 'Legendärer goldener Container',
    pt: 'Contêiner lendário dourado',
    it: 'Contenitore leggendario oro',
    tr: 'Efsanevi Altın Konteyner',
    nl: 'Legendarische Gouden Container',
  },
  'Легендарный киберконтейнер': {
    en: 'Legendary Cyber Container',
    es: 'Contenedor cibernético legendario',
    fr: 'Conteneur cyber légendaire',
    de: 'Legendärer Cyber-Container',
    pt: 'Contêiner cibernético lendário',
    it: 'Contenitore cyber leggendario',
    tr: 'Efsanevi Siber Konteyner',
    nl: 'Legendarische Cybercontainer',
  },
  'Легендарный пакет': {
    en: 'Legendary Pack',
    es: 'Paquete legendario',
    fr: 'Pack légendaire',
    de: 'Legendäres Paket',
    pt: 'Pacote lendário',
    it: 'Pacchetto leggendario',
    tr: 'Efsanevi Paket',
    nl: 'Legendarisch pakket',
  },
  'Молниеносный пакет': {
    en: 'Lightning Pack',
    es: 'Paquete relámpago',
    fr: 'Pack éclair',
    de: 'Blitzpaket',
    pt: 'Pacote relâmpago',
    it: 'Pacchetto fulmine',
    tr: 'Yıldırım Paketi',
    nl: 'Bliksempakket',
  },
  'Новогоднее предложение': {
    en: 'New Year Offer',
    es: 'Oferta de Año Nuevo',
    fr: 'Offre du Nouvel An',
    de: 'Neujahrsangebot',
    pt: 'Oferta de Ano Novo',
    it: 'Offerta di Capodanno',
    tr: 'Yılbaşı Teklifi',
    nl: 'Nieuwjaarsaanbieding',
  },
  'Огненный пакет': {
    en: 'Fire Pack',
    es: 'Paquete de fuego',
    fr: 'Pack de feu',
    de: 'Feuerpaket',
    pt: 'Pacote de fogo',
    it: 'Pacchetto di fuoco',
    tr: 'Ateş Paketi',
    nl: 'Vuurpakket',
  },
  'Особое предложение на день рождения': {
    en: 'Special Birthday Offer',
    es: 'Oferta especial de cumpleaños',
    fr: "Offre spéciale d'anniversaire",
    de: 'Besonderes Geburtstagsangebot',
    pt: 'Oferta especial de aniversário',
    it: 'Offerta speciale di compleanno',
    tr: 'Özel Doğum Günü Teklifi',
    nl: 'Speciale verjaardagsaanbieding',
  },
  'Пакет «10-летня»': {
    en: 'Pack "10th Anniversary"',
    es: 'Paquete "10.º aniversario"',
    fr: '« 10e anniversaire »',
    de: 'Paket „10. Jubiläum“',
    pt: 'Pacote "10.º aniversário"',
    it: 'Pacchetto "10° anniversario"',
    tr: '"10. Yıl Dönümü" Paketi',
    nl: 'Pakket "10-jarig jubileum"',
  },
  'Пакет «Год петуха»': {
    en: 'Pack "Year of the Rooster"',
    es: 'Paquete "Año del Gallo"',
    fr: '« Année du Coq »',
    de: 'Paket „Jahr des Hahns“',
    pt: 'Pacote "Ano do Galo"',
    it: 'Pacchetto "Anno del Gallo"',
    tr: '"Horoz Yılı" Paketi',
    nl: 'Pakket "Jaar van de Haan"',
  },
  'Пакет «Год собаки»': {
    en: 'Pack "Year of the Dog"',
    es: 'Paquete "Año del Perro"',
    fr: '« Année du Chien »',
    de: 'Paket „Jahr des Hundes“',
    pt: 'Pacote "Ano do Cão"',
    it: 'Pacchetto "Anno del Cane"',
    tr: '"Köpek Yılı" Paketi',
    nl: 'Pakket "Jaar van de Hond"',
  },
  'Пакет «День святого Валентина»': {
    en: 'Pack "Valentine\'s Day"',
    es: 'Paquete "San Valentín"',
    fr: '« Saint-Valentin »',
    de: 'Paket „Valentinstag“',
    pt: 'Pacote "Dia dos Namorados"',
    it: 'Pacchetto "San Valentino"',
    tr: '"Sevgililer Günü" Paketi',
    nl: 'Pakket "Valentijnsdag"',
  },
  'Пакет «Джекпот»': {
    en: 'Pack "Jackpot"',
    es: 'Paquete "Bote"',
    fr: '« Jackpot »',
    de: 'Paket „Jackpot“',
    pt: 'Pacote "Jackpot"',
    it: 'Pacchetto "Jackpot"',
    tr: '"Jackpot" Paketi',
    nl: 'Pakket "Jackpot"',
  },
  'Пакет «Железный трон»': {
    en: 'Pack "Iron Throne"',
    es: 'Paquete "Trono de Hierro"',
    fr: '« Trône de fer »',
    de: 'Paket „Eiserner Thron“',
    pt: 'Pacote "Trono de Ferro"',
    it: 'Pacchetto "Trono di Ferro"',
    tr: '"Demir Taht" Paketi',
    nl: 'Pakket "IJzeren Troon"',
  },
  'Пакет «Зодиак»': {
    en: 'Pack "Zodiac"',
    es: 'Paquete "Zodiaco"',
    fr: '« Zodiaque »',
    de: 'Paket „Zodiac“',
    pt: 'Pacote "Zodíaco"',
    it: 'Pacchetto "Zodiaco"',
    tr: '"Zodyak" Paketi',
    nl: 'Pakket "Zodiac"',
  },
  'Пакет «Икс-27»': {
    en: 'Pack "X-27"',
    es: 'Paquete "X-27"',
    fr: '« X-27 »',
    de: 'Paket „X-27“',
    pt: 'Pacote "X-27"',
    it: 'Pacchetto "X-27"',
    tr: '"X-27" Paketi',
    nl: 'Pakket "X-27"',
  },
  'Пакет «Казино»': {
    en: 'Pack "Casino"',
    es: 'Paquete "Casino"',
    fr: '« Casino »',
    de: 'Paket „Casino“',
    pt: 'Pacote "Casino"',
    it: 'Pacchetto "Casinò"',
    tr: '"Kumarhane" Paketi',
    nl: 'Pakket "Casino"',
  },
  'Пакет «Контратака»': {
    en: 'Pack "Counterattack"',
    es: 'Paquete "Contraataque"',
    fr: '« Contre-attaque »',
    de: 'Paket „Gegenangriff“',
    pt: 'Pacote "Contra-ataque"',
    it: 'Pacchetto "Contrattacco"',
    tr: '"Karşı Saldırı" Paketi',
    nl: 'Pakket "Tegenaanval"',
  },
  'Пакет «Новый год»': {
    en: 'Pack "New Year"',
    es: 'Paquete "Año Nuevo"',
    fr: '« Nouvel An »',
    de: 'Paket „Neujahr“',
    pt: 'Pacote "Ano Novo"',
    it: 'Pacchetto "Capodanno"',
    tr: '"Yılbaşı" Paketi',
    nl: 'Pakket "Nieuwjaar"',
  },
  'Пакет «Проклятие»': {
    en: 'Pack "Curse"',
    es: 'Paquete "Maldición"',
    fr: '« Malédiction »',
    de: 'Paket „Fluch“',
    pt: 'Pacote "Maldição"',
    it: 'Pacchetto "Maledizione"',
    tr: '"Lanet" Paketi',
    nl: 'Pakket "Vloek"',
  },
  'Пакет «Силы добра»': {
    en: 'Pack "Forces of Good"',
    es: 'Paquete "Fuerzas del bien"',
    fr: '« Forces du bien »',
    de: 'Paket „Kräfte des Guten“',
    pt: 'Pacote "Forças do bem"',
    it: 'Pacchetto "Forze del bene"',
    tr: '"İyilik Güçleri" Paketi',
    nl: 'Pakket "Krachten van het Goede"',
  },
  'Пакет «Силы зла»': {
    en: 'Pack "Forces of Evil"',
    es: 'Paquete "Fuerzas del mal"',
    fr: '« Forces du mal »',
    de: 'Paket „Kräfte des Bösen“',
    pt: 'Pacote "Forças do mal"',
    it: 'Pacchetto "Forze del male"',
    tr: '"Kötülük Güçleri" Paketi',
    nl: 'Pakket "Krachten van het Kwaad"',
  },
  'Пакет «Скрещивание»': {
    en: 'Pack "Breeding"',
    es: 'Paquete "Cría"',
    fr: '« Élevage »',
    de: 'Paket „Zucht“',
    pt: 'Pacote "Cria"',
    it: 'Pacchetto "Incrocio"',
    tr: '"Üretim" Paketi',
    nl: 'Pakket "Fokken"',
  },
  'Пакет «Снова в школу»': {
    en: 'Pack "Back to School"',
    es: 'Paquete "Vuelta al cole"',
    fr: '« Rentrée scolaire »',
    de: 'Paket „Zurück zur Schule“',
    pt: 'Pacote "Volta às aulas"',
    it: 'Pacchetto "Ritorno a scuola"',
    tr: '"Okula Dönüş" Paketi',
    nl: 'Pakket "Terug naar school"',
  },
  'Пакет «Созвездие»': {
    en: 'Pack "Constellation"',
    es: 'Paquete "Constelación"',
    fr: '« Constellation »',
    de: 'Paket „Sternbild“',
    pt: 'Pacote "Constelação"',
    it: 'Pacchetto "Costellazione"',
    tr: '"Takımyıldız" Paketi',
    nl: 'Pakket "Sterrenbeeld"',
  },
  'Пакет «Хэллоуин»': {
    en: 'Pack "Halloween"',
    es: 'Paquete "Halloween"',
    fr: '« Halloween »',
    de: 'Paket „Halloween“',
    pt: 'Pacote "Halloween"',
    it: 'Pacchetto "Halloween"',
    tr: '"Cadılar Bayramı" Paketi',
    nl: 'Pakket "Halloween"',
  },
  'Пакет «Щит»': {
    en: 'Pack "Shield"',
    es: 'Paquete "Escudo"',
    fr: '« Bouclier »',
    de: 'Paket „Schild“',
    pt: 'Pacote "Escudo"',
    it: 'Pacchetto "Scudo"',
    tr: '"Kalkan" Paketi',
    nl: 'Pakket "Schild"',
  },
  'Пакет «манга»': {
    en: 'Pack "Manga"',
    es: 'Paquete "Manga"',
    fr: '« Manga »',
    de: 'Paket „Manga“',
    pt: 'Pacote "Manga"',
    it: 'Pacchetto "Manga"',
    tr: '"Manga" Paketi',
    nl: 'Pakket "Manga"',
  },
  'Пакет «спелеологии»': {
    en: 'Pack "Speleology"',
    es: 'Paquete "Espeleología"',
    fr: '« Spéléologie »',
    de: 'Paket „Höhlenforschung“',
    pt: 'Pacote "Espeleologia"',
    it: 'Pacchetto "Speleologia"',
    tr: '"Mağaracılık" Paketi',
    nl: 'Pakket "Speleologie"',
  },
  'Пакет Ворчуна Клауса': {
    en: 'Grumpy Claus Pack',
    es: 'Paquete Claus Gruñón',
    fr: 'Pack Père Fouettard',
    de: 'Grantiger-Klaus-Paket',
    pt: 'Pacote Claus Rabugento',
    it: 'Pacchetto Claus Burbero',
    tr: 'Huysuz Claus Paketi',
    nl: 'Chagrijnige Klaas-pakket',
  },
  'Пакет ветерана': {
    en: 'Veteran Pack',
    es: 'Paquete de veterano',
    fr: 'Pack vétéran',
    de: 'Veteranenpaket',
    pt: 'Pacote veterano',
    it: 'Pacchetto veterano',
    tr: 'Kıdemli Paketi',
    nl: 'Veteranenpakket',
  },
  'Пакет ветерана «10-летня»': {
    en: 'Veteran Pack "10th Anniversary"',
    es: 'Paquete de veterano "10.º aniversario"',
    fr: 'Pack vétéran « 10e anniversaire »',
    de: 'Veteranenpaket „10. Jubiläum“',
    pt: 'Pacote veterano "10.º aniversário"',
    it: 'Pacchetto veterano "10° anniversario"',
    tr: 'Kıdemli Paketi "10. Yıl Dönümü"',
    nl: 'Veteranenpakket "10-jarig jubileum"',
  },
  'Пакет ветерана «День святого Валентина»': {
    en: 'Veteran Pack "Valentine\'s Day"',
    es: 'Paquete de veterano "San Valentín"',
    fr: 'Pack vétéran « Saint-Valentin »',
    de: 'Veteranenpaket „Valentinstag“',
    pt: 'Pacote veterano "Dia dos Namorados"',
    it: 'Pacchetto veterano "San Valentino"',
    tr: 'Kıdemli Paketi "Sevgililer Günü"',
    nl: 'Veteranenpakket "Valentijnsdag"',
  },
  'Пакет ветерана «Новый год»': {
    en: 'Veteran Pack "New Year"',
    es: 'Paquete de veterano "Año Nuevo"',
    fr: 'Pack vétéran « Nouvel An »',
    de: 'Veteranenpaket „Neujahr“',
    pt: 'Pacote veterano "Ano Novo"',
    it: 'Pacchetto veterano "Capodanno"',
    tr: 'Kıdemli Paketi "Yılbaşı"',
    nl: 'Veteranenpakket "Nieuwjaar"',
  },
  'Пакет ветерана «Хэллоуин»': {
    en: 'Veteran Pack "Halloween"',
    es: 'Paquete de veterano "Halloween"',
    fr: 'Pack vétéran « Halloween »',
    de: 'Veteranenpaket „Halloween“',
    pt: 'Pacote veterano "Halloween"',
    it: 'Pacchetto veterano "Halloween"',
    tr: 'Kıdemli Paketi "Cadılar Bayramı"',
    nl: 'Veteranenpakket "Halloween"',
  },
  'Пакет ветерана «спелеологии»': {
    en: 'Veteran Pack "Speleology"',
    es: 'Paquete de veterano "Espeleología"',
    fr: 'Pack vétéran « Spéléologie »',
    de: 'Veteranenpaket „Höhlenforschung“',
    pt: 'Pacote veterano "Espeleologia"',
    it: 'Pacchetto veterano "Speleologia"',
    tr: 'Kıdemli Paketi "Mağaracılık"',
    nl: 'Veteranenpakket "Speleologie"',
  },
  'Пакет вытягивания жизни': {
    en: 'Life Drain Pack',
    es: 'Paquete de absorción de vida',
    fr: 'Pack vol de vie',
    de: 'Lebensraub-Paket',
    pt: 'Pacote de dreno de vida',
    it: 'Pacchetto assorbimento vita',
    tr: 'Can Emme Paketi',
    nl: 'Levensroof-pakket',
  },
  'Пакет для начинающих': {
    en: 'Beginner Pack',
    es: 'Paquete para principiantes',
    fr: 'Pack débutant',
    de: 'Anfängerpaket',
    pt: 'Pacote para iniciantes',
    it: 'Pacchetto principianti',
    tr: 'Başlangıç Paketi',
    nl: 'Beginnerspakket',
  },
  'Пакет кролика': {
    en: 'Rabbit Pack',
    es: 'Paquete de conejo',
    fr: 'Pack lapin',
    de: 'Hasenpaket',
    pt: 'Pacote de coelho',
    it: 'Pacchetto coniglio',
    tr: 'Tavşan Paketi',
    nl: 'Konijnenpakket',
  },
  'Пакет лояльности — 1 год': {
    en: 'Loyalty Pack - 1 year',
    es: 'Paquete de lealtad: 1 año',
    fr: 'Pack fidélité - 1 an',
    de: 'Treuepaket - 1 Jahr',
    pt: 'Pacote de fidelidade - 1 ano',
    it: 'Pacchetto fedeltà - 1 anno',
    tr: 'Sadakat Paketi - 1 yıl',
    nl: 'Loyaliteitspakket - 1 jaar',
  },
  'Пакет лояльности — 2 года': {
    en: 'Loyalty Pack - 2 years',
    es: 'Paquete de lealtad: 2 años',
    fr: 'Pack fidélité - 2 ans',
    de: 'Treuepaket - 2 Jahre',
    pt: 'Pacote de fidelidade - 2 anos',
    it: 'Pacchetto fedeltà - 2 anni',
    tr: 'Sadakat Paketi - 2 yıl',
    nl: 'Loyaliteitspakket - 2 jaar',
  },
  'Пакет лояльности — 3 года': {
    en: 'Loyalty Pack - 3 years',
    es: 'Paquete de lealtad: 3 años',
    fr: 'Pack fidélité - 3 ans',
    de: 'Treuepaket - 3 Jahre',
    pt: 'Pacote de fidelidade - 3 anos',
    it: 'Pacchetto fedeltà - 3 anni',
    tr: 'Sadakat Paketi - 3 yıl',
    nl: 'Loyaliteitspakket - 3 jaar',
  },
  'Пакет мастера': {
    en: 'Master Pack',
    es: 'Paquete de maestro',
    fr: 'Pack maître',
    de: 'Meisterpaket',
    pt: 'Pacote de mestre',
    it: 'Pacchetto maestro',
    tr: 'Usta Paketi',
    nl: 'Meesterpakket',
  },
  'Пакет новичка': {
    en: 'Newbie Pack',
    es: 'Paquete de novato',
    fr: 'Pack débutant',
    de: 'Neulingspaket',
    pt: 'Pacote de novato',
    it: 'Pacchetto novizio',
    tr: 'Acemi Paketi',
    nl: 'Nieuwelingenpakket',
  },
  'Пакет новобранца': {
    en: 'Recruit Pack',
    es: 'Paquete de recluta',
    fr: 'Pack recrue',
    de: 'Rekrutenpaket',
    pt: 'Pacote de recruta',
    it: 'Pacchetto recluta',
    tr: 'Acemi Er Paketi',
    nl: 'Rekrutenpakket',
  },
  'Пасхальное золотой Художник Синигами': {
    en: 'Easter Gold Shinigami Artist',
    es: 'Artista Shinigami dorado de Pascua',
    fr: 'Artiste Shinigami or de Pâques',
    de: 'Oster-Gold-Shinigami-Künstler',
    pt: 'Artista Shinigami dourado de Páscoa',
    it: 'Artista Shinigami oro di Pasqua',
    tr: 'Paskalya Altın Shinigami Sanatçı',
    nl: 'Pasen Gouden Shinigami Kunstenaar',
  },
  'Пасхальное предложение': {
    en: 'Easter Offer',
    es: 'Oferta de Pascua',
    fr: 'Offre de Pâques',
    de: 'Osterangebot',
    pt: 'Oferta de Páscoa',
    it: 'Offerta di Pasqua',
    tr: 'Paskalya Teklifi',
    nl: 'Paasaanbieding',
  },
  'Пасхальный таинственный контейнер': {
    en: 'Easter Mystery Container',
    es: 'Contenedor misterioso de Pascua',
    fr: 'Conteneur mystère de Pâques',
    de: 'Oster-Mystery-Container',
    pt: 'Contêiner misterioso de Páscoa',
    it: 'Contenitore misterioso di Pasqua',
    tr: 'Paskalya Gizem Konteyneri',
    nl: 'Paasmysteriecontainer',
  },
  'Праздничный пакет': {
    en: 'Holiday Pack',
    es: 'Paquete festivo',
    fr: 'Pack festif',
    de: 'Feiertagspaket',
    pt: 'Pacote festivo',
    it: 'Pacchetto festivo',
    tr: 'Bayram Paketi',
    nl: 'Feestpakket',
  },
  'Предложение Евы': {
    en: "Eve's Offer",
    es: 'Oferta de Eva',
    fr: "Offre d'Eve",
    de: 'Evas Angebot',
    pt: 'Oferta de Eva',
    it: 'Offerta di Eva',
    tr: 'Eve Teklifi',
    nl: "Eve's aanbieding",
  },
  'Предложение адвент-календаря': {
    en: 'Advent Calendar Offer',
    es: 'Oferta del calendario de adviento',
    fr: "Offre du calendrier de l'Avent",
    de: 'Adventskalender-Angebot',
    pt: 'Oferta do calendário do advento',
    it: "Offerta del calendario dell'Avvento",
    tr: 'Advent Takvimi Teklifi',
    nl: 'Adventskalenderaanbieding',
  },
  'Предложение контейнеров': {
    en: 'Containers Offer',
    es: 'Oferta de contenedores',
    fr: 'Offre de conteneurs',
    de: 'Container-Angebot',
    pt: 'Oferta de contêineres',
    it: 'Offerta contenitori',
    tr: 'Konteyner Teklifi',
    nl: 'Containeraanbieding',
  },
  'Предложение контейнеров мификов': {
    en: 'Mythic Containers Offer',
    es: 'Oferta de contenedores míticos',
    fr: 'Offre de conteneurs mythiques',
    de: 'Angebot für mythische Container',
    pt: 'Oferta de contêineres míticos',
    it: 'Offerta contenitori mitici',
    tr: 'Mitik Konteyner Teklifi',
    nl: 'Mythische containeraanbieding',
  },
  'Предложение мутантов': {
    en: 'Mutants Offer',
    es: 'Oferta de mutantes',
    fr: 'Offre de mutants',
    de: 'Mutanten-Angebot',
    pt: 'Oferta de mutantes',
    it: 'Offerta mutanti',
    tr: 'Mutant Teklifi',
    nl: 'Mutantenaanbieding',
  },
  'Предложение на День святого Валентина': {
    en: "Valentine's Day Offer",
    es: 'Oferta de San Valentín',
    fr: 'Offre de la Saint-Valentin',
    de: 'Valentinstag-Angebot',
    pt: 'Oferta do Dia dos Namorados',
    it: 'Offerta di San Valentino',
    tr: 'Sevgililer Günü Teklifi',
    nl: 'Valentijnsdagaanbieding',
  },
  'Престижное Пасхальное предложение': {
    en: 'Prestige Easter Offer',
    es: 'Oferta de Pascua de prestigio',
    fr: 'Offre de Pâques prestige',
    de: 'Oster-Prestige-Angebot',
    pt: 'Oferta de Páscoa de prestígio',
    it: 'Offerta di Pasqua prestigio',
    tr: 'Prestij Paskalya Teklifi',
    nl: 'Prestige Paasaanbieding',
  },
  'Престижный пакет': {
    en: 'Prestige Pack',
    es: 'Paquete de prestigio',
    fr: 'Pack prestige',
    de: 'Prestige-Paket',
    pt: 'Pacote de prestígio',
    it: 'Pacchetto prestigio',
    tr: 'Prestij Paketi',
    nl: 'Prestigepakket',
  },
  'Престижный пакет «10-летня»': {
    en: 'Prestige Pack "10th Anniversary"',
    es: 'Paquete de prestigio "10.º aniversario"',
    fr: 'Pack prestige « 10e anniversaire »',
    de: 'Prestige-Paket „10. Jubiläum“',
    pt: 'Pacote de prestígio "10.º aniversário"',
    it: 'Pacchetto prestigio "10° anniversario"',
    tr: 'Prestij Paketi "10. Yıl Dönümü"',
    nl: 'Prestigepakket "10-jarig jubileum"',
  },
  'Престижный пакет «День святого Валентина»': {
    en: 'Prestige Pack "Valentine\'s Day"',
    es: 'Paquete de prestigio "San Valentín"',
    fr: 'Pack prestige « Saint-Valentin »',
    de: 'Prestige-Paket „Valentinstag“',
    pt: 'Pacote de prestígio "Dia dos Namorados"',
    it: 'Pacchetto prestigio "San Valentino"',
    tr: 'Prestij Paketi "Sevgililer Günü"',
    nl: 'Prestigepakket "Valentijnsdag"',
  },
  'Престижный пакет «Хэллоуин»': {
    en: 'Prestige Pack "Halloween"',
    es: 'Paquete de prestigio "Halloween"',
    fr: 'Pack prestige « Halloween »',
    de: 'Prestige-Paket „Halloween“',
    pt: 'Pacote de prestígio "Halloween"',
    it: 'Pacchetto prestigio "Halloween"',
    tr: 'Prestij Paketi "Cadılar Bayramı"',
    nl: 'Prestigepakket "Halloween"',
  },
  'Престижный пакет «спелеологии»': {
    en: 'Prestige Pack "Speleology"',
    es: 'Paquete de prestigio "Espeleología"',
    fr: 'Pack prestige « Spéléologie »',
    de: 'Prestige-Paket „Höhlenforschung“',
    pt: 'Pacote de prestígio "Espeleologia"',
    it: 'Pacchetto prestigio "Speleologia"',
    tr: 'Prestij Paketi "Mağaracılık"',
    nl: 'Prestigepakket "Speleologie"',
  },
  'Рождественский Престижный пакет': {
    en: 'Christmas Prestige Pack',
    es: 'Paquete de prestigio navideño',
    fr: 'Pack prestige de Noël',
    de: 'Weihnachts-Prestige-Paket',
    pt: 'Pacote de prestígio de Natal',
    it: 'Pacchetto prestigio natalizio',
    tr: 'Noel Prestij Paketi',
    nl: 'Kerst Prestigepakket',
  },
  'Рождественский пакет': {
    en: 'Christmas Pack',
    es: 'Paquete navideño',
    fr: 'Pack de Noël',
    de: 'Weihnachtspaket',
    pt: 'Pacote de Natal',
    it: 'Pacchetto natalizio',
    tr: 'Noel Paketi',
    nl: 'Kerstpakket',
  },
  'Рождественский суперпакет': {
    en: 'Christmas Super Pack',
    es: 'Superpaquete navideño',
    fr: 'Super pack de Noël',
    de: 'Weihnachts-Superpaket',
    pt: 'Superpacote de Natal',
    it: 'Super pacchetto natalizio',
    tr: 'Noel Süper Paketi',
    nl: 'Kerst Superpakket',
  },
  'Рождественское предложение контейнеров': {
    en: 'Christmas Containers Offer',
    es: 'Oferta navideña de contenedores',
    fr: 'Offre de conteneurs de Noël',
    de: 'Weihnachts-Container-Angebot',
    pt: 'Oferta de contêineres de Natal',
    it: 'Offerta contenitori natalizia',
    tr: 'Noel Konteyner Teklifi',
    nl: 'Kerst containeraanbieding',
  },
  'Рождественское предложение контейнеров 5': {
    en: 'Christmas Containers Offer 5',
    es: 'Oferta navideña de contenedores 5',
    fr: 'Offre de conteneurs de Noël 5',
    de: 'Weihnachts-Container-Angebot 5',
    pt: 'Oferta de contêineres de Natal 5',
    it: 'Offerta contenitori natalizia 5',
    tr: 'Noel Konteyner Teklifi 5',
    nl: 'Kerst containeraanbieding 5',
  },
  "Серебряные Bones 'n' Roses": {
    en: "Silver Bones 'n' Roses",
    es: "Bones 'n' Roses de plata",
    fr: "Bones 'n' Roses argent",
    de: "Silber Bones 'n' Roses",
    pt: "Bones 'n' Roses de prata",
    it: "Bones 'n' Roses argento",
    tr: "Gümüş Bones 'n' Roses",
    nl: "Zilveren Bones 'n' Roses",
  },
  'Серебряный Вампара': {
    en: 'Silver Vampara',
    es: 'Vampara de plata',
    fr: 'Vampara argent',
    de: 'Silber-Vampara',
    pt: 'Vampara de prata',
    it: 'Vampara argento',
    tr: 'Gümüş Vampara',
    nl: 'Zilveren Vampara',
  },
  'Серебряный Король Мимфиса': {
    en: 'Silver King of Mimfis',
    es: 'Rey de Mimfis de plata',
    fr: 'Roi de Mimfis argent',
    de: 'Silber-König von Mimfis',
    pt: 'Rei de Mimfis de prata',
    it: 'Re di Mimfis argento',
    tr: 'Gümüş Mimfis Kralı',
    nl: 'Zilveren Koning van Mimfis',
  },
  'Серебряный Художник Синигами': {
    en: 'Silver Shinigami Artist',
    es: 'Artista Shinigami de plata',
    fr: 'Artiste Shinigami argent',
    de: 'Silber-Shinigami-Künstler',
    pt: 'Artista Shinigami de prata',
    it: 'Artista Shinigami argento',
    tr: 'Gümüş Shinigami Sanatçı',
    nl: 'Zilveren Shinigami Kunstenaar',
  },
  'Серебряный контейнер «Зодиак»': {
    en: 'Silver Container "Zodiac"',
    es: 'Contenedor de plata "Zodiaco"',
    fr: 'Conteneur argent « Zodiaque »',
    de: 'Silber-Container „Zodiac“',
    pt: 'Contêiner de prata "Zodíaco"',
    it: 'Contenitore argento "Zodiaco"',
    tr: 'Gümüş "Zodyak" Konteyneri',
    nl: 'Zilveren Container "Zodiac"',
  },
  'Спецпредложение «Тёмный Лорд»': {
    en: 'Special Offer "Dark Lord"',
    es: 'Oferta especial "Señor Oscuro"',
    fr: '« Seigneur Noir »',
    de: 'Sonderangebot „Dunkler Lord“',
    pt: 'Oferta especial "Senhor das Trevas"',
    it: 'Offerta speciale "Signore Oscuro"',
    tr: 'Özel Teklif "Karanlık Lord"',
    nl: 'Speciale aanbieding "Duistere Heer"',
  },
  'Сундук «Исследование III»': {
    en: 'Chest "Research III"',
    es: 'Cofre "Investigación III"',
    fr: '« Recherche III »',
    de: 'Truhe „Forschung III“',
    pt: 'Baú "Pesquisa III"',
    it: 'Forziere "Ricerca III"',
    tr: '"Araştırma III" Sandığı',
    nl: 'Kist "Onderzoek III"',
  },
  'Сундук «Исследование II»': {
    en: 'Chest "Research II"',
    es: 'Cofre "Investigación II"',
    fr: '« Recherche II »',
    de: 'Truhe „Forschung II“',
    pt: 'Baú "Pesquisa II"',
    it: 'Forziere "Ricerca II"',
    tr: '"Araştırma II" Sandığı',
    nl: 'Kist "Onderzoek II"',
  },
  'Сундук «Исследование IV»': {
    en: 'Chest "Research IV"',
    es: 'Cofre "Investigación IV"',
    fr: '« Recherche IV »',
    de: 'Truhe „Forschung IV“',
    pt: 'Baú "Pesquisa IV"',
    it: 'Forziere "Ricerca IV"',
    tr: '"Araştırma IV" Sandığı',
    nl: 'Kist "Onderzoek IV"',
  },
  'Сундук «Исследование VI»': {
    en: 'Chest "Research VI"',
    es: 'Cofre "Investigación VI"',
    fr: '« Recherche VI »',
    de: 'Truhe „Forschung VI“',
    pt: 'Baú "Pesquisa VI"',
    it: 'Forziere "Ricerca VI"',
    tr: '"Araştırma VI" Sandığı',
    nl: 'Kist "Onderzoek VI"',
  },
  'Суперпакет «Юбилейная»': {
    en: 'Super Pack "Anniversary"',
    es: 'Superpaquete "Aniversario"',
    fr: '« Anniversaire »',
    de: 'Superpaket „Jubiläum“',
    pt: 'Superpacote "Aniversário"',
    it: 'Super pacchetto "Anniversario"',
    tr: '"Yıl Dönümü" Süper Paketi',
    nl: 'Superpakket "Jubileum"',
  },
  'Таинственный контейнер «Перекрестные реальности»': {
    en: 'Mystery Container "Crossed Realities"',
    es: 'Contenedor misterioso "Realidades cruzadas"',
    fr: '« Réalités croisées »',
    de: 'Mystery-Container „Gekreuzte Realitäten“',
    pt: 'Contêiner misterioso "Realidades cruzadas"',
    it: 'Contenitore misterioso "Realtà incrociate"',
    tr: '"Kesişen Gerçeklikler" Gizem Konteyneri',
    nl: 'Mysteriecontainer "Gekruiste realiteiten"',
  },
  'Таинственный контейнер св. Валентина': {
    en: "Valentine's Mystery Container",
    es: 'Contenedor misterioso de San Valentín',
    fr: 'Conteneur mystère Saint-Valentin',
    de: 'Valentinstag-Mystery-Container',
    pt: 'Contêiner misterioso Dia dos Namorados',
    it: 'Contenitore misterioso San Valentino',
    tr: 'Sevgililer Günü Gizem Konteyneri',
    nl: 'Valentijn Mysteriecontainer',
  },
  'Тайная коробка Заговор': {
    en: 'Secret Box Conspiracy',
    es: 'Caja secreta Conspiración',
    fr: 'Boîte secrète Conspiration',
    de: 'Geheimbox Verschwörung',
    pt: 'Caixa secreta Conspiração',
    it: 'Scatola segreta Cospirazione',
    tr: 'Gizli Kutu Komplo',
    nl: 'Geheime Doos Samenzwering',
  },
  'Тайное мутобезумие': {
    en: 'Secret Mutant Madness',
    es: 'Locura mutante secreta',
    fr: 'Folie mutante secrète',
    de: 'Geheimer Mutanten-Wahnsinn',
    pt: 'Loucura mutante secreta',
    it: 'Follia mutante segreta',
    tr: 'Gizli Mutant Çılgınlığı',
    nl: 'Geheime Mutantenwaanzin',
  },
  'Танковый пакет': {
    en: 'Tank Pack',
    es: 'Paquete de tanque',
    fr: 'Pack tank',
    de: 'Tank-Paket',
    pt: 'Pacote tanque',
    it: 'Pacchetto tank',
    tr: 'Tank Paketi',
    nl: 'Tankpakket',
  },
  'Уникальное предложение': {
    en: 'Unique Offer',
    es: 'Oferta única',
    fr: 'Offre unique',
    de: 'Einzigartiges Angebot',
    pt: 'Oferta única',
    it: 'Offerta unica',
    tr: 'Eşsiz Teklif',
    nl: 'Unieke aanbieding',
  },
  'Усиленный контейнер': {
    en: 'Enhanced Container',
    es: 'Contenedor mejorado',
    fr: 'Conteneur amélioré',
    de: 'Verstärkter Container',
    pt: 'Contêiner aprimorado',
    it: 'Contenitore potenziato',
    tr: 'Geliştirilmiş Konteyner',
    nl: 'Verbeterde Container',
  },
  'Усиленный контейнер «Мертвяк»': {
    en: 'Enhanced Container "Zombie"',
    es: 'Contenedor mejorado "Zombi"',
    fr: 'Conteneur amélioré « Zombie »',
    de: 'Verstärkter Container „Zombie“',
    pt: 'Contêiner aprimorado "Zumbi"',
    it: 'Contenitore potenziato "Zombie"',
    tr: 'Geliştirilmiş "Zombi" Konteyneri',
    nl: 'Verbeterde Container "Zombie"',
  },
  // "Рубака" = "Saber" - подтверждено официально через itemId LuckyBox_Saber_Elite
  // (уже резолвится в obtain-names.{lang}.json), слово выделено диффом против
  // LuckyBox_Necro_Elite/LuckyBox_Galactic_Elite в том же шаблоне "Elite Mystery
  // Box <X>", не придумано.
  'Усиленный контейнер «Рубака»': {
    en: 'Enhanced Container "Saber"',
    es: 'Contenedor mejorado "Sable"',
    fr: 'Conteneur amélioré « Sabre »',
    de: 'Verstärkter Container „Säbelrassler“',
    pt: 'Contêiner aprimorado "Sabre"',
    it: 'Contenitore potenziato "Sciabola"',
    tr: 'Geliştirilmiş "Süvari" Konteyneri',
    nl: 'Verbeterde Container "Sabel"',
  },
  Рубакаконтейнер: {
    en: 'container "Saber"',
    es: 'contenedor "Sable"',
    fr: '« Sabre »',
    de: 'Container „Säbelrassler“',
    pt: 'contêiner "Sabre"',
    it: 'contenitore "Sciabola"',
    tr: '"Süvari" konteyneri',
    nl: 'container "Sabel"',
  },
  'Эксклюзивный пакет': {
    en: 'Exclusive Pack',
    es: 'Paquete exclusivo',
    fr: 'Pack exclusif',
    de: 'Exklusivpaket',
    pt: 'Pacote exclusivo',
    it: 'Pacchetto esclusivo',
    tr: 'Özel Paket',
    nl: 'Exclusief pakket',
  },
  'Юбилейная коробка': {
    en: 'Anniversary Box',
    es: 'Caja de aniversario',
    fr: "Boîte d'anniversaire",
    de: 'Jubiläumsbox',
    pt: 'Caixa de aniversário',
    it: 'Scatola anniversario',
    tr: 'Yıl Dönümü Kutusu',
    nl: 'Jubileumdoos',
  },
  'контейнер «Хэллоуин»': {
    en: 'container "Halloween"',
    es: 'contenedor "Halloween"',
    fr: '« Halloween »',
    de: 'Container „Halloween“',
    pt: 'contêiner "Halloween"',
    it: 'contenitore "Halloween"',
    tr: '"Cadılar Bayramı" konteyneri',
    nl: 'container "Halloween"',
  },
  'контейнер мификов': {
    en: 'mythic container',
    es: 'contenedor mítico',
    fr: 'conteneur mythique',
    de: 'mythischer Container',
    pt: 'contêiner mítico',
    it: 'contenitore mitico',
    tr: 'mitik konteyner',
    nl: 'mythische container',
  },
  'элитный контейнер «Киборг»': {
    en: 'elite container "Cyborg"',
    es: 'contenedor de élite "Cíborg"',
    fr: '« Cyborg »',
    de: 'Elite-Container „Cyborg“',
    pt: 'contêiner de elite "Ciborgue"',
    it: 'contenitore elite "Cyborg"',
    tr: 'elit "Cyborg" konteyneri',
    nl: 'elite container "Cyborg"',
  },
  'элитный контейнер «зооморфа»': {
    en: 'elite container "zoomorph"',
    es: 'contenedor de élite "zoomorfo"',
    fr: '« zoomorphe »',
    de: 'Elite-Container „Zoomorph“',
    pt: 'contêiner de elite "zoomorfo"',
    it: 'contenitore elite "zoomorfo"',
    tr: 'elit "zoomorf" konteyneri',
    nl: 'elite container "zoömorf"',
  },
}

function resolveTierName(
  payload: string,
  locale: Locale,
  mutantNames: Record<string, { name: string }>,
): string | null {
  const m = payload.match(/^(\S+)\s+(.+)$/)
  if (!m) return null
  const tierKey = TIER_ADJ_TO_KEY[m[1].toLowerCase()]
  if (!tierKey) return null
  const mutantId = mutantIdByAnyName(m[2])
  if (!mutantId) return null
  const name = mutantNames[mutantId]?.name ?? m[2]
  return `${tierLabel(m[1], tierKey, locale)} ${name}`
}

function resolveWrapperName(
  payload: string,
  locale: Locale,
  mutantNames: Record<string, { name: string }>,
): string | null {
  for (const rule of WRAPPER_RULES) {
    const m = payload.match(rule.re)
    if (!m) continue
    const mutantId = mutantIdByAnyName(m[1])
    if (!mutantId) continue
    const name = mutantNames[mutantId]?.name ?? m[1]
    return rule.build(name, locale)
  }
  return null
}

function resolvePayloadName(
  payload: string,
  locale: Locale,
  mutantNames: Record<string, { name: string }>,
): string | null {
  // Голое имя мутанта без тира/обёртки ("Набор: Андроид (120 золота)").
  const bareMutantId = mutantIdByAnyName(payload)
  if (bareMutantId) return mutantNames[bareMutantId]?.name ?? payload

  return (
    resolveTierName(payload, locale, mutantNames) ??
    resolveWrapperName(payload, locale, mutantNames) ??
    FREEFORM_PAYLOAD_DICT[payload]?.[locale] ??
    FREEFORM_PAYLOAD_DICT[payload]?.en ??
    (/[а-яА-ЯёЁ]/.test(payload) ? null : payload)
  )
}

function renderBundleBoxWhere(
  entry: { where: string; itemId?: string },
  locale: Locale,
  obtainNames: Record<string, string>,
  mutantNames: Record<string, { name: string }>,
): string {
  const prefixMatch = entry.where.match(/^(Набор|Лаки-бокс|Мистери-бокс):\s*/)
  const prefixRu = prefixMatch?.[1]
  const rest = prefixMatch ? entry.where.slice(prefixMatch[0].length) : entry.where

  const suffixMatch = rest.match(/\s*\(([^()]*)\)\s*$/)
  const suffixRaw = suffixMatch?.[1]
  const payload = suffixMatch ? rest.slice(0, suffixMatch.index).trim() : rest.trim()

  // itemId - приоритетный источник (официальная локализация), но когда его
  // нет в словаре (напр. trigger-offer id вида "#winGene-e-Specimen_AD_01" -
  // не настоящий shop-itemId, см. память obtain-trigger-offer-names-fixed) -
  // падаем на резолв по самому RU-payload'у ("Жукобот" - обычное имя
  // мутанта), а не сразу сдаёмся на голый RU.
  const translatedName =
    (entry.itemId ? obtainNames[entry.itemId] : undefined) ??
    resolvePayloadName(payload, locale, mutantNames)
  if (!translatedName) return entry.where

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
    return renderBundleBoxWhere(entry, locale, obtainNames, mutantNames)
  }

  if (entry.type === 'gold_shop' || entry.type === 'credits_shop') {
    const m = entry.where.match(
      /^Магазин за ([\d\s]+) (золота|серебра\/кредитов) \(версия: (\S+)\)$/,
    )
    if (!m) return entry.where
    const n = Number(m[1].replace(/\s/g, ''))
    const currencyKey: 'gold' | 'credits' = m[2] === 'золота' ? 'gold' : 'credits'
    const tierKey = TIER_ADJ_TO_KEY[m[3].toLowerCase()]
    const tpl = SHOP_TEMPLATE[locale] ?? SHOP_TEMPLATE.en
    if (!tpl || !tierKey) return entry.where
    return fillTemplate(tpl, {
      n: new Intl.NumberFormat(locale).format(n),
      currency: CURRENCY_DICT[currencyKey][locale] ?? CURRENCY_DICT[currencyKey].en ?? m[2],
      tier: tierLabel(m[3], tierKey, locale),
    })
  }

  if (entry.type === 'pvp') {
    if (entry.where === 'Награда за прогресс в ПВП/арене') {
      return PVP_PROGRESS_LABEL[locale] ?? PVP_PROGRESS_LABEL.en ?? entry.where
    }
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
    return (
      CROSSOVER_TEXT_DICT[entry.where]?.[locale] ??
      CROSSOVER_TEXT_DICT[entry.where]?.en ??
      entry.where
    )
  }

  if (
    entry.type === 'breeding' ||
    entry.type === 'breeding_duplicate' ||
    entry.type === 'unavailable'
  ) {
    return (
      STATIC_STRING_DICT[entry.where]?.[locale] ??
      STATIC_STRING_DICT[entry.where]?.en ??
      entry.where
    )
  }

  if (entry.type === 'gacha') {
    const m = entry.where.match(/^Реактор — (.+)$/)
    if (!m) return entry.where
    const label = GACHA_LABEL[locale] ?? GACHA_LABEL.en
    const name =
      GACHA_NAME_DICT[m[1]]?.[locale] ??
      GACHA_NAME_DICT[m[1]]?.en ??
      (gachaEventI18n as Record<string, { en?: string }>)[m[1]]?.en
    if (!label || !name) return entry.where
    return `${label} — ${name}`
  }

  if (entry.type === 'event_raid') {
    const m = entry.where.match(/^(Рейд|Лесенки): (.+)$/)
    if (!m) return entry.where
    const label =
      (m[1] === 'Рейд' ? RAID_LABEL : LADDER_LABEL)[locale] ??
      (m[1] === 'Рейд' ? RAID_LABEL : LADDER_LABEL).en
    if (!label) return entry.where

    const pitMatch = m[2].match(/^Яма: (.+)$/)
    if (pitMatch) {
      const geneKey = Object.entries(GENE_RU).find(([, v]) => v === pitMatch[1])?.[0]
      const pitLabel = PIT_LABEL[locale] ?? PIT_LABEL.en
      if (geneKey && pitLabel) return `${label}: ${pitLabel}: ${geneLabelL(geneKey, locale)}`
      return entry.where
    }

    const name =
      RAID_NAME_DICT[m[2]]?.[locale] ??
      RAID_NAME_DICT[m[2]]?.en ??
      (gachaEventI18n as Record<string, { en?: string }>)[m[2]]?.en
    if (!name) return entry.where
    return `${label}: ${name}`
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
