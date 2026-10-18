#!/usr/bin/env python3
"""
Build the shared link landing's own small Urdu face from the app's Urdu face (wq-nastaliq-6.woff2) and the landing's
closed words (strings.js). Writes dashboard/lib/web-quiz-landing-face.woff2 and .json; the module
dashboard/lib/web-quiz-landing-face.js turns them into one @font-face line. Run it after any change to those words:
the guard test (dashboard/tests/web-quiz-landing-face.service.test.js) is red until you do.

    python3 -m pip install fonttools brotli uharfbuzz
    python3 dashboard/scripts/landing-urdu-face/build.py

How the face is cut (a plain glyph subset keeps ~84 KB, because Nastaliq's substitution closure pulls in most of the
face):
  1. Glyphs: the ones HarfBuzz visits while shaping each closed string with the full face, plus the few more each
     string needs (found by trial: a glyph is kept only if dropping it changes that string's shaping).
  2. Rules: every substitution/positioning subtable is dropped unless dropping it changes the shaping of a string, a
     word, or any run of whole words (a line break can fall between any two words).
  3. Check: every string, word and run of words shapes with the same glyph outlines, advances and offsets as the full
     face (0 differences), or the build fails.
The face can only draw these words. Open text (a child's name, a class, an item title) must never use it.
"""
import hashlib
import io
import json
import os
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
import uharfbuzz as hb

# The same bytes on every run: fontTools orders some tables by set iteration, which Python seeds per process.
if os.environ.get('PYTHONHASHSEED') != '0':
    os.execve(sys.executable, [sys.executable] + sys.argv, {**os.environ, 'PYTHONHASHSEED': '0'})

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(REPO, 'dashboard', 'public', 'wq', 'fonts', 'wq-nastaliq-6.woff2')
OUT_FONT = os.path.join(REPO, 'dashboard', 'lib', 'web-quiz-landing-face.woff2')
OUT_META = os.path.join(REPO, 'dashboard', 'lib', 'web-quiz-landing-face.json')
MAX_BYTES = 20 * 1024


def ttf_bytes(data):
    f = TTFont(io.BytesIO(data), recalcTimestamp=False)
    f.flavor = None
    out = io.BytesIO()
    f.save(out)
    return out.getvalue()


