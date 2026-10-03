// eslint.config.js (flat config)
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import astro from 'eslint-plugin-astro'
import astroParser from 'astro-eslint-parser'
import svelte from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'

export default [
  // Артефакты сборки и чужой/сторонний код не линтуем
  {
    ignores: [
      'dist/**',
      '.vercel/**',
      '.astro/**',
      // генерируемые Astro типы во вложенных проектах (src/i18n, scripts/character-textures)
      '**/.astro/**',
      '**/.cache/**',
      '.mimocode/**',
      '.venv*/**',
      'node_modules/**',
      'temp/**',
      'public/**',
      'backend/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node-окружение: скрипты, генераторы, API-роуты
  {
    files: ['scripts/**', 'tools/**', 'src/pages/api/**', 'src/lib/tier-parser.js', 'astro.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Браузерное окружение: клиентский код сайта
  {
    files: ['src/**/*.svelte', 'src/**/*.ts', 'src/**/*.js', 'src/**/*.astro'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // CommonJS-скрипты: require() легален
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Astro files
  {
    files: ['**/*.astro'],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        // чтобы скриптовые блоки в .astro разбирались как TS/JS
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.astro']
      }
    },
    plugins: { astro },
    rules: {
      // базовые “разумные” правила для Astro
      'astro/no-set-html-directive': 'error',
      'astro/no-conflict-set-directives': 'error',
      'astro/no-unused-css-selector': 'warn'
    }
  },

  // Svelte files
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        // <script lang="ts"> внутри .svelte разбираем TS-парсером
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.svelte']
      }
    },
    plugins: { svelte },
    rules: {
      // безопасные и полезные правила для Svelte
      'svelte/no-reactive-reassign': 'error',
      'svelte/no-dupe-else-if-blocks': 'error',
      'svelte/no-at-html-tags': 'error'
    }
  },

  // Общие мелкие придирки, чтобы шум не мешал
  {
    rules: {
      // Для TS/Svelte неиспользуемое ловит @typescript-eslint-версия правила,
      // базовое no-undef в TS даёт ложные срабатывания (типы это работа tsc)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      // Пустой catch — осознанный паттерн (best-effort скачивания текстур и т.п.)
      'no-empty': ['error', { allowEmptyCatch: true }],
    }
  },
  {
    files: ['**/*.ts', '**/*.svelte', '**/*.astro'],
    rules: {
      'no-undef': 'off',
    }
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      'no-undef': 'error',
    }
  },
  // Внутренний тулинг: динамические XML/JSON-структуры, any оправдан
  {
    files: ['scripts/**', 'tools/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    }
  },
  // Большие Svelte-вьюхи исторически на any; полная типизация — отдельный
  // проект, до него держим сигнал видимым, но не блокирующим
  {
    files: ['**/*.svelte'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    }
  }
]
