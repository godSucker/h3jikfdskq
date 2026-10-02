import type { Locale } from '@/lib/i18n'

// Локали, на которых скриншот-бот умеет снимать карточки/модалки
// (?lang= у render-страниц и api/screenshot-*). Whitelist, а не любой Locale:
// значение приходит из query и подставляется в URL headless-Chromium.
export const RENDER_LOCALES = ['ru', 'en'] as const satisfies readonly Locale[]

export function renderLocale(raw: string | null | undefined): (typeof RENDER_LOCALES)[number] {
  return raw === 'en' ? 'en' : 'ru'
}
