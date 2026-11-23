'use strict';
/**
 * teacherHasLiveRound(teacherId) (the teacher report's "Evening rounds" foot line; required from
 * web-quiz-class-link.js like hasLiveStandingLink): true when a class the teacher actively teaches (class_teachers,
 * is_active) has a live standing link (not revoked, not expired) with the evening round on, i.e. hasLiveStandingLink is
 * true for one of their classes. It never writes (never mints a link): two small reads, none with a switch off. False on
 * anything else, never throws. Faked boundaries: Supabase (in memory, filters applied), the loggers.
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
const ON = (k) => ({ key: k, value: true });
const ALL = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const LIVE = { code: 'K7Q2MXTRAB', class_id: CLASS_2, teacher_id: OTHER_T, term_code: '2026-27b', expires_at: '2099-03-31T18:59:59Z', revoked_at: null };
const TEACHES = [
  { id: 'ct1', class_id: CLASS, teacher_user_id: TEACHER, is_active: true },
  { id: 'ct2', class_id: CLASS_2, teacher_user_id: TEACHER, is_active: true },
];

let db;
function seed({ settings = ALL, links = [LIVE], teaches = TEACHES } = {}) {
  db = { app_settings: settings, class_links: links, class_teachers: teaches };
  Object.assign(supabase, makeFake(db));
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
}
const CL = () => require('../../shared/services/quiz/web-quiz-class-link');
function recordTables() {
  const tables = [];
  const real = supabase.from;
  supabase.from = (t) => { tables.push(t); return real(t); };
  return { tables, done: () => { supabase.from = real; } };
}

test('exported from web-quiz-class-link.js', () => {
  expect(typeof CL().teacherHasLiveRound).toBe('function');
});

test('one of the teacher\'s classes has a live link (another teacher of that class minted it): true, two reads, no write', async () => {
  seed();
  const rec = recordTables();
  const before = JSON.stringify(db);
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(true);
  rec.done();
  expect(rec.tables.filter((t) => t === 'class_teachers')).toHaveLength(1);
  expect(rec.tables.filter((t) => t === 'class_links')).toHaveLength(1);
  expect(JSON.stringify(db)).toBe(before);
});

test.each([
  ['no class of theirs has a link (only another class does)', { teaches: [TEACHES[0]] }],
  ['their class\'s link is revoked', { links: [{ ...LIVE, revoked_at: '2026-11-20T00:00:00Z' }] }],
  ['their class\'s link has expired', { links: [{ ...LIVE, expires_at: '2026-03-31T18:59:59Z' }] }],
  ['they no longer teach the class (is_active false)', { teaches: [TEACHES[0], { ...TEACHES[1], is_active: false }] }],
  ['they teach no class', { teaches: [] }],
])('%s: false, and nothing is minted', async (_, over) => {
  seed(over);
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  expect(db.class_links.length).toBe((over.links || [LIVE]).length);
});

test.each([
  ['web_quiz_evening_round missing', ALL.filter((s) => s.key !== 'web_quiz_evening_round')],
  ['web_quiz_class_link off', ALL.filter((s) => s.key !== 'web_quiz_class_link')],
])('%s: false, and neither class_teachers nor class_links is read', async (_, settings) => {
  seed({ settings });
  const rec = recordTables();
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  rec.done();
  expect(rec.tables).not.toContain('class_teachers');
  expect(rec.tables).not.toContain('class_links');
});

test('no teacher id, a read error, a throwing client: false, never throws', async () => {
  seed();
  await expect(CL().teacherHasLiveRound(null)).resolves.toBe(false);
  await CL().teacherHasLiveRound(TEACHER); // warm the switch cache
  const real = supabase.from;
  const errored = { select: () => errored, eq: () => errored, in: () => errored, is: () => errored, gt: () => errored, limit: () => errored,
    then: (ok) => ok({ data: null, error: { message: 'timeout' } }) };
  supabase.from = (t) => (t === 'class_teachers' ? errored : real(t));
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  supabase.from = (t) => (t === 'class_links' ? errored : real(t));
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  supabase.from = (t) => { if (t === 'class_teachers') throw new Error('down'); return real(t); };
  await expect(CL().teacherHasLiveRound(TEACHER)).resolves.toBe(false);
  supabase.from = real;
});
