import type { APIRoute } from 'astro'

const VALID_TIERS = ['1', '1+', '1-', '2', '2+', '2-', '3', '3+', '3-', '4', 'un-tired']

// В группе (несколько людей, файлы шлют не только для тиров) нужен явный
// триггер в подписи/тексте сообщения, иначе любой присланный файл будет
// пытаться распарситься как тиры.
const TIER_TRIGGER = '.тир'

// Кнопки статуса/синка/напоминалки: раньше были inline-кнопками, которые
// появлялись только под ответом на /start - нужно было каждый раз печатать
// команду, чтобы их снова увидеть. Reply-keyboard же остаётся приколотой в
// интерфейсе Telegram (над полем ввода) постоянно, после первой отправки -
// не команда, а обычная часть интерфейса чата.
const STATUS_LABEL = '📊 Статус сайта'
const LASTSYNC_LABEL = '🔄 Последний синк'
const PAYMENTS_LABEL = '💳 Напоминалка'
const YANDEX_BALANCE_LABEL = '💰 Баланс Яндекс'
const FORMATS_LABEL = '📐 Форматы'
const REPLY_KEYBOARD = {
  keyboard: [
    [{ text: STATUS_LABEL }, { text: LASTSYNC_LABEL }],
    [{ text: PAYMENTS_LABEL }, { text: YANDEX_BALANCE_LABEL }],
    [{ text: FORMATS_LABEL }],
  ],
  resize_keyboard: true,
  is_persistent: true,
}

// Шпаргалка по форматам ".сфера"/".анонс"/".тир" — держать текст в одном
// месте с их реальными парсерами (ниже и в tier-parser.js), чтобы кнопка не
// разъехалась с тем, что боту в действительности скормить можно.
function getFormatsMessage(): string {
  return [
    '📐 *Форматы команд*',
    '',
    '🔮 *Сфера* — имя (кавычки не обязательны) и 1–3 строки рядов, сферы разделены `;` или `,`:',
    '```',
    '.сфера Мистер Икс',
    'атака ; усиление ; особый скорость',
    'здоровье ; усиление',
    'усиление ; усиление ; особый скорость',
    '```',
    'Можно и .txt-файлом (с `.сфера` в подписи) — несколько блоков подряд, каждый разделён строкой из одного `_`.',
    '',
    '📢 *Анонс* — Reply на пост, пересланный из канала, текстом `.анонс` (что допишешь после — уйдёт подводкой перед постом):',
    '```',
    '.анонс',
    '```',
    '',
    '🏷️ *Локализация* — ответ на алерт про новый реактор/рейд/лесенку без офиц. RU-имени:',
    '```',
    '.локал reactor:gemstones "Самоцветы"',
    '.локал dungeon:hexcity_2 "Hex City: Часть 2"',
    '```',
    '',
    '🏆 *Тир* — .txt-файл, в подписи к файлу обязательно `.тир`; строки внутри файла — любой из форматов:',
    '```',
    'Азимов (2+)',
    'Робот,2-',
    'Голиаф:3',
    '```',
    '_Валидные тиры: 1, 1+, 1-, 2, 2+, 2-, 3, 3+, 3-, 4, un-tired_',
  ].join('\n')
}

const YANDEX_BILLING_ACCOUNT_ID = 'dn28giqm4gc781aj82ca'

// Живой баланс биллинг-аккаунта Yandex Cloud - тот же JWT-flow, что и в
// payments-reminder.yml (там для крона, здесь - для кнопки по требованию).
// Публичный billing API не отдаёт "потрачено в этом цикле", только текущий
// баланс счёта - см. комментарий в payments-reminder.yml.
async function getYandexBalance(saKeyJson: string): Promise<string> {
  const key = JSON.parse(saKeyJson) as {
    id: string
    service_account_id: string
    private_key: string
  }
  const b64url = (buf: Buffer) =>
    buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'PS256', typ: 'JWT', kid: key.id }
  const payload = {
    iss: key.service_account_id,
    aud: 'https://iam.api.cloud.yandex.net/iam/v1/tokens',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`
  const crypto = await import('node:crypto')
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), {
    key: key.private_key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  })
  const jwt = `${unsigned}.${b64url(signature)}`

  const tokenRes = await fetch('https://iam.api.cloud.yandex.net/iam/v1/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jwt }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.iamToken) throw new Error('no iamToken in IAM response')

  const acctRes = await fetch(
    `https://billing.api.cloud.yandex.net/billing/v1/billingAccounts/${YANDEX_BILLING_ACCOUNT_ID}`,
    { headers: { Authorization: `Bearer ${tokenData.iamToken}` } },
  )
  const acct = await acctRes.json()
  const balance = Number(acct.balance).toFixed(2)
  return `💰 Баланс Yandex Cloud: ${balance} ${acct.currency}`
}

// Команда пометки оплаты: ".оплатил <id>" — переводит nextDue на следующий
// цикл (месяц/год) и коммитит payments.json, чтобы напоминание не срабатывало
// вечно на уже оплаченную дату.
const PAID_TRIGGER = '.оплатил'

interface PaymentService {
  id: string
  name: string
  amount: number | null
  currency: string
  period: 'monthly' | 'yearly'
  nextDue: string
}
interface PaymentsData {
  reminderThresholdDays: number
  services: PaymentService[]
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr)
  due.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

