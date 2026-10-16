'use strict';
/**
 * The lesson-plan health ALERT — a tick that is not healthy reaches a person.
 *
 * WHY. Until this, a degraded verdict was an error-level line in a log dataset no monitor reads (Axiom's
 * native monitors are a dead end here — the quiz watcher's header records why — and the quiz watcher
 * alerts by Slack DM instead). So the verdict goes out through the quiz watcher's Slack path: its
 * target, its sender and its tick claim.
 *
 * RULES PINNED.
 *   · ONE message per tick, naming every fresh reason; the same path or reason at most once in 2 h.
 *   · A quiet path that stays down is paged once per newest failure — never every 2 h for a day.
 *   · A 6-12 incident is paged once between this check and the quiz watcher, whichever sees it first.
 *   · Five lifecycle write failures in the window (counted in Axiom, in this deployment's env) are a
 *     reason; an Axiom count that fails never stops the check.
 *   · No Slack target, or LP_HEALTH_ALERT=off: nothing is sent, and the outcome says so.
 *   · A post that fails, throws or hangs is said at error level and not marked sent; the tick resolves.
 *   · Off (no LP_LIFECYCLE_PATHS): no network at all.
 * The network is mocked at fetch — Slack's chat.postMessage and Axiom's APL endpoint — and nowhere else:
 * the health check and the quiz watcher's sender, target and claim are the real ones.
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
const Watch = require('../../bot/shared/services/monitoring/quiz-funnel-watch.service');

// ── the network ───────────────────────────────────────────────────────────────

const net = {};
function resetNet() {
  Object.assign(net, {
    slack: [], axiom: [], slackReply: { ok: true, ts: '1.1' }, slackHang: false, slackThrows: false,
    axiomStatus: 200, axiomRows: [],
  });
}
function tabular(rows) {
  const fields = ['code', 'source', 'n'];
  return { tables: [{ fields: fields.map((name) => ({ name })), columns: fields.map((f) => rows.map((r) => r[f])) }] };
}
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://slack.com/api/chat.postMessage') {
      if (net.slackThrows) throw new Error('getaddrinfo ENOTFOUND slack.com');
      if (net.slackHang) return new Promise(() => {});
      net.slack.push({ headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => net.slackReply };
    }
    if (u.startsWith('https://api.axiom.co/')) {
      net.axiom.push({ headers: init.headers, body: JSON.parse(init.body) });
      if (net.axiomStatus !== 200) return { ok: false, status: net.axiomStatus, text: async () => 'Forbidden' };
      return { ok: true, status: 200, json: async () => tabular(net.axiomRows) };
    }
    throw new Error(`unexpected network call: ${u}`);
  });
});
afterAll(() => { global.fetch = realFetch; });

// ── the cache: TTLs honoured against a clock the suite moves ───────────────────

const clock = { now: 0 };
function clockRedis() {
  const store = new Map();
  const live = (k) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.until !== null && e.until <= clock.now) { store.delete(k); return null; }
    return e;
  };
  const put = (k, v, ttlS) => store.set(k, { v, until: ttlS ? clock.now + ttlS * 1000 : null });
  return {
    store,
    ttlS: (k) => { const e = live(k); return e && e.until !== null ? Math.round((e.until - clock.now) / 1000) : null; },
    isAvailable: () => true,
    setNX: jest.fn(async (k, v, ttlS) => { if (live(k)) return false; put(k, v, ttlS); return true; }),
    get: jest.fn(async (k) => { const e = live(k); return e ? e.v : null; }),
    set: jest.fn(async (k, v, ttlS) => { put(k, v, ttlS); return true; }),
  };
}

// ── the rows ──────────────────────────────────────────────────────────────────

const T0 = new Date('2026-10-14T06:00:00.000Z'); // 11:00 PKT; this tick reads the asks of 09:45–10:45 PKT
const later = (base, min) => new Date(base.getTime() + min * 60_000);
const at = (base, min) => later(base, min).toISOString();
let seq = 0;
const row = (over) => ({
  id: `r-${(seq += 1)}`, user_id: 'u', phone_number: '92300', topic: 't', source: 'niete_v8_segment', channel: 'whatsapp',
  status: 'completed', error_code: null, retry_count: 0, created_at: null, delivered_at: null, ...over,
});
const delivered = (t, over = {}) => row({ created_at: t, delivered_at: t, ...over });
const failed = (t, code, over = {}) => row({ status: 'failed', error_code: code, created_at: t, ...over });

/** 3 of 10 finished 6-12 asks failed in the window ending 15 minutes before `base`. */
const lp612Failing = (base) => [
  ...Array.from({ length: 7 }, () => delivered(at(base, -30), { source: 'niete_lp612' })),
  ...Array.from({ length: 3 }, () => failed(at(base, -30), 'DELIVERY_FAILED', { source: 'niete_lp612' })),
];
/** The 14 Oct shape: a cached serve, then a curriculum ask that failed all three attempts. */
const groundedDown = (base) => [
  delivered(at(base, -50), { source: 'niete_grounded' }),
  failed(at(base, -40), 'RENDER_FAILED', { source: 'niete_grounded', retry_count: 3 }),
];
const stuckAsk = (base) => row({ source: 'niete_grounded', status: 'pending', created_at: at(base, -(6 * 60 + 30)) });

