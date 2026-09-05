# Обновление `auth_request_fresh.bin` (секрет `KARTEL_AUTH_BLOB_B64`)

Инструкция на случай, когда меня нет рядом. Занимает ~15 минут, из них
большая часть — поднять телефон с Frida.

## Что это и зачем

`scripts/kartel/fetch-filters.py` дергает живой `getuser` у сервера MGG, чтобы
достать точные даты старта офферов магазина / «скоро в игре» (в статичных
XML с CDN этих дат нет — их решает сервер в реальном времени). Пайплайн
`announcements-hourly.yml`, шаг 9.5, гоняет этот скрипт каждый час.

Для авторизации скрипт берёт **`auth_request_fresh.bin`** — это перехваченное
тело POST-запроса, который игровой клиент шлёт на `AuthService.ashx` при
старте. Внутри — XMZ+zlib(JSON) с данными аккаунта фарм-бота (level 234,
`mgg_dump/`). Скрипт его декодирует, подставляет свежий `DevID`, заново
кодирует и отправляет — получает одноразовый `UserId:AuthToken`.

Блоб живёт **~60 дней**. Дальше `auth()` начинает падать. Два сигнала:

- **Активный алерт**: `announcements-hourly.yml` шаг 9.6 шлёт в личный чат
  `🔴 Kartel-фильтры: не удалось получить живые точные даты…` при первом же
  сбое шага 9.5.
- **Проактивное напоминание**: `kartel-auth-reminder.yml` — cron 1-го числа
  каждого месяца, шлёт в чат готовую команду заливки.

Пока блоб протух, ничего не «ломается» — прогноз магазина продолжает
показывать диапазон всего спринта (2 недели) без точных дней. Чинить не
срочно, но лучше в течение недели.

## Что понадобится

- Рутованный Android-телефон с установленной MGG (тот же аккаунт-фарм-бот).
- `frida-server` на телефоне (бинарь уже лежал в `~` телефона в прошлых
  сессиях; если нет — скачать под нужный ABI с github.com/frida/frida/releases).
- На ПК: `pip install frida-tools requests`.
- Рабочая копия `/home/godbtw/site-workspace/4443/` (RE-тулинг, НЕ в этом репо).
- `gh` CLI, залогиненный под аккаунтом с доступом к репо `godSucker/h3jikfdskq`.

## Шаги

### 1. Поднять Frida на телефоне

```bash
# на телефоне (adb shell или напрямую)
su -c '/data/local/tmp/frida-server -D &'
```

С ПК проверить связь и найти PID игры (телефон и ПК в одной сети,
27042 — дефолтный порт frida-server):

```bash
frida-ps -H <IP_ТЕЛЕФОНА>:27042 | grep -i mutant
# пример вывода:  12345  com.kobojo.mutantsgeneticgladiators
```

> Игра **должна быть запущена** — PID нужен живой. Если игра вылетала по сети,
> PID мог смениться: перепроверять `frida-ps` перед каждым заходом, не
> полагаться на старый.

### 2. Запустить приёмник захвата

```bash
cd /home/godbtw/site-workspace/4443
python3 receiver.py <IP_ТЕЛЕФОНА>:27042 <PID> capture_auth_binary.js
```

`capture_auth_binary.js` хукает `SSL_write` в `libmutants_android_game.so` и
ловит тело POST на `AuthService.ashx`. Скрипт печатает
`=== AUTH BINARY CAPTURE ===` и ждёт.

### 3. Заставить игру переавторизоваться

Тело `AuthService.ashx` уходит **только при свежем логине**. Проще всего:

- полностью закрыть игру (свайпнуть из недавних), затем открыть заново; **или**
- Настройки Android → Приложения → Mutants → Остановить, затем открыть; **или**
- если не помогло — очистить данные игры и залогиниться через Facebook заново
  (крайний случай, придётся заново принимать туториал-экран).

Как только клиент дошёл до авторизации, в приёмнике появится:

```
========== AUTH BODY CAPTURED ==========
[SIZE] 560 bytes
[FIRST_BYTE] 0x24 ($)
[SENT] Binary hex to receiver
[SAVED] auth_request_fresh.bin (560 bytes)
```

