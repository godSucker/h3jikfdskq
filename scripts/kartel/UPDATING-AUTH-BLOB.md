# Обновление `auth_request_fresh.bin` (секрет `KARTEL_AUTH_BLOB_B64`)

Инструкция на случай, когда меня нет рядом. ~15 минут, из них большая часть -
поднять телефон с Frida.

## Что это и зачем

`scripts/kartel/fetch-filters.py` дёргает живой `getuser` у сервера MGG, чтобы
достать точные даты старта офферов магазина / «скоро в игре» (в статичных XML
с CDN этих дат нет). Пайплайн `announcements-hourly.yml`, шаг 9.5, гоняет его
каждый час.

Для авторизации скрипт берёт **`auth_request_fresh.bin`** - перехваченное
тело POST-запроса, который игровой клиент шлёт на `AuthService.ashx` при
старте. Внутри - XMZ+zlib(JSON) с `AccTok` / `DevID` / `User` аккаунта
фарм-бота. Скрипт декодирует, подставляет свежий `DevID`, заново кодирует,
отправляет - получает одноразовый `UserId:AuthToken`, потом `getuser` на
`kartel.ashx`.

Блоб живёт **~60 дней** (истекает `AccTok`). Сигналы протухания:

- **Активный алерт**: `announcements-hourly.yml` шаг 9.6 шлёт в личный чат
  `🔴 Kartel-фильтры: не удалось получить живые точные даты…` при первом сбое.
- **Проактивное напоминание**: `kartel-auth-reminder.yml` - 1-го числа каждого
  месяца.

Пока протух - ничего не «ломается»: прогноз показывает диапазон всего спринта
(2 недели) без точных дней. Чинить не срочно, но в течение недели.

## ⚠️ Привязка к аккаунту (важно!)

`fetch-filters.py` строку 88 хардкодит FB-ID аккаунта:

```python
return '%d:0:109526704649610:%s' % (resp['UserId'], resp['AuthToken'])
```

Токен, полученный `auth()`, работает на `kartel.ashx` **только с FB-ID того же
аккаунта**, с которого снят блоб. Снимешь с другого аккаунта - `kartel.ashx`
ответит `FAIL:AUTH_ERROR`, даже если `auth()` прошёл.

**Захватывать с аккаунта `109526704649610`** (тот, что в текущем секрете;
`~/site-workspace/4443/autofarm2.py` использует его же). Если осознанно
меняешь аккаунт - поправь FB-ID в `fetch-filters.py:88` под новый (его
`User.PlatformUserId` из блоба; `auth-blob-from-capture.py` его печатает).

## Что понадобится

- Рутованный Android с MGG (аккаунт `109526704649610`).
- `frida-server` на телефоне (бинарь лежал в `/data/local/tmp/` в прошлых
  сессиях; иначе - github.com/frida/frida/releases под нужный ABI).
- На ПК: `pip install frida-tools requests`.
- RE-тулинг `~/site-workspace/4443/` (там `kartel-receiver.py` +
  `kartel-capture-all.js` - проверенный годами путь захвата).
- `gh` CLI, залогинен с доступом к `godSucker/h3jikfdskq`.

## Шаги

### 1. Поднять Frida на телефоне

```bash
# на телефоне
su -c '/data/local/tmp/frida-server -D &'
```

С ПК - найти PID работающей игры (телефон и ПК в одной сети):

```bash
frida-ps -H <IP_ТЕЛЕФОНА>:27042 | grep -i mutant
#  12345  com.kobojo.mutantsgeneticgladiators
```

> Игра должна быть запущена. Вылетала по сети - PID мог смениться,
> перепроверяй `frida-ps` перед каждым заходом.

### 2. Запустить проверенный приёмник захвата

```bash
cd ~/site-workspace/4443
python3 kartel-receiver.py <IP_ТЕЛЕФОНА>:27042 <PID>
```

Дефолтный режим = `kartel-capture-all.js`, хукает `SSL_write` в
`libmutants_android_game.so`, пишет **все** kobojo-запросы (kartel + auth) в
`mgg_dump/requests.jsonl`. Отдельного `auth_request_fresh.bin` он НЕ пишет -
его достаёт скрипт из шага 4.

Останавливать: `Ctrl+C` (или `kill -TERM <pid>`), дождаться `summary.json`.

