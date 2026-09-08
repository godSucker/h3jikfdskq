#!/usr/bin/env python3
"""
Живой запрос точных дат офферов через kartel-протокол (см. память
auto-announcements-architecture.md - раздел "ПРОРЫВ: точные даты РЕШЕНЫ").

Статичные XML с CDN (shopitems.xml/dailypopup.xml) несут только номер
спринта (2-недельное окно) - точный день конкретного оффера внутри спринта
там не хранится нигде. Он решается сервером в реальном времени и доступен
только авторизованному игровому клиенту через getuser. Ключевой параметр -
"acceptFuturFilters": true - без него сервер отдаёт только УЖЕ начавшиеся
фильтры, с ним - весь график на 2+ недели вперёд разом.

Каждый Filter (`<Filter>Shop_xxx</Filter>` в shopitems.xml/dailypopup.xml/
dungeons) соответствует 1-в-1 записи filters[].name в ответе - прямой
join-ключ, без "Shop_"+itemId эвристик.

НАХОДКА 2026-09-08: параметр "filters" в getuser-запросе - это не просто
поле результата, это ЗАПРОШЕННЫЙ клиентом список имён (подтверждено в
Ghidra, TBMM::CmdParamApplicationUserFilters::serializeToJsonNode сериализует
вектор строк this+0x10..0x18 под ключом "filters"). Если слать пустой
массив (как раньше), сервер отдаёт только маленький авто-набор (~9 записей
Shop_Specimen_*). Если явно перечислить конкретные имена Shop_Specimen_* из
пула dailyoffer в shopitems.xml - сервер отдаёт РЕАЛЬНЫЕ даты для каждого
запрошенного имени, если оно уже "видимо" серверу (подтверждено на 25+
днях подряд назад без единого расхождения). Дальше некоторого горизонта
вперёд (~11 дней от сегодня на момент теста) сервер не отдаёт данные даже
по явному запросу - это НЕ ограничение параметра filters, а сам файл
shopitems.xml с CDN Kobojo (s-beta.kobojo.com) физически не содержит записи
дальше этого горизонта (проверено побайтовым сравнением свежескачанного
файла - не кэш/не устаревшая копия). s-dev/s-hom вообще не резолвятся для
game-data XML (только s-beta работает, как и everywhere else in this repo).

Формат дат: startDate/endDate - миллисекунды с псевдо-.NET-эпохи
0001-01-01T00:00:00 (не Unix ms, не .NET-тики) - подтверждено на 6+
независимых точках 2026-09-04.

Auth-блоб (auth_request_fresh.bin) живёт ~60 дней, дальше auth() начнёт
падать - см. .github/workflows/kartel-auth-reminder.yml (ежемесячное
напоминание в Telegram) + этот скрипт сам шлёт алерт при ошибке.

Вход: KARTEL_AUTH_BLOB_B64 (base64 сырого auth_request_fresh.bin) - секрет в
CI, либо --auth-file <path> для локального теста.
Выход (stdout): {"fetchedAt": "...", "filters": {"<name>": {"start": "...",
"end": "..."|null}, ...}}
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import uuid
import zlib
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xmz_codec import encode_xmz, decode  # noqa: E402

AUTH_URL = 'https://service-mutants.kobojo.com/AuthService.ashx'
KARTEL = 'https://service-mutants.kobojo.com/kartel.ashx'
SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
DUNGEONS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dungeon/dungeons.xml'
DAILYPOPUP_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dailypopup.xml'
PSEUDO_DOTNET_EPOCH = datetime(1, 1, 1, tzinfo=timezone.utc)


def decode_ms(value: int):
    if value is None or value == -1:
        return None
    return (PSEUDO_DOTNET_EPOCH + timedelta(milliseconds=value)).isoformat()


def load_auth_blob(auth_file: str | None) -> bytes:
    b64 = os.environ.get('KARTEL_AUTH_BLOB_B64')
    if b64:
        return base64.b64decode(b64)
    if auth_file:
        return open(auth_file, 'rb').read()
    raise RuntimeError('Ни KARTEL_AUTH_BLOB_B64, ни --auth-file не заданы')


def auth(blob: bytes, retries: int = 3) -> str:
    dec, status = decode(blob[1:])
    if status != 'ok':
        raise RuntimeError(f'auth blob decode failed: {status}')
    dec = zlib.decompress(dec)
    aj = json.loads(dec.decode('utf-8'))
    last_err = None
    for attempt in range(retries):
        aj['DevID'] = str(uuid.uuid4())
        try:
            payload = b'$' + encode_xmz(
                zlib.compress(json.dumps(aj, separators=(',', ':')).encode('utf-8')).decode('latin-1').encode('latin-1'),
                marker=b'$',
            )[1:]
            r = requests.post(
                AUTH_URL, data=payload,
                headers={'Content-Type': 'application/octet-stream'}, timeout=60,
            )
            d2, st2 = decode(r.content[1:])
            if st2 != 'ok':
                raise RuntimeError(f'auth response decode failed: {st2}')
            d2 = zlib.decompress(d2)
            resp = json.loads(d2.decode('utf-8').split('T4RT1FL3773')[0])
            return '%d:0:109526704649610:%s' % (resp['UserId'], resp['AuthToken'])
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(3)
    raise RuntimeError(f'auth failed after {retries} attempts: {last_err}')


def synch_cmd() -> dict:
    return {
        'cmd': 'synch',
        'data': json.dumps({
            'action': 'connect', 'binVersion': 76, 'locale': 'en',
            'osId': 2, 'publish': True, 'username': 'FarmBot', 'version': 803,
        }, separators=(',', ':')) + '\n',
    }


def send(uid: str, queries: list, retries: int = 3) -> dict:
    req = {'ack': 0, 'idx': 0, 'key': 0, 'queries': queries, 'stamp': 56000000, 'userId': uid}
    j = json.dumps(req, separators=(',', ':')) + '\nT4RT1FL3773'
    enc = b'\x63\x00' + encode_xmz(j.encode(), marker=b'~')
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.post(KARTEL, data=enc, headers={'Content-Type': 'application/octet-stream'}, timeout=60)
            d = r.content
            if d[:2] == b'\x63\x00':
                d = d[2:]
            if d[:1] in (b'$', b'~'):
                d = d[1:]
            dec, status = decode(d)
            if status != 'ok':
                raise RuntimeError(f'kartel response decode failed: {status}')
            if dec[:2] in (b'\x78\xda', b'\x78\x9c'):
                dec = zlib.decompress(dec)
            text = dec.decode('utf-8', 'ignore').split('T4RT1FL3773')[0].strip()
            if text.startswith('{'):
                return json.loads(text)
            raise RuntimeError(f'unexpected non-JSON response: {text[:200]!r}')
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(3)
    raise RuntimeError(f'send failed after {retries} attempts: {last_err}')


def fetch_all_filter_names() -> list:
    """Собирает ВСЕ <Filter> имена из трёх источников игровых данных - не
    только daily-offer специмены (для дневных мутантов), но и ЛЮБой ShopItem
    (боксы - detectBoxes в build-announcements.ts джойнит по itemId->filter
    без ограничения на subCat/category), dungeons.xml (рейды/лесенки -
    detectRaids/detectLadders) и dailypopup.xml (daily_news-баннеры). Один
    live-filter-dates.json на выходе кормит ВСЕ детекторы разом - они уже
    умеют читать его (см. exactDateFor() в build-announcements.ts), не
    хватало только явного запроса нужных имён (см. комментарий выше)."""
    names: list[str] = []

    r = requests.get(SHOPITEMS_URL, timeout=30)
    r.raise_for_status()
    for item in re.findall(r'<ShopItem\b[^>]*>[\s\S]*?</ShopItem>', r.text):
        m_filter = re.search(r'<Filter>([^<]*)</Filter>', item)
        if m_filter and m_filter.group(1):
            names.append(m_filter.group(1))

    r = requests.get(DUNGEONS_URL, timeout=30)
    r.raise_for_status()
    for m in re.finditer(r'<Dungeon id="[^"]+"[^>]*>[\s\S]{0,200}?<Filter>([^<]*)</Filter>', r.text):
        names.append(m.group(1))

    r = requests.get(DAILYPOPUP_URL, timeout=30)
    r.raise_for_status()
    for m_filter in re.finditer(r'<Filter>([^<]*)</Filter>', r.text):
        if m_filter.group(1):
            names.append(m_filter.group(1))

    # dedup, сохраняя порядок - дубли не проблема для сервера, но зачем слать лишнее
    seen = set()
    out = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def extract_filters(response: dict) -> list:
    for answer in response.get('answers', []):
        for item in answer.get('data', []):
            if isinstance(item, str) and '"filters"' in item:
                obj = json.loads(item)
                if 'filters' in obj:
                    return obj['filters']
    raise RuntimeError('getuser response has no filters[] - формат ответа изменился?')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-file', default=None, help='Локальный auth_request_fresh.bin (вместо KARTEL_AUTH_BLOB_B64)')
    args = parser.parse_args()

    try:
        filter_names = fetch_all_filter_names()
    except Exception as e:  # noqa: BLE001
        print(f'WARNING: filter-name fetch failed, falling back to empty filters[]: {e}', file=sys.stderr)
        filter_names = []

    blob = load_auth_blob(args.auth_file)
    uid = auth(blob)
    response = send(uid, [
        {'cmd': '$Hello', 'data': '1'},
        synch_cmd(),
        {
            'cmd': 'getuser',
            'data': json.dumps(
                {'UserOs': 2, 'acceptFuturFilters': True, 'filters': filter_names, 'userId': int(uid.split(':')[0])},
                separators=(',', ':'),
            ) + '\n',
        },
    ])
    filters = extract_filters(response)

    out = {}
    for f in filters:
        name = f.get('name')
        if not name:
            continue
        start = decode_ms(f.get('startDate'))
        if start is None:
            continue  # startDate=-1 - не ротация/не запланировано, бесполезно для дат
        out[name] = {'start': start, 'end': decode_ms(f.get('endDate'))}

    print(json.dumps({'fetchedAt': datetime.now(timezone.utc).isoformat(), 'filters': out}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f'KARTEL_FETCH_ERROR: {e}', file=sys.stderr)
        sys.exit(1)
