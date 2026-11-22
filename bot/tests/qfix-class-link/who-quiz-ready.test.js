'use strict';
/**
 * "Whose turn?" on the standing link marks each child who has tonight's class quiz waiting (PLAN §11 A14, take A:
 * the per-child "Quiz ready" badge; B's sibling pip = the badge stays on the sibling still waiting):
 *   - a child of the class with no finished sitting on tonight's round: { round: true } on their chip;
 *   - a child who finished it: no mark; with the switch off: no mark and no round read at all;
 *   - the page draws the badge only on a marked chip (dashboard test qfix-class-link/who-quiz-ready).
 * And the round lookup reads only the asked classes' rounds (the partial unique index on round_day, class_id), never
 * every round of the day, on a cache miss.
 * Faked boundaries: Supabase (in memory), Redis (a Map), SQS, the loggers.
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

const fs = require('fs');
const path = require('path');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const SQS = require('../../shared/services/queue/sqs-queue.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');

const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const DEV = 'PlayedInClassDevice_e1';
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];

let db;
function seed(over = {}) {
  db = {
    app_settings: SWITCHES,
    quizzes: [
      { id: 'qr', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'ready', created_at: '2026-11-24T11:10:00Z', meta: { source: 'evening_round', class_id: CLASS, round_day: '2026-11-24' } },
      { id: 'qn', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-24T09:00:00Z', meta: { source: 'lp_offer' } },
      { id: 'qm', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-23T09:00:00Z', meta: null },
    ],
    quiz_share_codes: [{ id: 'scr', code: 'RND234', quiz_id: 'qr', class_id: CLASS }, { id: 'scn', code: 'NRM234', quiz_id: 'qn', class_id: CLASS }],
    users: [{ id: TEACHER, name: 'Rifat Test', school_id: null, preferred_language: 'en' }],
    classes: [{ id: CLASS, school_id: null, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_links: [{ code: 'K7Q2MXTRAB', class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null }],
    class_teachers: [{ class_id: CLASS, teacher_user_id: TEACHER, is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: ZARA, is_active: true }],
    students: [{ id: ZARA, student_name: 'Zara Test', list_id: null, is_active: true }],
    quiz_sessions: [{ id: 's1', student_id: ZARA, device_ref: DEV, quiz_id: 'qn' }],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  try { require('../../shared/services/quiz/web-quiz-evening-round')._resetCache(); } catch (_) { /* not on this build */ }
}


const ALI = 'c0000002-0000-4000-8000-0000000000e1';
const today = () => require('../../shared/services/nudges/pkt-time').pktDate(new Date());

function seedTonight({ switchOn = true, aliDone = true } = {}) {
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache(); // the switch's 30 s cache
  seed({
    app_settings: switchOn ? SWITCHES : SWITCHES.filter((s) => s.key !== 'web_quiz_evening_round'),
    quizzes: [
      { id: 'qr', teacher_id: TEACHER, status: 'ready', meta: { source: 'evening_round', class_id: CLASS, round_day: today(), round_code: 'RND234', share_code_id: 'scr', n_items: 7, n_recall: 2 } },
      { id: 'qo', teacher_id: TEACHER, status: 'ready', meta: { source: 'evening_round', class_id: 'c1a55000-0000-4000-8000-0000000000ff', round_day: today(), round_code: 'OTH234', share_code_id: 'sco' } },
    ],
    class_enrollments: [{ class_id: CLASS, student_id: ZARA, is_active: true }, { class_id: CLASS, student_id: ALI, is_active: true }],
    students: [{ id: ZARA, student_name: 'Zara Test', list_id: null, is_active: true }, { id: ALI, student_name: 'Ali Test', list_id: null, is_active: true }],
    quiz_sessions: [
      { id: 's1', student_id: ZARA, device_ref: DEV, quiz_id: 'qn' },
      { id: 's2', student_id: ALI, device_ref: DEV, quiz_id: 'qn' },
      ...(aliDone ? [{ id: 's3', student_id: ALI, device_ref: DEV, quiz_id: 'qr', share_code_id: 'scr', completed_at: new Date().toISOString() }] : []),
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'evening-round-test-secret';
});

const CL = () => require('../../shared/services/quiz/web-quiz-class-link');
const byFirst = (r) => Object.fromEntries(r.kids.map((k) => [k.first, k.round === true]));

test('"Whose turn?": the child with tonight\'s quiz waiting is marked; the one who finished it is not', async () => {
  seedTonight();
  const r = await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV });
  expect(r.step).toBe('who');
  expect(byFirst(r)).toEqual({ Zara: true, Ali: false });
});

test('both waiting: both marked (the sibling keeps the mark until they play)', async () => {
  seedTonight({ aliDone: false });
  const r = await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV });
  expect(byFirst(r)).toEqual({ Zara: true, Ali: true });
});

test('switch off: no mark, and the round is never read', async () => {
  seedTonight({ switchOn: false });
  const from = jest.spyOn(supabase, 'from');
  const r = await CL().arrive({ code: 'K7Q2MXTRAB', device_ref: DEV });
  expect(byFirst(r)).toEqual({ Zara: false, Ali: false });
  const quizReads = from.mock.calls.filter(([t]) => t === 'quizzes');
  expect(quizReads).toHaveLength(0);
});

test('a cache miss reads only the asked class\'s round, never every round of the day', async () => {
  seedTonight();
  const R = require('../../shared/services/quiz/web-quiz-evening-round');
  const got = await R.roundsForClasses([CLASS], today());
  expect([...got.keys()]).toEqual([CLASS]);
  // the query itself carries the class filter: every builder call on 'quizzes' recorded through a proxy
  const calls = [];
  const realFrom = supabase.from;
  supabase.from = (t) => {
    const b = realFrom(t);
    if (t !== 'quizzes') return b;
    const proxy = new Proxy(b, { get(o, k) {
      const f = o[k];
      if (typeof f !== 'function' || k === 'then') return typeof f === 'function' ? f.bind(o) : f;
      return (...a) => { calls.push([k, ...a]); const res = f.apply(o, a); return res === o ? proxy : res; };
    } });
    return proxy;
  };
  redis._store.clear();
  await R.roundsForClasses([CLASS], today());
  supabase.from = realFrom;
  expect(calls).toContainEqual(['in', 'meta->>class_id', [CLASS]]);
});
