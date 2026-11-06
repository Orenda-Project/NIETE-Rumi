/**
 * The mock lane's database can answer the region registry.
 *
 * The lane builds its local database from supabase/baseline/schema.sql (a sandbox dump) + the seed snapshot +
 * supabase/baseline/seed-overrides.sql. It does NOT run the migrations. So a column a migration added after the dump
 * is missing there even though the sandbox has it, and PostgREST answers a select naming it with 42703.
 *
 * region-registry.js reads region_features (region, organization, display_name, sort_order, is_active), the
 * columns V1.8.8__region_registry.sql added. While the baseline lacked them, that read failed on the lane, the
 * registry looked empty, and book-curriculum treated every Gilgit-Baltistan teacher as ICT: no GB region check could
 * run there (Amena, #4232).
 *
 * Pinned here, statically (no database needed, so CI runs it):
 *   1. every column region-registry.js selects is a region_features column in the baseline dump itself, not only in
 *      a migration;
 *   2. V1.8.8's columns are in the dump with the migration's type, NOT NULL and default;
 *   3. schema.objects.txt (what `local-db.sh drift` compares) lists them too;
 *   4. seed-overrides.sql gives the lane the registry rows V1.8.8 writes: the six ICT sectors under 'niete',
 *      Gilgit-Baltistan under 'moawin'. The seed snapshot (8 Oct) predates V1.8.8 and holds only the deployment-wide
 *      'niete' row, so without these the registry would be empty even with the columns.
 */
const fs = require('fs');
const path = require('path');
const { REPO, selectsOf } = require('./test-seam-gates-lib');

const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const BASELINE = 'supabase/baseline/schema.sql';
const OBJECTS = 'supabase/baseline/schema.objects.txt';
const OVERRIDES = 'supabase/baseline/seed-overrides.sql';
const MIGRATION = 'infrastructure/supabase/migrations/V1.8.8__region_registry.sql';
const REGISTRY = 'bot/shared/services/region-registry.js';

/** region_features as the baseline dump creates it: column -> { type, notNull, default }. */
function baselineRegionFeatures() {
  const m = /CREATE TABLE public\.region_features \(\n([\s\S]*?)\n\);/.exec(read(BASELINE));
  if (!m) throw new Error(`${BASELINE} has no CREATE TABLE public.region_features`);
  const cols = {};
  for (const line of m[1].split('\n')) {
    const c = /^\s+(\w+) (.+?),?$/.exec(line);
    if (!c) continue;
    const rest = c[2];
    const def = /DEFAULT (.+?)(?: NOT NULL)?$/.exec(rest);
    cols[c[1]] = {
      type: rest.replace(/ DEFAULT .*$/, '').replace(/ NOT NULL$/, '').trim(),
      notNull: / NOT NULL$/.test(rest),
      default: def ? def[1] : null,
    };
  }
  return cols;
}

/** V1.8.8's ADD COLUMN lines: column -> { type, notNull, default } in pg_dump's spelling. */
function migrationColumns() {
  const out = {};
  const re = /ALTER TABLE region_features ADD COLUMN IF NOT EXISTS (\w+) ([^;]+);/g;
  let m;
  while ((m = re.exec(read(MIGRATION))) !== null) {
    const spec = m[2].trim();
    const def = /DEFAULT (\S+)/i.exec(spec);
    out[m[1]] = {
      type: spec.split(/\s+/)[0].toLowerCase(),
      notNull: /NOT NULL/i.test(spec),
      default: def ? def[1].toLowerCase() : null,
    };
  }
  return out;
}

/** The (region, organization, display_name, sort_order) tuples an INSERT INTO region_features writes. */
function registryRows(sql) {
  const rows = new Set();
  const ins = /INSERT INTO (?:public\.)?region_features \(([^)]*)\)\s*VALUES\s*([\s\S]*?)\s*ON CONFLICT/gi;
  let m;
  while ((m = ins.exec(sql)) !== null) {
    const names = m[1].split(',').map((s) => s.trim());
    const tuple = /\(([^()]*)\)/g;
    let t;
    while ((t = tuple.exec(m[2])) !== null) {
      const vals = t[1].split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1'));
      const row = Object.fromEntries(names.map((n, i) => [n, vals[i]]));
      rows.add([row.region, row.organization, row.display_name, row.sort_order].join(' | '));
    }
  }
  return [...rows].sort();
}

describe('the mock lane database answers the region registry read', () => {
  test('every column region-registry.js selects from region_features is in the baseline dump', () => {
    const selected = selectsOf(read(REGISTRY))
      .filter((s) => s.table === 'region_features')
      .flatMap((s) => s.cols || []);
    expect(selected).toEqual(expect.arrayContaining(['region', 'organization', 'display_name', 'sort_order', 'is_active']));
    const have = Object.keys(baselineRegionFeatures());
    expect(selected.filter((c) => !have.includes(c))).toEqual([]);
  });

  test("V1.8.8's columns are in the dump with the migration's type, NOT NULL and default", () => {
    const want = migrationColumns();
    expect(Object.keys(want).sort()).toEqual(['display_name', 'is_active', 'organization', 'sort_order']);
    const got = baselineRegionFeatures();
    for (const [col, spec] of Object.entries(want)) expect([col, got[col]]).toEqual([col, spec]);
  });

  test('schema.objects.txt lists them, so local-db.sh drift does not report them', () => {
    const objects = read(OBJECTS).split('\n');
    for (const line of ['region_features.organization:text', 'region_features.display_name:text',
      'region_features.sort_order:integer', 'region_features.is_active:boolean']) {
      expect([line, objects.includes(line)]).toEqual([line, true]);
    }
  });

  test("seed-overrides.sql gives the lane V1.8.8's registry rows: six sectors under niete, Gilgit-Baltistan under moawin", () => {
    const want = registryRows(read(MIGRATION));
    expect(want).toHaveLength(7);
    expect(want).toContain('gilgit-baltistan | moawin | Gilgit-Baltistan | 1');
    expect(registryRows(read(OVERRIDES))).toEqual(want);
  });
});
