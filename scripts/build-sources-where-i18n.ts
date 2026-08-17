// sources.json "where" - не игровые данные Kobojo, а сайт-авторские
// лейблы источника предмета ("Бинго"/"Магазин"/"Пасхальный ивент 2021" и
// т.д.) - переводятся как обычный UI-текст (шаблон "тип + год"), не требуют
// официального источника. Имена мутантов в кавычках («Безумный Майк» и
// т.д.) РЕЗОЛВЯТСЯ через официальные переводы names.{locale}.json (556/556
// покрытие, см. mutant-names-i18n.ts) - MUTANT_ID_BY_RU_NAME ниже сопоставляет
// RU-имя источнику мутанта вручную (только для 3 конкретных ивентов, найденных
// в sources.json на 2026-08-17).
//
// Запуск: npx tsx scripts/build-sources-where-i18n.ts

import fs from 'fs/promises'
import path from 'path'

const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'] as const
type Locale = (typeof LOCALES)[number]

const MUTANT_ID_BY_RU_NAME: Record<string, string> = {
  'Сержант Сумерки': 'specimen_ac_10',
  'Безумный Майк': 'specimen_de_10',
  'Дрей, космический корги': 'specimen_de_11',
}

async function loadMutantNames(): Promise<Record<Locale, Record<string, { name: string }>>> {
  const out = {} as Record<Locale, Record<string, { name: string }>>
  for (const locale of LOCALES) {
    out[locale] = JSON.parse(
      await fs.readFile(
        path.join(process.cwd(), `src/data/mutants/names.${locale}.json`),
        'utf-8',
      ),
    )
  }
  return out
}

function mutantName(
  ru: string,
  locale: Locale,
  mutantNames: Record<Locale, Record<string, { name: string }>>,
): string {
  const id = MUTANT_ID_BY_RU_NAME[ru]
  const translated = id && mutantNames[locale][id]?.name
  if (!translated) {
    console.warn(
      `[build-sources-where-i18n] нет записи в MUTANT_ID_BY_RU_NAME для «${ru}» - оставлен RU-фолбэк`,
    )
    return ru
  }
  return translated
}

