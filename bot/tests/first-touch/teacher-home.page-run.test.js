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
 * `paged` builds the page with the quick answer's switch ON; `wait` with the slow answer's wait (quiz_teacher_home_wait) ON;
 * `one` builds the one-lesson page for that coaching session (quiz_teacher_home_one_lesson ON);
 * `answer(path, body)` answers every other fetch.
 * → { q, tap(el), fetches, beacons, location, release, refuse } (`refuse()` answers the oldest held home fetch with a 500).
 */
async function open(home, { lang = 'en', answer = () => ({}), status = 200, timers = [], clock = null, backThrows = false, paged = false, counts = false, wait = false, one = null } = {}) {
  const { html } = Page.buildShell({ token: 'a.b', lang, switchTo: null, ...(paged ? { paged: true } : {}), ...(counts ? { counts: true } : {}), ...(wait ? { wait: true } : {}), ...(one ? { one } : {}) });
  const doc = adopt(parse(html));
  const fetches = [];
  const beacons = [];
  const held = [];
  const release = async (json) => { held.shift()({ ok: true, status: 200, json: () => Promise.resolve(json) }); await flush(); };
  const refuse = async () => { held.shift()({ ok: false, status: 500, json: () => Promise.resolve({}) }); await flush(); };
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
  return { q, tap, fetches, beacons, location, release, refuse };
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

describe('a slow home answer (switch quiz_teacher_home_wait ON), with the quick answer OFF and ON', () => {
  const HOME = { primary: { kind: 'none' }, library: LIB };
  const homeFetches = (p) => p.fetches.filter((f) => f.path.indexOf('/api/th/home?') === 0);
  const shows = (p, sel) => { const e = p.q(sel); return Boolean(e) && !e.hidden; };
  /** The page's clock: each timer the script sets fires once, when the test moves the clock past it. */
  function pageClock() {
    const c = { t: 0, list: [] };
    c.push = (fn) => { c.list.push({ fn, due: c.t + fn.ms }); };
    c.to = async (t) => {
      c.t = t;
      const due = c.list.filter((x) => x.due <= t);
      c.list = c.list.filter((x) => x.due > t);
      due.forEach((x) => x.fn());
      await flush();
    };
    return c;
  }
  /**
   * The home held 16 s, then 25 s, then answered late. The teacher taps «Try again» whenever it shows. One record of
   * what the page showed, so a failure prints the whole story (the base: the error line at 16 s and two asks).
   */
  async function slowHome({ paged, wait }) {
    const clock = pageClock();
    const p = await open(HOME, { status: 'hang', timers: clock, paged, wait });
    const seen = {};
    await clock.to(16000);
    seen.at16s = { line: shows(p, '#th-err'), retry: shows(p, '#th-retry') };
    if (shows(p, '#th-retry')) await p.tap(p.q('#th-retry'));
    await clock.to(25000);
    seen.at25s = { line: shows(p, '#th-err'), retry: shows(p, '#th-retry'), skeleton: p.q('#th-top').querySelectorAll('.th-sk').length };
    if (shows(p, '#th-retry')) await p.tap(p.q('#th-retry'));
    seen.homeAsks = homeFetches(p).length;
    await p.release({ primary: { kind: 'none' }, library: { grade: 4, stories: [] } });
    seen.late = { ready: p.q('#th-main').getAttribute('data-ready'), line: shows(p, '#th-err'), retry: shows(p, '#th-retry'), chosen: /4/.test(p.q('#th-chosen').textContent) };
    seen.steps = p.beacons.map((x) => x.body.step);
    return { p, clock, seen };
  }

  test.each([[false], [true]])('quick answer %p: no error line at 16 s; at the wait the line and «Try again» over the skeleton; the tap re-uses the ask still on its way (ONE request); the late answer is drawn and clears the line', async (paged) => {
    const { seen } = await slowHome({ paged, wait: true });
    expect(seen).toEqual({
      at16s: { line: false, retry: false },
      at25s: { line: true, retry: true, skeleton: 3 },
      homeAsks: 1,
      late: { ready: '1', line: false, retry: false, chosen: true },
      steps: ['home_slow', 'home_retry'],
    });
  });

  test.each([[false], [true]])('quick answer %p: «Try again» while the ask is on its way waits again (the line again at the next wait), still ONE request', async (paged) => {
    const clock = pageClock();
    const p = await open(HOME, { status: 'hang', timers: clock, paged, wait: true });
    await clock.to(25000);
    await p.tap(p.q('#th-retry'));
    expect([shows(p, '#th-err'), shows(p, '#th-retry')]).toEqual([false, false]);
    await clock.to(49000);
    expect([shows(p, '#th-err'), shows(p, '#th-retry')]).toEqual([false, false]);
    await clock.to(50000);
    expect([shows(p, '#th-err'), shows(p, '#th-retry')]).toEqual([true, true]);
    expect(homeFetches(p)).toHaveLength(1);
    expect(p.beacons.map((x) => x.body.step)).toEqual(['home_slow', 'home_retry', 'home_slow']);
  });

  test.each([[false, 500], [false, 'offline'], [true, 500], [true, 'offline']])('quick answer %p, a refusal (%s): the line at once, and «Try again» asks again (the first ask is over)', async (paged, status) => {
    const p = await open({}, { status, paged, wait: true });
    expect([shows(p, '#th-err'), shows(p, '#th-retry')]).toEqual([true, true]);
    await p.tap(p.q('#th-retry'));
    expect(homeFetches(p)).toHaveLength(2);
  });

  test('the ask refused after a «Try again» tap shows the line (the one live ask is what the page waits on)', async () => {
    const clock = pageClock();
    const p = await open(HOME, { status: 'hang', timers: clock, paged: true, wait: true });
    await clock.to(25000);
    await p.tap(p.q('#th-retry'));
    expect(shows(p, '#th-err')).toBe(false);
    await p.refuse(); // the one held ask is refused now
    expect([shows(p, '#th-err'), shows(p, '#th-retry')]).toEqual([true, true]);
    expect(homeFetches(p)).toHaveLength(1);
  });

  test('the switch\'s script is the quick answer\'s with only the wait parts swapped, under its own hash; the wait is max(measured p99 × 1.5, 25 s)', () => {
    expect(Page.WAIT_MS).toBe(Math.max(Math.round(Page.HOME_P99_MS * 1.5), 25000));
    expect(Page.WAIT_MS).toBe(25000);
    expect(Page.SCRIPT_WAIT).not.toBe(Page.SCRIPT_PAGED);
    expect(Page.SCRIPT_WAIT.replace(/var g0=store[\s\S]*?home\(\);/, 'X')).toBe(Page.SCRIPT_PAGED.replace(/var g0=store[\s\S]*?home\(\);/, 'X'));
    expect(Page.SCRIPT_WAIT).toContain(`},${Page.WAIT_MS});`);
    expect(Page.SCRIPT_WAIT).not.toContain('},15000);');
    for (const paged of [false, true]) {
      const on = Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, paged, wait: true });
      expect(on.csp).toContain(`'sha256-${Page.SCRIPT_WAIT_HASH}'`);
      expect(on.html).toContain(`<script>${Page.SCRIPT_WAIT}</script>`);
      expect(on.html).toContain('id="th-retry" type="button" hidden>Try again</button>');
    }
  });

  test('switch OFF (wait false): the quick answer\'s page and today\'s page as they are (the 15 s ask that asks again; no timer at all)', () => {
    expect(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, paged: true, wait: false }).html).toBe(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, paged: true }).html);
    expect(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, wait: false }).html).toBe(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null }).html);
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
    const p = await open(home({ sent: 3, read: 7 }), { counts: true });
    const c = line(p);
    expect(c.hidden).toBe(false);
    expect(c.textContent).toBe('3 stories sent · children who read: 7');
    const kids = p.q('#th-lib').children.map((x) => x.getAttribute('id'));
    expect(kids.indexOf('th-counts')).toBeGreaterThan(kids.indexOf('th-chosen'));
    expect(kids.indexOf('th-counts')).toBeLessThan(kids.indexOf('th-stories'));
  });

  test('EN: one story sent → the singular line', async () => {
    const p = await open(home({ sent: 1, read: 2 }), { counts: true });
    expect(line(p).textContent).toBe('1 story sent · children who read: 2');
  });

  test('no counts on the home → the line stays hidden and empty', async () => {
    const p = await open(home(null), { counts: true });
    expect(line(p).hidden).toBe(true);
    expect(line(p).textContent).toBe('');
  });

  test('counts with nothing sent → the line stays hidden and empty', async () => {
    const p = await open(home({ sent: 0, read: 0 }), { counts: true });
    expect(line(p).hidden).toBe(true);
    expect(line(p).textContent).toBe('');
  });

  test('a grade chip tap whose library answer has no counts keeps the home\'s line', async () => {
    const p = await open(home({ sent: 3, read: 7 }), { counts: true, answer: (path) => (path.indexOf('/api/th/library?') === 0 ? { grade: 4, stories: [{ id: 'b5', title: 'Kites', href: '/s?book=b5' }] } : {}) });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="4"]'));
    expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 4');
    expect(line(p).hidden).toBe(false);
    expect(line(p).textContent).toBe('3 stories sent · children who read: 7');
  });

  test.each([
    [{ sent: 3, read: 7 }, '۳ کہانیاں بھیجی گئیں · پڑھنے والے بچے: ۷'],
    [{ sent: 1, read: 12 }, '۱ کہانی بھیجی گئی · پڑھنے والے بچے: ۱۲'],
  ])('UR: %j → the Urdu line in Urdu digits', async (counts, want) => {
    const p = await open(home(counts), { lang: 'ur', counts: true });
    expect(line(p).hidden).toBe(false);
    expect(line(p).textContent).toBe(want);
  });

  test('the counts switch off: the page has no counts line, and a home that carries counts draws as today', async () => {
    const p = await open(home({ sent: 3, read: 7 }));
    expect(p.q('#th-counts')).toBeNull();
    expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 3');
    expect(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null }).html).not.toContain('th-counts');
    expect(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, counts: false }).html).toBe(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null }).html);
    expect(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, counts: 'true' }).html).toBe(Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null }).html);
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

