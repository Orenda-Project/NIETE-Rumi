/**
 * The seeded sessions and the legacy academic-year function must not disagree.
 *
 * There are now two things in this deployment that can answer "which academic
 * year is it?" — `getCurrentAcademicYear()` in the attendance setup endpoint, and
 * the `academic_sessions` table's date spans. While the legacy roster mirror
 * writes `academic_year = sessionCode`, a disagreement is not cosmetic: the
 * mirror would be filed under a different year than the class, the unique index
 * on (user_id, LOWER(class_name), academic_year) would stop matching, and the
 * adoption path would insert duplicates instead of adopting.
 *
 * The trap this test exists for is REAL and was hit while writing this: the seed
 * was first written with April–March spans, copied from the other deployment.
 * This deployment rolls in AUGUST (`getMonth() >= 7`). Nothing would have caught
 * that until a class created in, say, May was filed a year off.
 */

const fs = require('fs');
const path = require('path');

// The endpoint pulls in the Supabase client, which is a bot/ dependency — and CI
// runs the root suite BEFORE `bot/ npm ci`. Mock it virtually or this suite cannot
// even load. Nothing here touches the database.
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { getCurrentAcademicYear } = require('../../bot/shared/routes/attendance-setup-endpoint');

const SEED = fs.readFileSync(
  path.join(__dirname, '../../infrastructure/supabase/02_seed-data.sql'),
  'utf8',
);

/** Parse the seeded (code, kind, starts_on, ends_on) tuples out of the SQL. */
function seededSessions() {
  const start = SEED.indexOf('INSERT INTO academic_sessions (');
  expect(start).toBeGreaterThan(-1);
  const block = SEED.slice(start, SEED.indexOf('ON CONFLICT', start));
  return [...block.matchAll(
    /\('([\d-]+)',\s*'(\w+)',\s*DATE '([\d-]+)',\s*DATE '([\d-]+)'\)/g,
  )].map((m) => ({ code: m[1], kind: m[2], starts_on: m[3], ends_on: m[4] }));
}

const SESSIONS = seededSessions();

/** The date-range predicate the model uses instead of an `is_current` flag. */
function sessionContaining(isoDate) {
  return SESSIONS.filter((s) => s.starts_on <= isoDate && isoDate <= s.ends_on);
}

describe('the seed is well formed', () => {
  it('seeds three sessions', () => {
    expect(SESSIONS).toHaveLength(3);
  });

  it('every span is non-empty and ordered', () => {
    for (const s of SESSIONS) expect(s.starts_on < s.ends_on).toBe(true);
  });

  it('spans do not overlap, so one date resolves to one annual session', () => {
    const sorted = [...SESSIONS].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1].ends_on < sorted[i].starts_on).toBe(true);
    }
  });

  it('is contiguous — no gap a class could fall into', () => {
    const sorted = [...SESSIONS].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    for (let i = 1; i < sorted.length; i += 1) {
      const prevEnd = new Date(`${sorted[i - 1].ends_on}T00:00:00Z`);
      const nextStart = new Date(`${sorted[i].starts_on}T00:00:00Z`);
      const gapDays = (nextStart - prevEnd) / 86400000;
      expect(gapDays).toBe(1);
    }
  });
});

describe('the spans follow THIS deployment\'s August rollover', () => {
  it.each(SESSIONS.map((s) => [s.code, s]))('%s runs August to July', (_code, s) => {
    expect(s.starts_on.slice(5)).toBe('08-01');
    expect(s.ends_on.slice(5)).toBe('07-31');
  });

  it('is NOT the other deployment\'s April–March rule', () => {
    // Stated as its own assertion because this is the mistake that was actually
    // made: the seed was copied from a deployment whose year rolls in April.
    for (const s of SESSIONS) expect(s.starts_on.slice(5)).not.toBe('04-01');
  });
});

describe('the table and getCurrentAcademicYear() agree', () => {
  it('agrees on today', () => {
    const hits = sessionContaining(new Date().toISOString().slice(0, 10));
    expect(hits).toHaveLength(1);
    expect(hits[0].code).toBe(getCurrentAcademicYear());
  });

  afterEach(() => jest.useRealTimers());

  it.each([
    // Sampled across the rollover boundary in both directions.
    ['2026-08-01', '2026-2027'],
    ['2026-08-14', '2026-2027'],
    ['2026-12-31', '2026-2027'],
    ['2027-01-15', '2026-2027'],
    ['2027-07-31', '2026-2027'],
    ['2026-07-31', '2025-2026'],
    ['2026-04-01', '2025-2026'],   // April is mid-year here, not a new year
    ['2027-08-01', '2027-2028'],
  ])('agrees on %s', (isoDate, expected) => {
    // The table's answer, by date predicate.
    expect(sessionContaining(isoDate).map((h) => h.code)).toEqual([expected]);

    // The legacy function's answer, evaluated at that same date. Noon UTC so the
    // assertion cannot flip on the runner's timezone.
    jest.useFakeTimers().setSystemTime(new Date(`${isoDate}T12:00:00Z`));
    expect(getCurrentAcademicYear()).toBe(expected);
  });
});