Файл лёг в `/home/godbtw/site-workspace/4443/mgg_dump/auth_request_fresh.bin`.
Останавливаем приёмник: `Ctrl+C` (или `kill -TERM <pid>`).

Здоровый блоб — **~430–600 байт**, первый байт `0x24` (`$`) или `0x7e` (`~`).
Если размер вроде 50 байт или первый байт другой — захват кривой, повторить
шаг 3.

### 4. Проверить блоб ЛОКАЛЬНО до заливки

Не заливать вслепую. `fetch-filters.py` умеет читать блоб из файла:

```bash
cd /home/godbtw/site-workspace/mutants_site
python3 scripts/kartel/fetch-filters.py \
  --auth-file /home/godbtw/site-workspace/4443/mgg_dump/auth_request_fresh.bin
```

**Хорошо** — на stdout JSON вида
`{"fetchedAt": "...", "filters": {"Shop_...": {"start": "2026-...", "end": ...}, ...}}`
с десятками фильтров.

**Плохо** — в stderr `KARTEL_FETCH_ERROR: auth failed after 3 attempts…`.
Значит блоб не подошёл (кривой захват / не тот аккаунт / сервер поменял
протокол). Вернуться к шагу 3; если повторяется — писать мне.

### 5. Залить как секрет

```bash
base64 -w0 /home/godbtw/site-workspace/4443/mgg_dump/auth_request_fresh.bin \
  | gh secret set KARTEL_AUTH_BLOB_B64 --repo godSucker/h3jikfdskq
```

(`-w0` обязателен — без него base64 переносит строки, секрет ломается.)

### 6. Подтвердить на CI

```bash
gh workflow run announcements-hourly.yml --repo godSucker/h3jikfdskq
# подождать ~2 мин, затем:
gh run list --workflow=announcements-hourly.yml --limit 1 --repo godSucker/h3jikfdskq
gh run view <RUN_ID> --log --repo godSucker/h3jikfdskq | grep -A3 "9.5 Живые точные даты"
```

Шаг 9.5 зелёный и без `KARTEL_FETCH_ERROR`, шаг 9.6 (алерт) **пропущен** —
значит всё поднялось. В течение следующих прогонов `notifyNewExactDates`
дошлёт в чат вновь раскрывшиеся даты живого спринта.

## Если офсеты в Frida-скрипте протухли

`capture_auth_binary.js` хардкодит адрес `SSL_write` (`base.add(0xb22368)`)
под конкретную версию `libmutants_android_game.so` (v76-802-172880). После
крупного апдейта игры адрес сдвинется — захват просто ничего не поймает
(приёмник висит, `AUTH BODY CAPTURED` не появляется).

Тогда:

1. Вытащить свежий `libmutants_android_game.so` из APK
   (`unzip -o base.apk 'lib/arm64-v8a/*'`).
2. Найти экспорт `SSL_write`:
   `nm -D --defined-only lib/arm64-v8a/libmutants_android_game.so | grep -i ssl_write`
   — взять его offset, подставить в `Interceptor.attach(base.add(0xXXXX), …)`
   в `capture_auth_binary.js` (и в `frida_auth_hook.js`, где тот же адрес).
3. Альтернатива без ручного поиска — `frida_capture_full_auth.js` в `4443/`
   резолвит по имени модуля/символа динамичнее; можно попробовать его как
   `python3 receiver.py <IP>:PORT <PID> frida_capture_full_auth.js`.

## Файлы

| Что | Где |
|-----|-----|
| Потребитель блоба (в этом репо) | `scripts/kartel/fetch-filters.py` |
| CI-шаги 9.5 / 9.6 | `.github/workflows/announcements-hourly.yml` |
| Месячное напоминание | `.github/workflows/kartel-auth-reminder.yml` |
| Frida-скрипт захвата | `~/site-workspace/4443/capture_auth_binary.js` |
| Приёмник | `~/site-workspace/4443/receiver.py` |
| Куда падает свежий блоб | `~/site-workspace/4443/mgg_dump/auth_request_fresh.bin` |
| Референс-клиент (auth+send целиком) | `~/site-workspace/4443/mgg_client.py` |
