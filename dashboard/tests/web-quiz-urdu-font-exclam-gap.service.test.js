/**
 * Web quiz page, Urdu: the "!" after an Urdu word sits close to it.
 *
 * In a right-to-left line the word is drawn to the RIGHT of "!", so the blank between them is the "!" glyph's right
 * side-bearing (its advance minus its ink's right edge). Both Nastaliq faces draw "!" themselves, but one shipped a
 * glyph with a wide right bearing, so the gap stayed as wide as the fallback's had been. Read from the shipped bytes
 * (fontkit reads woff2), for the file each @font-face in wq.css serves, at the card's 20 px with the face's
 * size-adjust: the gap must be at most 1.5 CSS px.
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const PX = 20;
const MAX_GAP_PX = 1.5;

// every Nastaliq @font-face whose range carries U+0021: its file and its size-adjust (100% when none)
function bangFaces() {
  const out = [];
  const re = /@font-face\{font-family:"(WQ Nastaliq[^"]*)";src:url\(fonts\/([^)]+)\)([^}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    const range = (/unicode-range:([^;}]+)/.exec(m[3]) || [])[1] || '';
    if (!range.split(',').includes('U+0021')) continue;
    const adj = /size-adjust:(\d+(?:\.\d+)?)%/.exec(m[3]);
    out.push({ family: m[1], file: m[2], adjust: adj ? Number(adj[1]) / 100 : 1 });
  }
  return out;
}

describe('the Urdu "!" sits next to the word before it', () => {
  test('both Nastaliq faces serve "!"', () => {
    expect(bangFaces().map((f) => f.family).sort()).toEqual(['WQ Nastaliq', 'WQ Nastaliq 2']);
  });
  test.each(bangFaces().map((f) => [f.family, f]))('%s: the right side-bearing of "!" is at most 1.5 px at 20 px', (family, f) => {
    const font = fontkit.create(fs.readFileSync(path.join(WQ, 'fonts', f.file)));
    const g = font.glyphForCodePoint(0x21);
    expect(g.id).toBeGreaterThan(0);   // the face draws "!" (not .notdef)
    const gapPx = ((g.advanceWidth - g.bbox.maxX) / font.unitsPerEm) * f.adjust * PX;
    expect(gapPx).toBeLessThanOrEqual(MAX_GAP_PX);
    // the ink is untouched: still a real mark, not shrunk away
    expect(g.bbox.maxX - g.bbox.minX).toBeGreaterThan(0.1 * font.unitsPerEm);
  });
});
