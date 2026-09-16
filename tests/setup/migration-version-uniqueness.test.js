/**
 * bd-n2ikd — TWO MIGRATIONS MAY NEVER CLAIM THE SAME VERSION.
 *
 * `extractVersion()` in infrastructure/scripts/migrate.js reads a migration's version from the
 * FILENAME and from nothing else, and `getPendingMigrations()` drops any file whose version is
 * already in `schema_versions`. Those two facts together mean a duplicated version number is not
 * an error, not a warning, and not a conflict — the second file is simply never applied, in
 * silence, and the only symptom appears later somewhere else entirely.
 *
 * That is what happened here. `V1.4.1__lp612_lint_version.sql` was written on a branch cut before
 * V1.4.1..V1.4.8 landed, while `V1.4.1__enrollment_roster_correction.sql` already held 1.4.1 on
 * sandbox, staging and main. Nothing on either branch alone was wrong; the collision only exists
 * in the merged tree, which is exactly where nobody was looking. Merged as it stood, every
 * environment that had run the roster correction would have skipped the lint_version migration
 * without a word, `lint_version` would never have appeared, and the fallbacks in
 * lp612-author.worker.js and lp612-serving.service.js would have reported every row as
 * `unstamped` forever — a permanently empty column that looks like a data problem, not a deploy
 * one.
 *
 * So the guard belongs on the merged tree and it belongs in CI, because "read the other branch's
 * filenames before you name yours" is not a thing a person reliably does.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', 'migrations');

/** The runner's own filename rule, verbatim from migrate.js — a guard that drifts is not a guard. */
const MIGRATION_RE = /^V(\d+\.\d+\.\d+)__.*\.sql$/;

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => MIGRATION_RE.test(f)).sort();
}

describe('every migration version is claimed by exactly one file', () => {
  test('the directory has migrations to check at all', () => {
    // Guards that silently check nothing are worse than no guard: this one would go green
    // forever if the path above ever moved.
    expect(migrationFiles().length).toBeGreaterThan(20);
  });

  test('no two migration files claim the same version', () => {
    const byVersion = new Map();
    for (const file of migrationFiles()) {
      const version = file.match(MIGRATION_RE)[1];
      if (!byVersion.has(version)) byVersion.set(version, []);
      byVersion.get(version).push(file);
    }

    const collisions = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `  ${version} is claimed by ${files.length}: ${files.join(', ')}`);

    expect(collisions.join('\n')).toBe('');
  });

  test('every ROLLBACK_ file names a migration that exists, at the same version', () => {
    // A rollback left behind at the old number is the same defect wearing a different hat: the
    // person reaching for it in an incident finds a file that reverses something else.
    const rollbacks = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.startsWith('ROLLBACK_V'));
    const present = new Set(migrationFiles());

    const orphans = rollbacks.filter((r) => !present.has(r.replace(/^ROLLBACK_/, '')));

    expect(orphans).toEqual([]);
  });
});
