#!/usr/bin/env python3
"""Ink profile of a PNG (RGB/RGBA, non-interlaced) with no third-party deps: per-row share of dark pixels,
how far down the page the ink reaches, and whether it reaches below a header band. Used by training T45
to judge a rendered Urdu report page, whose shaped text does not survive PDF text extraction."""
import sys, struct, zlib, json
def profile(png):
    b = open(png, 'rb').read(); pos = 8; w = h = 0; ct = 2; idat = b''
    while pos < len(b):
        L = struct.unpack('>I', b[pos:pos+4])[0]; typ = b[pos+4:pos+8]; dat = b[pos+8:pos+8+L]; pos += 12 + L
        if typ == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', dat[:10])
        elif typ == b'IDAT': idat += dat
    raw = zlib.decompress(idat); bpp = {2: 3, 6: 4, 0: 1, 4: 2}[ct]; stride = w * bpp + 1
    prev = bytearray(w * bpp); rows = []
    for y in range(h):
        f = raw[y*stride]; line = bytearray(raw[y*stride+1:(y+1)*stride])
        for i in range(len(line)):
            a = line[i-bpp] if i >= bpp else 0; up = prev[i]; c = prev[i-bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + up) & 255
            elif f == 3: line[i] = (line[i] + (a + up) // 2) & 255
            elif f == 4:
                p = a + up - c; pa, pb, pc = abs(p-a), abs(p-up), abs(p-c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else up if pb <= pc else c)) & 255
        prev = line
        if bpp >= 3: dark = sum(1 for x in range(0, w*bpp, bpp) if line[x] < 200 and line[x+1] < 200 and line[x+2] < 200)
        else: dark = sum(1 for x in range(0, w*bpp, bpp) if line[x] < 200)
        rows.append(dark / w)
    inked = [i for i, v in enumerate(rows) if v > 0.02]
    last = max(inked) if inked else 0
    return {'height': h, 'lastInkRow': last, 'inkShare': round(len(inked)/h, 3), 'reachesBelowHeader': last / h > 0.6}   # a header + one summary row already reaches ~0.53; a question block reaches lower
print(json.dumps(profile(sys.argv[1])))
