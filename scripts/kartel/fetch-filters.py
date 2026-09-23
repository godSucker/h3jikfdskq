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
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kartel_client import auth, load_auth_blob, send, synch_cmd  # noqa: E402
from kartel_client import PSEUDO_DOTNET_EPOCH, decode_ms  # noqa: E402

SHOPITEMS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/shopitems.xml'
DUNGEONS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dungeon/dungeons.xml'
DAILYPOPUP_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/dailypopup.xml'
GAMEDEFS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gamedefinitions.xml'
MISSIONS_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/missions.xml'
GACHA_URL = 'https://s-beta.kobojo.com/mutants/gameconfig/gacha.xml'
# Обменники (см. scripts/build-announcements.ts::fetchHallContracts/
# fetchMysteryContracts) - ТОЛЬКО эти 3 EntityDescriptor, не весь
# gamedefinitions.xml (1.2МБ, сотни EntityDescriptor со своими Filter,
# в основном не про даты - блин расширение списка на "вообще все Filter из
# файла" в прошлый раз (9->201 имён из shopitems/dungeons/dailypopup) дало
# 3 волны регрессий, см. память auto-announcements-architecture). Точечный
# список - тот же принцип, что уже применён здесь ко всем остальным
# источникам (конкретные структурные контексты, не слепой скан).
GAMEDEFS_EXCHANGE_ENTITIES = ['Building_Tokens_Jackpot', 'Building_Event_1', 'Building_Mystery']


def _names_shopitems(text: str) -> list:
    out = []
    for item in re.findall(r'<ShopItem\b[^>]*>[\s\S]*?</ShopItem>', text):
        m_filter = re.search(r'<Filter>([^<]*)</Filter>', item)
        if m_filter and m_filter.group(1):
            out.append(m_filter.group(1))
    return out


def _names_dungeons(text: str) -> list:
    return [
        m.group(1)
        for m in re.finditer(r'<Dungeon id="[^"]+"[^>]*>[\s\S]{0,200}?<Filter>([^<]*)</Filter>', text)
    ]


def _names_dailypopup(text: str) -> list:
    return [m.group(1) for m in re.finditer(r'<Filter>([^<]*)</Filter>', text) if m.group(1)]


def _names_gamedefs(text: str) -> list:
    out = []
    for entity_id in GAMEDEFS_EXCHANGE_ENTITIES:
        m_block = re.search(
            rf'<EntityDescriptor id="{entity_id}"[^>]*>([\s\S]*?)</EntityDescriptor>', text
        )
        if not m_block:
            continue
        for m_filter in re.finditer(r'<Filter>([^<]*)</Filter>', m_block.group(1)):
            if m_filter.group(1):
                out.append(m_filter.group(1))
    return out


# Генераторы/реакторы (см. detectReactors в build-announcements.ts): окно
# ротации сервер отдаёт по фильтру gacha_pack_<id>. Имена берём из самого
# gacha.xml, а не из нашего списка - так новый генератор Kobojo попадёт в
# ответ сразу, и детектор сможет о нём хотя бы предупредить.
def _names_gacha(text: str) -> list:
    return ['gacha_pack_%s' % gacha_id for gacha_id in re.findall(r'<Gacha id="([^"]+)"', text)]


# Ивентовые цепочки заданий (scripts/build-event-quests.ts): по Filter-тегу
# цепочки kartel отдаёт окно ивента. Точечно - только миссии с
# <Tag key="missionStyle" value="events"/>, а не слепой скан всех 5400+
# миссий: слепое расширение списка уже давало три волны регрессий из-за
# переиспользованных тегов (см. память auto-announcements-architecture).
def _names_missions(text: str) -> list:
    out = []
    for mission in re.findall(r'<Mission [^>]*>[\s\S]*?</Mission>', text):
        if 'key="missionStyle" value="events"' not in mission:
            continue
        m_filter = re.search(r'<Filter>([^<]*)</Filter>', mission)
        if m_filter and m_filter.group(1):
            out.append(m_filter.group(1))
    return out


NAME_SOURCES = [
    ('shopitems', SHOPITEMS_URL, 30, _names_shopitems),
    ('dungeons', DUNGEONS_URL, 30, _names_dungeons),
    ('dailypopup', DAILYPOPUP_URL, 30, _names_dailypopup),
    ('gamedefinitions', GAMEDEFS_URL, 30, _names_gamedefs),
    ('gacha', GACHA_URL, 30, _names_gacha),
    ('missions', MISSIONS_URL, 60, _names_missions),
]


