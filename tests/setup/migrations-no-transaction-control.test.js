/**
 * No migration from V1.8.0 onward carries a top-level BEGIN; / COMMIT;.
 *
 * infrastructure/scripts/migrate.js applies a file by sending its whole body to the
 * `exec_sql` RPC, a plpgsql `EXECUTE`. Postgres refuses transaction control there
 * (`0A000 EXECUTE of transaction commands is not implemented`), so a file that wraps
 * itself in BEGIN/COMMIT cannot be applied by the house runner on any tier. The single
 * RPC call is already one transaction, so the wrapper buys nothing. V1.8.0 shipped with
 * one and passed a psql-only gate; the runner then refused it on sandbox.
 *
 * Files before V1.8.0 are out of scope: several carry the wrapper because they were
 * applied by hand, and rewriting history the ledger already records would only change
 * their checksums.
 *
 * "Top level" means outside comments and dollar-quoted bodies: a plpgsql block's own
 * BEGIN ... END; is not transaction control.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', 'migrations');
// Keep this floor. The 29 older files below carry a top-level BEGIN;/COMMIT; (found by this matcher, and by
// `grep -liE '^\s*(BEGIN|COMMIT)\s*;' infrastructure/supabase/migrations/*.sql`, at a60baa7d77). They are
// hand-applied history: the ledger records them with their SHA-256, so "fixing" one changes a recorded checksum
// and proves nothing. Do NOT edit them and do NOT lower the floor to cover them (red-2 idea 220823 (b)).
//   V1.0.8__coaching_framework_provenance.sql           V1.0.9__leader_allocations.sql
//   V1.0.10__observation_schedules.sql                  V1.1.0__supervisor_remarks.sql
//   V1.1.1__conversation_state.sql                      V1.1.2__one_certificate_per_user_level.sql
//   V1.1.6__coach_directory.sql                         V1.1.7__observation_schedules_calendar_event_id.sql
//   V1.2.2__teacher_roster_admin.sql                    V1.2.3__leader_roster_audit.sql
//   V1.4.3__backfill_name_from_split_columns.sql        V1.4.4__drop_first_last_name_columns.sql
//   V1.4.6__soft_delete_convention.sql                  V1.4.7__roster_audit_edit_actions.sql (BEGIN only)
//   V1.4.8__record_history_watches_teacher_level.sql    V1.4.9__phone_number_fits_merge_tombstone.sql
//   V1.5.6__assessment_paper_versions.sql               V1.6.12__v10_weekly_usage_report.sql
//   ROLLBACK_V1.4.4__drop_first_last_name_columns.sql   ROLLBACK_V1.5.6__assessment_paper_versions.sql
//   ROLLBACK_V1.5.8__niete_lp_ab_assignment.sql         ROLLBACK_V1.6.5__niete_coaching_ab_assignment.sql
//   ROLLBACK_V1.6.6__niete_lp_assets_card_kind.sql      ROLLBACK_V1.6.7__coach_visit_requests.sql
//   ROLLBACK_V1.6.8__niete_lp_taken.sql                 ROLLBACK_V1.6.9__coach_visit_reasons.sql
//   ROLLBACK_V1.6.12__v10_weekly_usage_report.sql       ROLLBACK_V1.7.0__video_recommendations.sql
//   ROLLBACK_V1.7.1__video_reco_retrieval_route.sql
// A new migration is proven through the runner's own path with scripts/migration_gate.sh (SPEC v2.1 §11.4);
// this test is the early warning, the gate is the proof.
const FIRST_GUARDED = [1, 8, 0];

// Matched against ONE top-level statement (comments, strings and dollar-quoted bodies already blanked,
// whitespace collapsed), so `CREATE TABLE t (a int); COMMIT;` on one line is two statements and the second hits.
const TRANSACTION_CONTROL = /^(BEGIN(\s+(TRANSACTION|WORK))?|START\s+TRANSACTION|COMMIT(\s+(TRANSACTION|WORK))?|END(\s+(TRANSACTION|WORK))?|ROLLBACK(\s+(TRANSACTION|WORK))?)\s*;?$/i;

function versionOf(filename) {
  const m = filename.match(/^(?:ROLLBACK_)?V(\d+)\.(\d+)\.(\d+)__.*\.sql$/);
  return m ? m.slice(1, 4).map(Number) : null;
}

function atOrAfter(v, floor) {
  for (let i = 0; i < 3; i++) {
    if (v[i] !== floor[i]) return v[i] > floor[i];
  }
  return true;
}

// One left-to-right scan, the way Postgres's lexer reads the file: whichever opener comes first wins, so a `$$`
// inside a `--` comment stays a comment, and a `--` inside a string or a dollar-quoted body stays text. Blanks
// line comments, (nested) block comments, '...' / E'...' strings, "..." identifiers and $tag$...$tag$ bodies,
// keeping every newline so line numbers survive. red-2 220822: the old regex chain blanked dollar-quotes before
// comments, so `-- costs $$` opened a false quote that hid a real `BEGIN;` below it.
function topLevel(sql) {
  const out = [];
  const keep = (ch) => out.push(ch);
  const blank = (ch) => out.push(ch === '\n' ? '\n' : ' ');
  const identChar = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') blank(sql[i++]);
    } else if (ch === '/' && next === '*') {
      let depth = 0;
      do {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; blank(sql[i++]); blank(sql[i++]); }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; blank(sql[i++]); blank(sql[i++]); }
        else blank(sql[i++]);
      } while (i < sql.length && depth > 0);
    } else if (ch === "'") {
      const escapes = /[Ee]/.test(sql[i - 1] || '') && !identChar(sql[i - 2]);
      blank(sql[i++]);
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') { blank(sql[i++]); if (i < sql.length) blank(sql[i++]); continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { blank(sql[i++]); blank(sql[i++]); continue; }
        if (sql[i] === "'") { blank(sql[i++]); break; }
        blank(sql[i++]);
      }
    } else if (ch === '"') {
      blank(sql[i++]);
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { blank(sql[i++]); blank(sql[i++]); continue; }
        if (sql[i] === '"') { blank(sql[i++]); break; }
        blank(sql[i++]);
      }
    } else if (ch === '$' && !identChar(sql[i - 1])) {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (!m) { keep(sql[i++]); continue; }
      const tag = m[0];
      const close = sql.indexOf(tag, i + tag.length);
      const end = close === -1 ? sql.length : close + tag.length;
      while (i < end) blank(sql[i++]);
    } else {
      keep(sql[i++]);
    }
  }
  return out.join('');
}

// Split the top-level text on `;` into statements; each hit reports the line its first keyword sits on.
function transactionControlLines(sql) {
  const text = topLevel(sql);
  const hits = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== ';') continue;
    const stmt = text.slice(start, i + (i < text.length ? 1 : 0));
    const body = stmt.replace(/\s+/g, ' ').trim();
    if (body && TRANSACTION_CONTROL.test(body)) {
      const lead = stmt.length - stmt.trimStart().length;
      const line = text.slice(0, start + lead).split('\n').length;
      hits.push({ line, text: body });
    }
    start = i + 1;
  }
  return hits;
}

const guarded = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => {
    const v = versionOf(f);
    return v && atOrAfter(v, FIRST_GUARDED);
  })
  .sort();

describe('migrations apply through exec_sql: no top-level transaction control (V1.8.0 onward)', () => {
  test('the guard sees the V1.8.0 pair', () => {
    expect(guarded).toEqual(
      expect.arrayContaining(['V1.8.0__coachip_insights.sql', 'ROLLBACK_V1.8.0__coachip_insights.sql'])
    );
  });

  test('the matcher ignores plpgsql blocks and comments, and catches a bare BEGIN;', () => {
    const sql = [
      '-- BEGIN;',
      'DO $$ BEGIN',
      '  PERFORM 1;',
      'END $$;',
      'CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN RETURN; END; $fn$;',
      'BEGIN;',
      'commit;',
    ].join('\n');
    expect(transactionControlLines(sql).map((h) => h.line)).toEqual([6, 7]);
  });

  // red-2 220822 blind spot (1): a COMMIT after another statement on the same line.
  test('the matcher catches transaction control that follows another statement on the same line', () => {
    const sql = ['CREATE TABLE t (a int); COMMIT;', 'SELECT 1;   begin work ;'].join('\n');
    expect(transactionControlLines(sql).map((h) => h.line)).toEqual([1, 2]);
  });

  // red-2 220822 blind spot (2): a $$ inside a comment is not a dollar-quote.
  test('a $$ inside a comment does not hide a real BEGIN; on a later line', () => {
    const sql = [
      '-- costs $$ to run',
      'BEGIN;',
      '/* a $tag$ in a block comment */',
      'SELECT 1;',
      'COMMIT;',
      '-- closing $$ here',
      '-- $tag$',
    ].join('\n');
    expect(transactionControlLines(sql).map((h) => h.line)).toEqual([2, 5]);
  });

  test('comment markers inside strings and dollar-quoted bodies are not comments', () => {
    const sql = [
      "SELECT '-- not a comment'; BEGIN;",
      "SELECT 'it''s /* not */ a comment', $q$ -- inside $q$; COMMIT;",
      'DO $$ BEGIN RAISE NOTICE \'-- $x$ \'; END $$;',
      'commit;',
    ].join('\n');
    expect(transactionControlLines(sql).map((h) => h.line)).toEqual([1, 2, 4]);
  });

  test.each(guarded)('%s has no top-level BEGIN/COMMIT', (file) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf-8');
    expect(transactionControlLines(sql).map((h) => `${file}:${h.line} ${h.text}`)).toEqual([]);
  });
});
