import axios from 'axios'
import fs from 'fs/promises'
import fssync from 'fs'
import { runMain } from './lib/run-main'
import path from 'path'

// Каталог боксов для /boxes - строится НАПРЯМУЮ из shopitems.xml (s-beta), а не из
// obtain.json. obtain.json проиндексирован по мутанту и не хранит исходный itemId
// бокса - из-за этого было невозможно (а) показать боксы без единого мутанта
// (чисто ресурсные), (б) проверить полноту дроп-пула, (в) различить skin-тег,
// который у игры одним полем хранит то тир (bronze/silver/gold/platinum), то
// реальный косметический скин (wireframe/anniversary/...). Ключ карточки - настоящий
// itemId ShopItem, не текстовое название (одно и то же название вроде "Легендарный
// киберконтейнер" легитимно переиспользуется игрой для РАЗНЫХ продуктов).
//
// obtain.json НЕ трогаем и не перегенерируем - там кураторский текст (7 коммитов
// ручной калибровки + фиксы нечитаемых имён), см. память
// obtain-trigger-offer-names-fixed.

const SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const THUMB_BASE = 'https://s-beta.kobojo.com/mutants/assets/thumbnails/'

const MUTANTS_PATH = path.join(process.cwd(), 'src/data/mutants/mutants.json')
const BOXES_ICON_DIR = path.join(process.cwd(), 'public/boxes')
const OUT_PATH = path.join(process.cwd(), 'src/data/boxes.json')

const TIER_WORDS = new Set(['normal', 'bronze', 'silver', 'gold', 'platinum'])
const TIER_RU: Record<string, string> = {
  normal: 'обычный',
  bronze: 'бронза',
  silver: 'серебро',
  gold: 'золото',
  platinum: 'платина',
}
const STAR_INDEX_TO_TIER = ['normal', 'bronze', 'silver', 'gold', 'platinum']

interface BoxMutantRef {
  id: string
  name: string
  tier: string | null
  skin: string | null
}
interface BoxReward {
  name: string
  type: 'entity' | 'hardcurrency' | 'softcurrency'
  amount: number
}
// Одна "группа" = один атомарный результат розыгрыша бокса. Игра группирует
// ArticleItem через Tag key="option" value="X" + вес в Tag key="rand_X" на
// самом ShopItem (пример: Mystery_Anniversary26_1 - 6 опций по весу 30 =
// честные 1/6, при этом 5 из 6 опций бандлят мутанта С токеном как ОДИН
// исход, а не два независимых слота пула). У части старых боксов вместо
// этого вес висит прямо на ArticleItem через Tag key="rand" (без буквы) -
// тогда группа = один ArticleItem. Если у ArticleItem нет вообще никакого
// rand/option - это гарантированное содержимое бокса (chance: null),
// не часть лотереи (см. Anniversary_Box_Mystery - гарантированный XP1000
// + рандомный мутант).
interface BoxGroup {
  chance: number | null
  mutants: BoxMutantRef[]
  rewards: BoxReward[]
}
interface BoxPrice {
  amount: number
  type: 'hardcurrency' | 'softcurrency'
}
interface BoxEntry {
  itemId: string
  icon: string | null
  category: string
  name: string
  price: BoxPrice | null
  groups: BoxGroup[]
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of attrStr.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]] = m[2]
  return attrs
}

// Часть названий боксов в игровой локализации обрезаны (не хватает закрывающей
// «кавычки») - см. Luckybox_Independence_2026. Балансируем на выходе.
function balanceQuotes(name: string): string {
  const open = (name.match(/«/g) ?? []).length
  const close = (name.match(/»/g) ?? []).length
  return open > close ? name + '»'.repeat(open - close) : name
}

