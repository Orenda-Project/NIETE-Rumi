'use strict';
/**
 * One home for "an event under events v2, else today's fields" (web-quiz-kid.js emit): kind 'envelope' (the binding
 * events) and kind 'mark' (the hub door), the switch read fail-closed, and the teacher's Undo (the Jugnu tab's POST
 * /unbind) logging its web_quiz.bind_undo through it. Faked boundaries: Supabase (in-memory app_settings, roster and
 * child_phone_bindings), the loggers and the door's cache forget; the binding store, the event key module and the
 * switch module run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/quiz/web-quiz-join-queue', () => ({
  candidatesFor: jest.fn(async () => []), decide: jest.fn(async () => ({ ok: true })), linkClassCodes: jest.fn(async () => ({ linked: 0 })),
}));
const CHILD = 'b0000000-0000-4000-8000-000000000002';
const BIND = 'e0000000-0000-4000-8000-000000000001';
jest.mock('../../../shared/services/quiz/web-quiz-class-link-flags', () => ({ classLinkOn: jest.fn(async () => false) }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const { fixturePhone } = require('./fixture-phone');

const KEY = 'unit-kid-key-not-a-secret-32-bytes!!';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const PHONE = fixturePhone(937);

function seed({ eventsV2 }) {
  const db = {
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_events_v2', value: eventsV2 ? 'true' : 'false' },
      { key: 'web_quiz_teacher_jugnu', value: 'true' }, { key: 'web_quiz_challenge_v2', value: 'true' }, { key: 'web_quiz_challenge', value: 'true' }],
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', status: 'report_sent', list_id: null, created_at: '2026-10-14T03:00:00.000Z', meta: {} }],
    student_lists: [{ id: LIST, class_name: 'Grade 3', section: 'B', user_id: TEACHER, is_active: true, class_id: CLASS }],
    students: [{ id: CHILD, list_id: LIST, roll_number: 2, student_name: 'Bilal Testwala', father_name: null, is_active: true, merged_into: null }],
    class_enrollments: [{ class_id: CLASS, student_id: CHILD, is_active: true }],
    child_phone_bindings: [{ id: BIND, canonical_id: CHILD, phone_norm: PHONE, phone_tomb: 'tomb', via: 'save', bound_at: '2026-09-01T00:00:00.000Z',
      confirmed_at: '2026-09-01T00:00:00.000Z', last_played_at: null, expires_at: '2099-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, rebind_of: null, code_id: null }],
    web_quiz_challenge_runs: [], child_rungs: [], merge_log: [], challenge_passages: [], class_links: [], quiz_share_codes: [],
  };
  const fake = makeFake(db);
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  return db;
}

const SAVED = { ...process.env };
let K;
let Flags;
let logEvent;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...SAVED, WEB_QUIZ_KID_KEY: KEY, WEB_QUIZ_KID_KEY_V: '2026', INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  K = require('../../../shared/services/quiz/web-quiz-kid');
  Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
  Flags._resetCache();
  K._reset();
});
afterAll(() => { process.env = SAVED; });

const logged = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);

describe('emit, kind envelope (the binding events)', () => {
  test('envelope kind, v2 on: kid + dk + ev_v + kid_v, no forbidden ids', async () => {
    seed({ eventsV2: true });
    await K.emit('x', { a: 1, sessionId: 's' }, { canonicalId: CHILD, device: DEV });
    const [ev] = logged('x');
    expect(ev).toMatchObject({ w: 's', ev_v: 2, kid_v: '2026', a: 1 });
    expect(ev.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(ev.dk).toMatch(/^[0-9a-f]{12}$/);
    expect(ev.kid).toBe(K.kid(CHILD));
    expect(ev).not.toHaveProperty('sessionId');
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(DEV);
  });

  test('envelope kind, v2 off: today\'s fields + w:\'s\', nothing else', async () => {
    seed({ eventsV2: false });
    await K.emit('x', { a: 1 }, { canonicalId: CHILD, device: DEV });
    expect(logged('x')).toEqual([{ a: 1, w: 's' }]);
  });
});

describe('emit, kind mark (the hub door)', () => {
  test('mark kind, v2 on → w:\'s\' added; off → fields untouched (no w)', async () => {
    seed({ eventsV2: true });
    await K.emit('door', { ok: true, sessionId: 's1' }, { kind: 'mark' });
    expect(logged('door')).toEqual([{ ok: true, sessionId: 's1', w: 's' }]);
    logEvent.mockClear();
    Flags._resetCache();
    seed({ eventsV2: false });
    await K.emit('door', { ok: true, sessionId: 's1' }, { kind: 'mark' });
    expect(logged('door')).toEqual([{ ok: true, sessionId: 's1' }]);
    expect(logged('door')[0]).not.toHaveProperty('w');
  });
});

describe('the switch read fails closed', () => {
  test('a throwing switch read = off', async () => {
    seed({ eventsV2: true });
    jest.spyOn(Flags, 'eventsV2On').mockImplementation(() => { throw new Error('boom'); });
    await K.emit('x', { a: 1 }, { canonicalId: CHILD });
    await K.emit('door', { ok: false }, { kind: 'mark' });
    expect(logged('x')).toEqual([{ a: 1, w: 's' }]);
    expect(logged('door')).toEqual([{ ok: false }]);
  });
});

describe('the teacher\'s Undo logs bind_undo through the one home', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; });
  async function undo() {
    const Identity = require('../../../shared/services/quiz/student-identity.service');
    jest.spyOn(Identity, 'forgetDoorVerdict').mockResolvedValue(undefined);
    const Token = require('../../../shared/services/quiz/teacher-report-token');
    const app = express();
    app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    const base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
    const tok = Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
    const r = await fetch(`${base}/unbind/${tok}`, { method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ binding: BIND, class: LIST }), redirect: 'manual' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).not.toMatch(/[?&]e=1/);
  }

  test('the teacher\'s Undo, v2 on: one bind_undo per child with ev_v/kid_v/kid and via:\'teacher\'', async () => {
    const db = seed({ eventsV2: true });
    await undo();
    expect(db.child_phone_bindings[0]).toMatchObject({ phone_norm: null, revoked_by: 'teacher' });
    expect(logged('web_quiz.bind_undo')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(CHILD), via: 'teacher', n: 1, audio_n: 0 }]);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(PHONE);
  });

  test('the teacher\'s Undo, v2 off: today\'s object {via, n, audio_n, w:\'s\', kid}, byte for byte', async () => {
    seed({ eventsV2: false });
    await undo();
    const evs = logged('web_quiz.bind_undo');
    expect(evs).toEqual([{ via: 'teacher', n: 1, audio_n: 0, w: 's', kid: K.kid(CHILD) }]);
    expect(JSON.stringify(evs[0])).toBe(JSON.stringify({ via: 'teacher', n: 1, audio_n: 0, w: 's', kid: K.kid(CHILD) }));
  });
});
