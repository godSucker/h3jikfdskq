// Анонс "что появится в магазине через 1-2 недели" (Фаза 3, задача A). Референс
// по стилю подачи - MUTODEX (pokradex.org), еженедельные посты с датами. НЕ
// полный магазин с архивом - только витрина ближайшего будущего спринта.
//
// КЛЮЧЕВАЯ находка 2026-08-07: beta и прод дают ОДИНАКОВЫЙ набор SPRINT-меток в
// shopitems.xml (проверено - max одинаков на обоих хостах) - "опережение" тут
// не про beta vs прод (тот трюк не работает, см. память beta-cdn-plain-watch
// про prod==beta ловушку). Игра просто публикует данные СЛЕДУЮЩЕГО спринта в
// файл чуть раньше, чем включает его игрокам. Поэтому "скоро" определяем через
// src/lib/sprint-calendar.ts: currentSprint(сегодня) - расчётный номер "живого"
// спринта, всё что СТРОГО больше - ещё не наступило, но уже видно в файле.
//
// Иконки НЕ качаем на свой CDN (в отличие от build-boxes.ts/build-special-
// offers.ts, которые формируют постоянный каталог) - просто хотлинк на Kobojo
// CDN thumbnail, textureUrl() пропускает http-абсолютные пути как есть. Если
// итоговый предмет позже реально попадёт на сайт (через build-boxes.ts/
// build-special-offers.ts), у него появится свой постоянный арт - здесь нужен
// только превью на 1-2 недели, отдельно грузить его на свой CDN избыточно.

import axios from 'axios'
import {
  currentSprint,
  sprintRangeLabel,
  sprintStartDate,
  formatExactRangeRu,
  formatDateRu,
} from '../src/lib/sprint-calendar'
import { parseOfferRibbon, parseRealPriceUSD, type OfferRibbon } from './shop-offer-tags'
import { fetchGameXml } from './game-xml-cache'
import {
  loadFilterDates,
  loadDateLedger,
  pickFilterDateRange,
  getLiveSnapshot,
  type FilterDateRange,
} from './kartel-filter-dates'
import { shadowCompare } from './date-resolver'

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const THUMB_BASE = 'https://s-beta.kobojo.com/mutants/assets/thumbnails/'

// Часть picture-атрибутов несёт "$$" - тот же плейсхолдер локали, что у
// баннеров daily_news (resolveOfferBanner в detect-daily-news.ts). Найдено
// 2026-09-04 на живом баге ("Жизни пакет" 404) - слепое вырезание "$$" (как
// было раньше) даёт несуществующий URL, нужна подстановка -ru/-en. 141 запись
// в истории shopitems.xml так размечена - не единичный случай. У большинства
// picture БЕЗ "$$" - для них ничего не меняется, прямой URL как раньше.
async function resolveThumbnailUrl(picture: string): Promise<string | null> {
  if (!picture.includes('$$')) return `${THUMB_BASE}${picture}.png`
  for (const lang of ['ru', 'en']) {
    const url = `${THUMB_BASE}${picture.replace('$$', `-${lang}`)}.png`
    try {
      const res = await axios.head(url, {
        timeout: 8000,
        validateStatus: (s) => s === 200 || s === 404,
      })
      if (res.status === 200) return url
    } catch {
      // сеть упала - пробуем следующий суффикс, ниже общий null-фоллбек
    }
  }
  return null
}

function balanceQuotes(name: string): string {
  const open = (name.match(/«/g) ?? []).length
  const close = (name.match(/»/g) ?? []).length
  return open > close ? name + '»'.repeat(open - close) : name
}