const W: Record<string, Record<Locale, string>> = {
  bingo: {
    en: 'Bingo',
    es: 'Bingo',
    fr: 'Bingo',
    de: 'Bingo',
    pt: 'Bingo',
    it: 'Bingo',
    tr: 'Bingo',
    nl: 'Bingo',
  },
  shop: {
    en: 'Shop',
    es: 'Tienda',
    fr: 'Boutique',
    de: 'Shop',
    pt: 'Loja',
    it: 'Negozio',
    tr: 'Mağaza',
    nl: 'Winkel',
  },
  shopResources: {
    en: 'Shop (Resources)',
    es: 'Tienda (Recursos)',
    fr: 'Boutique (Ressources)',
    de: 'Shop (Ressourcen)',
    pt: 'Loja (Recursos)',
    it: 'Negozio (Risorse)',
    tr: 'Mağaza (Kaynaklar)',
    nl: 'Winkel (Grondstoffen)',
  },
  divisionReward: {
    en: 'Division reward',
    es: 'Recompensa de división',
    fr: 'Récompense de division',
    de: 'Divisionsbelohnung',
    pt: 'Recompensa de divisão',
    it: 'Ricompensa di divisione',
    tr: 'Lig ödülü',
    nl: 'Divisiebeloning',
  },
  raids: {
    en: 'Raids',
    es: 'Incursiones',
    fr: 'Raids',
    de: 'Raids',
    pt: 'Raides',
    it: 'Raid',
    tr: 'Baskınlar',
    nl: 'Raids',
  },
  craftLadders: {
    en: 'Crafting, ladders',
    es: 'Fabricación, escaleras',
    fr: 'Craft, échelles',
    de: 'Crafting, Ligas',
    pt: 'Crafting, escadas',
    it: 'Crafting, scalate',
    tr: 'Üretim, ligler',
    nl: 'Crafting, ladders',
  },
  campaignsEtc: {
    en: 'Campaigns, ladders, crafting and other activities',
    es: 'Campañas, escaleras, fabricación y otras actividades',
    fr: 'Campagnes, échelles, craft et autres activités',
    de: 'Kampagnen, Ligen, Crafting und andere Aktivitäten',
    pt: 'Campanhas, escadas, crafting e outras atividades',
    it: 'Campagne, scalate, crafting e altre attività',
    tr: 'Kampanyalar, ligler, üretim ve diğer etkinlikler',
    nl: 'Campagnes, ladders, crafting en andere activiteiten',
  },
  gameAnniversary: {
    en: 'Game anniversary',
    es: 'Aniversario del juego',
    fr: 'Anniversaire du jeu',
    de: 'Spiel-Jubiläum',
    pt: 'Aniversário do jogo',
    it: 'Anniversario del gioco',
    tr: 'Oyun yıl dönümü',
    nl: 'Spelverjaardag',
  },
  ordinal7th: { en: '7th', es: '7.º', fr: '7e', de: '7.', pt: '7.º', it: '7°', tr: '7.', nl: '7e' },
  easterEvent: {
    en: 'Easter event',
    es: 'Evento de Pascua',
    fr: 'Événement de Pâques',
    de: 'Oster-Event',
    pt: 'Evento de Páscoa',
    it: 'Evento di Pasqua',
    tr: 'Paskalya etkinliği',
    nl: 'Paasevenement',
  },
  halloween: {
    en: 'Halloween',
    es: 'Halloween',
    fr: 'Halloween',
    de: 'Halloween',
    pt: 'Halloween',
    it: 'Halloween',
    tr: 'Halloween',
    nl: 'Halloween',
  },
  exactYearUnknown: {
    en: 'exact year unknown',
    es: 'año exacto desconocido',
    fr: 'année exacte inconnue',
    de: 'genaues Jahr unbekannt',
    pt: 'ano exato desconhecido',
    it: 'anno esatto sconosciuto',
    tr: 'kesin yıl bilinmiyor',
    nl: 'exact jaar onbekend',
  },
  christmas: {
    en: 'Christmas',
    es: 'Navidad',
    fr: 'Noël',
    de: 'Weihnachten',
    pt: 'Natal',
    it: 'Natale',
    tr: 'Noel',
    nl: 'Kerstmis',
  },
  christmasEvent: {
    en: 'Christmas event',
    es: 'Evento de Navidad',
    fr: 'Événement de Noël',
    de: 'Weihnachts-Event',
    pt: 'Evento de Natal',
    it: 'Evento di Natale',
    tr: 'Noel etkinliği',
    nl: 'Kerstevenement',
  },
  valentinesEvent: {
    en: "Valentine's Day event",
    es: 'Evento de San Valentín',
    fr: 'Événement de la Saint-Valentin',
    de: 'Valentinstag-Event',
    pt: 'Evento do Dia dos Namorados',
    it: 'Evento di San Valentino',
    tr: 'Sevgililer Günü etkinliği',
    nl: 'Valentijnsdagevenement',
  },
  mysteryEvents: {
    en: 'Mystery events',
    es: 'Eventos misteriosos',
    fr: 'Événements mystérieux',
    de: 'Mystery-Events',
    pt: 'Eventos misteriosos',
    it: 'Eventi misteriosi',
    tr: 'Gizem etkinlikleri',
    nl: 'Mysterie-evenementen',
  },
  winterEvent: {
    en: 'Winter event',
    es: 'Evento de invierno',
    fr: 'Événement hivernal',
    de: 'Winter-Event',
    pt: 'Evento de inverno',
    it: 'Evento invernale',
    tr: 'Kış etkinliği',
    nl: 'Winterevenement',
  },
  mysticEvent: {
    en: 'Mystic event',
    es: 'Evento místico',
    fr: 'Événement mystique',
    de: 'Mystisches Event',
    pt: 'Evento místico',
    it: 'Evento mistico',
    tr: 'Mistik etkinlik',
    nl: 'Mystiek evenement',
  },
  hexCityEvent: {
    en: 'Hex City event',
    es: 'Evento Hex City',
    fr: 'Événement Hex City',
    de: 'Hex-City-Event',
    pt: 'Evento Hex City',
    it: 'Evento Hex City',
    tr: 'Hex City etkinliği',
    nl: 'Hex City-evenement',
  },
  dailyLogin: {
    en: 'Daily login',
    es: 'Inicio de sesión diario',
    fr: 'Connexion quotidienne',
    de: 'Tägliches Einloggen',
    pt: 'Login diário',
    it: 'Accesso giornaliero',
    tr: 'Günlük giriş',
    nl: 'Dagelijkse login',
  },
  currentlyInactive: {
    en: 'currently inactive',
    es: 'actualmente inactivo',
    fr: 'actuellement inactif',
    de: 'derzeit inaktiv',
    pt: 'atualmente inativo',
    it: 'attualmente inattivo',
    tr: 'şu anda etkin değil',
    nl: 'momenteel inactief',
  },
  luckySlotsRoulette: {
    en: 'Lucky Slots roulette',
    es: 'Ruleta Lucky Slots',
    fr: 'Roulette Lucky Slots',
    de: 'Lucky-Slots-Roulette',
    pt: 'Roleta Lucky Slots',
    it: 'Roulette Lucky Slots',
    tr: 'Lucky Slots ruleti',
    nl: 'Lucky Slots-roulette',
  },
  mutantPreorder: {
    en: 'Mutant pre-order',
    es: 'Reserva de mutante',
    fr: 'Précommande du mutant',
    de: 'Mutanten-Vorbestellung',
    pt: 'Pré-venda de mutante',
    it: 'Prenotazione del mutante',
    tr: 'Mutant ön siparişi',
    nl: 'Mutant-voorbestelling',
  },
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
  crossoverTcg: {
    en: 'Mutants: TCG 2019 crossover, can be exchanged for',
    es: 'Crossover de Mutants: TCG 2019, se puede intercambiar por',
    fr: 'Crossover Mutants : TCG 2019, échangeable contre',
    de: 'Mutants: TCG 2019 Crossover, eintauschbar gegen',
    pt: 'Crossover de Mutants: TCG 2019, pode ser trocado por',
    it: 'Crossover Mutants: TCG 2019, scambiabile con',
    tr: 'Mutants: TCG 2019 crossover, şununla değiştirilebilir:',
    nl: 'Mutants: TCG 2019-crossover, inwisselbaar voor',
  },
}

