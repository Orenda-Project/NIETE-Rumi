'use strict';
/**
 * The teacher home's own script, RUN on the page the server builds (not read as text): the "try it as" row under the
 * foot, the send sheet's "Send to my class" link, and the message box's size. The page opens on a small DOM, its one
 * fetch of the home answers with the JSON each test chooses, and the test taps what a teacher would tap. Only the
 * browser boundary is stood in for (fetch, sendBeacon, Blob, location, timers); the script and the HTML are the
 * server's own.
 */
process.env.WHATSAPP_BOT_NUMBER = ['1555', '000', '1111'].join('');
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const vm = require('vm');
const Page = require('../../shared/services/first-touch/teacher-home.page');
const { parse } = require('./_mini-dom');

const El = parse('<i></i>').children[0].constructor;
/** The mini DOM's element, with the few things this page also touches (built nodes, events, the message box). */
class PageEl extends El {
  constructor(tag, attrs, parent) { super(tag, attrs || {}, parent || null); this.on = []; this.style = {}; this.scrollHeight = 0; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get rows() { return Number(this.getAttribute('rows')); }
  set rows(v) { this.setAttribute('rows', v); }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  insertAdjacentHTML(where, html) { if (where !== 'beforeend') throw new Error(`unsupported ${where}`); adopt(parse(html)).children.forEach((c) => this.appendChild(c)); }
  addEventListener(type, fn) { this.on.push({ type, fn }); }
  focus() {} select() {} setSelectionRange() {}
}
function adopt(n) { Object.setPrototypeOf(n, PageEl.prototype); n.on = []; n.style = {}; n.scrollHeight = 0; n.children.forEach(adopt); return n; }

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };

/**
 * Opens the page in `lang` with the home answering `home` (or refusing with `status`, or failing with `status: 'offline'`);
 * `answer(path, body)` answers every other fetch.
 * → { q, tap(el), fetches, beacons, location }.
 */
