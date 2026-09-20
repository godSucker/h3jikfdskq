#!/usr/bin/env python3
"""
sync_characters.py -- autonomous full-body character texture renderer (WEB-PNG route).

Analogue of the "head" thumbnail parser (scripts/sync-mutants.ts) but for full-body
stand renders. Fully autonomous, no frida / no live game:

  geometry  <- gameconfig/sprites.xml   (plaintext, no hash) -> specimen_<CODE>_stand
  atlas     <- assets/character/<stem>[_<tier|skin>].png  (plaintext, no hash, RGBA)
  render    <- compositor.py (v11 + web fixes) at frames.rest_frame(sprite)

Outputs, matching the site's existing layout:
  by_mutant  public/textures_by_mutant/<code>/FULL_<code>[_<tier>].png
  by_skins   public/textures_by_skins/FULL_<id>_<skin>.png

Modes:
  (default)      incremental -- only (re)render atlases whose CDN signature changed
  --full         backfill -- render everything (run once locally, then push to CDN)
  --only CODE    render a single site code (debug), e.g. --only aa_12
  --limit N      stop after N rendered PNGs (testing)
  --sprites PATH use a local sprites.xml / stands.xml instead of fetching (testing)
  --no-skins     skip the skin pass

New-character detection: a state manifest (rendered.json) keyed by output path stores
each source atlas's CDN signature (Last-Modified + Content-Length). A target is
rendered only when its signature is new or changed -> "check for new characters daily".
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compositor as comp  # noqa: E402
import frames as F         # noqa: E402

CDN = "https://s-beta.kobojo.com/mutants"
SPRITES_URL = CDN + "/gameconfig/sprites.xml"
GACHA_URL = CDN + "/gameconfig/gacha.xml"
ATLAS_BASE = CDN + "/assets/character"

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))          # mutants_site/
OUT_MUTANT = os.path.join(REPO, "public", "textures_by_mutant")
OUT_SKIN = os.path.join(REPO, "public", "textures_by_skins", "textures_by_skin", "full")
STATE_PATH = os.path.join(HERE, "rendered.json")
CACHE = os.path.join(HERE, ".cache")

STAR_TIERS = ["bronze", "silver", "gold", "platinum"]
UA = "archivist-library-texture-sync/1.0"

# Weak starter variants -- Specimen_A_02 / B_02 / C_02 = Слабый Робот / Зомби / Воин.
# They exist as stand sprites in sprites.xml (sharing the a/b/c atlas with the _01
# specimens) but are deliberately never written to mutants.json, so the site has no
# use for their textures. Excluded from every pass, including skins.
EXCLUDED_CODES = {"a_02", "b_02", "c_02"}

# cc_03 (Zena): her face's eye/eyebrow art references atlas regions that come
# back blank on EVERY fetched CDN tier (base included); the only tier with
# non-blank pixels at those exact coordinates is bronze, and cropping it
# shows unrelated tier-recolored content, not eyes -- the source art simply
# is not present in any live atlas, so the compositor has nothing correct to
# build from no matter which frame/graft is tried. public/textures_by_mutant
# /cc_03/FULL_cc_03*.png were replaced with this repo's pre-existing
# reference renders (which do have correct eyes on every tier) instead.
# Frozen here so a future atlas refresh doesn't silently re-render and
# overwrite them with the eyeless compositor output.
#
# ff_05 (Glubber): same class of bug as ed_14/ee_01 (see memory
# character-textures-batch-fixes-2026-07) -- the web-PNG atlas's alpha
# channel is degraded (interior alpha 93-255, not flat 0/255), so the body
# composite that should be fully transparent renders as a faint visible
# ghost behind the wings. Not a compositor code bug -- the correct alpha
# only exists in the mobile/ETC1 atlas, which isn't reachable without a
# live Frida capture. public/textures_by_mutant/ff_05/FULL_ff_05*.png were
# replaced with this repo's pre-existing reference renders instead.
FROZEN_CODES = {"cc_03", "ff_05"}


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def _req(url, method="GET"):
    return urllib.request.Request(url, method=method, headers={"User-Agent": UA})


def http_signature(url):
    """HEAD an atlas -> stable signature string, or None if it does not exist.

    Used both to test existence (skip 404 tiers/skins) and to detect changes.
    Content-Length only: Kobojo's CDN serves the same atlas with a flip-flopping
    Last-Modified between two values (confirmed via HEAD on live URLs - same
    length, different date depending which edge answers), so including it made
    ~150-200 unchanged atlases look "new" on every run, causing needless
    re-renders and commits daily. ETag is never sent by this CDN (always empty),
    so it added nothing. Length alone will miss a same-size content edit, but
    that's an acceptable trade for actually-working incremental detection."""
    try:
        with urllib.request.urlopen(_req(url, "HEAD"), timeout=30) as r:
            return r.headers.get("Content-Length", "")
    except urllib.error.HTTPError:
        return None
    except Exception:
        return None


