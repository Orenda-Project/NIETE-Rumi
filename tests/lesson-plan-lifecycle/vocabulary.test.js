/**
 * The lesson-plan lifecycle vocabularies live in ONE place in code — the exported
 * LessonPlanQueueService.LIFECYCLE — and are enforced in the database by the CHECK constraints of
 * migration V1.6.4 (mirrored in the fresh-install reference schema).
 *
 * WHY PIN THEM TOGETHER. A value the code writes that the CHECK does not list makes the insert fail
 * (the lifecycle writer is soft-fail, so the lesson still goes out — but the record of it is lost,
 * silently, for every delivery on that path). A value the CHECK lists that the code never writes is
 * harmless but rots. Either drift is invisible until an analyst finds a hole, so this test makes the
 * three lists — code, migration, reference schema — one list.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no DB in this test'); } }));
jest.mock('../../bot/shared/services/queue', () => ({ queueCoachingJob: jest.fn() }));

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/migrations/V1.6.4__lp_lifecycle.sql'), 'utf8');
const REFERENCE = fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8');

const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');

/** The quoted values of the first IN (...) list that follows `constraintName` in `sql`. */
function checkValues(sql, constraintName) {
  const at = sql.indexOf(constraintName);
  if (at < 0) throw new Error(`${constraintName} not found`);
  const open = sql.indexOf(' IN (', at);
  const close = sql.indexOf(')', open);
  return sql.slice(open + 5, close).match(/'([^']+)'/g).map((q) => q.slice(1, -1)).sort();
}

const sorted = (xs) => [...xs].sort();

describe('lesson-plan lifecycle vocabulary — code and database are one list', () => {
  const { LIFECYCLE } = LessonPlanQueueService;

  test('the writer exports its vocabularies', () => {
    expect(LIFECYCLE).toEqual(expect.objectContaining({
      STATUSES: expect.any(Array),
      SOURCES: expect.any(Object),
      CHANNELS: expect.any(Object),
      ERROR_CODES: expect.any(Object),
    }));
  });

  test.each([
    ['the migration', MIGRATION],
    ['the reference schema', REFERENCE],
  ])('status: %s lists exactly the statuses the writer can write', (_label, sql) => {
    expect(checkValues(sql, 'lesson_plan_requests_status_check')).toEqual(sorted(LIFECYCLE.STATUSES));
  });

  test.each([
    ['the migration', 'lesson_plan_requests_source_check', MIGRATION],
    ['the migration', 'lesson_plans_source_check', MIGRATION],
    ['the reference schema', 'lesson_plan_requests_source_check', REFERENCE],
    ['the reference schema', 'lesson_plans_source_check', REFERENCE],
  ])('source: %s (%s) lists exactly the paths the writer knows', (_label, name, sql) => {
    expect(checkValues(sql, name)).toEqual(sorted(Object.values(LIFECYCLE.SOURCES)));
  });

  test.each([
    ['the migration', MIGRATION],
    ['the reference schema', REFERENCE],
  ])('channel: %s lists exactly the channels the writer knows', (_label, sql) => {
    expect(checkValues(sql, 'lesson_plan_requests_channel_check')).toEqual(sorted(Object.values(LIFECYCLE.CHANNELS)));
  });

  test('error codes are short machine words, never free text', () => {
    for (const code of Object.values(LIFECYCLE.ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]{2,40}$/);
    }
  });
});
