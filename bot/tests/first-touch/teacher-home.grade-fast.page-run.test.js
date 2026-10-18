'use strict';
/**
 * The grade chips with the fast switch ON (app_settings `quiz_teacher_home_grade_fast`), RUN on the page the server
 * builds: the chip shows pressed at the tap, the page keeps each grade's library answer in memory (this page, this
 * token), and once the home is painted and the page is idle it asks for the neighbouring grades one at a time — never
 * two at once, and not at all when the phone asks to save data or is on 2G. A tap on a grade it already holds draws at
 * once with no request. With the switch OFF the script is today's, byte for byte, and nothing is asked ahead.
 * Only the browser boundary is stood in for (fetch, sendBeacon, idle callbacks, timers, storage).
 */
process.env.WHATSAPP_BOT_NUMBER = ['1555', '000', '1111'].join('');
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const vm = require('vm');
const crypto = require('crypto');
const Page = require('../../shared/services/first-touch/teacher-home.page');
const { parse } = require('./_mini-dom');

const El = parse('<i></i>').children[0].constructor;
class PageEl extends El {
  constructor(tag, attrs, parent) { super(tag, attrs || {}, parent || null); this.on = []; this.style = {}; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get rows() { return Number(this.getAttribute('rows')); }
  set rows(v) { this.setAttribute('rows', v); }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  addEventListener(type, fn) { this.on.push({ type, fn }); }
  focus() {} select() {} setSelectionRange() {}
}
function adopt(n) { Object.setPrototypeOf(n, PageEl.prototype); n.on = []; n.style = {}; n.children.forEach(adopt); return n; }
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };

const libOf = (g) => ({ grade: g, stories: [{ id: `b${g}`, title: `Story of grade ${g}`, href: `/s?book=b${g}` }], all: '/all', pick: g === 5 ? { kind: 'video', id: 'v5', title: 'Sun', send: { message: 'm5', wa: 'https://wa.me/?text=m5', c: 'c5' } } : null });
const HOME = (g = 3) => ({ primary: { kind: 'none' }, library: { grade: g, stories: [], all: null } });

/**
 * Opens the page (fast ON unless `fast: false`). Every /api/th/library request stays open until the test answers it
 * (`answer()` answers the oldest open one), so what is in flight can be counted. → { q, chip, tap, idle, lib, ... }.
 */
