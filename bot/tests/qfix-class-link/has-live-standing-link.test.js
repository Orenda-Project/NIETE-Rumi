'use strict';
/**
 * hasLiveStandingLink(classId) (lead A75, for the offers lane; required from web-quiz-class-link.js like
 * roundsReadyForPhone): true only when web_quiz_class_link (with its parents) AND web_quiz_evening_round are on and the
 * class has a live class_links row (not revoked, not expired). False on anything else, never throws, one class_links
 * read. Faked boundaries: Supabase (in memory, filters applied), the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');

const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const OTHER = 'c1a55000-0000-4000-8000-0000000000e2';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ON = (k) => ({ key: k, value: true });
const ALL = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const LIVE = { code: 'K7Q2MXTRAB', class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2099-03-31T18:59:59Z', revoked_at: null };

function seed({ settings = ALL, links = [LIVE] } = {}) {
  Object.assign(supabase, makeFake({ app_settings: settings, class_links: links }));
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
}
const CL = () => require('../../shared/services/quiz/web-quiz-class-link');

test('exported from web-quiz-class-link.js', () => {
  expect(typeof CL().hasLiveStandingLink).toBe('function');
});

test('both switches on and a live link for the class: true, with ONE class_links read', async () => {
  seed();
  const tables = [];
  const real = supabase.from;
  supabase.from = (t) => { tables.push(t); return real(t); };
  await expect(CL().hasLiveStandingLink(CLASS)).resolves.toBe(true);
  supabase.from = real;
  expect(tables.filter((t) => t === 'class_links')).toHaveLength(1);
});

test.each([
  ['revoked', [{ ...LIVE, revoked_at: '2026-11-20T00:00:00Z' }]],
  ['expired', [{ ...LIVE, expires_at: '2026-03-31T18:59:59Z' }]],
  ['another class\'s link only', [{ ...LIVE, class_id: OTHER }]],
  ['no link', []],
])('%s: false', async (_, links) => {
  seed({ links });
  await expect(CL().hasLiveStandingLink(CLASS)).resolves.toBe(false);
});

test.each([
  ['web_quiz_evening_round missing', ALL.filter((s) => s.key !== 'web_quiz_evening_round')],
  ['web_quiz_evening_round false', [...ALL.filter((s) => s.key !== 'web_quiz_evening_round'), { key: 'web_quiz_evening_round', value: false }]],
  ['web_quiz_class_link off', ALL.filter((s) => s.key !== 'web_quiz_class_link')],
  ['a class-link parent off', ALL.filter((s) => s.key !== 'web_quiz_challenge_v2')],
])('%s: false, and no class_links read', async (_, settings) => {
  seed({ settings });
  const tables = [];
  const real = supabase.from;
  supabase.from = (t) => { tables.push(t); return real(t); };
  await expect(CL().hasLiveStandingLink(CLASS)).resolves.toBe(false);
  supabase.from = real;
  expect(tables).not.toContain('class_links');
});

test('no class id, a failed read, a throwing client: false, never throws', async () => {
  seed();
  await expect(CL().hasLiveStandingLink(null)).resolves.toBe(false);
  await CL().hasLiveStandingLink(CLASS); // warm the switch cache
  const real = supabase.from;
  supabase.from = (t) => (t === 'class_links' ? { select: () => { throw new Error('boom'); } } : real(t));
  await expect(CL().hasLiveStandingLink(CLASS)).resolves.toBe(false);
  supabase.from = (t) => { if (t === 'class_links') throw new Error('down'); return real(t); };
  await expect(CL().hasLiveStandingLink(CLASS)).resolves.toBe(false);
  supabase.from = real;
});
