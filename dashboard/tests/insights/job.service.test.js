'use strict';
/**
 * The run end to end on a fictional tier (fixtures/job.js): the real source → facts → signals → moments → rollups →
 * ranking → circle chain over a supabase-js look-alike. NIGHTLY_JOB §12 tests 2 (dry run writes nothing; codes and counts
 * only), 3 (forbidden keys never read), 12 (idempotency), the failure statuses (§9) and the CLI's exit codes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runJob } = require('../../lib/insights/job');
const { MemoryStore, memoryClient } = require('../../lib/insights/store');
const cli = require('../../jobs/coachip-nightly');
const C = require('../../lib/insights/constants');
const fx = require('./fixtures/job');

const SECRET = 'a'.repeat(64);
const OPTS = { date: '2026-10-26', dryRun: false, scope: null, stages: null, noModels: true, dryRunModelsUsd: 0, backfillBudgetUsd: 0, reconcile: true };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-job-'));
const writeDeps = (tables, store, extra = {}) => ({ mode: 'write', envName: 'sandbox', ref: C.SANDBOX_REF, readClient: memoryClient(tables),
  store, secret: SECRET, out: tmp(), log: () => {}, ...extra });

describe('dry run (read-only)', () => {
  test('writes no DB row; outputs counts.json, excluded.json, costs.json with codes and counts only', async () => {
    const { tables, coaches, uid } = fx.build();
    const store = new MemoryStore();
    const out = tmp();
    const code = await runJob({ ...OPTS, dryRun: true }, { mode: 'read_only', envName: 'production', ref: C.PROD_REF,
      readClient: memoryClient(tables), store, secret: SECRET, out, log: () => {} });
    expect(code).toBe(0);
    expect(store.calls).toHaveLength(0);
    expect(fs.readdirSync(out).sort()).toEqual(['costs.json', 'counts.json', 'excluded.json']);
    const text = fs.readdirSync(out).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
    for (const id of [...coaches, uid('02', 1), uid('01', 1), uid('03', 1)]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/Fictional|placeholder|[0-9a-f]{16}"/);
    const counts = JSON.parse(fs.readFileSync(path.join(out, 'counts.json'), 'utf8'));
    const ip = counts.ict_w4.find((r) => r.w_id === 'W-IP');
    expect(ip.d).toBe(96); // 6 schools × 4 teachers × 4 lessons; the duplicate and the mismatch are excluded
    expect(ip.n).toBe(48);
    expect(counts.reconcile.dedup_on.find((r) => r.phase === 'independent')).toMatchObject({ skipped: 48, graded: 96 });
    expect(Object.keys(counts.coaches)).toEqual(expect.arrayContaining(['C-01', 'C-02', 'C-03']));
    const excluded = JSON.parse(fs.readFileSync(path.join(out, 'excluded.json'), 'utf8'));
    expect(excluded.window_4w).toMatchObject({ duplicate: 2, mismatch: 1 }); // the duplicate's lp and FICO facts
  });

  test('a Proxy over every analysis_data: the run never reads a forbidden key', async () => {
    const { tables } = fx.build({ forbidden: true, proxy: true });
    const code = await runJob({ ...OPTS, dryRun: true }, { mode: 'read_only', envName: 'production', ref: C.PROD_REF,
      readClient: memoryClient(tables), store: new MemoryStore(), secret: SECRET, out: tmp(), log: () => {}, rethrow: true });
    expect(code).toBe(0);
  });
});

describe('write mode on the sandbox tier', () => {
  test('writes facts, signals, steps, moments, rollups (CHECK-clean), circle and an ok job run', async () => {
    const { tables } = fx.build();
    const store = new MemoryStore();
    expect(await runJob(OPTS, writeDeps(tables, store))).toBe(0);
    const n = (t) => store.rows(t).length;
    expect(n('coachip_weaknesses')).toBe(30);
    expect(n('coachip_session_facts')).toBeGreaterThan(96);
    expect(n('coachip_session_signals')).toBeGreaterThan(0);
    expect(n('coachip_session_steps')).toBeGreaterThan(0);
    expect(n('coachip_moments')).toBeGreaterThan(0);
    const run = store.rows('coachip_job_runs')[0];
    expect(run).toMatchObject({ status: 'ok', env_ref: C.SANDBOX_REF, attempt: 1, run_date: '2026-10-26' });
    expect(run.stages_done).toEqual(expect.arrayContaining(['facts', 'signals', 'moments', 'rollups', 'ranking', 'circle']));
    const { assertRollupChecks } = require('./fixtures/rollups');
    for (const r of store.rows('coachip_rollups')) { const { id, scope_id, ...row } = r; assertRollupChecks({ ...row, meta: null }); }
    const sectorIp = store.rows('coachip_rollups').find((r) => r.scope_kind === 'sector' && r.sector === 'Urban-I' && r.w_id === 'W-IP' && r.window_weeks === 4);
    expect(sectorIp).toMatchObject({ status: 'ok', numerator: 48, denominator: 96, coaches_with_5plus: 3, window_start: '2026-09-28', window_end: '2026-10-25' });
    for (const f of store.rows('coachip_session_facts')) {
      expect(f.teacher_key).toMatch(/^[0-9a-f]{16}$/);
      expect(f).not.toHaveProperty('allowed');
      expect(f).not.toHaveProperty('coach_user_ids');
    }
    const circle = store.rows('coachip_circle_items');
    const momentIds = new Set(store.rows('coachip_moments').map((m) => m.id));
    for (const c of circle) expect(momentIds.has(c.moment_id)).toBe(true);
  });

  test('idempotency: a second run of the same date changes no derived row (NIGHTLY_JOB §8)', async () => {
    const { tables } = fx.build();
    const store = new MemoryStore();
    await runJob(OPTS, writeDeps(tables, store));
    store.changed = {};
    expect(await runJob(OPTS, writeDeps(tables, store))).toBe(0);
    for (const t of ['coachip_session_facts', 'coachip_session_signals', 'coachip_session_steps', 'coachip_moments', 'coachip_rollups',
      'coachip_circle_items', 'coachip_weaknesses', 'coachip_interventions', 'coachip_weakness_signals']) {
      expect([t, store.changed[t] || 0]).toEqual([t, 0]);
    }
    expect(store.rows('coachip_job_runs')).toHaveLength(1);
    expect(store.rows('coachip_job_runs')[0].attempt).toBe(2);
  });

  test('a regraded session replaces only its own derived rows', async () => {
    const { tables, uid } = fx.build();
    const store = new MemoryStore();
    await runJob(OPTS, writeDeps(tables, store));
    const target = tables.coaching_sessions.find((s) => s.id === uid('03', 3));
    target.analysis_data = { ...target.analysis_data, lp_fidelity: { ...target.analysis_data.lp_fidelity,
      moves: target.analysis_data.lp_fidelity.moves.map((m) => (m.phase === 'independent' ? { ...m, verdict: 'not_done', evidence: '' } : m)) } };
    store.changed = {};
    // Next night: a new date, so the held-for-week rule leaves the rollups as they are.
    await runJob({ ...OPTS, date: '2026-10-27' }, writeDeps(tables, store));
    expect(store.changed.coachip_session_facts).toBe(1);
    const fact = store.rows('coachip_session_facts').find((f) => f.session_id === uid('03', 3) && f.framework_version === 'lp_fidelity');
    const sig = store.rows('coachip_session_signals').find((s) => s.fact_id === fact.id && s.w_id === 'W-IP');
    expect(sig.is_hit).toBe(true);
    expect(store.changed.coachip_rollups || 0).toBe(0);
  });

  test('a failure before the rollups marks the run failed and leaves yesterday\'s rollups', async () => {
    const { tables } = fx.build();
    const store = new MemoryStore();
    await runJob(OPTS, writeDeps(tables, store));
    const before = JSON.stringify(store.rows('coachip_rollups'));
    const broken = memoryClient(tables);
    const realFrom = broken.from;
    broken.from = (t) => { if (t === 'coaching_sessions') throw new Error('upstream down'); return realFrom(t); };
    const code = await runJob({ ...OPTS, date: '2026-10-27' }, { ...writeDeps(tables, store), readClient: broken });
    expect(code).toBe(2);
    const run = store.rows('coachip_job_runs').find((r) => r.run_date === '2026-10-27');
    expect(run).toMatchObject({ status: 'failed', failure_class: 'upstream' });
    expect(JSON.stringify(store.rows('coachip_rollups'))).toBe(before);
  });
});

describe('the CLI', () => {
  const prod = `https://${C.PROD_REF}.supabase.co`;
  test('a prod URL without --dry-run exits 3 before any client exists', async () => {
    const lines = [];
    const code = await cli.main(['--date', '2026-10-26'], { SUPABASE_URL: prod, COACHIP_ENV: 'production' }, (m) => lines.push(m));
    expect(code).toBe(3);
    expect(lines).toEqual(['env_mismatch']);
  });
  test('a sandbox URL told it is production exits 3', async () => {
    const code = await cli.main(['--date', '2026-10-26'], { SUPABASE_URL: `https://${C.SANDBOX_REF}.supabase.co`, COACHIP_ENV: 'production' }, () => {});
    expect(code).toBe(3);
  });
  test('argument checks', () => {
    expect(() => cli.parseArgs(['--date', '26-10-2026'])).toThrow();
    expect(() => cli.parseArgs(['--dry-run-models', '5'])).toThrow(/0..1/);
    expect(cli.parseArgs(['--date', '2026-10-26', '--dry-run', '--scope', 'sector:Urban-I'])).toMatchObject({ dryRun: true, scope: 'sector:Urban-I' });
    expect(cli.defaultDate(new Date('2026-10-26T21:30:00Z'))).toBe('2026-10-26'); // 02:30 PKT on the 27th → the night of the 26th
  });
});
