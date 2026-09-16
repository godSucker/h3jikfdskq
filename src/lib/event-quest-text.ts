// Числа в тексте условия ивентового задания. Общий код для парсера
// (scripts/build-event-quests.ts) и для рендера (/guides и /announcements),
// поэтому без импортов: tsx-скрипты и Vite читают его одинаково.

// "1 000" / "1,000" / "1.000" склеиваются в 1000, иначе amount=1000 в тексте
// не находится и рядом зря рисуется "×1000".
const joinDigitGroups = (t: string) => t.replace(/(\d)[\s\u00a0\u202f.,'](?=\d{3}(?!\d))/g, '$1')

export function numbersIn(text: string): string[] {
  return [...new Set(joinDigitGroups(text).match(/\d+/g) ?? [])]
}

export function hasNumber(text: string, n: number): boolean {
  return numbersIn(text).includes(String(n))
}

// "×N" рядом с условием нужен, только когда текст сам число не называет:
// "Победить в PvE-сражениях ×10", но не "Выиграть 30-е сражение ×30".
// Решается по тексту конкретного языка: у части заданий число есть в русском
// и турецком, но не в английском ("Kill more than one Mutant with a multi-attack").
export function shouldShowAmount(text: string, amount: number | null): boolean {
  return amount !== null && amount > 1 && !hasNumber(text, amount)
}
