/**
 * Migration transaction control is listed.
 *
 * A tool that applies several migrations as one unit runs them in its own transaction, so a file's own top-level
 * `BEGIN;` / `COMMIT;` must be stripped first (a nested COMMIT would end the tool's transaction half-way). The files
 * that carry them are listed in migration-transaction-control.allowlist.json; they need not change. A new migration
 * leaves transaction control to the tool. Shrink-only, warn-on-less: a file not on the list fails; a listed file that
 * no longer carries them, or is not in this tree, prints a CLEAN:/GONE: warning and passes.
 *
 * Top level means outside comments, string literals and dollar-quoted bodies: a plpgsql `BEGIN … END` is not it.
 */
const fs = require('fs');
const path = require('path');
const L = require('./challenge-data-gates-lib');
const { listVerdict, report } = require('./ratchet-verdict-lib');
const ALLOW = require('./migration-transaction-control.allowlist.json');

const verdict = (found, allowed, present) => listVerdict(found, allowed, {
  what: 'carries top-level transaction control (BEGIN; / COMMIT;): leave it to the tool that applies migrations',
  list: 'migration-transaction-control.allowlist.json',
  gone: (f) => !present.has(f),
});

describe('the rule, on in-memory SQL', () => {
  test('top-level BEGIN; / COMMIT; in any case and their synonyms are found', () => {
    expect(L.transactionControl('-- header\nBEGIN;\nALTER TABLE t ADD COLUMN a int;\nCOMMIT;\n')).toEqual(['BEGIN', 'COMMIT']);
    expect(L.transactionControl('begin;\nselect 1;\ncommit;')).toEqual(['BEGIN', 'COMMIT']);
    expect(L.transactionControl('START TRANSACTION;\nselect 1;\nEND;')).toEqual(['BEGIN', 'COMMIT']);
  });

  test('a function body, a DO block, a comment and a string are not top level', () => {
    const sql = [
      "-- run inside BEGIN; ... COMMIT; on the tool",
      "/* BEGIN; */",
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END; $$;",
      "DO $body$ BEGIN IF true THEN RAISE NOTICE 'x'; END IF; END $body$;",
      "COMMENT ON TABLE t IS 'BEGIN; it''s fine; COMMIT;';",
    ].join('\n');
    expect(L.transactionControl(sql)).toEqual([]);
  });
});

describe('the verdict, on a seeded folder and allowlist', () => {
  test('a new file with transaction control fails; a cleaned or absent listed file warns and passes', () => {
    const v = verdict(['kept.sql', 'new.sql'], ['kept.sql', 'cleaned.sql', 'gone.sql'], new Set(['kept.sql', 'new.sql', 'cleaned.sql']));
    expect(v.failures).toEqual(['NEW: new.sql carries top-level transaction control (BEGIN; / COMMIT;): leave it to the tool that applies migrations.']);
    expect(v.warnings).toEqual([
      'CLEAN: cleaned.sql is fixed. Remove it from migration-transaction-control.allowlist.json.',
      'GONE: gone.sql names a file not in this tree. Remove it from migration-transaction-control.allowlist.json.',
    ]);
  });
});

describe('this tree', () => {
  test('no migration outside the list carries top-level transaction control', () => {
    const files = fs.readdirSync(L.MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    const found = files.filter((f) => L.transactionControl(fs.readFileSync(path.join(L.MIGRATIONS, f), 'utf8')).length);
    expect(found.length).toBeGreaterThan(0);
    expect(report(verdict(found, ALLOW.files, new Set(files)))).toEqual([]);
  });
});
