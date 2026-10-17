/**
 * Web quiz page, Urdu: both Nastaliq faces draw "!" (U+0021) themselves.
 *
 * Why: neither subset carried "!" and neither @font-face unicode-range listed it, so every Urdu "!"
 * on the child pages came from the fallback sans, next to Nastaliq drawn at size-adjust 155%, and read
 * as a gap before the mark. The subsets are rebuilt with the same recipe plus U+0021, and both ranges
 * gain that one token.
 *
 * /wq is cached for a year (immutable) and the font URLs carry no ?v=, so the rebuilt faces ship under
 * new file names (wq-nastaliq-3 and -4); a phone that cached the old files fetches the new ones.
 *
 * The fonts are decoded here from the shipped bytes (fontkit reads woff2). The fixture records each
 * file's sha256 and code points (written by the subset build), so the font and its record cannot drift.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fontkit = require('fontkit');
const { renderQuizPage } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const RECORD = require('./fixtures/nastaliq-cmap.json');
const BANG = 0x21;

// The two faces exactly as the stylesheet declares them: as before, with the new file names and ",U+0021" at the end of each range.
const FACE_1 = '@font-face{font-family:"WQ Nastaliq";src:url(fonts/wq-nastaliq-3.woff2) format("woff2");font-display:swap;size-adjust:155%;'
  + 'unicode-range:U+0600-06FF,U+00A0,U+00AB,U+00BB,U+200C-200F,U+2066-2069,U+25CC,U+0020,U+0021}';
const FACE_2 = '@font-face{font-family:"WQ Nastaliq 2";src:url(fonts/wq-nastaliq-4.woff2) format("woff2");font-weight:400;font-display:swap;'
  + 'unicode-range:U+0020,U+00A0,U+00AB,U+00BB,U+060C,U+061B,U+061F,U+0621-063A,U+0640-0656,U+0658,U+0660-066D,U+0670,U+0679,U+067E,'
  + 'U+0686,U+0688,U+0691,U+0698,U+06A9,U+06AF,U+06BA,U+06BE,U+06C0-06C3,U+06CC,U+06D2-06D4,U+06F0-06F9,U+200C-200F,U+25CC,U+0021}';

function faces() {
  const out = {};
  const re = /@font-face\{font-family:"(WQ Nastaliq[^"]*)";src:url\(fonts\/([^)]+)\)[^}]*unicode-range:([^;}]+)[^}]*\}/g;
  let m;
  while ((m = re.exec(CSS))) out[m[2]] = { family: m[1], range: m[3], decl: m[0] };
  return out;
}

function covers(range, cp) {
  return range.split(',').some((tok) => {
    const [a, b] = tok.trim().replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16));
    return cp >= a && cp <= (b === undefined ? a : b);
  });
}

// cmap code points; fontkit also lists the format-4 end marker U+FFFF, which no subset maps.
function cmapOf(file) {
  const font = fontkit.openSync(path.join(WQ, 'fonts', file));
  return { font, cps: font.characterSet.filter((cp) => cp !== 0xFFFF).sort((x, y) => x - y) };
}

describe('the Urdu Nastaliq faces draw "!" themselves', () => {
  const FILES = ['wq-nastaliq-3.woff2', 'wq-nastaliq-4.woff2'];

  test('the stylesheet declares exactly these two faces', () => {
    expect(Object.keys(faces()).sort()).toEqual(FILES);
  });

  test.each(FILES)('%s maps U+0021 to a glyph with ink', (file) => {
    const { font } = cmapOf(file);
    expect(font.hasGlyphForCodePoint(BANG)).toBe(true);
    const glyph = font.glyphForCodePoint(BANG);
    expect(glyph.id).toBeGreaterThan(0);
    expect(glyph.bbox.maxY - glyph.bbox.minY).toBeGreaterThan(0);
  });

  test.each(FILES)('the unicode-range of %s sends U+0021 to it', (file) => {
    expect(covers(faces()[file].range, BANG)).toBe(true);
  });

  test.each(FILES)('%s: shipped bytes = the recorded sha256, decoded cmap = the recorded code points, which hold U+0021', (file) => {
    const rec = RECORD[file];
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(WQ, 'fonts', file))).digest('hex');
    expect(sha).toBe(rec.sha256);
    expect(cmapOf(file).cps).toEqual(rec.codepoints);
    expect(rec.codepoints).toContain(BANG);
  });

  test('every font the Urdu pages preload or the stylesheet declares is a shipped file whose sha256 is the recorded one', () => {
    const Q = (extra) => ({
      quiz: { id: 'q-1', code: 'AB12CD', topic: 'پودے', lang: 'ur', dir: 'rtl', grade: '3', n: 1,
        questions: [{ qid: 'x1', i: 1, text: 'کون سا؟', options: [{ slot: 'A', text: 'جڑ' }, { slot: 'B', text: 'پتا' }], correct_slot: 'A' }] },
      cls: { label: 'جماعت 3', teacher: 'استاد', chips: [] }, live: {}, video: null, preview: false, ...extra,
    });
    const preloads = [{}, { ui: { ur2: true } }].map((extra) => {
      const html = renderQuizPage({ payload: Q(extra), code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
      return /<link rel="preload" href="\/wq\/fonts\/([^"]+)" as="font"/.exec(html)[1];
    });
    const named = [...new Set([...preloads, ...Object.keys(faces())])].sort();
    expect(named).toEqual(FILES);
    for (const file of named) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(WQ, 'fonts', file))).digest('hex');
      expect(RECORD[file] && RECORD[file].sha256).toBe(sha);
    }
  });

  test('golden: each face declaration is the old one with only its new file name and ",U+0021" in its range', () => {
    const f = faces();
    expect(f['wq-nastaliq-3.woff2'].decl).toBe(FACE_1);
    expect(f['wq-nastaliq-4.woff2'].decl).toBe(FACE_2);
    expect(CSS.split('U+0021').length - 1).toBe(2);
  });
});