def http_bytes(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(_req(url), timeout=120) as r:
                return r.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))
    return None


# --------------------------------------------------------------------------- #
# Geometry: sprites.xml -> specimen_*_stand elements
# --------------------------------------------------------------------------- #
def fetch_stands(sprites_path=None):
    """Return (root_element, {site_code: (sprite_element, atlas_stem)}).

    site_code = lowercase of the id core, e.g. specimen_AA_12_stand -> "aa_12".
    atlas_stem = the sprite's bitmap without dir/ext, e.g. "a_a_12" (source of truth
    for the CDN atlas filename; carries the gene underscores the id drops)."""
    if sprites_path and os.path.exists(sprites_path):
        src = open(sprites_path, "rb")
    else:
        print("[geometry] fetching sprites.xml ...", flush=True)
        src = io.BytesIO(http_bytes(SPRITES_URL))

    # Stream with iterparse: keep only the top-level specimen_*_stand <Sprite>
    # elements (each ~40KB) and clear the root after every processed child so the
    # 220MB document never lives in memory as a full tree. Handles nested <Sprite>
    # children correctly (a line/regex scanner does not).
    mapping = {}
    newroot = ET.Element("ArrayOfSprite")
    depth = 0
    root = None
    for event, elem in ET.iterparse(src, events=("start", "end")):
        if event == "start":
            depth += 1
            if depth == 1:
                root = elem
            continue
        # end
        if elem.tag == "Sprite" and depth == 2:
            sid = elem.get("id") or ""
            m = re.match(r"^specimen_([A-Za-z0-9_]+)_stand$", sid)
            if m:
                bitmap = elem.get("bitmap") or ""
                mb = re.match(r"^character/(.+)\.png$", bitmap)
                if mb:
                    newroot.append(elem)  # keep this subtree alive
                    mapping[m.group(1).lower()] = (elem, mb.group(1))
            if root is not None:
                root.clear()  # drop processed siblings; kept ones survive via newroot
        depth -= 1
    try:
        src.close()
    except Exception:
        pass
    return newroot, mapping


