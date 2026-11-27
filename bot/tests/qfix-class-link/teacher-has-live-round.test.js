'use strict';
/**
 * teacherHasLiveRound(teacherId) (the teacher home's "Evening rounds" line, which opens the report's class tab; required
 * from web-quiz-class-link.js like hasLiveStandingLink): true exactly when the class tab's "Evening rounds" section has a
 * round to show — the section's own predicate (web-quiz-evening-round.js reportSection): a class the teacher actively
 * teaches (class_teachers, is_active) has a quiz_share_codes row created in the last REPORT_DAYS days whose quiz is an
 * evening round. A live class link is neither needed nor enough: the writer gives rounds only to classes inside
 * web_quiz_class_link_canary and only on a day a lesson plan was taken, so a live link alone used to show the line over
 * an empty tab. It never writes: two small reads (the quiz's source embedded in the share-code read), none with a switch
 * off. False on anything else, never throws.
 * Every case also asks the class tab itself (reportSection, same fake) and expects the same answer.
 * Faked boundaries: Supabase (in memory, filters applied), Redis, the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');

const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const CLASS_2 = 'c1a55000-0000-4000-8000-0000000000e2';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const OTHER_T = '7e000000-0000-4000-8000-0000000000e2';
const DAY_MS = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const ON = (k) => ({ key: k, value: true });
const ALL = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const CANARY = (value) => ({ key: 'web_quiz_class_link_canary', value });
const OUTSIDE = [...ALL, CANARY({ class_ids: [CLASS] })]; // CLASS_2 (the one with the link) is outside the canary
const INSIDE = [...ALL, CANARY({ class_ids: [CLASS_2] })];
const LIVE = { code: 'K7Q2MXTRAB', class_id: CLASS_2, teacher_id: OTHER_T, term_code: '2026-27b', expires_at: '2099-03-31T18:59:59Z', revoked_at: null };
const TEACHES = [
  { id: 'ct1', class_id: CLASS, teacher_user_id: TEACHER, is_active: true },
  { id: 'ct2', class_id: CLASS_2, teacher_user_id: TEACHER, is_active: true },
];
const ROUND_Q = { id: 'q-er', topic: 'Adding with carrying', subject: 'maths', meta: { source: 'evening_round', class_id: CLASS_2, round_day: '2026-11-21', share_code_id: 'sc-er' } };
const PLAIN_Q = { id: 'q-plain', topic: 'Fractions', subject: 'maths', meta: { source: 'lp_v8' } };
const ROUND_CODE = (over = {}) => ({ id: 'sc-er', code: 'RND234', quiz_id: 'q-er', class_id: CLASS_2, teacher_user_id: OTHER_T, created_at: ago(2), ...over });
const PLAIN_CODE = (over = {}) => ({ id: 'sc-plain', code: 'PLN234', quiz_id: 'q-plain', class_id: CLASS_2, teacher_user_id: TEACHER, created_at: ago(1), ...over });

let db;
function seed({ settings = INSIDE, links = [LIVE], teaches = TEACHES, codes = [], quizzes = [ROUND_Q, PLAIN_Q], classes = null } = {}) {
  db = {
    app_settings: settings,
    class_links: links,
    class_teachers: teaches,
    quiz_share_codes: codes,
    quizzes,
    classes: classes || [{ id: CLASS, grade_code: 'grade_3', section: 'A' }, { id: CLASS_2, grade_code: 'grade_4', section: 'B' }],
    quiz_sessions: [],
    students: [],
  };
  Object.assign(supabase, makeFake(db));
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-class-link-canary')._resetCache();
}
const CL = () => require('../../shared/services/quiz/web-quiz-class-link');
/** Does the class tab (the page the home's line opens) show an "Evening rounds" section for the teacher? */
const classTabShows = async (teacherId = TEACHER) => (await require('../../shared/services/quiz/web-quiz-evening-round').reportSection(teacherId)) !== '';
function recordTables() {
  const tables = [];
  const real = supabase.from;
  supabase.from = (t) => { tables.push(t); return real(t); };
  return { tables, done: () => { supabase.from = real; } };
}

