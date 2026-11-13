/**
 * The mock lane's database has what the migrations since its dump added (bd-4hyyp2).
 *
 * The lane builds its local database from supabase/baseline/schema.sql (a sandbox dump) + the seed snapshot +
 * seed-overrides.sql. It runs NO migrations. So a column a migration adds after the dump is missing on the lane, and
 * PostgREST answers any select naming it with 42703.
 *
 * That is what broke lesson-plan/L03 from 5 Nov: V1.8.6__book_curriculum.sql added niete_lp612_segments.curriculum,
 * lp612-catalog.service.js started filtering on it, the baseline never got it, and the Grade 6 picker on the lane
 * returned ENDPOINT_ERROR ("column niete_lp612_segments.curriculum does not exist") on every commit for four days.
 *
 * Pinned here, statically (no database, so CI runs it): for every migration from FLOOR on, each
 * `ALTER TABLE … ADD COLUMN` names a column the baseline's CREATE TABLE has, and each `CREATE TABLE` names a table the
 * baseline creates — and schema.objects.txt (what `local-db.sh drift` compares) lists those columns too.
 *
 * FLOOR is the first migration after the 14 Oct dump that the baseline had not caught up with when this test landed.
 * Older drift (V1.6.x–V1.8.4 tables the sandbox dump predates or never had) is a full re-dump's job, not this one's.
 * A NEW migration that adds a column or table fails here until supabase/baseline/ carries it: replay it onto a
 * database built from the baseline and re-dump (see the bd-4hyyp2 commit), or run `local-db.sh baseline`.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const MIGRATIONS = 'infrastructure/supabase/migrations';
const FLOOR = [1, 8, 6];

function version(file) {
  const m = /^V(\d+)\.(\d+)\.(\d+)__/.exec(file);
  return m ? m.slice(1).map(Number) : null;
}
const atLeast = (v, floor) => {
  for (let i = 0; i < floor.length; i++) if (v[i] !== floor[i]) return v[i] > floor[i];
  return true;
};

/** table -> Set(columns), from the baseline dump's CREATE TABLE blocks. */
function baselineTables() {
  const out = {};
  const re = /CREATE TABLE public\.(\w+) \(\n([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(read('supabase/baseline/schema.sql'))) !== null) {
    out[m[1]] = new Set(m[2].split('\n').map((l) => (/^\s+(\w+) /.exec(l) || [])[1]).filter((c) => c && c !== 'CONSTRAINT'));
  }
  return out;
}

/** [{ file, table, column? }] every forward migration from FLOOR on adds. */
function migrationAdds() {
  const adds = [];
  const files = fs.readdirSync(path.join(REPO, MIGRATIONS)).filter((f) => version(f) && atLeast(version(f), FLOOR));
  for (const file of files.sort()) {
    const sql = read(`${MIGRATIONS}/${file}`).replace(/--.*$/gm, '');
    for (const a of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?(\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi)) {
      adds.push({ file, table: a[1], column: a[2] });
    }
    for (const t of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/gi)) adds.push({ file, table: t[1] });
  }
  return adds;
}

describe('mock lane baseline carries the migrations since its dump (bd-4hyyp2)', () => {
  const tables = baselineTables();
  const objects = new Set(read('supabase/baseline/schema.objects.txt').split('\n').map((l) => l.split(':')[0]));
  const adds = migrationAdds();

  test('the scan finds the migrations it is meant to guard', () => {
    expect(adds).toContainEqual({ file: 'V1.8.6__book_curriculum.sql', table: 'niete_lp612_segments', column: 'curriculum' });
  });

  test('niete_lp612_segments.curriculum — the column the Grade 6 catalog filters on — is in the baseline', () => {
    expect(tables.niete_lp612_segments.has('curriculum')).toBe(true);
  });

  test('every table a migration since the dump creates is in the baseline', () => {
    const missing = adds.filter((a) => !a.column && !tables[a.table]).map((a) => `${a.file}: ${a.table}`);
    expect(missing).toEqual([]);
  });

  // A column on a table the dump predates entirely (assessment_topics, V1.6.18) waits for the full re-dump with its table.
  const created = new Set(adds.filter((a) => !a.column).map((a) => a.table));
  const tracked = (a) => tables[a.table] || created.has(a.table);

  test('every column a migration since the dump adds is in the baseline and in schema.objects.txt', () => {
    const missing = adds
      .filter((a) => a.column && tracked(a))
      .filter((a) => !(tables[a.table] && tables[a.table].has(a.column)) || !objects.has(`${a.table}.${a.column}`))
      .map((a) => `${a.file}: ${a.table}.${a.column}`);
    expect(missing).toEqual([]);
  });
});