function tr(word: keyof typeof W, locale: Locale): string {
  return W[word][locale]
}

function translateWhere(
  ru: string,
  locale: Locale,
  mutantNames: Record<Locale, Record<string, { name: string }>>,
): string | null {
  let m: RegExpMatchArray | null

  if (ru === 'Бинго') return tr('bingo', locale)
  if (ru === 'Магазин') return tr('shop', locale)
  if (ru === 'Магазин (Ресурсы)') return tr('shopResources', locale)
  if (ru === 'Награда дивизиона') return tr('divisionReward', locale)
  if (ru === 'Рейды') return tr('raids', locale)
  if (ru === 'Крафт, лесенки') return tr('craftLadders', locale)
  if (ru === 'Кампании, лесенки, крафт и другие активности') return tr('campaignsEtc', locale)
  if (ru === 'Ежедневный вход (сейчас неактуально)')
    return `${tr('dailyLogin', locale)} (${tr('currentlyInactive', locale)})`
  if (ru === 'Рулетка Lucky Slots (сейчас неактуально)')
    return `${tr('luckySlotsRoulette', locale)} (${tr('currentlyInactive', locale)})`
  if (ru === 'Зимний ивент (точный год неизвестен)')
    return `${tr('winterEvent', locale)} (${tr('exactYearUnknown', locale)})`
  if (ru === 'Хэллоуин (точный год неизвестен)')
    return `${tr('halloween', locale)} (${tr('exactYearUnknown', locale)})`
  if (ru === 'Ивент ко Дню Св. Валентина (~2019-2020)')
    return `${tr('valentinesEvent', locale)} (~2019-2020)`
  if (ru === 'Мистический ивент «Weirdtech» 2023')
    return `${tr('mysticEvent', locale)} «Weirdtech» 2023`
  if ((m = ru.match(/^Ивент Hex City \((\d+)\)$/))) return `${tr('hexCityEvent', locale)} (${m[1]})`
  if ((m = ru.match(/^7-я годовщина игры \((\d+)\)$/)))
    return `${tr('ordinal7th', locale)} ${tr('gameAnniversary', locale).toLowerCase()} (${m[1]})`
  if ((m = ru.match(/^Годовщина игры (\d+)$/))) return `${tr('gameAnniversary', locale)} ${m[1]}`
  if ((m = ru.match(/^Пасхальный ивент (\d+)$/))) return `${tr('easterEvent', locale)} ${m[1]}`
  if ((m = ru.match(/^Хэллоуин (\d+)$/))) return `${tr('halloween', locale)} ${m[1]}`
  if ((m = ru.match(/^Рождество (\d+)$/))) return `${tr('christmas', locale)} ${m[1]}`
  if ((m = ru.match(/^Рождественский ивент (\d+)$/)))
    return `${tr('christmasEvent', locale)} ${m[1]}`
  if ((m = ru.match(/^Ивент ко Дню Св\. Валентина (\d+)$/)))
    return `${tr('valentinesEvent', locale)} ${m[1]}`
  if ((m = ru.match(/^Таинственные ивенты (\d+)$/))) return `${tr('mysteryEvents', locale)} ${m[1]}`
  if ((m = ru.match(/^Предзаказ мутанта «(.+)» \(золотой\)$/)))
    return `${tr('mutantPreorder', locale)} «${mutantName(m[1], locale, mutantNames)}» (${tr('gold', locale)})`
  if (ru === 'Кроссовер Mutants: TCG 2019, можно обменять на «Дрей, космический корги»')
    return `${tr('crossoverTcg', locale)} «${mutantName('Дрей, космический корги', locale, mutantNames)}»`

  return null
}

async function main() {
  const sources = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'src/data/materials/sources.json'), 'utf-8'),
  ) as Record<string, { type: string; where: string }[] | { type: string; where: string }>

  const uniqueWheres = new Set<string>()
  for (const k of Object.keys(sources)) {
    const arr = Array.isArray(sources[k]) ? sources[k] : [sources[k]]
    for (const item of arr as { where: string }[]) uniqueWheres.add(item.where)
  }

  const mutantNames = await loadMutantNames()

  const out: Partial<Record<Locale, Record<string, string>>> = {}
  const unresolved: string[] = []
  for (const locale of LOCALES) {
    out[locale] = {}
    for (const ru of uniqueWheres) {
      const translated = translateWhere(ru, locale, mutantNames)
      if (translated !== null) {
        out[locale]![ru] = translated
      } else if (!unresolved.includes(ru)) {
        unresolved.push(ru)
      }
    }
  }

  const outPath = path.join(process.cwd(), 'src/data/materials/sources-where-i18n.json')
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8')

  console.log('Уникальных "where":', uniqueWheres.size)
  console.log('Не покрыто ни одним правилом:', unresolved)
  console.log('Записано в', outPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