let PAGED = false; // the quick answer's switch (quiz_teacher_home_paged) for the rows run under both
let OTHERS = {}; // the page's other switched parts (named item, early pick, story counts) for the rows run under both
// `homeLater`: the home's answer waits until `p.home()` (a tap can come before it).
async function open({ fast = true, paged = PAGED, others = OTHERS, token = 'a.b', home = HOME(), connection = undefined, storage = new Map(), idleApi = true, fail = [], homeLater = false } = {}) {
  const { html, csp } = Page.buildShell({ token, lang: 'en', switchTo: null, ...(paged ? { paged: true } : {}), ...others, ...(fast ? { gradeFast: true } : {}) });
  let homeGo = null;
  const doc = adopt(parse(html));
  const fetches = [];
  const open = []; // library requests not yet answered
  let maxOpen = 0;
  const idles = [];
  const timers = [];
  class Blob { constructor(parts) { this.text = parts.join(''); } }
  const window = {
    document: {
      getElementById: (id) => doc.querySelector(`#${id}`),
      querySelector: (s) => doc.querySelector(s),
      querySelectorAll: (s) => doc.querySelectorAll(s),
      createElement: (t) => new PageEl(t),
      createTextNode: (t) => Object.assign(new PageEl('#text'), { text: String(t) }),
    },
    addEventListener() {},
    scrollTo() {},
    history: { pushState() {}, back() {} },
    location: { reload() {} },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    navigator: { sendBeacon: () => true, ...(connection ? { connection } : {}) },
    Blob,
    setTimeout(fn, ms) { timers.push(Object.assign(fn, { ms })); return timers.length; },
    fetch: (p) => {
      fetches.push(p);
      if (p.indexOf('/api/th/home?') === 0) {
        const answer = { ok: true, status: 200, json: () => Promise.resolve(home) };
        return homeLater ? new Promise((resolve) => { homeGo = () => resolve(answer); }) : Promise.resolve(answer);
      }
      if (p.indexOf('/api/th/library?') === 0) {
        return new Promise((resolve) => {
          const g = Number(/[?&]g=(\d)/.exec(p)[1]);
          open.push(Object.assign(() => resolve(fail.includes(g) ? { ok: false, status: 503, json: () => Promise.resolve({ error: 'mk.error' }) } : { ok: true, status: 200, json: () => Promise.resolve(libOf(g)) }), { g }));
          maxOpen = Math.max(maxOpen, open.length);
        });
      }
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
    },
    JSON, String, Array, Object, Promise, Number, Boolean, RegExp, Date, Math,
  };
  if (idleApi) window.requestIdleCallback = (fn) => { idles.push(fn); return idles.length; };
  window.window = window;
  const ctx = vm.createContext(window);
  const scripts = doc.querySelectorAll('script').filter((s) => !s.getAttribute('type'));
  scripts.forEach((s) => vm.runInContext(s.text, ctx));
  await flush();
  const q = (s) => doc.querySelector(s);
  if (!homeLater) expect(q('#th-main').getAttribute('data-ready')).toBe('1');
  const chip = (g) => q('#th-grades').querySelector(`[data-grade="${g}"]`);
  const tapNow = (el) => { for (let e = el; e; e = e.parentNode) (e.on || []).filter((h) => h.type === 'click').forEach((h) => h.fn({ target: el })); };
  const lib = () => fetches.filter((p) => p.indexOf('/api/th/library?') === 0);
  return {
    q, chip, lib, fetches, idles, timers, storage, html, csp, script: scripts[0].text,
    pressed: () => [1, 2, 3, 4, 5].filter((g) => chip(g).getAttribute('aria-pressed') === 'true'),
    tap: async (el) => { tapNow(el); await flush(); },
    home: async () => { homeGo(); await flush(); },
    tapNow,
    idle: async () => { while (idles.length) { idles.shift()({ timeRemaining: () => 50, didTimeout: false }); await flush(); } },
    answer: async () => { const r = open.shift(); if (r) r(); await flush(); },
    answerGrade: async (g) => { const i = open.findIndex((r) => r.g === g); if (i >= 0) open.splice(i, 1)[0](); await flush(); },
    openGrades: () => open.map((r) => r.g),
    answerAll: async () => { while (open.length) { open.shift()(); await flush(); } },
    get inFlight() { return open.length; },
    get maxOpen() { return maxOpen; },
    stories: () => q('#th-stories').querySelectorAll('[data-row="story"]').map((li) => li.querySelector('.th-row-n').textContent),
  };
}

