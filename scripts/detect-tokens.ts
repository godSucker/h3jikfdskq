// Авто-синк жетонов/материалов (Material_*_Token и родственные) в
// material.json. В отличие от реакторов/данжей RU-имя УЖЕ есть в офиц.
// локализации (см. auto-announcements-architecture) - .локал не нужен,
// обычный Phase-1-паттерн: пишет данные сразу, build-announcements.ts
// объявляет через diff material.json (см. detectTokens там же).
//
// Иконка: качаем из Kobojo /assets/thumbnails/ (тот же CDN, что build-boxes.ts)
// и кладём в public/materials/<Id>.png. В JSON пишем ЛОКАЛЬНЫЙ путь
// (/materials/<Id>.png), не хотлинк - иначе:
//   1) Kobojo может удалить/обновить thumbnail (не под нашим контролем);
//   2) естественный размер иконок в /thumbnails/ разный (одни 96x96, другие
//      175x175) - в верстке .thumb img { max-width: 100%; width: auto } это
//      даёт неодинаковый визуальный размер жетонов в таблице. Наш CDN
//      (build ->  Yandex S3 через workflow) отдаёт то, что мы положили.
// Дальше файл заливается на Яндекс-CDN шагом 12 в announcements-hourly.yml
// (`aws s3 cp public/materials/*`).
//
// Если файла на Kobojo нет (404) - оставляем entry без texture, следующий
// прогон попробует ещё раз (иногда thumbnail появляется чуть позже игровых
// данных).

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'

const ROOT = process.cwd()
const GAME_DEFS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gamedefinitions.xml'
const LOC_RU_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/localisation_ru.txt'
const THUMB_BASE = 'https://s-beta.kobojo.com/mutants/assets/thumbnails/'
const MATERIAL_PATH = path.join(ROOT, 'src/data/materials/material.json')
const MATERIALS_DIR = path.join(ROOT, 'public/materials')

// Жетоны, которые формально есть в gamedefinitions.xml, но по факту не
// выдаются игрокам (мёртвый EntityDescriptor без ассетов/локализации) -
// см. комментарий у BLACKLISTED_IDS в main().
const BLACKLISTED_IDS = new Set(['Material_Preorder_Token_FC_11'])

interface MaterialEntry {
  id: string
  name: string
  description?: string
  texture?: string | null
  eventDate?: string
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'))
  } catch {
    return fallback
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// Качает иконку жетона в public/materials/<Id>.png (переиспользуя ID как имя
// файла, не toLowerCase - иначе один и тот же жетон в разных прогонах может
// иметь разные регистры имени файла на диске и в git разное). Возвращает путь
// для JSON.texture или null если Kobojo вернул не-200.
async function downloadTokenIcon(id: string): Promise<string | null> {
  const localName = `${id}.png`
  const localPath = path.join(MATERIALS_DIR, localName)
  if (await fileExists(localPath)) return `/materials/${localName}`
  const url = `${THUMB_BASE}${id.toLowerCase()}.png`
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      validateStatus: (s) => s === 200,
    })
    await fs.mkdir(MATERIALS_DIR, { recursive: true })
    await fs.writeFile(localPath, Buffer.from(res.data))
    return `/materials/${localName}`
  } catch {
    return null
  }
}

