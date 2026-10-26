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
const FIRST_GUARDED = [1, 8, 0];

const TRANSACTION_CONTROL = /^\s*(BEGIN(\s+(TRANSACTION|WORK))?|START\s+TRANSACTION|COMMIT(\s+(TRANSACTION|WORK))?|END(\s+(TRANSACTION|WORK))?|ROLLBACK(\s+(TRANSACTION|WORK))?)\s*;/i;

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

// Blank out comments and dollar-quoted bodies, keeping newlines so line numbers survive.
function topLevel(sql) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return sql
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, blank);
}

function transactionControlLines(sql) {
  return topLevel(sql)
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter(({ text }) => TRANSACTION_CONTROL.test(text));
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

  test.each(guarded)('%s has no top-level BEGIN/COMMIT', (file) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf-8');
    expect(transactionControlLines(sql).map((h) => `${file}:${h.line} ${h.text}`)).toEqual([]);
  });
});
