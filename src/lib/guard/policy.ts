// Правила охраны чата: чистые функции без сети и без побочных эффектов, чтобы
// всё, что бот решает про человека, проверялось тестами. Контекст: у чата уже
// был бот, который вешал вечный мут на живых людей (2026-10-07), поэтому бан
// выключен по умолчанию: сначала только журнал. Единственное действие бота -
// бан по базе спамеров на входе; ограничений новичкам нет.

export interface GuardConfig {
  // Бан, если Telegram-ID есть в базе спамеров (LOLS).
  ban: boolean
}

const truthy = (v: string | undefined) => /^(1|true|on|yes)$/i.test((v ?? '').trim())

export function parseGuardConfig(env: { GUARD_BAN?: string }): GuardConfig {
  return { ban: truthy(env.GUARD_BAN) }
}

export type LolsVerdict = 'banned' | 'clean' | 'unknown'

export interface JoinFacts {
  isBot: boolean
  lols: LolsVerdict
}

export interface JoinPlan {
  // чего хочет политика
  intent: 'skip' | 'pass' | 'ban'
  // что реально будет сделано с учётом рубильника
  effective: 'none' | 'ban'
  reason: string
}

export function planJoin(facts: JoinFacts, cfg: GuardConfig): JoinPlan {
  // Бота в чат добавляет только админ.
  if (facts.isBot) return { intent: 'skip', effective: 'none', reason: 'бот' }

  if (facts.lols === 'banned') {
    return {
      intent: 'ban',
      effective: cfg.ban ? 'ban' : 'none',
      reason: 'есть в базе спамеров LOLS',
    }
  }
  return {
    intent: 'pass',
    effective: 'none',
    reason: facts.lols === 'unknown' ? 'база спамеров не ответила' : 'нет в базе спамеров',
  }
}
