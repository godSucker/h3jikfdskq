#!/usr/bin/env python3
"""
Собирает auth_request_fresh.bin из capture-файла Frida-приёмника.

Проверенный путь захвата - kartel-receiver.py (дефолтный режим,
kartel-capture-all.js) из RE-тулинга ~/site-workspace/4443/. Он уже пишет
тело запроса на AuthService.ashx в mgg_dump/requests.jsonl (первая строка,
"url": "/AuthService.ashx", поле "hex" = сырой POST-body с маркером '$').
Отдельного .bin он НЕ пишет - этот скрипт его достаёт.

Формат тела 1-в-1 тот, что ждёт fetch-filters.py / mgg_client.py:
open(bin).read() -> decode(raw[1:]) -> zlib.decompress -> json.

Использование:
  python3 auth-blob-from-capture.py <requests.jsonl> [-o auth_request_fresh.bin] [--verify]

--verify: сразу прогнать fetch-filters.py --auth-file на получившемся блобе
(живой getuser у прода) и показать, сколько фильтров вернулось. Ставит
ненулевой код возврата, если блоб не подошёл.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xmz_codec import decode  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FETCH_FILTERS = os.path.join(HERE, 'fetch-filters.py')


def expected_fb_id() -> str | None:
    """FB-ID аккаунта, зашитый в uid-строку fetch-filters.py (поле :0:<FB_ID>:).
    Токен, полученный auth()'ом, действует на kartel.ashx ТОЛЬКО с FB-ID того
    же аккаунта - иначе kartel отвечает FAIL:AUTH_ERROR."""
    try:
        src = open(FETCH_FILTERS, 'r', encoding='utf-8').read()
    except OSError:
        return None
    m = re.search(r":0:(\d+):%s", src)
    return m.group(1) if m else None


def extract_auth_hex(jsonl_path: str) -> str:
    """Первая строка requests.jsonl с url, содержащим AuthService."""
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if 'AuthService' in str(rec.get('url', '')) and rec.get('hex'):
                return rec['hex']
    raise SystemExit(
        f'В {jsonl_path} нет записи с url ~ AuthService и полем hex. '
        f'Игра точно переавторизовалась во время захвата? (перезапусти игру при '
        f'работающем kartel-receiver.py)'
    )


def sanity_check(blob: bytes) -> None:
    if not blob or blob[0:1] not in (b'$', b'~'):
        raise SystemExit(
            f'Блоб не начинается с $/~ (первый байт {blob[:1]!r}) - похоже, hex кривой.'
        )
    dec, status = decode(blob[1:])
    if status != 'ok':
        raise SystemExit(f'xmz decode неуспешен: {status}')
    try:
        aj = json.loads(zlib.decompress(dec).decode('utf-8'))
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f'После decode+zlib не разобрался JSON: {e}')
    missing = [k for k in ('AccTok', 'DevID', 'User') if k not in aj]
    if missing:
        raise SystemExit(f'В auth JSON нет ожидаемых ключей: {missing}')
    print(f'[ok] auth JSON разобран, ключи: {sorted(aj)}')

    captured_fb = str(aj.get('User', {}).get('PlatformUserId') or '')
    expected_fb = expected_fb_id()
    if expected_fb and captured_fb and captured_fb != expected_fb:
        raise SystemExit(
            f'[FB-ID MISMATCH] захват сделан с аккаунта FB-ID {captured_fb}, а '
            f'fetch-filters.py ждёт {expected_fb} (строка ":0:{expected_fb}:%s"). '
            f'kartel.ashx отклонит токен как FAIL:AUTH_ERROR.\n'
            f'  -> либо перезахвати с аккаунта {expected_fb} (тот, что в текущем '
            f'секрете, autofarm2.py его же использует),\n'
            f'  -> либо, если осознанно меняешь аккаунт, поправь FB-ID в '
            f'fetch-filters.py на {captured_fb} и залей его секрет.'
        )
    if captured_fb:
        print(f'[ok] FB-ID захвата: {captured_fb}' + (' (совпал с fetch-filters.py)' if expected_fb == captured_fb else ''))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('jsonl', help='requests.jsonl от kartel-receiver.py')
    ap.add_argument('-o', '--out', default='auth_request_fresh.bin', help='куда писать .bin')
    ap.add_argument('--verify', action='store_true', help='прогнать fetch-filters.py на блобе')
    args = ap.parse_args()

    blob = bytes.fromhex(extract_auth_hex(args.jsonl))
    sanity_check(blob)
    with open(args.out, 'wb') as f:
        f.write(blob)
    print(f'[saved] {args.out} ({len(blob)} байт)')

    if args.verify:
        print('[verify] fetch-filters.py --auth-file ...')
        r = subprocess.run(
            [sys.executable, os.path.join(HERE, 'fetch-filters.py'), '--auth-file', args.out],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print(r.stderr.strip(), file=sys.stderr)
            raise SystemExit('[verify] блоб НЕ подошёл - см. ошибку выше, перезахвати.')
        out = json.loads(r.stdout)
        n = len(out.get('filters', {}))
        print(f'[verify] ok - сервер вернул {n} фильтров. Блоб рабочий, можно заливать секрет.')


if __name__ == '__main__':
    main()
