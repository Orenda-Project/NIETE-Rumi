'use strict';
/**
 * The reminder ask on the standing link: the two step answers whose screens draw the #wq-remind slot ("Whose turn?",
 * arrive's `who`; "Is your name here?", letter's `chips`) carry the bot's existing push decision (web-quiz-push-field
 * pushField(): {push_remind: true} or {}) and, with it on, `remind_code`, the code the ask subscribes with:
 *   - tonight's round share code for the class when a ready round exists (the evening round's own read);
 *   - else the link's own code; the evening round off -> the link's code with no round read at all.
 * Off -> neither key; the answers are today's. The teacher step draws no slot and never carries the field.
 *
 * The real chain: the bot's /api/internal/wq/cl/* routes over HTTP, the real pushField (the hub switches' one read,
 * warmed as the page boot warms it, and the push env). Faked boundaries only: Supabase (in memory), Redis (a Map), SQS,
 * the loggers, the event key module.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`, dk: () => 'dk', cls: () => 'clshash00000', qk: () => 'qk00000000', envelope: (f) => ({ ev_v: 2, ...f }),
}));

const crypto = require('crypto');
const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');

const CODE = 'K7Q2MXTRAB';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const DEV = 'PlayedInClassDevice_e1'; // a phone that played as Zara
const DEV_FRESH = 'FreshPhoneNeverPlayed1'; // a phone that never played here
const ON = (k) => ({ key: k, value: true });
const LINK_ON = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link')];
const PUSH_ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPubKey', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt',
};
const today = () => require('../../shared/services/nudges/pkt-time').pktDate(new Date());

let fake;
async function seed({ push = true, evening = true, round = true } = {}) {
  const db = {
    app_settings: [...LINK_ON, ...(evening ? [ON('web_quiz_evening_round')] : []), ...(push ? [ON('web_quiz_push_remind')] : [])],
    users: [{ id: TEACHER, name: 'Rifat Test', school_id: null, preferred_language: 'en' }],
    classes: [{ id: CLASS, school_id: null, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_links: [{ code: CODE, class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2099-03-31T18:59:59Z', revoked_at: null }],
    class_teachers: [{ class_id: CLASS, teacher_user_id: TEACHER, is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: ZARA, is_active: true }],
    students: [{ id: ZARA, student_name: 'Zara Test', list_id: null, is_active: true }],
    quiz_sessions: [{ id: 's1', student_id: ZARA, device_ref: DEV, quiz_id: 'qn' }],
    quizzes: round
      ? [{ id: 'qr', teacher_id: TEACHER, status: 'ready', meta: { source: 'evening_round', class_id: CLASS, round_day: today(), round_code: 'RND234', share_code_id: 'scr', n_items: 7, n_recall: 2 } }]
      : [],
    quiz_share_codes: round ? [{ id: 'scr', code: 'RND234', quiz_id: 'qr', class_id: CLASS }] : [],
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  try { require('../../shared/services/quiz/web-quiz-evening-round')._resetCache(); } catch (_) { /* not on this build */ }
  // the hub switches' one read, as the page boot makes it (the push field never reads on its own)
  const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
  HubFlags._resetCache();
  await HubFlags.flags();
}

