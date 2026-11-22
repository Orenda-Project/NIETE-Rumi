'use strict';
/**
 * The send sheet's "More ways to share" (quiz_forward_button), RUN in the page's own script (the page-run harness of
 * first-touch/teacher-home.page-run.test.js, copied): shown only where the browser has navigator.share; its tap
 * beacons fwd_native, then fwd_result with what the share sheet reported. Switch off → no button, today's page.
 * And the one-lesson page opened for a lesson plan (?lesson=), run: it makes that plan's quiz (kind lesson).
 */
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
const { parse } = require('../first-touch/_mini-dom');

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
async function open(home, { forward = false, share = undefined, lang = 'en', answer = () => ({}), status = 200, timers = [], clock = null, backThrows = false, paged = false, counts = false, wait = false, one = null, lesson = null } = {}) {
  const { html } = Page.buildShell({ token: 'a.b', lang, switchTo: null, ...(paged ? { paged: true } : {}), ...(counts ? { counts: true } : {}), ...(wait ? { wait: true } : {}), ...(one ? { one } : {}), ...(lesson ? { lesson } : {}), ...(forward ? { forward: true } : {}) });
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
    navigator: { ...(share ? { share } : {}), sendBeacon: (p, blob) => { beacons.push({ path: p, body: JSON.parse(blob.text) }); return true; } },
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
const MSG = 'Class, play this quiz: https://portal.example/q/ABCDEF';
const HOME = { primary: { kind: 'made', id: 'quiz-1', title: 'Fractions', send: { message: MSG, wa: `https://wa.me/?text=${encodeURIComponent(MSG)}` }, origin: 'lesson_plan' }, library: LIB };
const steps = (p) => p.beacons.filter((b) => b.path === '/api/th/step').map((b) => b.body);

describe('"More ways to share" on the send sheet', () => {
  test('switch ON, a browser with a share sheet: shown; a completed share → fwd_native then fwd_result shared, with the quiz id', async () => {
    const shared = [];
    const p = await open(HOME, { forward: true, share: (o) => { shared.push(o); return Promise.resolve(); } });
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    const nv = p.q('#th-native');
    expect(nv.hidden).toBe(false);
    await p.tap(nv);
    expect(shared).toEqual([{ text: MSG }]);
    expect(steps(p)).toEqual([
      expect.objectContaining({ step: 'fwd_native', kind: 'again', id: 'quiz-1', origin: 'lesson_plan' }),
      expect.objectContaining({ step: 'fwd_result', r: 'shared', id: 'quiz-1' }),
    ]);
  });

  test('the teacher closes the share sheet → fwd_result dismissed', async () => {
    const p = await open(HOME, { forward: true, share: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) });
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    await p.tap(p.q('#th-native'));
    expect(steps(p).map((s) => [s.step, s.r])).toEqual([['fwd_native', undefined], ['fwd_result', 'dismissed']]);
  });

  test('WhatsApp\'s own browser (no navigator.share): the button stays hidden; "Send to my class" is the one tap', async () => {
    const p = await open(HOME, { forward: true });
    await p.tap(p.q('#th-top').querySelector('[data-primary]'));
    expect(p.q('#th-native').hidden).toBe(true);
    expect(p.q('#th-sheet-go').getAttribute('href')).toBe(HOME.primary.send.wa);
  });

  test('switch OFF: no button on the page at all', async () => {
    const p = await open(HOME, { share: () => Promise.resolve() });
    expect(p.q('#th-native')).toBeNull();
  });
});

// The one-lesson page opened for a lesson PLAN (?lesson=, quiz_teacher_home_one_lesson): its script makes THAT lesson's
// quiz the way a row's "Quiz this" does for a plan (kind 'lesson'); the ?session= page still makes a recorded one.
describe('the one-lesson page, RUN', () => {
  const makes = (p) => p.fetches.filter((f) => f.path === '/api/th/quiz/make').map((f) => f.body);
  test.each([[false], [true]])('?lesson= (forward switch %s): right after paint it asks quiz/make for that plan, kind lesson; the home is never asked', async (forward) => {
    const p = await open(null, { lesson: 'lsn_lp_v8_g4-math-ch5-seg2', forward, answer: () => ({ quizId: 'quiz-9' }) });
    expect(makes(p)).toEqual([expect.objectContaining({ kind: 'lesson', id: 'lsn_lp_v8_g4-math-ch5-seg2' })]);
    expect(p.fetches.some((f) => f.path.indexOf('/api/th/home?') === 0)).toBe(false);
    expect(steps(p).map((s) => s.step)).toContain('one_lesson');
  });
  test('?session= is unchanged: kind coaching for the recorded lesson', async () => {
    const p = await open(null, { one: 'e0000000-0000-4000-8000-0000000000c1', answer: () => ({ quizId: 'quiz-9' }) });
    expect(makes(p)).toEqual([expect.objectContaining({ kind: 'coaching', id: 'e0000000-0000-4000-8000-0000000000c1' })]);
  });
});
