'use strict';
/**
 * The standing class link with the Challenge served under web_quiz_challenge_v2, and its hand-off to the hub.
 *
 *   - the hand-off: the pick's /h/<token>?from=class_link, opened as the portal opens it (from= → the bot's src),
 *     makes the hub's own hub_open carry src 'class_link' (the hub is the one writer of hub_open);
 *   - the served row of a class-link pick says via 'class_link', the link's class and the pick's identity columns;
 *     the teacher's own visit is served as practice (never a counted run, no fixed grade written).
 *
 * Faked boundaries only: Supabase in memory (filters applied), Redis as a Map, R2, TTS, the LLM, the loggers.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/put/${key}?ct=${encodeURIComponent(type)}&ttl=${ttl}&X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key, ttl, { bucket } = {}) => `https://signed.test/${key}?b=${bucket}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { _store: store, isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), set: async (k, v) => { store.set(k, v); return true; }, setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }, delete: async (k) => store.delete(k) };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));


const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const CL = require('../../../shared/services/quiz/web-quiz-class-link');
const resetters = ['web-quiz-hub-flags', 'web-quiz-class-link-flags', 'web-quiz-identity-roster', 'web-quiz-hub', 'web-quiz-identity-flags']
  .map((m) => require(`../../../shared/services/quiz/${m}`)).filter((m) => typeof m._resetCache === 'function');

const SCHOOL = '5c400000-0000-4000-8000-000000000001';
const TEACHER = '7e000000-0000-4000-8000-000000000001';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const K3 = '44444444-4444-4444-8444-444444444444';
const L3 = 'a0000000-0000-4000-8000-000000000003';
const DEV = 'FamilyPhoneDeviceRef_1';
const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const flagsOf = (...keys) => keys.map((key) => ({ key, value: true }));
const ON = ['web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_class_link', 'web_quiz_hub', 'web_quiz_events_v2'];

let db;
function reset(settings = ON) {
  db = {
    app_settings: flagsOf(...settings),
    users: [{ id: TEACHER, name: 'Rabia Noor', school_id: SCHOOL, preferred_language: 'en' }],
    classes: [{ id: CLASS, school_id: SCHOOL, grade_code: '3', section: 'A', is_active: true }],
    class_teachers: [{ class_id: CLASS, teacher_user_id: TEACHER, is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: K3, roll_number: 1, is_active: true }],
    student_lists: [{ id: L3, class_name: '3', section: 'A', user_id: TEACHER, is_active: true }],
    students: [{ id: K3, list_id: L3, student_name: 'Zara Khan', is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' }],
    quiz_sessions: [{ id: 's1', student_id: K3, device_ref: DEV, created_at: '2026-10-01T00:00:00Z' }],
    quiz_share_codes: [],
    class_links: [],
    web_quiz_challenge_runs: [],
    challenge_periods: [{ period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' }],
    challenge_passages: [],
    challenge_draws: [],
    child_identity: [],
  };
  Object.assign(supabase, makeFake(db, { uniques: { class_links: ['code'] } }));
  Ch.__reset();
  resetters.forEach((m) => m._resetCache());
  redis._store.clear();
  jest.clearAllMocks();
}
beforeAll(() => {
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  process.env.CHILD_TEST_R2_ENV = 'sandbox';
  process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.org';
});

/** The pick on the device that played in the class ("Whose turn?"); jt = the teacher card's own visit. */
async function pickHref({ jt } = {}) {
  const { code } = await CL.mint({ teacherId: TEACHER, classId: CLASS });
  const a = await CL.arrive({ code, device_ref: DEV, ...(jt ? { jt: CL.signTeacherPreview(code) } : {}) });
  expect(a.step).toBe('who');
  const p = await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV });
  const m = /^\/h\/([^?]+)\?from=([a-z_]+)$/.exec(p.href);
  expect(m).not.toBeNull();
  return { token: m[1], from: m[2] };
}

describe('the hand-off: the hub (its one writer) logs hub_open with src class_link', () => {
  let server;
  let base;
  beforeEach(async () => {
    reset();
    const app = express();
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterEach(() => new Promise((r) => server.close(r)));

  test('/h/<token>?from=class_link, as the portal forwards it (from → src), gives hub_open{src:class_link}', async () => {
    const { token, from } = await pickHref();
    expect(from).toBe('class_link');
    // the portal's /h/:token passes ?from= to the bot as ?src= (dashboard/routes/web-quiz.routes.js)
    const r = await fetch(`${base}/hub/${token}?src=${from}`, { headers: { 'x-api-key': 'test-internal-key', 'x-wq-device': DEV } });
    expect(r.status).toBe(200);
    const opens = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.hub_open');
    expect(opens).toHaveLength(1);
    expect(opens[0][1]).toMatchObject({ src: 'class_link' });
    // the class link module itself never writes hub_open
    expect(JSON.stringify(opens[0][1])).not.toContain(CLASS);
  });
});

describe('a class-link pick served under web_quiz_challenge_v2', () => {
  const served = (ex) => db.web_quiz_challenge_runs.find((r) => r.id === T.verify(ex.ct, 'c').r);

  test('the served row: via class_link, the link\'s class, the pick\'s identity columns', async () => {
    reset();
    const { token } = await pickHref();
    const ex = await Ch.exercise(token, 'bigger', { device: DEV, lang: 'en' });
    expect(served(ex)).toMatchObject({ via: 'class_link', class_id: CLASS, id_src: 'remembered', id_confidence: 'high', homonym_in_list: false, canonical_id: K3, mode: 'check' });
    // the serve itself knows the route (the measurement event and the sample arm read it there), not only the row
    const start = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.ch_start').map((c) => c[1]);
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({ via: 'class_link' });
  });

  test('the teacher\'s own visit is served as practice: never a counted run, no fixed grade written', async () => {
    reset();
    const { token } = await pickHref({ jt: true });
    const ex = await Ch.exercise(token, 'bigger', { device: DEV, lang: 'en' });
    expect(ex.mode).toBe('practice');
    expect(served(ex)).toMatchObject({ via: 'class_link', class_id: CLASS, mode: 'practice' });
    expect(served(ex).record).not.toBe(true);
    expect(db.child_identity).toEqual([]);
  });
});