async function open(home, { lang = 'en', answer = () => ({}), status = 200 } = {}) {
  const { html } = Page.buildShell({ token: 'a.b', lang, switchTo: null });
  const doc = adopt(parse(html));
  const fetches = [];
  const beacons = [];
  const location = { assigned: [], reloads: 0, reload() { this.reloads += 1; }, set href(v) { this.assigned.push(v); }, get href() { return this.assigned[this.assigned.length - 1] || ''; } };
  class Blob { constructor(parts) { this.text = parts.join(''); } }
  const window = {
    document: {
      getElementById: (id) => doc.querySelector(`#${id}`),
      querySelector: (s) => doc.querySelector(s),
      querySelectorAll: (s) => doc.querySelectorAll(s),
      createElement: (t) => new PageEl(t),
      createTextNode: (t) => Object.assign(new PageEl('#text'), { text: String(t) }),
      execCommand: () => false,
    },
    addEventListener() {},
    scrollTo() {},
    history: { pushState() {}, back() {} },
    location,
    navigator: { sendBeacon: (p, blob) => { beacons.push({ path: p, body: JSON.parse(blob.text) }); return true; } },
    Blob,
    setTimeout() {},
    fetch: (p, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      fetches.push({ path: p, body });
      const isHome = p.indexOf('/api/th/home?') === 0;
      if (isHome && status === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      const code = isHome ? status : 200;
      const out = isHome ? home : answer(p, body);
      return Promise.resolve({ ok: code >= 200 && code < 300, status: code, json: () => Promise.resolve(out) });
    },
    JSON, String, Array, Object, Promise, Number, Boolean, RegExp,
  };
  window.window = window;
  const ctx = vm.createContext(window);
  doc.querySelectorAll('script').filter((s) => !s.getAttribute('type')).forEach((s) => vm.runInContext(s.text, ctx));
  await flush();
  const q = (s) => doc.querySelector(s);
  if (status === 200) expect(q('#th-main').getAttribute('data-ready')).toBe('1');
  const tap = async (el) => {
    for (let e = el; e; e = e.parentNode) (e.on || []).filter((h) => h.type === 'click').forEach((h) => h.fn({ target: el, preventDefault() {} }));
    await flush();
  };
  return { q, tap, fetches, beacons, location };
}

const LIB = { grade: 4, stories: [] };
const WALK = '<section data-screen="walk"><p>Try it as</p><button type="button" data-persona="student">A child</button><button type="button" data-persona="teacher">A teacher</button></section>';

describe('the "try it as" row', () => {
  const home = (html) => ({ primary: { kind: 'none' }, library: LIB, walk: { html, t: 'GO.TOKEN_abc' } });

  test('the row goes in; a tap posts the choice to the one door and follows the landing link it answers', async () => {
    const p = await open(home(WALK), { answer: () => ({ next: '/quiz/go/LANDING_1' }) });
    const w = p.q('#th-walk');
    expect(w.hidden).toBe(false);
    expect(w.querySelectorAll('[data-persona]')).toHaveLength(2);
    await p.tap(w.querySelector('[data-persona="student"]'));
    expect(p.fetches.filter((f) => f.path === '/api/go/persona')).toEqual([{ path: '/api/go/persona', body: { t: 'GO.TOKEN_abc', as: 'student' } }]);
    expect(p.location.assigned).toEqual(['/quiz/go/LANDING_1']);
  });

  test('an answer that is not a landing link is never followed; the error line shows instead', async () => {
    const p = await open(home(WALK), { answer: () => ({ next: 'https://elsewhere.example/quiz/go/x' }) });
    await p.tap(p.q('#th-walk').querySelector('[data-persona="teacher"]'));
    expect(p.fetches.filter((f) => f.path === '/api/go/persona').map((f) => f.body)).toEqual([{ t: 'GO.TOKEN_abc', as: 'teacher' }]);
    expect(p.location.assigned).toEqual([]);
    expect(p.q('#th-err').hidden).toBe(false);
  });

  test('a row of any other shape is not put on the page', async () => {
    const p = await open(home('<div><button type="button" data-persona="student">A child</button></div>'));
    expect(p.q('#th-walk').children).toHaveLength(0);
    expect(p.q('#th-walk').querySelectorAll('[data-persona]')).toHaveLength(0);
  });
});

describe('"Send to my class" on the sheet', () => {
  const MSG = 'Assalam o Alaikum class! Your teacher sent you a quiz.';
  const WA = `https://wa.me/?text=${encodeURIComponent(MSG)}`;
  const shareTaps = (p) => [...p.beacons, ...p.fetches].filter((x) => x.path === '/api/th/step' && x.body && x.body.step === 'share_tap');

  test('a library video quiz: the link is the server\'s send route for its code, and the tap sends no share beacon', async () => {
    const p = await open({ primary: { kind: 'video', id: 'vq1', title: 'Fractions', send: { message: MSG, wa: WA, c: 'code-1' } }, library: LIB });
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    expect(p.q('#th-sheet').hidden).toBe(false);
    expect(p.q('#th-sheet-go').getAttribute('href')).toBe('/quiz/teacher/a.b/send?c=code-1&o=library&lang=en');
    await p.tap(p.q('#th-sheet-go'));
    expect(shareTaps(p)).toEqual([]);
  });

  test('a shared quiz sent again: the link goes through the send route too, with no share beacon', async () => {
    const p = await open({ primary: { kind: 'none' }, library: LIB, timeline: [{ kind: 'quiz', verb: 'again', sendKind: 'share', id: 'sq1', title: 'Plants' }] },
      { answer: (path) => (path === '/api/th/send' ? { message: MSG, wa: WA, c: 'code 2' } : {}) });
    await p.tap(p.q('#th-rows').querySelector('[data-tap="again"]'));
    expect(p.q('#th-sheet-go').getAttribute('href')).toBe('/quiz/teacher/a.b/send?c=code%202&o=again&lang=en');
    await p.tap(p.q('#th-sheet-go'));
    expect(shareTaps(p)).toEqual([]);
  });

  test('the teacher\'s own quiz, even with its code: the link is its WhatsApp link, and the tap sends the share beacon', async () => {
    const p = await open({ primary: { kind: 'class', played: 0, title: 'Seasons', again: { id: 'own1' }, send: { message: MSG, wa: WA, c: 'own-code', sendKind: 'again' } }, library: LIB });
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    expect(p.q('#th-sheet-go').getAttribute('href')).toBe(WA);
    await p.tap(p.q('#th-sheet-go'));
    expect(p.beacons).toEqual([{ path: '/api/th/step', body: { t: 'a.b', step: 'share_tap', kind: 'again', id: 'own1', origin: 'again', c: 'own-code' } }]);
  });});

describe('the message box', () => {
  const LONG = {
    en: 'Assalam o Alaikum class! Your teacher sent you a quiz: Fractions.\nOpen it here: https://portal.example/q/ABCDEF\nPlay it at home and see your score.\n\nWhen you have played, tap here to tell your teacher you are done and to see more quizzes from the class.',
    ur: 'السلام علیکم بچو! آپ کے استاد نے کوئز بھیجا ہے: کسر۔\nیہاں کھولیں: https://portal.example/q/ABCDEF\nگھر پر کھیلیں اور اپنا اسکور دیکھیں۔\n\nکھیلنے کے بعد یہاں دبائیں تاکہ آپ کے استاد کو پتا چلے اور مزید کوئز ملیں۔',
  };
  const SHORT = { en: 'Hello class', ur: 'سلام بچو' };

  test.each(['en', 'ur'])('%s: each time the sheet opens, the box has the rows msgRows gives for that card\'s message', async (lang) => {
    const ur = lang === 'ur';
    const msg = { long1: LONG[lang], short1: SHORT[lang] };
    const p = await open({
      primary: { kind: 'none' },
      library: LIB,
      timeline: Object.keys(msg).map((id) => ({ kind: 'quiz', verb: 'again', sendKind: 'share', id, title: id })),
    }, { lang, answer: (path, body) => (path === '/api/th/send' ? { message: msg[body.id], wa: 'https://wa.me/?text=x', c: body.id } : {}) });
    const [a, b] = p.q('#th-rows').querySelectorAll('[data-tap="again"]');
    expect(Page.msgRows(LONG[lang], ur)).toBeGreaterThan(9);
    expect(Page.msgRows(SHORT[lang], ur)).toBeLessThan(7);

    await p.tap(a);
    expect(p.q('#th-msg').value).toBe(LONG[lang]);
    expect(p.q('#th-msg').rows).toBe(Page.msgRows(LONG[lang], ur));
    await p.tap(p.q('#th-back'));
    await p.tap(b);
    expect(p.q('#th-msg').value).toBe(SHORT[lang]);
    expect(p.q('#th-msg').rows).toBe(Page.msgRows(SHORT[lang], ur));
    await p.tap(a);
    expect(p.q('#th-msg').rows).toBe(Page.msgRows(LONG[lang], ur));
  });
});

describe('when the home cannot load', () => {
  const CHAT = `https://wa.me/${['1555', '000', '1111'].join('')}?text=quiz`;

  test('a stale link (410) reloads the page once, and shows no error', async () => {
    const p = await open({}, { status: 410 });
    expect(p.location.reloads).toBe(1);
    expect(p.q('#th-err').hidden).toBe(true);
  });

  test.each([404, 500, 503, 'offline'])('a refusal (%s) never reloads: the error line shows with ONE tap back to the chat', async (status) => {
    const p = await open({}, { status });
    expect(p.location.reloads).toBe(0);
    expect(p.q('#th-err').hidden).toBe(false);
    const go = p.q('#th-err-go');
    expect(go.hidden).toBe(false);
    expect(go.getAttribute('href')).toBe(CHAT);
    expect(p.q('#th-main').getAttribute('data-ready')).toBe('err');
  });
});