// "Мутанта недели"/"мутанта месяца" определяем по длине живого окна оффера
// (kartel filters[].startDate/endDate, см. scripts/kartel-filter-dates.ts):
// обычный мутант-оффер держится 1-2 дня, недельный - ровно ~7, месячный -
// ~28-31 (проверено на спринтах 255-256: Скарамуш 7-14 сент = 7 дней;
// Виргон 23 авг - 23 сент = 31; Флипфлоп 2-30 сент = 28). Между 2 и 7 днями
// у мутант-офферов пусто - пороги с запасом. Гейт по Specimen_ обязателен:
// 7-дневные и 30-дневные окна бывают и у контейнеров/банков/обменников.
export function classifyFeaturedMutant(
  itemId: string,
  start: string | null,
  end: string | null,
  filterTag?: string | null,
): 'week' | 'month' | 'zodiac' | null {
  if (!start || !end) return null
  if (!/^-*#?specimen_/i.test(itemId)) return null
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000
  // Зодиаки продаются тем же месячным окном, что и "мутант месяца", и плашка
  // на карточке их путала (репорт юзера 2026-09-21: Либраро с подписью
  // "МУТАНТ МЕСЯЦА"). Отличает их только фильтр оффера - Shop_Zodiac_<id>,
  // в самом itemId ничего про зодиак нет.
  const isZodiac = /zodiac/i.test(filterTag ?? '')
  if (days >= 6 && days <= 9) return isZodiac ? 'zodiac' : 'week'
  if (days >= 25 && days <= 33) return isZodiac ? 'zodiac' : 'month'
  return null
}

export interface ForecastPrice {
  amount: number
  type: 'hardcurrency' | 'softcurrency' | 'usd'
}
interface ForecastItem {
  itemId: string
  name: string
  image: string | null
  price: ForecastPrice | null
  ribbon: OfferRibbon | null
  // Точный диапазон ЭТОГО оффера (не всего спринта), из живого kartel-запроса
  // - см. scripts/kartel-filter-dates.ts. null, если live-данных нет (шаг не
  // запускался/оффер не нашёлся среди фильтров) - card.astro в этом случае
  // падает обратно на sprintRangeLabel(sprint), как было раньше.
  exactDateLabel: string | null
  // ISO-конец окна и признак приблизительной даты - страница анонсов рисует
  // подпись на языке посетителя сама (см. AnnouncementItem в build-announcements.ts).
  exactDateEnd: string | null
  exactDateApprox?: boolean
  // ISO-дата начала (не форматированная) - нужна для хронологической
  // сортировки офферов на странице (ближайшие сверху), formatExactRangeRu()
  // теряет сортируемость (текст с названием месяца).
  exactDateStart: string | null
  // 'week'/'month', если это мутант-оффер с окном ~7 или ~28-31 день - см.
  // classifyFeaturedMutant. 'day' - оффер из пула daily-offer (см.
  // fetchDailyMutantOffers), проставляется напрямую, не через
  // classifyFeaturedMutant (там окно 1-2 дня для ОБЫЧНОГО спринтового
  // оффера ничего не значит - тут источник уже точно известен по Path).
  // null для не-мутантов и обычных коротких окон.
  featuredMutant: 'day' | 'week' | 'month' | 'zodiac' | null
  // Мутанты ВНУТРИ пакета (<ArticleItems> в shopitems.xml). Без этого пакеты
  // вроде "Пакет «Спираксия»" (bank_e_14_*) выглядели некликабельными: сам
  // itemId мутанта не содержит, а мутант внутри есть (юзер поймал 2026-09-16).
  packMutants: string[]
}

export interface ShopForecast {
  sprint: number
  dateRangeLabel: string
  items: ForecastItem[]
}

// sprintOverride - только для разового ручного бэкафилла (см.
// scripts/backfill-sprint-announcements.ts) - публикует уже прошедшие/живые
// спринты через тот же парсер, не только "следующий" (по умолчанию). Часовой
// автоматический пайплайн (build-announcements.ts) его не передаёт - там
// всегда currentSprint()+1, как было.
export async function fetchShopForecast(sprintOverride?: number): Promise<ShopForecast | null> {
  const [xml, locRaw] = await Promise.all([fetchGameXml(SHOPITEMS_URL), fetchGameXml(LOC_RU_URL)])

  const loc = new Map<string, string>()
  const locLower = new Map<string, string>()
  for (const rawLine of locRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const i = line.indexOf(';')
    if (i === -1) continue
    const key = line.slice(0, i)
    const val = line.slice(i + 1)
    loc.set(key, val)
    if (!locLower.has(key.toLowerCase())) locLower.set(key.toLowerCase(), val)
  }
  const lookup = (key: string) => loc.get(key) ?? locLower.get(key.toLowerCase())

  function resolveName(itemId: string, caption: string | undefined): string {
    const byItemId = lookup(itemId)
    if (byItemId) return balanceQuotes(byItemId)
    const withoutTrailingDigits = itemId.replace(/\d+$/, '')
    if (withoutTrailingDigits !== itemId) {
      const byStripped = lookup(withoutTrailingDigits)
      if (byStripped) return balanceQuotes(byStripped)
    }
    if (caption) {
      const strippedKey = caption
        .replace(/^\$/, '')
        .replace(/_(description|payment_text|tooltip)$/, '')
      const byCaption = lookup(strippedKey) ?? lookup(caption)
      if (byCaption && byCaption.length <= 80) return balanceQuotes(byCaption)
    }
    return itemId
      .replace(/^#\w+-\d+-/, '')
      .replace(/^#/, '')
      .replace(/_/g, ' ')
      .trim()
  }

  const target = sprintOverride ?? currentSprint() + 1
  const marker = `----------------------------// SPRINT ${target} \\\\----------------------------`
  const startIdx = xml.indexOf(`itemId="${marker}"`)
  if (startIdx === -1) return null

  // Файл идёт от новых спринтов к старым - следующий маркер после нашего
  // (любой "SPRINT N") обозначает конец блока текущего спринта.
  const afterMarkerTag = xml.indexOf('</ShopItem>', startIdx) + '</ShopItem>'.length
  const nextMarkerIdx = xml.indexOf('SPRINT', afterMarkerTag)
  const block = xml.slice(
    afterMarkerTag,
    nextMarkerIdx === -1 ? undefined : xml.lastIndexOf('<ShopItem', nextMarkerIdx),
  )

  const filterDates = await loadFilterDates()
  const liveSnap = await getLiveSnapshot()

  // НАЙДЕНО 2026-09-08 (живой прогон после расширения явного запроса имён
  // фильтров на ВСЕ <Filter>-теги, не только специмены дня): Kobojo иногда
  // ПЕРЕИСПОЛЬЗУЕТ один и тот же generic Filter-тег для РАЗНЫХ по времени
  // офферов (LuckyBox_Research_IX показал "5-6 августа" для оффера спринта
  // 256, который реально идёт 5-18 сентября - kartel просто вернул дату
  // последнего известного ему включения этого фильтра, не обязательно ТЕКУЩЕГО).
  // Раньше exactRange принимался вслепую по имени без проверки, что дата вообще
  // относится к нужному спринту - теперь отбрасываем resolved-дату, если она
  // не укладывается в окно целевого спринта (+- 3 дня на границы).
  const sprintWindowStart = sprintStartDate(target).getTime() - 3 * DAY_MS
  const sprintWindowEnd = sprintStartDate(target + 1).getTime() + 3 * DAY_MS

  // Общий разбор одного <ShopItem> - используется и для спринтового блока
  // (ниже), и для пула daily-offer (fetchDailyMutantOffers). forceFeatured
  // проставляет featuredMutant напрямую (для daily-offer источник уже точно
  // известен по Path, classifyFeaturedMutant по длине окна тут не нужен и
  // была бы неверна - у daily-оффера окно 1-2 дня, а не 7/28-31).
  async function buildItem(
    itemXml: string,
    forceFeatured?: 'day',
  ): Promise<{ item: ForecastItem; exactRange: FilterDateRange | null } | null> {
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    const hidden = itemXml.match(/hidden="([^"]+)"/)?.[1]
    const picture = itemXml.match(/picture="([^"]+)"/)?.[1]
    const caption = itemXml.match(/caption="([^"]+)"/)?.[1]
    if (!itemId || hidden === 'true') return null
    const costMatch = itemXml.match(/<Cost amount="(\d+)" type="(hardcurrency|softcurrency)"\s*\/>/)
    const usd = costMatch ? null : parseRealPriceUSD(itemXml)
    const offerTag = itemXml.match(/offerTag="([^"]+)"/)?.[1]
    const packMutants = [
      ...new Set(
        [...itemXml.matchAll(/<ArticleItem[^>]*typeId="(Specimen_[^"]+)"/gi)].map((m) => m[1]),
      ),
    ]
    const filterTag = itemXml.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    const rawExactRange = pickFilterDateRange(filterDates, filterTag)
    const exactRange =
      rawExactRange &&
      new Date(rawExactRange.start).getTime() >= sprintWindowStart &&
      new Date(rawExactRange.start).getTime() < sprintWindowEnd
        ? rawExactRange
        : null
    // Этап 4, теневой режим: date-resolver.ts считает дату рядом, только
    // логирует расхождение. В данные по-прежнему идёт exactRange выше.
    shadowCompare(
      `shopForecast ${target}`,
      liveSnap,
      filterTag,
      { kind: 'sprint', startMs: sprintWindowStart, endMs: sprintWindowEnd },
      exactRange,
    )
    return {
      exactRange,
      item: {
        itemId,
        name: resolveName(itemId, caption),
        image: picture ? await resolveThumbnailUrl(picture) : null,
        price: costMatch
          ? { amount: Number(costMatch[1]), type: costMatch[2] as 'hardcurrency' | 'softcurrency' }
          : usd !== null
            ? { amount: usd, type: 'usd' }
            : null,
        ribbon: parseOfferRibbon(offerTag),
        exactDateLabel: exactRange
          ? formatExactRangeRu(
              new Date(exactRange.start),
              exactRange.end ? new Date(exactRange.end) : null,
            )
          : null,
        exactDateStart: exactRange?.start ?? null,
        exactDateEnd: exactRange?.end ?? null,
        featuredMutant:
          forceFeatured ??
          classifyFeaturedMutant(
            itemId,
            exactRange?.start ?? null,
            exactRange?.end ?? null,
            filterTag,
          ),
        packMutants,
      },
    }
  }

  const items: ForecastItem[] = []
  for (const itemXml of block.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const built = await buildItem(itemXml)
    if (built) items.push(built.item)
  }

  // "Дневной мутант" (запрошено юзером 2026-09-08, пост @KaiserZ с недельным
  // календарём - t.me/mutants_mgg_fb/9483) - пул daily-offer (Path
  // cat="special" subCat="dailyoffer", category="specimen", 1157 записей на
  // 2026-09-08) физически лежит ВНЕ спринтовых маркеров, но несёт тот же
  // <Filter>Shop_<itemId></Filter>, что и обычные офферы - джойн по kartel
  // работает 1-в-1. Скоуп по [sprintStart, nextSprintStart) - без него один
  // и тот же daily-оффер мог бы попасть и в fetchShopForecast(cs), и в
  // fetchShopForecast(cs+1) (оба вызова парсят один и тот же xml целиком).
  const beforeDaily = items.length
  const ladder = await appendDailyMutantOffers(xml, target, filterDates, buildItem, items)
  console.log(
    `[forecast] shopForecast спринт ${target}: дневных офферов (мутанты+орбы+паки) ${items.length - beforeDaily}`,
  )

  // Датируем ВЕСЬ спринт-блок (боксы/паки/бандлы/банки), а не только дневных
  // мутантов: специмены дневной лестницы работают якорями дня, соседи по
  // группе наследуют их дату. Порядок items[0..beforeDaily) - ровно порядок
  // <ShopItem> в блоке, на нём и держится вся логика групп.
  inheritDatesFromAnchors(
    items.slice(0, beforeDaily),
    ladder,
    sprintStartDate(target).getTime(),
    sprintStartDate(target + 1).getTime(),
  )
  console.log(
    `[forecast] shopForecast спринт ${target}: с датой ${items.filter((i) => i.exactDateStart).length}/${items.length}`,
  )

  const dayByItemId = new Map<string, number>()
  for (const it of items) {
    if (!it.exactDateStart) continue
    const ms = new Date(it.exactDateStart).getTime()
    if (!Number.isNaN(ms)) dayByItemId.set(it.itemId.toLowerCase(), ms)
  }
  sprintDayMapCache.set(target, dayByItemId)

  return { sprint: target, dateRangeLabel: sprintRangeLabel(target), items: dedupeByItemId(items) }
}

