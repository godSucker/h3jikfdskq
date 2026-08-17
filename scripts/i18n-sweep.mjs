// Систематический браузерный i18n-прогон: все переведённые пути x 8
// не-RU локалей, TreeWalker по текстовым узлам + перебор title/alt/
// aria-label/placeholder в одном page.evaluate() (см. память
// i18n-roulette-simulators-fixed-2026-08-17/i18n-full-sweep-browser-pass-done-2026-08-17
// для методологии и истории находок). Требует запущенного dev-сервера
// (npm run dev, localhost:4321) и системного Chrome (/opt/google/chrome/chrome).
// Запуск из корня репо: node scripts/i18n-sweep.mjs
// НЕ ловит: утечки в интерактивных/вычисляемых состояниях (симулятор-
// результаты, модалки) - для них нужен статический grep-аудит src/lib,
// НЕ ловит: CSS-селекторы на локализуемый data-атрибут - для них grep
// по `<style>`-блокам на `[data-...="<кириллица>"]`.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = 'http://localhost:4321';
const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'nl'];
const PATHS = [
  '/',
  '/bingo',
  '/boxes',
  '/credits',
  '/evolution/evotech-calculator',
  '/guides',
  '/materials',
  '/materials/charms',
  '/materials/orbs',
  '/mutants',
  '/rebalance',
  '/simulators',
  '/simulators/breeding',
  '/simulators/craft',
  '/simulators/pvp',
  '/simulators/reactor',
  '/simulators/reactor/gemstones',
  '/simulators/roulette',
  '/simulators/roulette/cash',
  '/simulators/roulette/lucky',
  '/simulators/roulette/madness',
  '/simulators/stats',
  '/tier-list',
  '/top-evo',
  '/top-mutants',
];

const EVAL_FN = () => {
  const CYRILLIC = /[а-яА-ЯёЁ]/;
  const results = { textLeaks: [], attrLeaks: [] };

  function selectorFor(el) {
    if (!el) return '(root)';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return `${el.tagName?.toLowerCase() || '?'}${id}${cls}`;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (text && CYRILLIC.test(text)) {
      results.textLeaks.push({ text: text.slice(0, 120), selector: selectorFor(node.parentElement) });
    }
  }

  const ATTRS = ['title', 'alt', 'aria-label', 'placeholder'];
  document.querySelectorAll('*').forEach((el) => {
    for (const attr of ATTRS) {
      const val = el.getAttribute(attr);
      if (val && CYRILLIC.test(val)) {
        results.attrLeaks.push({ attr, value: val.slice(0, 120), selector: selectorFor(el) });
      }
    }
  });

  return results;
};

function dedupe(arr, keyFn) {
  const seen = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return [...seen.entries()].map(([k, count]) => ({ key: k, count }));
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: true,
  });
  const page = await browser.newPage();
  page.on('console', () => {}); // suppress
  page.setDefaultTimeout(15000);

  const report = [];

  for (const locale of LOCALES) {
    for (const p of PATHS) {
      const url = `${BASE}/${locale}${p === '/' ? '' : p}`;
      let data;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        data = await page.evaluate(EVAL_FN);
      } catch (e) {
        report.push({ locale, path: p, error: String(e).slice(0, 200) });
        continue;
      }
      const textDeduped = dedupe(data.textLeaks, (x) => x.text);
      const attrDeduped = dedupe(data.attrLeaks, (x) => `${x.attr}=${x.value}`);
      if (textDeduped.length || attrDeduped.length) {
        report.push({
          locale,
          path: p,
          textLeaks: textDeduped,
          attrLeaks: attrDeduped,
          textSamples: data.textLeaks.slice(0, 5),
          attrSamples: data.attrLeaks.slice(0, 5),
        });
      } else {
        report.push({ locale, path: p, clean: true });
      }
      process.stdout.write('.');
    }
  }

  await browser.close();
  console.log('\ndone');
  fs.writeFileSync(
    new URL('./i18n-sweep-report.json', import.meta.url),
    JSON.stringify(report, null, 2),
  );

  const dirty = report.filter((r) => !r.clean && !r.error);
  const errored = report.filter((r) => r.error);
  console.log(`\nTotal: ${report.length}, clean: ${report.length - dirty.length - errored.length}, dirty: ${dirty.length}, errors: ${errored.length}`);
  for (const d of dirty) {
    console.log(`\n=== ${d.locale} ${d.path} ===`);
    console.log('text leaks:', d.textLeaks.map((x) => `${x.key} (x${x.count})`).join(' | '));
    console.log('attr leaks:', d.attrLeaks.map((x) => `${x.key} (x${x.count})`).join(' | '));
  }
  if (errored.length) {
    console.log('\n=== ERRORS ===');
    for (const e of errored) console.log(`${e.locale} ${e.path}: ${e.error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
