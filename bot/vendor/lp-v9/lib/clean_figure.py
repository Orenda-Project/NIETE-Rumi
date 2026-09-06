#!/usr/bin/env python3
"""clean_figure.py — lift a faint textbook scan before it goes into the LP.

    python3 clean_figure.py <src> <dst>

Ported from canva-build/build_lp.py `clean_diagram()` (the Jan-2026 build), minus its
hand-aimed crop: that crop was tuned by eye for one figure, and a per-figure magic number
cannot be applied to a corpus. What ports cleanly is the tonal pass, which is what actually
made the leaf legible:

    grayscale -> autocontrast(cutoff=1) -> contrast x1.18 -> brightness x1.05 -> JPEG q90

NBF scans are low-contrast greys on an off-white ground; autocontrast alone recovers most of
the line art, and the small contrast/brightness lift stops the result looking muddy at the
~118px height the figure occupies on the page.

Called synchronously by lib/template.js and cached by content hash, so a corpus render pays
this once per figure.
"""

import sys

try:
    from PIL import Image, ImageOps, ImageEnhance
except ImportError:
    sys.exit("clean_figure.py needs Pillow: pip3 install pillow")


def clean(src, dst):
    im = Image.open(src).convert("L")          # grayscale line art
    im = ImageOps.autocontrast(im, cutoff=1)   # lift the faded scan
    im = ImageEnhance.Contrast(im).enhance(1.18)
    im = ImageEnhance.Brightness(im).enhance(1.05)
    im.convert("RGB").save(dst, "JPEG", quality=90)
    return im.size


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: clean_figure.py <src> <dst>")
    w, h = clean(sys.argv[1], sys.argv[2])
    print(f"{w}x{h}")