// НАЙДЕНО 2026-09-16 (юзер поймал "теряются даты при мердже"): один и тот же
// itemId нередко попадает в items ДВАЖДЫ - один раз как обычный спринтовый
// оффер (буллит выше, дата из его собственного <Filter>), второй раз как
// запись daily-offer пула (appendDailyMutantOffers, дата confirmed-kartel
// ИЛИ "≈"-экстраполяция по позиции). build-announcements.ts дальше строит
// `id = sprint|itemId` и схлопывает по этому id Map'ом - при дубле выживает
// ПОСЛЕДНИЙ (пул всегда после спринтового блока), даже если у него даты нет
// или она хуже - конкретно так потерялось 16 из 52 живых дат на спринте 256.
// Дедуп здесь, на выходе fetchShopForecast, чтобы дальше по пайплайну шёл
// уже один айтем на id (detectDailyNews берёт офферы из отдельного файла
// dailypopup.xml без daily-offer пула - этот конкретный дубль-паттерн там
// не воспроизводится). Приоритет: подтверждённая дата > "≈"-прогноз > без
// даты; при равенстве -
// первое вхождение (обычно спринтовый оффер, он "первичнее" пула).
function dateRank(label: string | null): number {
  if (!label) return 0
  return label.startsWith('≈') ? 1 : 2
}

