#!/usr/bin/env python3
"""Живой запрос текущего PvP-сезона через kartel-протокол.

НАХОДКА 2026-11-22: номер сезона/окно/награды по рангу - НЕ через механизм
<Filter> (acceptFuturFilters), в отличие от дат офферов - у PvP нет записи
вида pvp_season_XX среди живых фильтров. Это отдельная команда батча kartel.ashx:
"getPvPInfo" (подтверждено и в бинаре - MutantsNetworkService::getPvPInfo(),
строка "getPvPInfo" среди cmds[] ответа $Hello - и живым запросом на проде).

Формат data: ОДНО целое число строкой ("1" - как у $Hello), НЕ JSON-объект -
сервер валит COMMAND_EXCEPTION на BaseTextSerializer.DeserializeFromString<Int32>,
если прислать что-то другое (проверено живьём). Смысл самого числа не найден
(не влияет на ответ при значениях 0/1 на тестовом аккаунте) - используется "1"
по аналогии с $Hello.

Ответ (сериализован короткими ключами, как и остальной kartel-протокол):
  CTID - номер текущего сезона/турнира
  ED   - ОСТАТОК в миллисекундах до конца сезона от момента запроса (не
         дотнет-эпоха, не абсолютная дата - эмпирически: 753056164.9463 на
         живом ответе 2026-11-22 ~14:00 UTC дало вменяемые ~8.72 суток, что
         совпадает с типичной длиной PvP-сезона; абсолютная интерпретация
         (дотнет-эпоха в мс или в секундах) даёт бессмысленные даты)
  LID  - лига игрока (этого аккаунта)
  PR   - очки/ранг игрока (этого аккаунта)
  TR   - награды по тирам ранга: [{"Key": tier, "Value": [{"Amount","Id","Type","tags"}]}]
         Key 0 - ниже Новичков (пусто). Key 1..5 - Новички/Ветераны/Эксперты/
         Элита/Магистры (пороги - PVP_LEAGUE_META в announcement-categories.ts,
         ФИКСИРОВАННЫЕ игровые константы, не приходят в этом ответе)
  pvpEnable - PvP сейчас активен

Проверено на Specimen_DE_11 (сезон 354, топ-тир): резолвится в "Дрей,
космический корги" (LEGEND) - разумная награда за высший ранг, подтверждает
интерпретацию.

LID/PR - состояние ЭТОГО аккаунта (фарм-бота), не глобальные - не публикуются,
только CTID/ED/TR/pvpEnable.

Auth - тот же auth_request_fresh.bin/KARTEL_AUTH_BLOB_B64, что у fetch-filters.py
(см. scripts/kartel/UPDATING-AUTH-BLOB.md).

Выход (stdout): {"fetchedAt": "...", "season": N, "endsAt": "...", "pvpEnable":
bool, "rewardTiers": [{"tier": N, "items": [{"amount": N, "id": "..."}]}]}
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from kartel_client import auth, load_auth_blob, send, synch_cmd  # noqa: E402


def extract_pvp_info(response: dict) -> dict:
    for answer in response.get('answers', []):
        for item in answer.get('data', []):
            if isinstance(item, str) and '"CTID"' in item and '"TR"' in item:
                return json.loads(item)
    raise RuntimeError('getPvPInfo response has no CTID/TR - формат ответа изменился?')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-file', default=None, help='Локальный auth_request_fresh.bin (вместо KARTEL_AUTH_BLOB_B64)')
    args = parser.parse_args()

    blob = load_auth_blob(args.auth_file)
    uid = auth(blob)
    # $Hello + synch в одном батче с getPvPInfo - так же, как fetch-filters.py
    # делает с getuser: отдельный send() на голую getPvPInfo без "разогрева"
    # сессии не проверялся, рисковать лишним протокольным сюрпризом незачем.
    now = datetime.now(timezone.utc)
    response = send(uid, [
        {'cmd': '$Hello', 'data': '1'},
        synch_cmd(),
        {'cmd': 'getPvPInfo', 'data': '1'},
    ])
    info = extract_pvp_info(response)

    reward_tiers = []
    for tier_entry in info.get('TR', []):
        items = [
            {'amount': it.get('Amount'), 'id': it.get('Id')}
            for it in tier_entry.get('Value', [])
            if it.get('Id')
        ]
        if items:
            reward_tiers.append({'tier': tier_entry.get('Key'), 'items': items})

    ed_ms = info.get('ED')
    ends_at = (now + timedelta(milliseconds=ed_ms)).isoformat() if isinstance(ed_ms, (int, float)) else None

    print(json.dumps(
        {
            'fetchedAt': now.isoformat(),
            'season': info.get('CTID'),
            'endsAt': ends_at,
            'pvpEnable': bool(info.get('pvpEnable')),
            'rewardTiers': reward_tiers,
        },
        ensure_ascii=False,
    ))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f'KARTEL_FETCH_ERROR: {e}', file=sys.stderr)
        sys.exit(1)