class Shaper:
    """HarfBuzz over one font; a glyph is named by its outline + metrics, so two fonts with different glyph order compare."""

    def __init__(self, raw):
        self.font = hb.Font(hb.Face(raw))
        tt = TTFont(io.BytesIO(raw), recalcTimestamp=False)
        self.order = tt.getGlyphOrder()
        self.glyf = tt['glyf']
        self.hmtx = tt['hmtx']
        self.memo = {}

    def ident(self, gid):
        if gid in self.memo:
            return self.memo[gid]
        name = self.order[gid]
        g = self.glyf[name]
        if g.isComposite():
            key = repr([(self.ident(self.order.index(c.glyphName)), c.x, c.y, getattr(c, 'transform', None)) for c in g.components])
        elif g.numberOfContours == 0:
            key = 'empty'
        else:
            key = repr((list(g.coordinates), list(g.endPtsOfContours), [f & 1 for f in g.flags]))
        h = hashlib.sha1((key + '|' + repr(self.hmtx[name])).encode()).hexdigest()[:16]
        self.memo[gid] = h
        return h

    def run(self, text, trace=None):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        if trace is not None:
            def cb(msg):
                if msg.startswith('start lookup') or msg.startswith('end lookup'):
                    trace.update(i.codepoint for i in buf.glyph_infos)
                return True
            buf.set_message_func(cb)
        hb.shape(self.font, buf, {})
        if trace is not None:
            trace.update(i.codepoint for i in buf.glyph_infos)
        return [(i.codepoint, i.cluster, p.x_advance, p.y_advance, p.x_offset, p.y_offset)
                for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

    def sig(self, text):
        return [(self.ident(g), c, xa, ya, xo, yo) for g, c, xa, ya, xo, yo in self.run(text)]


def options(closure, retain):
    o = subset.Options()
    o.layout_features = ['*']
    o.layout_closure = closure
    o.retain_gids = retain
    o.hinting = False
    o.notdef_outline = True
    o.name_IDs = ['*']
    o.glyph_names = False
    return o


def cut(raw, gids=None, text=None, closure=False, retain=False, flavor=None):
    f = TTFont(io.BytesIO(raw), recalcTimestamp=False)
    s = subset.Subsetter(options(closure, retain))
    s.populate(gids=sorted(gids) if gids is not None else [], text=text or '')
    s.subset(f)
    f.flavor = flavor
    out = io.BytesIO()
    f.save(out)
    return out.getvalue(), s


def runs(strings):
    """Every string, and every run of whole words in it (a line can break between any two words)."""
    out = set()
    for s in strings:
        w = s.split(' ')
        for i in range(len(w)):
            for j in range(i + 1, len(w) + 1):
                t = ' '.join(w[i:j])
                if t:
                    out.add(t)
    return sorted(out)


def shrink(cand, keep_ok):
    """Delta debugging: drop chunks of `cand` while keep_ok(rest) holds."""
    cand = list(cand)
    n = 2
    while len(cand) >= 2:
        chunk = max(1, len(cand) // n)
        for i in range(0, len(cand), chunk):
            trial = cand[:i] + cand[i + chunk:]
            if keep_ok(trial):
                cand = trial
                n = max(n - 1, 2)
                break
        else:
            if n >= len(cand):
                break
            n = min(len(cand), n * 2)
    if len(cand) == 1 and keep_ok([]):
        cand = []
    return cand


def main():
    strings = json.loads(subprocess.check_output(['node', os.path.join(HERE, 'strings.js')], cwd=REPO))
    texts = runs(strings)
    src = open(SRC, 'rb').read()
    raw = ttf_bytes(src)
    full = Shaper(raw)
    order = full.order
    ref = {t: full.sig(t) for t in texts}
    ref_gid = {t: full.run(t) for t in strings}

    # 1. glyphs (glyph ids kept in place while searching, so a shaping run compares by id)
    def gid_ok(gids, ts):
        f = Shaper(cut(raw, gids=gids, retain=True)[0])
        return all(f.run(t) == ref_gid[t] for t in ts)

    keep = {0}
    for t in strings:
        full.run(t, keep)
    for t in strings:
        if gid_ok(keep, [t]):
            continue
        _, s = cut(raw, text=t, closure=True, retain=True)
        extra = sorted({order.index(n) for n in s.glyphs_retained} - keep)
        if not gid_ok(keep | set(extra), [t]):
            sys.exit(f'closure does not shape: {t}')
        keep |= set(shrink(extra, lambda c: gid_ok(keep | set(c), [t])))

    # 2. rules
    small = ttf_bytes(cut(raw, gids=keep)[0])

    def build(drop):
        f = TTFont(io.BytesIO(small), recalcTimestamp=False)
        for tag in ('GSUB', 'GPOS'):
            for li, lk in enumerate(f[tag].table.LookupList.Lookup):
                lk.SubTable = [st for si, st in enumerate(lk.SubTable) if (tag, li, si) not in drop]
                lk.SubTableCount = len(lk.SubTable)
        out = io.BytesIO()
        f.save(out)
        return out.getvalue()

    def same(raw_font):
        f = Shaper(raw_font)
        return all(f.sig(t) == ref[t] for t in texts)

    f0 = TTFont(io.BytesIO(small), recalcTimestamp=False)
    units = [(tag, li, si) for tag in ('GSUB', 'GPOS')
             for li, lk in enumerate(f0[tag].table.LookupList.Lookup) for si in range(len(lk.SubTable))]
    if not same(small):
        sys.exit('the glyph cut does not shape like the full face')
    drop = set()

    def try_drop(chunk):
        if not chunk:
            return
        if same(build(drop | set(chunk))):
            drop.update(chunk)
        elif len(chunk) > 1:
            h = len(chunk) // 2
            try_drop(chunk[:h])
            try_drop(chunk[h:])

    for i in range(0, len(units), 64):
        try_drop(units[i:i + 64])

    # 3. the face, checked
    f = TTFont(io.BytesIO(build(drop)), recalcTimestamp=False)
    s = subset.Subsetter(options(False, False))
    s.populate(glyphs=f.getGlyphOrder())
    s.subset(f)
    f.flavor = 'woff2'
    out = io.BytesIO()
    f.save(out)
    woff2 = out.getvalue()
    diffs = [t for t in texts if Shaper(ttf_bytes(woff2)).sig(t) != ref[t]]
    if diffs:
        sys.exit(f'{len(diffs)} runs shape differently, e.g. {diffs[0]}')
    if len(woff2) > MAX_BYTES:
        sys.exit(f'{len(woff2)} B is over {MAX_BYTES} B')
    cmap = sorted(TTFont(io.BytesIO(woff2), recalcTimestamp=False).getBestCmap())
    src_cmap = TTFont(io.BytesIO(raw), recalcTimestamp=False).getBestCmap()
    chars = sorted({ord(c) for s in strings for c in s})
    open(OUT_FONT, 'wb').write(woff2)
    meta = {
        'about': 'Generated by dashboard/scripts/landing-urdu-face/build.py. Do not edit; rebuild.',
        'source': 'dashboard/public/wq/fonts/wq-nastaliq-6.woff2',
        'source_sha256': hashlib.sha256(src).hexdigest(),
        'sha256': hashlib.sha256(woff2).hexdigest(),
        'bytes': len(woff2),
        'glyphs': TTFont(io.BytesIO(woff2), recalcTimestamp=False)['maxp'].numGlyphs,
        'checked_runs': len(texts),
        'codepoints': cmap,
        'not_in_source': [c for c in chars if c not in src_cmap],
        'strings': strings,
    }
    with open(OUT_META, 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print(f'{len(woff2)} B, {meta["glyphs"]} glyphs, {len(strings)} strings, {len(texts)} runs: 0 differences')


if __name__ == '__main__':
    main()