function dedupeByItemId(items: ForecastItem[]): ForecastItem[] {
  const byId = new Map<string, ForecastItem>()
  for (const it of items) {
    const existing = byId.get(it.itemId)
    if (!existing || dateRank(it.exactDateLabel) > dateRank(existing.exactDateLabel)) {
      byId.set(it.itemId, it)
    }
  }
  return [...byId.values()]
}

const DAY_MS = 86_400_000

interface DailyPoolEntry {
  // Позиция в ДНЕВНОЙ лестнице: инкрементится только для specimen_ (см.
  // комментарий у appendDailyMutantOffers). У bundle_orbs_/pack_daily_ тут -1
  // - они в лестнице не участвуют ни как якорь, ни как цель экстраполяции.
  position: number
  isSpecimen: boolean
  itemXml: string
  filterTag: string | null
}

// НАХОДКА 2026-09-08 (совместно с юзером, через живой Frida-захват + разбор
// поста @KaiserZ t.me/mutants_mgg_fb/9483): порядок записей daily-offer пула
// в shopitems.xml НЕ произволен - он несёт саму хронологию. На спринте 256
// позиция 9 (последняя от конца пула) = сегодня (8 сент), позиция 0 = самый
// дальний день недели (18 сент), т.е. ПОЗИЦИЯ УБЫВАЕТ РОВНО НА 1 ДЕНЬ ЗА
// ПОЗИЦИЮ ВПЕРЁД. Подтверждено 9 из 10 независимых точек (5 - наш живой
// kartel-захват, 4 - имена/даты из поста Кайзера, сматченные через
// localisation_ru.txt). Есть локальные "пропуски" (позиция не даёт ровно
// -1 день от соседа) - видимо не каждая запись пула размечена, но
// направление и приблизительный шаг железные.
//
// Отсюда стратегия "kartel + позиция вместе" (юзер прямо попросил не
// заменять kartel, а комбинировать): kartel остаётся ЕДИНСТВЕННЫМ источником
// ПОДТВЕРЖДЁННОЙ даты (то, что уже показываем без "≈"). Для дней, до которых
// kartel ещё не дотянулся (typical horizon ~неделя), берём ближайшую по
// позиции ПОДТВЕРЖДЁННУЮ точку и экстраполируем на -1 день за позицию -
// это ПРОГНОЗ, помечается "≈" в exactDateLabel, никогда не выдаётся за
// подтверждённый факт. Как только kartel сам дотягивается до этой даты
// (часовой крон), merge-логика в build-announcements.ts подменяет "≈"-строку
// на настоящую (fresh всегда побеждает, см. комментарий там) - без ручных
// действий.
//
// РАСШИРЕНИЕ 2026-09-11 (юзер попросил проверить, "можно ли предугадать без
// дат картеля"): весь пул dailyoffer (1714 записей на 11.09, не только
// specimen_-префикс) проверен живым бэктестом на срезе 06.09 - позиция ->
// дата держится РЯДОМ с известной точкой (nbDist<=5: медианная ошибка 0.5
// дня), но ЛОМАЕТСЯ на больших дистанциях (Anniversary26_Box_* дали
// стабильную ошибку +4 дня на nbDist~20-29, дальние pack_daily/omega -
// ошибка 16-18 дней, случайная древняя запись на nbDist~1700 - ошибка 1680
// дней). Файл НЕ единая хронологическая лента - это набор локальных "волн"
// контента, между которыми смещение не сохраняется. Поэтому: (1) пул
// расширен с specimen_ также на bundle_orbs_/pack_daily_ (та же
// subCat="dailyoffer" разметка, та же локальная точность рядом с якорем),
// (2) добавлен MAX_NEIGHBOR_DISTANCE - экстраполяция дальше этого порога
// молча отбрасывается (лучше не показать прогноз вообще, чем показать
// уверенно неверный - тот же принцип, что уже применяется к "чужим датам"
// в exactDateFor() у build-announcements.ts).
// Поднят 5 -> 35 (2026-09-16). Кэп ставился при ГРЯЗНОЙ лестнице, где шум от
// bundle/pack давал до 3 дней ошибки уже на пятой позиции. На чистой
// specimen-лестнице ошибка НЕ РАСТЁТ с дистанцией - честный forward-тест на
// ledger-точках (экстраполяция только вперёд, к позиции 0) дал по дистанциям
// 1..40 медиану 0 дней, 90-й перцентиль 0-2, максимум 3. Кэп 14 отрезал
// ровно один спринт вперёд: следующий спринт не мог закрыться целиком, пока
// kartel-горизонт (~7 дней) не доползёт до его середины. 35 закрывает
// следующий спринт сразу, оставаясь внутри проверенной глубины данных.
const MAX_NEIGHBOR_DISTANCE = 35

