/**
 * bd-n2ikd E2E — what a colliding version number actually does to a deploy.
 *
 * The unit guard beside this file (migration-version-uniqueness.test.js) says two files may not
 * share a version. This one says WHY, by driving the real MigrationRunner over a real directory
 * on disk and letting it decide what is pending. Nothing about the runner is mocked except the
 * network boundary — `schema_versions` comes back from a doubled Supabase client, the same shape
 * the live table returns.
 *
 * The scenario is the one that was about to ship: an environment that has already applied 1.4.1
 * (the enrollment roster correction), and a migrations directory that also contains the
 * lint_version migration numbered 1.4.1.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockFrom = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: mockFrom })),
}), { virtual: true });

const { MigrationRunner } = require('../../infrastructure/scripts/migrate');

/** Versions the target database reports as already applied. */
const applied = (...versions) => {
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      order: jest.fn().mockResolvedValue({
        data: versions.map((version) => ({ version })),
        error: null,
      }),
    }),
  });
};

const DDL = 'ALTER TABLE niete_lp612_renders ADD COLUMN IF NOT EXISTS lint_version TEXT;';

describe('a migration whose version is already applied under another name', () => {
  let dir;
  let runner;

  const write = (name, sql) => fs.writeFileSync(path.join(dir, name), sql);
  const pendingNames = async () => (await runner.getPendingMigrations()).map((p) => path.basename(p));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n2ikd-migrations-'));
    write('V1.4.0__lp612_render_degraded.sql', 'ALTER TABLE niete_lp612_renders ADD COLUMN x TEXT;');
    write('V1.4.1__enrollment_roster_correction.sql', 'ALTER TABLE enrollments ADD COLUMN y TEXT;');
    write('V1.4.8__record_history_watches_teacher_level.sql', 'ALTER TABLE row_history ADD COLUMN z TEXT;');

    runner = new MigrationRunner({
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key-123',
      migrationsDir: dir,
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('THE DEFECT — numbered V1.4.1 it is dropped in silence, and the column never appears', async () => {
    write('V1.4.1__lp612_lint_version.sql', DDL);
    applied('1.4.0', '1.4.1', '1.4.8');

    const pending = await pendingNames();

    // The whole failure in one assertion: the file is sitting in the directory, the runner has
    // read it, and it is not going to be applied. No throw, no warning — getPendingMigrations()
    // matched 1.4.1 against the roster correction's row and filtered the file out.
    expect(pending).not.toContain('V1.4.1__lp612_lint_version.sql');
    expect(pending).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('THE FIX — numbered V1.4.9 it is pending, and it is the only thing pending', async () => {
    write('V1.4.9__lp612_lint_version.sql', DDL);
    applied('1.4.0', '1.4.1', '1.4.8');

    expect(await pendingNames()).toEqual(['V1.4.9__lp612_lint_version.sql']);
  });

  test('V1.4.9 still sorts last, so it lands after every migration it was written behind', async () => {
    write('V1.4.9__lp612_lint_version.sql', DDL);
    applied();

    expect(await pendingNames()).toEqual([
      'V1.4.0__lp612_render_degraded.sql',
      'V1.4.1__enrollment_roster_correction.sql',
      'V1.4.8__record_history_watches_teacher_level.sql',
      'V1.4.9__lp612_lint_version.sql',
    ]);
  });

  test('the real repository file is the V1.4.9 one, not a leftover V1.4.1', () => {
    // Ties the scenario above to the tree that actually ships. Without this the two tests
    // describe a hypothetical and pass no matter what is committed.
    const real = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', 'migrations');
    const named = fs.readdirSync(real).filter((f) => f.includes('lp612_lint_version'));

    expect(named.sort()).toEqual([
      'ROLLBACK_V1.4.9__lp612_lint_version.sql',
      'V1.4.9__lp612_lint_version.sql',
    ]);
  });
});
