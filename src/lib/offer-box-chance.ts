/**
 * "Последние появления" в модалке мутанта: контейнер (лаки-/мистери-бокс), из
 * которого нужный мутант выпадает с малым шансом, - шум, а не предложение (фидбек
 * 2026-10: из 816 появлений в контейнерах только у 8 шанс >= 10%). Скиновые
 * контейнеры шумом не считаются сами собой: у них мало групп, шансы 16-25%.
 *
 * Шанс мутанта в контейнере = сумма chance (проценты) групп boxes.json, в которых он
 * есть. Если контейнера или мутанта в нём нет в данных - шанс неизвестен, запись
 * ОСТАВЛЯЕМ (лучше лишняя запись, чем потерянное настоящее появление).
 */

/** Ниже этого шанса (в %) появление в контейнере в историю не попадает. */
export const MIN_BOX_CHANCE_PCT = 10

export interface BoxLike {
  itemId: string
  groups: { chance: number; mutants: { id: string }[] }[]
}

/** itemId контейнера -> (id мутанта в нижнем регистре -> суммарный шанс, %). */
export type BoxChanceIndex = Map<string, Map<string, number>>

export function buildBoxChanceIndex(boxes: BoxLike[]): BoxChanceIndex {
  const index: BoxChanceIndex = new Map()
  for (const box of boxes) {
    const perMutant = new Map<string, number>()
    for (const group of box.groups ?? []) {
      for (const m of group.mutants ?? []) {
        const id = String(m.id).toLowerCase()
        perMutant.set(id, (perMutant.get(id) ?? 0) + (Number(group.chance) || 0))
      }
    }
    index.set(box.itemId, perMutant)
  }
  return index
}

/**
 * true - запись истории надо выбросить. ref вида "<type>|<where>" - это записи
 * "Как получить" (реакторы, рейды, PvP, залы), не контейнеры; голый itemId - товар
 * магазина, и только он может оказаться контейнером из boxes.json.
 */
export function isLowChanceBoxAppearance(
  index: BoxChanceIndex,
  mutantId: string,
  ref: string,
  threshold: number = MIN_BOX_CHANCE_PCT,
): boolean {
  if (ref.includes('|')) return false
  const chance = index.get(ref)?.get(mutantId.toLowerCase())
  return chance !== undefined && chance > 0 && chance < threshold
}