// Спринт-блок shopitems.xml идёт СТРОГО обратной хронологией ДНЕВНЫМИ
// ГРУППАМИ - ровно одна группа на день (проверено на спринте 256: 38 офферов
// -> 14 групп -> 14 календарных дней 18.09..05.09 без единого пропуска), и в
// каждой группе ровно один специмен дневной лестницы. Отсюда правило: специмен
// = якорь дня, а стоящие рядом боксы/паки/бандлы/банки наследуют его дату.
// Это то, чего не хватало, чтобы датировать ВЕСЬ спринт сразу, а не только
// дневных мутантов.
//
// Бэктест на kartel-истине (спринт 256, 19 не-специменов с адекватной датой):
//   "дата следующего якоря вниз"  - 14/19 точных
//   "ближайший якорь"             -  7/21
//   "предыдущий якорь"            -  5/20
// Все 5 промахов "следующего" - ОДНА однородная пачка (bank_* из 5 номиналов
// одного оффера), которая относится к ПРЕДЫДУЩЕМУ дню; промах ровно 1 день.
// Спец-правило "пачка липнет к предыдущему якорю" пробовал - на спринте 256
// оно эти 5 чинит, но на 257 ломает больше, чем чинит (там bank_e_14_* как
// раз относится к следующему якорю, а Pack_Medieval/pack_daily_* склеиваются
// в одну ложную пачку по общему префиксу "pack"). Поэтому оставлено ОДНО
// простое правило без эвристик: предсказуемая ошибка максимум в сутки.
//
// ВНЕШНЯЯ ПРОВЕРКА (2026-09-16): первая неделя спринта 257, посчитанная этим
// правилом ЕЩЁ ДО её начала, сверена с двумя независимыми фан-хронологиями -
// совпало день-в-день по всем опознаваемым офферам, включая bank_e_14_* на
// 21.09 (тот самый случай, ради которого спец-правило и было отвергнуто).
function inheritDatesFromAnchors(
  blockItems: ForecastItem[],
  ladder: Map<string, number>,
  windowStart: number,
  windowEnd: number,
): void {
  const isSpec = (id: string) => /^-*#?specimen_/i.test(id)

  // Якорь дня - только специмен дневной лестницы. Своя kartel-дата приоритетнее
  // расчётной; если её нет - берём из лестницы пула.
  const anchor: (number | null)[] = blockItems.map((it) => {
    if (!isSpec(it.itemId)) return null
    if (it.exactDateStart) {
      const ms = new Date(it.exactDateStart).getTime()
      if (!Number.isNaN(ms)) return ms
    }
    return ladder.get(it.itemId.toLowerCase()) ?? null
  })

  // Специмену без живой даты проставляем расчётную из лестницы.
  for (let i = 0; i < blockItems.length; i++) {
    const it = blockItems[i]
    if (it.exactDateStart || anchor[i] == null) continue
    const ms = anchor[i]!
    if (ms < windowStart || ms >= windowEnd) continue
    it.exactDateLabel = `≈ ${formatDateRu(new Date(ms))}`
    it.exactDateStart = new Date(ms).toISOString()
    it.exactDateEnd = null
    it.exactDateApprox = true
  }

  for (let i = 0; i < blockItems.length; i++) {
    const it = blockItems[i]
    if (it.exactDateStart || anchor[i] != null) continue
    let ms: number | null = null
    for (let j = i + 1; j < blockItems.length; j++) {
      if (anchor[j] != null) {
        ms = anchor[j]!
        break
      }
    }
    if (ms == null || ms < windowStart || ms >= windowEnd) continue
    it.exactDateLabel = `≈ ${formatDateRu(new Date(ms))}`
    it.exactDateStart = new Date(ms).toISOString()
    it.exactDateEnd = null
    it.exactDateApprox = true
  }
}

// Карта "itemId -> день спринта", заполняется fetchShopForecast. Нужна
// detect-daily-news.ts: у баннеров "Скоро в игре" в dailypopup.xml своих дат
// нет ВООБЩЕ, но 17 из 22 несут <Tag key="entity"> со ссылкой ровно на те
// shopitems, которым мы дату уже посчитали (якоря + наследование). Читается
// через getSprintDayMap() после того, как shopForecast отработал - в
// build-announcements.ts его детектор стоит раньше dailyNews. Если порядок
// когда-нибудь изменят, карты просто не будет и даты останутся пустыми, как
// было раньше - тихая деградация, не падение.
const sprintDayMapCache = new Map<number, Map<string, number>>()