const ALL_OTHERS = { named: true, early: true, counts: true };
describe.each([
  ['the quick answer OFF', false, {}], ['the quick answer ON', true, {}],
  ['the quick answer OFF and the named item, early pick and story counts ON', false, ALL_OTHERS],
  ['the quick answer, named item, early pick and story counts ON', true, ALL_OTHERS],
])('with %s', (_, paged, others) => {
  beforeAll(() => { PAGED = paged; OTHERS = others; });
  afterAll(() => { PAGED = false; OTHERS = {}; });

  describe('ON: the chip answers at the tap', () => {
    test('the tapped chip is pressed synchronously, before any answer, and the old one is not', async () => {
      const p = await open();
      expect(p.pressed()).toEqual([3]);
      p.tapNow(p.chip(5)); // no await: the same tick as the tap
      expect(p.pressed()).toEqual([5]);
      expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 3'); // the shelf itself waits for its answer
      expect(p.q('#th-stories').getAttribute('aria-busy')).toBe('true');
      expect(p.q('#th-stories').style.opacity).toBe('.5'); // dimmed while it waits
      await p.answerAll();
      expect(p.stories()).toEqual(['Story of grade 5']);
      expect(p.q('#th-stories').getAttribute('aria-busy')).toBe(null);
      expect(p.q('#th-stories').style.opacity).toBe('');
    });

    test('a slow answer for an earlier tap, arriving after the later grade is drawn, does not replace it', async () => {
      const p = await open({ home: HOME(1) });
      p.tapNow(p.chip(3));
      p.tapNow(p.chip(4));
      expect(p.openGrades()).toEqual([3, 4]);
      await p.answerGrade(4);
      expect(p.stories()).toEqual(['Story of grade 4']);
      await p.answerGrade(3); // grade 3's answer lands late
      expect(p.pressed()).toEqual([4]);
      expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 4');
      expect(p.stories()).toEqual(['Story of grade 4']);
      expect(p.q('#th-stories').getAttribute('aria-busy')).toBe(null);
    });

    test('a library answer that fails puts the chip back on the grade shown, shows the error line, and a new tap asks again', async () => {
      const p = await open({ fail: [5] });
      p.tapNow(p.chip(5));
      expect(p.pressed()).toEqual([5]);
      expect(p.q('#th-stories').getAttribute('aria-busy')).toBe('true');
      await p.answerAll();
      expect(p.pressed()).toEqual([3]);
      expect(p.q('#th-stories').getAttribute('aria-busy')).toBe(null);
      expect(p.q('#th-err').hidden).toBe(false);
      p.tapNow(p.chip(5));
      expect(p.lib().filter((x) => /g=5$/.test(x))).toHaveLength(2);
    });
  });

  describe('ON: neighbours asked for ahead, one at a time', () => {
    test('nothing is asked for before the page is idle; then the neighbours, serially (never two open)', async () => {
      const p = await open();
      expect(p.lib()).toEqual([]); // home painted, page not yet idle
      await p.idle();
      expect(p.inFlight).toBe(1);
      expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=4']);
      await p.answer();
      await p.idle();
      expect(p.inFlight).toBe(1);
      expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=4', '/api/th/library?t=a.b&g=2']);
      await p.answerAll();
      await p.idle();
      expect(p.lib()).toHaveLength(2);
      expect(p.maxOpen).toBe(1);
    });

    test('the idle asking waits for a tapped grade\'s open request, then asks in order, one open at a time', async () => {
      const p = await open();
      p.tapNow(p.chip(5)); // before the page is idle: grade 5's request is open
      await p.idle();
      expect(p.openGrades()).toEqual([5]); // nothing asked ahead while it is open
      await p.answer();
      expect(p.stories()).toEqual(['Story of grade 5']);
      await p.idle();
      expect(p.openGrades()).toEqual([4]);
      await p.answer(); await p.idle();
      expect(p.openGrades()).toEqual([2]);
      await p.answer(); await p.idle();
      expect(p.openGrades()).toEqual([]);
      expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=5', '/api/th/library?t=a.b&g=4', '/api/th/library?t=a.b&g=2']);
      expect(p.maxOpen).toBe(1);
    });

    test('a tap on a grade already held draws at once and makes NO new library request', async () => {
      const p = await open();
      await p.idle(); await p.answer(); await p.idle(); await p.answer(); await p.idle();
      const before = p.lib().length;
      p.tapNow(p.chip(4));
      expect(p.pressed()).toEqual([4]);
      expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 4'); // drawn in the same tick
      expect(p.q('#th-stories').getAttribute('aria-busy')).toBe(null); // held: never busy
      expect(p.stories()).toEqual(['Story of grade 4']);
      await p.answerAll(); await p.idle(); await p.answerAll(); await p.idle();
      // back to 2 (held) and then 4 again (held): still no request for either
      const afterNeighbours = p.lib();
      await p.tap(p.chip(2));
      await p.tap(p.chip(4));
      expect(p.lib().slice(afterNeighbours.length).filter((x) => /g=(2|4)$/.test(x))).toEqual([]);
      expect(p.lib().slice(0, before).filter((x) => /g=4$/.test(x))).toHaveLength(1);
      expect(p.stories()).toEqual(['Story of grade 4']);
    });

    test('a tap on the grade being asked for ahead reuses that request (no second one)', async () => {
      const p = await open();
      await p.idle();
      expect(p.inFlight).toBe(1); // grade 4 on its way
      p.tapNow(p.chip(4));
      expect(p.pressed()).toEqual([4]);
      expect(p.lib().filter((x) => /g=4$/.test(x))).toHaveLength(1);
      await p.answer();
      expect(p.stories()).toEqual(['Story of grade 4']);
      expect(p.maxOpen).toBe(1);
    });

    test('after a tap the new grade\'s neighbours are asked for in turn (still one at a time)', async () => {
      const p = await open({ home: HOME(1) });
      await p.idle(); await p.answerAll(); await p.idle();
      expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=2']);
      await p.tap(p.chip(2));
      await p.idle(); await p.answer(); await p.idle(); await p.answer(); await p.idle();
      expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=2', '/api/th/library?t=a.b&g=3']); // 1 is the home's own, held
      expect(p.maxOpen).toBe(1);
    });

    test('back to the home\'s own grade: no request, and the top card is the home\'s pick again', async () => {
      const VIDEO = { kind: 'video', id: 'v3', title: 'Our Body', send: { message: 'm', wa: 'https://wa.me/?text=m', c: 'c3' } };
      const p = await open({ home: { primary: VIDEO, library: { grade: 3, stories: [], all: null } } });
      await p.tap(p.chip(5));
      await p.answerAll();
      expect(p.q('#th-top').querySelector('.th-sub').textContent).toBe('Sun');
      const n = p.lib().length;
      p.tapNow(p.chip(3));
      expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 3');
      expect(p.lib().slice(n).filter((x) => /g=3$/.test(x))).toEqual([]);
      expect(p.q('#th-top').querySelector('.th-sub').textContent).toBe('Our Body');
    });

    test('without requestIdleCallback the page waits on a timer before asking', async () => {
      const p = await open({ idleApi: false });
      expect(p.lib()).toEqual([]);
      const t = p.timers.filter((f) => f.ms >= 100);
      expect(t.length).toBeGreaterThan(0);
      t.forEach((f) => f());
      await new Promise((r) => setImmediate(r));
      expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=4']);
    });
  });

  describe('ON: nothing asked ahead on a phone saving data or on 2G', () => {
    test.each([
      ['saveData', { saveData: true, effectiveType: '4g' }],
      ['2g', { saveData: false, effectiveType: '2g' }],
      ['slow-2g', { effectiveType: 'slow-2g' }],
    ])('%s → no request until a tap, and none after it either', async (_, connection) => {
      const p = await open({ connection });
      await p.idle();
      expect(p.lib()).toEqual([]);
      await p.tap(p.chip(4));
      await p.answerAll(); await p.idle(); await p.answerAll();
      expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=4']);
      expect(p.stories()).toEqual(['Story of grade 4']);
    });

    test('3g / 4g / no connection info → the neighbours are asked for', async () => {
      for (const connection of [{ effectiveType: '3g' }, { effectiveType: '4g', saveData: false }, undefined]) {
        const p = await open({ connection });
        await p.idle();
        expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=4']);
      }
    });
  });
});

