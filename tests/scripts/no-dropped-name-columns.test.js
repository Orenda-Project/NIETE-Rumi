/**
 * bd-o1j8g.11 — V1.4.4 dropped users.first_name and users.last_name (users.name is the one name column).
 * These scripts still named them, so on staging and prod they failed with 42703 the moment they ran.
 * This pins that none of them reads or writes either column again.
 */
const fs = require('fs');
const path = require('path');

const SCRIPTS = [
  'scripts/backfill-training-certificates.py',
  'scripts/migrate-users.py',
  'scripts/verify-users-migration.py',
];

describe('scripts do not name the dropped users name columns', () => {
  it.each(SCRIPTS)('%s names neither first_name nor last_name', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
    const hits = src.split('\n')
      .map((line, i) => `${i + 1}: ${line.trim()}`)
      .filter((l) => /\b(first_name|last_name)\b/.test(l));
    expect(hits).toEqual([]);
  });
});

// V1.4.5 dropped users.levels and users.grade too; grades_taught carries the same grade list.
describe('migrate-users.py writes no column V1.4.5 dropped', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts/migrate-users.py'), 'utf8');
  const upsert = src.slice(src.indexOf('UPSERT_SQL = """'), src.indexOf('"""', src.indexOf('UPSERT_SQL = """') + 16));
  const cols = src.match(/cols = \[("phone_number"[^\]]*)\]/)[1];

  it.each(['levels', 'grade'])('the users upsert names no %s column', (col) => {
    const re = new RegExp(`(^|[\\s,(.])${col}\\b(?!_)`);
    expect(re.test(upsert)).toBe(false);
    expect(cols.includes(`"${col}"`)).toBe(false);
  });
});
