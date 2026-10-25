'use strict';
/**
 * The lesson-plan health check, per free-form track.
 *
 * WHY. A free-form request is a `source='gamma_standard'` row whose track lives in
 * `textbook_metadata.fflp_track`. The check summarised by source alone, so a free-form outage was charged to
 * Gamma (the alert said "Gamma plans are failing"), and a Gamma regression could hide inside healthy free-form
 * volume (3 failures in 50 asks is under both rules; 3 in Gamma's own 10 is 30%).
 *
 * RULES PINNED.
 *   · The window is ALSO summarised per track key — coalesce(textbook_metadata->>'fflp_track', source) — per
 *     channel, with the SAME rules as a source (>= 20% of >= 10 finished, or >= 5 system failures).
 *   · The per-source summary, and its reasons, are unchanged (the existing suites are their golden).
 *   · A track that a source summary already says the same thing about adds no second reason.
 *   · A track under the floor (< 10 finished and < 5 system failures) reads `insufficient`, never `healthy`.
 *   · The worker's «Free-form payload track ignored» line (a writer and the reader disagree about the row
 *     shape) is counted in the SAME Axiom read as the lifecycle write failures; any line is a reason.
 */

const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockEvent(...a), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));

const Health = require('../../bot/shared/services/monitoring/lesson-plan-health.service');

// ── the network: Axiom's APL endpoint and Slack, mocked at fetch ─────────────────
const net = { axiom: [], axiomRows: [], slack: [] };
function tabular(rows) {
  const fields = ['kind', 'code', 'source', 'n'];
  return { tables: [{ fields: fields.map((name) => ({ name })), columns: fields.map((f) => rows.map((r) => r[f])) }] };
}
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.axiom.co/')) {
      net.axiom.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => tabular(net.axiomRows) };
    }
    if (u === 'https://slack.com/api/chat.postMessage') {
      net.slack.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, ts: '1.1' }) };
    }
    throw new Error(`unexpected network call: ${u}`);
  });
});
afterAll(() => { global.fetch = realFetch; });

const NOW = new Date('2026-10-14T10:00:00.000Z');
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
let seq = 0;
const ask = (over = {}) => ({
  id: `r-${(seq += 1)}`, user_id: `u-${seq}`, source: 'gamma_standard', channel: 'whatsapp',
  status: 'completed', error_code: null, created_at: ago(30), delivered_at: ago(29), textbook_metadata: null, ...over,
});
const ff = (over = {}) => ask({ textbook_metadata: { fflp_track: 'freeform_v1' }, ...over });
const failed = (over = {}) => ({ status: 'failed', error_code: 'GENERATION_FAILED', delivered_at: null, ...over });
const many = (n, make) => Array.from({ length: n }, () => make());

function fakeRedis() {
  const store = new Map();
  return {
    isAvailable: () => true,
    setNX: jest.fn(async (k, v) => { if (!store.has(k)) store.set(k, v); return true; }),
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    del: (k) => store.delete(k),
  };
}
const checked = () => mockEvent.mock.calls.filter((c) => c[0] === 'lesson_plan.health.checked').map((c) => c[1]);
const track = (event, key, channel = 'whatsapp') => (event.tracks || []).find((t) => t.track === key && t.channel === channel);

