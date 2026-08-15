// Официальные переводы имён/лора/атак и мест получения мутантов на 8 языках
// (RU остаётся каноном в mutants.json/obtain.json, тут только сиблинг-словари).
// Генерируются scripts/sync-mutant-names.ts / sync-obtain-names.ts, 556/556
// покрытие имён. Общий модуль вместо повтора 16 импортов в каждой странице -
// впервые собран в MutantsPage.astro (i18n-пилот, Батч 11), затем скопирован
// в TierListPage.astro; вынесен сюда при ретрофите bingo/boxes/top-mutants/
// rebalance/top-evo, чтобы не плодить копию в шестой раз.
import namesEn from '@/data/mutants/names.en.json';
import namesEs from '@/data/mutants/names.es.json';
import namesFr from '@/data/mutants/names.fr.json';
import namesDe from '@/data/mutants/names.de.json';
import namesPt from '@/data/mutants/names.pt.json';
import namesIt from '@/data/mutants/names.it.json';
import namesTr from '@/data/mutants/names.tr.json';
import namesNl from '@/data/mutants/names.nl.json';
import obtainEn from '@/data/mutants/obtain-names.en.json';
import obtainEs from '@/data/mutants/obtain-names.es.json';
import obtainFr from '@/data/mutants/obtain-names.fr.json';
import obtainDe from '@/data/mutants/obtain-names.de.json';
import obtainPt from '@/data/mutants/obtain-names.pt.json';
import obtainIt from '@/data/mutants/obtain-names.it.json';
import obtainTr from '@/data/mutants/obtain-names.tr.json';
import obtainNl from '@/data/mutants/obtain-names.nl.json';
import type { Locale } from './i18n-locales';

export interface MutantNameEntry {
  name: string;
  lore: string;
  atk1Name: string;
  atk2Name: string;
}

const NAMES_BY_LOCALE: Partial<Record<Locale, Record<string, MutantNameEntry>>> = {
  en: namesEn, es: namesEs, fr: namesFr,
  de: namesDe, pt: namesPt, it: namesIt, tr: namesTr, nl: namesNl,
};

const OBTAIN_NAMES_BY_LOCALE: Partial<Record<Locale, Record<string, string>>> = {
  en: obtainEn, es: obtainEs, fr: obtainFr,
  de: obtainDe, pt: obtainPt, it: obtainIt, tr: obtainTr, nl: obtainNl,
};

// Фолбэк target->en (см. FALLBACK_LOCALE в src/lib/i18n.ts) - на случай
// точечных пропусков. RU не участвует в лукапе вообще - m.name/obtain-текст
// уже RU-канон в исходных данных.
export function getLocalizedMutantNames(locale: Locale): {
  names: Record<string, MutantNameEntry>;
  obtainNames: Record<string, string>;
} {
  if (locale === 'ru') return { names: {}, obtainNames: {} };
  return {
    names: { ...NAMES_BY_LOCALE.en, ...NAMES_BY_LOCALE[locale] },
    obtainNames: { ...OBTAIN_NAMES_BY_LOCALE.en, ...OBTAIN_NAMES_BY_LOCALE[locale] },
  };
}
