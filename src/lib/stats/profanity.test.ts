import { describe, it, expect } from 'vitest'
import mutantsRaw from '@/data/mutants/mutants.json'
import skinsRaw from '@/data/mutants/skins.json'
import aliasesRaw from '@/data/mutants/nickname-aliases.json'
import skinAliasesRaw from '@/data/mutants/skin-aliases.json'
import skinsRu from '@/data/mutants/skins-ru-curated.json'
import namesRu from '@/data/mutant_names.json'
import names_en from '@/data/mutants/names.en.json'
import names_de from '@/data/mutants/names.de.json'
import names_es from '@/data/mutants/names.es.json'
import names_fr from '@/data/mutants/names.fr.json'
import names_it from '@/data/mutants/names.it.json'
import names_nl from '@/data/mutants/names.nl.json'
import names_pt from '@/data/mutants/names.pt.json'
import names_tr from '@/data/mutants/names.tr.json'
import { containsProfanity } from './profanity'

describe('containsProfanity: ловит мат', () => {
  const bad = [
    'хуй',
    'Ах ты хуесос',
    '.гвенн 30 нахуй',
    'пиздец какой-то',
    'ПИЗДЕЦ',
    'блядь',
    'бля, опять',
    'блять',
    'бляяять',
    'ебать',
    'ебаный рот',
    'заебал',
    'выебу',
    'уебок',
    'съебаться',
    'долбоёб',
    'долбаеб',
    'сука',
    'сучка',
    'мудак',
    'пидор',
    'ублюдок',
    'залупа',
    'гандон',
    'говно',
    'жопа',
    'ты охуел',
    'хуууй',
    'бл*дь',
    'х у й',
    'п.и.з.д.е.ц',
    'xуй',
    'пиздeц',
    'fuck',
    'what the fuck',
    'shit',
  ]
  for (const t of bad) {
    it(`"${t}"`, () => expect(containsProfanity(t)).toBe(true))
  }
})

describe('containsProfanity: не трогает обычный текст', () => {
  const good = [
    '',
    '.гвенн 30',
    '.даймонд 3 звезды 50 уровень',
    'тебя', // "ебя" внутри
    'себя',
    'ребята',
    'требует',
    'употребляет',
    'хлеб',
    'небо',
    'учеба',
    'лебедь',
    'стебель',
    'гребень',
    'жребий',
    'страхуй',
    'застрахуешь',
    'рубля',
    'корабля',
    'сукно',
    'оскорблять',
    'блеять',
    'бледный',
    'блестящий',
    'Херсон',
    'страна',
    'мудрость',
    'педиатр',
    'худой',
    'хутор',
    'духи',
    'застрахуйте',
    'мухи',
    'shitake',
    'class',
    'Gwenn',
  ]
  for (const t of good) {
    it(`"${t}"`, () => expect(containsProfanity(t)).toBe(false))
  }
})

// Любое имя, которое бот может распознать, не должно быть принято за мат: иначе
// карточка этого мутанта/скина молча перестанет выдаваться.
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

describe('containsProfanity: имена мутантов и скинов', () => {
  const sources: Record<string, unknown> = {
    mutants: mutantsRaw,
    skins: skinsRaw,
    nicknameAliases: aliasesRaw,
    skinAliases: skinAliasesRaw,
    skinsRu,
    namesRu,
    names_en,
    names_de,
    names_es,
    names_fr,
    names_it,
    names_nl,
    names_pt,
    names_tr,
  }
  for (const [label, data] of Object.entries(sources)) {
    it(label, () => {
      const hits = strings(data)
        // только короткие строки (имена, прозвища), без описаний и ссылок
        .filter((s) => s.length <= 60 && !/^https?:|^\//.test(s))
        .filter((s) => containsProfanity(s))
      expect([...new Set(hits)].slice(0, 20)).toEqual([])
    })
  }
})