describe.each([['the quick answer OFF', false], ['the quick answer ON', true]])('ON with the other switched parts, %s', (_, paged) => {
  test('early pick: a grade tapped before the home answers is pressed, asked once the home is drawn, then its neighbours', async () => {
    const p = await open({ paged, others: { early: true }, homeLater: true, home: HOME(1) });
    p.tapNow(p.chip(4));
    expect(p.pressed()).toEqual([4]);
    expect(p.lib()).toEqual([]); // nothing asked before the home
    await p.home();
    expect(p.q('#th-main').getAttribute('data-ready')).toBe('1');
    expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=4']); // the kept tap, asked at the draw
    expect(p.pressed()).toEqual([4]);
    await p.idle();
    expect(p.openGrades()).toEqual([4]); // the idle asking waits for it
    await p.answer();
    expect(p.stories()).toEqual(['Story of grade 4']);
    expect(p.q('#th-chosen').textContent).toBe('Chosen for Grade 4');
    await p.idle(); await p.answer(); await p.idle(); await p.answer();
    expect(p.lib()).toEqual(['/api/th/library?t=a.b&g=4', '/api/th/library?t=a.b&g=5', '/api/th/library?t=a.b&g=3']);
    expect(p.maxOpen).toBe(1);
    await p.tap(p.chip(1)); // the home's own grade: held from its answer
    expect(p.lib()).toHaveLength(3);
    expect(p.pressed()).toEqual([1]);
  });

  test('story counts: the home\'s counts line stays on a fetched grade and on a held one', async () => {
    const home = { primary: { kind: 'none' }, library: { grade: 3, stories: [], all: null, counts: { sent: 3, read: 7 } } };
    const p = await open({ paged, others: { counts: true }, home });
    const line = () => (p.q('#th-counts').hidden ? '' : p.q('#th-counts').textContent);
    const shown = line();
    expect(shown).not.toBe('');
    await p.tap(p.chip(5)); await p.answerAll();
    expect(p.stories()).toEqual(['Story of grade 5']);
    expect(line()).toBe(shown);
    await p.idle(); await p.answerAll(); await p.idle(); await p.answerAll();
    const asked = p.lib().length;
    await p.tap(p.chip(4)); // held from the idle asking
    expect(p.lib()).toHaveLength(asked);
    expect(p.stories()).toEqual(['Story of grade 4']);
    expect(line()).toBe(shown);
    await p.tap(p.chip(3)); // the home's own grade
    expect(line()).toBe(shown);
  });
});

