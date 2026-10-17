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
 * Opens the page in `lang` with the home answering `home` (or refusing with `status`, or failing with `status: 'offline'`,
 * or never answering with `status: 'hang'` until the test calls `release(json)` on the oldest home fetch still open);
 * `paged` builds the page with the quick answer's switch ON;
 * `answer(path, body)` answers every other fetch.
 * → { q, tap(el), fetches, beacons, location, release }.
 */
async function open(home, { lang = 'en', answer = () => ({}), status = 200, timers = [], clock = null, backThrows = false, paged = false } = {}) {
  const { html } = Page.buildShell({ token: 'a.b', lang, switchTo: null, ...(paged ? { paged: true } : {}) });
  const doc = adopt(parse(html));
  const fetches = [];
  const beacons = [];
  const held = [];
  const release = async (json) => { held.shift()({ ok: true, status: 200, json: () => Promise.resolve(json) }); await flush(); };
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
    history: { pushState() {}, back() { if (backThrows) throw new Error('no history'); } },
    location,
    navigator: { sendBeacon: (p, blob) => { beacons.push({ path: p, body: JSON.parse(blob.text) }); return true; } },
    Blob,
    setTimeout(fn, ms) { timers.push(Object.assign(fn, { ms })); },
    fetch: (p, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      fetches.push({ path: p, body });
      const isHome = p.indexOf('/api/th/home?') === 0;
      if (isHome && status === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      if (isHome && status === 'hang') return new Promise((r) => held.push(r));
      const code = isHome ? status : 200;
      const out = isHome ? home : answer(p, body);
      return Promise.resolve({ ok: code >= 200 && code < 300, status: code, json: () => Promise.resolve(out) });
    },
    JSON, String, Array, Object, Promise, Number, Boolean, RegExp,
  };
  if (clock) window.Date = class extends Date { static now() { return clock.t; } };
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
  return { q, tap, fetches, beacons, location, release };
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

describe('a story the teacher sent this month', () => {
  const SENT = '2026-10-12T12:00:00.000Z';
  const lib = (stories) => ({ primary: { kind: 'none' }, library: { grade: 3, stories, all: '/all' } });
  const STORIES = [{ id: 'b1', title: 'The Thirsty Crow', href: '/s?book=b1', sent: SENT }, { id: 'b2', title: 'Rain', href: '/s?book=b2' }];

  test.each([['en', 'Sent \u2713 12/10'], ['ur', 'بھیجی گئی \u2713 ۱۲/۱۰']])('%s: only the sent book\'s row shows when it was sent, next to its title (not a button)', async (lang, chip) => {
    const p = await open(lib(STORIES), { lang });
    const [a, b] = p.q('#th-stories').querySelectorAll('[data-row="story"]');
    const c = a.querySelector('.th-sent');
    expect(c.textContent).toBe(chip);
    expect(c.tagName).toBe('SPAN');
    expect(c.getAttribute('data-tap')).toBeNull();
    expect(c.parentNode.getAttribute('class')).toBe('th-row-n');
    expect(b.querySelectorAll('.th-sent')).toHaveLength(0);
    expect(b.querySelector('.th-row-n').textContent).toBe('Rain');
  });

  test('another grade: the rows follow the library the server answers', async () => {
    const p = await open(lib(STORIES), { answer: (path) => (path.indexOf('/api/th/library?') === 0 ? { grade: 4, stories: [{ id: 'b5', title: 'Kites', href: '/s?book=b5', sent: SENT }, { id: 'b1', title: 'The Thirsty Crow', href: '/s?book=b1' }] } : {}) });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="4"]'));
    const rows = p.q('#th-stories').querySelectorAll('[data-row="story"]');
    expect(rows.map((r) => r.querySelectorAll('.th-sent').length)).toEqual([1, 0]);
  });
});

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

