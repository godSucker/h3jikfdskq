#!/usr/bin/env python3
# Черновой план публикации постеров боксов в Telegram: группы, порядок, подписи, теги.
# Ничего не отправляет. Запуск: python3 scripts/plan-box-posts.py > plan.md
import json, re, sys, collections

boxes = json.load(open('src/data/boxes.json'))
by_id = {b['itemId']: b for b in boxes}

GENES = [  # (подстрока в itemId.lower(), название гена, тег)
    ('prime', None, None),  # служебная, см. ниже
]
GENE_DEFS = [
    ('cyber', 'Кибер', '#кибер'),
    ('saber', 'Рубака', '#рубака'),
    ('mythic', 'Мифики', '#мифики'),
    ('mystic', 'Мифики', '#мифики'),
    ('zoo', 'Зооморф', '#зооморф'),
    ('galactic', 'Галактика', '#галактика'),
    ('necro', 'Мертвяк', '#мертвяк #зомби'),
    ('space', 'Галактика', '#галактика'),
]
EXPLICIT_GENE = {'LuckyBox_Legendary_1': 'Кибер'}  # id без слова-гена, по названию это киберконтейнер


def year_of(i):
    m = re.search(r'(20\d\d)', i)
    if m:
        return int(m.group(1))
    m = re.search(r'(?:xmas|winter|valentines|easter|anniversary|halloween|spring|summer)(\d\d)(?:_|$)', i.lower())
    if m:
        return 2000 + int(m.group(1))
    m = re.search(r'(?:xmas|mystery_box_xmas|winter|anniversary|valentines|easter|halloween)(\d\d)', i.lower())
    if m:
        return 2000 + int(m.group(1))
    m = re.search(r'_(\d\d)$', i)
    if m and int(m.group(1)) >= 16:
        return 2000 + int(m.group(1))
    return None


def tier_rank(i):
    l = i.lower()
    if 'prime' in l:
        return 0
    if 'elite' in l:
        return 1
    if re.search(r'_v\d', l):
        return 3
    return 2


def roman(s):
    vals = {'I': 1, 'V': 5, 'X': 10}
    t = 0
    for a, b in zip(s, s[1:] + ' '):
        v = vals.get(a, 0)
        t += -v if vals.get(b, 0) > v else v
    return t


groups = collections.OrderedDict()  # (раздел, подраздел) -> [box]
order_keys = []


def put(section, sub, b, sortkey):
    key = (section, sub)
    if key not in groups:
        groups[key] = []
        order_keys.append(key)
    groups[key].append((sortkey, b))


for b in boxes:
    i = b['itemId']
    l = i.lower()
    name = b['name']
    y = year_of(i)

    if i in EXPLICIT_GENE:
        put('1. Контейнеры по генам', EXPLICIT_GENE[i], b, (tier_rank(i), i))
        continue
    gene = None
    if 'cyberweek' not in l and 'xmas' not in l:
        for sub, gname, tag in GENE_DEFS:
            if sub in l:
                gene = gname
                break
    if gene and not l.startswith('mysterybox_ability'):
        put('1. Контейнеры по генам', gene, b, (tier_rank(i), i))
    elif l.startswith('mysterybox_ability'):
        put('2. Усиленные по способностям', '', b, (0, i))
    elif 'research' in l or 'bingo' in l:
        m = re.search(r'Исследование\s+([IVX]+)', name)
        put('3. Сундуки «Исследование»', '', b, (roman(m.group(1)) if m else 99, i))
    elif 'heroic' in l or 'golden_heroic' in l:
        gold = 0 if 'gold' in l else (1 if 'mysterybox' in l else 2)
        m = re.search(r'Heroic_(\d+)_(\d+)', i)
        put('4. Контейнеры героя', '', b, (gold, int(m.group(2)) if m else 0, int(m.group(1)) if m else 0))
    elif re.search(r'mystery_box_.*_elite', l):
        put('5. Случайные элитные мутанты', '', b, (0, i))
    elif re.match(r'lucky_box_\d$', l) or l.startswith('mysterybox_2021') or l == 'lucky_box_basic_1':
        put('6. Тайное мутобезумие', '', b, (0, i))
    elif any(k in l for k in ['legend_gold', 'legend_bronze', 'starter', 'tank', 'speed', 'hyperheavy', 'girls', 'zodiac', 'basic_v3']):
        put('7. Постоянные особые', '', b, (0 if 'legend' in l else 1, i))
    elif any(k in l for k in ['halloween', 'plague']):
        put('8. События', 'Хэллоуин', b, (-(y or 0), i))
    elif 'valentines' in l:
        put('8. События', 'День святого Валентина', b, (-(y or 0), i))
    elif 'easter' in l:
        put('8. События', 'Пасха', b, (-(y or 0), i))
    elif 'anniversary' in l:
        put('8. События', 'Юбилейные', b, (-(y or 0), i))
    elif any(k in l for k in ['xmas', 'winter']):
        put('8. События', 'Зима и Рождество', b, (-(y or 0), i))
    elif y or any(k in l for k in ['mystery_', 'luckybox_summer', 'luckybox_independence', 'memorial', 'april', 'weirdtech', 'science']):
        put('8. События', 'Прочие события', b, (-(y or 0), i))
    else:
        put('9. Прочее и ресурсные', '', b, (0, i))

