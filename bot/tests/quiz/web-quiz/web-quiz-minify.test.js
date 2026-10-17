'use strict';
/**
 * Minified page files (app_settings web_quiz_minify, default off, fail closed, 30 s cache).
 *
 * On: the quiz payload (getQuiz) and the hub payload (Hub.hub) say `min: true`, and the edge links the child pages'
 * JS/CSS at `?v=<hex>m` (their minified copies, at their own immutable URLs). Off: both payloads are today's, byte
 * for byte (the quiz one against the golden recorded before web_quiz_fast; no `min` key anywhere).
 *
 * Supabase, Redis and WhatsApp are the boundaries and are faked; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
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
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const { fixturePhone } = require('./fixture-phone');

const stable = (o) => JSON.parse(JSON.stringify(o));
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const SAVED = { ...process.env };
afterAll(() => { process.env = SAVED; });

let supabase;
let Min;
function fresh() {
  jest.resetModules();
  supabase = require('../../../shared/config/supabase');
  Min = require('../../../shared/services/quiz/web-quiz-minify');
}
const wait = () => new Promise((r) => setTimeout(r, 5));

describe('the switch (web-quiz-minify.js)', () => {
  beforeEach(() => fresh());
  const settings = (rows, fail = false) => {
    const fake = makeFake({ app_settings: rows });
    Object.assign(supabase, { from: (t) => {
      if (fail) throw new Error('db down');
      return fake.from(t);
    } });
  };

  test('the first read after a start is off (never waited for); the next one answers from the refreshed cache', async () => {
    settings([{ key: 'web_quiz_minify', value: true }]);
    expect(Min.KEY).toBe('web_quiz_minify');
    expect(Min.on()).toBe(false);
    await wait();
    expect(Min.on()).toBe(true);
  });

  test('missing, false, "false", junk, strings (even "true"), 1 and null and a failed read are all off (fail closed); only JSON true is on', async () => {
    for (const [rows, want] of [[[], false], [[{ key: 'web_quiz_minify', value: false }], false], [[{ key: 'web_quiz_minify', value: 'false' }], false],
      [[{ key: 'web_quiz_minify', value: 'yes' }], false], [[{ key: 'web_quiz_minify', value: '"true"' }], false], [[{ key: 'web_quiz_minify', value: 'true' }], false],
      [[{ key: 'web_quiz_minify', value: 1 }], false], [[{ key: 'web_quiz_minify', value: null }], false], [[{ key: 'web_quiz_minify', value: true }], true]]) {
      Min._reset();
      settings(rows);
      Min.on();
      await wait();
      expect(Min.on()).toBe(want);
    }
    Min._reset();
    settings([], true);
    Min.on();
    await wait();
    expect(Min.on()).toBe(false);
  });

  test('a value is kept 30 s: a change inside the window is not seen, one after it is (refreshed in the background)', async () => {
    const rows = [{ key: 'web_quiz_minify', value: false }];
    settings(rows);
    const t0 = Date.now();
    Min.on(t0);
    await wait();
    expect(Min.on(t0)).toBe(false);
    rows[0].value = true;
    expect(Min.on(t0 + 29000)).toBe(false);
    await wait();
    expect(Min.on(t0 + 29000)).toBe(false);
    expect(Min.on(Date.now() + 31000)).toBe(false); // stale: answers the old value, refreshes behind it
    await wait();
    expect(Min.on()).toBe(true);
  });
});

describe('the quiz payload (getQuiz)', () => {
  const GOLDEN = path.join(__dirname, 'web-quiz-fast-reads.golden.json'); // recorded before web_quiz_fast; still today's
  const TEACHER = '11111111-1111-4111-8111-111111111111';
  const QUIZ = '22222222-2222-4222-8222-222222222222';
  const SC = '33333333-3333-4333-8333-333333333333';
  const KID = (n) => `44444444-4444-4444-8444-44444444444${n}`;
  let WQ;
  function seed({ min = null } = {}) {
    const fake = makeFake({
      quiz_share_codes: [{ id: SC, code: 'FAST01', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
        topic: 'Plants', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(2) }],
      quizzes: [{ id: QUIZ, topic: 'Plants', grade: '3', subject: 'Science', language: 'en', meta: {}, video_id: null, list_id: null }],
      quiz_questions: [1, 2, 3].map((n) => ({
        id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: `q${n}`, sort_order: n,
        question_text: `Which one grows from a seed? (${n})`, option_a: 'Tree', option_b: 'Stone', option_c: 'Cup', option_d: null,
        correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null,
      })),
      quiz_sessions: [1, 2].map((n) => ({ id: `55555555-5555-4555-8555-55555555555${n}`, share_code_id: SC, quiz_id: QUIZ, student_id: KID(n),
        user_id: null, status: 'completed', source: 'share_link', invited_by_student_id: null, student_class: '3-A',
        completed_at: new Date().toISOString(), created_at: new Date().toISOString() })),
      students: [],
      app_settings: min == null ? [] : [{ key: 'web_quiz_minify', value: min }],
    });
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  }
  const load = () => { fresh(); WQ = require('../../../shared/services/quiz/web-quiz.service'); };
  beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; });

  test('switch off (no row): the payload is today\'s, byte for byte (golden), with no `min` key', async () => {
    load();
    seed();
    await WQ.getQuiz('FAST01');
    await wait();
    const out = stable(await WQ.getQuiz('FAST01'));
    expect(out).not.toHaveProperty('min');
    expect(JSON.stringify(out, null, 1)).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd());
  });

  test('switch set false: still no `min` key', async () => {
    load();
    seed({ min: false });
    await WQ.getQuiz('FAST01');
    await wait();
    expect(stable(await WQ.getQuiz('FAST01'))).not.toHaveProperty('min');
  });

  test('switch on: the payload is the switch-off payload plus `min: true` (the first read after a start is off)', async () => {
    load();
    seed();
    const off = stable(await WQ.getQuiz('FAST01'));
    load();
    seed({ min: true });
    const first = stable(await WQ.getQuiz('FAST01'));
    expect(first).not.toHaveProperty('min');
    await wait();
    const on = stable(await WQ.getQuiz('FAST01'));
    expect(on.min).toBe(true);
    delete on.min;
    expect(on).toEqual(off);
  });
});

describe('the hub payload (Hub.hub)', () => {
  const PHONE = fixturePhone(1);
  const KID = '44444444-4444-4444-8444-000000000001';
  const TEACHER = '11111111-1111-4111-8111-000000000001';
  const LIST = '55555555-5555-4555-8555-000000000001';
  const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
  const AT = { kid: ago(500), code: ago(60), played: ago(50) }; // one clock for both payloads
  let db;
  let Hub;
  let T;
  let redis;
  function load() {
    fresh();
    Hub = require('../../../shared/services/quiz/web-quiz-hub');
    T = require('../../../shared/services/quiz/web-quiz-token');
    redis = require('../../../shared/services/cache/railway-redis.service');
    redis._store.clear();
  }
  function seed(min) {
    db = {
      app_settings: [{ key: 'web_quiz_hub', value: 'true' }, ...(min == null ? [] : [{ key: 'web_quiz_minify', value: min }])],
      students: [{ id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: PHONE, created_at: AT.kid }],
      student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
      quizzes: [{ id: 'q-eng', topic: 'Nouns', subject: 'english', language: 'en', grade: '3', video_id: null }],
      quiz_share_codes: [{ id: 'sc-eng', code: 'ENGL01', quiz_id: 'q-eng', active: true, expires_at: future, topic: 'Topic ENGL01', language: 'en',
        teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: AT.code }],
      quiz_sessions: [{ id: 's3', share_code_id: 'sc-eng', quiz_id: 'q-eng', student_id: KID, status: 'completed', correct_answers: 6, total_questions_answered: 8,
        mastery_percentage: 75, completed_at: AT.played, created_at: AT.played, student_class: '3' }],
      student_videos: [],
    };
    const fake = makeFake(db);
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  }
  beforeEach(() => {
    process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'hub-test-secret', PORTAL_URL: 'https://portal.example.test' };
    delete process.env.WEB_QUIZ_BASE_URL;
  });
  const open = async () => { Hub._resetCache(); redis._store.clear(); return stable(await Hub.hub(T.signHub([KID]), A)); };

  test('switch off: no `min` key; switch on: the switch-off payload plus `min: true`', async () => {
    load();
    seed();
    await open();
    await wait();
    const off = await open();
    expect(off).not.toHaveProperty('min');
    load();
    seed(true);
    expect(await open()).not.toHaveProperty('min'); // first read after a start: off
    await wait();
    const on = await open();
    expect(on.min).toBe(true);
    delete on.min;
    expect(on).toEqual(off);
  });

  test('with the read-along preview on too: both keys (`listen` and `min`), and otherwise the switch-off payload', async () => {
    load();
    seed();
    db.app_settings.push({ key: 'web_quiz_readalong', value: true });
    await open();
    await wait();
    const listenOnly = await open();
    expect(listenOnly.listen).toBe(true);
    expect(listenOnly).not.toHaveProperty('min');
    load();
    seed(true);
    db.app_settings.push({ key: 'web_quiz_readalong', value: true });
    await open();
    await wait();
    const both = await open();
    expect(both.listen).toBe(true);
    expect(both.min).toBe(true);
    delete both.min;
    expect(both).toEqual(listenOnly);
  });

  test('with the fast page on too (the one-read switch path): `fast`, `listen` and `min`, and otherwise the minify-off payload', async () => {
    const fastRows = () => db.app_settings.push({ key: 'web_quiz_fast', value: true }, { key: 'web_quiz_readalong', value: true });
    load();
    seed();
    fastRows();
    await open();
    await wait();
    await open();
    await wait();
    const fastOnly = await open();
    expect(fastOnly.fast).toBe(true);
    expect(fastOnly.listen).toBe(true);
    expect(fastOnly).not.toHaveProperty('min');
    load();
    seed(true);
    fastRows();
    await open();
    await wait();
    await open();
    await wait();
    const all = await open();
    expect(all.fast).toBe(true);
    expect(all.listen).toBe(true);
    expect(all.min).toBe(true);
    delete all.min;
    expect(all).toEqual(fastOnly);
  });
});