describe('"My lessons" rows', () => {
  const row = (p, i) => p.q('#th-rows').querySelectorAll('li')[i];

  test('a sent quiz that can no longer be sent again keeps its played count and its report link, with no "Send again"', async () => {
    const p = await open({ primary: { kind: 'none' }, library: LIB, timeline: [
      { kind: 'lp', verb: null, id: null, sendKind: null, played: 15, report: '/r/live-1', title: 'Fractions' },
      { kind: 'quiz', verb: null, id: null, sendKind: null, played: 0, title: 'Plants' },
    ] });
    expect(row(p, 0).querySelector('.th-row-k').textContent).toBe('Lesson plan · 15 in your class played');
    expect(row(p, 0).querySelector('[data-tap="report"]').href).toBe('/r/live-1');
    expect(row(p, 0).querySelector('[data-tap="again"]')).toBeNull();
    expect(row(p, 1).querySelector('.th-row-k').textContent).toBe('Quiz sent · No one in your class has played yet');
    expect(row(p, 1).querySelector('[data-tap="report"]')).toBeNull();
    expect(row(p, 1).querySelector('[data-tap="again"]')).toBeNull();
  });

  test('a row that can be sent again: count, "Send again", then the report link, as before; a lesson with no quiz has no count', async () => {
    const p = await open({ primary: { kind: 'none' }, library: LIB, timeline: [
      { kind: 'lp', verb: 'again', id: 'q1', sendKind: 'again', played: 3, report: '/r/live-2', title: 'Seasons' },
      { kind: 'lp', verb: 'quiz_this', id: 'lp_9', make: 'lesson', sendKind: null, title: 'Water' },
    ] });
    expect(row(p, 0).querySelector('.th-row-k').textContent).toBe('Lesson plan · 3 in your class played');
    expect(row(p, 0).children.map((c) => c.getAttribute('data-tap'))).toEqual([null, 'again', 'report']);
    expect(row(p, 1).querySelector('.th-row-k').textContent).toBe('Lesson plan');
    expect(row(p, 1).querySelector('[data-tap="report"]')).toBeNull();
  });
});

