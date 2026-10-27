/**
 * The lesson-plan lifecycle vocabularies live in ONE place in code — the exported
 * Lifecycle.LIFECYCLE — and are enforced in the database by the CHECK constraints of
 * migration V1.6.4 (mirrored in the fresh-install reference schema).
 *
 * WHY PIN THEM TOGETHER. A value the code writes that the CHECK does not list makes the insert fail
 * (the lifecycle writer is soft-fail, so the lesson still goes out — but the record of it is lost,
 * silently, for every delivery on that path). A value the CHECK lists that the code never writes is
 * harmless but rots. Either drift is invisible until an analyst finds a hole, so this test makes the
 * three lists — code, migration, reference schema — one list.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no DB in this test'); } }));

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/migrations/V1.6.4__lp_lifecycle.sql'), 'utf8');
const REFERENCE = fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8');
// V1.6.14 adds the error_code CHECK. Read without throwing, so a missing file fails ITS test, not the suite.
const readIf = (rel) => { const f = path.join(ROOT, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
const HARDENING = readIf('infrastructure/supabase/migrations/V1.6.14__lp_lifecycle_hardening.sql');

const Lifecycle = require('../../bot/shared/services/lesson-plan-lifecycle.service');

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
  const { LIFECYCLE } = Lifecycle;

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
    ['the reference schema', 'lesson_plan_requests_source_check', REFERENCE],
  ])('source: %s (%s) lists exactly the paths the writer knows', (_label, name, sql) => {
    expect(checkValues(sql, name)).toEqual(sorted(Object.values(LIFECYCLE.SOURCES)));
  });

  test.each([
    ['the migration', MIGRATION],
    ['the reference schema', REFERENCE],
  ])('channel: %s lists exactly the channels the writer knows', (_label, sql) => {
    expect(checkValues(sql, 'lesson_plan_requests_channel_check')).toEqual(sorted(Object.values(LIFECYCLE.CHANNELS)));
  });

  test.each([
    ['the migration (V1.6.14)', HARDENING],
    ['the reference schema', REFERENCE],
  ])('error_code: %s lists exactly the codes the writer can write — and only those', (_label, sql) => {
    expect(checkValues(sql, 'lesson_plan_requests_error_code_check')).toEqual(sorted(Object.values(LIFECYCLE.ERROR_CODES)));
  });

  test('the free-form track is not a source: it rides in textbook_metadata.fflp_track (F50), so no CHECK lists it', () => {
    expect(Object.values(LIFECYCLE.SOURCES)).not.toContain('freeform_v1');
    expect(checkValues(REFERENCE, 'lesson_plan_requests_source_check')).not.toContain('freeform_v1');
  });

  test('the plan table gets no source CHECK — its source column is not the lifecycle writer\'s (a dev seed writes its own value there)', () => {
    expect(MIGRATION).not.toMatch(/lesson_plans_source_check/);
    expect(REFERENCE).not.toMatch(/lesson_plans_source_check/);
  });

  test('every NIETE path that hands a teacher a lesson plan has a source the database accepts', () => {
    // A path with no source cannot record its asks at all. The two found after the first cut: the
    // Oxbridge catalogue lane (typed-topic picker + Flow) and the portal's "Send on WhatsApp".
    expect(Object.values(LIFECYCLE.SOURCES)).toEqual(expect.arrayContaining([
      'niete_grounded', 'pre_gen_chapter', 'niete_v8_segment', 'niete_lp612', 'homework_bundle',
      'niete_oxbridge', 'niete_portal_share',
    ]));
  });

  test('error codes are short machine words, never free text', () => {
    for (const code of Object.values(LIFECYCLE.ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]{2,40}$/);
    }
  });
});

describe('every error code the bot writes is one the vocabulary knows', () => {
  test('each errorCode / lifecycleCode literal in the bot source is one of the six codes', () => {
    const root = path.join(ROOT, 'bot');
    const known = new Set(Object.values(Lifecycle.LIFECYCLE.ERROR_CODES));
    const offenders = [];
    let seen = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) {
          const src = fs.readFileSync(p, 'utf8');
          for (const m of src.matchAll(/\b(?:errorCode|lifecycleCode)\s*[:=]\s*['"]([A-Z_]+)['"]/g)) {
            seen += 1;
            if (!known.has(m[1])) offenders.push(`${path.relative(root, p)}: ${m[1]}`);
          }
        }
      }
    };
    walk(root);
    // Positive control: the scan really reads the call sites (a regex that matched nothing would pass in silence).
    expect(seen).toBeGreaterThanOrEqual(8);
    expect(offenders).toEqual([]);
  });
});

describe('the rollback can be undone', () => {
  test('the rollback removes its own schema_versions row, so the runner applies V1.6.4 again after a rollback', () => {
    const rollback = fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/migrations/ROLLBACK_V1.6.4__lp_lifecycle.sql'), 'utf8');
    expect(rollback).toMatch(/DELETE FROM schema_versions WHERE version = '1\.6\.4'/);
  });
});