async function main() {
  const [{ data: xml }, { data: locRaw }, materials] = await Promise.all([
    axios.get<string>(GAME_DEFS_URL, { responseType: 'text', timeout: 20000 }),
    axios.get<string>(LOC_RU_URL, { responseType: 'text', timeout: 20000 }),
    loadJson<MaterialEntry[]>(MATERIAL_PATH, []),
  ])

  const loc = new Map<string, string>()
  for (const rawLine of locRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const i = line.indexOf(';')
    if (i === -1) continue
    loc.set(line.slice(0, i).toLowerCase(), line.slice(i + 1))
  }

  const tokenIds = new Set<string>()
  for (const m of xml.matchAll(/<EntityDescriptor id="(Material_[^"]*[Tt]oken[^"]*)"/g)) {
    tokenIds.add(m[1])
  }

  // Записи из EntityDescriptor, которые формально ещё висят в игровых XML,
  // но по факту мертвы (thumbnail на Kobojo 404, локализации нет) - ручная
  // проверка 2026-08-08 показала Material_Preorder_Token_FC_11 именно таким:
  // старая заготовка под предзаказ, который либо отменили, либо так и не
  // выпустили. Без блэклиста ретро-миграция бы решила, что это "новый"
  // жетон (он не в known), запушила бы его снова с пустым именем и без
  // текстуры (см. downloadTokenIcon -> 404 -> null).
  for (const id of BLACKLISTED_IDS) tokenIds.delete(id)

  const known = new Map(materials.map((m, i) => [m.id, i]))
  const fresh = [...tokenIds].filter((id) => !known.has(id))

  // Ретро-фикс: если у УЖЕ известного жетона осталась дырявая ссылка на
  // Kobojo-хотлинк (старый формат до этого рефакторинга) - тихо переезжаем
  // на локальную копию тем же путём. Не гоняем ретро-скачивание для всех,
  // только для тех, у кого texture начинается на "https://" - остальные
  // либо уже нормальные, либо руками положены.
  //
  // Второе условие (texture === null) - повторная попытка для жетонов, у
  // которых скачивание раньше 404-нулось (downloadTokenIcon вернул null,
  // main() записал texture: null явно). БЕЗ него такой жетон навсегда
  // оставался без иконки, хотя комментарий ниже обещает "следующий прогон
  // попробует ещё раз" (найдено код-ревью 2026-08-08). undefined (поле
  // вообще отсутствует у руками добавленных записей вроде
  // Material_Hallowen_Nightmare) сюда НЕ попадает - это осознанное
  // отсутствие текстуры, не сбой скачивания.
  const retroMigrateIds = materials
    .filter(
      (m) =>
        tokenIds.has(m.id) &&
        ((typeof m.texture === 'string' && m.texture.startsWith('http')) || m.texture === null),
    )
    .map((m) => m.id)

  const targets = [...fresh, ...retroMigrateIds]
  if (targets.length === 0) {
    console.log('[TOKENS] Новых жетонов не найдено, миграций хотлинков нет.')
    return
  }

  let downloaded = 0
  let missedThumb = 0
  for (const id of targets) {
    const texture = await downloadTokenIcon(id)
    if (texture) downloaded++
    else missedThumb++

    const existingIdx = known.get(id)
    if (existingIdx !== undefined) {
      // Ретро-миграция: только перезаписываем texture, остальное не трогаем.
      materials[existingIdx].texture = texture ?? materials[existingIdx].texture
      console.log(`[TOKENS] Ретро-миграция ${id}: texture -> ${texture ?? '(осталась старая)'}`)
    } else {
      const name = loc.get(id.toLowerCase()) ?? id.replace(/_/g, ' ')
      // eventDate = дата, когда МЫ впервые увидели жетон в живых игровых
      // файлах (не дата начала ивента напрямую, но с точностью до часа-двух
      // благодаря часовому воркфлоу) - используется для хронологической
      // сортировки на /materials (см. sortTokensChronologically в
      // src/pages/materials/index.astro). Без этого поля новый жетон был бы
      // невидим для сортировки и вечно всплывал в конце как "без даты".
      materials.push({
        id,
        name,
        description: loc.get(`tooltip_${id.toLowerCase()}`) ?? '',
        texture,
        eventDate: new Date().toISOString().slice(0, 10),
      })
      console.log(`[TOKENS] Новый: ${id} -> "${name}" (texture=${texture ?? 'нет'})`)
    }
  }

  await fs.writeFile(MATERIAL_PATH, JSON.stringify(materials, null, 2) + '\n', 'utf-8')
  console.log(
    `[TOKENS] Итого: скачано ${downloaded}, не найдено на CDN ${missedThumb}, обработано ${targets.length}.`,
  )
}

main().catch((err) => {
  console.error('[TOKENS] Ошибка:', err instanceof Error ? err.message : err)
  process.exit(1)
})
