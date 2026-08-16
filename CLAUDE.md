# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Collaboration style

- Don't just execute the literal request. Before implementing anything with real architectural/data/cost weight (new workflow, new data schema, changed sync/CI logic, new dependency, etc.), think it through as the more experienced engineer in the room: if there's a simpler, more reliable, or cheaper path, say so — with the concrete tradeoff — before building what was asked. Silently doing the suboptimal thing because it's what was literally typed is not helpful.
- Push back and argue when warranted. Agreement should track actual merit, not the path of least resistance. If you disagree with a stated approach, say so and why; if the user still wants it after hearing the tradeoff, do it.
- This does not apply to small, unambiguous asks (fix a typo, add a description, rename a var) — don't relitigate those. It's specifically for decisions with lasting consequences (architecture, data integrity, CI/CD, security, cost).
- New generated/rendered textures (compositor output, upscales, one-off renders) go in as `.png`, not `.webp` — don't lossy-convert to match the site's existing webp convention. Quality over consistency for freshly produced art.

## Project Overview

**Archivist-Library (MGG Hub)** is a Russian-language knowledge base and toolset for the game "Mutants Genetic Gladiators" (MGG). The site provides:
- Wiki for mutants and skins
- Simulators for roulettes, breeding, reactor, and crafting
- Calculators for stats and evolution resources
- Materials database

**Live site:** https://archivist-library.com (CDN: https://cdn.archivist-library.com)

## Tech Stack

- **Astro 5** with TypeScript — `output: 'server'` (SSR на Vercel), но почти все страницы `export const prerender = true`; серверными остаются только `src/pages/api/*`, `/panel-render`, `/top-evo` и `/announcements/render/[id]` (изолированный рендер одной карточки анонса для скриншот-API, см. комментарий в файле)
- **Svelte 5** for interactive components
- **Tailwind CSS 4** via Vite plugin
- **Sharp** for image optimization
- **Vercel Analytics & Speed Insights**

## Development Commands

```bash
# Start dev server (accessible on local network)
npm run dev

# Build for production (assets prefixed with CDN URL)
npm run build

# Preview production build
npm run preview

# Run Astro CLI
npm run astro

# Lint code (ESLint with Astro & Svelte support)
npx eslint .
```

The dev server runs with polling enabled and ignores Python venv directories (`.venv_orb`, `.venv`).

## Project Structure

### Entry Points & Layouts
- `src/pages/index.astro` — Homepage with navigation cards
- `src/layouts/BaseLayout.astro` — Global layout with header, mobile menu, and footer (Russian language)

### Core Features

**Mutants Browser** (`/mutants`)
- Единственная страница каталога; старые tier-адреса (`/mutants/bronze` и т.п.) — редиректы в `astro.config.ts`
- Components: `MutantsBrowser.svelte`, `MutantCard.svelte`, `MutantModal.svelte`
- Data: `src/data/mutants/mutants.json` (единый файл), `skins.json`, `src/data/mutant_names.json`
- Textures: CDN-based URLs via `src/lib/mutant-textures.ts`

**Breeding Simulator** (`/simulators/breeding`)
- UI: `src/components/breeding/BreedingUI.svelte`
- Logic: `src/lib/breeding/` (`breeding.ts`, `core-algorithm.ts`, `type-filters.ts`)
- XML settings: `src/data/breeding/settings.xml`
- Gene-based prediction algorithm with weighted outcomes

**Reactor/Gacha Simulator** (`/simulators/reactor`)
- Dynamic routes: `/simulators/reactor/[gachaId].astro`
- Component: `src/components/simulators/reactor/ReactorSimulator.svelte`
- Logic: `src/lib/reactor-gacha.ts`
- Data: `src/data/simulators/reactor/gacha.json`, texture mappings

**Roulette Simulators** (`/simulators/roulette`)
- Cash Machine: `src/components/simulators/cash/CashMachineSimulator.svelte` + `src/lib/cash-machine.ts`
- Lucky Slots: `src/components/simulators/lucky/LuckyMachineSimulator.svelte` + `src/lib/lucky-machine.ts`
- Madness: `src/components/simulators/madness/MutantsMadnessSimulator.svelte` + `src/lib/madness-machine.ts`

**Craft Simulator** (`/simulators/craft`)
- Component: `src/components/simulators/craft/CraftSimulator.svelte`
- Logic: `src/lib/craft-simulator.ts`
- Python reference: `src/data/simulators/CRAFT/craft.py`
- Data files: `orb.txt`, `lab.txt`, `star.txt`, `blackhole.txt`, `incentreward.txt`

**Calculators**
- Stats: `/simulators/stats` → `src/components/StatsCalculator.svelte`
  - Logic: `src/lib/stats/unified-calculator.ts`, `calculate-stats.ts`, `orbs.ts`
- Evo: `/evolution/evotech-calculator` → `src/components/EvotechCalculator.svelte`
  - Data: `src/data/evotech-data.js`

