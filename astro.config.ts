import { defineConfig } from 'astro/config'
import svelte from '@astrojs/svelte'
import sitemap from '@astrojs/sitemap'
import vercel from '@astrojs/vercel'
import tailwindcss from '@tailwindcss/vite'
import raw from 'vite-plugin-raw'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  site: 'https://archivist-library.com',
  output: 'server',
  // Найдено 2026-11-25 (GSC-разбор): без явной настройки Astro матчит и
  // слеш, и бесслеш как один роут ('ignore') - для SSR-страниц (/panel-render,
  // /top-evo, /announcements/render/[id], api/*) это ничего не меняет (у них
  // уже нет слеша в реальных вызовах), но canonical-тег везде резолвится в
  // форму СО слешем (см. BaseLayout.astro) - 'always' просто совмещает
  // поведение SSR-роутов с уже фактическим канон. Для prerender-страниц (почти
  // весь сайт) Astro это НЕ редиректит (hosting-платформа отвечает за это -
  // см. докстринг trailingSlash в astro/dist/types/public/config.d.ts) -
  // настоящий редирект для них отдельно в vercel.json.
  trailingSlash: 'always',
  // Доверенные хосты запроса. С Astro 5.18 (обновление от 03.10.2026) без этого
  // списка заголовок Host не доверяется, и url.origin в SSR равен https://localhost:
  // сломался постер тира на превью (headless-браузер ходил на localhost), а
  // встроенная защита checkOrigin отвергала form-POST с верным Origin. Хосты
  // отсюда проходят проверку (релей присылает Host: archivist-library.com), любой
  // другой по-прежнему становится localhost. Протокол и порт не задаём: лямбда
  // получает запрос по http изнутри Vercel.
  security: {
    allowedDomains: [
      { hostname: 'archivist-library.com' },
      { hostname: 'www.archivist-library.com' },
      { hostname: 'preview.archivist-library.com' },
    ],
  },
  // harfbuzzjs (text shaping, pulled in transitively by @resvg/resvg-js for
  // the stats-bot card renderer) loads hb.wasm at runtime via a path Vercel's
  // file tracer doesn't follow statically - without this the function bundle
  // is missing it and the whole process aborts on first render (ENOENT).
  adapter: vercel({
    includeFiles: ['./node_modules/harfbuzzjs/hb.wasm'],
  }),
  prefetch: true,
  // i18n (Батч 11): RU остаётся канонической версией без префикса в URL,
  // остальные 8 локалей Kobojo живут под /en /es /fr /de /pt /it /tr /nl.
  // Язык первого визита определяет middleware.ts (Accept-Language), дальше —
  // переключатель в шапке. Список путей, реально переведённых на каждую
  // локаль (сейчас Главная + /mutants), — единый источник в src/lib/i18n.ts
  // (TRANSLATED_PATHS), читается и middleware, и BaseLayout, и переключателем.
  i18n: {
    defaultLocale: 'ru',
    locales: ['ru', 'en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  // Старые тир-адреса каталога мутантов: страницы удалены, фильтрация по звёздам
  // живёт внутри /mutants. Редиректы сохраняют внешние ссылки/закладки.
  redirects: {
    '/mutants/all': '/mutants',
    '/mutants/normal': '/mutants',
    '/mutants/bronze': '/mutants',
    '/mutants/silver': '/mutants',
    '/mutants/gold': '/mutants',
    '/mutants/platinum': '/mutants',
    // Дубликат страницы эво-калькулятора: канонический адрес — /evolution/evotech-calculator
    '/evotech-calculator': '/evolution/evotech-calculator',
    // Устаревший дублирующий рендер каталога материалов (своя, разошедшаяся с
    // /materials сортировка жетонов) — канонический адрес /materials
    '/materials/material': '/materials',
  },
  integrations: [
    svelte(),
    // Карта сайта из всех prerender-страниц; служебные не включаем
    sitemap({
      filter: (page) => !page.includes('/panel-render'),
      i18n: {
        defaultLocale: 'ru',
        locales: {
          ru: 'ru',
          en: 'en',
          es: 'es',
          fr: 'fr',
          de: 'de',
          pt: 'pt',
          it: 'it',
          tr: 'tr',
          nl: 'nl',
        },
      },
    }),
  ],

  vite: {
    plugins: [tailwindcss(), raw({ match: /\.txt$/ })],
    resolve: {
      alias: {
        '@': SRC,
      },
    },
    server: {
      host: true,
      allowedHosts: ['.ru.tuna.am', '.nl.tuna.am', '.manus.computer'],
      hmr: {
        overlay: false,
      },
      watch: {
        usePolling: false,
        ignored: [
          '**/.venv_orb/**',
          '**/.venv/**',
          '**/venv/**',
          '**/node_modules/**',
          '**/textures_by_mutant/**',
          '**/.vercel/**',
          '**/dist/**',
          '**/.git/**',
          '**/*.webp',
          '**/*.png',
          '**/*.jpg',
        ],
      },
    },
  },
})
