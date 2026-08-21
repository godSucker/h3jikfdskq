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