describe('"Quiz this" starts one quiz, wherever it is tapped', () => {
  const LESSON = { kind: 'lp', verb: 'quiz_this', id: 'lp_9', make: 'lesson', sendKind: null, title: 'Water' };
  const home = () => ({ primary: { kind: 'lesson', id: 'lp_9', make: 'lesson', from: 'lp', title: 'Water' }, library: LIB, timeline: [{ ...LESSON }] });
  const answer = (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' } : {});
  const makes = (p) => p.fetches.filter((f) => f.path === '/api/th/quiz/make');
  const rowOf = (p) => p.q('#th-rows').querySelectorAll('li')[0];

  test('from the top card: the same lesson\'s row no longer offers "Quiz this" and says the quiz is being made', async () => {
    const p = await open(home(), { answer });
    await p.tap(p.q('#th-top').querySelector('[data-tap="quiz_this"]'));
    expect(makes(p)).toHaveLength(1);
    expect(rowOf(p).querySelector('[data-tap="quiz_this"]')).toBeNull();
    expect(rowOf(p).textContent).toContain('Making your quiz…');
  });

  test('from the row: the top card no longer offers "Quiz this" for that lesson and says the quiz is being made', async () => {
    const p = await open(home(), { answer });
    await p.tap(rowOf(p).querySelector('[data-tap="quiz_this"]'));
    expect(makes(p)).toHaveLength(1);
    expect(p.q('#th-top').querySelector('[data-tap="quiz_this"]')).toBeNull();
    expect(p.q('#th-top').textContent).toContain('Making your quiz…');
  });

  test('once the quiz is ready: the top card sends it and the row offers "Send again" for that quiz', async () => {
    const timers = [];
    const p = await open(home(), { timers, answer: (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' }
      : path.indexOf('/api/th/quiz/qz1?') === 0 ? { state: 'ready', title: 'Water', message: 'M', wa: 'https://wa.me/?text=M' }
        : path === '/api/th/send' ? { message: 'M', wa: 'https://wa.me/?text=M' } : {}) });
    await p.tap(p.q('#th-top').querySelector('[data-tap="quiz_this"]'));
    timers.splice(0).forEach((fn) => fn());
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    expect(p.q('#th-top').querySelector('[data-tap="send"]')).not.toBeNull();
    expect(rowOf(p).querySelector('[data-tap="quiz_this"]')).toBeNull();
    await p.tap(rowOf(p).querySelector('[data-tap="again"]'));
    expect(p.fetches.filter((f) => f.path === '/api/th/send').map((f) => [f.body.kind, f.body.id])).toEqual([['again', 'qz1']]);
  });

  test('a refused make leaves both buttons as they were', async () => {
    const p = await open(home(), { answer: (path) => (path === '/api/th/quiz/make' ? {} : {}) });
    await p.tap(p.q('#th-top').querySelector('[data-tap="quiz_this"]'));
    expect(rowOf(p).querySelector('[data-tap="quiz_this"]')).not.toBeNull();
    expect(p.q('#th-top').querySelector('[data-tap="quiz_this"]')).not.toBeNull();
  });
});

describe('the home\'s answer does not come (switch quiz_teacher_home_paged ON)', () => {
  const HOME = { primary: { kind: 'none' }, library: LIB };
  const homeFetches = (p) => p.fetches.filter((f) => f.path.indexOf('/api/th/home?') === 0);
  const fire15 = async (timers) => { timers.splice(0).filter((fn) => fn.ms === 15000).forEach((fn) => fn()); await new Promise((r) => setImmediate(r)); };

  test('nothing after 15 s: the error line and «Try again» show (never a skeleton with no word); a tap asks again and draws the home', async () => {
    const timers = [];
    const p = await open(HOME, { status: 'hang', timers, paged: true });
    expect(p.q('#th-retry').hidden).toBe(true);
    expect(p.q('#th-err').hidden).toBe(true);
    expect(timers.map((fn) => fn.ms)).toContain(15000);
    await fire15(timers);
    expect(p.q('#th-err').hidden).toBe(false);
    expect(p.q('#th-retry').hidden).toBe(false);
    expect(p.q('#th-retry').textContent).toBe('Try again');
    expect(p.q('#th-main').getAttribute('data-ready')).toBe('err');
    expect(p.beacons.map((x) => x.body.step)).toEqual(['home_slow']);
    await p.tap(p.q('#th-retry'));
    expect(homeFetches(p)).toHaveLength(2);
    expect(homeFetches(p)[1].path).toBe(homeFetches(p)[0].path);
    expect(p.q('#th-retry').hidden).toBe(true);
    expect(p.q('#th-err').hidden).toBe(true);
    expect(p.beacons.map((x) => x.body.step)).toEqual(['home_slow', 'home_retry']);
    await p.release(HOME); // the first ask answers late: the home is drawn once, and the second answer changes nothing
    expect(p.q('#th-main').getAttribute('data-ready')).toBe('1');
    await p.release({ primary: { kind: 'none' }, library: { grade: 2, stories: [] } });
    expect(p.q('#th-chosen').textContent).toMatch(/4/);
  });

  test('a stale 15 s timer from the first ask never shows the error over a second ask still on its way', async () => {
    const timers = [];
    const p = await open(HOME, { status: 'hang', timers, paged: true });
    const first = timers.splice(0).filter((fn) => fn.ms === 15000);
    first.forEach((fn) => fn());
    await new Promise((r) => setImmediate(r));
    await p.tap(p.q('#th-retry'));
    first.forEach((fn) => fn()); // the first ask's timer again (already fired): nothing
    expect(p.q('#th-err').hidden).toBe(true);
    expect(p.q('#th-retry').hidden).toBe(true);
  });

  test('an answer inside 15 s: the timer finds the home drawn and does nothing', async () => {
    const timers = [];
    const p = await open(HOME, { timers, paged: true });
    await fire15(timers);
    expect(p.q('#th-err').hidden).toBe(true);
    expect(p.q('#th-retry').hidden).toBe(true);
    expect(p.q('#th-main').getAttribute('data-ready')).toBe('1');
    expect(p.beacons).toEqual([]);
  });

  test.each([500, 'offline'])('a refusal (%s): the error line, its tap back to the chat, and «Try again» that asks again', async (status) => {
    const p = await open({}, { status, paged: true });
    expect(p.q('#th-err').hidden).toBe(false);
    expect(p.q('#th-retry').hidden).toBe(false);
    await p.tap(p.q('#th-retry'));
    expect(homeFetches(p)).toHaveLength(2);
  });

  test('Urdu: the button reads the signed words of the error line', () => {
    const { html } = Page.buildShell({ token: 'a.b', lang: 'ur', switchTo: null, paged: true });
    expect(html).toContain('id="th-retry" type="button" hidden>دوبارہ کوشش کریں</button>');
  });
});

describe('switch OFF: today\'s page', () => {
  const crypto = require('crypto');
  const GOLD = require('./__goldens__/teacher-home-shell-off.json');
  test('the shell, byte for byte as today\'s (18 shapes: language × switch link × asked; recorded on the base)', () => {
    const now = GOLD.map(({ lang, switchTo, asked }) => {
      const b = Page.buildShell({ token: 'a.b-c_D', lang, switchTo, asked });
      return { lang, switchTo, asked, sha256: crypto.createHash('sha256').update(`${b.html}\n${b.csp}`).digest('hex') };
    });
    if (process.env.TEACHER_HOME_RECORD === '1') require('fs').writeFileSync(require('path').join(__dirname, '__goldens__', 'teacher-home-shell-off.json'), `${JSON.stringify(now, null, 1)}\n`);
    expect(now).toEqual(GOLD);
  });
  test('an answer that never comes: no timer of 15 s, no «Try again» (today\'s page)', async () => {
    const timers = [];
    const p = await open({ primary: { kind: 'none' }, library: LIB }, { status: 'hang', timers });
    expect(timers.filter((fn) => fn.ms === 15000)).toEqual([]);
    expect(p.q('#th-retry')).toBeNull();
    expect(p.beacons).toEqual([]);
  });
  test('the quick answer\'s page is today\'s script with only the home\'s ask swapped, under its own hash', () => {
    expect(Page.SCRIPT_PAGED).not.toBe(Page.SCRIPT);
    expect(Page.SCRIPT_PAGED.replace(/var g0=store[\s\S]*?home\(\);/, 'X')).toBe(Page.SCRIPT.replace(/var g0=store[\s\S]*?\}\}\);/, 'X'));
    const on = Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, paged: true });
    expect(on.csp).toContain(`'sha256-${Page.SCRIPT_PAGED_HASH}'`);
    expect(on.html).toContain(`<script>${Page.SCRIPT_PAGED}</script>`);
  });
});

