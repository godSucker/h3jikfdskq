// Как читать клетку бинго-доски (bingos.json -> mutants[].skin).
//
// Поле skin в данных несёт ДВА разных смысла, и это не наша выдумка, а формат
// самой игры (morphology_*.xml, атрибут skin у <col>):
//   - "_any"      - мутант засчитывается в любом виде, звезда не важна;
//   - "bronze"/"silver"/"gold"/"platinum" - доска требует мутанта именно этой
//     звёздности (bingo_bronze, amazons, zodiac_silver, starter_plat...);
//   - любое другое значение - настоящий скин (halloween, winter, gachaboss...).
//
// До 2026-09-18 звёздность на /mutants подбиралась не отсюда, а по ПОДСТРОКЕ в
// id доски: `id.includes('research_1') -> bronze` и т.д. Из-за этого доски
// "Исследование 1-4" получали звёзды, которых игра не требует (в их XML у всех
// клеток skin="_any"), "Исследование 10/11" ловились подстрокой research_1 и
// тоже красились в бронзу, а "Амазонки" (в данных silver) наоборот оставались
// без звезды. Баг нашёл Иван Веприк.
export const STAR_TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const
export type StarTier = (typeof STAR_TIERS)[number]

export interface BingoEntryVariant {
  // Звёздность, в которой доска требует мутанта (иначе null - показываем как есть).
  star: StarTier | null
  // Настоящий скин, если клетка требует его (иначе null).
  skin: string | null
}

export function bingoEntryVariant(rawSkin: string | null | undefined): BingoEntryVariant {
  const value = String(rawSkin ?? '')
    .trim()
    .toLowerCase()
  if (!value || value === '_any') return { star: null, skin: null }
  if ((STAR_TIERS as readonly string[]).includes(value))
    return { star: value as StarTier, skin: null }
  return { star: null, skin: value }
}