export function getSprintDayMap(sprint: number): Map<string, number> | undefined {
  return sprintDayMapCache.get(sprint)
}

function pickNearestConfirmed(
  position: number,
  confirmed: { position: number; dayMs: number }[],
): { position: number; dayMs: number; dist: number } | null {
  let best: { position: number; dayMs: number; dist: number } | null = null
  let bestDist = Infinity
  for (const c of confirmed) {
    const dist = Math.abs(c.position - position)
    if (dist < bestDist) {
      bestDist = dist
      best = { ...c, dist }
    }
  }
  return best
}

// ВОЛНЫ (2026-09-11, разобрано с юзером перед реализацией - см. память
// auto-announcements-architecture.md): честный бэктест на срезе 06.09 показал,
// что MAX_NEIGHBOR_DISTANCE=5 режет РОВНУЮ волну (позиции 0-44 спринта 256 -
// 44 позиции/38 дней БЕЗ единого настоящего разрыва, только шум ±1-3 дня от
// сдвоенных/пропущенных дней) на пятой позиции от любого якоря - это
// самоограничение алгоритма, не предел данных. Настоящая граница волны
// отличима от шума с большим запасом: на позициях 44->46 спринта 256 дата
// прыгнула НАЗАД на 10 дней при сдвиге всего на 2 позиции - Kobojo заливает
// контент "партиями", не единой хронологической лентой, и партии не идут
// подряд по позиции.
//
// Подтверждённые точки (kartel-снэпшот + date-ledger.json) сортируются по
// позиции и "сцепляются" в волну, пока экстраполяция -1день/позиция от
// последней точки волны попадает в WAVE_TOLERANCE_DAYS; иначе - новая волна.
// Волна с >=2 точками - "доверенная": ВНУТРИ её диапазона позиций якорь
// берётся без ограничения по дистанции (дата зажата подтверждёнными фактами
// с обеих сторон), а ЗА краем волны - с запасом WAVE_EDGE_MARGIN. Значение
// подобрано тем же бэктестом (срез 06.09, честный forward-test): margin=10
// держит ошибку <=2 дня на всех новых предсказаниях (10->16 из 51
// out-of-sample, 0 регрессий против старого метода); margin=20 поднимает
// худший случай до 4 дней; margin=40 - до 18 дней (там начинается уже другая
// волна, для которой ещё нет данных, экстраполяция настолько далеко уже
// гадание). Одиночные точки без второго подтверждающего соседа (волна из 1
// элемента) в "доверенные" не попадают - для них остаётся старый
// MAX_NEIGHBOR_DISTANCE как более консервативный фоллбек.
const WAVE_TOLERANCE_DAYS = 3
const WAVE_MAX_POSITION_GAP = 20
// 10 -> 20 (2026-09-16): подбиралось тем же грязно-лестничным бэктестом, что и
// старый кэп-5. Волна зажата подтверждёнными фактами с обеих сторон, за её
// краем на чистой лестнице ошибка держится в пределах 2 дней и на 20 шагах.
// Дальше края волны работает консервативный MAX_NEIGHBOR_DISTANCE.
const WAVE_EDGE_MARGIN = 20

// Отбраковка выбросов среди подтверждённых точек.
//
// При идеальной лестнице "один специмен = один день" величина
// dayMs + position*DAY одинакова для всех точек волны - это её "база".
// Значит выброс виден сразу: у "Чумной Ведьмы" (Specimen_BB_08, спринт 256)
// kartel отдаёт 18.09, а соседи слева и справа дают 17.09 и 15.09, то есть
// по лестнице должно быть 16.09 - база расходится ровно на 2 дня. Такое
// бывает от переиспользованного Filter-тега: kartel возвращает дату
// ПОСЛЕДНЕГО известного ему включения фильтра, а не текущего (та же природа,
// что у регрессии LuckyBox_Research_IX 2026-09-08).
//
// Вредит это дважды: неверная дата и на своей плитке, и в роли якоря - волна
// вокруг неё едет. Поэтому сверяем базу каждой точки с медианой по её
// окрестности (+-3 соседа по позиции, чтобы не смешивать разные волны) и
// выкидываем всё, что расходится больше чем на сутки с запасом.
function dropOutliers(confirmed: { position: number; dayMs: number }[]): {
  kept: { position: number; dayMs: number }[]
  outlierPositions: Set<number>
} {
  const sorted = [...confirmed].sort((a, b) => a.position - b.position)
  const base = (p: { position: number; dayMs: number }) => p.dayMs + p.position * DAY_MS
  const kept: { position: number; dayMs: number }[] = []
  const outlierPositions = new Set<number>()
  for (let i = 0; i < sorted.length; i++) {
    const window = sorted
      .slice(Math.max(0, i - 3), i + 4)
      .map(base)
      .sort((a, b) => a - b)
    const median = window[Math.floor(window.length / 2)]
    if (Math.abs(base(sorted[i]) - median) <= 1.5 * DAY_MS) kept.push(sorted[i])
    else outlierPositions.add(sorted[i].position)
  }
  return { kept, outlierPositions }
}