test('exported from web-quiz-class-link.js', () => {
  expect(typeof CL().teacherHasLiveRound).toBe('function');
});

test('a live link on a class OUTSIDE the class-link canary, no round: false (the class tab has no Evening rounds section)', async () => {
  seed({ settings: OUTSIDE });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  await expect(classTabShows()).resolves.toBe(false);
});

test('a live link on a class INSIDE the canary, but no evening round in the last 7 days: false', async () => {
  seed({ settings: INSIDE });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  await expect(classTabShows()).resolves.toBe(false);
});

test('an evening round for their class 2 days ago: true — for 2 classes, ONE read each of class_teachers and quiz_share_codes (never one per class), the quiz embedded (no quizzes read), no class_links read, no write', async () => {
  seed({ codes: [ROUND_CODE()] });
  const rec = recordTables();
  const before = JSON.stringify(db);
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true);
  rec.done();
  expect(rec.tables.filter((t) => t === 'class_teachers')).toHaveLength(1);
  expect(rec.tables.filter((t) => t === 'quiz_share_codes')).toHaveLength(1);
  expect(rec.tables).not.toContain('quizzes');
  expect(rec.tables).not.toContain('class_links');
  expect(JSON.stringify(db)).toBe(before);
  await expect(classTabShows()).resolves.toBe(true);
});

test('an evening round in the window but the class link since revoked (and the class now outside the canary): true, as the class tab still shows it', async () => {
  seed({ settings: OUTSIDE, links: [{ ...LIVE, revoked_at: ago(1) }], codes: [ROUND_CODE()] });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true);
  await expect(classTabShows()).resolves.toBe(true);
});

test('an evening round for a class NOT in the canary (written before it was taken out), its link still live: true, as the class tab shows it', async () => {
  seed({ settings: OUTSIDE, codes: [ROUND_CODE()] });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true);
  await expect(classTabShows()).resolves.toBe(true);
});

test('the only evening round is 8 days old (a live link is still there): false', async () => {
  seed({ codes: [ROUND_CODE({ created_at: ago(8) })] });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  await expect(classTabShows()).resolves.toBe(false);
});

test('a teacher with no class: ONE read (class_teachers) past the switch, false', async () => {
  seed({ teaches: [], codes: [ROUND_CODE()] });
  await CL().teacherHasLiveRound(TEACHER); // warm the switch cache
  const rec = recordTables();
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  rec.done();
  expect(rec.tables).toEqual(['class_teachers']);
});

test('the round\'s quiz row is gone (the code embeds no quiz): false, as the class tab finds no quiz for it', async () => {
  seed({ codes: [ROUND_CODE()], quizzes: [PLAIN_Q] });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  await expect(classTabShows()).resolves.toBe(false);
});

test('an ordinary (not evening-round) quiz shared to the class in the window (a live link is there): false', async () => {
  seed({ codes: [PLAIN_CODE()] });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  await expect(classTabShows()).resolves.toBe(false);
});

test('the 7-day window is counted from { now }', async () => {
  seed({ codes: [ROUND_CODE({ created_at: ago(2) })] });
  await expect(CL().teacherHasLiveRound(TEACHER, { now: new Date() })).resolves.toBe(true);
  await expect(CL().teacherHasLiveRound(TEACHER, { now: new Date(Date.now() + 6 * DAY_MS) })).resolves.toBe(false);
});

test.each([
  ['the round is on a class they do not teach', { teaches: [TEACHES[0]] }],
  ['they no longer teach the class (is_active false)', { teaches: [TEACHES[0], { ...TEACHES[1], is_active: false }] }],
  ['they teach no class', { teaches: [] }],
])('%s: false, and nothing is minted', async (_, over) => {
  seed({ codes: [ROUND_CODE()], ...over });
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  expect(db.class_links).toHaveLength(1);
  expect(db.quiz_share_codes).toHaveLength(1);
  await expect(classTabShows()).resolves.toBe(false);
});

