const fs = require('fs');
const path = require('path');

/**
 * bd-ihole (P1, 2026-10-06) — QURANIC TEXT PRINTED A BROKEN CHARACTER.
 *
 * The operator's sandbox plan grade_11_islamiat_c02_p10_ur.pdf quoted «يٰۤاَيُّهَا الَّذِيْنَ اٰمَنُوْا»
 * and the يٰۤ printed as a box. U+06E4 ARABIC SMALL HIGH MADDA is a Quranic annotation mark, and
 * the only Urdu face the renderer embeds — NotoNastaliqUrdu.ttf — has no glyph for it. It also lacks
 * 06D6-06DC, 06DF, 06E2-06E3, 06E5-06E8 and 06EA-06ED: the pause marks, small high/low letters and
 * small waw/yeh that a mushaf-orthography ayah carries. Railway's Chromium has no system fonts, so
 * there is nothing to fall back to.
 *
 * The fix adds Scheherazade New (SIL, OFL — designed for Quranic text) BEHIND Nastaliq. Chrome
 * falls back per grapheme cluster, so only a cluster Nastaliq cannot draw moves to it; every
 * ordinary Urdu line stays Nastaliq. The TEXT IS NOT TOUCHED: stripping or normalising the marks
 * would be editing an ayah, and religious content is never adjudicated in-pipeline.
 *
 * Two layers, both red on the base:
 *   1. the embedded faces, read by their own cmap tables, cover every mark in the ayah;
 *   2. real Chromium paints the ayah with EMBEDDED faces only (CSS.getPlatformFontsForNode) —
 *      on macOS the base falls back to a SYSTEM font, which is exactly what Railway does not have.
 */

// The root suite maps `playwright-core` to a stub (tests/jest.config.js), so the REAL package is
// required by path. CI installs bot/ deps after the root suite and has no browser: the browser
// layer skips there, and the cmap layer above it is the guard that always runs.
let chromium = null;
try {
  chromium = require(path.join(__dirname, '..', '..', 'bot', 'node_modules', 'playwright-core')).chromium;
} catch (_) { /* no browser */ }

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** Al-Ma'idah 5:1's opening as the authored plan quoted it — U+0670 + U+06E4 on the first yeh. */
const AYAH = 'يٰۤاَيُّهَا الَّذِيْنَ اٰمَنُوْا';

/** Every Quranic annotation mark Nastaliq is missing (U+06D6-U+06ED less what it has). */
const QURANIC_MARKS = [
  0x06d6, 0x06d7, 0x06d8, 0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e2, 0x06e3,
  0x06e4, 0x06e5, 0x06e6, 0x06e7, 0x06e8, 0x06ea, 0x06eb, 0x06ec, 0x06ed,
];

function urduDocWithAyah() {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance.medium = 'ur';
  d.provenance.topic = `${AYAH} — آیت کا ترجمہ`;
  return d;
}

const build = () => buildHtml(urduDocWithAyah(), { docDir: path.dirname(FIXTURE), lang: 'ur' }).html;

/** Codepoints mapped by a TrueType cmap (formats 4 and 12 — what these faces ship). */
function cmapCodepoints(buf) {
  const numTables = buf.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('latin1', rec, rec + 4) === 'cmap') cmap = buf.readUInt32BE(rec + 8);
  }
  if (cmap < 0) throw new Error('no cmap table');
  const out = new Set();
  const n = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      for (let s = 0; s < segX2; s += 2) {
        const end = buf.readUInt16BE(ends + s);
        for (let c = buf.readUInt16BE(starts + s); c <= end && c !== 0xffff; c++) out.add(c);
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        const end = Math.min(buf.readUInt32BE(at + 4), 0x10ffff);
        for (let c = buf.readUInt32BE(at); c <= end; c++) out.add(c);
      }
    }
  }
  return out;
}

/** family -> Set(codepoints), for every base64 TTF @font-face the page embeds. */
function embeddedFaces(html) {
  const faces = {};
  const re = /@font-face\{font-family:'([^']+)'[^}]*?url\(data:font\/ttf;base64,([A-Za-z0-9+/=]+)\)/g;
  for (let m; (m = re.exec(html));) {
    const cps = cmapCodepoints(Buffer.from(m[2], 'base64'));
    faces[m[1]] = new Set([...(faces[m[1]] || []), ...cps]);
  }
  return faces;
}

describe('bd-ihole — the Quranic annotation marks have a glyph in an embedded face', () => {
  const html = build();
  const faces = embeddedFaces(html);

  it('still carries the ayah, unaltered (guards against a vacuous pass)', () => {
    expect(html).toContain(AYAH);
    expect(Object.keys(faces)).toContain('Noto Nastaliq Urdu');
  });

  it.each(QURANIC_MARKS.map((c) => [c.toString(16).toUpperCase().padStart(4, '0'), c]))(
    'U+%s is covered by some embedded face',
    (_hex, cp) => {
      const covering = Object.keys(faces).filter((f) => faces[f].has(cp));
      expect(covering).not.toEqual([]);
    },
  );

  it('names the fallback face directly behind Nastaliq in the body stack', () => {
    const sheet = html.slice(0, html.lastIndexOf('</style>')).replace(/url\(data:[^)]*\)/g, 'url(data:)');
    expect(sheet).toMatch(/font-family:'Noto Nastaliq Urdu','Scheherazade New',/);
  });

  it('keeps Nastaliq FIRST — ordinary Urdu is not moved to the fallback', () => {
    const sheet = html.slice(0, html.lastIndexOf('</style>')).replace(/url\(data:[^)]*\)/g, 'url(data:)');
    // A stack LEADING with it — the face's own @font-face declaration is not a stack.
    expect(sheet).not.toMatch(/(?<!@font-face\{)font-family:'Scheherazade New'/);
  });
});

const maybe = chromium ? describe : describe.skip;

maybe('bd-ihole — real Chromium paints the ayah with embedded faces only', () => {
  jest.setTimeout(90000);
  let browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { if (browser) await browser.close(); });

  async function fontsFor(text) {
    const page = await browser.newPage();
    // Appended to the real page, so it inherits the real body stack and the real @font-faces.
    const doc = build().replace('</body>', `<div id="probe">${text}</div></body>`);
    await page.setContent(doc, { waitUntil: 'load' });
    await page.evaluate(() => Promise.allSettled([...document.fonts].map((f) => f.load())).then(() => document.fonts.ready));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#probe' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    await page.close();
    return fonts;
  }

  it('no glyph of the ayah falls through to a system font (Railway has none)', async () => {
    const fonts = await fontsFor(AYAH);
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter((f) => !f.isCustomFont).map((f) => f.familyName)).toEqual([]);
  });

  it('an ordinary Urdu sentence is painted by Nastaliq alone', async () => {
    const fonts = await fontsFor('اگلی کلاس میں اس آیت کا ترجمہ پڑھیں');
    expect(fonts.map((f) => f.familyName)).toEqual(['Noto Nastaliq Urdu']);
  });
});