function buildWaves(
  confirmed: { position: number; dayMs: number }[],
): { position: number; dayMs: number }[][] {
  const sorted = [...confirmed].sort((a, b) => a.position - b.position)
  const waves: { position: number; dayMs: number }[][] = []
  let current: { position: number; dayMs: number }[] = []
  for (const c of sorted) {
    const last = current[current.length - 1]
    if (last) {
      const dpos = c.position - last.position
      const predictedMs = last.dayMs - dpos * DAY_MS
      const errDays = Math.abs(c.dayMs - predictedMs) / DAY_MS
      if (errDays > WAVE_TOLERANCE_DAYS || dpos > WAVE_MAX_POSITION_GAP) {
        waves.push(current)
        current = []
      }
    }
    current.push(c)
  }
  if (current.length > 0) waves.push(current)
  return waves.filter((w) => w.length >= 2)
}

function pickWaveAnchor(
  position: number,
  waves: { position: number; dayMs: number }[][],
): { position: number; dayMs: number } | null {
  for (const wave of waves) {
    const lo = wave[0].position
    const hi = wave[wave.length - 1].position
    if (position < lo - WAVE_EDGE_MARGIN || position > hi + WAVE_EDGE_MARGIN) continue
    let best: { position: number; dayMs: number } | null = null
    let bestDist = Infinity
    for (const a of wave) {
      const dist = Math.abs(a.position - position)
      if (dist < bestDist) {
        bestDist = dist
        best = a
      }
    }
    return best
  }
  return null
}

