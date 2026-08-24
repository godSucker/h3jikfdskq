// Google Sheets ID из вашего URL
const SHEET_ID = '10hJePm-VDoM-fywzgHx8bPMcGfMoOJKQ2aFy99t0NKs'
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`

// Кэш для хранения данных
let cachedData: PlayerRecord[] | null = null
let cacheTime: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 минут

export interface PlayerRecord {
  rank: number
  name: string
  level: number
  id: string
  tandem: string
  atk1: string
  atk2: string
  socials: {
    type: 'fb' | 'vk' | 'tg' | 'link' | 'text'
    url: string
    label: string
    source: 'profile' | 'contact'
  }[]
}

function parseCSV(text: string): string[][] {
  // Посимвольный разбор всего текста: перенос строки ВНУТРИ кавычек — часть
  // значения ячейки, а не конец строки таблицы (раньше text.split('\n')
  // ломал такие строки пополам).
  const rows: string[][] = []
  let values: string[] = []
  let current = ''
  let inQuotes = false

  const pushValue = () => {
    values.push(current.trim().replace(/^"|"$/g, ''))
    current = ''
  }
  const pushRow = () => {
    pushValue()
    if (values.some((v) => v !== '')) rows.push(values)
    values = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      // Экранированная кавычка внутри кавычек: "" -> "
      if (inQuotes && text[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      pushValue()
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else {
      current += char
    }
  }
  if (current !== '' || values.length) pushRow()

  return rows
}

export async function loadEvoTop(): Promise<PlayerRecord[]> {
  const now = Date.now()
  if (cachedData && now - cacheTime < CACHE_DURATION) {
    return cachedData
  }

  try {
    const response = await fetch(SHEET_URL)

    if (!response.ok) {
      if (cachedData) return cachedData
      return []
    }

    const csvText = await response.text()
    const rows = parseCSV(csvText)

    // Пропускаем заголовок и обрабатываем строки
    // Индексы колонок (с учетом пустой первой колонки):
    // 0='', 1='№', 2='Имя', 3='ЭВО', 4='Слава', 5='Тандем', 6='Атака1', 7='Атака2', 8='ФБ', 9='Контакт'
    const players: PlayerRecord[] = rows
      .slice(1)
      .map((row, index) => {
        const name = row[2] // Имя/Ник
        const level = row[3] // ЭВО
        const tandem = row[5] // Тандем

        const formatNum = (val: unknown) => {
          if (!val) return '???'
          if (!isNaN(Number(val))) return Number(val).toLocaleString('ru-RU')
          return String(val).trim()
        }

        const atk1 = formatNum(row[6]) // 1 атака
        const atk2 = formatNum(row[7]) // 2 атака

        const socialRaw1 = String(row[8] || '').trim() // Фейсбук - ссылка на игровой профиль
        const socialRaw2 = String(row[9] || '').trim() // Контакт для связи (добавление в друзья)

        const socials: PlayerRecord['socials'] = []

        // Подписи-маркеры, которые в таблице означают "тут просто указан тип
        // контакта", а не осмысленный текст - в этом случае label берём по типу,
        // а не показываем сырое "Тг"/"Вк" как есть.
        const GENERIC_LABELS = new Set([
          'тг',
          'вк',
          'tg',
          'vk',
          'facebook',
          'фб',
          'fb',
          'телеграм',
          'телеграмм',
          'вконтакте',
        ])

        // Ссылка/хэндл узнаётся по форме: http(s)://..., @handle или голый домен.
        // Если это не так - считаем ячейку обычным текстом ("Принимает всех в
        // фейсбуке", "Принимает до лимита в 5к друзей" и т.п.) и НЕ пытаемся
        // собрать из него URL (раньше такой текст лился в https://<текст с
        // пробелами>, что давало битую ссылку).
        const looksLikeLink = (candidate: string) =>
          /^https?:\/\//i.test(candidate) ||
          candidate.startsWith('@') ||
          /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(candidate)

        const addSocial = (raw: string, source: 'profile' | 'contact') => {
          if (!raw || ['undefined', '-', 'нет', 'net', '—', '0'].includes(raw.toLowerCase())) return

          // Отделяем возможную подпись перед ссылкой ("ДЕШЕВЫЙ ДОНАТ В ИГРУ -
          // https://t.me/Donut_Safe" -> customLabel="ДЕШЕВЫЙ ДОНАТ В ИГРУ"), чтобы
          // авторский текст из таблицы мог переопределить дефолтный лейбл типа.
          let customLabel = ''
          let url: string
          if (raw.includes('http')) {
            const idx = raw.indexOf('http')
            customLabel = raw
              .slice(0, idx)
              .replace(/[-–—:]\s*$/, '')
              .trim()
            url = raw.slice(idx).trim()
          } else {
            const m = raw.match(/^([\wа-яА-ЯёЁ]+)\s*[-–—:]\s*(.*)$/i)
            if (m) {
              customLabel = m[1]
              url = m[2].trim()
            } else {
              url = raw.trim()
            }
          }

          if (!looksLikeLink(url)) {
            socials.push({ type: 'text', url: '', label: raw, source })
            return
          }

          // Колонка профиля по смыслу - всегда ссылка на FB (даже если физически
          // это vk.com/away.php-редирект на facebook.com, вставленный через кнопку
          // "поделиться" ВК) - тип не сниффим, помечаем как fb.
          let type: 'fb' | 'vk' | 'tg' | 'link' = 'link'
          let defaultLabel = 'Ссылка'

          if (source === 'profile') {
            type = 'fb'
            defaultLabel = 'Facebook'
          } else {
            const lower = url.toLowerCase()
            if (lower.includes('vk.com') || lower.includes('vk.cc')) {
              type = 'vk'
              defaultLabel = 'VKontakte'
            } else if (lower.includes('facebook') || lower.includes('fb.com')) {
              type = 'fb'
              defaultLabel = 'Facebook'
            } else if (
              lower.includes('t.me') ||
              lower.includes('tg') ||
              raw.toLowerCase().includes('тг')
            ) {
              type = 'tg'
              defaultLabel = 'Telegram'
              if (!url.includes('http') && !url.includes('t.me')) {
                const nick = url.replace('@', '').trim().split(' ')[0]
                url = `https://t.me/${nick}`
              }
            }
          }

          if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`

          const label =
            customLabel && !GENERIC_LABELS.has(customLabel.toLowerCase())
              ? customLabel
              : defaultLabel
          socials.push({ type, url, label, source })
        }

        addSocial(socialRaw1, 'profile')
        addSocial(socialRaw2, 'contact')

        const cleanName = String(name || '').trim()
        const cleanLvl = Number(String(level).replace(/[^0-9]/g, ''))
        const cleanTandem = String(tandem || '').trim()

        return {
          rank: 0,
          name: cleanName,
          level: cleanLvl || 0,
          tandem: cleanTandem === 'undefined' ? '' : cleanTandem,
          atk1,
          atk2,
          socials,
          id: `p-${index}`,
        }
      })
      .filter((p) => p.name && p.level > 0 && p.name !== 'Имя/Ник')
      .sort((a, b) => b.level - a.level)

    const result = players.map((p, i) => ({ ...p, rank: i + 1 }))

    cachedData = result
    cacheTime = Date.now()

    return result
  } catch {
    if (cachedData) return cachedData
    return []
  }
}
