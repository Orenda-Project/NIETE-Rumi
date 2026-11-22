'use strict';
/**
 * roundsReadyForPhone: the reminders lane requires it from web-quiz-class-link.js. A phone that played as
 * a child of a class with a live standing link and a ready round tonight gets that class's label, the link's code and
 * the round's code; first names only. Off (web_quiz_evening_round missing/false, or the class link off) -> [].
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
const OTHER = 'c1a55000-0000-4000-8000-0000000000e2';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const DEV = 'EveningRoundPhone_0001';
const DAY = '2026-11-24';
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];

function seed(settings = SWITCHES, over = {}) {
  const db = {
    app_settings: settings,
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }, { id: OTHER, grade_code: 'grade_5', section: null, is_active: true }],
    class_enrollments: [
      { class_id: CLASS, student_id: ZARA, is_active: true },
      { class_id: CLASS, student_id: ALI, is_active: true },
      { class_id: OTHER, student_id: ALI, is_active: false },
    ],
    class_links: [{ code: 'K7Q2MXTRAB', class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null }],
    students: [
      { id: ZARA, student_name: 'Zara Test', student_name_urdu: 'زارا ٹیسٹ' },
      { id: ALI, student_name: 'Muhammad Ali Test', student_name_urdu: null },
    ],
    quiz_sessions: [{ id: 's1', student_id: ZARA, device_ref: DEV, quiz_id: 'q0' }],
    quizzes: [{
      id: 'qr1', teacher_id: TEACHER, quiz_source: 'lp_v8', status: 'ready',
      meta: { source: 'evening_round', class_id: CLASS, round_day: DAY, class_link_code: 'K7Q2MXTRAB', round_code: 'RND234', share_code_id: 'scr1', round_ready_at: '2026-11-24T11:05:00Z', n_items: 7, n_recall: 2 },
    }],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'evening-round-test-secret';
  redis._store.clear();
});

const CL = () => require('../../shared/services/quiz/web-quiz-class-link');

test('web-quiz-class-link exports roundsReadyForPhone (the reminders lane requires it there)', () => {
  expect(typeof CL().roundsReadyForPhone).toBe('function');
});

test('a phone that played as a child of the class: the class label, the standing link, tonight\'s round; NO names by default', async () => {
  seed();
  const plain = await CL().roundsReadyForPhone(DEV, DAY);
  expect(plain).toHaveLength(1);
  expect(plain[0]).not.toHaveProperty('kids');
  expect(JSON.stringify(plain)).not.toMatch(/Zara|زارا/);
});

test('{ withKids: true } with the naming switch on (web_quiz_push_name_children): the student id and first names only', async () => {
  seed([...SWITCHES, ON('web_quiz_push_name_children')]);
  const out = await CL().roundsReadyForPhone(DEV, DAY, { withKids: true });
  expect(out).toEqual([{
    class_link_code: 'K7Q2MXTRAB',
    class_id: CLASS,
    teacher_ref: expect.stringMatching(/^[0-9a-f]{16}$/),
    class_label_en: 'Class 3 B',
    class_label_ur: 'کلاس ۳ B',
    round_code: 'RND234',
    ready_at: '2026-11-24T11:05:00Z',
    kids: [{ student_id: ZARA, first: 'Zara', first_ur: 'زارا' }],
  }]);
  // the contract's code and label limits
  expect(out[0].class_link_code).toMatch(/^[A-Za-z0-9_-]{3,32}$/);
  expect([...out[0].class_label_en].length).toBeLessThanOrEqual(24);
  expect([...out[0].class_label_ur].length).toBeLessThanOrEqual(24);
  // never an id or a full name
  expect(JSON.stringify(out)).not.toMatch(/Test|ٹیسٹ|7e000000/);
});

test('a hub-trusted child counts too (HubDevice.deviceKids), the second name "Muhammad Ali" shows as Ali', async () => {
  seed([...SWITCHES, ON('web_quiz_push_name_children')]);
  const HubDevice = require('../../shared/services/quiz/web-quiz-hub-device');
  jest.spyOn(HubDevice, 'deviceKids').mockResolvedValue([ALI]);
  const out = await CL().roundsReadyForPhone(DEV, DAY, { withKids: true });
  expect(out[0].kids).toEqual(expect.arrayContaining([{ student_id: ZARA, first: 'Zara', first_ur: 'زارا' }, { student_id: ALI, first: 'Ali', first_ur: null }]));
  HubDevice.deviceKids.mockRestore();
});

test('the switch off (missing row, false, or the class link off) -> []', async () => {
  for (const settings of [SWITCHES.filter((r) => r.key !== 'web_quiz_evening_round'), [...SWITCHES.filter((r) => r.key !== 'web_quiz_evening_round'), { key: 'web_quiz_evening_round', value: false }],
    SWITCHES.filter((r) => r.key !== 'web_quiz_class_link')]) {
    seed(settings);
    redis._store.clear();
    // eslint-disable-next-line no-await-in-loop
    expect(await CL().roundsReadyForPhone(DEV, DAY)).toEqual([]);
  }
});

test('no round tonight, a revoked link, another day, an unknown phone, a bad device ref -> []', async () => {
  seed(SWITCHES, { quizzes: [] });
  expect(await CL().roundsReadyForPhone(DEV, DAY)).toEqual([]);
  redis._store.clear();
  const db = seed();
  db.class_links[0].revoked_at = '2026-11-20T00:00:00Z';
  expect(await CL().roundsReadyForPhone(DEV, DAY)).toEqual([]);
  redis._store.clear();
  seed();
  expect(await CL().roundsReadyForPhone(DEV, '2026-11-25')).toEqual([]);
  expect(await CL().roundsReadyForPhone('UnknownPhoneRef_000009', DAY)).toEqual([]);
  expect(await CL().roundsReadyForPhone('bad', DAY)).toEqual([]);
});

test('the class round is cached per day: a second phone of the class reads no quizzes row', async () => {
  seed();
  await CL().roundsReadyForPhone(DEV, DAY);
  const fake = supabase.from;
  const tables = [];
  supabase.from = (t) => { tables.push(t); return fake(t); };
  const again = await CL().roundsReadyForPhone(DEV, DAY);
  expect(again).toHaveLength(1);
  expect(tables).not.toContain('quizzes');
  supabase.from = fake;
});