// Продвигает дату на один цикл вперёд (месяц/год), сохраняя число месяца -
// в отличие от "+30 дней", не уезжает от исходного дня (20-е) со временем.
function advanceOneCycle(dateStr: string, period: PaymentService['period']): string {
  const d = new Date(dateStr)
  const day = d.getDate()
  if (period === 'yearly') {
    d.setFullYear(d.getFullYear() + 1)
  } else {
    // setMonth() переполняется в следующий месяц для 29-31 числа, если в
    // целевом месяце столько дней нет (31 янв -> 3 марта вместо 28 фев) -
    // ставим 1-е число перед сдвигом, потом клэмпим обратно на последний
    // день месяца, если исходное число больше, чем дней в целевом месяце.
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, daysInTargetMonth))
  }
  return d.toISOString().slice(0, 10)
}

function advanceUntilFuture(dateStr: string, period: PaymentService['period']): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = dateStr
  while (new Date(next).getTime() <= today.getTime()) {
    next = advanceOneCycle(next, period)
  }
  return next
}

function formatPaymentsList(data: PaymentsData): string {
  if (data.services.length === 0) return '📋 Список платежей пуст.'
  const lines = data.services.map((s) => {
    const d = daysUntil(s.nextDue)
    const icon = d < 0 ? '🔴' : d <= data.reminderThresholdDays ? '🟡' : '🟢'
    const when =
      d < 0 ? `просрочено на ${Math.abs(d)} дн.` : d === 0 ? 'сегодня!' : `через ${d} дн.`
    const sum = s.amount == null ? '— сумма плавает, см. биллинг' : `— ${s.amount} ${s.currency}`
    return `${icon}  *${s.name}*\n     ${sum}\n     📅 ${s.nextDue} · ${when}`
  })
  return `📋 *Ближайшие платежи*\n\n${lines.join('\n\n')}`
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  replyMarkup?: unknown,
  parseMode?: 'Markdown',
) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    })
  } catch {
    // Ответ в чат — best effort, не роняем обработку
  }
}

async function checkSiteHealth(): Promise<string> {
  try {
    const res = await fetch('https://archivist-library.com', {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      return `🔴 HTTP ${res.status} вместо 200`
    }
    const body = await res.text()
    if (!body.includes('Archivist-Library')) {
      return '🔴 Код 200, но ожидаемый контент не найден (битая страница)'
    }
    return '✅ Сайт отвечает нормально (200 OK)'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `🔴 Не удалось достучаться: ${message}`
  }
}

async function getLastSyncInfo(githubToken: string, owner: string, repo: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/sync-cron.yml/runs?per_page=1`,
      { headers: { Authorization: `Bearer ${githubToken}` } },
    )
    if (!res.ok) {
      return `🔴 Не удалось получить данные (GitHub API: ${res.status})`
    }
    const data = await res.json()
    const run = data.workflow_runs?.[0]
    if (!run) {
      return 'ℹ️ Прогонов sync-cron ещё не было'
    }
    const statusIcon =
      run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '🔴' : '⏳'
    const when = new Date(run.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
    return `${statusIcon} Последний прогон: ${when} МСК — ${run.conclusion ?? run.status}\n${run.html_url}`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `🔴 Ошибка запроса к GitHub: ${message}`
  }
}

const PAYMENTS_PATH = 'src/data/payments.json'

// GitHub Contents API возвращает content пустым для больших файлов - тот же
// download_url-фолбэк, что и для mutants.json в обработчике тиров ниже.
async function fetchGithubJsonFile(
  githubToken: string,
  owner: string,
  repo: string,
  path: string,
): Promise<{ json: unknown; sha: string } | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${githubToken}` },
  })
  if (!res.ok) return null
  const data = await res.json()
  let text: string
  if (data.content && data.content.length > 0) {
    text = Buffer.from(data.content, 'base64').toString('utf-8')
  } else if (data.download_url) {
    const downloadRes = await fetch(data.download_url)
    if (!downloadRes.ok) return null
    text = await downloadRes.text()
  } else {
    return null
  }
  return { json: JSON.parse(text), sha: data.sha }
}

async function putGithubJsonFile(
  githubToken: string,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  json: unknown,
  message: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const content = Buffer.from(JSON.stringify(json, null, 2) + '\n', 'utf-8').toString('base64')
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, sha, branch: 'main' }),
  })
  return res.ok ? { ok: true } : { ok: false, status: res.status }
}

// Универсальный read-modify-write под GitHub Contents API с retry-on-409.
// 409 = "sha уже не соответствует HEAD" (кто-то запушил параллельно - в нашем
// случае обычно finish-pending.yml или announcements-hourly.yml коммитит поверх
// resolved-names-cache.json/orbing.json/announcements.json). Правильный ответ -
// перечитать актуальный файл, ПРИМЕНИТЬ мутатор ещё раз к свежему JSON, PUT
// повторно. Просто повторить PUT с тем же sha бесполезно - он всё ещё старый.
//
// Мутатор ДОЛЖЕН быть идемпотентен относительно повтора (данные внутри могут
// быть уже почти те же, что после первой попытки) - в наших вызывающих это
// либо `obj[key] = value` (тривиально идемпотентно), либо `list.push({new})`.
// Push НЕ идемпотентен, поэтому мутатор для .анонс получает свежий list и
// делает push поверх - дубликата не будет, т.к. между попытками мутатор не
// хранит промежуточный state.
async function mutateGithubJsonFile<T>(
  githubToken: string,
  owner: string,
  repo: string,
  path: string,
  mutator: (current: T) => T | Promise<T>,
  message: string,
  maxAttempts = 4,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const file = await fetchGithubJsonFile(githubToken, owner, repo, path)
    if (!file) return { ok: false, reason: `не удалось загрузить ${path}` }
    const nextJson = await mutator(file.json as T)
    const result = await putGithubJsonFile(
      githubToken,
      owner,
      repo,
      path,
      file.sha,
      nextJson,
      message,
    )
    if (result.ok) return { ok: true }
    if (result.status !== 409) {
      return { ok: false, reason: `PUT ${path} вернул ${result.status}` }
    }
    // 409: sha устарел. Экспоненциальный джиттер, чтобы два параллельных
    // клиента не попали в один и тот же слот на повторе.
    const delayMs = 200 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250)
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return {
    ok: false,
    reason: `PUT ${path}: не удалось после ${maxAttempts} попыток (гонка на main)`,
  }
}