# --- подписи и теги
TYPE_TAG = {'Лаки-бокс': '#лакибокс', 'Мистери-бокс': '#мистерибокс'}
SECTION_TAG = {
    '2. Усиленные по способностям': '#усиленные',
    '3. Сундуки «Исследование»': '#исследование',
    '4. Контейнеры героя': '#герой',
    '5. Случайные элитные мутанты': '#элитные',
    '6. Тайное мутобезумие': '#мутобезумие',
    '7. Постоянные особые': '#особые',
    '9. Прочее и ресурсные': '#прочее',
}
SUB_TAG = {
    'Хэллоуин': '#хэллоуин', 'День святого Валентина': '#валентин', 'Пасха': '#пасха',
    'Юбилейные': '#юбилей', 'Зима и Рождество': '#зима', 'Прочие события': '#события',
}
GENE_TAG = {g: t for _, g, t in GENE_DEFS}

BROKEN = {  # название в данных явно битое/подозрительное, нужно решение
}


def mutant_name_of(b):
    for g in b['groups']:
        for m in g['mutants']:
            return m['name']
    return None


CAP_COUNT = collections.Counter()
for _b in boxes:
    pass


SEC_HEAD = {
    '1. Контейнеры по генам': '🧬 КОНТЕЙНЕРЫ ПО ГЕНАМ',
    '2. Усиленные по способностям': '💥 УСИЛЕННЫЕ КОНТЕЙНЕРЫ ПО СПОСОБНОСТЯМ',
    '3. Сундуки «Исследование»': '🔬 СУНДУКИ «ИССЛЕДОВАНИЕ»',
    '4. Контейнеры героя': '🦸 КОНТЕЙНЕРЫ ГЕРОЯ',
    '5. Случайные элитные мутанты': '⭐ СЛУЧАЙНЫЕ ЭЛИТНЫЕ МУТАНТЫ',
    '6. Тайное мутобезумие': '🎲 ТАЙНОЕ МУТОБЕЗУМИЕ',
    '7. Постоянные особые': '🏆 ПОСТОЯННЫЕ ОСОБЫЕ КОНТЕЙНЕРЫ',
    '8. События': '🎉 СОБЫТИЯ И ПРАЗДНИКИ',
    '9. Прочее и ресурсные': '📦 ПРОЧЕЕ И РЕСУРСНЫЕ',
}


def price_str(p):
    if not p:
        return ''
    a = f"{p['amount']:,}".replace(',', ' ')
    return f"{a} {'золота' if p['type'] == 'hardcurrency' else 'серебра'}"


def caption(b, y):
    name = b['name'].strip()
    bits = [name[0].upper() + name[1:]]
    if y and str(y) not in name:
        bits.append(str(y))
    ps = price_str(b['price'])
    if ps:
        bits.append(ps)
    return ' · '.join(bits)


OPS = []
DUPS = collections.Counter(caption(b, year_of(b['itemId'])) for b in boxes)

def n_outcomes(b):
    keys = set()
    for g in b['groups']:
        keys.add(tuple(sorted([f"m:{x['id']}|{x['tier'] or ''}|{x['skin'] or ''}" for x in g['mutants']]
                              + [f"r:{r['type']}|{r['name']}|{r['amount']}" for r in (g.get('rewards') or [])])))
    return len(keys)


