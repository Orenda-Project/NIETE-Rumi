'use strict';
/**
 * bd-sex15q.38 — the nightly's run row must be storable on every tier it may write to.
 *
 * The job writes `coachip_job_runs.env_ref = deps.ref`, the Supabase project ref asserted by lib/insights/env.js
 * (dashboard/lib/insights/job.js, the run-row upsert). V1.8.0 created the column with
 * CHECK (env_ref IN ('olvritwoqujtjvwfulbh','staging','production')): the sandbox REF beside two placeholder WORDS, so the
 * first write of a staging or production run was refused (staging hand run 27 Oct 2026, board 20261027T183227) and
 * nothing else could be written. V1.8.3 makes the list the three refs of constants.js.
 *
 * The chain under test: runJob (write mode, MemoryStore, the fictional tier of dashboard/tests/insights/fixtures/job.js)
 * builds the run row for a tier's ref; that very row is then inserted into a throwaway Postgres built from the real
 * migrations (tests/coachip/helpers/pg-harness.js, every V1.8.*), where the CHECK lives. No real database, no network.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const { runJob } = require('../../dashboard/lib/insights/job');
const { MemoryStore, memoryClient } = require('../../dashboard/lib/insights/store');
const C = require('../../dashboard/lib/insights/constants');
const fx = require('../../dashboard/tests/insights/fixtures/job');

const run = hasPostgres() ? describe : describe.skip;
const OPTS = { date: '2026-10-26', dryRun: false, scope: null, stages: ['facts'], noModels: true, dryRunModelsUsd: 0, backfillBudgetUsd: 0, reconcile: false };

/** The run row runJob writes for `ref` on `envName`, as the store received it. */
async function runRowFor(envName, ref) {
  const store = new MemoryStore();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-envref-'));
  await runJob(OPTS, { mode: 'write', envName, ref, readClient: memoryClient(fx.build().tables), store, secret: 'a'.repeat(64), out, log: () => {} });
  fs.rmSync(out, { recursive: true, force: true });
  const row = store.rows('coachip_job_runs')[0];
  expect(row.env_ref).toBe(ref);
  return row;
}

run('coachip_job_runs.env_ref accepts every tier the job may write to (Postgres, V1.8.*)', () => {
  let pg; let cols;
  beforeAll(async () => {
    pg = await startPg();
    cols = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'coachip_job_runs'")).rows.map((r) => r.column_name);
  }, 180000);
  afterAll(async () => { if (pg) await pg.close(); });
  beforeEach(async () => { await pg.query('DELETE FROM coachip_job_runs'); });

  const insert = (row) => {
    const keys = Object.keys(row).filter((k) => cols.includes(k));
    // text[] columns go as JS arrays (pg encodes them); any other object is jsonb.
    const vals = keys.map((k) => (row[k] && typeof row[k] === 'object' && !Array.isArray(row[k]) ? JSON.stringify(row[k]) : row[k]));
    return pg.query(`INSERT INTO coachip_job_runs (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
  };

  test.each([
    ['sandbox', C.SANDBOX_REF],
    ['staging', C.STAGING_REF],
    ['production', C.PROD_REF],
  ])('the %s run row (env_ref = that tier\'s project ref) is stored', async (envName, ref) => {
    const row = await runRowFor(envName, ref);
    await insert(row);
    const { rows } = await pg.query('SELECT env_ref, status FROM coachip_job_runs');
    expect(rows).toEqual([{ env_ref: ref, status: row.status }]);
  });

  test('a ref that is no tier of ours is still refused', async () => {
    const row = await runRowFor('staging', 'zzzzzzzzzzzzzzzzzzzz');
    await expect(insert(row)).rejects.toMatchObject({ code: '23514', constraint: 'coachip_job_runs_env_ref_check' });
  });

  test('the placeholder words are no longer env_refs', async () => {
    for (const word of ['staging', 'production']) {
      const row = await runRowFor('staging', word);
      await expect(insert(row)).rejects.toMatchObject({ code: '23514', constraint: 'coachip_job_runs_env_ref_check' });
    }
  });
});
