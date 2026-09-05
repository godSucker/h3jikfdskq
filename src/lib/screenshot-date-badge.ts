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
// внутри самого dialog (делаем его positioned, если вдруг static) - так плашка
// гарантированно попадает в кадр dialog.screenshot(). No-op при пустом label.
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
      badge.style.cssText = [
        'position:absolute',
        'top:12px',
        'left:12px',
        'z-index:99999',
        'font:700 13px/1 "TT Supermolot Neue",ui-sans-serif,system-ui,sans-serif',
        'letter-spacing:0.02em',
        'color:rgb(96,165,250)',
        'background:rgba(96,165,250,0.14)',
        'border:1px solid rgba(96,165,250,0.4)',
        'border-radius:999px',
        'padding:6px 12px',
        'backdrop-filter:blur(4px)',
      ].join(';')
      dlg.appendChild(badge)
    },
    { sel: selector, text: label },
  )
}
