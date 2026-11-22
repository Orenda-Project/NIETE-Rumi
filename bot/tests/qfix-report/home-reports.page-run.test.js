'use strict';
/**
 * bd-5j1zaf — the teacher home's "Quiz reports" section, its script RUN on the page the server builds (the harness of
 * teacher-home.page-run.test.js, with the section's switch): each sent quiz's row (topic, "{played} of {of} played" or
 * "{played} played", the chip "+{late} after the report" only when late ≥ 1, "Report not sent yet" before the report),
 * its "See report" link to the live report, 5 rows + More, the evening rounds line, Urdu digits on the Urdu page, and
 * the tap's beacon. With the switch off the page has no section and the script never draws one.
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
async function open(home, { lang = 'en', answer = () => ({}), status = 200, timers = [], clock = null, backThrows = false, paged = false, counts = false, wait = false, one = null, reports = false } = {}) {
  const { html } = Page.buildShell({ token: 'a.b', lang, switchTo: null, ...(reports ? { reports: true } : {}), ...(paged ? { paged: true } : {}), ...(counts ? { counts: true } : {}), ...(wait ? { wait: true } : {}), ...(one ? { one } : {}) });
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
const R = 'https://portal.example/r/TOKEN?from=home';
const row = (n, o = {}) => ({ key: `q_${n}`, title: `Quiz ${n}`, date: new Date(Date.UTC(2026, 10, 20, 0, n)).toISOString(), played: 3, late: 0, reported: true, report: `${R}&n=${n}`, ...o });
const home = (reports) => ({ primary: { kind: 'none' }, library: LIB, timeline: [], ...(reports ? { reports } : {}) });
const texts = (li) => li.querySelectorAll('.th-row-k').map((k) => k.textContent);

describe('switch ON', () => {
  test('a reported quiz with late finishers: the class count and the chip; See report is the live link', async () => {
    const p = await open(home({ rows: [row(1, { of: 31, onList: 12, played: 13, late: 3 })], rounds: null }), { reports: true });
    expect(p.q('#th-rp').hidden).toBe(false);
    const li = p.q('#th-rp-rows').querySelectorAll('li');
    expect(li).toHaveLength(1);
    expect(li[0].querySelector('.th-row-n').textContent).toBe('Quiz 1');
    expect(texts(li[0]).join(' | ')).toContain('12 of 31 played');
    expect(li[0].querySelector('.th-late').textContent).toBe('+3 after the report');
    const a = li[0].querySelector('a[data-tap="report"]');
    expect(a.href).toBe(`${R}&n=1`); // the script sets the property (link())
    expect(a.textContent).toBe('See report');
  });

  test('no late finisher: no chip; report not sent yet: the pending words and no chip; no class: "{played} played"', async () => {
    const p = await open(home({ rows: [row(3), row(2, { reported: false, played: 4, late: 0 })], rounds: null }), { reports: true });
    const li = p.q('#th-rp-rows').querySelectorAll('li');
    expect(li.map((x) => x.querySelector('.th-late'))).toEqual([null, null]);
    expect(texts(li[0]).join(' | ')).toBe('3 played');
    expect(texts(li[1]).join(' | ')).toBe('4 played | Report not sent yet');
  });

  test('nobody played: the home\'s own zero line', async () => {
    const p = await open(home({ rows: [row(1, { played: 0, reported: false })], rounds: null }), { reports: true });
    expect(texts(p.q('#th-rp-rows').querySelectorAll('li')[0])).toEqual(['No one in your class has played yet', 'Report not sent yet']);
  });

  test('5 rows, then More shows the next ten (and logs reports_more)', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(12 - i));
    const p = await open(home({ rows, rounds: null }), { reports: true });
    expect(p.q('#th-rp-rows').querySelectorAll('li')).toHaveLength(5);
    expect(p.q('#th-rp-more').hidden).toBe(false);
    await p.tap(p.q('#th-rp-more'));
    expect(p.q('#th-rp-rows').querySelectorAll('li')).toHaveLength(12);
    expect(p.q('#th-rp-more').hidden).toBe(true);
    expect(p.beacons.map((b) => b.body.step)).toContain('reports_more');
  });

  test('a tap on See report sends the report beacon with late', async () => {
    const p = await open(home({ rows: [row(1, { late: 2 }), row(2)], rounds: null }), { reports: true });
    const links = p.q('#th-rp-rows').querySelectorAll('a[data-tap="report"]');
    await p.tap(links[0]);
    await p.tap(links[1]);
    expect(p.beacons.filter((b) => b.body.step === 'report').map((b) => b.body)).toEqual([
      // a string: the portal edge keeps a POST field only when it is a string
      { t: 'a.b', step: 'report', late: 'true' }, { t: 'a.b', step: 'report', late: 'false' },
    ]);
  });

  test('the evening rounds line shows only with a link', async () => {
    const off = await open(home({ rows: [row(1)], rounds: null }), { reports: true });
    expect(off.q('#th-rp-rounds').hidden).toBe(true);
    const on = await open(home({ rows: [row(1)], rounds: 'https://portal.example/r/ALL?tab=class&from=home' }), { reports: true });
    expect(on.q('#th-rp-rounds').hidden).toBe(false);
    expect(on.q('#th-rp-rounds').getAttribute('href')).toBe('https://portal.example/r/ALL?tab=class&from=home');
  });

  test('no rows: the section stays hidden', async () => {
    const p = await open(home({ rows: [], rounds: null }), { reports: true });
    expect(p.q('#th-rp').hidden).toBe(true);
  });

  test('the Urdu page: Urdu digits in the counts and the chip (the home\'s own dg convention)', async () => {
    const p = await open(home({ rows: [row(1, { of: 31, onList: 12, late: 3 })], rounds: null }), { reports: true, lang: 'ur' });
    const li = p.q('#th-rp-rows').querySelectorAll('li')[0];
    expect(texts(li).join(' | ')).toContain('۳۱ میں سے ۱۲ نے کھیلا');
    expect(li.querySelector('.th-late').textContent).toBe('رپورٹ کے بعد +۳');
  });
});

describe('switch OFF', () => {
  test('the page has no section, and a home answer that carries rows draws none', async () => {
    const p = await open(home({ rows: [row(1, { late: 2 })], rounds: null }));
    expect(p.q('#th-rp')).toBeNull();
    expect(p.q('#th-main').querySelectorAll('.th-late')).toHaveLength(0);
  });
});

describe('every page the other switches build', () => {
  test('the section composes with each of the 256 switch combinations (one script part each, its own hash); off, none carries it', () => {
    const flags = ['paged', 'wait', 'named', 'early', 'counts', 'gradeFast', 'portal', 'forward'];
    const hashes = new Set();
    const offHashes = new Set();
    for (let m = 0; m < 2 ** flags.length; m += 1) {
      const o = { token: 'a.b', lang: m % 3 ? 'en' : 'ur' };
      flags.forEach((f, i) => { if (m & (1 << i)) o[f] = true; });
      const on = Page.buildShell({ ...o, reports: true });
      const off = Page.buildShell(o);
      expect(on.html).toContain('id="th-rp"');
      expect(on.html).toContain('under();reps();rows();');
      expect(off.html).not.toContain('th-rp');
      const h = /script-src 'sha256-([^']+)'/.exec(on.csp)[1];
      expect(h).not.toBe(/script-src 'sha256-([^']+)'/.exec(off.csp)[1]);
      hashes.add(h);
      offHashes.add(/script-src 'sha256-([^']+)'/.exec(off.csp)[1]);
    }
    // one section variant per distinct page script (some switches imply others, e.g. the wait builds on the quick answer)
    expect(hashes.size).toBe(offHashes.size);
  });

  test('the one-lesson page never carries the section', () => {
    const { html } = Page.buildShell({ token: 'a.b', lang: 'en', one: '11111111-1111-4111-8111-111111111111', reports: true });
    expect(html).not.toContain('th-rp');
  });
});
