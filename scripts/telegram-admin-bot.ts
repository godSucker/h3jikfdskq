// Отправка скриншотов новых анонсов в ЛИЧНЫЙ админ-чат (TELEGRAM_CHAT_ID) -
// не путать с scripts/telegram-cross-post.ts (публичный TELEGRAM_CHANNEL_ID,
// сейчас выключен CROSS_POST_ENABLED=false, Markdown-подписи). Вызывается из
// scripts/process-pending-screenshots.ts, см. память
// auto-announcements-architecture.md ("бот-скриншотер в админ-чат").
//
// НАМЕРЕННО без parse_mode: имена мутантов/боксов несут «»/_/*/[ (реальные
// живые примеры) - Markdown-парсинг Telegram падает на них 400-кой, а
// существующий кросс-пост в канал в такой ситуации ретраит ТОТ ЖЕ текст
// текстом и падает второй раз (см. postGenericCard в telegram-cross-post.ts).
// Простой текст этого класса ошибок не имеет вообще.
function getCreds() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) return null
  return { botToken, chatId }
}

export async function sendAdminText(text: string): Promise<void> {
  const creds = getCreds()
  if (!creds) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text }),
    })
    if (!res.ok) console.error('[ADMIN-BOT] sendMessage failed:', await res.text())
  } catch (err) {
    console.error('[ADMIN-BOT] sendMessage error:', err instanceof Error ? err.message : err)
  }
}

export async function sendAdminPhoto(
  buffer: Buffer,
  caption: string,
  filename: string,
): Promise<boolean> {
  const creds = getCreds()
  if (!creds) return false
  try {
    const form = new FormData()
    form.append('chat_id', creds.chatId)
    form.append('caption', caption)
    form.append('photo', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), filename)
    const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendPhoto`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      console.error('[ADMIN-BOT] sendPhoto failed:', await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('[ADMIN-BOT] sendPhoto error:', err instanceof Error ? err.message : err)
    return false
  }
}

export interface AdminPhoto {
  buffer: Buffer
  filename: string
}

// sendMediaGroup - multipart: media = JSON-массив {type:'photo', media:'attach://<field>'},
// сами байты идут ОТДЕЛЬНЫМИ полями формы с теми же именами. Подпись только
// на первом элементе - Telegram показывает её как общую подпись альбома.
// Требует 2-10 элементов (ограничение самого Telegram API) - вызывающий код
// (process-pending-screenshots.ts) обязан звать sendAdminPhoto вместо этого
// при одной фотографии.
export async function sendAdminMediaGroup(photos: AdminPhoto[], caption: string): Promise<boolean> {
  const creds = getCreds()
  if (!creds) return false
  if (photos.length < 2 || photos.length > 10) {
    console.error(`[ADMIN-BOT] sendMediaGroup: неверное число фото (${photos.length}), нужно 2-10`)
    return false
  }
  try {
    const form = new FormData()
    form.append('chat_id', creds.chatId)
    const media = photos.map((_p, i) => ({
      type: 'photo',
      media: `attach://photo${i}`,
      ...(i === 0 ? { caption } : {}),
    }))
    form.append('media', JSON.stringify(media))
    photos.forEach((p, i) => {
      form.append(
        `photo${i}`,
        new Blob([new Uint8Array(p.buffer)], { type: 'image/png' }),
        p.filename,
      )
    })
    const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMediaGroup`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      console.error('[ADMIN-BOT] sendMediaGroup failed:', await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('[ADMIN-BOT] sendMediaGroup error:', err instanceof Error ? err.message : err)
    return false
  }
}