async function main() {
  const [{ data: xml }, { data: locRaw }, mutants] = await Promise.all([
    axios.get<string>(SHOPITEMS_URL, { responseType: 'text' }),
    axios.get<string>(LOC_RU_URL, { responseType: 'text' }),
    fs.readFile(MUTANTS_PATH, 'utf-8').then((t) => JSON.parse(t) as { id: string; name: string }[]),
  ])

  const loc = new Map<string, string>()
  const locLower = new Map<string, string>()
  for (const rawLine of locRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const i = line.indexOf(';')
    if (i === -1) continue
    const key = line.slice(0, i)
    const val = line.slice(i + 1)
    loc.set(key, val)
    // Локализация регистро-непоследовательна относительно itemId в shopitems.xml
    // (LuckyBox_Halloween24 в шопе, Luckybox_Halloween24 в локализации) -
    // регистронезависимая карта как второй проход.
    if (!locLower.has(key.toLowerCase())) locLower.set(key.toLowerCase(), val)
  }

  const mutantIds = new Set(mutants.map((m) => m.id.toLowerCase()))
  const mutantNameById = new Map(mutants.map((m) => [m.id.toLowerCase(), m.name]))

  function lookup(key: string): string | undefined {
    return loc.get(key) ?? locLower.get(key.toLowerCase())
  }

  function resolveName(itemId: string, caption: string | undefined): string {
    // itemId почти всегда сам является ключом короткого названия в локализации -
    // надёжнее, чем caption (тот часто указывает на длинный tooltip/description).
    const byItemId = lookup(itemId)
    if (byItemId) return balanceQuotes(byItemId)

    // Год/номер в itemId иногда отсутствует в ключе локализации
    // (Luckybox_Valentines21 в шопе -> Luckybox_Valentines в локализации).
    const withoutTrailingDigits = itemId.replace(/\d+$/, '')
    if (withoutTrailingDigits !== itemId) {
      const byStripped = lookup(withoutTrailingDigits)
      if (byStripped) return balanceQuotes(byStripped)
    }

    if (caption) {
      const strippedKey = caption
        .replace(/^\$/, '')
        .replace(/_description$/, '')
        .replace(/_payment_text$/, '')
        .replace(/_tooltip$/, '')
      const byCaption = lookup(strippedKey) ?? lookup(caption)
      if (byCaption && byCaption.length <= 80) return balanceQuotes(byCaption)
    }

    // Совсем не нашли короткого названия - форматируем itemId, это лучше сырого кода.
    return itemId
      .replace(/^#\w+-\d+-/, '')
      .replace(/^#/, '')
      .replace(/_/g, ' ')
      .trim()
  }

  await fs.mkdir(BOXES_ICON_DIR, { recursive: true })
  const existingIcons = new Set(
    fssync.readdirSync(BOXES_ICON_DIR).map((f) => path.basename(f, path.extname(f))),
  )

  // Известный баг игровых данных: picture="luckybox_legend_gold_duo$$" (лишний "$$"
  // прямо в атрибуте) -> 404 даже на CDN Kobojo. Фоллбэк на близкую по теме иконку,
  // тот же фикс уже применялся раньше для этого случая (коммит 33a819c77).
  const BROKEN_PICTURE_FALLBACK: Record<string, string> = {
    luckybox_legend_gold_duo$$: 'lucky_box_xmas_gold',
  }

  async function ensureIcon(pictureRaw: string): Promise<string | null> {
    const picture = BROKEN_PICTURE_FALLBACK[pictureRaw] ?? pictureRaw
    if (!picture) return null
    if (existingIcons.has(picture)) return `/boxes/${picture}.png`
    try {
      const res = await axios.get<ArrayBuffer>(`${THUMB_BASE}${picture}.png`, {
        responseType: 'arraybuffer',
        timeout: 15000,
      })
      await fs.writeFile(path.join(BOXES_ICON_DIR, `${picture}.png`), Buffer.from(res.data))
      existingIcons.add(picture)
      return `/boxes/${picture}.png`
    } catch {
      return null
    }
  }

  const boxIconBasenames = existingIcons // расширяется по мере скачивания новых

  const shopItemRe = /<ShopItem\b([^>]*)>([\s\S]*?)<\/ShopItem>/g
  // Часть ArticleItem самозакрывающиеся (<ArticleItem typeId="X" />, обычно у
  // предметов без своих Tag) - альтернатива в регексе нужна явно, иначе жадный/
  // ленивый поиск закрывающего </ArticleItem> у самозакрывающегося тега случайно
  // проглатывает СЛЕДУЮЩИЙ ArticleItem целиком вместе с его тегами (был баг:
  // Material_XP1000 без тегов "крал" Tag key="rand" у следующего Specimen_AC_03).
  const articleRe = /<ArticleItem\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ArticleItem>)/g
  const topLevelTagRe = /<Tag key="([^"]+)" value="([^"]*)"\s*\/>/g

  function toMutantOrReward(
    typeId: string,
    tags: Record<string, string>,
  ): { mutant: BoxMutantRef } | { reward: BoxReward } {
    const idLower = typeId.toLowerCase()
    if (mutantIds.has(idLower)) {
      const skinVal = tags.skin
      const isTier = skinVal != null && TIER_WORDS.has(skinVal.toLowerCase())
      const starsTag = tags.stars
      let tier: string | null = null
      if (isTier) tier = TIER_RU[skinVal.toLowerCase()]
      else if (starsTag != null && STAR_INDEX_TO_TIER[Number(starsTag)]) {
        tier = TIER_RU[STAR_INDEX_TO_TIER[Number(starsTag)]]
      }
      const cosmeticSkin = skinVal && !isTier ? skinVal : null
      return {
        mutant: {
          id: idLower,
          name: mutantNameById.get(idLower) ?? typeId,
          tier,
          skin: cosmeticSkin,
        },
      }
    }
    const amount = tags.amount != null ? Number(tags.amount) : 1
    // Игра встречает валюту двумя разными способами: старые ArticleItem
    // используют typeId="gold"/"silver" (или пустой typeId = золото), новые
    // (бандлы/спец. предложения) - typeId="hardcurrency"/"softcurrency" напрямую.
    if (/^(gold|hardcurrency)$/i.test(typeId) || typeId === '') {
      return { reward: { name: 'gold', type: 'hardcurrency', amount } }
    }
    if (/^(silver|softcurrency)$/i.test(typeId)) {
      return { reward: { name: 'silver', type: 'softcurrency', amount } }
    }
    return { reward: { name: typeId, type: 'entity', amount } }
  }

  const boxes: BoxEntry[] = []
  let downloaded = 0
  let m: RegExpExecArray | null

  while ((m = shopItemRe.exec(xml))) {
    const attrs = parseAttrs(m[1])
    const body = m[2]
    const itemId = attrs.itemId ?? ''
    const picture = attrs.picture ?? ''
    if (!itemId || !picture) continue

    const isBoxLike = boxIconBasenames.has(picture) || /luckybox|lucky_box|mystery/i.test(itemId)
    if (!isBoxLike) continue

    const articles: { typeId: string; tags: Record<string, string> }[] = []
    let am: RegExpExecArray | null
    articleRe.lastIndex = 0
    while ((am = articleRe.exec(body))) {
      const articleAttrs = parseAttrs(am[1])
      const tags: Record<string, string> = {}
      if (am[2]) {
        for (const tm of am[2].matchAll(/key="([^"]+)" value="([^"]*)"/g)) tags[tm[1]] = tm[2]
      }
      // amount может быть атрибутом самого ArticleItem (amount="5" typeId="...")
      // или Tag key="amount" - оба варианта встречаются в данных.
      if (articleAttrs.amount != null && tags.amount == null) tags.amount = articleAttrs.amount
      articles.push({ typeId: articleAttrs.typeId ?? '', tags })
    }
    if (articles.length === 0) continue // не гача-пул (обычный магазинный товар) - пропускаем

    // Веса опций (rand_a, rand_b_gld, ...) висят на самом ShopItem, вне <ArticleItems>.
    const shopTags: Record<string, string> = {}
    topLevelTagRe.lastIndex = 0
    let tm2: RegExpExecArray | null
    while ((tm2 = topLevelTagRe.exec(body))) shopTags[tm2[1]] = tm2[2]

    const iconBefore = existingIcons.has(picture)
    const icon = await ensureIcon(picture)
    if (!iconBefore && icon) downloaded++

    // <Cost amount="1350" type="hardcurrency" /> - не у всех предложений есть
    // цена (часть боксов - чисто наградные/ивентовые, покупаются не за
    // валюту), тогда null.
    const costMatch = body.match(/<Cost amount="(\d+)" type="(hardcurrency|softcurrency)"\s*\/>/)
    const price: BoxPrice | null = costMatch
      ? { amount: Number(costMatch[1]), type: costMatch[2] as 'hardcurrency' | 'softcurrency' }
      : null

    const captionMatch = m[0].match(/caption="([^"]*)"/)
    const name = resolveName(itemId, captionMatch?.[1])
    const category = /luckybox|lucky_box/i.test(itemId)
      ? 'Лаки-бокс'
      : /mystery/i.test(itemId)
        ? 'Мистери-бокс'
        : ''

    // Группируем ArticleItem по Tag key="option" - все статьи с одинаковым
    // значением option образуют один атомарный исход розыгрыша (пример: мутант
    // + бонусный жетон выпадают ВМЕСТЕ, а не как два независимых слота пула).
    // Статьи без option - каждая своя отдельная группа (старые боксы вешают вес
    // прямо на ArticleItem через Tag key="rand", без буквенной группировки).
    const orderedKeys: string[] = []
    const articlesByOption = new Map<string, typeof articles>()
    for (const art of articles) {
      const key = art.tags.option ?? `__solo_${orderedKeys.length}`
      if (!articlesByOption.has(key)) {
        articlesByOption.set(key, [])
        orderedKeys.push(key)
      }
      articlesByOption.get(key)!.push(art)
    }

    // Вес группы: Tag rand_<option> на ShopItem, иначе Tag rand на самой статье
    // (только для solo-групп), иначе группа гарантирована (не часть лотереи).
    const rawGroups = orderedKeys.map((key) => {
      const arts = articlesByOption.get(key)!
      const fromOptionTag = key.startsWith('__solo_') ? undefined : shopTags[`rand_${key}`]
      const fromSoloTag = arts.length === 1 ? arts[0].tags.rand : undefined
      const weightStr = fromOptionTag ?? fromSoloTag
      const weight = weightStr != null ? Number(weightStr) : null
      return { arts, weight }
    })

    const totalWeight = rawGroups.reduce((sum, g) => sum + (g.weight ?? 0), 0)

    const groups: BoxGroup[] = rawGroups.map(({ arts, weight }) => {
      const group: BoxGroup = {
        chance: weight != null && totalWeight > 0 ? (weight / totalWeight) * 100 : null,
        mutants: [],
        rewards: [],
      }
      for (const art of arts) {
        const resolved = toMutantOrReward(art.typeId, art.tags)
        if ('mutant' in resolved) group.mutants.push(resolved.mutant)
        else group.rewards.push(resolved.reward)
      }
      return group
    })

    // itemId содержит "mystery" по названию, но не всегда является боксом - магазин
    // продаёт под тем же itemId-паттерном и одиночные предметы (здание "Анализатор
    // тайны" = Building_Mystery, жетоны "Таинственный жетон 2025/2026" =
    // Material_Mystery25/26_Token). Признак не-бокса: ровно одна группа, ровно одна
    // награда, и её id совпадает с itemId - значит покупка просто выдаёт саму себя,
    // без розыгрыша и без мутантов (см. baseId 6d6f36d91 обменников - похожая
    // "перезаписывается по имени" ловушка, здесь другая природа).
    const isSelfReferential =
      groups.length === 1 &&
      groups[0].mutants.length === 0 &&
      groups[0].rewards.length === 1 &&
      groups[0].rewards[0].type === 'entity' &&
      groups[0].rewards[0].name.toLowerCase() === itemId.toLowerCase()
    if (isSelfReferential) continue

    boxes.push({ itemId, icon, category, name, price, groups })
  }

  // Игра часто выставляет один и тот же продукт под несколькими itemId одновременно
  // (напр. базовый "LuckyBox_Cyber" + триггерные обёртки "#levelUp-N-LuckyBox_Cyber"
  // для попапов) - с точки зрения игрока это один и тот же бокс с одинаковым
  // содержимым. Схлопываем по полной сигнатуре (иконка+мутанты+награды), а не
  // только по названию - разные боксы с совпадающим названием (см.
  // boxes-page-shopitems-pipeline память) остаются раздельными карточками.
  const countMutants = (b: BoxEntry) => b.groups.reduce((n, g) => n + g.mutants.length, 0)

  const boxSignature = (b: BoxEntry) =>
    [
      b.icon ?? '',
      ...b.groups
        .map(
          (g) =>
            `${g.chance != null ? g.chance.toFixed(4) : 'guaranteed'}:` +
            [
              ...g.mutants.map((m) => `m:${m.id}|${m.tier ?? ''}|${m.skin ?? ''}`),
              ...g.rewards.map((r) => `r:${r.type}|${r.name}|${r.amount}`),
            ]
              .sort()
              .join(','),
        )
        .sort(),
    ].join('\n')

  const bySignature = new Map<string, BoxEntry>()
  for (const box of boxes) {
    const sig = boxSignature(box)
    const existing = bySignature.get(sig)
    // Предпочитаем "чистый" itemId (не #trigger-обёртку) как каноничный.
    if (!existing || (existing.itemId.startsWith('#') && !box.itemId.startsWith('#'))) {
      bySignature.set(sig, box)
    }
  }
  const dedupedBoxes = [...bySignature.values()]
  const duplicatesRemoved = boxes.length - dedupedBoxes.length
  // Даты релиза в shopitems.xml нет - используем позицию в файле как прокси
  // "новизны" (игра дописывает новые ShopItem в конец файла), реверсируем
  // порядок парсинга, чтобы новые боксы были дефолтно вначале списка.
  dedupedBoxes.reverse()

  await fs.writeFile(OUT_PATH, JSON.stringify(dedupedBoxes, null, 2) + '\n', 'utf-8')

  const withMutants = dedupedBoxes.filter((b) => countMutants(b) > 0).length
  const resourceOnly = dedupedBoxes.filter((b) => countMutants(b) === 0).length
  const withoutIcon = dedupedBoxes.filter((b) => !b.icon).length
  console.log(
    `[BOXES] ${dedupedBoxes.length} боксов (${withMutants} с мутантами, ${resourceOnly} чисто ресурсных, ${duplicatesRemoved} дублей схлопнуто)`,
  )
  console.log(`[BOXES] Иконок докачано: ${downloaded}, без иконки: ${withoutIcon}`)
}

runMain(import.meta.url, 'BUILD-BOXES', main)