describe('ON: the cache is this page\'s, for this token', () => {
  test('nothing of the library goes to storage; another token\'s page asks for itself', async () => {
    const storage = new Map();
    const a = await open({ token: 'a.b', storage });
    await a.idle(); await a.answer(); await a.idle(); await a.answer();
    await a.tap(a.chip(4));
    expect([...storage.keys()]).toEqual(['th.grade']);
    const b = await open({ token: 'c.d', storage, home: HOME(3) });
    await b.tap(b.chip(4));
    expect(b.lib()).toEqual(['/api/th/library?t=c.d&g=4']);
    expect(b.pressed()).toEqual([4]);
  });

  test('the cache key names the token (and the asked language), not the grade alone', () => {
    const { script } = Page.buildShell({ token: 'a.b', lang: 'en', gradeFast: true }).html.match(/<script>(?<script>[\s\S]*?)<\/script>/).groups;
    expect(script).toMatch(/function ck\(n\)\{return T\+'\|'\+\(b\.ask\|\|''\)\+'\|'\+n\}/);
  });
});

describe('OFF: the script is today\'s and asks nothing ahead', () => {
  test.each([[{}], [{ gradeFast: false }], [{ gradeFast: 'true' }], [{ gradeFast: 1 }], [{ gradeFast: {} }]])('buildShell %j → today\'s script, hash and CSP', (extra) => {
    const today = Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null });
    const built = Page.buildShell({ token: 'a.b', lang: 'en', switchTo: null, ...extra });
    expect(built.html).toBe(today.html);
    expect(built.csp).toBe(today.csp);
    expect(built.html).toContain(`<script>${Page.SCRIPT}</script>`);
    // and with the quick answer ON: its own page, byte for byte
    const todayPaged = Page.buildShell({ token: 'a.b', lang: 'ur', switchTo: null, paged: true });
    const builtPaged = Page.buildShell({ token: 'a.b', lang: 'ur', switchTo: null, paged: true, ...extra });
    expect(builtPaged.html).toBe(todayPaged.html);
    expect(builtPaged.csp).toBe(todayPaged.csp);
    expect(builtPaged.html).toContain(`<script>${Page.SCRIPT_PAGED}</script>`);
  });

  test('the OFF page asks for nothing when idle, and the chip waits for the answer as today', async () => {
    const p = await open({ fast: false });
    expect(p.idles).toHaveLength(0);
    await p.idle();
    expect(p.lib()).toEqual([]);
    p.tapNow(p.chip(4));
    expect(p.pressed()).toEqual([3]);
    await p.answerAll();
    expect(p.pressed()).toEqual([4]);
  });
});

