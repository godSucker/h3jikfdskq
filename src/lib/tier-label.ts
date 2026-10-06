// Единственный буквенный тир ('скам', Финансовая акула) хранится в данных на
// русском как есть; на остальных локалях подписи "Тир {n}" показываем SCAM,
// а не кириллицу посреди английского текста. Числовые тиры не меняются.
export const SCAM_TIER = 'скам'

export function tierText(tier: string | null | undefined, locale: string): string {
  const v = String(tier ?? '').trim()
  return v === SCAM_TIER && locale !== 'ru' ? 'SCAM' : v
}