let srv;
let base;
const post = async (step, body) => {
  const r = await fetch(`${base}/api/internal/wq/cl/${step}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
/** A fresh phone's way to the name step: arrive -> the teacher -> a letter -> the chips under it. */
async function chipsStep() {
  const a = (await post('arrive', { code: CODE, device_ref: DEV_FRESH })).body;
  expect(a.step).toBe('teacher');
  // the class's own teacher is the only named teacher here (no school): the right tap
  const l = (await post('teacher', { code: CODE, s: a.s, tk: a.teachers[0].tk })).body;
  expect(l.step).toBe('letter');
  const c = (await post('letter', { code: CODE, s: l.s, letter: 'Z' })).body;
  expect(c.step).toBe('chips');
  return { teacher: a, chips: c };
}

beforeAll(async () => {
  process.env.WEB_QUIZ_TOKEN_SECRET = 'class-link-remind-test-secret';
  Object.assign(process.env, PUSH_ENV);
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq/cl', require('../../shared/routes/web-quiz-class-link.routes'));
  srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(async () => {
  await new Promise((r) => srv.close(r));
  Object.keys(PUSH_ENV).forEach((k) => { delete process.env[k]; });
});
beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
});

describe('push on (web_quiz_push_remind, push env set)', () => {
  test('"Whose turn?" carries push_remind and tonight\'s round share code as remind_code', async () => {
    await seed();
    const { status, body } = await post('arrive', { code: CODE, device_ref: DEV });
    expect(status).toBe(200);
    expect(body.step).toBe('who');
    expect(body.push_remind).toBe(true);
    expect(body.remind_code).toBe('RND234');
  });

  test('no ready round for the class tonight: remind_code is the link\'s own code', async () => {
    await seed({ round: false });
    const { body } = await post('arrive', { code: CODE, device_ref: DEV });
    expect(body.step).toBe('who');
    expect(body.push_remind).toBe(true);
    expect(body.remind_code).toBe(CODE);
  });

  test('a round code the ask would not take (not 4-12 letters and digits): remind_code is the link\'s code', async () => {
    await seed();
    fake.db.quizzes[0].meta.round_code = 'RND_234'; // the round's row as stored (no cached summary yet)
    const { body } = await post('arrive', { code: CODE, device_ref: DEV });
    expect(body.push_remind).toBe(true);
    expect(body.remind_code).toBe(CODE);
  });

  test('the evening round off: remind_code is the link\'s code, and no round is read', async () => {
    await seed({ evening: false });
    const from = jest.spyOn(supabase, 'from');
    const { body } = await post('arrive', { code: CODE, device_ref: DEV });
    expect(body.push_remind).toBe(true);
    expect(body.remind_code).toBe(CODE);
    expect(from.mock.calls.filter(([t]) => t === 'quizzes')).toHaveLength(0);
    from.mockRestore();
  });

  test('"Is your name here?" (the letter step\'s chips) carries push_remind and remind_code; the teacher step never does', async () => {
    await seed();
    const { teacher, chips } = await chipsStep();
    expect(chips.push_remind).toBe(true);
    expect(chips.remind_code).toBe('RND234');
    expect(teacher).not.toHaveProperty('push_remind');
    expect(teacher).not.toHaveProperty('remind_code');
  });

  test('"Whose turn?"\'s way out for a child not listed (the teacher step it carries) has no field of its own', async () => {
    await seed();
    const { body } = await post('arrive', { code: CODE, device_ref: DEV });
    expect(body.other.step).toBe('teacher');
    expect(body.other).not.toHaveProperty('push_remind');
    expect(body.other).not.toHaveProperty('remind_code');
  });
});

describe('push off: the answers are today\'s', () => {
  test('switch off: "Whose turn?" and the chips step carry neither key, with today\'s keys only', async () => {
    await seed({ push: false });
    const who = (await post('arrive', { code: CODE, device_ref: DEV })).body;
    expect(Object.keys(who)).toEqual(['step', 's', 'kids', 'other']);
    const { chips } = await chipsStep();
    expect(Object.keys(chips)).toEqual(['step', 's', 'kids']);
  });

  test('switch on but the push env incomplete: no field (pushField answers {})', async () => {
    await seed();
    const salt = process.env.WQ_PUSH_HASH_SALT;
    delete process.env.WQ_PUSH_HASH_SALT;
    try {
      const who = (await post('arrive', { code: CODE, device_ref: DEV })).body;
      expect(who).not.toHaveProperty('push_remind');
      expect(who).not.toHaveProperty('remind_code');
    } finally {
      process.env.WQ_PUSH_HASH_SALT = salt;
    }
  });

  test('the step functions called on their own (no push argument) answer as today', async () => {
    await seed();
    const CL = require('../../shared/services/quiz/web-quiz-class-link');
    const who = await CL.arrive({ code: CODE, device_ref: DEV });
    expect(Object.keys(who)).toEqual(['step', 's', 'kids', 'other']);
  });
});