def fetch_all_filter_names() -> tuple:
    """Собирает ВСЕ <Filter> имена из игровых данных - не только daily-offer
    специмены (для дневных мутантов), но и ЛЮБой ShopItem (боксы -
    detectBoxes в build-announcements.ts джойнит по itemId->filter без
    ограничения на subCat/category), dungeons.xml (рейды/лесенки),
    dailypopup.xml (daily_news-баннеры), здания обменников, генераторы и
    ивентовые цепочки. Один live-filter-dates.json на выходе кормит ВСЕ
    детекторы разом (см. exactDateFor() в build-announcements.ts).

    Возвращает (имена, упавшие_источники). НАЙДЕНО (Opus 5.5 audit,
    2026-09-22): раньше сбой ЛЮБОГО из источников выкидывал ВСЕ имена разом
    (filters=[] и сервер отдавал свой авто-набор ~9 записей), а файл на выходе
    выглядел для guard'а hasLiveFilterData() полноценным - и мерж доверял
    fresh-null'ам. Теперь каждый источник независим: упавший попадает в
    failedSources (-> meta в выходе -> снимок "partial" в
    kartel-filter-dates.ts), остальные имена запрашиваются как обычно."""
    names: list = []
    failed: list = []
    for label, url, timeout, parse in NAME_SOURCES:
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            names.extend(parse(r.text))
        except Exception as e:  # noqa: BLE001
            print(f'WARNING: filter-name source {label} failed: {e}', file=sys.stderr)
            failed.append(label)

    # dedup, сохраняя порядок - дубли не проблема для сервера, но зачем слать лишнее
    seen = set()
    out = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out, failed


def extract_filters(response: dict) -> list:
    for answer in response.get('answers', []):
        for item in answer.get('data', []):
            if isinstance(item, str) and '"filters"' in item:
                obj = json.loads(item)
                if 'filters' in obj:
                    return obj['filters']
    raise RuntimeError('getuser response has no filters[] - формат ответа изменился?')


# НАХОДКА 2026-09-22: kartel в ОДНОМ ответе может вернуть ОДНО имя фильтра
# ДВАЖДЫ с разными датами - игра переиспользует Filter не только между
# спринтами (та проблема уже учтена окном сравнения в build-*.ts), но и внутри
# одного getuser-ответа сразу для двух разных циклов/офферов. Пример живьём
# (2026-09-22, 255 фильтров в ответе, 7 из них дублируются): Daily_news_tech_V2
# пришёл как {22-24 сент, ТЕКУЩИЙ} И {11-13 авг, старый} одновременно - именно
# он и был причиной "скидка на эво датируется на день позже": наивная
# перезапись `out[name] = ...` в порядке ответа брала последнюю запись, а она
# ВСЕГДА оказывалась более старой во всех 7 случаях (не гарантия на будущее,
# порядок ответа не документирован). Разруливаем по смыслу, а не по порядку:
# активная прямо сейчас запись побеждает всегда; если активной нет - берём ту,
# чей start ближе всего к текущему моменту (будущая ближайшая или самая
# недавняя прошедшая), а не что попало.
def pick_current(entries: list, now_ms: float) -> dict:
    def score(e):
        start, end = e.get('startDate'), e.get('endDate')
        if start is None or start == -1:
            return (2, float('inf'))
        if end is not None and end != -1 and start <= now_ms < end:
            return (0, 0.0)  # активна прямо сейчас - вне конкуренции
        return (1, abs(now_ms - start))

    return min(entries, key=score)


def summarize_filters(filters: list, now_ms: float) -> tuple:
    """Сырые filters[] ответа kartel -> ({имя: выбранное окно}, {имя: все окна})."""
    by_name: dict = {}
    for f in filters:
        name = f.get('name')
        if not name:
            continue
        by_name.setdefault(name, []).append(f)

    out = {}
    # Все вхождения переиспользуемых имён (только где их >1) - для резолвера
    # дат в scripts/date-resolver.ts: pick_current выбирает вхождение, не зная,
    # какое окно нужно потребителю (прогнозу нужен СВОЙ спринт, а не "ближайшее
    # к сейчас"). Поле аддитивное, `filters` ниже не меняется.
    occurrences = {}
    for name, entries in by_name.items():
        best = pick_current(entries, now_ms) if len(entries) > 1 else entries[0]
        start = decode_ms(best.get('startDate'))
        if start is None:
            continue  # startDate=-1 - не ротация/не запланировано, бесполезно для дат
        out[name] = {'start': start, 'end': decode_ms(best.get('endDate'))}
        if len(entries) > 1:
            occ = []
            for e in entries:
                s = decode_ms(e.get('startDate'))
                if s is not None:
                    occ.append({'start': s, 'end': decode_ms(e.get('endDate'))})
            if len(occ) > 1:
                occurrences[name] = occ

    return out, occurrences


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-file', default=None, help='Локальный auth_request_fresh.bin (вместо KARTEL_AUTH_BLOB_B64)')
    args = parser.parse_args()

    filter_names, failed_sources = fetch_all_filter_names()

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

    now_ms = (datetime.now(timezone.utc) - PSEUDO_DOTNET_EPOCH).total_seconds() * 1000
    out, occurrences = summarize_filters(filters, now_ms)

    # meta - для getLiveSnapshot() в kartel-filter-dates.ts: снимок с упавшими
    # источниками имён считается "partial", и мерж не доверяет его null'ам.
    meta = {
        'requestedCount': len(filter_names),
        'returnedCount': len(filters),
        'failedSources': failed_sources,
    }
    print(json.dumps(
        {
            'fetchedAt': datetime.now(timezone.utc).isoformat(),
            'filters': out,
            'occurrences': occurrences,
            'meta': meta,
        },
        ensure_ascii=False,
    ))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f'KARTEL_FETCH_ERROR: {e}', file=sys.stderr)
        sys.exit(1)
