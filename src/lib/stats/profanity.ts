// Фильтр мата для стат-бота: сообщение с ругательством бот молча игнорирует
// (без ответа, без записи текста в логи). Чистая функция, без сети.
//
// Подход: текст режется на слова, каждое слово нормализуется (регистр, ё, латинские
// двойники кириллицы, растянутые буквы) и проверяется по корням. Корни с коротким
// "еб" привязаны к началу слова (с допустимыми приставками), иначе ловились бы
// "тебя", "себя", "требует", "хлеб", "небо". Правила проверены на именах всех
// мутантов и скинов (profanity.test.ts): ложных срабатываний там нет.

// Латиница, похожая на кириллицу: "xуй", "пиздeц", "бляdь". Применяется только к
// словам, где уже есть кириллица, чтобы не ломать английские слова.
const LOOKALIKE: Record<string, string> = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
}

const PREFIX = '(?:на|за|вы|до|по|от|об|объ|про|под|раз|рас|съ|сь|у|при|пере|недо|ни|не|въ|из|ис)?'
// "хуй" с приставками ("нахуй", "охуеть", "дохуя"), но не внутри слова: "страхуй"
const HU_PREFIX = '(?:(?:на|за|вы|до|по|от|об|про|под|раз|рас|съ|сь|у|при|пере|ни|не|из|ис|о|с|а)){0,2}'

// Корни без привязки к началу слова: достаточно длинные и однозначные.
const ANYWHERE = [
  'пизд',
  'пезд',
  'залуп',
  'ублюд',
  'выблюд',
  'выблядк',
  'гандон',
  'гондон',
  'мудозвон',
  'долбо?а?еб',
  'говн',
  'дерьм',
  'шлюх',
  'шалав',
]

// Корни от начала слова (с приставкой): короткие, где без привязки будут ложные.
const ANCHORED = [
  `${HU_PREFIX}ху[йеяию]`,
  `${PREFIX}ебу(?:$|т|сь|ся)`,
  `${PREFIX}еб(?:ат|ал|ан|ну|ис|ло|ла|ли|ун|уч|ет|ыр|нут|аш|ак|ок|ищ)`,
  `${PREFIX}ебл[аоуы]н`,
  'бля[дт]',
  'бля$',
  'сука$',
  'суки$',
  'суку$',
  'суке$',
  'сукой$',
  'сукин',
  'сучк[аеиу]',
  'сучар',
  'муд[аи]к',
  'мудил',
  'мудач',
  'пид[оа]р',
  'пидр',
  'педик',
  'мраз[ьи]$',
  'мразот',
  'мразин',
  'падл[аыу]$',
  'жоп[аеуыо]',
  '(?:на|по|ни)?хер$',
  'херн[яюеи]',
  `${PREFIX}ср[аеи]ть`,
  'сран[ыо]',
]

// Английские: только целые слова.
const ENGLISH = ['fuck', 'fucking', 'fucker', 'fuckin', 'motherfucker', 'shit', 'bitch', 'asshole', 'cunt']

const ROOT_RE = new RegExp(
  `(?:${ANYWHERE.join('|')})|^(?:${ANCHORED.join('|')})`,
  'u',
)
const ENGLISH_SET = new Set(ENGLISH)

const VOWELS_FOR_MASK = ['и', 'е', 'у', 'а', 'о', 'я', 'ю', 'ы']

function normalizeWord(raw: string): string {
  let w = raw.toLowerCase().replace(/ё/g, 'е')
  if (/\p{Script=Cyrillic}/u.test(w) && /\p{Script=Latin}/u.test(w)) {
    w = Array.from(w, (ch) => LOOKALIKE[ch] ?? ch).join('')
  }
  // "хуууй", "бляяять" -> "хуй", "блять"
  return w.replace(/(\p{L})\1+/gu, '$1')
}

// "бл*дь": звёздочка прячет одну букву, пробуем подставить гласные.
function maskVariants(word: string): string[] {
  const stars = word.split('*').length - 1
  if (stars === 0) return [word]
  if (stars > 2 || word.length < 3 || word.length > 14) return []
  let out = [word]
  for (let i = 0; i < stars; i++) {
    out = out.flatMap((v) => VOWELS_FOR_MASK.map((c) => v.replace('*', c)))
  }
  return out
}

function splitWords(text: string): string[] {
  const words = text.split(/[^\p{L}*]+/u).filter(Boolean)
  // "х у й", "п.и.з.д.е.ц": подряд идущие одиночные буквы склеиваем в одно слово
  const out: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length >= 3) out.push(run.join(''))
    else out.push(...run)
    run = []
  }
  for (const w of words) {
    if (Array.from(w).length === 1 && w !== '*') run.push(w)
    else {
      flush()
      out.push(w)
    }
  }
  flush()
  return out
}

export function containsProfanity(text: string): boolean {
  if (!text) return false
  for (const raw of splitWords(text)) {
    for (const variant of maskVariants(raw)) {
      const w = normalizeWord(variant)
      if (ENGLISH_SET.has(w) || ROOT_RE.test(w)) return true
    }
  }
  return false
}