**Materials** (`/materials`)
- Pages: `index.astro`, `charms.astro`, `orbs.astro`, `material.astro`
- Component: `src/components/materials/MaterialsTable.astro`
- Data: `src/data/materials/*.json` (material, charms, orbs, buildings, zones, sources)
- Text data: `mut_orbs.txt`

**Other Features**
- Bingo: `/bingo` → data in `src/data/bingos.json`
- Top Evo: `/top-evo` → `src/components/EvoLeaderboard.svelte`, данные из Google Sheets (`src/lib/google-sheets-loader.ts`, кэш 5 мин, SSR)
- Credits: `/credits` → `src/components/Developers.svelte`
- Rebalance history: `/rebalance` — публичная страница истории изменений статов/способностей мутантов, `prerender = true`; данные `src/data/mutants/rebalance-history.json`

### Data Layer
- Game data stored in `src/data/` as JSON, TXT, and XLSX files
- Localization: `localisation_ru.txt` (только RU мирроритcя локально в src/data/ — `localisation_en.txt` в репо НЕТ, но см. Gotchas ниже: сам файл на 8 других языков существует на CDN Kobojo)
- Тиры мутантов: поле `tier` внутри `mutants.json` (обновляется через `api/telegram-webhook`)
- Base game data: `base.txt`

### Utility Libraries
- `src/lib/orbing-map.ts` — Orb mappings
- `src/lib/mutant-dicts.ts` — Mutant dictionaries
- `src/lib/secretCombos.ts` — Secret breeding combos
- `src/lib/search-normalize.ts` — Search utilities
- `src/lib/bingo-textures.ts` — Bingo image mappings

## Configuration Files

### Astro (`astro.config.ts`)
- Site URL: `https://archivist-library.com`
- Assets prefix: `https://cdn.archivist-library.com`
- Prefetch enabled for faster navigation
- Svelte integration
- Alias: `@` → `./src`
- Raw text plugin for `.txt` files

### Vite (in astro.config.ts)
- Tailwind CSS plugin
- Dev server exposed on network (hosts: `.ru.tuna.am`, `.nl.tuna.am`, `.manus.computer`)
- File watching with polling (1s interval)

### ESLint (`.eslint.config.js`)
- Flat config format
- Astro parser for `.astro` files
- Svelte parser for `.svelte` files
- TypeScript support
- Rules:
  - `astro/no-set-html-directive`: error
  - `svelte/no-reactive-reassign`: error
  - No unused vars (warn, ignore `_` prefix)

### Prettier (`.prettierrc`)
```json
{ "semi": false, "singleQuote": true, "printWidth": 100 }
```

## Architecture Notes

### Component Patterns
- **Astro components** (`.astro`) for static layouts and pages
- **Svelte components** (`.svelte`) for interactive UI (simulators, calculators, browsers)
- Global styles in `src/styles/global.css`
- Component-scoped styles with responsive breakpoints (mobile < 768px, tablet 768-1023px, desktop 1024px+, 2K/4K upscaling)

### Data Flow
- Static data loaded at build time in Astro components
- Client-side data fetched/processed in Svelte components
- Simulators use TypeScript logic modules for game mechanics
- XLSX files parsed with custom loader (`xlsx-loader.ts`)

