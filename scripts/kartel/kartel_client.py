#!/usr/bin/env python3
"""
Общий транспорт kartel-протокола: auth() (AuthService.ashx) + send() (kartel.ashx)
+ synch_cmd(). Вынесено из fetch-filters.py, чтобы fetch-promo-percents.py и
любой будущий разовый запрос ("что ещё отдаёт getuser/ABGetExperiments") не
дублировали протокольный код - см. auto-announcements-architecture.md.

Не содержит ничего специфичного для конкретной команды (getuser/
ABGetExperiments/...) - тот разбор ответа остаётся в вызывающем скрипте,
свой на каждую команду.
"""
import base64
import json
import os
import time
import uuid
import zlib
from datetime import datetime, timedelta, timezone

import requests

from xmz_codec import decode, encode_xmz  # noqa: E402

AUTH_URL = 'https://service-mutants.kobojo.com/AuthService.ashx'
KARTEL = 'https://service-mutants.kobojo.com/kartel.ashx'
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
            # FB-ID берём из самого блоба (aj['User']['PlatformUserId']), а не
            # хардкодим - токен от auth() валиден на kartel.ashx только с FB-ID
            # ТОГО ЖЕ аккаунта, с которого снят блоб (см. UPDATING-AUTH-BLOB.md,
            # "Аккаунт"). Так один и тот же скрипт работает на любом
            # захваченном .bin без правки кода под каждый акк.
            fb_id = aj.get('User', {}).get('PlatformUserId')
            if not fb_id:
                raise RuntimeError('auth blob has no User.PlatformUserId')
            return '%d:0:%s:%s' % (resp['UserId'], fb_id, resp['AuthToken'])
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