async function getPaymentsMessage(
  githubToken: string,
  owner: string,
  repo: string,
): Promise<string> {
  const file = await fetchGithubJsonFile(githubToken, owner, repo, PAYMENTS_PATH)
  if (!file) return '🔴 Не удалось загрузить список платежей'
  return formatPaymentsList(file.json as PaymentsData)
}

// ".оплатил <id>" - сдвигает nextDue на periodDays вперёд и коммитит,
// чтобы напоминание не срабатывало вечно на уже оплаченную дату.
async function markPaymentPaid(
  githubToken: string,
  owner: string,
  repo: string,
  serviceId: string,
): Promise<string> {
  // Мутатор нужен, чтобы прочитать service.name для commit-message ДО вызова
  // mutate - через IIFE-подгляд файла отдельным первым fetch (легковесно, у
  // нас всё равно один retry цикл сверху). Альтернативно можно было бы делать
  // mutate + сохранять name в замыкание, но так проще для читателя.
  const preview = await fetchGithubJsonFile(githubToken, owner, repo, PAYMENTS_PATH)
  if (!preview) return '🔴 Не удалось загрузить список платежей'
  const previewService = (preview.json as PaymentsData).services.find((s) => s.id === serviceId)
  if (!previewService) {
    const ids = (preview.json as PaymentsData).services.map((s) => s.id).join(', ')
    return `🔴 Не найден сервис "${serviceId}". Доступные id: ${ids}`
  }

  let nextDue = ''
  const result = await mutateGithubJsonFile<PaymentsData>(
    githubToken,
    owner,
    repo,
    PAYMENTS_PATH,
    (data) => {
      const service = data.services.find((s) => s.id === serviceId)
      if (!service) return data // между preview и retry сервис пропал - маловероятно
      service.nextDue = advanceUntilFuture(service.nextDue, service.period)
      nextDue = service.nextDue
      return data
    },
    `Payments: отметить "${previewService.name}" оплаченным`,
  )
  if (!result.ok) return `🔴 Не удалось сохранить изменения (${result.reason})`
  return `✅ ${previewService.name}: следующий платёж — ${nextDue}`
}

// ".анонс" - публикация анонса на /announcements. У Bot API нет способа
// получить пост по ссылке, а форвард в Telegram нельзя дополнить своей
// подписью (для текстовых постов) - зато РЕПЛАЙ на сообщение всегда несёт
// полный reply_to_message с оригинальным текстом/фото. Поэтому рабочий поток:
// 1) переслать пост из канала в чат с ботом, 2) ОТВЕТИТЬ (Reply) на него
// текстом ".анонс" (можно дописать свой текст после - он добавится как
// подводка перед оригинальным текстом поста).
const ANNOUNCE_TRIGGER = '.анонс'
const ANNOUNCEMENTS_PATH = 'src/data/announcements.json'

interface Announcement {
  id: string
  date: string
  text: string
  imagePath: string | null
}