describe('the one-lesson page (quiz_teacher_home_one_lesson ON: a Digital Coach report\'s "Create Quick Quiz")', () => {
  const SESSION = 'e0000000-0000-4000-8000-0000000000c1';
  const MSG = 'Assalam o Alaikum class! Play the quiz on Plants.';
  const WA = `https://wa.me/?text=${encodeURIComponent(MSG)}`;
  const makes = (p) => p.fetches.filter((f) => f.path === '/api/th/quiz/make');
  const homes = (p) => p.fetches.filter((f) => f.path.indexOf('/api/th/home?') === 0);
  const polls = (p) => p.fetches.filter((f) => f.path.indexOf('/api/th/quiz/qz1?') === 0);
  const fire = async (timers) => { timers.splice(0).forEach((fn) => fn()); await flush(); };
  const made = (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' } : {});

  test('right after paint it starts "Quiz this" for THAT lesson (the row\'s own make) and never reads the whole home', async () => {
    const p = await open(null, { one: SESSION, answer: made });
    expect(homes(p)).toEqual([]);
    expect(makes(p).map((f) => f.body)).toEqual([{ t: 'a.b', kind: 'coaching', id: SESSION, lang: 'en' }]);
    const top = p.q('#th-top');
    expect(top.textContent).toContain('Quiz from this lesson');
    expect(top.textContent).toContain('Making your quiz…');
    expect(top.querySelector('[data-tap="quiz_this"]').hidden).toBe(true);
    // the list and the library are not on this page; the way to them is one quiet link
    expect(p.q('#th-tl').hidden).toBe(true);
    expect(p.q('#th-lib').hidden).toBe(true);
    expect(p.q('#th-one-all').getAttribute('href')).toBe('/quiz/teacher/a.b');
    expect(p.beacons.map((x) => x.body.step)).toEqual(['one_lesson']);
  });

  test('the first ask after the make is not held 5 s (a quiz already made for this lesson shows at once)', async () => {
    const timers = [];
    await open(null, { one: SESSION, timers, answer: made });
    expect(timers.map((fn) => fn.ms)).toEqual([0]);
  });

  test('ready: the card is that lesson\'s quiz, and "Send to my class" opens the send sheet with its class message', async () => {
    const timers = [];
    const p = await open(null, { one: SESSION, timers, answer: (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' }
      : path.indexOf('/api/th/quiz/qz1?') === 0 ? { state: 'ready', title: 'Plants', message: MSG, wa: WA } : {}) });
    await fire(timers);
    expect(polls(p)).toHaveLength(1);
    const top = p.q('#th-top');
    expect(top.textContent).toContain('Plants');
    expect(p.q('#th-main').querySelectorAll('[data-primary]')).toHaveLength(1);
    await p.tap(top.querySelector('[data-tap="send"]'));
    expect(p.q('#th-sheet').hidden).toBe(false);
    expect(p.q('#th-msg').value).toBe(MSG);
    expect(p.q('#th-sheet-go').getAttribute('href')).toBe(WA);
    await p.tap(p.q('#th-sheet-go'));
    expect(p.beacons.map((x) => x.body).filter((b) => b.step === 'share_tap')).toEqual([{ t: 'a.b', step: 'share_tap', kind: 'again', id: 'qz1', origin: 'coaching' }]);
  });

  test('a quiz that fails says so on the card', async () => {
    const timers = [];
    const p = await open(null, { one: SESSION, timers, answer: (path) => (path === '/api/th/quiz/make' ? { quizId: 'qz1' }
      : path.indexOf('/api/th/quiz/qz1?') === 0 ? { state: 'failed', title: 'Plants' } : {}) });
    await fire(timers);
    expect(p.q('#th-top').textContent).toContain("That didn't work. Try again in a moment.");
  });

  test('a refused make: the error line, and "Quiz this" is there again and asks again when tapped', async () => {
    let n = 0;
    const p = await open(null, { one: SESSION, answer: (path) => { if (path !== '/api/th/quiz/make') return {}; n += 1; return n === 1 ? {} : { quizId: 'qz1' }; } });
    expect(p.q('#th-err').hidden).toBe(false);
    const v = p.q('#th-top').querySelector('[data-tap="quiz_this"]');
    expect(v.hidden).toBeFalsy();
    expect(v.disabled).toBe(false);
    await p.tap(v);
    expect(makes(p)).toHaveLength(2);
    expect(p.q('#th-err').hidden).toBe(true);
    expect(p.q('#th-top').textContent).toContain('Making your quiz…');
  });

  test('Urdu: the card\'s words are the Urdu ones', async () => {
    const p = await open(null, { one: SESSION, lang: 'ur', answer: made });
    expect(p.q('#th-top').textContent).toContain('اس سبق کا کوئز');
    expect(makes(p).map((f) => f.body.lang)).toEqual(['ur']);
  });
});
