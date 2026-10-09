/**
 * wq-tel.js, the web quiz pages' page-session telemetry, run for real in a vm with a small fake DOM.
 *
 * Off (boot rt not true): no listener, no timer, no request, and WQT.push says no. On: every event carries the
 * page session id ps, a sequence number pseq without gaps and the ms since load sm; the screen on show is read
 * from the page's data-m / data-screen marker; dwell and visible time per screen; hidden/visible with how long;
 * a heartbeat only after 30 s of silence, 20 at most; one page_end by beacon. The batch carries the session
 * token and the device ref for the server to turn into its own ids; no event carries either.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
const ST = 'eyJrIjoicyJ9.signaturesignaturesig12';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';

function el(attrs = {}) { return { attrs: { ...attrs }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = String(v); } }; }

function load({ boot = { rt: true, code: 'AB12CD', quiz: { code: 'AB12CD', lang: 'ur' } }, store = {}, session = {}, ua = 'Mozilla/5.0 WA4A/2.24' } = {}) {
  let clock = 1000;
  const root = el();
  let section = null;
  root.querySelector = (sel) => (sel === '.wq-screen' ? section : null);
  const observers = [];
  const timers = [];
  const intervals = [];
  const docL = {};
  const winL = {};
  const fetches = [];
  const beacons = [];
  const ls = new Map(Object.entries(store).map(([k, v]) => [k, JSON.stringify(v)]));
  const ss = new Map(Object.entries(session));
  const ctx = {
    JSON, Math, Date, String, Number, Uint8Array, Promise,
    performance: { now: () => clock },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) % 256; return a; } },
    document: {
      visibilityState: 'visible',
      getElementById: (id) => (id === 'boot' ? { textContent: JSON.stringify(boot) } : id === 'wq' ? root : null),
      addEventListener: (n, fn) => { (docL[n] = docL[n] || []).push(fn); },
    },
    addEventListener: (n, fn) => { (winL[n] = winL[n] || []).push(fn); },
    navigator: { userAgent: ua, sendBeacon: (url, blob) => { beacons.push({ url, body: JSON.parse(blob.parts[0]) }); return true; } },
    Blob: function Blob(parts, o) { this.parts = parts; this.type = o && o.type; },
    fetch: (url, init) => { fetches.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({}); },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v) },
    sessionStorage: { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, v) },
    MutationObserver: function MO(fn) { this.observe = (target, opts) => observers.push({ fn, target, opts }); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const t = {
    ctx, root, observers, intervals, docL, winL, fetches, beacons, ss,
    tick(ms) { clock += ms; },
    // The page paints a screen: its section, and (quiz/hub) the root's data-m; then the observer's callback runs.
    paint(attrs, rootM) {
      section = el(attrs);
      if (rootM !== undefined) root.attrs['data-m'] = rootM;
      observers.forEach((o) => o.fn([]));
      while (timers.length) timers.shift()();
    },
    setRootM(m) { root.attrs['data-m'] = m; observers.forEach((o) => o.fn([])); while (timers.length) timers.shift()(); },
    hide() { ctx.document.visibilityState = 'hidden'; (docL.visibilitychange || []).forEach((f) => f({})); },
    show() { ctx.document.visibilityState = 'visible'; (docL.visibilitychange || []).forEach((f) => f({})); },
    every(ms) { intervals.filter((i) => i.ms === ms).forEach((i) => i.fn()); },
    pagehide() { (winL.pagehide || []).forEach((f) => f({})); },
    sent() { return [...beacons, ...fetches].flatMap((b) => b.body.events).sort((a, b) => a.pseq - b.pseq); },
    batches() { return [...beacons, ...fetches].map((b) => b.body); },
  };
  return t;
}

test('off (rt not true): no listener, no timer, no observer, no request; WQT.push says no', () => {
  for (const boot of [{ code: 'AB12CD' }, { rt: 'true', code: 'AB12CD' }, { rt: 1 }]) {
    const t = load({ boot });
    expect(t.ctx.WQT.on).toBe(false);
    expect(t.ctx.WQT.push({ n: 'answer' })).toBe(false);
    expect(t.observers).toHaveLength(0);
    expect(t.intervals).toHaveLength(0);
    expect(Object.keys(t.docL)).toHaveLength(0);
    expect(Object.keys(t.winL)).toHaveLength(0);
    t.paint({ 'data-m': 'M6' }, 'M6');
    expect(t.fetches.length + t.beacons.length).toBe(0);
  }
});

test('on: page_start, then each screen entered and left with its dwell; ps/pseq/sm on every event; the batch carries st + dr, no event does', () => {
  const t = load({ store: { wq_s_AB12CD: { st: ST }, wq_d: DEV }, session: { wq_ps: 'hubpage00001' } });
  t.paint({ 'data-m': 'M4' }, 'M4');
  t.tick(8000);
  t.paint({ 'data-m': 'M6' }, 'M6');
  t.tick(14000);
  t.setRootM('M7'); // wq.js marks feedback on the root only (setAttribute), the section stays the question's
  t.tick(5000);
  t.paint({ 'data-m': 'M6' }, 'M6');
  t.pagehide();
  const ev = t.sent();
  const ps = ev[0].ps;
  expect(ps).toMatch(/^[a-z0-9]{12}$/);
  expect(t.ss.get('wq_ps')).toBe(ps);
  expect(ev.map((e) => e.ps)).toEqual(ev.map(() => ps));
  expect(ev.map((e) => e.pseq)).toEqual(ev.map((_, i) => i + 1));
  expect(ev.map((e) => [e.n, e.scr || e.page])).toEqual([
    ['page_start', 'quiz'], ['screen_enter', 'who'], ['screen_leave', 'who'], ['screen_enter', 'question'],
    ['screen_leave', 'question'], ['screen_enter', 'feedback'], ['screen_leave', 'feedback'], ['screen_enter', 'question'],
    ['screen_leave', 'question'], ['page_end', 'question'],
  ]);
  expect(ev[0]).toMatchObject({ pps: 'hubpage00001', code: 'AB12CD', lang: 'ur', ua: 'Mozilla/5.0 WA4A/2.24' });
  expect(ev[2]).toMatchObject({ ms: 8000, vis_ms: 8000 });
  expect(ev[4]).toMatchObject({ ms: 14000 });
  expect(ev[5]).toMatchObject({ from: 'question' });
  expect(ev[6]).toMatchObject({ ms: 5000 });
  expect(ev[9]).toMatchObject({ total_ms: 27000, vis_ms: 27000, count: 10 });
  for (const b of t.batches()) expect(b).toMatchObject({ ps, st: ST, dr: DEV });
  expect(JSON.stringify(ev)).not.toContain(ST);
  expect(JSON.stringify(ev)).not.toContain(DEV);
});

test('hidden and visible: each says how long the other state lasted; the hidden time is not counted as visible', () => {
  const t = load();
  t.paint({ 'data-m': 'M6' }, 'M6');
  t.tick(10000);
  t.hide();
  expect(t.beacons.length).toBe(1); // a hidden page sends what it has, by beacon
  t.tick(30000);
  t.show();
  t.tick(5000);
  t.paint({ 'data-m': 'M7' }, 'M7');
  const ev = t.sent().concat((() => { t.pagehide(); return []; })());
  const all = t.sent();
  expect(all.filter((e) => e.n === 'vis').map((e) => [e.state, e.ms])).toEqual([['hidden', 10000], ['visible', 30000]]);
  expect(all.find((e) => e.n === 'screen_leave' && e.scr === 'question')).toMatchObject({ ms: 45000, vis_ms: 15000 });
  expect(all.find((e) => e.n === 'page_end')).toMatchObject({ total_ms: 45000, vis_ms: 15000 });
  expect(ev.length).toBeGreaterThan(0);
});

test('heartbeat: only after 30 s with nothing sent, only while visible, 20 at most', () => {
  const t = load();
  t.paint({ 'data-m': 'M5' }, 'M5');
  t.tick(10000);
  t.every(30000);
  expect(t.sent().filter((e) => e.n === 'hb')).toHaveLength(0); // something was sent 10 s ago
  for (let i = 0; i < 25; i += 1) { t.tick(30000); t.every(30000); }
  t.hide();
  t.tick(30000); t.every(30000);
  t.pagehide();
  const hb = t.sent().filter((e) => e.n === 'hb');
  expect(hb).toHaveLength(20);
  expect(hb[0]).toMatchObject({ ms: 40000, vis_ms: 40000 });
});

test('page_end is sent once, by beacon; nothing after it; freeze sends what is queued', () => {
  const t = load();
  t.paint({ 'data-m': 'M9' }, 'M9');
  t.ctx.WQT.push({ n: 'answer', ok: 1, i: 3 });
  (t.docL.freeze || []).forEach((f) => f({}));
  expect(t.beacons).toHaveLength(1);
  expect(t.beacons[0].body.events.map((e) => e.n)).toEqual(['page_start', 'screen_enter', 'answer']);
  t.pagehide();
  t.pagehide();
  t.ctx.WQT.push({ n: 'answer' });
  t.every(15000);
  const ends = t.sent().filter((e) => e.n === 'page_end');
  expect(ends).toHaveLength(1);
  expect(t.sent().filter((e) => e.n === 'answer')).toHaveLength(1);
  expect(t.beacons.length).toBe(2);
});

test("a page script's own event goes through the same queue, stamped; 20 events make a batch", () => {
  const t = load();
  expect(t.ctx.WQT.push({ n: 'answer', ok: 0, i: 1, qid: 'x' })).toBe(true);
  for (let i = 0; i < 18; i += 1) t.ctx.WQT.push({ n: 'tap', i });
  expect(t.fetches).toHaveLength(1);
  expect(t.fetches[0].body.events).toHaveLength(20);
  expect(t.fetches[0].body.events[1]).toMatchObject({ n: 'answer', ok: 0, i: 1, ps: t.fetches[0].body.ps, pseq: 2 });
});

test('screen names on every page: hub moments, the library, the challenge screens, an unknown moment as itself', () => {
  const H = (n, rest = '') => `H${n}${rest}`; // the hub page's own moment marks
  const hub = load({ boot: { rt: true, view: 'hub', kids: [] } });
  hub.paint({ 'data-m': H(2) }, H(2));
  hub.paint({ 'data-m': H(2, '-go') }, H(2, '-go'));
  const lib = load({ boot: { rt: true, view: 'lib', hub: 't' } });
  lib.paint({ 'data-m': 'M15-ch' });
  const ch = load({ boot: { rt: true, token: 't', menu: { lang: 'en', exercises: [] } } });
  ch.paint({ 'data-screen': 'menu' });
  ch.paint({ 'data-screen': 'qa' });
  const quiz = load();
  quiz.paint({ 'data-m': 'M17' }, 'M17');
  quiz.paint({ 'data-m': 'M4-name' }, 'M4-name');
  const enters = (t) => t.ctx.WQT.on && (t.pagehide(), t.sent().filter((e) => e.n === 'screen_enter').map((e) => e.scr));
  expect(enters(hub)).toEqual(['hub', 'hub_go']);
  expect(enters(lib)).toEqual(['library_ch']);
  expect(enters(ch)).toEqual(['ch_menu', 'ch_qa']);
  expect(enters(quiz)).toEqual(['m17', 'who_name']);
  expect(hub.sent()[0]).toMatchObject({ n: 'page_start', page: 'hub' });
  expect(lib.sent()[0]).toMatchObject({ page: 'lib' });
  expect(ch.sent()[0]).toMatchObject({ page: 'ch', lang: 'en' });
});

describe('with the real quiz page (wq.js through the page harness)', () => {
  const { page } = require('./wq-page-harness');
  test("the question and its feedback are two screens: feedback is marked on the root by setAttribute, outside render()", () => {
    const p = page({ lang: 'en', tel: true });
    // The real option tap: the answer handler question() hands to the item wiring.
    let tap = null;
    const wire = p.ctx.WQI.wire;
    p.ctx.WQI.wire = (root, item, answer, hear) => { tap = answer; return wire(root, item, answer, hear); };
    p.wq.question(0);
    p.runTimers(0);
    tap('A');
    p.runTimers(0);
    p.wq.question(0);
    p.runTimers(0);
    (p.winListeners.pagehide || []).forEach((fn) => fn({}));
    const ev = p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events).filter((e) => e.ps);
    const screens = ev.filter((e) => e.n === 'screen_enter').map((e) => e.scr);
    expect(screens.slice(-3)).toEqual(['question', 'feedback', 'question']);
    expect(ev.map((e) => e.pseq)).toEqual(ev.map((_, i) => i + 1));
    // the page's own answer event still goes its own way until the page hands it over (unchanged here)
    expect(p.fetches.flatMap((f) => (f.url === '/api/wq/e' ? JSON.parse(f.init.body).events : [])).filter((e) => e.n === 'answer')).toHaveLength(1);
  });

  test("the quiz page's own events (answer, feedback_view) join the page session: same ps, in sequence, with right/wrong", () => {
    const p = page({ lang: 'en', tel: true });
    let tap = null;
    const wire = p.ctx.WQI.wire;
    p.ctx.WQI.wire = (root, item, answer, hear) => { tap = answer; return wire(root, item, answer, hear); };
    p.wq.question(0);
    p.runTimers(0);
    tap('A');
    p.runTimers(0);
    (p.winListeners.pagehide || []).forEach((fn) => fn({}));
    const ev = p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
    const ps = ev.find((e) => e.n === 'page_start').ps;
    const answer = ev.find((e) => e.n === 'answer');
    expect(answer).toMatchObject({ ps, ok: 1, i: 1, qid: 'q1', code: 'TEST' });
    expect(ev.find((e) => e.n === 'feedback_view')).toMatchObject({ ps });
    expect(ev.filter((e) => !e.ps)).toEqual([]);
    const mine = ev.filter((e) => e.ps === ps).map((e) => e.pseq).sort((a, b) => a - b);
    expect(mine).toEqual(mine.map((_, i) => i + 1));
  });

  test("the library's own events (wq-lib.js inside the quiz page) join the page session", async () => {
    const { flush } = require('./wq-page-harness');
    const p = page({ lang: 'en', tel: true, lib: true, store: { wq_s_TEST: { st: 's1', child: null, answers: {}, queue: [], seq: 0, wrong: [], result: { pct: 80 } } },
      api: { '/lib/TEST?st=s1': { grade: '3', subjects: [{ s: 'Science', n: 2 }] } } });
    await flush(); await flush();
    p.els['#wq-more'].fire('click');
    await flush(); await flush();
    (p.winListeners.pagehide || []).forEach((fn) => fn({}));
    const ev = p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
    const libEv = ev.filter((e) => /^(lib_|more_)/.test(e.n));
    expect(libEv.length).toBeGreaterThan(0);
    expect(libEv.every((e) => typeof e.ps === 'string' && e.pseq > 0)).toBe(true);
  });

  test('without tel the quiz page sends nothing new', () => {
    const p = page({ lang: 'en' });
    p.wq.question(0);
    p.runTimers(0);
    (p.winListeners.pagehide || []).forEach((fn) => fn({}));
    const ev = p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
    expect(ev.filter((e) => e.ps || /^(page_start|screen_|vis$|hb$|page_end)/.test(e.n))).toEqual([]);
  });
});
