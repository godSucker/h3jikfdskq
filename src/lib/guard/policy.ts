// Правила охраны чата: чистые функции без сети и без побочных эффектов, чтобы
// всё, что бот решает про человека, проверялось тестами. Контекст: у чата уже
// был бот, который вешал вечный мут на живых людей (2026-10-07), поэтому:
//  - любое ограничение временное и снимается самим Telegram (until_date), бота для
//    снятия не нужно, и упавший вебхук не оставит никого замьюченным;
//  - оба действия (ограничение и бан) выключены по умолчанию - сначала только лог.

export const DEFAULT_PROBATION_HOURS = 24

export interface GuardConfig {
  // Новичок первые N часов пишет только текст (без фото/видео/файлов/стикеров).
  restrict: boolean
  // Бан, если Telegram-ID есть в базе спамеров (LOLS).
  ban: boolean
  probationHours: number
}

const truthy = (v: string | undefined) => /^(1|true|on|yes)$/i.test((v ?? '').trim())

export function parseGuardConfig(env: {
  GUARD_RESTRICT?: string
  GUARD_BAN?: string
  GUARD_PROBATION_HOURS?: string
}): GuardConfig {
  const hours = Number(env.GUARD_PROBATION_HOURS)
  return {
    restrict: truthy(env.GUARD_RESTRICT),
    ban: truthy(env.GUARD_BAN),
    // от часа до месяца: меньше смысла нет, а Telegram считает срок меньше 30 секунд
    // или больше 366 суток "навсегда"
    probationHours:
      Number.isFinite(hours) && hours >= 1 && hours <= 24 * 30 ? hours : DEFAULT_PROBATION_HOURS,
  }
}

export type LolsVerdict = 'banned' | 'clean' | 'unknown'

export interface JoinFacts {
  isBot: boolean
  lols: LolsVerdict
}

export interface JoinPlan {
  // чего хочет политика
  intent: 'skip' | 'restrict' | 'ban'
  // что реально будет сделано с учётом рубильников
  effective: 'none' | 'restrict' | 'ban'
  reason: string
}

export function planJoin(facts: JoinFacts, cfg: GuardConfig): JoinPlan {
  // Бота в чат добавляет только админ.
  if (facts.isBot) return { intent: 'skip', effective: 'none', reason: 'бот' }

  if (facts.lols === 'banned') {
    // Бан выключен - остаётся хотя бы ограничение новичка, если оно включено.
    const effective = cfg.ban ? 'ban' : cfg.restrict ? 'restrict' : 'none'
    return { intent: 'ban', effective, reason: 'есть в базе спамеров LOLS' }
  }
  return {
    intent: 'restrict',
    effective: cfg.restrict ? 'restrict' : 'none',
    reason: facts.lols === 'unknown' ? 'новичок (база спамеров не ответила)' : 'новичок',
  }
}

// Только текст: писать можно, слать картинки, видео, файлы, голосовые, стикеры/гиф,
// опросы и ссылки с превью - нельзя. Поля заданы явно все, потому что при
// use_independent_chat_permissions незаданное Telegram может трактовать по-своему.
export function probationPermissions() {
  return {
    can_send_messages: true,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_manage_topics: false,
  }
}

export function probationUntil(nowSec: number, hours: number): number {
  return Math.floor(nowSec + hours * 3600)
}