DUP_GROUPS = collections.defaultdict(list)
for _b in boxes:
    DUP_GROUPS[caption(_b, year_of(_b['itemId']))].append(_b)


def final_caption(b):
    i = b['itemId']
    cap = caption(b, year_of(i))
    members = DUP_GROUPS[cap]
    if len(members) > 1:
        mn = mutant_name_of(b) if sum(len(g['mutants']) for g in b['groups']) == 1 else None
        num = re.search(r'_(\d{1,2})$', i)
        ver = re.search(r'_v(\d+)', i, re.I)
        nums = [re.search(r'_(\d{1,2})$', m['itemId']) for m in members]
        nums = [int(x.group(1)) for x in nums if x]
        use_num = num and len(nums) >= 2 and len(set(nums)) == len(nums)
        if use_num:
            cap += f' · №{int(num.group(1))}'
        elif mn:
            cap += f' · {mn[:1].upper() + mn[1:]}'
        elif re.search(r'_old$', i, re.I):
            cap += ' · старая версия'
        elif ver:
            cap += f' · версия {ver.group(1)}'
        elif not any(re.search(r'_old$|_v\d+', m['itemId'], re.I) for m in members if m is not b) and len({n_outcomes(m) for m in members}) > 1:
            n = n_outcomes(b)
            cap += f" · {n} {'вариант' if n % 10 == 1 and n != 11 else 'варианта' if n % 10 in (2, 3, 4) and n not in (12, 13, 14) else 'вариантов'}"
    return cap


FINAL = {b['itemId']: final_caption(b) for b in boxes}
FINAL_COUNT = collections.Counter(FINAL.values())
OPS = []
out = []
total = 0
out.append('# План публикации постеров боксов (черновик, ничего не отправлено)\n')
sections = collections.OrderedDict()
for key in sorted(order_keys, key=lambda k: (k[0], k[1] if k[0] != '1. Контейнеры по генам' else ['Кибер','Рубака','Мифики','Зооморф','Галактика','Мертвяк'].index(k[1]) if k[1] in ['Кибер','Рубака','Мифики','Зооморф','Галактика','Мертвяк'] else 99)):
    sections.setdefault(key[0], []).append(key)
EVENT_ORDER = ['Юбилейные', 'Зима и Рождество', 'Хэллоуин', 'День святого Валентина', 'Пасха', 'Прочие события']
for _sec, _keys in sections.items():
    if _sec.startswith('8.'):
        _keys.sort(key=lambda k: EVENT_ORDER.index(k[1]) if k[1] in EVENT_ORDER else 99)

for sec, keys in sections.items():
    n_sec = sum(len(groups[k]) for k in keys)
    out.append(f'\n## {sec}  ({n_sec})\n')
    OPS.append(('text', SEC_HEAD.get(sec, sec)))
    for k in keys:
        items = [b for _, b in sorted(groups[k], key=lambda t: t[0])]
        if k[1]:
            out.append(f'\n### {k[1]}  ({len(items)})\n')
            OPS.append(('text', '▸ ' + k[1]))
        for b in items:
            total += 1
            i = b['itemId']
            tags = []
            if k[1] in GENE_TAG:
                tags.append(GENE_TAG[k[1]])
                tags.append('#контейнеры')
            else:
                tags.append('#контейнеры')
            if sec in SECTION_TAG:
                tags.append(SECTION_TAG[sec])
            if k[1] in SUB_TAG:
                tags.append(SUB_TAG[k[1]])
            if b['category'] in TYPE_TAG:
                tags.append(TYPE_TAG[b['category']])
            flag = f"  ⚠ {BROKEN[i]}" if i in BROKEN else ''
            cap = FINAL[i]
            if FINAL_COUNT[cap] > 1:
                flag += '  ⚠ дубль подписи, нужно отличие'
            OPS.append(('photo', i, cap + '\n' + ' '.join(dict.fromkeys(tags))))
            out.append(f"- `{i}.png` — {cap}  {' '.join(dict.fromkeys(tags))}{flag}")

out.append(f'\n---\nВсего: {total} из {len(boxes)}')
sys.stdout.write('\n'.join(out) + '\n')
assert total == len(boxes), (total, len(boxes))
import os
if os.environ.get('OPS_OUT'):
    json.dump(OPS, open(os.environ['OPS_OUT'], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
