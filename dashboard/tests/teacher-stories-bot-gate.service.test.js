/**
 * The stories edge with app_settings quiz_teacher_stories_bot_gate (JSON true only, default off). On, the edge always
 * forwards and the bot's answer is the gate: the page gets the teacher home's stale page on the bot's 404 stories_off.
 * Off (absent, false, the string "true", a failed read), every route answers byte for byte what it answered before the
 * switch existed, with the same app_settings reads (golden: tests/fixtures/teacher-stories-gate-off.golden.json, written
 * from the code before this switch with TS_GOLDEN_WRITE=1). The portal's database client is a fake (jest.mock).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const mockState = { mode: 'ok', rows: {}, reads: [] };
jest.mock('../config/supabase', () => ({
  from: (table) => {
    mockState.reads.push(table);
    const err = { data: null, error: { message: 'down' } };
    return {
      select: () => ({
        eq: (col, key) => ({
          maybeSingle: async () => {
            if (mockState.mode === 'fail-all') return err;
            if (mockState.mode === 'fail-shared' && key === 'quiz_teacher_stories_bot_gate') return err;
            return Object.prototype.hasOwnProperty.call(mockState.rows, key) ? { data: { value: mockState.rows[key] }, error: null } : { data: null, error: null };
          },
        }),
        in: async (col, keys) => {
          if (mockState.mode === 'fail-all' || mockState.mode === 'fail-shared') return err;
          return { data: keys.filter((k) => Object.prototype.hasOwnProperty.call(mockState.rows, k)).map((k) => ({ key: k, value: mockState.rows[k] })), error: null };
        },
      }),
    };
  },
}));

const { createTeacherStoriesRouter } = require('../routes/teacher-stories.routes');
const { buildMessagePage } = require('../../bot/shared/services/first-touch/maker.page');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TH = 'eyJrIjoidGgiLCJ1aWQiOiJ1MSJ9.AbCdEfGhIjKlMnOpQrStUv';
const BOOK = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEACHER_KEY = 'web_quiz_stories_teacher';
const GATE_KEY = 'quiz_teacher_stories_bot_gate';
const GOLDEN = path.join(__dirname, 'fixtures', 'teacher-stories-gate-off.golden.json');

const PAGE = '<!doctype html><html lang="en" dir="ltr"><body><main data-screen="teacher-stories">Book 1 Testwala</main></body></html>';
const SHELF = { grade: 2, lang: 'en', books: [{ id: BOOK, title: 'Book 1 Testwala' }] };
function jsonRes(status, body, location = null) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : h.toLowerCase() === 'location' ? location : null) },
    text: async () => JSON.stringify(body), arrayBuffer: async () => Buffer.from(JSON.stringify(body)) };
}
function htmlRes(status, html) {
  return { status, ok: status === 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    arrayBuffer: async () => Buffer.from(html), text: async () => html };
}
/** The bot: 'on' (its real answers), 'off' (404 stories_off everywhere, as its flagOn() false), '5xx'. */
function bot(kind) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (kind === 'off') return jsonRes(404, { error: 'stories_off' });
    if (kind === '5xx') return jsonRes(500, { error: 'boom' });
    if (url.includes('/api/internal/ts/stories')) return jsonRes(200, SHELF);
    if (url.includes('/api/internal/ts/preview')) return jsonRes(200, { story: BOOK, class_message: 'A story for you' });
    if (url.endsWith('/api/internal/ts/share')) return jsonRes(200, { code: 'AB12CD', link: 'https://quiz.example.org/q/AB12CD', class_message: 'A story for you' });
    if (url.endsWith('/api/internal/ts/send')) return jsonRes(302, {}, 'https://wa.me/?text=A%20story%20for%20you');
    if (url.includes('/api/internal/ts/page/')) return htmlRes(200, PAGE);
    return jsonRes(404, { error: 'not_found' });
  };
  return { calls, fetchImpl };
}

function start(app) { return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); }); }
function stop(srv) { return new Promise((r) => srv.close(r)); }
function req(srv, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let clock = 0;
function build(fetchImpl) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createTeacherStoriesRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, now: () => clock }));
  app.use((r, res) => res.status(418).send('fell through'));
  return app;
}
const shot = (o) => ({ status: o.status, type: o.headers['content-type'] || null, cache: o.headers['cache-control'] || null,
  location: o.headers.location || null, body: o.body });