test.each([
  ['web_quiz_evening_round missing', INSIDE.filter((s) => s.key !== 'web_quiz_evening_round')],
  ['web_quiz_class_link off', INSIDE.filter((s) => s.key !== 'web_quiz_class_link')],
])('%s: false, and nothing is read beyond the switch', async (_, settings) => {
  seed({ settings, codes: [ROUND_CODE()] });
  const rec = recordTables();
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  rec.done();
  expect(rec.tables.length).toBeGreaterThan(0);
  expect(rec.tables.filter((t) => t !== 'app_settings')).toEqual([]);
  // the switch is cached (30 s): the next call reads no table at all
  const warm = recordTables();
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  warm.done();
  expect(warm.tables).toEqual([]);
});

test('a teacher of 450 classes whose round is in the FIRST chunk: the reads stop there (class_teachers 1 + quiz_share_codes 1)', async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `c1a55000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  seed({
    links: [],
    teaches: ids.map((id, i) => ({ id: `ct-${i}`, class_id: id, teacher_user_id: TEACHER, is_active: true })),
    codes: [ROUND_CODE({ class_id: ids[0] })],
    quizzes: [{ ...ROUND_Q, meta: { ...ROUND_Q.meta, class_id: ids[0] } }],
    classes: ids.map((id) => ({ id, grade_code: 'grade_2', section: 'A' })),
  });
  await CL().teacherHasLiveRound(TEACHER);
  const rec = recordTables();
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true);
  rec.done();
  expect(rec.tables).toEqual(['class_teachers', 'quiz_share_codes']);
  await expect(classTabShows()).resolves.toBe(true);
});

test('a teacher of 450 classes whose one round is on the last class: true — every class is asked, in chunks under the request cap', async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `c1a55000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const last = ids[ids.length - 1];
  const plainQs = ids.map((id, i) => ({ id: `qp-${i}`, topic: 'Plain', subject: 'maths', meta: { source: 'lp_v8' } }));
  const plainCodes = ids.map((id, i) => ({ id: `scp-${i}`, code: `P${i}`, quiz_id: `qp-${i}`, class_id: id, created_at: ago(1) }));
  seed({
    links: [],
    teaches: ids.map((id, i) => ({ id: `ct-${i}`, class_id: id, teacher_user_id: TEACHER, is_active: true })),
    codes: [...plainCodes, ROUND_CODE({ class_id: last })],
    quizzes: [...plainQs, { ...ROUND_Q, meta: { ...ROUND_Q.meta, class_id: last } }],
    classes: ids.map((id) => ({ id, grade_code: 'grade_2', section: 'A' })),
  });
  await CL().teacherHasLiveRound(TEACHER); // warm the switch cache: the count below is the DB reads alone
  const rec = recordTables();
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true);
  rec.done();
  // class_teachers 1 + quiz_share_codes ceil(450 / 200) = 3, the quiz embedded; nothing else
  expect(rec.tables.filter((t) => t === 'class_teachers')).toHaveLength(1);
  expect(rec.tables.filter((t) => t === 'quiz_share_codes')).toHaveLength(3);
  expect(rec.tables).toHaveLength(4);
  expect(supabase.calls.filter((c) => c.overflow)).toEqual([]);
  await expect(classTabShows()).resolves.toBe(true);
});