const KEYS = ['LP_LIFECYCLE_PATHS', 'REGION', 'NODE_ENV', 'LP_HEALTH_ALERT', 'LP_HEALTH_CHECK', 'AXIOM_TOKEN', 'AXIOM_API_TOKEN',
  'AXIOM_DATASET', 'AXIOM_ORG_ID', 'QUIZ_FUNNEL_WATCH_SLACK_TOKEN', 'QUIZ_FUNNEL_WATCH_SLACK_CHANNEL', 'PROD_DIGEST_SLACK_TOKEN', 'PROD_DIGEST_SLACK_CHANNEL'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { LP_LIFECYCLE_PATHS: 'all', REGION: 'niete', NODE_ENV: 'test', LP_HEALTH_ALERT: 'off' });
  Object.assign(net, { axiom: [], axiomRows: [], slack: [] });
  mockLog.mockClear();
  mockEvent.mockClear();
  mockDb = createMemorySupabase({ lesson_plan_requests: [] });
  Health.__resetForTests();
});
afterEach(() => {
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('the window, per free-form track', () => {
  test('20 freeform_v1 asks all failed inside 200 delivered Gamma asks: the free-form track is named, not Gamma alone', async () => {
    mockDb.tables.lesson_plan_requests = [...many(20, () => ff(failed())), ...many(200, () => ask())];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    // The per-source reason is what it was (the source summary is unchanged)…
    expect(out.reasons).toContain('failure_rate:gamma_standard/whatsapp');
    // …and the track says where the failures are.
    expect(out.reasons).toContain('failure_rate:track:freeform_v1/whatsapp');
    const [event] = checked();
    expect(track(event, 'freeform_v1')).toEqual(expect.objectContaining({ status: 'failing', asks: 20, systemFailures: 20, systemFailureRate: 1 }));
    expect(track(event, 'gamma_standard')).toEqual(expect.objectContaining({ status: 'healthy', asks: 200, systemFailures: 0 }));
    expect(event.sources.find((s) => s.source === 'gamma_standard')).toEqual(expect.objectContaining({ asks: 220, systemFailures: 20 }));
  });

  test('a Gamma regression inside free-form volume: 3 of Gamma\'s own 10 failed — healthy by source, failing by track', async () => {
    mockDb.tables.lesson_plan_requests = [...many(40, () => ff()), ...many(7, () => ask()), ...many(3, () => ask(failed({ error_code: 'RENDER_FAILED' })))];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.verdict).toBe('degraded');
    expect(out.reasons).toEqual(['failure_rate:track:gamma_standard/whatsapp']);
    const [event] = checked();
    expect(track(event, 'gamma_standard')).toEqual(expect.objectContaining({ status: 'failing', asks: 10, systemFailureRate: 0.3 }));
    expect(track(event, 'freeform_v1')).toEqual(expect.objectContaining({ status: 'healthy', asks: 40 }));
  });

  test('a track under the floor reads insufficient, never healthy', async () => {
    mockDb.tables.lesson_plan_requests = [...many(3, () => ff()), ...many(12, () => ask())];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.verdict).toBe('healthy');
    const [event] = checked();
    expect(track(event, 'freeform_v1')).toEqual(expect.objectContaining({ status: 'insufficient', asks: 3 }));
    expect(track(event, 'gamma_standard')).toEqual(expect.objectContaining({ status: 'healthy' }));
  });

  test('a path with no free-form rows: its track says the same as its source, and adds no second reason', async () => {
    mockDb.tables.lesson_plan_requests = [
      ...many(7, () => ask({ source: 'niete_lp612' })),
      ...many(3, () => ask({ source: 'niete_lp612', status: 'failed', error_code: 'DELIVERY_FAILED', delivered_at: null })),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.reasons).toEqual(['failure_rate:niete_lp612/whatsapp']);
    expect(track(checked()[0], 'niete_lp612')).toEqual(expect.objectContaining({ status: 'failing' }));
  });

  test('the on-demand view carries the tracks too', async () => {
    mockDb.tables.lesson_plan_requests = [...many(20, () => ff(failed())), ...many(20, () => ask())];
    const view = await Health.onDemand({ now: NOW });
    expect(view.tracks).toEqual(expect.arrayContaining([expect.objectContaining({ track: 'freeform_v1', channel: 'whatsapp', status: 'failing' })]));
  });
});

describe('track_shape_disagreement: the worker\'s «payload track ignored» line', () => {
  beforeEach(() => { Object.assign(process.env, { AXIOM_TOKEN: 'axiom-test', AXIOM_DATASET: 'test-logs' }); });

  test('two lines in the window are a reason, from the SAME Axiom read as the write failures (one call)', async () => {
    net.axiomRows = [{ kind: 'track_ignored', code: '', source: '', n: 2 }, { kind: 'write_failed', code: 'PGRST204', source: 'niete_lp612', n: 1 }];
    mockDb.tables.lesson_plan_requests = [...many(12, () => ask())];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.reasons).toEqual(['track_shape_disagreement']);
    expect(net.axiom).toHaveLength(1);
    expect(net.axiom[0].apl).toMatch(/Free-form payload track ignored/);
    const [event] = checked();
    expect(event.trackShapeDisagreement).toEqual({ count: 2 });
    expect(event.writeFailures).toEqual({ count: 1, codes: { PGRST204: 1 } });
  });

  test('none is no reason; no Axiom token leaves it null (unknown), never zero', async () => {
    mockDb.tables.lesson_plan_requests = [...many(12, () => ask())];
    let out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.reasons).toEqual([]);
    expect(checked()[0].trackShapeDisagreement).toEqual({ count: 0 });
    delete process.env.AXIOM_TOKEN;
    mockEvent.mockClear();
    Health.__resetForTests();
    out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.reasons).toEqual([]);
    expect(checked()[0].trackShapeDisagreement).toBeNull();
  });

  test('the alert names the track and the disagreement in words', async () => {
    Object.assign(process.env, { LP_HEALTH_ALERT: 'on', QUIZ_FUNNEL_WATCH_SLACK_TOKEN: 'xoxb-test', QUIZ_FUNNEL_WATCH_SLACK_CHANNEL: 'D0TEST' });
    net.axiomRows = [{ kind: 'track_ignored', code: '', source: '', n: 1 }];
    mockDb.tables.lesson_plan_requests = [...many(40, () => ff()), ...many(7, () => ask()), ...many(3, () => ask(failed({ error_code: 'RENDER_FAILED' })))];
    await Health.run({ now: NOW, redis: fakeRedis() });
    expect(net.slack).toHaveLength(1);
    const lines = net.slack[0].text.split('\n');
    expect(lines.some((l) => /gamma_standard track/.test(l) && /3 of 10 finished asks failed \(30%\)/.test(l))).toBe(true);
    expect(lines.some((l) => /Free-form track mismatch/.test(l) && /1 job/.test(l))).toBe(true);
  });
});
