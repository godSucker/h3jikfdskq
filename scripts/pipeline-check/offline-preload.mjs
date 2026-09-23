// Подгружается в процесс build-announcements.ts через `tsx --import` (см.
// run.ts рядом) и подменяет сеть, НЕ трогая прод-код:
//   PIPELINE_CHECK_MODE=record - игровые XML качаются по-настоящему и
//     сохраняются в PIPELINE_CHECK_FIXTURES;
//   PIPELINE_CHECK_MODE=replay - те же ответы отдаются из сохранённого, любой
//     запрос без записи - ошибка (сценарий должен видеть ровно те же данные).
// Telegram (api.telegram.org) заглушён в обоих режимах: ни одно сообщение
// никуда не уходит, каждый такой вызов пишется в stderr для подсчёта.
import axios from 'axios'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const mode = process.env.PIPELINE_CHECK_MODE
const dir = process.env.PIPELINE_CHECK_FIXTURES
if (mode !== 'record' && mode !== 'replay')
  throw new Error('PIPELINE_CHECK_MODE must be record|replay')
if (!dir) throw new Error('PIPELINE_CHECK_FIXTURES is required')
fs.mkdirSync(dir, { recursive: true })

const fileFor = (url) =>
  path.join(dir, crypto.createHash('sha1').update(url).digest('hex') + '.txt')
const isTelegram = (url) => String(url).includes('api.telegram.org')
const realHttp = axios.getAdapter(['http'])

axios.defaults.adapter = async (config) => {
  const url = axios.getUri(config)
  const ok = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config, request: {} })
  if (isTelegram(url)) {
    process.stderr.write(
      `[pipeline-check] telegram call blocked: ${url.replace(/bot[^/]+/, 'bot***')}\n`,
    )
    return ok({ ok: true, result: {} })
  }
  const file = fileFor(url)
  if (mode === 'replay') {
    if (!fs.existsSync(file)) throw new Error(`[pipeline-check] no recorded response for ${url}`)
    return ok(fs.readFileSync(file, 'utf-8'))
  }
  const res = await realHttp({ ...config, responseType: 'text' })
  fs.writeFileSync(file, typeof res.data === 'string' ? res.data : JSON.stringify(res.data))
  process.stderr.write(`[pipeline-check] recorded ${url}\n`)
  return res
}

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (isTelegram(url)) {
    process.stderr.write(
      `[pipeline-check] telegram call blocked: ${url.replace(/bot[^/]+/, 'bot***')}\n`,
    )
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
  }
  if (mode === 'replay') throw new Error(`[pipeline-check] unexpected fetch() in replay: ${url}`)
  return realFetch(input, init)
}