/** Every route once at t=0, then the shelf again at t=30 s (the next read). */
async function runAll(kind) {
  const b = bot(kind);
  clock = 0;
  const srv = await start(build(b.fetchImpl));
  try {
    const out = [
      await req(srv, 'GET', `/api/teacher/stories?th=${TH}&grade=2&lang=en`),
      await req(srv, 'GET', `/api/teacher/story/preview?th=${TH}&story_id=${BOOK}`),
      await req(srv, 'POST', '/api/teacher/story/share', { th: TH, story_id: BOOK }),
      await req(srv, 'POST', '/api/teacher/story/send', { th: TH, story_id: BOOK }),
      await req(srv, 'GET', `/quiz/teacher/${TH}/stories?lang=en`),
    ];
    clock = 30000;
    out.push(await req(srv, 'GET', `/api/teacher/stories?th=${TH}&grade=2&lang=en`));
    return { responses: out.map(shot), botCalls: b.calls.length };
  } finally { await stop(srv); }
}

function setRows({ teacher, gate, mode = 'ok' }) {
  mockState.rows = {};
  mockState.mode = mode;
  mockState.reads = [];
  if (teacher !== 'absent') mockState.rows[TEACHER_KEY] = teacher;
  if (gate !== 'absent') mockState.rows[GATE_KEY] = gate;
}

const TEACHER_VALUES = [true, false, 'true', 'absent'];
// The switch off: no row, false, the string "true" (not JSON true), and two failed reads.
const GATE_OFF = [{ gate: 'absent' }, { gate: false }, { gate: 'true' }, { gate: true, mode: 'fail-all' }, { gate: 'absent', mode: 'fail-shared' }];
const BOTS = ['on', 'off', '5xx'];
const rowName = (t, g, k) => `${JSON.stringify(t)}|${JSON.stringify(g.gate)}|${g.mode || 'ok'}|${k}`;

beforeAll(() => { delete process.env.WHATSAPP_BOT_NUMBER; delete process.env.REFERRAL_BOT_NUMBER; });