> ⚠️ НЕ путать с `4443/receiver.py` - у него дефолтный скрипт
> `capture-string-decrypt.js`, которого в папке нет, он не загрузится.
> Рабочий - именно `kartel-receiver.py`.

### 3. Заставить игру переавторизоваться

Тело `AuthService.ashx` уходит только при свежем логине. Пока
`kartel-receiver.py` работает:

- полностью закрыть игру (свайп из недавних) и открыть заново; **или**
- Настройки Android → Приложения → Mutants → Остановить, затем открыть; **или**
- крайний случай: очистить данные игры и залогиниться через Facebook заново.

В `requests.jsonl` первой же строкой должна появиться запись с
`"url": "/AuthService.ashx"` и полем `"hex"` (~430-600 «байт» в `size`).

### 4. Собрать `.bin` из захвата и проверить

```bash
cd ~/site-workspace/mutants_site
python3 scripts/kartel/auth-blob-from-capture.py \
  ~/site-workspace/4443/mgg_dump/requests.jsonl \
  -o /tmp/auth_request_fresh.bin --verify
```

Скрипт:

1. достаёт `AuthService.ashx`-запись из `requests.jsonl`, пишет `hex` как байты;
2. **sanity-check**: маркер `$`/`~`, xmz-decode + zlib + JSON, ключи
   `AccTok`/`DevID`/`User`;
3. **FB-ID check**: сверяет `User.PlatformUserId` из блоба с зашитым в
   `fetch-filters.py` - при расхождении падает с понятным сообщением ДО сети;
4. `--verify`: гоняет `fetch-filters.py --auth-file` на блобе (живой `getuser`
   у прода). Печатает `ok - сервер вернул N фильтров` = блоб рабочий.

Любой из чеков упал → чини по сообщению (чаще всего: захват с не того
аккаунта, или игра не переавторизовалась - в `requests.jsonl` нет
AuthService), не заливай секрет.

### 5. Залить секрет

```bash
base64 -w0 /tmp/auth_request_fresh.bin \
  | gh secret set KARTEL_AUTH_BLOB_B64 --repo godSucker/h3jikfdskq
```

(`-w0` обязателен - иначе base64 переносит строки, секрет ломается.)

### 6. Подтвердить на CI

```bash
gh workflow run announcements-hourly.yml --repo godSucker/h3jikfdskq
sleep 120
gh run list --workflow=announcements-hourly.yml --limit 1 --repo godSucker/h3jikfdskq
gh run view <RUN_ID> --log --repo godSucker/h3jikfdskq | grep -A3 "9.5 Живые точные даты"
```

Шаг 9.5 зелёный без `KARTEL_FETCH_ERROR`, шаг 9.6 (алерт) пропущен = поднялось.
В следующих часовых прогонах `notifyNewExactDates` дошлёт в чат вновь
раскрывшиеся точные даты живого спринта.

## Если Frida-хук перестал ловить (апдейт игры)

`kartel-capture-all.js` хардкодит адрес `SSL_WRITE = 0xb22368` под версию
`libmutants_android_game.so` v76-802-172880. После крупного апдейта адрес
сдвинется - `requests.jsonl` останется пустым.

1. Вытащить свежий `.so`: `unzip -o base.apk 'lib/arm64-v8a/*'`.
2. `nm -D --defined-only lib/arm64-v8a/libmutants_android_game.so | grep -i ssl_write`
   - взять offset, подставить в `SSL_WRITE` в `kartel-capture-all.js` (и в
   `CURL_CLIENT_WRITE`/`CURL_EASY_SETOPT` по аналогии, если поехали и они).

## Файлы

| Что | Где |
|-----|-----|
| Потребитель блоба (этот репо) | `scripts/kartel/fetch-filters.py` (FB-ID на стр. 88) |
| Сборка `.bin` из захвата (этот репо) | `scripts/kartel/auth-blob-from-capture.py` |
| CI-шаги 9.5 / 9.6 | `.github/workflows/announcements-hourly.yml` |
| Месячное напоминание | `.github/workflows/kartel-auth-reminder.yml` |
| Проверенный приёмник захвата | `~/site-workspace/4443/kartel-receiver.py` |
| Frida-скрипт захвата | `~/site-workspace/4443/kartel-capture-all.js` |
| Куда пишется захват | `~/site-workspace/4443/mgg_dump/requests.jsonl` |
| Референс-клиент (auth+send целиком) | `~/site-workspace/4443/mgg_client.py` |
