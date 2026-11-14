// Названия генов из локализации игры (ключи Gene_A..Gene_F в localisation_{lang}.txt,
// проверено 2026-11-14), приведены к виду "Мифик" вместо "МИФИК".
import type { Locale } from './i18n-locales'

export type GeneLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export const GENE_NAMES: Record<Locale, Record<GeneLetter, string>> = {
  ru: { A: 'Киборг', B: 'Нежить', C: 'Рубака', D: 'Зооморф', E: 'Галактик', F: 'Мифик' },
  en: { A: 'Cyber', B: 'Necro', C: 'Saber', D: 'Zoomorph', E: 'Galactic', F: 'Mythic' },
  es: { A: 'Ciber', B: 'Necro', C: 'Sable', D: 'Zoomorfo', E: 'Galáctico', F: 'Mítico' },
  fr: { A: 'Cyber', B: 'Nécro', C: 'Sabre', D: 'Zoomorphe', E: 'Galactique', F: 'Mythique' },
  de: { A: 'Cyber', B: 'Zombie', C: 'Säbelrassler', D: 'Zoomorph', E: 'Galactic', F: 'Mythic' },
  pt: { A: 'Ciber', B: 'Necro', C: 'Sabre', D: 'Zoomorfo', E: 'Galáctico', F: 'Mítico' },
  it: { A: 'Cyber', B: 'Necro', C: 'Sciabola', D: 'Zoomorfo', E: 'Galattico', F: 'Mitico' },
  tr: { A: 'Siber', B: 'Nekro', C: 'Süvari', D: 'Hayvansı', E: 'Galaktik', F: 'Mitik' },
  nl: { A: 'Cyber', B: 'Necro', C: 'Sabel', D: 'Zoömorf', E: 'Galactisch', F: 'Mythisch' },
}
