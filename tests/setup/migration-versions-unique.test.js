/**
 * No two migrations share a version (bd-rj6w0n.14.16.13).
 *
 * The runner keys schema_versions on the version alone, so a second V1.9.2 file is read as
 * already applied once the first one is recorded and never runs: sandbox carried
 * V1.9.2__region_book_keys and silently skipped V1.9.2__gb_lp_renders.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', 'migrations');

// The one pair that predates this guard (Oct 2026). Both are applied by hand on every environment,
// so renumbering one now could re-run it; bd-rj6w0n.14.16.14 sorts it out. Nothing may join this list.
const KNOWN = { '1.6.1': ['V1.6.1__child_test_tasks.sql', 'V1.6.1__niete_lp_opens.sql'] };

it('every V*.sql migration has its own version', () => {
  const byVersion = {};
  for (const f of fs.readdirSync(DIR)) {
    const m = f.match(/^V(\d+\.\d+\.\d+)__/);
    if (m) (byVersion[m[1]] = byVersion[m[1]] || []).push(f);
  }
  const shared = Object.entries(byVersion)
    .filter(([v, files]) => files.length > 1 && JSON.stringify(files.sort()) !== JSON.stringify(KNOWN[v]));
  expect(shared).toEqual([]);
});