def cache_stands(root):
    """Persist the compact stands document so re-runs skip the big fetch."""
    os.makedirs(CACHE, exist_ok=True)
    ET.ElementTree(root).write(os.path.join(CACHE, "stands.xml"), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Skins: gacha.xml + бинго-доски -> {skin_name: [specimen_code, ...]}
# --------------------------------------------------------------------------- #
# НАЙДЕНО 2026-09-20 (Иван Веприк поймал на Марве): одной gacha.xml мало.
# Доска "Скины 2025" требует Specimen_AE_06 (Марв) в скине cyberweek, а гача
# cyberweek записана у Kobojo на Specimen_EA_06 (Кранк) - атласа e_a_06_cyberweek
# не существует (404), зато a_e_06_cyberweek отдаётся (200). То есть скин
# реальный, просто гача врёт, и по ней мы его никогда не рендерили.
# Бинго-доски (morphology_*) несут вторую, независимую таблицу пар
# "мутант + скин" - берём и её. Лишние пары не опасны: перед рендером каждый
# атлас проверяется на существование (build_targets отбрасывает 404).
BINGOS_JSON = os.path.join(REPO, "src", "data", "bingos.json")
# В поле skin у клетки доски лежит не только скин: "_any" - любой вид, а
# bronze/silver/gold/platinum - требование звезды (см. src/lib/bingo-entry-variant.ts).
NON_SKIN_CELL_VALUES = {"_any", ""} | set(STAR_TIERS)


def skins_from_bingos():
    """Map skin -> [specimen_code] from the bingo boards in bingos.json."""
    out = {}
    try:
        with open(BINGOS_JSON, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as e:  # noqa: BLE001
        print("[skins] bingos.json unavailable (%s); using gacha only" % e)
        return out
    boards = data if isinstance(data, list) else data.get("bingos", [])
    for board in boards:
        for cell in board.get("mutants", []) or []:
            skin = str(cell.get("skin") or "").strip().lower()
            if skin in NON_SKIN_CELL_VALUES:
                continue
            mm = re.match(r"^specimen_([a-z0-9_]+)$", str(cell.get("specimenId") or "").lower())
            if not mm:
                continue
            out.setdefault(skin, [])
            if mm.group(1) not in out[skin]:
                out[skin].append(mm.group(1))
    return out


def fetch_skins():
    """Map each Gacha skin id to the specimen codes it re-skins.

    <Gacha id="girl"> ... <X specimen="Specimen_CF_01" .../> ... </Gacha>
    -> {"girl": ["cf_01", ...]}"""
    try:
        text = http_bytes(GACHA_URL).decode("utf-8", "ignore")
        root = ET.fromstring(text)
    except Exception as e:
        print("[skins] gacha.xml unavailable (%s); skipping skins" % e)
        return {}
    skins = {}
    for gacha in root.iter("Gacha"):
        skin = gacha.get("id")
        if not skin:
            continue
        codes = []
        for el in gacha.iter():
            if el is gacha:
                continue
            spec = el.get("specimen")
            if spec:
                mm = re.match(r"^Specimen_([A-Za-z0-9_]+)$", spec)
                if mm:
                    codes.append(mm.group(1).lower())
        if codes:
            skins.setdefault(skin, [])
            for c in codes:
                if c not in skins[skin]:
                    skins[skin].append(c)
    extra = 0
    for skin, codes in skins_from_bingos().items():
        for c in codes:
            if c not in skins.setdefault(skin, []):
                skins[skin].append(c)
                extra += 1
    if extra:
        print("[skins] +%d пар из бинго-досок (нет в gacha.xml)" % extra)
    return skins


# --------------------------------------------------------------------------- #
# Target enumeration
# --------------------------------------------------------------------------- #
class Target:
    __slots__ = ("code", "sprite", "atlas_url", "out_path", "kind", "sig")

    def __init__(self, code, sprite, atlas_url, out_path, kind, sig):
        self.code = code
        self.sprite = sprite
        self.atlas_url = atlas_url
        self.out_path = out_path
        self.kind = kind
        self.sig = sig


def build_targets(mapping, skins, want_skins=True, only=None, workers=16):
    """Return every renderable target that actually exists on the CDN.

    Probing is ~3100 HEAD requests (556 codes x base+4 tiers, plus skin pairs).
    Sequentially that is ~10 min and would eat most of the 30-min cron budget,
    so the existence/signature probe runs on a small thread pool."""
    cands = []  # (code, sprite, url, out_path, kind)
    codes = [c for c in sorted(mapping) if c not in EXCLUDED_CODES]
    if only:
        # `only` is a single code string OR a set/list of codes.
        wanted = {only} if isinstance(only, str) else set(only)
        codes = [c for c in codes if c in wanted]

    # by_mutant: base + star tiers (same geometry, swapped atlas)
    for code in codes:
        sprite, stem = mapping[code]
        folder = os.path.join(OUT_MUTANT, code)
        cands.append((code, sprite, "%s/%s.png" % (ATLAS_BASE, stem),
                      os.path.join(folder, "FULL_%s.png" % code), "base"))
        for tier in STAR_TIERS:
            cands.append((code, sprite, "%s/%s_%s.png" % (ATLAS_BASE, stem, tier),
                          os.path.join(folder, "FULL_%s_%s.png" % (code, tier)), "tier"))

    # by_skins: base geometry + skin atlas, from gacha.xml
    if want_skins:
        for skin, specimens in sorted(skins.items()):
            for spec in specimens:
                if only and spec not in ({only} if isinstance(only, str) else set(only)):
                    continue
                if spec not in mapping or spec in EXCLUDED_CODES:
                    continue
                sprite, stem = mapping[spec]
                cands.append((spec, sprite, "%s/%s_%s.png" % (ATLAS_BASE, stem, skin),
                              os.path.join(OUT_SKIN, "FULL_%s_%s.png" % (spec, skin)),
                              "skin"))

    with ThreadPoolExecutor(max_workers=workers) as ex:
        sigs = list(ex.map(http_signature, [c[2] for c in cands]))

    targets, base_ok = [], set()
    for (code, sprite, url, out, kind), sig in zip(cands, sigs):
        if sig is None:
            continue  # atlas does not exist (404) -> nothing to render
        if kind == "base":
            base_ok.add(code)
        targets.append(Target(code, sprite, url, out, kind, sig))
    # A tier/skin atlas without its base atlas means the specimen is not shipped;
    # keep the original behaviour of skipping the whole code in that case.
    return [t for t in targets if t.kind == "base" or t.code in base_ok]


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #
def choose_frame(sprite):
    frame = F.rest_frame(sprite)
    if not comp.collect_quads(sprite, frame):
        ranked = [c for c in F.stand_frames(sprite) if comp.collect_quads(sprite, c)]
        frame = ranked[0] if ranked else 0.0
    code = sprite.get("_code")
    if code in F.FRAME_OVERRIDES:
        frame = float(F.FRAME_OVERRIDES[code])
    return frame


def render_target(t):
    """Fetch atlas, render, save. Returns 'ok' | 'review' | 'fail:<msg>'.

    Used for kind='skin' targets only -- each skin is a single independent
    render (base geometry + one skin atlas), no sibling tiers to stay
    anchored against, so its own getbbox() crop is fine as-is. base/tier
    targets go through render_family() below instead, see its docstring."""
    if t.code in FROZEN_CODES:
        return "ok"  # manually-placed reference render, see FROZEN_CODES comment
    os.makedirs(os.path.dirname(t.out_path), exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    atlas_file = os.path.join(CACHE, os.path.basename(t.atlas_url))
    try:
        data = http_bytes(t.atlas_url)
        with open(atlas_file, "wb") as fh:
            fh.write(data)
    except Exception as e:
        return "fail:atlas download %s" % e

    review = False
    try:
        if t.code in F.POSE_OVERRIDES:
            sid = t.sprite.get("id")
            F.render_override("", atlas_file, sid, t.sprite,
                              F.POSE_OVERRIDES[t.code], t.out_path)
        else:
            sprite = t.sprite
            if t.code in F.COMPOSITE_DROPS:
                sprite = F.drop_composites(sprite, t.code)
            if t.code == 'de_14':
                sprite = F.de14_manual_graft(sprite)
            if t.code == 'de_05':
                sprite = F.de05_manual_fix(sprite)
            if t.code in F.COMPOSITE_REORDER:
                sprite = F.reorder_composites(sprite, t.code)
            if t.code == 'ff_13':
                sprite = F.ff13_boost_arms(sprite)
            if F.segmented_rig(sprite):
                review = True  # segmented dance rig -> render is a guess, flag it
            frame = choose_frame(sprite)
            img = comp.compose("", atlas_file, sprite.get("id"), None,
                               frame=frame, quiet=True, sprite=sprite)
            if img is None:
                return "fail:no visible images"
            img.save(t.out_path)
    except Exception as e:
        return "fail:%s" % e
    return "review" if review else "ok"


def _union_bbox(boxes):
    xs0 = [b[0] for b in boxes]
    ys0 = [b[1] for b in boxes]
    xs1 = [b[2] for b in boxes]
    ys1 = [b[3] for b in boxes]
    return (min(xs0), min(ys0), max(xs1), max(ys1))


def render_family(code, sprite, members):
    """Render every base/tier target of one specimen with a SHARED crop.

    `members` is the list of Targets for this code (kind in base/tier),
    already filtered to atlases that exist on the CDN. See compose()'s
    docstring for why this is needed: the pre-crop canvas is identical across
    tiers (same sprites.xml geometry), but a tier-appearing accessory (e.g. a
    wing quad that's blank below silver) makes each tier's OWN getbbox() crop
    a different rectangle of that shared canvas -- cropping independently
    shifts the body the moment the accessory becomes visible. Fix: measure
    every tier's own bbox first (pass 1, nothing saved), union them, then
    render+save every tier against that one shared rectangle (pass 2).

    Returns {out_path: 'ok'|'review'|'fail:<msg>'}."""
    if code in FROZEN_CODES:
        return {t.out_path: "ok" for t in members}  # manual reference renders, untouched

    os.makedirs(CACHE, exist_ok=True)
    atlas_files = {}
    results = {}
    for t in members:
        atlas_file = os.path.join(CACHE, os.path.basename(t.atlas_url))
        try:
            data = http_bytes(t.atlas_url)
            with open(atlas_file, "wb") as fh:
                fh.write(data)
            atlas_files[t.out_path] = atlas_file
        except Exception as e:
            results[t.out_path] = "fail:atlas download %s" % e
    ok_members = [t for t in members if t.out_path in atlas_files]
    if not ok_members:
        return results

    sprite_ref = ok_members[0].sprite  # same XML element for every member of a code
    working = sprite_ref
    if code in F.COMPOSITE_DROPS:
        working = F.drop_composites(working, code)
    if code == 'de_14':
        working = F.de14_manual_graft(working)
    if code == 'de_05':
        working = F.de05_manual_fix(working)
    if code in F.COMPOSITE_REORDER:
        working = F.reorder_composites(working, code)
    if code == 'ff_13':
        working = F.ff13_boost_arms(working)
    review = F.segmented_rig(working)  # segmented dance rig -> render is a guess, flag it
    sid = working.get("id")
    pose_spec = F.POSE_OVERRIDES.get(code)
    frame = None if pose_spec else choose_frame(working)

    def _render(t, out_path, crop_box, return_bbox):
        atlas_file = atlas_files[t.out_path]
        if pose_spec:
            return F.render_override("", atlas_file, sid, working, pose_spec,
                                     out_path, crop_box=crop_box, return_bbox=return_bbox)
        return comp.compose("", atlas_file, sid, out_path, frame=frame,
                            quiet=True, sprite=working, crop_box=crop_box,
                            return_bbox=return_bbox)

    boxes = []
    measured = []
    for t in ok_members:
        try:
            _, bbox = _render(t, None, None, True)
        except Exception as e:
            results[t.out_path] = "fail:%s" % e
            continue
        if bbox is None:
            results[t.out_path] = "fail:no visible images"
            continue
        boxes.append(bbox)
        measured.append(t)
    if not boxes:
        return results

    union = _union_bbox(boxes)
    for t in measured:
        os.makedirs(os.path.dirname(t.out_path), exist_ok=True)
        try:
            img = _render(t, t.out_path, union, False)
            if img is None:
                results[t.out_path] = "fail:no visible images"
                continue
        except Exception as e:
            results[t.out_path] = "fail:%s" % e
            continue
        results[t.out_path] = "review" if review else "ok"
    return results


# --------------------------------------------------------------------------- #
# State + summary
# --------------------------------------------------------------------------- #
def load_state():
    if os.path.exists(STATE_PATH):
        try:
            return json.load(open(STATE_PATH))
        except Exception:
            pass
    return {}


def save_state(state):
    # Atomic write: a SIGKILL (job timeout) mid-write must not truncate the
    # existing rendered.json, or load_state() falls back to {} and the next
    # run re-renders everything instead of resuming from the checkpoint.
    tmp_path = STATE_PATH + ".tmp"
    with open(tmp_path, "w") as fh:
        json.dump(state, fh, indent=0, sort_keys=True)
    os.replace(tmp_path, STATE_PATH)


def summary(stats, review, failures):
    lines = ["### Текстуры персонажей (full-render, web-route)"]
    if stats["new"] == 0 and not review and not failures:
        lines.append("ℹ️ Новых персонажей не обнаружено — рендер не требуется")
    else:
        lines.append("🆕 Новых/изменённых атласов: %d" % stats["new"])
        lines.append("🖼️ Отрендерено PNG: %d  (база + тиры + скины)" % stats["ok"])
        lines.append("⏭️ Пропущено (актуальны): %d" % stats["skip"])
        lines.append("⚠️ Требует ручной проверки (segmented rig): %d" % len(set(review)))
        lines.append("❌ Ошибок рендера: %d" % len(failures))
        if review:
            lines.append("")
            lines.append("**NEEDS MANUAL REVIEW:** " + ", ".join(sorted(set(review))))
    block = "\n".join(lines) + "\n"
    # Written to a file rather than straight to $GITHUB_STEP_SUMMARY so the
    # workflow's final "Итоги" step can place this section in the right order.
    try:
        os.makedirs(CACHE, exist_ok=True)
        with open(os.path.join(CACHE, "summary.md"), "w") as fh:
            fh.write(block)
    except Exception:
        pass
    print("\n" + block)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="render everything (backfill)")
    ap.add_argument("--only", help="site code(s), comma-separated, e.g. aa_12 or aa_12,ab_03")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sprites", help="local sprites.xml / stands.xml")
    ap.add_argument("--no-skins", action="store_true")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None

    root, mapping = fetch_stands(args.sprites)
    try:
        cache_stands(root)
    except Exception:
        pass
    for code, (sp, _stem) in mapping.items():
        sp.set("_code", code)  # so choose_frame can see the code for overrides
    print("[geometry] %d stand sprites" % len(mapping))

    skins = {} if args.no_skins else fetch_skins()
    if skins:
        print("[skins] %d skin packs, %d (skin,specimen) pairs"
              % (len(skins), sum(len(v) for v in skins.values())))

    print("[targets] probing CDN for existing atlases ...", flush=True)
    targets = build_targets(mapping, skins, want_skins=not args.no_skins, only=only)
    print("[targets] %d existing atlases" % len(targets))

    state = load_state()
    stats = {"new": 0, "ok": 0, "skip": 0}
    review, failures = [], []
    n = 0

    # base/tier targets of the same code MUST render together: compose()'s
    # pre-crop canvas is identical across a specimen's tiers (shared
    # sprites.xml geometry), and cropping each tier to its own getbbox() is
    # exactly the bug this rewrite fixes (see render_family()'s docstring) --
    # a tier-only accessory (wings, etc.) becoming visible shifts the body
    # inside its crop. Skins stay on the old one-target-one-render path: a
    # skin has no sibling tiers to stay anchored against.
    skin_targets = [t for t in targets if t.kind == "skin"]
    families = {}
    for t in targets:
        if t.kind in ("base", "tier"):
            families.setdefault(t.code, []).append(t)

    for code in sorted(families):
        members = families[code]
        rels = {t.out_path: os.path.relpath(t.out_path, REPO) for t in members}
        needs_render = args.full or any(
            state.get(rels[t.out_path]) != t.sig or not os.path.exists(t.out_path)
            for t in members
        )
        if not needs_render:
            stats["skip"] += len(members)
            continue
        # Any sig change invalidates the WHOLE family's shared crop, so every
        # member gets re-rendered here even if its own atlas didn't change.
        stats["new"] += len(members)
        results = render_family(code, members[0].sprite, members)
        for t in members:
            rel = rels[t.out_path]
            res = results.get(t.out_path, "fail:not rendered")
            if res in ("ok", "review"):
                stats["ok"] += 1
                state[rel] = t.sig
                if res == "review":
                    review.append(code)
                    print("  REVIEW %s (segmented rig)" % rel)
            else:
                failures.append((rel, res))
                print("  FAIL %s -> %s" % (rel, res))
        prev_n = n
        n += len(members)
        if n // 25 > prev_n // 25:
            print("  ... %d rendered" % n, flush=True)
            save_state(state)  # checkpoint: a mid-run timeout must not discard
            # everything rendered so far, or a heavy day (many real content
            # changes) can never make net progress across cron runs.
        if args.limit and n >= args.limit:
            print("[limit] stopping at %d" % n)
            break

    for t in skin_targets:
        if args.limit and n >= args.limit:
            break
        rel = os.path.relpath(t.out_path, REPO)
        if not args.full and state.get(rel) == t.sig and os.path.exists(t.out_path):
            stats["skip"] += 1
            continue
        stats["new"] += 1
        res = render_target(t)
        if res == "ok":
            stats["ok"] += 1
            state[rel] = t.sig
        elif res == "review":
            stats["ok"] += 1
            review.append(t.code)
            state[rel] = t.sig
            print("  REVIEW %s (segmented rig)" % rel)
        else:
            failures.append((rel, res))
            print("  FAIL %s -> %s" % (rel, res))
        n += 1
        if n % 25 == 0:
            print("  ... %d rendered" % n, flush=True)
            save_state(state)
        if args.limit and n >= args.limit:
            print("[limit] stopping at %d" % n)
            break

    save_state(state)
    summary(stats, review, failures)
    if failures:
        print("failures:")
        for rel, e in failures:
            print("   %-40s %s" % (rel, e))


if __name__ == "__main__":
    main()
