/**
 * The end screen's polish (app_settings web_quiz_end_polish → the bot's `end_polish: true` beside the card's field;
 * default OFF).
 *  - ZR-1: the Urdu end headline keeps «سے» with the number after it and breaks only after that number
 *    («آپ نے ۷ میں سے ۰» / «درست کیے»), so no line starts with a lone «۰».
 *  - CB-1: when the practice line and a compare box both show on the card, the line is the box's heading (one box).
 *  - DG-2: one child on the Urdu page in words, «ایک بچے نے کھیلا» (a lone ۱ reads as alif).
 *  - LH-1: a Latin school name on the Urdu league is its own left-to-right box at a Latin line height.
 *  - VL-1: a wrong answer's voice line speaks the page's language (an English page of an Urdu lesson: the English clip).
 * Off (absent or anything but JSON true): every screen is today's, byte for byte.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const ON = { end_polish: true };
const OFFS = [[{}], [{ end_polish: false }], [{ end_polish: 'true' }], [{ end_polish: 1 }]];
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const NB = ' ';
const norm = (h) => h.replace(/(<div class="wq-say">)[\s\S]*?<\/div>/, '$1*</div>');

// ─── ZR-1: the Urdu end headline ────────────────────────────────────────────

const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
async function end(lang, bootExtra, correct = 0) {
  const res = { score: { correct, total: 7 }, card: {} };
  const p = page({ lang, store: store(res), bootExtra, api: { '/finish': res } });
  p.wq.results(0);
  for (let k = 0; k < 6; k += 1) await flush();
  expect(p.moment()).toBe('M9');
  return norm(p.html());
}
const h1 = (h) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(h)[1].replace(/<[^>]+>/g, '');

describe('ZR-1 on: the Urdu headline breaks after its number, never before it', () => {
  test.each([[{ end_fit: true, end_short: true }], [{ end_fit: true, end_short: true, end_copy: true }]])('end_short %j: the one break is after the number', async (extra) => {
    for (const n of [0, 3]) {
      const t = h1(await end('ur', { ...extra, ...ON }, n));
      const d = '۰۱۲۳'[n] || '';
      expect(t).toBe(`آپ${NB}نے${NB}۷${NB}میں${NB}سے${NB}${d} درست${NB}کیے`);
    }
  });
  test.each([[{}], [{ end_fit: true }]])('%j: «سے» holds its number', async (extra) => {
    const t = h1(await end('ur', { ...extra, ...ON }, 0));
    expect(t).toBe(`آپ نے ۷ میں سے${NB}۰ درست کیے`);
  });
  test('English keeps today\'s headline', async () => {
    expect(await end('en', { end_fit: true, end_short: true, ...ON }, 0)).toBe(await end('en', { end_fit: true, end_short: true }, 0));
  });
});

// ─── CB-1: the practice line heads the compare box ──────────────────────────

const replay = (card, vs, extra = {}) => ({ wq_s_TEST: { st: 'st1', child: CHILD, answers: {}, queue: [],
  result: { card: { first: 'Zara', animal: 'owl', correct: 3, total: 7, practice: true, kept: { correct: 3, total: 7 }, ...card }, challenge_code: 'CH12AB', vs, ...extra } } });
const VS = { first: 'Testwala', correct: 4, total: 7, outcome: 'lose' };
const LINE = { en: 'Practice round · your first try counts', ur: 'مشق کا راؤنڈ · صرف پہلی بار کا اسکور گنا جاتا ہے' };
describe('CB-1 on: one box, the practice line its heading', () => {
  test.each(['en', 'ur'])('%s: the replay card with its compare box', (lang) => {
    const p = page({ lang, store: replay({}, VS), bootExtra: { share_page_lang: true, end_copy: true, ...ON } });
    p.wq.card();
    const h = p.html();
    expect(h).toContain(`<div class="wq-banner wq-vs wq-cb"><span class="wq-cbh">${LINE[lang]}</span><b>`);
    expect(h).not.toContain(`<div class="wq-banner">${LINE[lang]}</div>`);
    expect(h.split('class="wq-banner').length - 1).toBe(1);
    // the verdict and the scores one line under the heading; the score card marked for a short phone
    expect(h).toMatch(/<span class="wq-cbh">[^<]+<\/span><b>[^<]+<\/b> /);
    expect(h).toContain('<div class="wq-scorecard wq-sccb"><header>');
  });
  test('a friend\'s challenge (no compare box): the practice line stays its own box', () => {
    const p = page({ lang: 'ur', store: replay({}, undefined), bootExtra: { share_page_lang: true, end_copy: true, ...ON } });
    p.wq.card();
    expect(p.html()).toContain('<div class="wq-banner">');
    expect(p.html()).not.toContain('wq-cb');
    expect(p.html()).not.toContain('wq-sccb');
  });
  test.each(['en', 'ur'])('%s: the folded card, the practice line over a new best', (lang) => {
    const st = replay({ correct: 6, best: { correct: 3, total: 7 } }, undefined, { card_fold: true });
    const p = page({ lang, store: st, bootExtra: ON });
    p.wq.card();
    const h = p.html();
    expect(h).toMatch(/<div class="wq-banner wq-best wq-cb"><span class="wq-cbh">[^<]+<\/span>/);
    expect(h).toContain('<div class="wq-scorecard wq-sccb"><header>');
    expect(h.split('class="wq-banner').length - 1).toBe(1);
    const off = page({ lang, store: st, bootExtra: {} });
    off.wq.card();
    expect(off.html().split('class="wq-banner').length - 1).toBe(2);
  });
  test('the stylesheet: the heading is a line of its own', () => {
    expect(CSS).toContain('.wq-banner .wq-cbh{display:block;');
    // a short phone: the score card drops Jugnu's picture when the box shows, so the buttons stay on the first screen
    expect(CSS).toContain('@media (max-height:680px){.wq-scorecard.wq-sccb .wq-in{gap:4px}.wq-scorecard.wq-sccb .wq-in>img{display:none}}');
  });
});

// ─── DG-2 + LH-1: the school league ─────────────────────────────────────────

const SCH = (name, kids, extra = {}) => ({ week_start: '2026-10-19', rows: [{ place: 1, name, sector: 'ict', points: 90, kids, move: 0, mine: true }],
  mine: { place: 1, name, sector: 'ict', points: 90, kids, move: 0 }, ranked_n: 1, zero_n: 0, ...extra });
async function league(lang, body, bootExtra = {}) {
  const p = page({ lang, store: store({ card: { first: 'Zara', correct: 3, total: 5 }, score: { correct: 3, total: 5 } }), board: { finishers_n: 0, rows: [] }, api: { '/schools/TEST': body }, bootExtra });
  p.wq.board(); await flush();
  p.els['#wq-schools'].fire('click');
  await flush();
  return p.html();
}
describe('DG-2 on: one child in words on the Urdu league', () => {
  test('Urdu: «ایک بچے نے کھیلا», two keep their number', async () => {
    const h = await league('ur', SCH('School Alpha', 1), ON);
    expect(h).toContain('ایک بچے نے کھیلا');
    expect(h).not.toContain('۱ بچے نے کھیلا');
    expect(await league('ur', SCH('School Alpha', 2), ON)).toContain('۲ بچوں نے کھیلا');
  });
  test('the Urdu polish too', async () => {
    const h = await league('ur', SCH('School Alpha', 1), { ...ON, ui: { ur2: true } });
    expect(h).toContain('ایک بچے نے کھیلا');
  });
  test('English: today\'s count', async () => {
    expect(await league('en', SCH('School Alpha', 1), ON)).toBe(await league('en', SCH('School Alpha', 1)));
  });
});
describe('LH-1 on: a Latin school name on the Urdu league', () => {
  test('its own left-to-right box', async () => {
    const h = await league('ur', SCH('Testwala Model School', 4), ON);
    expect(h).toMatch(/<span class="wq-sname"><bdi dir="ltr" class="wq-slat">(<span class="wq-lat" lang="en">)?Testwala Model School(<\/span>)?<\/bdi>/);
  });
  test('an Urdu name, and English: today\'s box', async () => {
    expect(await league('ur', SCH('ٹیسٹ والا اسکول', 4), ON)).toContain('<span class="wq-sname"><bdi>ٹیسٹ والا اسکول</bdi>');
    expect(await league('en', SCH('Testwala Model School', 4), ON)).toBe(await league('en', SCH('Testwala Model School', 4)));
  });
  test('the stylesheet: a Latin line height on it', () => {
    expect(CSS).toContain('html[lang=ur] .wq-sname .wq-slat{display:inline-block;max-width:100%;line-height:1.3;text-align:right}');
  });
});

// ─── VL-1: the wrong-answer voice follows the page ──────────────────────────

const TAIL = '  else landing();\n})();';
function fakeEl(sel) {
  return {
    sel, listeners: {}, attrs: {}, style: {}, textContent: '', innerHTML: '',
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, scrollIntoView() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
function fbPage(quizLang, ui, bootExtra) {
  const voiced = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.listeners = {}; voiced.push({ url }); }
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
    play() { (this.listeners.playing || []).forEach((f) => f()); return Promise.resolve(); }
    pause() {} canPlayType() { return 'probably'; }
  }
  const els = {};
  const root = fakeEl('#wq');
  root.querySelector = (sel) => { if (!els[sel]) els[sel] = fakeEl(sel); return els[sel]; };
  root.querySelectorAll = () => [];
  const boot = { textContent: JSON.stringify({ code: 'TEST', ui_lang: ui, cls: { label: 'Class 1', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null, ...bootExtra,
    quiz: { code: 'TEST', lang: quizLang, voice_lang: quizLang, topic: 'Plants', grade: 1, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }], correct_slot: 'A' }] } }) };
  const ctx = {
    console, URLSearchParams,
    document: {
      visibilityState: 'visible', getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: (t) => (t === 'audio' ? { canPlayType: () => 'probably' } : fakeEl(t)),
      addEventListener() {}, querySelectorAll: () => [], dispatchEvent() { return true; }, body: fakeEl('body'),
      documentElement: { lang: ui, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    },
    location: { search: '', origin: 'https://example.test' }, navigator: { userAgent: 'test' },
    localStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    Audio: FakeAudio,
    AudioContext: function AudioContext() { return { state: 'running', suspend() { return Promise.resolve(); }, resume() { return Promise.resolve(); } }; },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => { voiced.push({ text: u.text }); }, cancel() {} },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, scrollTo() {}, Image: function Image() {}, addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { feedback: feedback };\n})();'), ctx);
  return { wq: ctx.__wq, els, voiced };
}
const UR_Q = () => ({ qid: 'q1', i: 1, text: 'قمیض کا رنگ کیا ہے؟', correct_slot: 'B', options: [{ slot: 'A', text: 'قمیض' }, { slot: 'B', text: 'سرخ' }] });
const UR_TF = () => ({ qid: 'q1', i: 1, type: 'tf', text: 'سورج گرم ہے۔', correct_slot: 'A', options: [{ slot: 'A', text: 'درست' }, { slot: 'B', text: 'غلط' }] });
describe('VL-1 on: an English page of an Urdu lesson says "not yet" in English', () => {
  test.each([[UR_Q, 'notyet'], [UR_TF, 'tftrue']])('%#: the English clip, the English line', (q, set) => {
    const p = fbPage('ur', 'en', ON);
    p.wq.feedback(q(), 0, 'B', false, false);
    expect(p.voiced[0].url).toMatch(new RegExp(`^/wq/voice/en/${set}-\\d+\\.mp3`));
    expect(p.els['#wq-fb'].innerHTML).not.toMatch(/<div class="wq-fb wq-no">[^<]*(ابھی نہیں|یہ والا نہیں|کوئی بات نہیں|آئیں مل کر|یہ سوال مشکل|اس بار نہیں|کوشش سے)/);
  });
  test('a right answer, and the Urdu page: today\'s voice', () => {
    const r = fbPage('ur', 'en', ON);
    r.wq.feedback(UR_Q(), 0, 'B', true, false);
    expect(r.voiced[0].url).toMatch(/^\/wq\/voice\/ur\/right-/);
    const u = fbPage('ur', 'ur', ON);
    u.wq.feedback(UR_Q(), 0, 'A', false, false);
    expect(u.voiced[0].url).toMatch(/^\/wq\/voice\/ur\/notyet-/);
  });
  test.each(OFFS)('off %j: the lesson\'s voice, as today', (off) => {
    const p = fbPage('ur', 'en', off);
    p.wq.feedback(UR_Q(), 0, 'A', false, false);
    expect(p.voiced[0].url).toMatch(/^\/wq\/voice\/ur\/notyet-/);
  });
});

// ─── off: today's screens, byte for byte ────────────────────────────────────

describe('off: every screen is today\'s', () => {
  test.each(OFFS)('boot %j', async (off) => {
    for (const lang of ['en', 'ur']) {
      for (const extra of [{}, { end_fit: true, end_short: true }, { end_fit: true, end_short: true, end_copy: true }]) {
        expect(await end(lang, { ...extra, ...off })).toBe(await end(lang, extra));
      }
      for (const st of [replay({}, VS), replay({ correct: 6, best: { correct: 3, total: 7 } }, undefined, { card_fold: true })]) {
        const a = page({ lang, store: st, bootExtra: { share_page_lang: true, end_copy: true, ...off } }); a.wq.card();
        const b = page({ lang, store: st, bootExtra: { share_page_lang: true, end_copy: true } }); b.wq.card();
        expect(a.html()).toBe(b.html());
      }
      expect(await league(lang, SCH('Testwala Model School', 1), off)).toBe(await league(lang, SCH('Testwala Model School', 1)));
    }
  });
});