describe('switch off: every route and the read count are exactly as before the switch (golden)', () => {
  test('teacher key true / false / "true" / absent × switch absent / false / "true" / failed read × bot on / off / 5xx', async () => {
    const got = {};
    for (const t of TEACHER_VALUES) {
      for (const g of GATE_OFF) {
        for (const k of BOTS) {
          setRows({ teacher: t, ...g });
          const r = await runAll(k);
          got[rowName(t, g, k)] = { ...r, reads: mockState.reads.length };
        }
      }
    }
    if (process.env.TS_GOLDEN_WRITE === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 1)}\n`);
      return;
    }
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    for (const name of Object.keys(want)) {
      expect([name, got[name].responses]).toEqual([name, want[name].responses]);
      expect([name, got[name].botCalls]).toEqual([name, want[name].botCalls]);
      // A failed shared read falls back to each key's own read: two more reads, once per 30 s; otherwise the same count.
      const failed = /\|(fail-all|fail-shared)\|/.test(name);
      expect([name, got[name].reads]).toEqual([name, want[name].reads + (failed ? 4 : 0)]);
    }
  });

  test('one app_settings read per 30 s carries both keys while the shared read works', async () => {
    setRows({ teacher: true, gate: false });
    await runAll('on');
    expect(mockState.reads).toEqual(['app_settings', 'app_settings']); // t=0 and t=30 s
  });
});

describe('switch on: the bot is the gate', () => {
  // The words on that page: the story page's own reviewed line (bot ux-strings storySendNotOpen), never "expired".
  const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
  const { str: makerStr } = require('../../bot/shared/services/first-touch/maker.strings');
  const NOT_OPEN = {
    en: 'Sending stories to your class is not open for your school yet.',
    ur: 'آپ کے اسکول میں اپنی کلاس کو کہانیاں بھیجنے کی سہولت ابھی شروع نہیں ہوئی۔',
  };
  const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function offPage(query, headers = {}) {
    setRows({ teacher: true, gate: true });
    clock = 0;
    const srv = await start(build(bot('off').fetchImpl));
    try { return await req(srv, 'GET', `/quiz/teacher/${TH}/stories${query}`, undefined, headers); } finally { await stop(srv); }
  }
  test('the bot\'s line is the one this page shows (byte for byte)', () => {
    expect(UX_STRINGS.storySendNotOpen).toEqual(NOT_OPEN);
  });
  for (const [lang, query, headers] of [['en', '?lang=en', {}], ['en', '', {}], ['ur', '?lang=ur', {}], ['ur', '', { 'accept-language': 'ur-PK' }]]) {
    test(`stories not open (${lang}${query ? ` ${query}` : ', from the phone'}): the story page's own words in the home's page, never "expired"`, async () => {
      const page = await offPage(query, headers);
      expect(page.status).toBe(200);
      expect(page.body).toContain(`<p class="mk-say">${escHtml(NOT_OPEN[lang])}</p>`);
      expect(page.body).toContain(`<title>${escHtml(NOT_OPEN[lang])}</title>`);
      expect(page.body).toContain(`<html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}">`);
      for (const l of ['en', 'ur']) expect(page.body).not.toContain(escHtml(makerStr('mk.stale', l)));
      expect(page.body).not.toMatch(/expired/i);
      expect(page.headers['content-security-policy']).toBe(buildMessagePage({ lang, id: 'mk.stale' }).csp);
      expect(page.headers['cache-control']).toBe('private, no-store');
    });
  }
  test('the teacher key true and the hub off (the bot answers 404 stories_off): the page is the home\'s stale page, never a fall-through', async () => {
    setRows({ teacher: true, gate: true });
    const r = await runAll('off');
    const page = r.responses[4];
    expect(page.status).toBe(200);
    expect(page.body).toContain('<main class="mk">');
    expect(page.body).not.toBe('fell through');
    expect(page.cache).toBe('private, no-store');
  });

  test('the teacher key off at the edge: still forwarded; the bot\'s 200 page is passed on byte for byte', async () => {
    for (const t of [false, 'absent', 'true']) {
      setRows({ teacher: t, gate: true });
      const r = await runAll('on');
      expect(r.responses[4].status).toBe(200);
      expect(r.responses[4].body).toBe(PAGE);
      expect(r.responses[0].status).toBe(200);
      expect(JSON.parse(r.responses[0].body)).toEqual(SHELF);
    }
  });

  test('a bot 200 page is byte-identical to the page with the switch off and the teacher key on', async () => {
    setRows({ teacher: true, gate: 'absent' });
    const off = await runAll('on');
    setRows({ teacher: true, gate: true });
    const on = await runAll('on');
    expect(on.responses).toEqual(off.responses);
  });

  test('the API passes the bot\'s 404 stories_off on unchanged', async () => {
    setRows({ teacher: false, gate: true });
    const r = await runAll('off');
    for (const i of [0, 1, 2, 3]) {
      expect(r.responses[i].status).toBe(404);
      expect(JSON.parse(r.responses[i].body)).toEqual({ error: 'stories_off' });
    }
  });

  test('a bot 5xx: today\'s answers (the API 502, the page falls through)', async () => {
    setRows({ teacher: true, gate: 'absent' });
    const off = await runAll('5xx');
    setRows({ teacher: true, gate: true });
    const on = await runAll('5xx');
    expect(on.responses).toEqual(off.responses);
    expect(on.responses[4].body).toBe('fell through');
  });

  test('any other 404 from the bot on the page still falls through', async () => {
    setRows({ teacher: true, gate: true });
    clock = 0;
    const fetchImpl = async () => jsonRes(404, { error: 'not_found' });
    const srv = await start(build(fetchImpl));
    try {
      expect((await req(srv, 'GET', `/quiz/teacher/${TH}/stories`)).body).toBe('fell through');
    } finally { await stop(srv); }
  });

  test('the shared read failing: the switch is read on its own, and only JSON true is on', async () => {
    const { storiesFlagsReader } = require('../routes/teacher-stories.routes');
    const reads = [];
    const db = { from: () => ({ select: () => ({
      in: async () => ({ data: null, error: { message: 'down' } }),
      eq: (c, k) => { reads.push(k); return { maybeSingle: async () => ({ data: { value: k === GATE_KEY ? true : 'true' }, error: null }) }; },
    }) }) };
    expect(await storiesFlagsReader({ now: () => 0, db: () => db })()).toEqual({ teacher: true, gate: true });
    expect(reads).toEqual([TEACHER_KEY, GATE_KEY]);
  });
});
