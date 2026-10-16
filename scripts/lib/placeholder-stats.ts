// Заглушечные статы мутанта, которые Kobojo кладёт в gamedefinitions.xml до
// выхода реальных значений (у EC_14, DF_14 и BA_15 в первом же коммите были
// ровно эти шесть чисел). Когда реальные статы приходят, parser режима
// rebalance видит "изменение" hp 1130 -> 4233 и пишет его в
// rebalance-history.json как ребаланс, а build-announcements публикует
// карточку "Ребаланс". Это не ребаланс: мутанта до этого момента просто не
// было в игре с настоящими цифрами.
//
// Одного hp недостаточно: hp 1130 встречается и у настоящего ff_14, поэтому
// сверяем все шесть полей сразу.
const PLACEHOLDER_BASE_STATS = {
  hp_base: 1130,
  atk1_base: 312,
  atk1p_base: 468,
  atk2_base: 312,
  atk2p_base: 468,
  speed_base: 5,
} as const

type BaseStatsLike = Partial<Record<keyof typeof PLACEHOLDER_BASE_STATS, number | null>>

export function isPlaceholderStats(
  entry: { base_stats?: BaseStatsLike | null } | null | undefined,
) {
  const base = entry?.base_stats
  if (!base) return false
  return (Object.keys(PLACEHOLDER_BASE_STATS) as (keyof typeof PLACEHOLDER_BASE_STATS)[]).every(
    (k) => base[k] === PLACEHOLDER_BASE_STATS[k],
  )
}

// Статы, вписанные вручную (с баннера анонса, со скриншота тестера) до выхода
// официальных значений, помечаются в mutants.json полем provisionalStats: true.
// Пока в XML у такого мутанта всё ещё заглушка, парсер (rebalance/stats)
// перезаписал бы ручные цифры заглушкой и записал это как ребаланс. Здесь
// ручные статы и способности переносятся в свежую запись, чтобы обновилась
// только локализация. Когда в XML появятся не-заглушечные статы, функция
// ничего не делает: запись заменяется целиком, флаг уходит сам, а переход
// считается выходом мутанта, а не ребалансом (см. isProvisionalOrPlaceholder).
export function keepProvisionalStats(existing: any, incoming: any): boolean {
  if (!existing?.provisionalStats || !isPlaceholderStats(incoming)) return false
  incoming.base_stats = existing.base_stats
  incoming.abilities = existing.abilities
  incoming.provisionalStats = true
  return true
}

export function isProvisionalOrPlaceholder(existing: any): boolean {
  return existing?.provisionalStats === true || isPlaceholderStats(existing)
}

// Ручной русский перевод имени и атак (пока Kobojo кладёт в localisation_ru.txt
// непереведённый текст на другом языке, см. BA_15 с турецкими названиями).
// Запись помечена provisionalLocale: true. Пока в свежей записи поле без
// единой кириллической буквы (непереведённый фолбэк), берём ручное значение;
// как только пришёл настоящий русский текст, он заменяет ручной, и когда
// все поля стали официальными, флаг уходит сам (запись заменяется целиком).
const LOCALE_FIELDS = ['name', 'name_attack1', 'name_attack2', 'name_attack3'] as const

const hasCyrillic = (s: unknown): boolean => typeof s === 'string' && /[Ѐ-ӿ]/.test(s)

export function keepProvisionalLocale(existing: any, incoming: any): boolean {
  if (!existing?.provisionalLocale) return false
  let kept = false
  for (const f of LOCALE_FIELDS) {
    const manual = existing[f]
    // Не затираем ручное значение пустым или без кириллицы: ни то ни другое
    // не является официальным русским текстом.
    if (hasCyrillic(manual) && !hasCyrillic(incoming[f])) {
      incoming[f] = manual
      kept = true
    }
  }
  if (kept) incoming.provisionalLocale = true
  return kept
}
