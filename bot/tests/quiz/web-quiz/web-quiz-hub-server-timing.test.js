'use strict';
/**
 * The bot's internal hub answer (GET /api/internal/wq/hub/:token) names its own step timings in a Server-Timing header:
 * one `name;dur=<ms>` per awaited step of the build. A header only: the JSON body is byte for byte the hub's own.
 * `x-wq-st: 1` rides along only while app_settings web_quiz_server_timing is on (the edge then puts the timing in the page).
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
}

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

const KEY = { 'x-api-key': 'route-key', 'x-wq-device': DEV };
const getHub = async () => { const r = await fetch(`${base}/hub/${T.signHub([KID])}`, { headers: KEY }); return { r, text: await r.text() }; };
const ITEM = /^[a-z]+;dur=\d+(\.\d+)?$/;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('Server-Timing on the internal hub answer', () => {
  test('one name;dur= per awaited step, fixed short names, total last', async () => {
    const { r } = await getHub();
    expect(r.status).toBe(200);
    const items = String(r.headers.get('server-timing')).split(', ');
    expect(items.every((i) => ITEM.test(i))).toBe(true);
    const names = items.map((i) => i.split(';')[0]);
    expect(names).toEqual(expect.arrayContaining(['ui', 'gate', 'kids', 'ctx', 'take', 'teacher', 'recs', 'play', 'home', 'tail', 'total']));
    expect(names[names.length - 1]).toBe('total');
    expect(new Set(names).size).toBe(names.length);
    expect(String(r.headers.get('server-timing')).length).toBeLessThan(200);
  });

  test('a locked or refused hub still says what it spent', async () => {
    await getHub(); // binds the link to DEV
    const r = await fetch(`${base}/hub/${T.signHub([KID])}`, { headers: { ...KEY, 'x-wq-device': 'BBBBBBBBBBBBBBBBBBBBBB' } });
    expect((await r.json()).locked).toBe(true);
    expect(String(r.headers.get('server-timing'))).toMatch(/total;dur=\d+/);
  });

  test('GOLDEN: the JSON body is byte for byte the hub\'s own (no stopwatch)', async () => {
    const { text } = await getHub();
    seed(BASE);
    const direct = await Hub.hub(T.signHub([KID]), { device: DEV });
    expect(text).toBe(JSON.stringify(direct));
    expect(text).not.toMatch(/dur=|"st"/);
  });

  test('the stopwatch changes no key of the payload (hub with and without opts.st)', async () => {
    const Timing = require('../../../shared/services/quiz/web-quiz-server-timing');
    seed(BASE);
    const a = await Hub.hub(T.signHub([KID]), { device: DEV });
    seed(BASE);
    const b = await Hub.hub(T.signHub([KID]), { device: DEV, st: Timing.steps() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test('costs under 0.1 ms per hub call (every mark of a build, plus the header)', () => {
    const Timing = require('../../../shared/services/quiz/web-quiz-server-timing');
    const names = ['ui', 'gate', 'gate', 'kids', 'ctx', 'take', 'teacher', 'recs', 'play', 'home', 'rest', 'tail'];
    const N = 20000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i += 1) { const st = Timing.steps(); names.forEach((n) => st.mark(n)); st.header(); }
    const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    // eslint-disable-next-line no-console
    console.log(`server-timing instrumentation: ${perCallMs.toFixed(5)} ms per hub call`);
    expect(perCallMs).toBeLessThan(0.1);
  });
});

describe('x-wq-st: the page-beacon switch (web_quiz_server_timing)', () => {
  test('absent or false: no x-wq-st', async () => {
    const Timing = require('../../../shared/services/quiz/web-quiz-server-timing');
    Timing.on(); await tick();
    expect((await getHub()).r.headers.get('x-wq-st')).toBeNull();
    seed([...BASE, { key: 'web_quiz_server_timing', value: 'false' }]);
    Timing.on(); await tick();
    expect((await getHub()).r.headers.get('x-wq-st')).toBeNull();
    seed([...BASE, { key: 'web_quiz_server_timing', value: '"true"' }]);
    Timing.on(); await tick();
    expect((await getHub()).r.headers.get('x-wq-st')).toBeNull();
  });

  test('on (JSON true): x-wq-st: 1, and the body is the same bytes', async () => {
    const off = (await getHub()).text;
    seed([...BASE, { key: 'web_quiz_server_timing', value: 'true' }]);
    const Timing = require('../../../shared/services/quiz/web-quiz-server-timing');
    Timing.on(); await tick();
    const { r, text } = await getHub();
    expect(r.headers.get('x-wq-st')).toBe('1');
    expect(text).toBe(off);
  });

  test('the settings read fails: off', async () => {
    seed(BASE);
    const from = supabase.from;
    supabase.from = (t) => { if (t === 'app_settings') throw new Error('down'); return from(t); };
    try {
      const Timing = require('../../../shared/services/quiz/web-quiz-server-timing');
      Timing.on(); await tick();
      expect(Timing.on()).toBe(false);
    } finally { supabase.from = from; }
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
