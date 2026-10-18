/**
 * The light Urdu face (app_settings web_quiz_face_lite, default off; the bot's answers say `ui: {ur2: true, fl: true}`).
 * On, every polished-look Urdu child page draws with wq-nastaliq-7 (the polished face with its outlines on an 8-unit
 * grid: same glyphs, cmap, advances and layout tables, ~11% fewer bytes), declares it in the head, and preloads it in
 * place of -6, so a page fetches one face. Off (no `fl`, or anything but JSON true), every page is today's, byte for
 * byte (the one-face goldens, captured before this change). Test strings only: no real child names.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const fontkit = require('fontkit');
const R = require('../routes/web-quiz.routes');
const { QUIZ, HUB, MENU, ORIGIN, ASSET_V, HUB_TOKEN } = require('./fixtures/one-urdu-face-cases');

const GOLDEN = require('./fixtures/one-urdu-face-off-golden.json');
const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const RECORD = require('../scripts/face-lite/record.json');
const SIX = '/wq/fonts/wq-nastaliq-6.woff2';
const LITE = '/wq/fonts/wq-nastaliq-7.woff2';

const nastaliqUrls = (html) => [...new Set(html.match(/\/wq\/fonts\/wq-nastaliq-[0-9]+\.woff2/g) || [])];
const fontPreloads = (html) => (html.match(/<link rel="preload" href="[^"]+" as="font"[^>]*>/g) || []).map((t) => t.match(/href="([^"]+)"/)[1]);
const htmlTag = (html) => html.match(/<html [^>]*>/)[0];

function pages(ui, lang = 'ur', more = {}) {
  const x = { ...more, ...(ui ? { ui } : {}) };
  return {
    quiz: R.renderQuizPage({ payload: QUIZ(lang, x), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ASSET_V }),
    hub: R.renderHubPage({ payload: HUB(lang, x), token: HUB_TOKEN, origin: ORIGIN, assetV: ASSET_V }),
    lib: R.renderLibPage({ hub: HUB_TOKEN, kid: 'k1', lang, origin: ORIGIN, assetV: ASSET_V, brandKey: 'niete', ui }),
    challenge: R.renderChallengePage({ menu: MENU(lang, x), token: HUB_TOKEN, kid: null, origin: ORIGIN, assetV: ASSET_V, chV: 'ch1', brandKey: 'niete' }),
    closed: R.renderClosedPage({ lang, kind: 'closed', origin: ORIGIN, assetV: ASSET_V, brandKey: 'niete', ui }),
  };
}

describe('light face on: every polished Urdu child page names -7 and nothing else', () => {
  const on = pages({ ur2: true, fl: true });
  it.each(Object.keys(on))('%s: one Nastaliq URL, -7, preloaded and declared in the head', (name) => {
    const html = on[name];
    expect(nastaliqUrls(html)).toEqual([LITE]);
    expect(fontPreloads(html)).toEqual([LITE]);
    expect(htmlTag(html)).toBe('<html lang="ur" dir="rtl" class="wq-ur2 wq-fl">');
    expect(html).toContain('<style id="wq-fl">@font-face{font-family:"WQ Nastaliq 2L";src:url(/wq/fonts/wq-nastaliq-7.woff2) format("woff2");font-weight:400;font-display:swap;');
    expect(html).toContain('html.wq-fl.wq-ur2[lang=ur]{--fu:"WQ Nastaliq 2L",');
    expect(html.indexOf('<style id="wq-fl">')).toBeGreaterThan(html.indexOf('<link rel="stylesheet" href="/wq/wq.css'));
  });

  it('with the one face too: both classes, still only -7', () => {
    const p = pages({ ur2: true, fl: true, uf: true });
    for (const html of [p.lib, p.closed]) {
      expect(htmlTag(html)).toBe('<html lang="ur" dir="rtl" class="wq-ur2 wq-uf wq-fl">');
      expect(nastaliqUrls(html)).toEqual([LITE]);
    }
  });

  it('the head declares the light face with exactly -6\'s range from wq.css (same characters, same fallback)', () => {
    const six = /@font-face\{font-family:"WQ Nastaliq 2";src:url\(fonts\/wq-nastaliq-6\.woff2\)[^}]*unicode-range:([^;}]+)/.exec(CSS)[1];
    const lite = /<style id="wq-fl">@font-face\{[^}]*unicode-range:([^;}]+)/.exec(on.quiz)[1];
    expect(lite).toBe(six);
  });
});

describe('light face off: today\'s pages, byte for byte', () => {
  // the head is what the switch moves; the boot JSON below it carries the payload as the bot sent it
  const headOf = (html) => html.slice(0, html.indexOf('</head>'));

  it('the bot\'s off answer (no fl): the one-face goldens, whole pages', () => {
    const p = pages({ ur2: true });
    expect(p.quiz).toBe(GOLDEN.quiz_ur_ur2);
    expect(p.hub).toBe(GOLDEN.hub_ur_ur2);
    expect(p.lib).toBe(GOLDEN.lib_ur_ur2);
    expect(p.challenge).toBe(GOLDEN.challenge_ur_ur2);
    expect(p.closed).toBe(GOLDEN.closed_ur_ur2);
  });

  it.each([['fl: "true" (a string)', { ur2: true, fl: 'true' }], ['fl: 1', { ur2: true, fl: 1 }], ['fl: false', { ur2: true, fl: false }]])('%s: today\'s head', (_n, ui) => {
    const p = pages(ui);
    expect(headOf(p.quiz)).toBe(headOf(GOLDEN.quiz_ur_ur2));
    expect(headOf(p.hub)).toBe(headOf(GOLDEN.hub_ur_ur2));
    expect(p.closed).toBe(GOLDEN.closed_ur_ur2);
  });

  it('fl without the polished look, or on an English page: today\'s head', () => {
    expect(headOf(pages({ fl: true }).quiz)).toBe(headOf(GOLDEN.quiz_ur_plain));
    expect(headOf(pages({ ur2: true, fl: true }, 'en').quiz)).toBe(headOf(GOLDEN.quiz_en_ur2));
    expect(headOf(pages({ ur2: true, fl: true }, 'en').hub)).toBe(headOf(GOLDEN.hub_en_ur2));
  });
});

describe('the light face file', () => {
  const six = fontkit.openSync(path.join(FONTS, 'wq-nastaliq-6.woff2'));
  const lite = fontkit.openSync(path.join(FONTS, 'wq-nastaliq-7.woff2'));
  const bytes = fs.readFileSync(path.join(FONTS, 'wq-nastaliq-7.woff2'));

  it('is the recorded cut of today\'s -6, at least 10% smaller', () => {
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(RECORD.sha256);
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(FONTS, 'wq-nastaliq-6.woff2'))).digest('hex')).toBe(RECORD.source_sha256);
    expect(bytes.length).toBe(RECORD.bytes);
    expect(bytes.length).toBeLessThanOrEqual(Math.floor(RECORD.source_bytes * 0.9));
    expect(RECORD.max_move_units).toBeLessThanOrEqual(4);
  });

  it('same characters, glyphs, advances and line metrics as -6', () => {
    expect(lite.characterSet).toEqual(six.characterSet);
    expect(lite.numGlyphs).toBe(six.numGlyphs);
    for (let g = 0; g < six.numGlyphs; g += 1) expect(lite.getGlyph(g).advanceWidth).toBe(six.getGlyph(g).advanceWidth);
    expect([lite.unitsPerEm, lite.ascent, lite.descent, lite.lineGap]).toEqual([six.unitsPerEm, six.ascent, six.descent, six.lineGap]);
  });

  // the raw tables after the woff2 wrapper: the shaping tables (GSUB joins and stacks, GPOS mark and dot places, GDEF
  // classes) must be -6's bytes; only the outlines (glyf, its loca, head/hhea extents) and two hinting/naming extras moved
  const rawTables = (file) => {
    const f = fontkit.openSync(path.join(FONTS, file));
    f._decompress();
    const out = {};
    for (const [tag, e] of Object.entries(f.directory.tables)) out[tag] = e.transformed ? null : Buffer.from(f.stream.buffer.subarray(e.offset, e.offset + e.length));
    return out;
  };
  it('GSUB, GPOS and GDEF are -6\'s bytes; only the outlines changed, STAT and gasp dropped', () => {
    const a = rawTables('wq-nastaliq-6.woff2');
    const b = rawTables('wq-nastaliq-7.woff2');
    for (const tag of ['GSUB', 'GPOS', 'GDEF', 'cmap', 'hmtx', 'OS/2', 'maxp', 'post']) {
      expect(b[tag]).toBeInstanceOf(Buffer);
      expect(b[tag].equals(a[tag])).toBe(true);
    }
    expect([a.GSUB.length, a.GPOS.length, a.GDEF.length]).toEqual([414690, 24538, 516]);
    expect(Object.keys(a).filter((t) => !(t in b)).sort()).toEqual(['STAT', 'gasp']);
    expect(Object.keys(b).filter((t) => !(t in a))).toEqual([]);
    expect(Object.keys(b).filter((t) => b[t] && !b[t].equals(a[t])).sort()).toEqual(['head', 'hhea', 'name']);
    expect(['fpgm', 'prep', 'cvt ', 'hdmx'].filter((t) => t in a)).toEqual([]); // -6 carries no hinting to lose
  });

  it('every Urdu string the pages carry shapes to the same glyphs at the same places', () => {
    const words = ['میں نے آج پوری کہانی اونچی آواز میں پڑھی!', 'السلام علیکم!', 'آپ کے کوئز اور ویڈیوز', 'اس ہفتے کی کہانی',
      'پڑھنے کی کہانیاں', 'کہانیوں کی کتابیں', 'دائرہ مربع تکون معین', 'سبز بٹن دبائیں، پھر واٹس ایپ میں بھیجنے کا بٹن دبائیں۔', '۱۲۳ ٹھیک جواب'];
    const shape = (f, s) => { const r = f.layout(s); return r.glyphs.map((g, i) => [g.id, r.positions[i].xAdvance, r.positions[i].xOffset, r.positions[i].yOffset]); };
    for (const s of words) expect(shape(lite, s)).toEqual(shape(six, s));
  });

  it('the static server keeps it a year, like every versioned face', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'routes', 'web-quiz-static.js'), 'utf8')).toContain('const FONT_RX = /^\\/fonts\\/wq-nastaliq-\\d+\\.woff2$/;');
  });
});

// ── through the router: the shells keep the light face from the last answer; a fast head never draws an undeclared face
const BOT = 'http://bot.test';
function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, chunks, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}
function build(answers) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(R.createWebQuizRouter({ botUrl: BOT, apiKey: 'test-internal-key', fetchImpl: () => Promise.resolve(answers.shift()) }));
  return app;
}

describe('light face through the router', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  const FL = { ui: { ur2: true, fl: true } };

  it('the hub, then the library and closed shells: -7 only', async () => {
    srv = await start(build([jsonRes(200, HUB('ur', FL))]));
    const hub = await get(srv, `/h/${HUB_TOKEN}?nf=1`, { 'accept-language': 'ur' });
    expect(nastaliqUrls(hub.body)).toEqual([LITE]);
    const lib = await get(srv, `/lib/${HUB_TOKEN}?kid=k1&l=ur`);
    expect(nastaliqUrls(lib.body)).toEqual([LITE]);
    const closed = await get(srv, '/c/bad?lang=ur');
    expect(nastaliqUrls(closed.body)).toEqual([LITE]);
  });

  it('the fast first page with the light face guessed: the head names -7; the page keeps it', async () => {
    const ur = QUIZ('ur', { fast: true, ...FL });
    srv = await start(build([jsonRes(200, ur), jsonRes(200, ur)]));
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/AB12CD');
    expect(fontPreloads(res.chunks[0])).toEqual([LITE]);
    expect(nastaliqUrls(res.body)).toEqual([LITE]);
    expect(res.body).not.toMatch(/classList\.(add|remove)\("wq-fl"\)/);
  });

  it('a fast head that guessed the light face for a page without it takes the class off (back to -6, declared by wq.css)', async () => {
    srv = await start(build([jsonRes(200, QUIZ('ur', { fast: true, ...FL })), jsonRes(200, QUIZ('ur', { fast: true, ui: { ur2: true } }))]));
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/AB12CD');
    expect(res.body).toContain('h.classList.remove("wq-fl")');
  });

  it('a fast head without the light face for a page with it adds nothing (the page draws with the -6 it preloaded)', async () => {
    srv = await start(build([jsonRes(200, QUIZ('ur', { fast: true, ui: { ur2: true } })), jsonRes(200, QUIZ('ur', { fast: true, ...FL }))]));
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/AB12CD');
    expect(fontPreloads(res.chunks[0])).toEqual([SIX]);
    expect(res.body).not.toMatch(/wq-fl/);
  });
});
