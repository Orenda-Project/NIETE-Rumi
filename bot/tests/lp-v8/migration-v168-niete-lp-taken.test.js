/**
 * bd-2wgr3d.22.2 — V1.6.8 niete_lp_taken shape guard (TDD, red first).
 *
 * The one definition of "this teacher took this lesson plan" (operator, 14 Oct 2026): every route
 * counts — sent on WhatsApp, opened in the app's viewer, or handed from the app to another app —
 * for grades 1-5 and 6-12 alike. The bot, the portal and the RDF all read this view instead of
 * each joining the ledgers its own way. No Postgres here, so these are static guards on the SQL;
 * the live check (a local Postgres loaded with supabase/baseline/schema.sql) is in the PR.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'infrastructure', 'supabase', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const statements = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--'))
  .join('\n').split(';').map((s) => s.trim()).filter(Boolean);

describe('V1.6.8 niete_lp_taken', () => {
  const sql = read('V1.6.8__niete_lp_taken.sql');
  const st = statements(sql);
  const view = st.find((s) => /^CREATE OR REPLACE VIEW public\.niete_lp_taken\b/i.test(s)) || '';
  const arms = view.split(/\bUNION ALL\b/i);

  test('header says what a row is, why a view (Rule 15), the apply order and the rollback', () => {
    expect(sql).toMatch(/WHAT A ROW IS/);
    expect(sql).toMatch(/WHY A VIEW/);
    expect(sql).toMatch(/ORDER/);
    expect(sql).toMatch(/Rollback: ROLLBACK_V1\.6\.8__niete_lp_taken\.sql/);
  });

  test('one view, run with the caller\'s rights (RLS is not bypassed through it)', () => {
    expect(view).toMatch(/WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
  });

  test('additive and re-runnable: it creates or replaces the view and touches no table', () => {
    expect(st.filter((s) => /^(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b|^ALTER TABLE|DROP COLUMN/i.test(s))).toEqual([]);
    expect(st.filter((s) => /^CREATE VIEW/i.test(s))).toEqual([]);
  });

  test('three arms: WhatsApp grades 1-5, WhatsApp grades 6-12, and every app open', () => {
    expect(arms).toHaveLength(3);
    const [k5, g612, app] = arms;
    expect(k5).toMatch(/FROM\s+public\.niete_lp_downloads\b/i);
    expect(k5).toMatch(/status\s*=\s*'sent'/i);
    expect(k5).toMatch(/'k5'/);
    expect(k5).toMatch(/'whatsapp'/);
    expect(g612).toMatch(/FROM\s+public\.niete_lp612_deliveries\b/i);
    expect(g612).toMatch(/surface\s+IN\s*\(\s*'whatsapp'\s*,\s*'backfill'\s*\)/i);
    expect(g612).not.toMatch(/'portal'/);
    expect(app).toMatch(/FROM\s+public\.niete_lp_opens\b/i);
    expect(app).toMatch(/'app'/);
  });

  test('a hand-off to another app counts: no arm filters app opens by source', () => {
    const app = arms[2] || '';
    expect(app).not.toMatch(/\bWHERE\b[\s\S]*\bsource\b/i);
  });

  test('lesson_plans is not a source (its v8 rows duplicate the ledgers)', () => {
    expect(view).not.toMatch(/\blesson_plans\b/i);
    expect(sql).toMatch(/lesson_plans/); // ...and the header says why
  });

  test('every arm yields the same columns, in the same order', () => {
    const cols = ['user_id', 'plan_kind', 'plan_ref', 'lang', 'route', 'app_source', 'taken_at',
      'asset_id', 'version_stamp', 'content_hash', 'source_table', 'source_id'];
    for (const arm of arms) {
      const select = arm.slice(arm.search(/\bSELECT\b/i), arm.search(/\bFROM\b/i));
      const names = [...select.matchAll(/\bAS\s+(\w+)/gi)].map((m) => m[1]);
      expect(names).toEqual(cols);
    }
  });

  test('only the service role reads it, and PostgREST is told', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.niete_lp_taken FROM anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT SELECT ON public\.niete_lp_taken TO service_role/i);
    expect(sql).toMatch(/NOTIFY pgrst,\s*'reload schema'/i);
  });

  test('rollback drops only the view', () => {
    const rb = statements(read('ROLLBACK_V1.6.8__niete_lp_taken.sql'));
    expect(rb.filter((s) => !/^(BEGIN|COMMIT)$/i.test(s) && !/^NOTIFY pgrst/i.test(s)))
      .toEqual([expect.stringMatching(/^DROP VIEW IF EXISTS public\.niete_lp_taken$/i)]);
  });
});
