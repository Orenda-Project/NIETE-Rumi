/**
 * The Urdu share words read right to left (app_settings web_quiz_share_bidi → the bot's `share_bidi: true` beside the
 * card's field, and the mint's `bidi`; default OFF).
 *  - BIDI-2: the class table's Urdu share text starts in Urdu, the quiz's title isolated («آپ کی کلاس کی لیگ ٹیبل:
 *    ⁨Proper Fraction⁩۔ …»), and the sheet's (or today's fallback screen's) preview box is RTL; the class link's Urdu
 *    preview isolates the title too.
 *  - BIDI-3: on the own card's Urdu sheet the title line is «⁨title⁩» as text (first-strong isolate inside the
 *    guillemets), and the Urdu share text's title line starts with a right-to-left mark, so a chat app draws it RTL.
 *  - DOOR-1: on an Urdu door under the look, an English quiz title sits on the right like the line under it.
 *  - OB-1: in the Urdu star lines a number keeps the word after it (U+00A0), so «۱» never ends a line without «ستارہ».
 * Off (absent or anything but JSON true): every word, sheet, door and preview is today's, byte for byte.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const { page, flush } = require('./wq-page-harness');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const NB = ' ';
const ON = { share_bidi: true };
const OFFS = [[{}], [{ share_bidi: false }], [{ share_bidi: 'true' }], [{ share_bidi: 1 }]];
const TABLES = [['today\'s', {}, []], ['the corrected share words', { ur_share: true }, []], ['the polish', { ur_share: true }, ['wq-ur2']]];

// ─── BIDI-2: the class table's share ────────────────────────────────────────

const CHILD = { first: 'Sana', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Sana', animal: 'owl', correct: 1, total: 6, stars: 1 }, challenge_code: 'CHAL12', score: { correct: 1, total: 6, pct: 17 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const BOARD = { finishers_n: 1, class_avg_pct: 17, rows: [], more_n: 0 };
async function board({ lang = 'ur', extra = {}, htmlClass = [], sheet = true, cls, topic = 'Proper Fraction' } = {}) {
  const p = page({ lang, topic, board: BOARD, store: finished(), bootExtra: { ...(sheet ? { share_v4: true } : {}), ...extra }, htmlClass, ...(cls ? { cls } : {}) });
  p.ctx.document.head = { appendChild() {} };
  p.wq.board();
  await flush(); await flush(); await flush();
  const calls = [];
  if (sheet) p.ctx.WQFC = { shareArt: (o) => calls.push(o) };
  p.els['#wq-share-t'].fire('click');
  return { p, calls };
}

describe.each(TABLES)('BIDI-2 on, Urdu, %s table', (_n, extra, htmlClass) => {
  test('the sheet gets Urdu first (an RLM, the class and the title isolated), and an RTL box', async () => {
    const { calls } = await board({ extra: { ...extra, ...ON }, htmlClass, cls: { chips: [] } });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/^‏⁨آپ کی کلاس⁩ کی لیگ ٹیبل: ⁨Proper Fraction⁩۔ /);
    expect(calls[0].bidi).toBe(true);
    // a teacher's Latin class label never leads the line either
    const b = await board({ extra: { ...extra, ...ON }, htmlClass });
    expect(b.calls[0].text).toMatch(/^‏⁨[^⁩]*3-B⁩ کی لیگ ٹیبل: ⁨Proper Fraction⁩۔ /);
  });
  test('a short title keeps its spaces (one piece in the RTL lines); a long one (over 24 letters) may wrap', async () => {
    const short = await board({ extra: { ...extra, ...ON }, htmlClass, cls: { chips: [] } });
    expect(short.calls[0].text).toContain(`⁨Proper${NB}Fraction⁩`);
    const long = await board({ extra: { ...extra, ...ON }, htmlClass, cls: { chips: [] }, topic: 'Adding and Subtracting Like Fractions' });
    expect(long.calls[0].text).toContain('⁨Adding and Subtracting Like Fractions⁩');
  });
  test('the fallback screen (no sheet): the same words, the box RTL', async () => {
    const { p } = await board({ extra: { ...extra, ...ON }, htmlClass, sheet: false });
    expect(p.html()).toContain('<div class="wq-card"><p dir="rtl">‏');
  });
});

describe('BIDI-2 off, or English: today\'s class table share', () => {
  test.each(OFFS)('Urdu, boot %j', async (off) => {
    for (const [, t, htmlClass] of TABLES) {
      const a = await board({ extra: { ...t, ...off }, htmlClass });
      const b = await board({ extra: t, htmlClass });
      expect(a.calls).toEqual(b.calls.map((c) => ({ ...c, ev: a.calls[0].ev })));
      expect(a.calls[0].text).toMatch(/^Proper Fraction: /);
      expect('bidi' in a.calls[0]).toBe(false);
      const c = await board({ extra: { ...t, ...off }, htmlClass, sheet: false });
      const d = await board({ extra: t, htmlClass, sheet: false });
      expect(c.p.html()).toBe(d.p.html());
      expect(c.p.html()).toContain('<div class="wq-card"><p><span class="wq-lat" lang="en">Proper Fraction:');
    }
  });
  test('English, on: today\'s words, no bidi', async () => {
    const a = await board({ lang: 'en', extra: ON });
    const b = await board({ lang: 'en' });
    expect(a.calls[0].text).toBe(b.calls[0].text);
    expect('bidi' in a.calls[0]).toBe(false);
  });
});

// ─── the sheet (wq-finish-card.js): BIDI-2's box, BIDI-3's title line ────────

const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
function fc() {
  const ctx = { window: {}, document: {}, location: { origin: 'https://portal.example' }, navigator: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  return ctx.WQFC;
}
const IMG = '/wq/card/Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg.png';
const URL_ = 'https://portal.example/k/Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const TABLE_TEXT = 'Proper Fraction: آپ کی کلاس کی لیگ ٹیبل۔ ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے:\nhttps://example.test/q/TEST/class?v=1';

describe('the sheet, on', () => {
  const FC = fc();
  const text = (lang, title, bidi) => FC.shareText({ lang, deed: 'quiz_done', title, url: URL_, v4: true, bidi });
  test('BIDI-2: an Urdu table text\'s box is RTL', () => {
    const h = FC.sheetHtml({ lang: 'ur', img: IMG, text: TABLE_TEXT, url: 'https://example.test/q/TEST/class?v=1', bidi: true });
    expect(h).toContain('<div class="wqfc-sh-msg"><p class="wqfc-sh-rtl" dir="rtl">Proper Fraction: آپ کی کلاس');
    // the Urdu words' size and line height, as the auto box has them
    expect(FC.SHEET_CSS).toContain('[lang="ur"] .wqfc-sh-msg p.wqfc-sh-rtl{font-size:18px;line-height:1.9}');
  });
  test('BIDI-3: the Urdu share text\'s title line starts with an RLM, the title isolated inside «»', () => {
    expect(text('ur', 'Proper Fraction', true).split('\n')[1]).toBe('‏«⁨Proper Fraction⁩»');
  });
  test('BIDI-3: on the Urdu sheet the title line is «⁨title⁩» as text in an RTL line (with one or without)', () => {
    for (const one of [true, undefined]) {
      const h = FC.sheetHtml({ lang: 'ur', img: IMG, text: text('ur', 'Proper Fraction', true), url: URL_, iso: true, one, bidi: true });
      expect(h).toContain('<p class="wqfc-sh-ttl wqfc-sh-lat" dir="rtl">‏«⁨Proper Fraction⁩»</p>');
      expect(h).not.toContain('<bdi');
    }
    const ur = FC.sheetHtml({ lang: 'ur', img: IMG, text: text('ur', 'پودے', true), url: URL_, iso: true, bidi: true });
    expect(ur).toContain('<p class="wqfc-sh-ttl" dir="rtl">‏«⁨پودے⁩»</p>');
  });
  test('English: text and sheet are today\'s', () => {
    expect(text('en', 'Proper Fraction', true)).toBe(text('en', 'Proper Fraction'));
    const en = { lang: 'en', img: IMG, text: text('en', 'Proper Fraction'), url: URL_, iso: true };
    expect(FC.sheetHtml({ ...en, bidi: true })).toBe(FC.sheetHtml(en));
    const t = { lang: 'en', img: IMG, text: 'Class 3 league table for Plants.\nhttps://x.test/q/T/class', url: 'https://x.test/q/T/class' };
    expect(FC.sheetHtml({ ...t, bidi: true })).toBe(FC.sheetHtml(t));
  });
});

describe('the sheet, off: today\'s', () => {
  const FC = fc();
  test.each([[undefined], [false], ['true'], [1]])('bidi %j', (bidi) => {
    const tx = FC.shareText({ lang: 'ur', deed: 'quiz_done', title: 'Proper Fraction', url: URL_, v4: true });
    expect(FC.shareText({ lang: 'ur', deed: 'quiz_done', title: 'Proper Fraction', url: URL_, v4: true, bidi })).toBe(tx);
    for (const o of [{ lang: 'ur', img: IMG, text: tx, url: URL_, iso: true }, { lang: 'ur', img: IMG, text: tx, url: URL_, iso: true, one: true },
      { lang: 'ur', img: IMG, text: TABLE_TEXT, url: 'https://example.test/q/TEST/class?v=1' }]) {
      expect(FC.sheetHtml({ ...o, bidi })).toBe(FC.sheetHtml(o));
    }
  });
});

// ─── DOOR-1: the door's English title on an Urdu card ─────────────────────────

const door = ({ lang = 'ur', extra = {}, htmlClass = ['wq-adv'], challenge = { first: 'Sana', correct: 1, total: 6 } } = {}) =>
  page({ lang, topic: 'Proper Fraction', challenge, bootExtra: extra, htmlClass }).html();
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');

describe('DOOR-1', () => {
  test('on, Urdu, the look: the English title keeps its LTR words and sits on the right (wq-ttlr)', () => {
    for (const ch of [{ first: 'Sana', correct: 1, total: 6 }, null]) {
      expect(door({ extra: ON, challenge: ch })).toContain('<h1 dir="ltr" class="wq-ttlr"><span class="wq-lat" lang="en">Proper Fraction</span></h1>');
    }
    expect(CSS).toMatch(/html\.wq-adv\[lang=ur\] \.wq-card h1\.wq-ttlr\[dir=ltr\]\{text-align:right\}/);
  });
  test('on: an Urdu title, and an English door, are today\'s', () => {
    expect(page({ lang: 'ur', topic: 'پودے', bootExtra: ON, htmlClass: ['wq-adv'] }).html()).toBe(page({ lang: 'ur', topic: 'پودے', htmlClass: ['wq-adv'] }).html());
    expect(door({ lang: 'en', extra: ON })).toBe(door({ lang: 'en' }));
  });
  test.each(OFFS)('off %j: today\'s door', (off) => {
    expect(door({ extra: off })).toBe(door());
    expect(door()).toContain('<h1 dir="ltr"><span class="wq-lat" lang="en">Proper Fraction</span></h1>');
  });
});

// ─── OB-1: a number keeps its word in the Urdu star lines ────────────────────

const store = (c, n) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: { ...RESULT, card: { ...RESULT.card, correct: c, total: n, stars: c }, score: { correct: c, total: n } } } });
const waHref = (p) => {
  const m = /id="wq-wa" href="([^"]+)"/.exec(p.html());
  return m ? decodeURIComponent(m[1].replace(/&amp;/g, '&')) : null;
};
function shares({ lang = 'ur', c = 1, n = 6, extra = {}, htmlClass = [] } = {}) {
  return ['#wq-share', '#wq-chal'].map((id) => {
    const p = page({ lang, topic: 'Proper Fraction', store: store(c, n), bootExtra: extra, htmlClass });
    p.tap();
    p.els[id].fire('click');
    return waHref(p);
  });
}
const friend = ({ lang = 'ur', c = 1, extra = {}, htmlClass = [] } = {}) => page({ lang, topic: 'Proper Fraction', challenge: { first: 'Sana', correct: c, total: 6 }, bootExtra: extra, htmlClass }).html();
// a digit (either system, maybe isolated) then a plain space: what OB-1 removes from the star lines
const LOOSE = /[0-9۰-۹]⁩? (?=\S)/;

describe.each(TABLES)('OB-1 on, Urdu, %s table', (_n, extra, htmlClass) => {
  for (const [one, c] of [['one star', 1], ['stars', 3]]) {
    test(`${one}: the card's share and the challenge keep each number with its word`, () => {
      for (const s of shares({ c, extra: { ...extra, ...ON }, htmlClass })) {
        const line = s.split(' https://')[0];
        expect(line).not.toMatch(LOOSE);
        expect(line).toMatch(new RegExp(`[6۶]⁩?${NB}میں سے`));
      }
    });
    test(`${one}: the friend's page line`, () => {
      const h = friend({ c, extra: { ...extra, ...ON }, htmlClass });
      const line = /<div class="wq-banner[^"]*">([^<]*)<\/div>/.exec(h)[1];
      expect(line).not.toMatch(LOOSE);
      expect(line).toMatch(new RegExp(`[${c}${String.fromCharCode(0x06F0 + c)}]⁩?${NB}ستار`));
    });
  }
});

describe('OB-1 off, or English: today\'s lines', () => {
  test.each(OFFS)('Urdu %j', (off) => {
    for (const [, t, htmlClass] of TABLES) {
      expect(shares({ extra: { ...t, ...off }, htmlClass })).toEqual(shares({ extra: t, htmlClass }));
      expect(friend({ extra: { ...t, ...off }, htmlClass })).toBe(friend({ extra: t, htmlClass }));
    }
    expect(shares()[0]).toMatch(LOOSE);
  });
  test('English, on', () => {
    expect(shares({ lang: 'en', extra: ON })).toEqual(shares({ lang: 'en' }));
    expect(friend({ lang: 'en', extra: ON })).toBe(friend({ lang: 'en' }));
  });
});

// ─── BIDI-2: the class link's Urdu preview ───────────────────────────────────

describe('BIDI-2: the class link preview (og:title)', () => {
  const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
  const quiz = (extra = {}) => ({ quiz: { id: 'q', code: 'AB12CD', topic: 'Proper Fraction', lang: 'ur', dir: 'rtl', n: 5, questions: [] },
    cls: { label: 'جماعت 5', chips: [] }, live: {}, video: null, preview: false, brand: 'niete', art: { class: null, invite: null, schools: null }, ...extra });
  let srv; let payload;
  beforeEach(async () => {
    const app = express();
    app.set('trust proxy', true);
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, fetchImpl: async (url) => {
      if (/\/api\/internal\/wq\/og\//.test(url)) return jsonRes(404, { error: 'not_found' });
      if (/\/api\/internal\/wq\/card\/[^/]+$/.test(url)) return jsonRes(404, { error: 'not_found' });
      return jsonRes(200, payload);
    } }));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  const get = (p) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method: 'GET', agent: false, headers: { host: 'portal.example', 'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/129 Mobile', 'x-forwarded-proto': 'https' } }, (res) => {
      const ch = [];
      res.on('data', (x) => ch.push(x));
      res.on('end', () => resolve(Buffer.concat(ch).toString('utf8')));
    });
    r.on('error', reject);
    r.end();
  });
  const ogTitle = (h) => ((/<meta property="og:title" content="([^"]*)"/.exec(h) || [])[1] || '');
  test('on: the title isolated', async () => {
    for (const extra of [{}, { card_v3: true }, { ur_share: true }]) {
      payload = quiz({ ...extra, ...ON });
      expect(ogTitle(await get('/q/AB12CD/class'))).toMatch(/^⁨Proper Fraction⁩ · /);
    }
  });
  test.each(OFFS)('off %j: today\'s', async (off) => {
    payload = quiz(off);
    const a = ogTitle(await get('/q/AB12CD/class'));
    payload = quiz();
    expect(a).toBe(ogTitle(await get('/q/AB12CD/class')));
    expect(a).toMatch(/^Proper Fraction · /);
  });
});

// ─── UD-1: the school league's Urdu share line says the place in Urdu digits («نمبر ۲», as the board) ────────────

const SCH_ART = 's.TEST.qrstuvwxyzab';
const SCHOOLS2 = { 'schools/': { rows: [{ place: 1, name: 'School Alpha', sector: 'ict', points: 1072, kids: 4, move: 0 }, { place: 2, name: 'School Beta', sector: 'ict', points: 687, kids: 6, move: 0, mine: true }], mine: { place: 2, name: 'School Beta', sector: 'ict', points: 687, kids: 6, move: 0 }, ranked_n: 2, zero_n: 0 } };
async function schoolsShare({ lang = 'ur', extra = {} } = {}) {
  const p = page({ lang, topic: 'Proper Fraction', board: BOARD, store: finished(), art: { schools: SCH_ART }, api: SCHOOLS2, bootExtra: { share_v4: true, ...extra } });
  p.ctx.document.head = { appendChild() {} };
  p.wq.board();
  await flush(); await flush(); await flush();
  p.els['#wq-schools'].fire('click');
  await flush(); await flush(); await flush();
  const calls = [];
  p.ctx.WQFC = { shareArt: (o) => calls.push(o) };
  p.els['#wq-share-s'].fire('click');
  return { p, calls };
}

describe('UD-1: the school league share', () => {
  test('on, Urdu: «نمبر ۲», the place kept with its word, from an RLM with the name isolated', async () => {
    const { calls } = await schoolsShare({ extra: ON });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].text).toBe(`‏⁨School Beta⁩ اس ہفتے سب اسکولوں میں نمبر ۲${NB}پر ہے۔ کھیلیں اور اسے اوپر لے جائیں:`);
    expect(calls[0].text).not.toMatch(/[0-9]/);
  });
  test.each(OFFS)('off (boot %j): today\'s words', async (off) => {
    const { p, calls } = await schoolsShare({ extra: off });
    expect(calls[0].text).toBe(p.wq.T.schoolsLine('School Beta', 2));
    expect(calls[0].text).toContain('نمبر 2 پر ہے');
  });
  test('English, on: today\'s words', async () => {
    const { p, calls } = await schoolsShare({ lang: 'en', extra: ON });
    expect(calls[0].text).toBe('School Beta is #2 of all schools this week. Play and help us climb:');
    expect(p.wq.T.schoolsLine('School Beta', 2)).toBe(calls[0].text);
  });
});

// ─── SC-2: the Urdu practice note ends with «۔» ─────────────────────────────

const PRACTICE_FINISH = {
  score: { correct: 2, total: 5, pct: 40 }, counted: false, reason: 'already_finished', card_v3: true,
  card: { first: 'Zara', animal: 'owl', correct: 2, total: 5, stars: 2, practice: true, kept: { correct: 4, total: 5 } },
};
const PLAYING = { wq_s_TEST: { st: 'new-st', child: { first: 'Zara', chip: 'c1', animal: 'owl' }, answers: { q1: { slot: 'B', ok: false } }, queue: [], result: null } };
async function practiceEnd(lang, extra) {
  const p = page({ lang, store: PLAYING, api: { finish: PRACTICE_FINISH }, bootExtra: extra });
  p.wq.S.st = 'new-st';
  p.wq.results(0);
  await flush(); await flush(); await flush();
  return p.html();
}
describe('SC-2: the practice note', () => {
  test('on, Urdu: «… ۴/۵ شمار ہوتا ہے۔»', async () => {
    expect(await practiceEnd('ur', ON)).toContain('پہلی بار کا اسکور ۴/۵ شمار ہوتا ہے۔');
  });
  test.each(OFFS)('off (boot %j): today\'s note, no «۔»', async (off) => {
    const h = await practiceEnd('ur', off);
    expect(h).toContain('پہلی بار کا اسکور ۴/۵ شمار ہوتا ہے');
    expect(h).not.toContain('شمار ہوتا ہے۔');
  });
  test('English, on: today\'s note', async () => {
    expect(await practiceEnd('en', ON)).toContain('Practice round · your first score 4/5 is the one that counts<');
  });
});