test('the line and the section agree on the SAME rows: (forTeacherReport != null) === teacherHasLiveRound, in every case', async () => {
  const Round = require('../../shared/services/quiz/web-quiz-evening-round');
  const CASES = [
    ['a live link outside the canary, no round', { settings: OUTSIDE }],
    ['a live link inside the canary, no round in 7 days', { settings: INSIDE }],
    ['an evening round 2 days old', { codes: [ROUND_CODE()] }],
    ['the only evening round is 8 days old', { codes: [ROUND_CODE({ created_at: ago(8) })] }],
    ['an ordinary (not evening-round) quiz in the window', { codes: [PLAIN_CODE()] }],
    ['web_quiz_evening_round off', { settings: INSIDE.filter((s) => s.key !== 'web_quiz_evening_round'), codes: [ROUND_CODE()] }],
    ['an evening round, the link since revoked, the class now outside the canary', { settings: OUTSIDE, links: [{ ...LIVE, revoked_at: ago(1) }], codes: [ROUND_CODE()] }],
    ['an evening round for a class NOT in the canary (written before it was taken out), link still live', { settings: OUTSIDE, codes: [ROUND_CODE()] }],
    ['the round\'s quiz row is gone', { codes: [ROUND_CODE()], quizzes: [PLAIN_Q] }],
    ['a plain quiz and an evening round in the window', { codes: [PLAIN_CODE(), ROUND_CODE()] }],
    ['they teach no class', { teaches: [], codes: [ROUND_CODE()] }],
  ];
  const now = new Date();
  const rows = [];
  for (const [name, over] of CASES) {
    seed(over);
    // eslint-disable-next-line no-await-in-loop
    const section = (await Round.forTeacherReport(TEACHER, { now })) != null;
    seed(over); // fresh switch caches, same rows
    // eslint-disable-next-line no-await-in-loop
    const line = await CL().teacherHasLiveRound(TEACHER, { now });
    rows.push({ name, section, line });
  }
  expect(rows.filter((r) => r.line !== r.section)).toEqual([]);
  expect(rows.map((r) => r.line)).toEqual([false, false, true, false, false, false, true, true, false, true, false]);
});

test('no teacher id, a read error on either table, a throwing client: false, never throws', async () => {
  seed({ codes: [ROUND_CODE()] });
  await expect(CL().teacherHasLiveRound(null)).resolves.toBe(false);
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true); // the seed is a true case; it also warms the switch cache
  const real = supabase.from;
  const errored = { select: () => errored, eq: () => errored, in: () => errored, is: () => errored, gt: () => errored, gte: () => errored, not: () => errored, limit: () => errored,
    then: (ok) => ok({ data: null, error: { message: 'timeout' } }) };
  for (const bad of ['class_teachers', 'quiz_share_codes']) {
    supabase.from = (t) => (t === bad ? errored : real(t));
    // eslint-disable-next-line no-await-in-loop
    await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
    supabase.from = (t) => { if (t === bad) throw new Error('down'); return real(t); };
    // eslint-disable-next-line no-await-in-loop
    await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  }
  supabase.from = real;
});

describe('a read that fails inside teacherHasLiveRound: false, logged ONCE, never thrown to the caller', () => {
  const Logger = require('../../shared/utils/logger');
  const MSG = '⚠️ class link: teacher live round check unavailable';
  const logs = () => Logger.logToFile.mock.calls.filter((c) => c[0] === MSG);
  const TABLES = ['class_teachers', 'quiz_share_codes'];
  async function warmTrueCase() {
    seed({ codes: [ROUND_CODE()] });
    await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true); // the rows are a true case; the switch is now cached
    Logger.logToFile.mockClear();
  }

  test.each(TABLES)('the %s read THROWS', async (bad) => {
    await warmTrueCase();
    const real = supabase.from;
    supabase.from = (t) => { if (t === bad) throw new Error('socket hang up'); return real(t); };
    try {
      await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
    } finally { supabase.from = real; }
    expect(logs()).toHaveLength(1);
    expect(logs()[0][1]).toEqual({ error: expect.stringContaining('socket hang up') });
  });

  test.each(TABLES)('the %s read returns an error', async (bad) => {
    await warmTrueCase();
    const real = supabase.from;
    const errored = { select: () => errored, eq: () => errored, in: () => errored, is: () => errored, gt: () => errored, gte: () => errored, not: () => errored, limit: () => errored,
      then: (ok) => ok({ data: null, error: { message: 'canceling statement due to statement timeout' } }) };
    supabase.from = (t) => (t === bad ? errored : real(t));
    try {
      await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
    } finally { supabase.from = real; }
    expect(logs()).toHaveLength(1);
    expect(logs()[0][1]).toEqual({ error: expect.stringContaining('statement timeout') });
  });
});
