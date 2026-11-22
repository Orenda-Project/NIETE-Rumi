#!/usr/bin/env python3
"""
The Qaida letter face: wq-naskh-1.woff2, Noto Naskh Arabic Regular cut down to the Arabic letters and their marks.

A Noorani Qaida teaches the Arabic letters in Naskh. The page sets a letter card the server marks lang 'ar' in this
face (wq.css `.wq-glyph[lang=ar]`, "WQ Naskh"); every other card keeps the Urdu Nastaliq. Kept: U+0621-063A and
U+0641-064A (hamza to ghain, feh to yeh), the harakat U+064B-0652, superscript alef U+0670 and alef wasla U+0671, with
the layout tables that place a mark on its letter (GSUB/GPOS/GDEF). Its @font-face unicode-range is the same set.

    python3 -m pip install fonttools brotli
    curl -L -o NotoNaskhArabic-Regular.ttf \
      https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoNaskhArabic/hinted/ttf/NotoNaskhArabic-Regular.ttf
    python3 dashboard/scripts/naskh-letters/build.py NotoNaskhArabic-Regular.ttf

Writes dashboard/public/wq/fonts/wq-naskh-1.woff2 and dashboard/scripts/naskh-letters/record.json (the source's
sha256, the cut's sha256, size and code points). The licence is fonts/OFL-NotoNaskhArabic.txt. The name is the
version: a new cut is a new number.
"""
import hashlib
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

if os.environ.get('PYTHONHASHSEED') != '0':
    os.execve(sys.executable, [sys.executable] + sys.argv, {**os.environ, 'PYTHONHASHSEED': '0'})

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'wq', 'fonts'))
OUT = os.path.join(FONTS, 'wq-naskh-1.woff2')
RECORD = os.path.join(HERE, 'record.json')
RANGES = ((0x0621, 0x063A), (0x0641, 0x064A), (0x064B, 0x0652), (0x0670, 0x0671))
CODEPOINTS = [cp for a, b in RANGES for cp in range(a, b + 1)]


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def main(src):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']      # isol/init/medi/fina, ccmp, mark/mkmk: a letter and its harakat as the Qaida prints them
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]  # the copyright and the font's names stay
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    font = subset.load_font(src, opts, dontLoadGlyphNames=True)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=CODEPOINTS)
    sub.subset(font)
    font.recalcTimestamp = False
    font['head'].modified = font['head'].created  # no build time in the file: the same source cuts to the same bytes
    subset.save_font(font, OUT, opts)

    cmap = TTFont(OUT).getBestCmap()
    missing = [f'U+{cp:04X}' for cp in CODEPOINTS if cp not in cmap]
    if missing:
        sys.exit(f'the cut lacks {missing}')
    record = {
        'source': os.path.basename(src), 'source_sha256': sha(src),
        'out': 'dashboard/public/wq/fonts/wq-naskh-1.woff2', 'out_sha256': sha(OUT), 'bytes': os.path.getsize(OUT),
        'unicode_range': ','.join(f'U+{a:04X}-{b:04X}' for a, b in RANGES), 'codepoints': len(CODEPOINTS),
    }
    with open(RECORD, 'w') as f:
        json.dump(record, f, indent=2)
        f.write('\n')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
