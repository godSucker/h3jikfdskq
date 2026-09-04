// Общий парсер игровых "лент" (offerTag) и реал-money цен для ShopItem-блоков
// shopitems.xml - используется И detect-shop-forecast.ts (прогноз магазина),
// И detect-daily-news.ts (резолв цены/имени daily_news-оффера через тот же
// shopIndex). Живая проверка 2026-09-04 (shopitems.xml с s-beta.kobojo.com):
// offerTag реально несёт "legendary$$"/"limited$$"/"offertag_new$$"/
// "offertag_NN$$" (скидка N%)/"heroic$$"/"exclusive$$" + сезонные метки
// (xmas/halloween/easter/зодиак/юбилей) - те же ленты, что видны в живой игре
// (LIMITED OFFER/Legendary/NEW на скринах юзера). "$$" - плейсхолдер локали,
// не влияет на смысл тега, всегда отрезается.
//
// Храним ribbon как плоскую строку (не union-объект) - так он безопасно
// проходит через announcements.json (обычный JSON, без сериализации классов).
export type OfferRibbon =
  | 'legendary'
  | 'limited'
  | 'new'
  | 'heroic'
  | 'exclusive'
  | 'seasonal'
  | `discount-${number}`

export function parseOfferRibbon(raw: string | undefined | null): OfferRibbon | null {
  if (!raw) return null
  const tag = raw.replace(/\$+$/, '').toLowerCase()
  if (tag === 'legendary') return 'legendary'
  if (tag === 'limited') return 'limited'
  if (tag === 'heroic') return 'heroic'
  if (tag === 'exclusive') return 'exclusive'
  if (tag === 'offertag_new') return 'new'
  const discount = tag.match(/^offertag_(\d{1,3})$/)
  if (discount) return `discount-${Number(discount[1])}`
  // Сезонные метки не несут единого суффикса ($$/без него), проверяем по
  // подстроке: xmas/snow/winter (Рождество), halloween, easter (Пасха),
  // anniversary/zodiac (юбилей/зодиак-ивент), patrick/gaming (разовые ивенты).
  if (/xmas|snow|winter|halloween|easter|anniversary|zodiac|patrick|gaming/.test(tag)) {
    return 'seasonal'
  }
  return null
}

// <ShopItem ...><RealPrices Currency="USD" Value="4.99" />...</ShopItem> -
// донат-паки за реальные деньги, найдено 2026-09-04 (Specimen_FC_04,
// Zagam/Dreaming Anthroborg/Terracotta-паки на скринах юзера) - до этого
// НЕ парсилось нигде, такие офферы показывались без цены вообще.
export function parseRealPriceUSD(itemXml: string): number | null {
  const m = itemXml.match(/<RealPrices\s+Currency="USD"\s+Value="([\d.]+)"/)
  return m ? Number(m[1]) : null
}
