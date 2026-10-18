'use strict';
/**
 * The bot's internal hub answer (GET /api/internal/wq/hub/:token) names its own step timings in a Server-Timing header:
 * one `name;dur=<ms>` per awaited step of the build. A header only: the JSON body is byte for byte the hub's own.
 * Only while app_settings web_quiz_server_timing is the JSON boolean true; off (absent, false, 'true', '"true"', 1, a failed
 * read): no stopwatch, no header, the answer byte for byte today's. The switch rides the hub's own batched settings read,
 * so it adds no settings read, on or off. Another writer's Server-Timing on the same answer is kept, in one header.
 * Supabase and Redis are the boundaries and are faked; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const redis = require('../../../shared/services/cache/railway-redis.service');

const KID = '44444444-4444-4444-8444-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const ON = (k) => ({ key: k, value: 'true' });
const ST_KEY = 'web_quiz_server_timing';
const BASE = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_library')];

function seed(settings) {
  const db = {
    app_settings: settings,
    students: [{ id: KID, student_name: 'Test Child One', student_name_urdu: 'بچہ', self_reported_class: '3', list_id: LIST, is_active: true, created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    // the class link's questions (GET /quiz/MATH01 answers a playable quiz)
    quiz_questions: [1, 2].map((n) => ({ id: `cccccc0${n}-cccc-4ccc-8ccc-cccccccccccc`, quiz_id: 'q-1', external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3' }],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Hub._resetCache(); Play._resetCache();
  redis._store.clear();
  // every app_settings read, and the keys it asked for (eq or in)
  reads.length = 0;
  const from = supabase.from;
  supabase.from = (t) => {
    const b = from(t);
    if (t !== 'app_settings') return b;
    const r = { keys: [] }; reads.push(r);
    const eq = b.eq; const inn = b.in;
    b.eq = (c, v) => { if (c === 'key') r.keys.push(v); return eq.call(b, c, v); };
    b.in = (c, v) => { if (c === 'key') r.keys.push(...v); return inn.call(b, c, v); };
    return b;
  };
}
const reads = [];

let server; let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key';
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { jest.clearAllMocks(); seed(BASE); });

const Timing = require('../../../shared/services/quiz/web-quiz-server-timing');
const Names = require('../../../shared/services/quiz/web-quiz-server-timing-names');
const KEY = { 'x-api-key': 'route-key', 'x-wq-device': DEV };
const getHub = async (headers = KEY) => { const r = await fetch(`${base}/hub/${T.signHub([KID])}`, { headers }); return { r, text: await r.text() }; };
const ITEM = /^[a-z]+;dur=\d+$/;
const tick = () => new Promise((r) => setTimeout(r, 20));
// the switch read once (as a warm process has it), then one hub answer whose settings reads are counted
const warmHub = async () => { await getHub(); await tick(); await getHub(); await tick(); reads.length = 0; const out = await getHub(); await tick(); return out; };
// the library link's token carries its expiry second: a run that crosses a second signs it anew
const norm = (t) => t.replace(/\/lib\/[A-Za-z0-9_.-]+\?/g, '/lib/T?');
const withSwitch = (value) => seed([...BASE, { key: ST_KEY, value }]);

// The hub's settings reads with the switch off, recorded on the code before this change (sandbox 04bebe647, the same
// fixture through the same route): a warm answer, and an answer right after the hub's own 30 s cache went stale.
const OFF_READS = 0;
const OFF_STALE_READS = 1;
const CEILING = 6;
// the hub switches' cache gone stale (as 30 s later), every other cache warm
const staleHub = async () => { await warmHub(); Hub._resetCache(); reads.length = 0; const out = await getHub(); await tick(); return out; };

describe('off: no stopwatch, no header, today\'s bytes, no extra settings read', () => {
  test('absent: no Server-Timing; the body is the hub\'s own JSON; reads == the OFF constant', async () => {
    const { r, text } = await warmHub();
    expect(r.status).toBe(200);
    expect(r.headers.get('server-timing')).toBeNull();
    expect(reads.length).toBe(OFF_READS);
    seed(BASE);
    expect(norm(text)).toBe(norm(JSON.stringify(await Hub.hub(T.signHub([KID]), { device: DEV }))));
  });

  test.each([[false], ['true'], ['"true"'], [1], [{ on: true }]])('value %p is off (only the JSON boolean true is on)', async (v) => {
    withSwitch(v);
    const { r } = await warmHub();
    expect(r.headers.get('server-timing')).toBeNull();
  });

  test('the settings read fails: off', async () => {
    withSwitch(true);
    await warmHub();
    expect(Timing.on()).toBe(true);
    const from = supabase.from;
    supabase.from = (t) => { if (t === 'app_settings') throw new Error('down'); return from(t); };
    try {
      Hub._resetCache();
      await Hub.flags();
      expect(Timing.on()).toBe(false);
    } finally { supabase.from = from; }
  });

  test('a cached value older than twice the cache life is off', async () => {
    withSwitch(true);
    await warmHub();
    expect(Timing.on()).toBe(true);
    expect(Timing.on(Date.now() + 61 * 1000)).toBe(false);
  });

  test('stale hub cache: the reads equal the recorded OFF constant exactly', async () => {
    const { r } = await staleHub();
    expect(r.headers.get('server-timing')).toBeNull();
    expect(reads.length).toBe(OFF_STALE_READS);
  });
});

describe('on (JSON true): Server-Timing on the internal hub answer', () => {
  test('one name;dur= per awaited step, fixed short names, total last, no child data', async () => {
    withSwitch(true);
    const { r } = await warmHub();
    const v = String(r.headers.get('server-timing'));
    const items = v.split(', ');
    expect(items.every((i) => ITEM.test(i))).toBe(true);
    const names = items.map((i) => i.split(';')[0]);
    expect(names).toEqual(expect.arrayContaining(['ui', 'gate', 'kids', 'ctx', 'take', 'teacher', 'recs', 'play', 'home', 'tail', 'total']));
    expect(names[names.length - 1]).toBe('total');
    expect(new Set(names).size).toBe(names.length);
    expect(v.length).toBeLessThan(200);
    expect(v).not.toMatch(/Test Child|بچہ|4444|5555|1111|MATH01|q-1/);
    expect(names.every((n) => Names.NAMES.includes(n))).toBe(true);
    expect(Names.clean(v)).toBe(v);
  });

  test('three asserts: OFF == constant; ON <= OFF + the switch\'s own key rows (none: it rides the batch); ON <= ceiling', async () => {
    seed(BASE);
    await warmHub();
    const off = reads.length;
    withSwitch(true);
    const { r } = await warmHub();
    expect(r.headers.get('server-timing')).toMatch(/total;dur=\d+$/);
    const on = reads.length;
    expect(off).toBe(OFF_READS);
    expect(on).toBeLessThanOrEqual(off + reads.filter((x) => x.keys.length === 1 && x.keys[0] === ST_KEY).length);
    expect(on).toBeLessThanOrEqual(CEILING);
    // stale: on reads exactly what off reads, and the switch's key is asked only inside the hub's batch
    seed(BASE);
    await staleHub();
    const offStale = reads.length;
    withSwitch(true);
    await staleHub();
    expect(offStale).toBe(OFF_STALE_READS);
    expect(reads.length).toBe(offStale);
    expect(reads.filter((x) => x.keys.includes(ST_KEY)).every((x) => x.keys.includes('web_quiz_hub'))).toBe(true);
  });

  test('with the designed wait on too: the header and wait_ux together, both keys in the hub\'s one switch read', async () => {
    const off = (await warmHub()).text;
    seed([...BASE, { key: ST_KEY, value: true }, { key: 'web_quiz_wait_ux', value: true }]);
    const { r, text } = await warmHub();
    expect(r.headers.get('server-timing')).toMatch(/total;dur=\d+$/);
    expect(JSON.parse(text).wait_ux).toBe(true);
    expect(norm(text).replace(/,"wait_ux":true/, '')).toBe(norm(off));
    await staleHub();
    const batch = reads.filter((x) => x.keys.includes(ST_KEY));
    expect(batch.length).toBe(1);
    expect(batch[0].keys).toEqual(expect.arrayContaining(['web_quiz_hub', 'web_quiz_wait_ux']));
  });

  test('with the hub\'s reads together too: the header still names the steps (the side-by-side part as one), the body is the off answer', async () => {
    const off = (await warmHub()).text;
    seed([...BASE, { key: ST_KEY, value: true }, { key: 'web_quiz_hub_fanout', value: true }]);
    const { r, text } = await warmHub();
    const v = String(r.headers.get('server-timing'));
    const names = v.split(', ').map((i) => i.split(';')[0]);
    expect(names).toEqual(expect.arrayContaining(['gate', 'kids', 'ctx', 'teacher', 'play', 'home', 'other', 'tail', 'total']));
    expect(names[names.length - 1]).toBe('total');
    expect(names.every((n) => Names.NAMES.includes(n))).toBe(true);
    expect(norm(text)).toBe(norm(off));
    require('../../../shared/services/quiz/web-quiz-hub-warm')._stop();
  });

  test('GOLDEN: the JSON body is byte for byte the off answer', async () => {
    const off = (await warmHub()).text;
    withSwitch(true);
    const { r, text } = await warmHub();
    expect(r.headers.get('server-timing')).not.toBeNull();
    expect(norm(text)).toBe(norm(off));
    expect(text).not.toMatch(/dur=|"st"/);
  });

  test('a locked hub (another phone) still says what it spent', async () => {
    withSwitch(true);
    await warmHub(); // binds the link to DEV
    const { r, text } = await getHub({ ...KEY, 'x-wq-device': 'BBBBBBBBBBBBBBBBBBBBBB' });
    expect(JSON.parse(text).locked).toBe(true);
    expect(String(r.headers.get('server-timing'))).toMatch(/total;dur=\d+$/);
  });

  test('the stopwatch changes no key of the payload (hub with and without opts.st)', async () => {
    const a = await Hub.hub(T.signHub([KID]), { device: DEV });
    seed(BASE);
    const b = await Hub.hub(T.signHub([KID]), { device: DEV, st: Timing.steps() });
    expect(norm(JSON.stringify(b))).toBe(norm(JSON.stringify(a)));
  });

  test('costs under 0.1 ms per hub call (every mark of a build, plus the header)', () => {
    const names = ['ui', 'gate', 'gate', 'kids', 'ctx', 'take', 'teacher', 'recs', 'play', 'home', 'other', 'tail'];
    const N = 20000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i += 1) { const st = Timing.steps(); names.forEach((n) => st.mark(n)); st.header(); }
    const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    // eslint-disable-next-line no-console
    console.log(`server-timing instrumentation: ${perCallMs.toFixed(5)} ms per hub call`);
    expect(perCallMs).toBeLessThan(0.1);
  });
});

describe('another writer\'s Server-Timing on the same answer is kept, in one header', () => {
  const OTHER = 'app;dur=12, db;dur=5, dbq;desc="3"';
  const stLines = (raw) => raw.filter((h, i) => i % 2 === 0 && h.toLowerCase() === 'server-timing');
  const http = require('http');
  async function answer(order) {
    const app = express();
    app.get('/x', (req, res) => {
      const st = Timing.steps();
      if (order === 'before') res.set('Server-Timing', OTHER);
      Timing.attach(res, st);
      st.mark('gate');
      if (order === 'after') res.set('Server-Timing', OTHER);
      if (order === 'append') res.append('Server-Timing', OTHER);
      res.status(200).json({ ok: true });
    });
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      return await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: srv.address().port, path: '/x' }, (res) => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
      });
    } finally { await new Promise((r) => srv.close(r)); }
  }
  test.each([['before'], ['after'], ['append']])('the other writer sets its items %s: one header, theirs then the steps', async (order) => {
    const res = await answer(order);
    expect(stLines(res.rawHeaders)).toHaveLength(1);
    expect(res.headers['server-timing']).toMatch(/^app;dur=12, db;dur=5, dbq;desc="3", gate;dur=\d+, total;dur=\d+$/);
    expect(Names.clean(res.headers['server-timing'])).toBe(res.headers['server-timing']);
  });
  test('no other writer: only the steps', async () => {
    const res = await answer('none');
    expect(res.headers['server-timing']).toMatch(/^gate;dur=\d+, total;dur=\d+$/);
  });
});

describe('the shared piece any route can call in one line', () => {
  const RT = require('../../../shared/services/quiz/web-quiz-timing');
  const fakeRes = (prev) => { const h = prev ? { 'server-timing': prev } : {}; return { headersSent: false, getHeader: (n) => h[n.toLowerCase()], setHeader: (n, v) => { h[n.toLowerCase()] = v; }, h }; };
  test('appendTiming never overwrites, writes only listed items, nothing after the headers went', () => {
    const a = fakeRes('settings;dur=3, db;dur=40, total;dur=55');
    Names.appendTiming(a, ['th_home;dur=60', 'secret;dur=1', 'dbq;desc="4"']);
    expect(a.h['server-timing']).toBe('settings;dur=3, db;dur=40, total;dur=55, th_home;dur=60, dbq;desc="4"');
    const b = fakeRes(); Names.appendTiming(b, 'nope;dur=1'); expect(b.h).toEqual({});
    const c = { ...fakeRes(), headersSent: true }; Names.appendTiming(c, 'app;dur=1'); expect(c.h).toEqual({});
  });
  test('timeRequest: on → app, dbq and the extra items appended; off → nothing; outside a request → only the extras', async () => {
    const res = fakeRes('edge;dur=1');
    Timing.timeRequest(res, ['th_library;dur=9']);
    expect(res.h['server-timing']).toBe('edge;dur=1'); // off (no switch read yet)
    withSwitch(true);
    await warmHub();
    await RT.run('r', async () => {
      await supabase.from('students').select('id');
      Timing.timeRequest(res, 'th_library;dur=9', { dbMs: 7 });
    });
    expect(res.h['server-timing']).toMatch(/^edge;dur=1, app;dur=\d+, db;dur=7, dbq;desc="\d+", th_library;dur=9$/);
    expect(Timing.requestEntries()).toEqual([]);
  });
  test('refresh: a route that never reads the hub switches starts one batched read when stale, never waited for; none when fresh', async () => {
    withSwitch(true);
    await warmHub();
    reads.length = 0;
    expect(Timing.on(Date.now(), { refresh: true })).toBe(true);
    expect(reads.length).toBe(0);
    Hub._resetCache();
    expect(Timing.on(Date.now(), { refresh: true })).toBe(false);
    await tick();
    expect(reads.length).toBe(1);
    expect(reads[0].keys).toEqual(expect.arrayContaining([ST_KEY, 'web_quiz_hub']));
    expect(Timing.on()).toBe(true);
  });
});

describe('switch on: only a route that writes its timings carries the header', () => {
  test('another answer of the same router (an unknown quiz code, the page\'s own hub POST) and a plain route: no Server-Timing', async () => {
    withSwitch(true);
    await warmHub();
    expect(Timing.on()).toBe(true);
    const q = await fetch(`${base}/quiz/NOPE99`, { headers: KEY });
    expect(q.headers.get('server-timing')).toBeNull();
    const p = await fetch(`${base}/hub/${T.signHub([KID])}`, { method: 'POST', headers: { ...KEY, 'content-type': 'application/json' }, body: JSON.stringify({ device_ref: DEV }) });
    expect(p.status).toBe(200);
    expect(p.headers.get('server-timing')).toBeNull();
    const app = express();
    app.get('/th', (req, res) => res.json({ ok: true }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const t = await fetch(`http://127.0.0.1:${srv.address().port}/th`);
      expect(t.headers.get('server-timing')).toBeNull();
    } finally { await new Promise((r) => srv.close(r)); }
  });
});

// The class link's answer (GET /quiz/:code): the request's own numbers, as the teacher home's routes write them, so a
// walker can split a slow /q/ open into the edge's wait and the bot's work. A header only; off, today's answer.
describe('the class link\'s answer (GET /quiz/:code)', () => {
  const getQuiz = async () => { const r = await fetch(`${base}/quiz/MATH01`, { headers: KEY }); return { r, text: await r.text() }; };
  // the quiz's teacher may use web links (as on sandbox)
  const withSwitch = (value) => seed([...BASE, { key: 'web_quiz_teachers', value: '"all"' }, { key: ST_KEY, value }]);
  test('on: app;dur and the round-trip count, only listed items; the body byte for byte the off answer', async () => {
    withSwitch(false);
    await warmHub();
    const off = await getQuiz();
    withSwitch(true);
    await warmHub();
    const on = await getQuiz();
    expect([off.r.status, on.r.status]).toEqual([200, 200]);
    expect(off.r.headers.get('server-timing')).toBeNull();
    const h = on.r.headers.get('server-timing');
    expect(h).toMatch(/^app;dur=\d+, dbq;desc="\d+"$/);
    expect(Names.clean(h)).toBe(h);
    expect(on.text).toBe(off.text);
  });
  test('off: the answer adds no settings read while the hub\'s switch cache is fresh', async () => {
    withSwitch(false);
    await warmHub();
    reads.length = 0;
    await getQuiz();
    await tick();
    expect(reads).toHaveLength(0);
  });
});
