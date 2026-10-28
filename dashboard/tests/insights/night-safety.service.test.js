'use strict';
/**
 * The nightly's safety knobs for prod's DB and R2 (bd-sex15q.41, ops-r6; COS 28 Oct 12:17Z after the primary was
 * OOM-rebooted three times): heavy reads from the read replica (required on production), a bounded number of requests in
 * flight per database, a timeout on every request, writes in small batches, R2 uploads with bounded concurrency and retry
 * with backoff, a wall-clock end of night, a health guard that stops the run on primary swap / memory or replica lag, and no
 * production run in school hours. Network boundaries are mocked (fetch, supabase-js, pg, S3); the real chain runs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const C = require('../../lib/insights/constants');
const safety = require('../../lib/insights/safety');
const env = require('../../lib/insights/env');
const { MemoryStore, SupabaseStore, memoryClient } = require('../../lib/insights/store');
const cs = require('../../lib/insights/clip-stage');
const ms = require('../../lib/insights/model-stage');
const { runJob } = require('../../lib/insights/job');
const fx = require('./fixtures/job');

const created = [];
jest.mock('@supabase/supabase-js', () => ({
  createClient: (url, key, opts) => {
    const c = require('../../lib/insights/store').memoryClient(global.__nightTables || {});
    const reads = [];
    const client = { from: (t) => { reads.push(t); return c.from(t); }, rpc: c.rpc, reads, url, opts };
    global.__nightCreated.push(client);
    return client;
  },
}));
const pgConfigs = [];
jest.mock('pg', () => ({
  Client: class {
    constructor(cfg) { global.__nightPg.push(cfg); this.cfg = cfg; }
    async connect() {}
    async query(text) { return /advisory/.test(text) ? { rows: [{ ok: true }] } : { rows: [] }; }
    on() {}
    async end() {}
  },
}));
global.__nightCreated = created;
global.__nightPg = pgConfigs;

const cli = require('../../jobs/coachip-nightly');

const MB = 1024 * 1024;
const REPLICA = `https://${C.PROD_REF}-rr-ap-south-1-fictional.supabase.co`;
const metricsText = ({ swapUsedMb = 100, memAvailMb = 900, lagS = 0, connected = 1, identifier = C.PROD_REF } = {}) => [
  '# HELP node_memory_SwapTotal_bytes x',
  `node_memory_SwapTotal_bytes{supabase_identifier="${identifier}",service_type="db"} ${1024 * MB}`,
  `node_memory_SwapFree_bytes{supabase_identifier="${identifier}",service_type="db"} ${(1024 - swapUsedMb) * MB}`,
  `node_memory_MemAvailable_bytes{supabase_identifier="${identifier}",service_type="db"} ${memAvailMb * MB}`,
  `physical_replication_lag_physical_replication_lag_seconds{supabase_identifier="${identifier}",service_type="postgresql"} ${lagS}`,
  `physical_replication_lag_is_connected_to_primary{supabase_identifier="${identifier}",service_type="postgresql"} ${connected}`,
].join('\n');
const okResponse = (text, status = 200) => ({ ok: status < 400, status, text: async () => text, json: async () => JSON.parse(text) });

afterEach(() => { created.length = 0; pgConfigs.length = 0; delete global.__nightTables; });

describe('requests: a bounded number in flight, a timeout on each, GETs retried with backoff', () => {
  test('never more than the limit in flight', async () => {
    const lim = safety.createLimiter(2);
    let inFlight = 0; let peak = 0;
    const job = () => lim.run(async () => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; });
    await Promise.all([1, 2, 3, 4, 5, 6].map(job));
    expect(peak).toBe(2);
  });

  test('guardedFetch: 5 requests at once reach the network at most 2 at a time', async () => {
    let inFlight = 0; let peak = 0;
    const fetch = async () => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return okResponse('[]'); };
    const f = safety.guardedFetch({ fetch, maxInFlight: 2, timeoutMs: 1000 });
    await Promise.all([1, 2, 3, 4, 5].map(() => f('https://x.invalid/rest/v1/t', { method: 'GET' })));
    expect(peak).toBe(2);
  });

  test('guardedFetch: a request that hangs is aborted at the timeout', async () => {
    const fetch = (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
    const f = safety.guardedFetch({ fetch, maxInFlight: 1, timeoutMs: 30, retries: 0 });
    const t0 = Date.now();
    await expect(f('https://x.invalid/rest/v1/t', { method: 'GET' })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('guardedFetch: a GET that gets a 503 is retried after a backoff; a POST is never retried', async () => {
    const sleeps = [];
    const sleep = async (ms) => { sleeps.push(ms); };
    let n = 0;
    const flaky = async () => { n += 1; return n === 1 ? okResponse('', 503) : okResponse('[]'); };
    const f = safety.guardedFetch({ fetch: flaky, maxInFlight: 1, timeoutMs: 1000, retries: 3, sleep });
    expect((await f('https://x.invalid/rest/v1/t', { method: 'GET' })).status).toBe(200);
    expect(n).toBe(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    let posts = 0;
    const g = safety.guardedFetch({ fetch: async () => { posts += 1; return okResponse('', 503); }, maxInFlight: 1, timeoutMs: 1000, retries: 3, sleep });
    expect((await g('https://x.invalid/rest/v1/t', { method: 'POST' })).status).toBe(503);
    expect(posts).toBe(1);
  });

  test('withRetry: exponential backoff, gives up after the attempts', async () => {
    const sleeps = [];
    let calls = 0;
    await expect(safety.withRetry(async () => { calls += 1; throw new Error('503'); }, { attempts: 3, baseMs: 100, sleep: async (ms) => sleeps.push(ms), jitter: () => 1 }))
      .rejects.toThrow('503');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });
});

describe('writes go in small batches', () => {
  test('SupabaseStore upserts, inserts and deletes at most 100 rows a request', async () => {
    const sizes = [];
    const ok = { error: null, data: [] };
    const builder = { upsert: (l) => { sizes.push(['upsert', l.length]); return Promise.resolve(ok); },
      insert: (l) => { sizes.push(['insert', l.length]); return { select: () => Promise.resolve({ error: null, data: l.map(() => ({ id: 'x' })) }) }; },
      delete: () => ({ in: (c, v) => { sizes.push(['delete', v.length]); return Promise.resolve(ok); } }) };
    const store = new SupabaseStore({ from: () => builder });
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i) }));
    await store.upsert('coachip_moments', rows, 'id');
    await store.insert('coachip_moments', rows);
    await store.deleteWhere('coachip_moments', 'id', rows.map((r) => r.id));
    expect(sizes.every(([, n]) => n <= 100)).toBe(true);
    expect(sizes.filter(([k]) => k === 'upsert').map(([, n]) => n)).toEqual([100, 100, 50]);
  });
});

describe('R2: bounded concurrency, retry with backoff, and the end of night', () => {
  const SESSION = (i) => `00000000-0000-4000-8000-0400000000${String(i).padStart(2, '0')}`;
  function fakeSpawn() {
    return jest.fn((bin, args) => {
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter(); proc.stderr.resume = () => {};
      setImmediate(() => { fs.writeFileSync(args[args.length - 1], 'mp3'); proc.emit('close', 0); });
      return proc;
    });
  }
  function setup(n) {
    const store = new MemoryStore();
    const moments = Array.from({ length: n }, (_, i) => ({ id: `m-${i}`, fact_id: 'f-1', session_id: SESSION(i), from_s: 60, to_s: 120,
      confidence: 'high', clip_status: 'pending' }));
    for (const m of moments) store.rows('coachip_moments').push({ ...m });
    const audioOf = new Map(moments.map((m) => [m.session_id, '/fictional-bucket/classroom_audio/x.ogg']));
    return { store, moments, audioOf, tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-ns-')) };
  }

  test('6 cuts with concurrency 3: at most 3 uploads at once, more than one at a time, all ready', async () => {
    const { store, moments, audioOf, tmpDir } = setup(6);
    let inFlight = 0; let peak = 0;
    const putObject = async () => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight -= 1; };
    const clipper = cs.createClipper({ envName: 'sandbox', bucket: 'rumi-sandbox', s3: { putObject }, presign: async () => 'https://p.invalid/x',
      tmpDir, spawn: fakeSpawn(), bin: 'ffmpeg', concurrency: 3 });
    const n = await clipper({ momentIds: moments.map((m) => m.id), moments, facts: [{ id: 'f-1' }], audioOf, store, log: () => {} });
    expect(n).toBe(6);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  test('concurrency is capped at 4 whatever is asked', () => {
    expect(cs.clampConcurrency(10)).toBe(4);
    expect(cs.clampConcurrency(0)).toBe(1);
    expect(cs.clampConcurrency(undefined)).toBe(1);
  });

  test('an upload that fails once (R2 503) is retried after a backoff and the moment is ready', async () => {
    const { store, moments, audioOf, tmpDir } = setup(1);
    let puts = 0;
    const sleeps = [];
    const putObject = async (o) => {
      if (!o.Key.startsWith('coachip/clips/')) return; // the whole-lesson MP3 that follows is not this test's
      puts += 1;
      if (puts === 1) throw Object.assign(new Error('SlowDown'), { $metadata: { httpStatusCode: 503 } });
    };
    const clipper = cs.createClipper({ envName: 'sandbox', bucket: 'rumi-sandbox', s3: { putObject }, presign: async () => 'https://p.invalid/x',
      tmpDir, spawn: fakeSpawn(), bin: 'ffmpeg', sleep: async (ms) => sleeps.push(ms) });
    expect(await clipper({ momentIds: ['m-0'], moments, facts: [{ id: 'f-1' }], audioOf, store, log: () => {} })).toBe(1);
    expect(puts).toBe(2);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(store.rows('coachip_moments')[0].clip_status).toBe('ready');
  });

  test('past the end of night no new cut starts: the rest stay pending for tomorrow, and it says so', async () => {
    const { store, moments, audioOf, tmpDir } = setup(4);
    let started = 0;
    const lines = [];
    const clipper = cs.createClipper({ envName: 'sandbox', bucket: 'rumi-sandbox', s3: { putObject: async () => {} }, presign: async () => { started += 1; return 'https://p.invalid/x'; },
      tmpDir, spawn: fakeSpawn(), bin: 'ffmpeg', shouldStop: () => started >= 1 });
    await clipper({ momentIds: moments.map((m) => m.id), moments, facts: [{ id: 'f-1' }], audioOf, store, log: (l) => lines.push(l) });
    expect(started).toBe(1);
    expect(store.rows('coachip_moments').filter((m) => m.clip_status === 'pending')).toHaveLength(3);
    expect(lines.some((l) => /^deadline_reached stage=clips/.test(l))).toBe(true);
  });
});

describe('the end of night for the model stage (the backfill spreads over nights)', () => {
  test('nightEnd: the next 00:50Z after the start; stage cut-offs before it', () => {
    const d = safety.nightDeadlines(new Date('2026-10-28T21:00:00Z'), '00:50');
    expect(new Date(d.end).toISOString()).toBe('2026-10-29T00:50:00.000Z');
    expect(new Date(d.phonics).toISOString()).toBe('2026-10-28T22:50:00.000Z');
    expect(new Date(d.gloss).toISOString()).toBe('2026-10-28T23:35:00.000Z');
    expect(new Date(d.clips).toISOString()).toBe('2026-10-29T00:50:00.000Z');
  });

  test('phonics past its cut-off: no transcript read, no call, the rest pending, a deadline line', async () => {
    const lines = [];
    const facts = [1, 2, 3].map((i) => ({ id: `f-${i}`, session_id: `s-${i}`, instrument: 'lp_fidelity', status: 'ok', lesson_type: 'literacy_phonics',
      recorded_at: `2026-10-2${i}T05:00:00Z`, grade: 2, subject: 'urdu' }));
    const readClient = { from: () => { throw new Error('no read expected'); } };
    const fetch = jest.fn();
    const ctx = ms.createModelContext({ capUsd: 23, write: false, store: new MemoryStore(), jobRunId: 'r', log: (l) => lines.push(l),
      deps: { readClient, fetch, apiKey: 'k', now: () => Date.parse('2026-10-28T23:00:00Z'), deadlines: { phonics: Date.parse('2026-10-28T22:50:00Z') } } });
    expect(await ms.runPhonics(ctx, { facts, inWindow: () => true })).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.summary.pending).toBe(3);
    expect(lines).toContain('deadline_reached stage=phonics pending=3');
  });
});

describe('the health guard (abort rule: primary swap or memory, replica lag)', () => {
  test('parseMetrics reads swap used, memory available, lag and the replica link', () => {
    const m = safety.parseMetrics(metricsText({ swapUsedMb: 267, memAvailMb: 493, lagS: 2, connected: 1 }));
    expect(m).toMatchObject({ swap_used_mb: 267, mem_available_mb: 493, lag_s: 2, connected: 1 });
  });

  const guardWith = (primary, replica, over = {}) => {
    const fetch = jest.fn(async (url) => okResponse(url.includes('-rr-') ? replica : primary));
    return { fetch, guard: safety.createHealthGuard({ fetch, primaryUrl: `https://${C.PROD_REF}.supabase.co`, replicaUrl: REPLICA, key: 'k',
      sleep: async () => {}, ...over }) };
  };

  test.each([
    ['healthy', {}, {}, true, null],
    ['primary swap over 700 MB', { swapUsedMb: 750 }, {}, false, 'primary_swap'],
    ['primary memory under 300 MB', { memAvailMb: 250 }, {}, false, 'primary_memory'],
    ['replica lag over 300 s', {}, { lagS: 400 }, false, 'replica_lag'],
    ['replica cut off from the primary', {}, { connected: 0 }, false, 'replica_disconnected'],
  ])('%s', async (_n, p, r, ok, reason) => {
    const { guard } = guardWith(metricsText(p), metricsText({ ...r, identifier: `${C.PROD_REF}-rr` }));
    expect(await guard.check()).toMatchObject({ ok, reason });
  });

  test('metrics unreadable after retries: fails closed', async () => {
    const fetch = jest.fn(async () => okResponse('', 500));
    const guard = safety.createHealthGuard({ fetch, primaryUrl: `https://${C.PROD_REF}.supabase.co`, replicaUrl: null, key: 'k', sleep: async () => {} });
    expect(await guard.check()).toMatchObject({ ok: false, reason: 'metrics_unreadable' });
  });

  test('checks are cached for a minute: two checks, one round of fetches', async () => {
    let t = 0;
    const { fetch, guard } = guardWith(metricsText(), metricsText({ identifier: `${C.PROD_REF}-rr` }), { now: () => t });
    await guard.check(); t += 30000; await guard.check();
    expect(fetch).toHaveBeenCalledTimes(2); // primary + replica, once
    t += 31000; await guard.check();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  test('runJob: an unhealthy primary before the first stage stops the run, failed, a named line, nothing computed', async () => {
    const { tables } = fx.build();
    const store = new MemoryStore();
    const lines = [];
    const code = await runJob({ date: '2026-10-26', dryRun: false, scope: null, stages: null, noModels: true, dryRunModelsUsd: 0, backfillBudgetUsd: 0 },
      { mode: 'write', envName: 'sandbox', ref: C.SANDBOX_REF, readClient: memoryClient(tables), store, secret: 'a'.repeat(64),
        out: fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-ns-')), log: (l) => lines.push(l),
        health: { check: async () => ({ ok: false, reason: 'primary_swap' }) } });
    expect(code).toBe(2);
    expect(lines).toContain('health_abort stage=facts reason=primary_swap');
    expect(store.rows('coachip_session_facts')).toHaveLength(0);
    expect(store.rows('coachip_job_runs')[0]).toMatchObject({ status: 'failed', failure_class: 'upstream' });
  });
});

describe('the CLI on production: replica reads, school hours, the lock connection', () => {
  const prodEnv = (over = {}) => ({ SUPABASE_URL: `https://${C.PROD_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'k', COACHIP_ENV: 'production',
    COACHIP_READ_SUPABASE_URL: REPLICA, ...over });
  const night = () => new Date('2026-10-28T21:05:00Z');
  const healthyFetch = async (url) => okResponse(metricsText({ identifier: url.includes('-rr-') ? `${C.PROD_REF}-rr` : C.PROD_REF }));

  test('resolveReadUrl: production needs the replica of its own project; other tiers fall back to the primary', () => {
    expect(() => env.resolveReadUrl({ coachipEnv: 'production', supabaseUrl: `https://${C.PROD_REF}.supabase.co` })).toThrow(env.EnvRefusal);
    expect(() => env.resolveReadUrl({ coachipEnv: 'production', supabaseUrl: `https://${C.PROD_REF}.supabase.co`,
      readUrl: `https://${C.STAGING_REF}-rr-ap-south-1-x.supabase.co` })).toThrow(env.EnvRefusal);
    expect(() => env.resolveReadUrl({ coachipEnv: 'production', supabaseUrl: `https://${C.PROD_REF}.supabase.co`,
      readUrl: `https://${C.PROD_REF}.supabase.co` })).toThrow(env.EnvRefusal); // the primary named as the replica
    expect(env.resolveReadUrl({ coachipEnv: 'production', supabaseUrl: `https://${C.PROD_REF}.supabase.co`, readUrl: REPLICA }))
      .toEqual({ url: REPLICA, source: 'replica' });
    expect(env.resolveReadUrl({ coachipEnv: 'staging', supabaseUrl: `https://${C.STAGING_REF}.supabase.co` }))
      .toEqual({ url: `https://${C.STAGING_REF}.supabase.co`, source: 'primary' });
  });

  test('a production dry run with no replica named exits 3 before any client exists', async () => {
    const lines = [];
    const code = await cli.main(['--date', '2026-10-27', '--dry-run'], prodEnv({ COACHIP_READ_SUPABASE_URL: '' }), (l) => lines.push(l),
      { now: night, fetch: healthyFetch });
    expect(code).toBe(3);
    expect(lines).toEqual(['refused reason=no_replica']);
    expect(created).toHaveLength(0);
  });

  test('a production run in school hours (03:00-12:00Z) exits 3 before any client exists', async () => {
    const lines = [];
    const code = await cli.main(['--date', '2026-10-27', '--dry-run'], prodEnv(), (l) => lines.push(l),
      { now: () => new Date('2026-10-28T05:00:00Z'), fetch: healthyFetch });
    expect(code).toBe(3);
    expect(lines).toEqual(['refused reason=school_hours']);
    expect(created).toHaveLength(0);
  });

  test('a production dry run at night reads the source tables from the replica, bounded and timed, and says so', async () => {
    global.__nightTables = fx.build().tables;
    const lines = [];
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-ns-'));
    const code = await cli.main(['--date', '2026-10-26', '--dry-run', '--no-models', '--out', out], prodEnv(), (l) => lines.push(l),
      { now: night, fetch: healthyFetch });
    expect(code).toBe(0);
    const replica = created.find((c) => c.url === REPLICA);
    const primary = created.find((c) => c.url === `https://${C.PROD_REF}.supabase.co`);
    expect(replica.reads).toEqual(expect.arrayContaining(['schools', 'leader_schools', 'users', 'coaching_sessions']));
    expect(primary ? primary.reads : []).not.toContain('coaching_sessions');
    for (const c of created) expect(typeof c.opts.global.fetch).toBe('function');
    expect(lines.find((l) => l.startsWith('safety '))).toMatch(/^safety read=replica db_inflight=2 read_inflight=2 timeout_ms=\d+ r2_concurrency=\d health=on end=2026-10-29T00:50Z model_concurrency=1$/);
    fs.rmSync(out, { recursive: true, force: true });
  });

  test('COACHIP_MODEL_CONCURRENCY: default 1, held to 1..12 (bd-sex15q.43)', () => {
    expect(cli.safetyConfig({}).modelConcurrency).toBe(1);
    expect(cli.safetyConfig({ COACHIP_MODEL_CONCURRENCY: '3' }).modelConcurrency).toBe(3);
    expect(cli.safetyConfig({ COACHIP_MODEL_CONCURRENCY: '12' }).modelConcurrency).toBe(12);
    expect(cli.safetyConfig({ COACHIP_MODEL_CONCURRENCY: '40' }).modelConcurrency).toBe(12);
    expect(cli.safetyConfig({ COACHIP_MODEL_CONCURRENCY: '0' }).modelConcurrency).toBe(1);
  });

  test('the knob reaches the phonics stage: the safety line and phonics_start both say concurrency 3', async () => {
    global.__nightTables = fx.build().tables;
    const lines = [];
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-ns-'));
    // OpenRouter is the network boundary: every model call answers 500 (recorded as failed); nothing leaves the test.
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 500 } }) }));
    try {
      const code = await cli.main(['--date', '2026-10-26', '--dry-run', '--dry-run-models', '0.05', '--out', out],
        prodEnv({ COACHIP_MODEL_CONCURRENCY: '3', OPENROUTER_API_KEY: 'k' }), (l) => lines.push(l), { now: night, fetch: healthyFetch });
      expect(code).toBe(0);
    } finally { spy.mockRestore(); fs.rmSync(out, { recursive: true, force: true }); }
    expect(lines.find((l) => l.startsWith('safety '))).toMatch(/ model_concurrency=3$/);
    expect(lines.find((l) => l.startsWith('phonics_start'))).toMatch(/ concurrency=3$/);
  });

  test('the run-lock connection has a query timeout and a connect timeout (no session SET)', async () => {
    global.__nightTables = fx.build().tables;
    const e = { SUPABASE_URL: `https://${C.SANDBOX_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'k', COACHIP_ENV: 'sandbox',
      DATABASE_URL: `postgresql://postgres.${C.SANDBOX_REF}:x@pooler.invalid:6543/postgres`, COACHIP_TEACHER_KEY_SECRET: 'a'.repeat(64) };
    // The in-memory client takes no writes, so the run itself stops at its first write; the lock connection is what is checked.
    await cli.main(['--date', '2026-10-26', '--no-models', '--stages', 'facts', '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-ns-'))], e, () => {},
      { now: night, fetch: healthyFetch }).catch(() => {});
    expect(pgConfigs).toHaveLength(1);
    expect(pgConfigs[0].query_timeout).toBeGreaterThan(0);
    expect(pgConfigs[0].connectionTimeoutMillis).toBeGreaterThan(0);
    expect(pgConfigs[0].options).toBeUndefined();
  });
});
