/**
 * A grown-up changes the child's grade, for good (the bot's app_settings web_quiz_grade_change; the hub answer carries
 * `grownups.grade = {now, cls}` only while it is on). The shipped wq-home.js runs in a vm with a small fake DOM (no
 * jsdom in this package): behind the 2 s hold, the sheet draws a Grade row after the language button, its value button
 * opens the Stories grade chips 1-5 with the current one pressed, a chip tap POSTs /api/wq/hub/grade and shows the
 * save line for 2 s, the class line shows when the class grade differs, a 429 says "Try again tomorrow.", and Close
 * redraws Home. EN + UR (Urdu digits). With no `grownups.grade` the sheet is byte for byte the golden written from the
 * file before this change. The portal route forwards to the bot's POST /api/internal/wq/hub/:token/grade with this
 * phone's device. Invented children only; the bot is the network boundary (a fake fetch).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HOME_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.js');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'web-quiz-grade-change-golden.json'), 'utf8'));
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null,
  home_v3: 1, doors: { stories: [], games: [{ kind: 'numbers' }], videos: null }, head: { dots: 2, today: false, jar: null },
};
const UR = '۰۱۲۳۴۵۶۷۸۹';
// The Urdu save and refusal lines as the page's COPY says them (n, c: Urdu digits).
const URC = {
  savedHome: (n) => `محفوظ ہو گیا۔ اب ہوم پر جماعت ${n} نظر آئے گی۔`,
  savedClass: (n, c) => `محفوظ ہو گیا۔ اب کہانیاں اور ویڈیوز جماعت ${n} کی کھلیں گی۔ کلاس کے کوئز جماعت ${c} کے رہیں گے۔`,
  tomorrow: 'کل دوبارہ کوشش کریں۔',
};
const visible = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// An element that keeps its markup and listeners, and answers an attribute selector from its own markup.
function fakeEl(tag) {
  const l = {};
  const el = {
    tag, className: '', attrs: {}, kids: [], innerHTML: '', parentNode: null, l, found: {}, disabled: false,
    classList: { add() {}, remove() {} },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(n, fn) { (l[n] = l[n] || []).push(fn); },
    fire(n, e) { (l[n] || []).forEach((fn) => fn(e || { preventDefault() {} })); },
    appendChild(c) { this.kids.push(c); c.parentNode = this; },
    removeChild(c) { const i = this.kids.indexOf(c); if (i >= 0) this.kids.splice(i, 1); },
    querySelector(sel) {
      const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (!m) return null;
      const want = m[2] != null ? `${m[1]}="${m[2]}"` : m[1];
      if (!new RegExp(`\\s${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s>=/])`).test(this.innerHTML)) return null;
      return this.found[sel] || (this.found[sel] = fakeEl(sel));
    },
    querySelectorAll: () => [],
  };
  return el;
}
// A tap on a button the row drew (event delegation: the row hears the click; the target names the button).
const tapOn = (attrs) => ({ preventDefault() {}, target: { closest: () => ({ getAttribute: (a) => (attrs[a] == null ? null : attrs[a]), disabled: false }) } });

function page({ fetchImpl, grade = { now: 3, cls: null } } = {}) {
  const els = {}; const sheets = []; const calls = []; const loc = { hash: '', pathname: '/h/x', search: '', reloads: 0, reload() { this.reloads += 1; } };
  const el = (name) => {
    if (els[name]) return els[name];
    els[name] = fakeEl(name);
    return els[name];
  };
  const root = {
    innerHTML: '', setAttribute() {}, children: [],
    querySelector: (sel) => (sel === '[data-tap="grownups"]' ? el('grownups') : null),
    querySelectorAll: () => [],
    appendChild: (b) => { b.parentNode = root; sheets.push(b); },
    removeChild: (b) => { const i = sheets.indexOf(b); if (i >= 0) sheets.splice(i, 1); },
  };
  const win = { addEventListener() {}, scrollTo() {} };
  const document = {
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
    createElement: (tag) => fakeEl(tag),
    head: { appendChild() {} },
  };
  const answer = (url, init) => (init && init.method === 'POST'
    ? Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true, grade: JSON.parse(init.body).grade }) })
    : Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(grade) }));
  const fetch = (url, init) => { calls.push([url, init || {}]); return (fetchImpl ? fetchImpl(url, init || {}, answer) : answer(url, init)); };
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, navigator: {}, location: loc, fetch, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp, Promise });
  const p = {
    H: win.WQHOME, root, sheets, calls, loc,
    mount(B, lang = 'en') { win.WQHOME.mount(root, B, { token: TOKEN, lang, ev() {} }); },
    open(B, lang = 'en') {
      p.mount(B, lang);
      el('grownups').fire('pointerdown'); jest.advanceTimersByTime(2100);
      return sheets.filter((b) => /wq-gsheet/.test(b.className))[0];
    },
  };
  return p;
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const withGrade = (extra = {}) => ({ ...HOME, ...extra, grownups: { ...(extra.grownups || {}), grade_on: true } });
// The sheet open with the grade the bot answers (its GET settled).
const opened = async (grade, extra = {}, lang = 'en', opts = {}) => {
  const p = page({ grade, ...opts });
  const sheet = p.open(withGrade({ ...extra, lang }), lang);
  await flush();
  return { p, sheet, row: sheet.querySelector('[data-grade]') };
};

describe('no grownups.grade (the bot\'s switch absent, false, "true" or 1): the sheet is today\'s, byte for byte', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test.each([
    ['plain', HOME],
    ['the teacher switch', { ...HOME, grownups: { teacher_href: '/quiz/teacher/abc', teacher_label: 'Back to my teacher home' } }],
    ['forget this phone', { ...HOME, forget_phone: true }],
  ])('%s: EN and UR equal the golden written before this change', (name, B) => {
    for (const lang of ['en', 'ur']) {
      const sheet = page().open({ ...B, lang }, lang);
      expect(sheet.innerHTML).toBe(GOLDEN[`${name}_${lang}`]);
      expect(sheet.innerHTML).not.toContain('data-grade');
    }
  });
  test('no grade_on: the sheet asks nothing', () => {
    const p = page();
    p.open(HOME);
    expect(p.calls).toEqual([]);
  });
  test('the home itself is unchanged by a grade on the boot (the row lives only in the sheet)', () => {
    const p = page();
    expect(p.H.html(withGrade(), { token: TOKEN, lang: 'en' })).toBe(p.H.html(HOME, { token: TOKEN, lang: 'en' }));
  });
});

describe('the Grade row', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('opening the sheet asks GET /api/wq/hub/grade?hub=&kid= and shows a skeleton until it answers', async () => {
    const p = page();
    const sheet = p.open(withGrade());
    const row = sheet.querySelector('[data-grade]');
    expect(row.innerHTML).toContain('wq-gskel');
    expect(row.innerHTML).not.toContain('data-tap="grade"');
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0][0]).toBe(`/api/wq/hub/grade?hub=${encodeURIComponent(TOKEN)}&kid=${KID}`);
    expect(p.calls[0][1].method || 'GET').toBe('GET');
    await flush();
    expect(row.innerHTML).not.toContain('wq-gskel');
    expect(row.innerHTML).toContain('Grade 3 ▾');
  });
  test('the GET fails (switch off on the bot, another phone): the row goes, nothing else changes', async () => {
    const { row, sheet } = await opened(null, {}, 'en', { fetchImpl: () => Promise.resolve({ status: 404, ok: false, json: () => Promise.resolve({ error: 'not_found' }) }) });
    expect(row.innerHTML).toBe('');
    expect(sheet.innerHTML).toContain('data-tap="close"');
  });
  test('EN: after the language button, a label and a secondary value button "Grade 3 ▾"; no chips until tapped', async () => {
    const { sheet, row } = await opened({ now: 3, cls: null });
    const h = sheet.innerHTML;
    expect(h.indexOf('data-grade')).toBeGreaterThan(h.indexOf('data-tap="lang"'));
    expect(h.indexOf('data-grade')).toBeLessThan(h.indexOf('data-tap="close"'));
    expect(row.innerHTML).toMatch(/<button class="wq-btn wq-btn--secondary[^"]*" type="button" data-tap="grade" aria-expanded="false">Grade 3 ▾<\/button>/);
    expect(visible(row.innerHTML)).toContain('Grade Grade 3 ▾');
    expect(row.innerHTML).not.toContain('wqs-chip');
    expect((h.match(/data-primary/g) || [])).toHaveLength(1);
  });
  test('UR: «جماعت» and «جماعت ۳ ▾», Urdu digits', async () => {
    const { row } = await opened({ now: 3, cls: null }, {}, 'ur');
    expect(row.innerHTML).toContain('>جماعت<');
    expect(row.innerHTML).toContain('جماعت ۳ ▾');
    expect(visible(row.innerHTML)).not.toMatch(/Grade|[0-9] ▾/);
  });
  test('the value button opens chips 1-5 (the Stories chips), the current grade pressed', async () => {
    const { row } = await opened({ now: 3, cls: null });
    row.fire('click', tapOn({ 'data-tap': 'grade' }));
    const chips = [...row.innerHTML.matchAll(/<button class="wqs-chip" data-tap="g" data-arg="(\d)" aria-pressed="(true|false)">([^<]*)<\/button>/g)];
    expect(chips.map((c) => c[1])).toEqual(['1', '2', '3', '4', '5']);
    expect(chips.filter((c) => c[2] === 'true').map((c) => c[1])).toEqual(['3']);
    expect(row.innerHTML).toContain('<div class="wqs-pick">');
    expect(row.innerHTML).toContain('aria-expanded="true"');
  });
  test('UR chips wear Urdu digits', async () => {
    const { row } = await opened({ now: 2, cls: null }, {}, 'ur');
    row.fire('click', tapOn({ 'data-tap': 'grade' }));
    const labels = [...row.innerHTML.matchAll(/data-tap="g" data-arg="\d" aria-pressed="(?:true|false)">([^<]*)</g)].map((c) => c[1]);
    expect(labels).toEqual([UR[1], UR[2], UR[3], UR[4], UR[5]]);
  });
  test('no grade known yet: the button still opens the chips, none pressed', async () => {
    const { row } = await opened({ now: null, cls: null });
    row.fire('click', tapOn({ 'data-tap': 'grade' }));
    expect(row.innerHTML).not.toContain('aria-pressed="true"');
  });
  test('the class line shows only when the class grade differs: "In class: Grade 4" / «اسکول میں: جماعت ۴»', async () => {
    expect((await opened({ now: 3, cls: 4 })).row.innerHTML).toContain('In class: Grade 4');
    expect((await opened({ now: 4, cls: 4 })).row.innerHTML).not.toContain('In class');
    expect((await opened({ now: 3, cls: null })).row.innerHTML).not.toContain('In class');
    expect((await opened({ now: 3, cls: 4 }, {}, 'ur')).row.innerHTML).toContain('اسکول میں: جماعت ۴');
  });
});

describe('a chip tap saves', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const pickIt = async (row, n) => { row.fire('click', tapOn({ 'data-tap': 'grade' })); row.fire('click', tapOn({ 'data-tap': 'g', 'data-arg': String(n) })); await flush(); };
  test('a loose child: POST /api/wq/hub/grade {hub, kid, grade}; "Saved. Home now shows Grade 4." for 2 s; the button says 4', async () => {
    const { p, row } = await opened({ now: 3, cls: null });
    await pickIt(row, 4);
    const post = p.calls.filter((c) => c[1].method === 'POST');
    expect(post).toHaveLength(1);
    expect(post[0][0]).toBe('/api/wq/hub/grade');
    expect(JSON.parse(post[0][1].body)).toEqual({ hub: TOKEN, kid: KID, grade: 4 });
    expect(row.innerHTML).toContain('Saved. Home now shows Grade 4.');
    expect(row.innerHTML).toContain('Grade 4 ▾');
    expect(row.innerHTML).not.toContain('wqs-chip');
    jest.advanceTimersByTime(2100);
    expect(row.innerHTML).not.toContain('Saved.');
  });
  test('a loose child, UR: «محفوظ ہو گیا۔ اب ہوم پر جماعت ۴ نظر آئے گی۔»', async () => {
    const { row } = await opened({ now: 3, cls: null }, {}, 'ur');
    await pickIt(row, 4);
    expect(row.innerHTML).toContain(URC.savedHome(UR[4]));
  });
  test('a class child (class 4) choosing 2: Stories and videos open at 2, class quizzes stay 4 (EN + UR)', async () => {
    const en = await opened({ now: 4, cls: 4 });
    await pickIt(en.row, 2);
    expect(en.row.innerHTML).toContain('Saved. Stories and videos now open at Grade 2. Class quizzes stay Grade 4.');
    expect(en.row.innerHTML).toContain('In class: Grade 4');
    const ur = await opened({ now: 4, cls: 4 }, {}, 'ur');
    await pickIt(ur.row, 2);
    expect(ur.row.innerHTML).toContain(URC.savedClass(UR[2], UR[4]));
  });
  test('a class child choosing their class grade again: the plain save line', async () => {
    const { row } = await opened({ now: 2, cls: 4 });
    await pickIt(row, 4);
    expect(row.innerHTML).toContain('Saved. Home now shows Grade 4.');
  });
  test('Close after a save redraws Home (the page reloads); Close with no save does not', async () => {
    const { p, sheet, row } = await opened({ now: 3, cls: null });
    await pickIt(row, 5);
    sheet.querySelector('[data-tap="close"]').fire('click');
    expect(p.loc.reloads).toBe(1);
    const q = await opened({ now: 3, cls: null });
    q.sheet.querySelector('[data-tap="close"]').fire('click');
    expect(q.p.loc.reloads).toBe(0);
    expect(q.p.sheets).toHaveLength(0);
  });
  test('429: "Try again tomorrow." / the Urdu line, the grade unchanged, no reload on Close', async () => {
    for (const [lang, line] of [['en', 'Try again tomorrow.'], ['ur', URC.tomorrow]]) {
      const fetchImpl = (url, init, answer) => (init.method === 'POST' ? Promise.resolve({ status: 429, ok: false, json: () => Promise.resolve({ error: 'try_tomorrow' }) }) : answer(url, init));
      const { p, sheet, row } = await opened({ now: 3, cls: null }, {}, lang, { fetchImpl });
      await pickIt(row, 4);
      expect(row.innerHTML).toContain(line);
      expect(row.innerHTML).toContain(lang === 'en' ? 'Grade 3 ▾' : 'جماعت ۳ ▾');
      sheet.querySelector('[data-tap="close"]').fire('click');
      expect(p.loc.reloads).toBe(0);
    }
  });
  test('tapping the pressed grade asks nothing', async () => {
    const { p, row } = await opened({ now: 3, cls: null });
    await pickIt(row, 3);
    expect(p.calls.filter((c) => c[1].method === 'POST')).toHaveLength(0);
  });
});

// ── the portal route ──────────────────────────────────────────────────────────────────────────────────
const BOT = 'http://bot.test';
function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function call(srv, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

describe('POST /api/wq/hub/grade', () => {
  let srv; let calls; let answer;
  beforeEach(async () => {
    calls = []; answer = [200, { ok: true, grade: 4 }];
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'test-internal-key', fetchImpl: async (url, opts) => { calls.push({ url, opts }); return jsonRes(answer[0], answer[1]); } }));
    app.use((r, res) => res.status(418).send('fell through'));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  const dv = 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA';

  test('reaches the bot\'s /hub/:token/grade with {kid, grade} and this phone\'s device; the answer passes through', async () => {
    const r = await call(srv, 'POST', '/api/wq/hub/grade', { hub: TOKEN, kid: KID, grade: 4 }, { cookie: dv });
    expect(r).toEqual({ status: 200, body: JSON.stringify({ ok: true, grade: 4 }) });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/hub/${TOKEN}/grade`);
    expect(JSON.parse(calls[0].opts.body)).toEqual({ kid: KID, grade: 4 });
    expect(calls[0].opts.headers['x-wq-device']).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(calls[0].opts.headers['x-api-key']).toBe('test-internal-key');
  });
  test.each([[400, { error: 'bad_grade' }], [403, { error: 'other_device' }], [404, { error: 'not_found' }], [429, { error: 'try_tomorrow' }]])('the bot\'s %i passes through', async (status, body) => {
    answer = [status, body];
    const r = await call(srv, 'POST', '/api/wq/hub/grade', { hub: TOKEN, kid: KID, grade: 4 }, { cookie: dv });
    expect(r).toEqual({ status, body: JSON.stringify(body) });
  });
  test('a bad hub token never reaches the bot (401), and the hub\'s own POST is not this route', async () => {
    expect((await call(srv, 'POST', '/api/wq/hub/grade', { hub: 'nope', kid: KID, grade: 4 }, { cookie: dv })).status).toBe(401);
    expect(calls).toHaveLength(0);
    await call(srv, 'POST', `/api/wq/hub/${TOKEN}`, { kid: KID }, { cookie: dv });
    expect(calls.map((c) => c.url)).toEqual([`${BOT}/api/internal/wq/hub/${TOKEN}`]);
  });
  test('GET /api/wq/hub/grade?hub=&kid= reaches the bot\'s GET /hub/:token/grade?kid= with this phone\'s device; the answer passes through', async () => {
    answer = [200, { now: 3, cls: 4 }];
    const r = await call(srv, 'GET', `/api/wq/hub/grade?hub=${TOKEN}&kid=${KID}`, null, { cookie: dv });
    expect(r).toEqual({ status: 200, body: JSON.stringify({ now: 3, cls: 4 }) });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.method).toBe('GET');
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/hub/${TOKEN}/grade?kid=${KID}`);
    expect(calls[0].opts.headers['x-wq-device']).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });
  test.each([[403, { error: 'other_device' }], [404, { error: 'not_found' }]])('GET: the bot\'s %i passes through', async (status, body) => {
    answer = [status, body];
    expect(await call(srv, 'GET', `/api/wq/hub/grade?hub=${TOKEN}&kid=${KID}`, null, { cookie: dv })).toEqual({ status, body: JSON.stringify(body) });
  });
  test('GET: a bad hub token never reaches the bot (401); the hub\'s own GET is not this route', async () => {
    expect((await call(srv, 'GET', `/api/wq/hub/grade?hub=nope&kid=${KID}`, null, { cookie: dv })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  test('a bot error is a 502', async () => {
    answer = [500, { error: 'server_error' }];
    expect((await call(srv, 'POST', '/api/wq/hub/grade', { hub: TOKEN, kid: KID, grade: 4 }, { cookie: dv })).status).toBe(502);
  });
});
