import type { Page } from 'playwright-core'

// Готовит страницу /mutants к снимку модалки: (1) снимает backdrop-filter
// (overlay модалки несёт backdrop-blur-sm - непрерывная композиция кадра, из-за
// неё Playwright не считает элемент "stable" и screenshot отваливается по
// таймауту), (2) прячет всё, кроме оверлея с модалкой - фон каталога (грид с
// сотнями lazy-картинок) продолжает reflow'иться и тоже мешает стабилизации.
// Делается в headless-табе эндпоинта, живую страницу не трогает.
export async function freezePageForModalShot(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const dlg = document.querySelector<HTMLElement>(sel)
    if (!dlg) return
    const overlay = (dlg.closest('.fixed') as HTMLElement | null) ?? dlg
    document.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const bf = getComputedStyle(el).backdropFilter
      if (bf && bf !== 'none') {
        el.style.backdropFilter = 'none'
        el.style.setProperty('-webkit-backdrop-filter', 'none')
      }
    })
    // Прячем сиблингов оверлея на всех уровнях вверх до body - остаётся видимой
    // только ветка, ведущая к модалке.
    let node: HTMLElement | null = overlay
    while (node && node !== document.body && node.parentElement) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) (sib as HTMLElement).style.visibility = 'hidden'
      }
      node = node.parentElement
    }
    document.documentElement.scrollTop = 0

    // Битые картинки ВНУТРИ модалки (скин-арт, которого нет на CDN) - у них
    // Svelte-обработчик onerror перебирает fallback-кандидаты, каждый новый src
    // меняет высоту колонки -> bbox диалога осциллирует -> Playwright никогда
    // не считает элемент "stable" -> screenshot timeout. Клон без слушателей +
    // снятие src замораживает раскладку.
    dlg.querySelectorAll('img').forEach((el) => {
      const img = el as HTMLImageElement
      if (img.complete && img.naturalWidth > 0) return
      const clone = img.cloneNode(true) as HTMLImageElement
      clone.removeAttribute('src')
      clone.removeAttribute('srcset')
      clone.style.visibility = 'hidden'
      img.replaceWith(clone)
    })
  }, selector)
}

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
      // top:74px, не 12px: у самого верха модалки слева переключатель звёзд.
      // 74px = под ним, поверх верхнего-левого угла арта мутанта (пустой
      // градиент) - не зависит от общей высоты модалки.
      badge.style.cssText = [
        'position:absolute',
        'top:74px',
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
