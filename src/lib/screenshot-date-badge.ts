import type { Page } from 'playwright-core'

// Плашка "дата" на скрине модалки мутанта/скина для бот-скриншотера в
// админ-чат. У этих категорий нет игровой даты события - это "когда бот
// заметил появление", та же плашка, что на карточке анонса
// (src/components/announcements/AnnouncementCard.astro .card-date). Инъекция
// делается в headless-табе эндпоинта прямо перед снимком - живую модалку на
// сайте это не трогает.

// Формат RU, как fmtDate в src/lib/announcements-render.ts.
export function ruDate(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Вставляет плашку в левый верхний угол элемента-диалога. position:absolute
// внутри самого dialog (делаем его positioned, если вдруг static). No-op при
// пустом label. Снимать после этого нужно через page.screenshot({clip}) -
// НЕ elementHandle.screenshot(): у последнего встроенное ожидание "element
// stable", и добавление узла в модалку его сбрасывало -> таймаут 30с.
export async function injectDateBadge(
  page: Page,
  selector: string,
  label: string | null,
): Promise<void> {
  if (!label) return
  await page.evaluate(
    ({ sel, text }) => {
      const dlg = document.querySelector<HTMLElement>(sel)
      if (!dlg) return
      if (getComputedStyle(dlg).position === 'static') dlg.style.position = 'relative'
      const badge = document.createElement('div')
      badge.textContent = text
      // Только системный шрифт (без "TT Supermolot Neue") и без backdrop-filter:
      // и то, и другое давало микро-reflow/непрерывную композицию кадра, из-за
      // чего Playwright'овская проверка "element stable" не завершалась.
      badge.style.cssText = [
        'position:absolute',
        'top:12px',
        'left:12px',
        'z-index:99999',
        'font:700 13px/1 ui-sans-serif,system-ui,-apple-system,sans-serif',
        'letter-spacing:0.02em',
        'color:rgb(96,165,250)',
        'background:rgba(30,41,59,0.92)',
        'border:1px solid rgba(96,165,250,0.5)',
        'border-radius:999px',
        'padding:6px 12px',
      ].join(';')
      dlg.appendChild(badge)
    },
    { sel: selector, text: label },
  )
}