### Styling Approach
- Custom CSS in BaseLayout for header/footer/navigation
- Tailwind utilities for component styling
- Dark theme (#0d1117 background, #c9d1d9 text)
- Background image overlay with fixed positioning
- Mobile-first responsive design
- Custom font: TT Supermolot Neue

### CDN & Asset Management
- Production assets served from `cdn.archivist-library.com`
- Images: `/mutants/`, `/stars/`, `/materials/`, `/fonts/`
- Texture mappings handle dynamic URLs for mutants/skins

## Important Notes

- All user-facing content is in **Russian**
- No test files in src/ (only in node_modules)
- API-роуты: `api/screenshot.ts` (headless Chromium скриншот стат-панели), `api/proxy-image.ts` (CORS-прокси, whitelist), `api/telegram-webhook.ts`
- Python scripts in `src/data/simulators/CRAFT/` are reference implementations
- Приём тир-файлов от бота: `src/pages/api/telegram-webhook.ts` (`src/lib/tier-parser.js`, секрет обязателен). `backend/tier_updater/` (старый Python-прототип) удалён 2026-08-13 — вытеснен этим JS-парсером.
- The site simulates real game mechanics with accurate probabilities
- Git history cleaned with filter-repo (evidence in `.git/filter-repo/`)

## Rules (from MEMORY.md)

- **Bingo sync is ADDITIVE ONLY**: read existing bingos.json, only ADD new entries. Never overwrite or delete existing data.
- **Breeding**: NEVER break secrets (secretCombos.ts) or type exceptions (type-filters.ts). Secrets checked FIRST, then genes, then type filtering. This order is sacred.
- **Breeding reference section is LOCKED**. Do NOT reopen without explicit user approval.
- **Auto-sync scripts** use GitHub Actions with `workflow_dispatch` (manual trigger), not cron.
- **No `tailwind.config.*` file**. Tailwind CSS 4 uses CSS-first config via `@import "tailwindcss"` in `src/styles/global.css`. Custom tokens are CSS custom properties in `:root`.
- **Reactor/gacha sync was REVERTED**. Do NOT recreate without user approval.
- **Weak mutants** (Specimen_A_02, Specimen_B_02, Specimen_C_02 = Слабый Робот/Зомби/Воин) must NEVER be parsed or written to mutants.json.
- **Bingo title matching** requires stripping dash prefixes: existing titles use `--------morphology_*` for sort order.
- **StatsCalculator.svelte uses `client:load`** (switched back from `client:only` 2026-08-12: `client:only` shipped zero SSR content, so any failed JS chunk on unstable connections — VPNs especially — left the page silently blank; `client:load` renders full markup via SSR first). All interactive components on the site use `client:load` or `client:visible`.
- **Stat calculation single source of truth**: `src/lib/stats/unified-calculator.ts` (`calculateFinalStats()`).
- **Lucky Box feature REMOVED**. All code, data, textures deleted. Lucky Slots roulette simulator is SEPARATE and must be preserved.
- **All new textures** must be uploaded to CDN.

## Sync Scripts

| Script | Trigger | Purpose |
|--------|---------|---------|
| `scripts/sync-mutants.ts` | `sync-cron.yml` daily 16:30 MSK | Parse gamedefinitions.xml, download textures, update mutants.json |
| `scripts/sync-bingo.ts` | `sync-simulators.yml` manual | Incremental bingo updater (additive only) |
| `scripts/download-skins.ts` | `sync-cron.yml` daily | Download skin textures from CDN |

## Gotchas

- **esbuild/tsx cannot parse UTF-8 em dash (U+2014 —) in JSDoc comments**: Use ASCII-only `//` comments in .ts scripts.
- **ShopItems XML is minified**: Python `xml.etree.ElementTree` fails. Use Node.js `fast-xml-parser`.
- **`.effect-row` background is INTENTIONAL**: Never set to transparent. User confirmed this is desired look.
- **Orb sizing needs `overflow: hidden`**: Without it, orb images render at intrinsic size (hundreds of px).
- **`@sparticuz/chromium` v149**: Use dynamic import, not static — Vite ESM interop breaks static import.
- **CDN CORS only allows archivist-library.com**: Blocks localhost. Screenshots with images only testable on production.
- **CSS background-image URLs must use hardcoded CDN**: `<style>` blocks in Svelte/Astro cannot call JS `textureUrl()`. Must use full `https://cdn.archivist-library.com/...` paths.
- **`.icon` property pattern requires per-usage wrapping**: Every `src={something.icon}` template binding must be wrapped with `textureUrl()`. Data definitions can stay as bare paths.
- **SSR + fs.readFileSync in Vercel**: Pages with `output: "server"` run frontmatter at request time. `src/data/` doesn't exist at runtime — only `dist/`. Must use `export const prerender = true`.
- **Dynamic routes require prerender=true in SSR**: Pages using `getStaticPaths()` in SSR mode MUST have `export const prerender = true`. Both `[param].astro` and parent need it.
- **Lazy loading critical for performance**: All grid/list images must use `loading="lazy"`. Never `loading="eager"` on bulk images.
- **`localisation_{lang}.txt` exists on Kobojo CDN for ALL 9 languages**, not just RU: `https://s-beta.kobojo.com/mutants/gameconfig/localisation_{en,es,fr,de,pt,it,tr,nl}.txt` all return 200 (confirmed 2026-08-16). Only `localisation_ru.txt` is mirrored locally in `src/data/`, which previously led to the false assumption "no official translation source exists" for several i18n gaps (special-offers names, event/ladder names) — they were actually resolvable via `event_name_*`/direct-id keys in these files, no LLM needed. Before declaring any RU-only game text a "curator-authored, needs-permission" gap, check these CDN files first (see `scripts/build-materials-i18n.ts` / `build-special-offers.ts` for the established fetch+lookup pattern).

## AWS Guidance

(Установлено через `aws configure agent-toolkit`, 2026-08-11 — актуально для будущей работы с CloudFront/Route53/S3, сейчас сайт эти сервисы напрямую не использует)

- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed execution, observability, and audit logging. If unavailable, use the AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available. Load the skill with `retrieve_skill` and prefer its guidance over general knowledge.
- When uncertain about specific AWS details (API parameters, permissions, limits, error codes), verify against documentation rather than guessing. State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework principles.
- Do not use em dashes in AWS resource names or descriptions. Use hyphens instead.

### Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret, credential, API key, token, or password task. MUST NOT call `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST NOT hit the Secrets Manager Agent daemon directly. MUST use `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with `asm-exec` so the secret resolves at runtime without entering context.
