// Журнал ротаций залов обмена (scripts/journals/hall-rotations.json).
//
// Зал меняется целиком (все слоты разом), поэтому учёт ведётся по ротации, а не
// по паре "слот + мутант". Ротация = отпечаток набора "слот -> мутант" в живом
// gamedefinitions.xml. Здесь только чистые функции (их покрывают тесты); чтение
// XML и файлы - в scripts/update-hall-rotations.ts.
//
// Зачем: у Зала испытаний нет собственного окна ротации (общий фильтр
// Building_Challenge_Deactivable живёт месяцами), поэтому дату старта брать
// неоткуда, кроме (1) окна новостного баннера Daily_news_challenge_hall_block_N
// из kartel и (2) нашего первого наблюдения нового состава.

export interface HallReward {
  slot: string // READY_04
  spec: string // Specimen_BE_10
  amount: number
  tokenId: string
  filter: string | null
}

export interface MysteryReward {
  slot: string
  spec: string
  skin: string
  filter: string | null
}

// Награды-мутанты слотов зала: контракт (Cost + Filter) -> WORKING_n -> READY_n ->
// награда. Тот же разбор, что раньше был в build-offer-history.ts и
// fetchHallContracts в build-announcements.ts.
export function parseHallRewards(xml: string, entityId: string): HallReward[] {
  const block = xml.match(
    new RegExp(`<EntityDescriptor id="${entityId}"[^>]*>([\\s\\S]*?)<\\/EntityDescriptor>`),
  )
  if (!block) return []
  const inner = block[1]
  const costByWorking = new Map<
    string,
    { amount: number; tokenId: string; filter: string | null }
  >()
  for (const m of inner.matchAll(
    /<InteractiveAction[^>]*target="(WORKING_\d+)"[^>]*id="CONTRACT_\d+">([\s\S]*?)<\/InteractiveAction>/g,
  )) {
    const cost = m[2].match(/<Cost amount="(\d+)" type="entity" id="([^"]+)"/)
    const filter = m[2].match(/<Filter>([^<]*)<\/Filter>/)
    if (cost) {
      costByWorking.set(m[1], {
        amount: Number(cost[1]),
        tokenId: cost[2],
        filter: filter?.[1] || null,
      })
    }
  }
  const workingByReady = new Map<string, string>()
  for (const m of inner.matchAll(
    /<State[^>]*id="(WORKING_\d+)"[^>]*>\s*<TimeAction[^>]*target="(READY_\d+)"/g,
  )) {
    workingByReady.set(m[2], m[1])
  }
  const out: HallReward[] = []
  for (const m of inner.matchAll(
    /<State[^>]*id="(READY_\d+)"[^>]*>\s*<InteractiveAction[^>]*id="RECOLT"[^>]*>\s*<Reward\b([^/>]*)\/?>/g,
  )) {
    const spec = m[2].match(/id="([^"]+)"/)?.[1]
    if (!spec || !/^Specimen_/i.test(spec)) continue
    const cost = costByWorking.get(workingByReady.get(m[1]) ?? '')
    if (!cost) continue
    out.push({
      slot: m[1],
      spec,
      amount: cost.amount,
      tokenId: cost.tokenId,
      filter: cost.filter,
    })
  }
  return out
}

