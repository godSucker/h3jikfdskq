#!/usr/bin/env python3
"""
Живой запрос активных процентов промо-акций через kartel-протокол (ABGetExperiments).

Проценты скидок (тех-центр, реактор, джекпот и т.п.) НЕ хранятся ни в одном
статичном XML с CDN, ни в самих date-фильтрах (см. fetch-filters.py) - игра
раздаёт их через инфраструктуру A/B-экспериментов: команда ABGetExperiments
возвращает список из ~85 экспериментов, каждый - {name, panels:[{name,percent}]}.
Активный вариант - тот, у которого percent==100 (сервер выбрал ровно один на
аккаунт). Для акционных экспериментов имя панели - это и есть процент строкой
("60", "80", ...), кроме "Default" (акция не идёт).

Найдено вручную 2026-09-22 при разборе "скидка на эво на день раньше" -
см. память auto-announcements-architecture.md. Механизм ПРОВЕРЕН на 2 разных
аккаунтах - оба вернули идентичный активный вариант для Mutants-Promo-TechCenter-
HC/SC, что больше похоже на общий live-ops переключатель, чем на честный
per-user A/B-сплит (иначе шанс совпадения на двух акках подряд был бы низким).
Тем не менее это ЖИВЫЕ данные с конкретного аккаунта, не публичная константа -
если когда-нибудь увидим расхождение между аккаунтами, эту гипотезу придётся
пересмотреть.

Отдаём ВСЕ эксперименты с числовой активной панелью (не только тех-центр) -
что делать с конкретным именем эксперимента решает потребитель (см.
scripts/kartel-promo-percents.ts). Не-числовые панели (feature-флаги вида
"on"/"Bundle001") и "Default" пропускаются - это не проценты.

Вход: тот же auth-блоб, что у fetch-filters.py (KARTEL_AUTH_BLOB_B64 или
--auth-file). Выход (stdout): {"fetchedAt": "...", "promos": {"<experiment
name>": <percent:int>, ...}}.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kartel_client import auth, load_auth_blob, send, synch_cmd  # noqa: E402


def extract_promos(response: dict) -> dict:
    for answer in response.get('answers', []):
        for item in answer.get('data', []):
            if isinstance(item, str) and '"experiments"' in item:
                obj = json.loads(item)
                if 'experiments' in obj:
                    out = {}
                    for exp in obj['experiments']:
                        name = exp.get('name')
                        if not name:
                            continue
                        active = next((p.get('name') for p in exp.get('panels', []) if p.get('percent') == 100), None)
                        if active is None or active == 'Default' or not active.isdigit():
                            continue
                        out[name] = int(active)
                    return out
    raise RuntimeError('ABGetExperiments response has no experiments[] - формат ответа изменился?')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-file', default=None, help='Локальный auth_request_fresh.bin (вместо KARTEL_AUTH_BLOB_B64)')
    args = parser.parse_args()

    blob = load_auth_blob(args.auth_file)
    uid = auth(blob)
    response = send(uid, [
        {'cmd': '$Hello', 'data': '1'},
        synch_cmd(),
        {'cmd': 'ABGetExperiments', 'data': '1'},
    ])
    promos = extract_promos(response)
    print(json.dumps({'fetchedAt': datetime.now(timezone.utc).isoformat(), 'promos': promos}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f'KARTEL_PROMO_ERROR: {e}', file=sys.stderr)
        sys.exit(1)