async function appendDailyMutantOffers(
  xml: string,
  sprint: number,
  filterDates: Record<string, FilterDateRange>,
  buildItem: (
    itemXml: string,
    forceFeatured?: 'day',
  ) => Promise<{ item: ForecastItem; exactRange: FilterDateRange | null } | null>,
  items: ForecastItem[],
): Promise<Map<string, number>> {
  const windowStart = sprintStartDate(sprint).getTime()
  const windowEnd = sprintStartDate(sprint + 1).getTime()
  // itemId (lower) -> dayMs, только специмены дневной лестницы.
  const ladderByItemId = new Map<string, number>()

  // НАХОДКА 2026-09-08: фильтр по атрибуту category="specimen" пропускает
  // Specimen_CA_06 - тот же специмен, но с ОШИБОЧНОЙ разметкой в игре
  // (category="material" на реальном мутанте, баг данных Kobojo). Из-за
  // этого позиция для 12 сентября выпадала из пула, что выглядело как
  // "провал" в последовательности. Фильтр по префиксу itemId (тот же
  // /^-*#?specimen_/i, что уже использует classifyFeaturedMutant) находит
  // его правильно, независимо от того, что написано в category. С этим
  // фиксом позиции 0-7 спринта 256 легли ИДЕАЛЬНО день-в-день без единого
  // расхождения (проверено на живых данных + посте @KaiserZ).
  // ПОЗИЦИЯ СЧИТАЕТСЯ ТОЛЬКО ПО specimen_ (найдено 2026-09-16, доказано
  // бэктестом на 40 kartel-подтверждённых точках за 6 недель): "один день =
  // один специмен" держится идеально (33/40 попаданий ровно в ноль, между
  // крайними якорями 41 специмен = 41 день), а вот расширение счётчика на
  // bundle_orbs_/pack_daily_ (2026-09-11) эту лестницу ломало - те офферы
  // многодневные, своего дня в ротации не занимают, и каждый из них сдвигал
  // все последующие даты на +1. На той же выборке RAW-лестница давала 1/40
  // попаданий с накопительной ошибкой -1 -> -6 дней по мере удаления от
  // якоря. Именно это видели как "наши даты опережают график".
  // bundle/pack из пула остаются в выдаче, но дату получают ТОЛЬКО от kartel
  // (ниже) - позиционно их датировать нельзя. Их настоящая дата приезжает из
  // спринт-блока через наследование от якоря (см. inheritDatesFromAnchors).
  const pool: DailyPoolEntry[] = []
  let position = 0
  for (const itemXml of xml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    if (!itemXml.includes('subCat="dailyoffer"')) continue
    const itemId = itemXml.match(/itemId="([^"]+)"/)?.[1]
    if (!itemId || !/^-*#?(specimen_|bundle_orbs_|pack_daily_)/i.test(itemId)) continue
    const filterTag = itemXml.match(/<Filter>([^<]*)<\/Filter>/)?.[1] ?? null
    const isSpecimen = /^-*#?specimen_/i.test(itemId)
    pool.push({ position: isSpecimen ? position++ : -1, isSpecimen, itemXml, filterTag })
  }

  // Проход 1 - подтверждённые точки: живой снэпшот kartel этого прогона
  // (окно <=3 дня, тот же гейт, что classifyFeaturedMutant использует для
  // "обычного" дневного оффера) ПЛЮС постоянный журнал (scripts/kartel/
  // date-ledger.json) - тот копит подтверждённые даты за всю историю
  // прогонов, живой снэпшот видит только ~7 дней вперёд. Журнал даёт
  // якоря там, где живого окна уже нет, но позиция когда-то была
  // подтверждена - плотнее сетка соседей = меньше отбросов по
  // MAX_NEIGHBOR_DISTANCE.
  const dateLedger = await loadDateLedger()
  const confirmed: { position: number; dayMs: number }[] = []
  for (const entry of pool) {
    // Якорем лестницы может быть только специмен - у bundle/pack позиции нет.
    if (!entry.isSpecimen) continue
    const range = pickFilterDateRange(filterDates, entry.filterTag)
    if (range?.start && range.end) {
      const startMs = new Date(range.start).getTime()
      const endMs = new Date(range.end).getTime()
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && (endMs - startMs) / DAY_MS <= 3) {
        confirmed.push({ position: entry.position, dayMs: startMs })
        continue
      }
    }
    const ledgerStart = entry.filterTag ? dateLedger[entry.filterTag] : undefined
    if (ledgerStart) {
      const startMs = new Date(ledgerStart).getTime()
      if (!Number.isNaN(startMs)) confirmed.push({ position: entry.position, dayMs: startMs })
    }
  }

  const { kept: confirmedClean, outlierPositions } = dropOutliers(confirmed)
  if (outlierPositions.size > 0) {
    console.log(
      `[forecast] дневной пул: отброшено выбивающихся kartel-дат: ${outlierPositions.size} (позиции ${[...outlierPositions].join(', ')})`,
    )
  }
  const waves = buildWaves(confirmedClean)

  // Проход 2 - для каждой записи пула решаем, подтверждена дата или её
  // нужно прогнозировать; отбрасываем всё, что не попадает в окно текущего
  // спринта (и подтверждённое, и прогнозное - иначе прогноз на позицию за
  // сотни дней от ближайшего якоря дал бы бессмыслицу, дата-фильтр её и
  // отсекает).
  for (const entry of pool) {
    const range = pickFilterDateRange(filterDates, entry.filterTag)
    const isConfirmed = !!(
      range?.start &&
      range.end &&
      (new Date(range.end).getTime() - new Date(range.start).getTime()) / DAY_MS <= 3
    )
    let dayMs: number
    // Выброс не доверяем даже на его собственной плитке - считаем по лестнице.
    if (isConfirmed && !outlierPositions.has(entry.position)) {
      dayMs = new Date(range!.start).getTime()
    } else if (!entry.isSpecimen) {
      // Не-специмен без живой даты: позиции в лестнице у него нет, гадать по
      // соседям нельзя (именно это давало ошибку в 1-3 дня на bundle/pack).
      // Его дату поставит наследование от якоря в спринт-блоке.
      continue
    } else {
      const waveAnchor = pickWaveAnchor(entry.position, waves)
      if (waveAnchor) {
        dayMs = waveAnchor.dayMs - (entry.position - waveAnchor.position) * DAY_MS
      } else {
        // Фоллбек для позиций без "доверенной" волны (одиночный
        // неподтверждённый вторым соседом якорь) - консервативный
        // MAX_NEIGHBOR_DISTANCE, как было раньше.
        const neighbor = pickNearestConfirmed(entry.position, confirmedClean)
        if (!neighbor || neighbor.dist > MAX_NEIGHBOR_DISTANCE) continue
        dayMs = neighbor.dayMs - (entry.position - neighbor.position) * DAY_MS
      }
    }
    const itemId = entry.itemXml.match(/itemId="([^"]+)"/)?.[1] ?? ''
    const isSpecimen = entry.isSpecimen
    // Лестница отдаётся наружу ДО фильтра по окну спринта - спринт-блок
    // датируется наследованием от этих же якорей (inheritDatesFromAnchors),
    // и ему нужны в том числе специмены у самой границы окна.
    if (isSpecimen && itemId) ladderByItemId.set(itemId.toLowerCase(), dayMs)
    if (dayMs < windowStart || dayMs >= windowEnd) continue

    const built = await buildItem(entry.itemXml, isSpecimen ? 'day' : undefined)
    if (!built) continue
    // Выброс тоже перезаписываем: buildItem уже проставил ему kartel-овский
    // exactDateLabel, а мы этой дате как раз не верим.
    if (!isConfirmed || outlierPositions.has(entry.position)) {
      built.item.exactDateLabel = `≈ ${formatDateRu(new Date(dayMs))}`
      built.item.exactDateStart = new Date(dayMs).toISOString()
      built.item.exactDateEnd = null
      built.item.exactDateApprox = true
    }
    items.push(built.item)
  }

  // Передний край пула (см. память auto-announcements-architecture,
  // "загадка 2 недель вперёд") - логируем БЕЗ учёта окна спринта, чтобы
  // видеть в проде, когда Kobojo реально продвигает горизонт вперёд
  // (SPRINT-дивайдер для след. спринта появляется в файле отдельно от
  // dailyoffer-пула - это два разных механизма обновления). Как только
  // frontEdge перевалит за конец текущего спринта, следующий прогон сам
  // начнёт покрывать начало следующего - никакого доп. кода не нужно,
  // просто нужно видеть момент сдвига в логах.
  const frontEntry = pool.find((p) => p.isSpecimen)
  if (frontEntry && confirmedClean.length > 0) {
    const frontNeighbor = pickNearestConfirmed(frontEntry.position, confirmedClean)
    if (frontNeighbor) {
      const frontDayMs =
        frontNeighbor.dayMs - (frontEntry.position - frontNeighbor.position) * DAY_MS
      console.log(
        `[forecast] дневной пул: передний край (позиция 0, не резолвится kartel дальше) = ${formatDateRu(new Date(frontDayMs))}`,
      )
    }
  }
  return ladderByItemId
}