// Анализатор тайны: 6 контрактов-рецептов, мутант награды - со скином.
export function parseMysteryRewards(xml: string): MysteryReward[] {
  const block = xml.match(
    /<EntityDescriptor id="Building_Mystery"[^>]*>([\s\S]*?)<\/EntityDescriptor>/,
  )
  if (!block) return []
  const inner = block[1]
  const filterByNum = new Map<string, string>()
  for (const m of inner.matchAll(
    /<InteractiveAction[^>]*target="WORKING_(\d+)"[^>]*id="CONTRACT_\d+">([\s\S]*?)<\/InteractiveAction>/g,
  )) {
    const filter = m[2].match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    if (filter) filterByNum.set(m[1], filter)
  }
  const out: MysteryReward[] = []
  for (const m of inner.matchAll(/<State[^>]*id="READY_(\d+)"[^>]*>([\s\S]*?)<\/State>/g)) {
    const reward = m[2].match(/<Reward id="([^"]+)">([\s\S]*?)<\/Reward>/)
    const skin = reward?.[2].match(/<Tag key="skin" value="([^"]+)"/)?.[1]
    if (!reward || !skin) continue
    out.push({
      slot: `READY_${m[1]}`,
      spec: reward[1],
      skin,
      filter: filterByNum.get(m[1]) ?? null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Журнал
// ---------------------------------------------------------------------------

export type RotationDateSource = 'kartel-news' | 'filter-window' | 'first-seen' | 'manual'

export interface HallRotation {
  fp: string
  slots: Record<string, string> // READY_04 -> specimen_be_10 (нижний регистр)
  amounts: Record<string, number> // READY_04 -> цена в жетонах
  firstSeen: string // ISO момент, когда состав впервые увидели
  lastSeen: string
  endedAt?: string // ISO: когда пришла следующая ротация
  date: string // YYYY-MM-DD, показываемая дата старта
  dateSource: RotationDateSource
  block?: string // имя окна, по которому взята дата (kartel-news / filter-window)
}

export interface HallCandidate {
  fp: string
  slots: Record<string, string>
  amounts: Record<string, number>
  firstSeen: string
  runs: number
}

export interface HallState {
  rotations: HallRotation[]
  candidate?: HallCandidate
}

export type HallJournal = Record<string, HallState>

export interface NewsWindow {
  name: string
  start: string // ISO
  end: string | null
}

export interface HallHint {
  // Окна новостных баннеров ротации (только Зал испытаний).
  newsWindows?: NewsWindow[]
  // Старт окна фильтров слотов (джекпот, тайна): известен из kartel/date-ledger.
  filterStart?: { date: string; name: string } | null
}

// Новый состав должен продержаться столько прогонов подряд, чтобы считаться
// ротацией: один неполный разбор XML или временный глюк ротацией не станет.
export const CONFIRM_RUNS = 2
// Окно новостного баннера считается "своим", если стартует не раньше чем за 3 дня до
// первого наблюдения состава и не позже чем через сутки после него.
const NEWS_BEFORE_MS = 3 * 24 * 3600 * 1000
const NEWS_AFTER_MS = 24 * 3600 * 1000
const NEWS_NAME_RE = /^Daily_news_challenge_hall_block_(\d+)_\d{4}$/

export function slotsFingerprint(slots: Record<string, string>): string {
  return Object.entries(slots)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
}

// Дата ротации: окно новостного баннера > старт окна фильтров слотов > первое наблюдение.
export function pickRotationDate(
  firstSeen: string,
  hint: HallHint,
): { date: string; dateSource: RotationDateSource; block?: string } {
  const fs = Date.parse(firstSeen)
  let best: { n: number; w: NewsWindow } | null = null
  for (const w of hint.newsWindows ?? []) {
    const n = Number(w.name.match(NEWS_NAME_RE)?.[1])
    if (!Number.isFinite(n)) continue
    const start = Date.parse(w.start)
    if (!(start >= fs - NEWS_BEFORE_MS && start <= fs + NEWS_AFTER_MS)) continue
    if (w.end && !(Date.parse(w.end) > fs)) continue
    if (!best || n > best.n) best = { n, w }
  }
  if (best) {
    return { date: best.w.start.slice(0, 10), dateSource: 'kartel-news', block: best.w.name }
  }
  if (hint.filterStart) {
    return {
      date: hint.filterStart.date,
      dateSource: 'filter-window',
      block: hint.filterStart.name,
    }
  }
  return { date: firstSeen.slice(0, 10), dateSource: 'first-seen' }
}

export type HallEvent =
  | { kind: 'skipped'; reason: string }
  | { kind: 'unchanged' }
  | { kind: 'candidate'; runs: number }
  | { kind: 'rotation'; date: string; dateSource: RotationDateSource }
  | { kind: 'date-updated'; date: string; dateSource: RotationDateSource }

export interface HallObservation {
  slots: Record<string, string>
  amounts: Record<string, number>
}

// Один прогон: наблюдение состава зала -> новое состояние журнала. Не мутирует вход.
export function observeHall(
  prev: HallState | undefined,
  obs: HallObservation | null,
  nowIso: string,
  hint: HallHint,
  minSlots: number,
): { state: HallState; event: HallEvent } {
  const state: HallState = prev ? structuredClone(prev) : { rotations: [] }
  if (!obs || Object.keys(obs.slots).length < minSlots) {
    return {
      state,
      event: {
        kind: 'skipped',
        reason: obs ? `слотов ${Object.keys(obs.slots).length} < ${minSlots}` : 'нет данных',
      },
    }
  }
  const fp = slotsFingerprint(obs.slots)
  const cur = [...state.rotations].reverse().find((r) => !r.endedAt)

  if (cur && cur.fp === fp) {
    // Тот же состав: сбрасываем кандидата (откат до подтверждения) и пересматриваем дату.
    delete state.candidate
    cur.lastSeen = nowIso
    if (cur.dateSource !== 'manual' && cur.dateSource !== 'kartel-news') {
      const d = pickRotationDate(cur.firstSeen, hint)
      if (d.date !== cur.date || d.dateSource !== cur.dateSource || d.block !== cur.block) {
        cur.date = d.date
        cur.dateSource = d.dateSource
        if (d.block) cur.block = d.block
        else delete cur.block
        return { state, event: { kind: 'date-updated', date: d.date, dateSource: d.dateSource } }
      }
    }
    return { state, event: { kind: 'unchanged' } }
  }

  const cand = state.candidate
  if (cand && cand.fp === fp) {
    cand.runs += 1
    if (cand.runs < CONFIRM_RUNS) return { state, event: { kind: 'candidate', runs: cand.runs } }
    if (cur) cur.endedAt = cand.firstSeen
    const d = pickRotationDate(cand.firstSeen, hint)
    state.rotations.push({
      fp,
      slots: cand.slots,
      amounts: cand.amounts,
      firstSeen: cand.firstSeen,
      lastSeen: nowIso,
      date: d.date,
      dateSource: d.dateSource,
      ...(d.block ? { block: d.block } : {}),
    })
    delete state.candidate
    return { state, event: { kind: 'rotation', date: d.date, dateSource: d.dateSource } }
  }

  state.candidate = {
    fp,
    slots: obs.slots,
    amounts: obs.amounts,
    firstSeen: nowIso,
    runs: 1,
  }
  return { state, event: { kind: 'candidate', runs: 1 } }
}