async function uploadAnnouncementImage(
  botToken: string,
  githubToken: string,
  owner: string,
  repo: string,
  fileId: string,
  id: string,
): Promise<string | null> {
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
  const fileInfo = await fileRes.json()
  if (!fileInfo.ok) return null

  const filePath: string = fileInfo.result.file_path
  const ext = filePath.split('.').pop() || 'jpg'
  const imgRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
  if (!imgRes.ok) return null
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer())
  const repoPath = `public/announcements/${id}.${ext}`

  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Announcements: картинка для анонса ${id}`,
      content: imgBuffer.toString('base64'),
      branch: 'main',
    }),
  })
  if (!putRes.ok) return null
  return `/announcements/${id}.${ext}`
}

// ".сфера "Имя"" + 3 строки рядов - ручное добавление сферовки мутанта
// (в игре сферы выставляются вручную, автопарса из XML нет). Формат:
//   .сфера "Мистер Икс"
//   атака ; усиление ; спец скорость
//   здоровье ; усиление
//   усиление ; усиление ; спец скорость
// Уровень сферы НЕ указывается - у всех базовых сфер фиксированный
// уровень 5, у особых - 3 (реальный уровень определяет владелец мутанта
// в игре руками, бот его не знает и не спрашивает). Количество сфер в
// ряду не фиксировано - модалка (MutantModal.svelte) рендерит {#each row}
// произвольной длины. Рядов может быть от 1 до 3 (не у всех мутантов
// заполнены все 3 в игре). Разделитель сфер в ряду - ";" или ",". Имя
// мутанта можно писать в кавычках или без них.
const ORBING_TRIGGER = '.сфера'
const ORBING_PATH = 'src/data/mutants/orbing.json'

const ORB_BASIC_LEVEL = 5
const ORB_SPECIAL_LEVEL = 3

// "контратака"/"отражение" - два разных русских названия одной и той же
// сферы (retaliate) в разных источниках; проверяется ДО "атак", иначе
// подстрока "атака" внутри "контратака" даст ложное срабатывание.
const ORB_WORD_MAP: Array<[RegExp, string]> = [
  [/вытягивани|реген|отхил/, 'regenerate'],
  [/контратак|отражени|отраж/, 'retaliate'],
  [/критическ/, 'critical'],
  [/^хп$|здоровь/, 'life'],
  [/усилени|усил/, 'strengthen'],
  [/щит/, 'shield'],
  [/ранени|рана/, 'slash'],
  [/проклят|пониж/, 'weaken'],
  [/опыт/, 'xp'],
  [/скорост/, 'speed'],
  [/атак|атк/, 'attack'],
]

interface ParsedOrbCell {
  special: boolean
  slug: string
}

function parseOrbCell(raw: string): ParsedOrbCell | { error: string } {
  // Число уровня больше не нужно, но если кто-то по привычке допишет "_5" -
  // просто игнорируем, а не считаем ошибкой формата.
  let cell = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]*\d+\s*$/, '')
    .trim()

  let special = false
  // "особый"/"особая"/"особое" и т.п. - без обязательного слова "сфера" после
  // (реальные сообщения из бота приходят как "особый усил", а не "особая сфера усил").
  const specialPrefixes = [/^особ\S*\s*(сфер[аы]\s*)?/, /^спец\.?\s*(сфер[аы]\s*)?/]
  for (const prefix of specialPrefixes) {
    if (prefix.test(cell)) {
      special = true
      cell = cell.replace(prefix, '').trim()
      break
    }
  }

  let slug: string | null = null
  for (const [re, s] of ORB_WORD_MAP) {
    if (re.test(cell)) {
      slug = s
      break
    }
  }
  if (!slug) return { error: `не распознал тип сферы в "${raw.trim()}"` }
  if (slug === 'speed') special = true // спец-only тип, приставка не обязательна

  return { special, slug }
}

function orbCellToFilename(cell: ParsedOrbCell): string {
  const lvl = String(cell.special ? ORB_SPECIAL_LEVEL : ORB_BASIC_LEVEL).padStart(2, '0')
  if (cell.special) {
    const base = cell.slug === 'speed' ? 'speed' : `add${cell.slug}`
    return `special/orb_special_${base}_${lvl}.webp`
  }
  return `basic/orb_basic_${cell.slug}_${lvl}.webp`
}

type OrbCellValue = string | [string, string]

function isOrbError(x: unknown): x is { error: string } {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && 'error' in x
}

// "усил/пониж" - ОДНА физическая сфера с двумя эффектами (в игре бывают
// такие гибриды). Порядок половинок сохраняется как записано - модалка
// рисует первую половинку слева/сверху, вторую справа/снизу.
function parseCombinedOrCell(cell: string): OrbCellValue | { error: string } {
  if (!cell.includes('/')) {
    const parsed = parseOrbCell(cell)
    if (isOrbError(parsed)) return parsed
    return orbCellToFilename(parsed)
  }
  const parts = cell.split('/').map((p) => p.trim())
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { error: `неверный формат совмещённой сферы "${cell}"` }
  }
  const [aRaw, bRaw] = parts
  const parsedA = parseOrbCell(aRaw)
  if (isOrbError(parsedA)) return parsedA
  const parsedB = parseOrbCell(bRaw)
  if (isOrbError(parsedB)) return parsedB
  return [orbCellToFilename(parsedA), orbCellToFilename(parsedB)]
}

function parseOrbingRows(messageText: string): OrbCellValue[][] | { error: string } {
  const lines = messageText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const rowLines = lines.slice(1)
  if (rowLines.length < 1 || rowLines.length > 3) {
    return {
      error: `нужно от 1 до 3 строк с рядами сфер (после строки с именем), получено: ${rowLines.length}`,
    }
  }
  const rows: OrbCellValue[][] = []
  for (let i = 0; i < rowLines.length; i++) {
    const cells = rowLines[i]
      .split(/[;,]/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
    if (cells.length === 0) {
      return { error: `ряд ${i + 1}: нужна хотя бы одна сфера` }
    }
    const row: OrbCellValue[] = []
    for (const cell of cells) {
      const parsed = parseCombinedOrCell(cell)
      if (isOrbError(parsed)) return { error: `ряд ${i + 1}: ${parsed.error}` }
      row.push(parsed)
    }
    rows.push(row)
  }
  return rows
}

// Разбирает один блок ".сфера Имя" + ряды (текст сообщения ИЛИ один блок
// внутри файла с несколькими сферовками). Общая логика для обоих источников.
function parseOrbingBlock(
  blockText: string,
): { nameRaw: string; rows: OrbCellValue[][] } | { error: string } {
  const firstLine = blockText.split('\n')[0] ?? ''
  const quotedMatch = firstLine.match(/"([^"]+)"/)
  const nameRaw = quotedMatch
    ? quotedMatch[1]
    : firstLine
        .slice(firstLine.toLowerCase().indexOf(ORBING_TRIGGER) + ORBING_TRIGGER.length)
        .trim()
  if (!nameRaw) return { error: 'не указано имя мутанта после .сфера' }

  const rows = parseOrbingRows(blockText)
  if ('error' in rows) return rows
  return { nameRaw, rows }
}

// Файл со сферовками - несколько блоков ".сфера Имя" + ряды, разделённых
// строкой, содержащей только "_". Каждый блок парсится и резолвится по
// имени так же, как одиночное сообщение; сохранение в orbing.json - ОДНОЙ
// пачкой (один fetch + один commit), а не по мутанту, чтобы не ловить
// конфликт sha при последовательных PUT.
async function processOrbingFile(
  githubToken: string,
  owner: string,
  repo: string,
  fileContent: string,
): Promise<string> {
  const blocks: string[][] = [[]]
  for (const line of fileContent.split(/\r?\n/)) {
    if (line.trim() === '_') {
      blocks.push([])
    } else {
      blocks[blocks.length - 1].push(line)
    }
  }
  const textBlocks = blocks.map((lines) => lines.join('\n').trim()).filter((b) => b.length > 0)

  if (textBlocks.length === 0) {
    return `🔴 в файле не найдено ни одного блока "${ORBING_TRIGGER}"`
  }

  const results: string[] = []
  const updates: Array<{ id: string; name: string; rows: OrbCellValue[][] }> = []

  for (const block of textBlocks) {
    const label = block.split('\n')[0]
    if (!block.toLowerCase().startsWith(ORBING_TRIGGER)) {
      results.push(`🔴 блок пропущен (нет "${ORBING_TRIGGER}" в начале): "${label}"`)
      continue
    }
    const parsed = parseOrbingBlock(block)
    if ('error' in parsed) {
      results.push(`🔴 ${label}: ${parsed.error}`)
      continue
    }
    const resolved = await resolveMutantIdByName(githubToken, owner, repo, parsed.nameRaw)
    if ('error' in resolved) {
      results.push(`🔴 ${parsed.nameRaw}: ${resolved.error}`)
      continue
    }
    updates.push({ id: resolved.id, name: resolved.name, rows: parsed.rows })
  }

  if (updates.length > 0) {
    const result = await mutateGithubJsonFile<Record<string, { rows: OrbCellValue[][] }>>(
      githubToken,
      owner,
      repo,
      ORBING_PATH,
      (orbingData) => {
        for (const u of updates) {
          orbingData[u.id] = { rows: u.rows }
        }
        return orbingData
      },
      `Orbing: обновить сферовку из файла (${updates.length})`,
    )
    results.push(
      result.ok
        ? `✅ обновлено (${updates.length}): ${updates.map((u) => `${u.name}`).join(', ')}`
        : `🔴 не удалось сохранить orbing.json (${result.reason})`,
    )
  }

  return results.join('\n')
}

// ".локал <key> \"Имя\"" - Фаза 2 авто-анонсов (реакторы/рейды/лесенки).
// Detect-скрипты (scripts/detect-new-reactors.ts, detect-new-dungeons.ts,
// запускаются из sync-cron.yml) находят новый объект в игровых данных,
// шлют алерт в этот чат с ключом вида "reactor:<id>"/"dungeon:<id>" и
// контекстом (что за объект, награды и т.п.) - в игре у таких объектов
// официального RU-имени нет (проверено на живых данных, см. память
// auto-announcements-architecture), так что имя придумывает человек.
//
// Сам вебхук НЕ качает арт и не пишет в gacha.json/raids.json - для этого
// нужны rclone/aws-креды, которых у serverless-функции быть не должно.
// Вебхук только сохраняет сырое имя в resolved-names-cache.json и дёргает
// GitHub Actions workflow_dispatch (finish-pending.yml) - тот уже в CI,
// с полным тулингом, докачивает арт/CDN/пишет данные/публикует анонс.
const LOCAL_NAME_TRIGGER = '.локал'
const RESOLVED_NAMES_PATH = 'scripts/resolved-names-cache.json'
const FINISH_PENDING_WORKFLOW = 'finish-pending.yml'

async function triggerWorkflow(
  githubToken: string,
  owner: string,
  repo: string,
  workflowFile: string,
): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    },
  )
  return res.status === 204
}

async function resolveMutantIdByName(
  githubToken: string,
  owner: string,
  repo: string,
  nameQuery: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const file = await fetchGithubJsonFile(githubToken, owner, repo, 'src/data/mutants/mutants.json')
  if (!file) return { error: 'не удалось загрузить mutants.json' }
  const list = file.json as Array<{ id: string; name: string }>
  const q = nameQuery.trim().toLowerCase()

  const exact = list.filter((m) => m.name.toLowerCase() === q)
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name }
  if (exact.length > 1) {
    return {
      error: `несколько мутантов с именем "${nameQuery}": ${exact.map((m) => m.id).join(', ')}`,
    }
  }

  const partial = list.filter((m) => m.name.toLowerCase().includes(q))
  if (partial.length === 1) return { id: partial[0].id, name: partial[0].name }
  if (partial.length > 1) {
    const preview = partial
      .slice(0, 10)
      .map((m) => `${m.name} (${m.id})`)
      .join(', ')
    return { error: `нашёл несколько похожих: ${preview}` }
  }
  return { error: `не нашёл мутанта "${nameQuery}"` }
}

export const POST: APIRoute = async ({ request }) => {
  const BOT_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN
  const GITHUB_TOKEN = import.meta.env.GITHUB_TOKEN
  const REPO_OWNER = import.meta.env.REPO_OWNER
  const REPO_NAME = import.meta.env.REPO_NAME
  const WEBHOOK_SECRET = import.meta.env.TELEGRAM_WEBHOOK_SECRET

  // Секрет обязателен: без него эндпоинт, умеющий коммитить в main, не работает.
  // Раньше отсутствие переменной молча ОТКЛЮЧАЛО проверку.
  if (!WEBHOOK_SECRET) {
    console.error('TELEGRAM_WEBHOOK_SECRET is not configured — webhook disabled')
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (secretToken !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Секрет выше подтверждает только что запрос реально от Telegram - он не
  // говорит, КТО написал. Бот сидит в групповом чате с несколькими людьми,
  // и без этой проверки любой в чате мог выполнить .тир/.анонс/.сфера/
  // /yandex//payments и т.п. (см. код-ревью 2026-08-11). Fail-closed по
  // тому же принципу, что и WEBHOOK_SECRET выше - если allowlist не
  // сконфигурирован, эндпоинт не работает, а не тихо пускает всех.
  const ALLOWED_USER_ID = import.meta.env.TELEGRAM_ALLOWED_USER_ID
  const ALLOWED_CHAT_ID = import.meta.env.TELEGRAM_ALLOWED_CHAT_ID
  if (!ALLOWED_USER_ID && !ALLOWED_CHAT_ID) {
    console.error(
      'TELEGRAM_ALLOWED_USER_ID/TELEGRAM_ALLOWED_CHAT_ID is not configured — webhook disabled',
    )
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let chatId: number | string | null = null

  try {
    const rawBody = await request.text()
    const body = JSON.parse(rawBody)

    chatId = body.message?.chat?.id ?? null
    const fromId = body.message?.from?.id ?? null
    const text: string = body.message?.text ?? ''

    const chatIdStr = chatId != null ? String(chatId) : null
    const fromIdStr = fromId != null ? String(fromId) : null
    const isAllowedSender =
      (fromIdStr != null && fromIdStr === ALLOWED_USER_ID) ||
      (chatIdStr != null && chatIdStr === ALLOWED_CHAT_ID)
    if (!isAllowedSender) {
      console.warn(`Webhook: неразрешённый отправитель chat=${chatIdStr} from=${fromIdStr}`)
      // 200, не 403 - подтверждаем получение Telegram'у (иначе будет ретраить),
      // но команду молча игнорируем.
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (chatId != null && BOT_TOKEN) {
      if (text === '/start' || text === '/menu') {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          'Готово — кнопки теперь всегда под полем ввода, команды печатать не нужно.',
          REPLY_KEYBOARD,
        )
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (text === '/status' || text === STATUS_LABEL) {
        const health = await checkSiteHealth()
        await sendTelegramMessage(BOT_TOKEN, chatId, `[Статус]\n${health}`)
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (text === '/lastsync' || text === LASTSYNC_LABEL) {
        if (GITHUB_TOKEN && REPO_OWNER && REPO_NAME) {
          const info = await getLastSyncInfo(GITHUB_TOKEN, REPO_OWNER, REPO_NAME)
          await sendTelegramMessage(BOT_TOKEN, chatId, `[Синк]\n${info}`)
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (text === '/payments' || text === PAYMENTS_LABEL) {
        if (GITHUB_TOKEN && REPO_OWNER && REPO_NAME) {
          const info = await getPaymentsMessage(GITHUB_TOKEN, REPO_OWNER, REPO_NAME)
          await sendTelegramMessage(BOT_TOKEN, chatId, info, undefined, 'Markdown')
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (text === '/formats' || text === FORMATS_LABEL) {
        await sendTelegramMessage(BOT_TOKEN, chatId, getFormatsMessage(), undefined, 'Markdown')
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (text === '/yandex' || text === YANDEX_BALANCE_LABEL) {
        const YC_SA_KEY_JSON = import.meta.env.YC_SA_KEY_JSON
        if (!YC_SA_KEY_JSON) {
          await sendTelegramMessage(
            BOT_TOKEN,
            chatId,
            '🔴 YC_SA_KEY_JSON не настроен в переменных окружения Vercel.',
          )
        } else {
          try {
            const info = await getYandexBalance(YC_SA_KEY_JSON)
            await sendTelegramMessage(BOT_TOKEN, chatId, info)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            await sendTelegramMessage(
              BOT_TOKEN,
              chatId,
              `🔴 Не удалось получить баланс: ${message}`,
            )
          }
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // ".оплатил <id>" - сдвинуть дату следующего платежа вперёд
      if (text.toLowerCase().startsWith(PAID_TRIGGER)) {
        const serviceId = text.slice(PAID_TRIGGER.length).trim()
        if (GITHUB_TOKEN && REPO_OWNER && REPO_NAME && serviceId) {
          const result = await markPaymentPaid(GITHUB_TOKEN, REPO_OWNER, REPO_NAME, serviceId)
          await sendTelegramMessage(BOT_TOKEN, chatId, `[Напоминалка]\n${result}`)
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // ".сфера \"Имя\"" + 3 строки рядов - см. комментарий у ORBING_TRIGGER
      // ".анонс" как ОТВЕТ (Reply) на пересланный пост - см. комментарий у ANNOUNCE_TRIGGER
      if (text.trim().toLowerCase().startsWith(ANNOUNCE_TRIGGER)) {
        const targetChatId = chatId
        const reply = async (msg: string) => {
          await sendTelegramMessage(BOT_TOKEN, targetChatId, `[Анонс]\n${msg}`)
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const replyTo = body.message.reply_to_message
        if (!replyTo) {
          return await reply(
            '🔴 Перешли пост из канала в этот чат, затем ОТВЕТЬ (Reply, не просто напиши) на него текстом ".анонс"',
          )
        }
        if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
          return await reply('🔴 GitHub credentials не настроены')
        }

        const sourceText: string = replyTo.caption ?? replyTo.text ?? ''
        const extra = text.slice(ANNOUNCE_TRIGGER.length).trim()
        const combinedText = (extra ? `${extra}\n\n${sourceText}` : sourceText).trim()
        const photos = replyTo.photo as Array<{ file_id: string }> | undefined

        if (!combinedText && (!photos || photos.length === 0)) {
          return await reply(
            '🔴 В пересланном сообщении нет ни текста, ни фото — публиковать нечего',
          )
        }

        const id = String(Date.now())
        let imagePath: string | null = null
        if (photos && photos.length > 0) {
          imagePath = await uploadAnnouncementImage(
            BOT_TOKEN,
            GITHUB_TOKEN,
            REPO_OWNER,
            REPO_NAME,
            photos[photos.length - 1].file_id,
            id,
          )
        }

        const result = await mutateGithubJsonFile<Announcement[]>(
          GITHUB_TOKEN,
          REPO_OWNER,
          REPO_NAME,
          ANNOUNCEMENTS_PATH,
          (list) => {
            const arr = list ?? []
            arr.push({
              id,
              date: new Date().toISOString().slice(0, 10),
              text: combinedText,
              imagePath,
            })
            return arr
          },
          `Announcements: новый анонс ${id}`,
        )
        if (!result.ok) {
          return await reply(`🔴 Не удалось сохранить announcements.json (${result.reason})`)
        }
        return await reply(`✅ Опубликовано: https://archivist-library.com/announcements`)
      }
      if (text.trim().toLowerCase().startsWith(LOCAL_NAME_TRIGGER)) {
        const targetChatId = chatId
        const reply = async (msg: string) => {
          await sendTelegramMessage(BOT_TOKEN, targetChatId, `[Локализация]\n${msg}`)
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
          return await reply('🔴 GitHub credentials не настроены')
        }

        const match = text.match(/\.локал\s+(\S+)\s+"([^"]+)"/i)
        if (!match) {
          return await reply('🔴 Формат: .локал reactor:<id> "Имя" (или dungeon:<id> "Имя")')
        }
        const [, key, name] = match

        const result = await mutateGithubJsonFile<Record<string, string>>(
          GITHUB_TOKEN,
          REPO_OWNER,
          REPO_NAME,
          RESOLVED_NAMES_PATH,
          (data) => {
            const map = data ?? {}
            map[key] = name
            return map
          },
          `Локализация: ${key} = "${name}"`,
        )
        if (!result.ok) {
          return await reply(`🔴 Не удалось сохранить имя (${result.reason})`)
        }

        const triggered = await triggerWorkflow(
          GITHUB_TOKEN,
          REPO_OWNER,
          REPO_NAME,
          FINISH_PENDING_WORKFLOW,
        )
        return await reply(
          `✅ Имя "${name}" сохранено для ${key}.` +
            (triggered
              ? ' Запускаю доделку (арт/CDN/публикация)...'
              : ' ⚠️ Не удалось запустить workflow — доделка произойдёт на следующем sync-cron.'),
        )
      }
      if (text.trim().toLowerCase().startsWith(ORBING_TRIGGER)) {
        const targetChatId = chatId
        const reply = async (msg: string) => {
          await sendTelegramMessage(BOT_TOKEN, targetChatId, `[Сфера]\n${msg}`)
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
          return await reply('🔴 GitHub credentials не настроены')
        }

        const parsed = parseOrbingBlock(text)
        if ('error' in parsed) {
          return await reply(
            parsed.error === 'не указано имя мутанта после .сфера'
              ? '🔴 Формат:\n.сфера Имя мутанта\nатака ; усиление ; спец скорость\nздоровье ; усиление ; спец скорость\nусиление ; усиление ; спец скорость'
              : `🔴 ${parsed.error}`,
          )
        }
        const { nameRaw, rows } = parsed

        const resolved = await resolveMutantIdByName(GITHUB_TOKEN, REPO_OWNER, REPO_NAME, nameRaw)
        if ('error' in resolved) {
          return await reply(`🔴 ${resolved.error}`)
        }

        const result = await mutateGithubJsonFile<Record<string, { rows: OrbCellValue[][] }>>(
          GITHUB_TOKEN,
          REPO_OWNER,
          REPO_NAME,
          ORBING_PATH,
          (orbingData) => {
            orbingData[resolved.id] = { rows }
            return orbingData
          },
          `Orbing: обновить сферовку "${resolved.name}"`,
        )
        if (!result.ok) {
          return await reply(`🔴 Не удалось сохранить orbing.json (${result.reason})`)
        }
        return await reply(`✅ Сферовка "${resolved.name}" (${resolved.id}) обновлена`)
      }
    }

    if (body.message && body.message.document) {
      // В группе — обрабатываем файл, только если в тексте/подписи явно
      // указан триггер (иначе любой скинутый в чат файл будет пытаться
      // распарситься как тиры).
      const caption: string = body.message.caption ?? ''
      const trigger = `${text} ${caption}`.toLowerCase()

      // .сфера-файл: несколько блоков ".сфера Имя" + ряды, разделённых
      // строкой "_" - см. комментарий у processOrbingFile.
      if (trigger.includes(ORBING_TRIGGER)) {
        if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
          throw new Error('GitHub credentials are not configured')
        }
        const fileId = body.message.document.file_id
        const fileResponse = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
        )
        const fileInfo = await fileResponse.json()
        if (!fileInfo.ok) {
          throw new Error('Failed to get file from Telegram')
        }
        const filePath = fileInfo.result.file_path
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
        const fileContent = await (await fetch(fileUrl)).text()

        const result = await processOrbingFile(GITHUB_TOKEN, REPO_OWNER, REPO_NAME, fileContent)
        if (chatId != null && BOT_TOKEN) {
          await sendTelegramMessage(BOT_TOKEN, chatId, `[Сфера]\n${result}`)
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (!trigger.includes(TIER_TRIGGER)) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const fileId = body.message.document.file_id
      const fileName = body.message.document.file_name

      console.log(`Received file: ${fileName}`)

      if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
        throw new Error('GitHub credentials are not configured')
      }

      // Get file from Telegram
      const fileResponse = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
      )
      const fileInfo = await fileResponse.json()

      if (!fileInfo.ok) {
        throw new Error('Failed to get file from Telegram')
      }

      // Download file content
      const filePath = fileInfo.result.file_path
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
      const fileContent = await (await fetch(fileUrl)).text()

      // Load mutants.json from GitHub — ОДИН раз; sha из этого же ответа
      // используется для последующего PUT (раньше файл качался дважды).
      const mutantsRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/src/data/mutants/mutants.json`,
        { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } },
      )

      console.log(`Mutants API response: ${mutantsRes.status}`)

      if (!mutantsRes.ok) {
        console.error(`GitHub API error: ${mutantsRes.status}`)
        throw new Error('Failed to load mutants data')
      }

      const mutantsData = await mutantsRes.json()

      // For large files, GitHub returns empty content - use download_url instead
      let mutantsJson: string
      if (mutantsData.content && mutantsData.content.length > 0) {
        // atob() returns a binary string and mangles UTF-8 -> Russian names break.
        mutantsJson = Buffer.from(mutantsData.content, 'base64').toString('utf-8')
      } else if (mutantsData.download_url) {
        const downloadRes = await fetch(mutantsData.download_url)
        if (!downloadRes.ok) {
          throw new Error('Failed to download mutants data')
        }
        mutantsJson = await downloadRes.text()
      } else {
        throw new Error('No content available for mutants.json')
      }

      // Parse tiers
      const { parseTierData } = await import('../../lib/tier-parser')
      const parsedTiers = parseTierData(fileContent, mutantsJson)

      // Validate
      for (const tier of Object.values(parsedTiers)) {
        if (!VALID_TIERS.includes(tier as string)) {
          return new Response(JSON.stringify({ error: 'Invalid tier data' }), { status: 400 })
        }
      }

      // Update via GitHub API
      const currentMutants = JSON.parse(mutantsJson)

      // Каждый загруженный файл - это ПОЛНЫЙ снимок тир-листа (все тиры разом,
      // см. VALID_TIERS), а не диффом поверх старого. Раньше цикл только
      // проставлял tier тем, кто есть в parsedTiers, но никогда не снимал tier
      // с мутантов, выпавших из списка - они копились в mutants.json навсегда.
      // Поэтому сначала снимаем tier со всех, потом проставляем свежий набор.
      let count = 0
      let cleared = 0
      for (const m of currentMutants as { id?: string; tier?: string }[]) {
        if (m.id && !(m.id in parsedTiers) && m.tier != null) {
          delete m.tier
          cleared++
        }
      }
      for (const [mutantId, newTier] of Object.entries(parsedTiers)) {
        const idx = currentMutants.findIndex((m: { id?: string }) => m.id === mutantId)
        if (idx !== -1) {
          currentMutants[idx].tier = newTier
          count++
        }
      }

      const updatedContent = JSON.stringify(currentMutants, null, 2)
      const encoded = Buffer.from(updatedContent, 'utf-8').toString('base64')

      const updateRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/src/data/mutants/mutants.json`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `Update: ${count} tiers from Telegram (снято ${cleared})`,
            content: encoded,
            sha: mutantsData.sha,
            branch: 'main',
          }),
        },
      )

      if (!updateRes.ok) {
        throw new Error('Failed to update file')
      }

      console.log(`Updated ${count} tiers, cleared ${cleared} stale`)

      if (chatId != null && BOT_TOKEN) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `[Тиры]\n✅ Успех! Обновлено ${count} тиров, снято ${cleared} у выпавших из списка.`,
        )
      }

      return new Response(
        JSON.stringify({ success: true, count: Object.keys(parsedTiers).length }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    return new Response(JSON.stringify({ message: 'OK' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Webhook error:', error)
    // Сообщаем отправителю файла об ошибке, иначе он не узнает о проблеме
    // (сервер молча 500-ил, а Telegram бесконечно ретраил).
    if (chatId != null && BOT_TOKEN) {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        '[Тиры]\n❌ Ошибка обработки файла тиров. Попробуйте позже.',
      )
    }
    // 200, а не 500: иначе Telegram ретраит апдейт и дублирует ❌-сообщения.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
