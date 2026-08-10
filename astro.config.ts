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
  adapter: vercel(),
  prefetch: true,
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
  },
  integrations: [
    svelte(),
    // Карта сайта из всех prerender-страниц; служебные не включаем
    sitemap({ filter: (page) => !page.includes('/panel-render') }),
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