const tick = (now, redis) => { clock.now = now.getTime(); return Health.run({ now, redis }); };
const checked = () => mockEvent.mock.calls.filter((c) => c[0] === 'lesson_plan.health.checked').map((c) => c[1]);
const alerts = () => mockEvent.mock.calls.filter((c) => c[0] === 'lesson_plan.health.alert').map((c) => c[1]);
const logsAt = (level, rx) => mockLog.mock.calls.filter((c) => c[2] === level && rx.test(String(c[0])));

// ── the env ───────────────────────────────────────────────────────────────────

const ENV = {
  LP_LIFECYCLE_PATHS: 'all', REGION: 'niete', NODE_ENV: 'test',
  QUIZ_FUNNEL_WATCH_SLACK_TOKEN: 'xoxb-test', QUIZ_FUNNEL_WATCH_SLACK_CHANNEL: 'D0TEST',
  AXIOM_TOKEN: 'axiom-test', AXIOM_DATASET: 'test-logs',
};
const KEYS = [...Object.keys(ENV), 'LP_HEALTH_ALERT', 'LP_HEALTH_CHECK', 'AXIOM_API_TOKEN', 'AXIOM_ORG_ID',
  'PROD_DIGEST_SLACK_TOKEN', 'PROD_DIGEST_SLACK_CHANNEL', 'QUIZ_FUNNEL_WATCH_THRESHOLDS'];
