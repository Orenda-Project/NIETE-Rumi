/**
 * R12 — the school search finds its school on the mock lane (bd-v4mdcv).
 *
 * `schools` is deliberately not a seed table (seed-tables.txt: a run starts with no teacher history, a test
 * that needs some creates it in its own setup), so the local database had 0 schools and R12's "215" found
 * nothing on every run. The registration driver now seeds the one row the search must find — an EMIS that
 * starts with "215" (school-search.service scores that +50), named IMSG G-7/3-2 (the title the driver taps),
 * is_probable_test false (the search filters those out) — and purges it at the end, on the mock lane only.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
// a dry run never connects; the script only needs the env's credentials to be SET (niete_training_db _creds)
const ENV = { ...process.env, NIETE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:1', NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'dry-run' };

test('the DB script has seed-school and purge-school, gated on --yes-write, with the row the search needs', () => {
  const out = execFileSync('python3', [path.join(REPO, '.claude/qa/shared/niete_registration_db.py'), 'seed-school', '--env', 'local', '--phone', '923000000000'], { encoding: 'utf8', env: ENV });
  const row = JSON.parse(out.trim().split('\n').pop());
  expect(row.dry_run).toBe(true);
  expect(row.would_insert).toMatchObject({ name: 'IMSG G-7/3-2', is_probable_test: false, source_system: 'qa_seed' });
  expect(row.would_insert.emis).toBe('215');   // an exact EMIS is the only wordless hit (score 1000)
  const purge = JSON.parse(execFileSync('python3', [path.join(REPO, '.claude/qa/shared/niete_registration_db.py'), 'purge-school', '--env', 'local', '--phone', '923000000000'], { encoding: 'utf8', env: ENV }).trim().split('\n').pop());
  expect(purge.dry_run).toBe(true);
});

test('the driver seeds before the Flow block and purges at the end, on the mock lane only', () => {
  const src = read('.claude/qa/shared/features/registration.cjs');
  expect(src).toMatch(/const seedSchool = api\.caps && api\.caps\.method === 'mock'/);
  expect(src.indexOf("api.db('seed-school')")).toBeLessThan(src.indexOf("if (want('R02', 'R09', 'R07', 'R12'"));
  expect(src.lastIndexOf("api.db('purge-school')")).toBeGreaterThan(src.indexOf("rec('R12'"));
});
