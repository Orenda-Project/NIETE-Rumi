'use strict';
/**
 * roundsReadyForPhone reports only what is still WAITING on this phone (lead A73 / manager brief):
 *   - a class whose phone-children have ALL finished tonight's round (a completed quiz_sessions row on the round's share
 *     code by the child) is left out; otherwise the class stays;
 *   - with { withKids: true }, `kids` lists only the children still waiting, each with `student_id` ALWAYS, and
 *     `first` / `first_ur` ONLY when app_settings web_quiz_push_name_children is on (JSON true); missing or false -> no
 *     students row is read at all;
 *   - one quiz_sessions read answers "finished?" for every ready round of the phone.
 * Faked boundaries: Supabase (in memory, filters applied), Redis (a Map), the loggers. Invented children only.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');

const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const DEV = 'EveningRoundPhone_0001';
const DAY = '2026-11-24';
const ON = (k, value = true) => ({ key: k, value });
const BASE = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const NAMES_ON = [...BASE, ON('web_quiz_push_name_children')];
const done = (id, sc = 'scr1') => ({ id: `d-${id}-${sc}`, student_id: id, device_ref: 'SomeOtherPhoneRef_0001', quiz_id: 'qr1', share_code_id: sc, completed_at: '2026-11-24T13:10:00Z' });

function seed({ settings = NAMES_ON, sessions = [] } = {}) {
  const db = {
    app_settings: settings,
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: ZARA, is_active: true }, { class_id: CLASS, student_id: ALI, is_active: true }],
    class_links: [{ code: 'K7Q2MXTRAB', class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2099-03-31T18:59:59Z', revoked_at: null }],
    students: [
      { id: ZARA, student_name: 'Zara Test', student_name_urdu: 'زارا ٹیسٹ' },
      { id: ALI, student_name: 'Ali Test', student_name_urdu: null },
    ],
    // both children played on this phone before
    quiz_sessions: [
      { id: 's1', student_id: ZARA, device_ref: DEV, quiz_id: 'q0' },
      { id: 's2', student_id: ALI, device_ref: DEV, quiz_id: 'q0' },
      ...sessions,
    ],
    quizzes: [{
      id: 'qr1', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'ready',
      meta: { source: 'evening_round', class_id: CLASS, round_day: DAY, class_link_code: 'K7Q2MXTRAB', round_code: 'RND234', share_code_id: 'scr1', round_ready_at: '2026-11-24T11:05:00Z', n_items: 7, n_recall: 2 },
    }],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  return db;
}
function tablesRead() {
  const tables = [];
  const real = supabase.from;
  supabase.from = (t) => { tables.push(t); return real(t); };
  return { tables, restore: () => { supabase.from = real; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'evening-round-test-secret';
  redis._store.clear();
});

const CL = () => require('../../shared/services/quiz/web-quiz-class-link');

test('two children of one class on the phone, one finished tonight: the class stays, kids = the one still waiting', async () => {
  seed({ sessions: [done(ALI)] });
  const out = await CL().roundsReadyForPhone(DEV, DAY, { withKids: true });
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ class_link_code: 'K7Q2MXTRAB', round_code: 'RND234' });
  expect(out[0].kids).toEqual([{ student_id: ZARA, first: 'Zara', first_ur: 'زارا' }]);
});

test('both finished tonight: the class is left out (with or without kids)', async () => {
  seed({ sessions: [done(ALI), done(ZARA)] });
  expect(await CL().roundsReadyForPhone(DEV, DAY, { withKids: true })).toEqual([]);
  redis._store.clear();
  expect(await CL().roundsReadyForPhone(DEV, DAY)).toEqual([]);
});

test('an unfinished sitting, or a finish on another quiz, is not tonight\'s finish', async () => {
  seed({ sessions: [{ ...done(ALI), completed_at: null }, done(ZARA, 'scOTHER')] });
  const out = await CL().roundsReadyForPhone(DEV, DAY, { withKids: true });
  expect(out[0].kids.map((k) => k.student_id)).toEqual([ZARA, ALI]);
});

test.each([
  ['missing', BASE],
  ['false', [...BASE, ON('web_quiz_push_name_children', false)]],
])('web_quiz_push_name_children %s: kids carry student_id only, and no students row is read', async (_, settings) => {
  seed({ settings, sessions: [done(ALI)] });
  const t = tablesRead();
  const out = await CL().roundsReadyForPhone(DEV, DAY, { withKids: true });
  t.restore();
  expect(out[0].kids).toEqual([{ student_id: ZARA }]);
  expect(t.tables).not.toContain('students');
  expect(JSON.stringify(out)).not.toMatch(/Zara|زارا|Ali Test/);
});

test('web_quiz_push_name_children on: first names with each student_id', async () => {
  seed();
  const out = await CL().roundsReadyForPhone(DEV, DAY, { withKids: true });
  expect(out[0].kids).toEqual([{ student_id: ZARA, first: 'Zara', first_ur: 'زارا' }, { student_id: ALI, first: 'Ali', first_ur: null }]);
});

test('one quiz_sessions read answers "finished?" for the phone\'s ready rounds (plus the one that finds its children)', async () => {
  seed({ sessions: [done(ALI)] });
  const t = tablesRead();
  await CL().roundsReadyForPhone(DEV, DAY, { withKids: true });
  t.restore();
  expect(t.tables.filter((x) => x === 'quiz_sessions')).toHaveLength(2);
});