let savedEnv;
let redis;
beforeEach(() => {
  savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, ENV);
  resetNet();
  global.fetch.mockClear();
  mockLog.mockClear();
  mockEvent.mockClear();
  mockDb = createMemorySupabase({ lesson_plan_requests: [] });
  redis = clockRedis();
  Health.__resetForTests();
});
afterEach(() => {
  jest.useRealTimers();
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('a tick that is not healthy reaches a person', () => {
  test('ONE message per tick names every reason, sent to the quiz watcher\'s Slack target', async () => {
    mockDb.tables.lesson_plan_requests = [...lp612Failing(T0), ...groundedDown(T0), stuckAsk(T0)];
    const out = await tick(T0, redis);
    expect(out).toEqual(expect.objectContaining({ outcome: 'checked', verdict: 'degraded' }));
    expect(out.reasons).toEqual(['stuck', 'failure_rate:niete_lp612/whatsapp', 'down:niete_grounded/whatsapp']);

    expect(net.slack).toHaveLength(1);
    const { headers, body } = net.slack[0];
    expect(headers.Authorization).toBe('Bearer xoxb-test');
    expect(body.channel).toBe('D0TEST');
    const lines = body.text.split('\n');
    expect(lines[0]).toBe('⚠️ *Lesson plans — needs a look* · 11:00 PKT');
    expect(lines).toEqual(expect.arrayContaining([
      '• *Stuck* — 1 ask still waiting after 6 hours',
      '• *Grade 6-12 plans* · WhatsApp — 3 of 10 finished asks failed (30%) between 09:45 and 10:45 PKT · DELIVERY_FAILED 3',
      '• *Curriculum plans* · WhatsApp — the last 3 attempts failed and nothing was delivered in between (newest ask 10:20 PKT · RENDER_FAILED)',
    ]));
    expect(lines).toHaveLength(4);
    expect(alerts()).toEqual([expect.objectContaining({ outcome: 'sent', reasons: out.reasons })]);
  });

  test('production\'s configuration: the old digest\'s Slack settings are used when the watcher has none of its own', async () => {
    delete process.env.QUIZ_FUNNEL_WATCH_SLACK_TOKEN;
    delete process.env.QUIZ_FUNNEL_WATCH_SLACK_CHANNEL;
    process.env.PROD_DIGEST_SLACK_TOKEN = 'xoxb-digest';
    process.env.PROD_DIGEST_SLACK_CHANNEL = 'D0DIGEST';
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    await tick(T0, redis);
    expect(net.slack).toHaveLength(1);
    expect(net.slack[0].body.channel).toBe('D0DIGEST');
    expect(net.slack[0].headers.Authorization).toBe('Bearer xoxb-digest');
  });

  test('a healthy tick sends nothing and logs no alert', async () => {
    mockDb.tables.lesson_plan_requests = [delivered(at(T0, -30))];
    await expect(tick(T0, redis)).resolves.toEqual(expect.objectContaining({ verdict: 'healthy' }));
    expect(net.slack).toHaveLength(0);
    expect(alerts()).toHaveLength(0);
  });

  test('ten replicas ticking together send ONE message — the claim is the quiz watcher\'s read-back claim', async () => {
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    clock.now = T0.getTime();
    const outs = await Promise.all(Array.from({ length: 10 }, () => Health.run({ now: T0, redis })));
    expect(outs.filter((o) => o.outcome === 'checked')).toHaveLength(1);
    expect(net.slack).toHaveLength(1);
    expect(redis.ttlS('lp_health:tick')).toBe(59 * 60);
  });
});

describe('the same incident is sent once', () => {
  test('the same path at most once in two hours, however many ticks see it', async () => {
    mockDb.tables.lesson_plan_requests = [
      ...lp612Failing(T0), ...lp612Failing(later(T0, 60)), ...lp612Failing(later(T0, 120)),
    ];
    await tick(T0, redis);
    await tick(later(T0, 60), redis);
    expect(net.slack).toHaveLength(1);
    expect(alerts().map((a) => a.outcome)).toEqual(['sent', 'deduped']);
    await tick(later(T0, 120), redis);
    expect(net.slack).toHaveLength(2);
  });

  test('a quiet path that STAYS down is not paged again; a new failure on it is', async () => {
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    await tick(T0, redis);
    expect(net.slack).toHaveLength(1);
    await tick(later(T0, 180), redis); // the two-hour key is gone; the evidence is the same failure
    expect(net.slack).toHaveLength(1);
    expect(alerts().map((a) => a.outcome)).toEqual(['sent', 'deduped']);
    mockDb.tables.lesson_plan_requests.push(failed(at(T0, 170), 'RENDER_FAILED', { source: 'niete_grounded', retry_count: 3 }));
    await tick(later(T0, 240), redis);
    expect(net.slack).toHaveLength(2);
    expect(net.slack[1].body.text).toMatch(/Curriculum plans.*last 6 attempts failed.*newest ask 13:50 PKT/);
  });

  test('a 6-12 incident the quiz watcher paged in the last two hours is not paged again here', async () => {
    clock.now = later(T0, -10).getTime();
    await redis.set(Watch.ALERT_KEY({ kind: 'lp612_failed' }), '1', 7200);
    mockDb.tables.lesson_plan_requests = lp612Failing(T0);
    await tick(T0, redis);
    expect(net.slack).toHaveLength(0);
    expect(alerts()).toEqual([expect.objectContaining({ outcome: 'deduped', alreadyReported: ['failure_rate:niete_lp612/whatsapp'] })]);
  });

  test('a 6-12 incident paged here is not paged again by the quiz watcher', async () => {
    mockDb.tables.lesson_plan_requests = lp612Failing(T0);
    await tick(T0, redis);
    expect(net.slack).toHaveLength(1);
    expect(redis.ttlS(Watch.ALERT_KEY({ kind: 'lp612_failed' }))).toBe(2 * 3600);

    // The quiz watcher's next tick, overnight (no summary due), sees 4 failed 6-12 deliveries in its hour.
    const counters = [{ k: 'lp612_failed', c60: 4, c75: 4, lag: 0, c120: 4, f60: 0 }];
    const query = jest.fn(async (name) => (name === 'counters' ? counters : []));
    const watcherTick = (r) => Watch.run({
      now: new Date('2026-10-13T21:30:00.000Z'), // 02:30 PKT
      env: { QUIZ_FUNNEL_WATCH_ENABLED: 'true', QUIZ_FUNNEL_WATCH_SLACK_TOKEN: 'x', QUIZ_FUNNEL_WATCH_SLACK_CHANNEL: 'D1', AXIOM_TOKEN: 'a' },
      redis: r, query, confirm: null, post: jest.fn(async () => 'ts'),
    });
    const control = await watcherTick(clockRedis()); // a cache this check never wrote: the watcher pages it
    expect(control).toEqual({ summary: false, alerts: 1 });
    await expect(watcherTick(redis)).resolves.toEqual({ summary: false, alerts: 0 });
  });
});

describe('lifecycle write failures', () => {
  test('five in the window are a reason, counted in Axiom in this deployment\'s env and window', async () => {
    net.axiomRows = [{ code: 'PGRST204', source: 'niete_lp612', n: 4 }, { code: '23514', source: 'niete_grounded', n: 1 }];
    mockDb.tables.lesson_plan_requests = [delivered(at(T0, -30))];
    const out = await tick(T0, redis);
    expect(out.reasons).toEqual(['write_failed']);
    expect(checked()[0].writeFailures).toEqual({ count: 5, codes: { PGRST204: 4, 23514: 1 } });
    expect(net.axiom).toHaveLength(1);
    const q = net.axiom[0].body;
    expect(q.apl).toMatch(/^\['test-logs'\] \| where env == 'test' \| where msg == 'lesson_plan\.lifecycle\.write_failed'/);
    expect(q.startTime).toBe(at(T0, -75));
    expect(q.endTime).toBe(at(T0, -15));
    expect(net.axiom[0].headers.Authorization).toBe('Bearer axiom-test');
    expect(net.slack[0].body.text.split('\n')).toContain('• *Lifecycle record* — 5 writes failed between 09:45 and 10:45 PKT · PGRST204 4, 23514 1');
  });

  test('four are in the event, not a verdict', async () => {
    net.axiomRows = [{ code: 'PGRST204', source: 'niete_lp612', n: 4 }];
    mockDb.tables.lesson_plan_requests = [delivered(at(T0, -30))];
    const out = await tick(T0, redis);
    expect(out.verdict).toBe('healthy');
    expect(checked()[0].writeFailures).toEqual({ count: 4, codes: { PGRST204: 4 } });
    expect(net.slack).toHaveLength(0);
  });

  test('an Axiom count that fails never stops the check: the summary goes out without it, said at warn level', async () => {
    net.axiomStatus = 403;
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    const out = await tick(T0, redis);
    expect(out).toEqual(expect.objectContaining({ outcome: 'checked', reasons: ['down:niete_grounded/whatsapp'] }));
    expect(checked()[0].writeFailures).toBeNull();
    expect(logsAt('warn', /write failures/i)).toHaveLength(1);
    expect(net.slack).toHaveLength(1);
  });

  test('no Axiom token: no query, and the check goes on', async () => {
    delete process.env.AXIOM_TOKEN;
    mockDb.tables.lesson_plan_requests = [delivered(at(T0, -30))];
    await expect(tick(T0, redis)).resolves.toEqual(expect.objectContaining({ outcome: 'checked', verdict: 'healthy' }));
    expect(net.axiom).toHaveLength(0);
    expect(checked()[0].writeFailures).toBeNull();
  });
});

describe('when nobody can be told, and when the post fails', () => {
  test('no Slack target: nothing is sent, the outcome says unwired, said ONCE at warn level', async () => {
    delete process.env.QUIZ_FUNNEL_WATCH_SLACK_TOKEN;
    delete process.env.QUIZ_FUNNEL_WATCH_SLACK_CHANNEL;
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    await tick(T0, redis);
    await tick(later(T0, 60), redis);
    expect(net.slack).toHaveLength(0);
    expect(alerts().map((a) => a.outcome)).toEqual(['unwired', 'unwired']);
    expect(logsAt('warn', /Slack/)).toHaveLength(1);
  });

  test('LP_HEALTH_ALERT=off: the check runs, nothing is sent, the outcome says off', async () => {
    process.env.LP_HEALTH_ALERT = 'off';
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    await tick(T0, redis);
    expect(checked()).toHaveLength(1);
    expect(net.slack).toHaveLength(0);
    expect(alerts()).toEqual([expect.objectContaining({ outcome: 'off' })]);
  });

  test('a post Slack refuses is said at error level and NOT marked sent — the next tick sends it', async () => {
    net.slackReply = { ok: false, error: 'channel_not_found' };
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    await expect(tick(T0, redis)).resolves.toEqual(expect.objectContaining({ outcome: 'checked' }));
    expect(logsAt('error', /Slack/)).toHaveLength(1);
    net.slackReply = { ok: true, ts: '2.2' };
    await tick(later(T0, 60), redis);
    expect(alerts().map((a) => a.outcome)).toEqual(['failed', 'sent']);
  });

  test('a post that throws (no network) resolves the tick', async () => {
    net.slackThrows = true;
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    await expect(tick(T0, redis)).resolves.toEqual(expect.objectContaining({ outcome: 'checked' }));
    expect(alerts()).toEqual([expect.objectContaining({ outcome: 'failed' })]);
  });

  test('a post that hangs is abandoned after 15 seconds, and the tick resolves', async () => {
    jest.useFakeTimers({ now: T0 });
    net.slackHang = true;
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    const p = tick(T0, redis);
    await jest.advanceTimersByTimeAsync(15_000);
    await expect(p).resolves.toEqual(expect.objectContaining({ outcome: 'checked' }));
    expect(alerts()).toEqual([expect.objectContaining({ outcome: 'failed' })]);
    expect(logsAt('error', /Slack/)).toHaveLength(1);
  });

  test('switched off (no LP_LIFECYCLE_PATHS): no network at all', async () => {
    delete process.env.LP_LIFECYCLE_PATHS;
    mockDb.tables.lesson_plan_requests = groundedDown(T0);
    await expect(tick(T0, redis)).resolves.toEqual({ outcome: 'off' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