describe('a quiz that takes longer than three minutes', () => {
  const home = () => ({ primary: { kind: 'lesson', id: 'lp_9', make: 'lesson', from: 'lp', title: 'Water' }, library: LIB, timeline: [] });

  test('the late line shows, the page keeps asking, and the top card becomes the quiz when it lands at 200 s', async () => {
    const clock = { t: 1000000 };
    const start = clock.t;
    const timers = [];
    const ready = () => clock.t - start >= 200000;
    const p = await open(home(), { timers, clock, answer: (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' }
      : path.indexOf('/api/th/quiz/qz1?') === 0 ? (ready() ? { state: 'ready', title: 'Water', message: 'M', wa: 'https://wa.me/?text=M' } : { state: 'making' }) : {}) });
    await p.tap(p.q('#th-top').querySelector('[data-tap="quiz_this"]'));
    let sawLate = false;
    for (let i = 0; i < 80 && timers.length && p.q('#th-top').getAttribute('data-kind') !== 'made'; i += 1) {
      const due = timers.splice(0);
      clock.t += Math.max(...due.map((fn) => fn.ms || 0));
      due.forEach((fn) => fn());
      for (let k = 0; k < 5; k += 1) await new Promise((r) => setImmediate(r));
      if (p.q('#th-top').textContent.indexOf('Taking longer than usual') >= 0) sawLate = true;
    }
    expect(sawLate).toBe(true);
    expect(p.q('#th-top').getAttribute('data-kind')).toBe('made');
    expect(p.q('#th-top').querySelector('[data-tap="send"]')).not.toBeNull();
  });

  test('after 10 minutes the page stops asking and the late line stays', async () => {
    const clock = { t: 1000000 };
    const timers = [];
    const p = await open(home(), { timers, clock, answer: (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' } : path.indexOf('/api/th/quiz/qz1?') === 0 ? { state: 'making' } : {}) });
    await p.tap(p.q('#th-top').querySelector('[data-tap="quiz_this"]'));
    let polls = 0;
    for (let i = 0; i < 400 && timers.length; i += 1) {
      const due = timers.splice(0);
      clock.t += Math.max(...due.map((fn) => fn.ms || 0));
      due.forEach((fn) => fn());
      for (let k = 0; k < 5; k += 1) await new Promise((r) => setImmediate(r));
    }
    polls = p.fetches.filter((f) => f.path.indexOf('/api/th/quiz/qz1?') === 0).length;
    expect(timers).toHaveLength(0);
    // every 5 s for 3 min (≈36), then every 15 s until 10 min (≈28)
    expect(polls).toBeGreaterThanOrEqual(62);
    expect(polls).toBeLessThanOrEqual(66);
    expect(p.q('#th-top').textContent).toContain('Taking longer than usual');
  });
});

describe('the words while a quiz is made', () => {
  const Strings = require('../../shared/services/first-touch/teacher-home.strings');
  test('no number of minutes is promised; the chat is named as the other way it arrives', () => {
    expect(Strings.str('th.job', 'en')).toBe('Your quiz is on its way — it takes a few minutes and arrives in this chat too');
    expect(Strings.str('th.job', 'ur')).toBe('کوئز تیار ہونے میں چند منٹ لگیں گے — یہ اسی چیٹ میں بھی آ جائے گا');
  });
});

describe('the library card\'s story counts line', () => {
  const STORIES = [{ id: 'b1', title: 'Rain', href: '/s?book=b1' }];
  const home = (counts) => ({ primary: { kind: 'none' }, library: { grade: 3, stories: STORIES, all: '/all', ...(counts ? { counts } : {}) } });
  const line = (p) => { const c = p.q('#th-counts'); expect(c).not.toBeNull(); return c; };

  test('EN: the line shows the stories sent and the children who read, under "Chosen for Grade n" and above the story rows', async () => {
    const p = await open(home({ sent: 3, read: 7 }));
    const c = line(p);
    expect(c.hidden).toBe(false);
    expect(c.textContent).toBe('3 stories sent · children who read: 7');
    const kids = p.q('#th-lib').children.map((x) => x.getAttribute('id'));
    expect(kids.indexOf('th-counts')).toBeGreaterThan(kids.indexOf('th-chosen'));
    expect(kids.indexOf('th-counts')).toBeLessThan(kids.indexOf('th-stories'));
  });

  test('EN: one story sent → the singular line', async () => {
    const p = await open(home({ sent: 1, read: 2 }));
    expect(line(p).textContent).toBe('1 story sent · children who read: 2');
  });

  test('no counts on the home → the line stays hidden and empty', async () => {
    const p = await open(home(null));
    expect(line(p).hidden).toBe(true);
    expect(line(p).textContent).toBe('');
  });

  test('counts with nothing sent → the line stays hidden and empty', async () => {
    const p = await open(home({ sent: 0, read: 0 }));
    expect(line(p).hidden).toBe(true);
    expect(line(p).textContent).toBe('');
  });

  test('a grade chip tap whose library answer has no counts keeps the home\'s line', async () => {
    const p = await open(home({ sent: 3, read: 7 }), { answer: (path) => (path.indexOf('/api/th/library?') === 0 ? { grade: 4, stories: [{ id: 'b5', title: 'Kites', href: '/s?book=b5' }] } : {}) });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="4"]'));
    expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 4');
    expect(line(p).hidden).toBe(false);
    expect(line(p).textContent).toBe('3 stories sent · children who read: 7');
  });

  test.each([
    [{ sent: 3, read: 7 }, '۳ کہانیاں بھیجی گئیں · پڑھنے والے بچے: ۷'],
    [{ sent: 1, read: 12 }, '۱ کہانی بھیجی گئی · پڑھنے والے بچے: ۱۲'],
  ])('UR: %j → the Urdu line in Urdu digits', async (counts, want) => {
    const p = await open(home(counts), { lang: 'ur' });
    expect(line(p).hidden).toBe(false);
    expect(line(p).textContent).toBe(want);
  });

});

describe('one primary action on the screen', () => {
  const MSG = 'Assalam o Alaikum class! Your teacher sent you a quiz.';
  const home = () => ({ primary: { kind: 'class', played: 0, title: 'Seasons', again: { id: 'own1' }, send: { message: MSG, wa: `https://wa.me/?text=${encodeURIComponent(MSG)}`, c: 'own-code', sendKind: 'again' } }, library: LIB });
  const primaries = (p) => p.q('main').parentNode.querySelectorAll('[data-primary]');

  test('the home carries ONE data-primary: the top card\'s; the closed send sheet carries none', async () => {
    const p = await open(home());
    const all = primaries(p);
    expect(all).toHaveLength(1);
    expect(all[0].getAttribute('data-tap')).toBe('again');
    expect(p.q('#th-sheet-go').getAttribute('data-primary')).toBeNull();
  });

  test('with the sheet open its "Send to my class" is the one primary; closed again, the top card\'s is', async () => {
    const p = await open(home(), { backThrows: true });
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    expect(p.q('#th-sheet').hidden).toBe(false);
    expect(primaries(p).map((x) => x.getAttribute('id') || x.getAttribute('data-tap'))).toEqual(['th-sheet-go']);
    await p.tap(p.q('#th-back'));
    expect(p.q('#th-sheet').hidden).toBe(true);
    expect(primaries(p).map((x) => x.getAttribute('data-tap'))).toEqual(['again']);
  });

  test('a quiz that lands while the sheet is open repaints the top card without a second primary; closed, the new card\'s is the one', async () => {
    const timers = [];
    const p = await open({ ...home(), timeline: [{ kind: 'lp', verb: 'quiz_this', id: 'lp_9', make: 'lesson', sendKind: null, title: 'Water' }] }, {
      timers, backThrows: true,
      answer: (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' } : path.indexOf('/api/th/quiz/qz1?') === 0 ? { state: 'ready', title: 'Water', message: 'M', wa: 'https://wa.me/?text=M' } : {}),
    });
    await p.tap(p.q('#th-rows').querySelector('[data-tap="quiz_this"]'));
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    expect(p.q('#th-sheet').hidden).toBe(false);
    timers.splice(0).forEach((fn) => fn());
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    expect(p.q('#th-top').getAttribute('data-kind')).toBe('made');
    expect(primaries(p).map((x) => x.getAttribute('id') || x.getAttribute('data-tap'))).toEqual(['th-sheet-go']);
    await p.tap(p.q('#th-back'));
    expect(primaries(p).map((x) => x.getAttribute('data-tap'))).toEqual(['send']);
  });

  test('a grade change while the sheet is open repaints the top card without a second primary', async () => {
    const VIDEO = { kind: 'video', id: 'v1', title: 'Rain', send: { message: 'V', wa: 'https://wa.me/?text=V', c: 'vc' } };
    const p = await open({ primary: VIDEO, library: LIB }, {
      backThrows: true,
      answer: (path) => (path.indexOf('/api/th/library?') === 0 ? { ...LIB, grade: 3, pick: { ...VIDEO, id: 'v2', title: 'Sun' } } : {}),
    });
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    expect(p.q('#th-sheet').hidden).toBe(false);
    await p.tap(p.q('#th-grades').querySelector('[data-grade="3"]'));
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    expect(p.q('#th-top').textContent).toContain('Sun');
    expect(primaries(p).map((x) => x.getAttribute('id') || x.getAttribute('data-tap'))).toEqual(['th-sheet-go']);
    await p.tap(p.q('#th-back'));
    expect(primaries(p).map((x) => x.getAttribute('data-tap'))).toEqual(['send']);
  });
});