describe('ON: the script and its hash', () => {
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  test('ON carries its own script, allowed by its own sha256 in the header and the meta', async () => {
    const p = await open();
    expect(p.script).not.toBe(Page.SCRIPT);
    expect(p.script).toBe(Page.FAST_SCRIPT);
    expect(Page.FAST_SCRIPT_HASH).toBe(sha(Page.FAST_SCRIPT));
    expect(p.csp).toContain(`script-src 'sha256-${Page.FAST_SCRIPT_HASH}'`);
    expect(p.html).toContain(`script-src &#39;sha256-${Page.FAST_SCRIPT_HASH}&#39;`);
    expect(p.html).not.toContain(Page.SCRIPT_HASH);
  });

  test('the quick answer × grade-fast: each of the four shells carries a valid script under its own matching hash', () => {
    const seen = new Set();
    for (const paged of [false, true]) {
      for (const gradeFast of [false, true]) {
        for (const lang of ['en', 'ur']) {
          const built = Page.buildShell({ token: 'a.b', lang, switchTo: null, ...(paged ? { paged: true } : {}), ...(gradeFast ? { gradeFast: true } : {}) });
          const want = paged ? (gradeFast ? Page.SCRIPT_PAGED_FAST : Page.SCRIPT_PAGED) : (gradeFast ? Page.FAST_SCRIPT : Page.SCRIPT);
          const scripts = [...built.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
          expect(scripts).toEqual([want]);
          expect(() => new vm.Script(want)).not.toThrow(); // it parses
          const h = sha(want);
          expect(built.csp).toContain(`script-src 'sha256-${h}'`);
          expect(built.html).toContain(`script-src &#39;sha256-${h}&#39;`);
          expect(built.csp.match(/sha256-[^']+/g)).toHaveLength(2); // the style's and this script's only
          seen.add(h);
        }
      }
    }
    expect(seen.size).toBe(4);
    // grade-fast's parts are swapped into the quick answer's script as into today's: both switches' code is there
    expect(Page.SCRIPT_PAGED_FAST).toContain('function home(){');
    expect(Page.SCRIPT_PAGED_FAST).toContain('function press(n){');
    expect(Page.SCRIPT_PAGED_FAST.replace(/var C=\{\}[\s\S]*?libGet\(x\)\.then\(next,next\)\}/, 'X').replace(";seed();soon()}", '}'))
      .toBe(Page.SCRIPT_PAGED.replace(/function pickGrade\(n\)[\s\S]*?if\(e!==1\)err\(true\)\}\)\}/, 'X'));
  });

  test('the names the fast parts declare are new to today\'s script and the quick answer\'s (nothing shadowed)', () => {
    const added = Page.FAST_SCRIPT; // the declared names are read off the fast script
    const names = new Set();
    for (const m of added.matchAll(/function (\w+)\(/g)) if (!new RegExp(`function ${m[1]}\\(`).test(Page.SCRIPT)) names.add(m[1]);
    for (const m of /var C=\{\},P=\{\},pf=\[\],pfOn=false;/.exec(added) ? ['C', 'P', 'pf', 'pfOn'] : []) names.add(m);
    expect([...names].sort()).toEqual(['C', 'P', 'ck', 'libGet', 'libWait', 'lite', 'next', 'pf', 'pfOn', 'press', 'seed', 'show', 'soon'].sort());
    for (const base of [Page.SCRIPT, Page.SCRIPT_PAGED]) {
      for (const n of names) expect([n, new RegExp(`(^|[^.\\w$'"])${n}\\b`).test(base)]).toEqual([n, false]);
    }
  });

  test('a swap whose part is missing, or there twice, throws at load', () => {
    expect(() => Page.swapped('abc', [['zz', 'y']])).toThrow(/no longer matches/);
    expect(() => Page.swapped('abab', [['ab', 'y']])).toThrow(/no longer matches/);
    expect(Page.swapped('abc', [['b', 'B']])).toBe('aBc');
  });
});
