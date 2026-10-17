'use strict';
/**
 * The bot's internal hub answer (GET /api/internal/wq/hub/:token) names its own step timings in a Server-Timing header:
 * one `name;dur=<ms>` per awaited step of the build. A header only: the JSON body is byte for byte the hub's own.
 * Only while app_settings web_quiz_server_timing is the JSON boolean true; off (absent, false, 'true', '"true"', 1, a failed
 * read): no stopwatch, no header, the answer byte for byte today's, and no settings read beyond the switch's own key.
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
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: 'زارا', self_reported_class: '3', list_id: LIST, is_active: true, created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3' }],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Hub._resetCache(); Play._resetCache();
  require('../../../shared/services/quiz/web-quiz-server-timing')._reset();
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
const KEY = { 'x-api-key': 'route-key', 'x-wq-device': DEV };
const getHub = async (headers = KEY) => { const r = await fetch(`${base}/hub/${T.signHub([KID])}`, { headers }); return { r, text: await r.text() }; };
const ITEM = /^[a-z]+;dur=\d+$/;
const tick = () => new Promise((r) => setTimeout(r, 20));
// the switch read once (as a warm process has it), then one hub answer whose settings reads are counted
const warmHub = async () => { await getHub(); await tick(); await getHub(); await tick(); reads.length = 0; const out = await getHub(); await tick(); return out; };
// the library link's token carries its expiry second: a run that crosses a second signs it anew
const norm = (t) => t.replace(/\/lib\/[A-Za-z0-9_.-]+\?/g, '/lib/T?');
const ownReads = () => reads.filter((r) => r.keys.includes(ST_KEY)).length;
const withSwitch = (value) => seed([...BASE, { key: ST_KEY, value }]);

// The hub's settings reads on a warm answer with the switch off (recorded on this tree): the OFF constant.
const OFF_READS = 0;
const CEILING = 6;

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

  test('the settings read fails: off, and no header', async () => {
    const from = supabase.from;
    supabase.from = (t) => { if (t === 'app_settings') throw new Error('down'); return from(t); };
    try {
      Timing.on(); await tick();
      expect(Timing.on()).toBe(false);
      expect((await getHub()).r.headers.get('server-timing')).toBeNull();
    } finally { supabase.from = from; }
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
    expect(v).not.toMatch(/Zara|زارا|4444|5555|1111|MATH01|q-1/);
  });

  test('three asserts: OFF == constant; ON <= OFF + the switch\'s own key; ON <= ceiling', async () => {
    seed(BASE);
    await warmHub();
    const off = reads.length;
    withSwitch(true);
    const { r } = await warmHub();
    expect(r.headers.get('server-timing')).toMatch(/total;dur=\d+$/);
    const on = reads.length;
    expect(off).toBe(OFF_READS);
    expect(on).toBeLessThanOrEqual(off + ownReads());
    expect(on).toBeLessThanOrEqual(CEILING);
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

describe('home_view carries the timing the page sent (events v3 relay)', () => {
  const { clean3 } = require('../../../shared/services/quiz/web-quiz-events-v3');
  test('a clean st is kept on home_view; anything else is dropped; other lines never keep it', () => {
    const st = 'gate;dur=12, home;dur=3400, total;dur=3900';
    expect(clean3({ n: 'home_view', src: 'quiz', st })).toEqual({ src: 'quiz', st });
    expect(clean3({ n: 'home_view', src: 'quiz' })).toEqual({ src: 'quiz' });
    expect(clean3({ n: 'home_view', st: 'gate;dur=1, <b>;dur=2' })).not.toHaveProperty('st');
    expect(clean3({ n: 'home_view', st: `${'a;dur=1, '.repeat(30)}a;dur=1` })).not.toHaveProperty('st');
    expect(clean3({ n: 'next_shown', st })).not.toHaveProperty('st');
  });
});
