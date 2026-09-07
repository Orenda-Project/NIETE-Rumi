'use strict';
/**
 * The hourly production failure digest (bd-mg9c7.147).
 *
 * Operator, 2026-09-07: "arm a watcher … that keeps bringing me failure data
 * from prod to my slack channel, should work even when pc is off … 6-12 LP
 * delivery failures, quiz delivery failures, any failures in coaching pipeline."
 *
 * The rule this file exists to hold: a digest that cries wolf gets muted, and a
 * muted digest is worse than none. So it reports at the SURFACE — did a teacher
 * get their lesson plan, did a class get their quiz, did a coaching report
 * arrive — and stays silent when every family is clean.
 *
 * The specific trap: `lp612.render.failed` fires ~329 times a day against ~123
 * completions, which reads as a 73% failure rate and is nothing of the kind.
 * Those are the author's own quality gate rejecting a draft mid-loop, which then
 * triggers a revision round. It must never reach the digest.
 */
const D = require('../../bot/shared/services/monitoring/prod-failure-digest.service');

const clean = {
  lp: { delivered: 40, failed: 0, degraded: 0, overCap: 12 },
  quiz: { accepted: 20, sent: 20, failed: 0, childSendFailed: 0, mediaNotDelivered: 0 },
  coaching: { analysisStarted: 30, analysisCompleted: 30, reportsSent: 28, errors: 0, observeDelivered: 5, observeDegraded: 0 },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('1 · silent when nothing is wrong', () => {
  test('a clean hour produces no message at all', () => {
    expect(D.buildDigest(clean).report).toBe(false);
  });
  test('over-cap alone is not a failure — the lesson plan still arrived', () => {
    const c = clone(clean); c.lp.overCap = 78;
    expect(D.buildDigest(c).report).toBe(false);
  });
  test('an hour with no traffic at all is silence, not an alarm', () => {
    const empty = { lp: {}, quiz: {}, coaching: {} };
    expect(D.buildDigest(empty).report).toBe(false);
  });
});

describe('2 · it speaks up for each of the three families', () => {
  test('a lesson plan that failed to deliver', () => {
    const c = clone(clean); c.lp.failed = 2;
    const out = D.buildDigest(c);
    expect(out.report).toBe(true);
    expect(out.text).toMatch(/lesson plan/i);
    expect(out.text).toMatch(/2/);
  });
  test('a quiz that failed to author', () => {
    const c = clone(clean); c.quiz.failed = 3; c.quiz.sent = 17;
    const out = D.buildDigest(c);
    expect(out.report).toBe(true);
    expect(out.text).toMatch(/quiz/i);
  });
  test('a child who could not be sent their question list', () => {
    const c = clone(clean); c.quiz.childSendFailed = 4;
    expect(D.buildDigest(c).report).toBe(true);
  });
  test('a coaching analysis that errored', () => {
    const c = clone(clean); c.coaching.errors = 1;
    const out = D.buildDigest(c);
    expect(out.report).toBe(true);
    expect(out.text).toMatch(/coaching/i);
  });
  test('coaching analyses that started and never completed', () => {
    const c = clone(clean); c.coaching.analysisCompleted = 20;   // 10 of 30 lost
    expect(D.buildDigest(c).report).toBe(true);
  });
  test('a small shortfall is noise, not a report', () => {
    const c = clone(clean); c.coaching.analysisCompleted = 29;   // 1 of 30, still in flight
    expect(D.buildDigest(c).report).toBe(false);
  });
});

describe('3 · the render-gate trap', () => {
  test('render churn is not a delivery failure and cannot reach the digest', () => {
    const c = clone(clean);
    c.lp.renderFailed = 329;                     // the number that looks like a crisis
    const out = D.buildDigest(c);
    expect(out.report).toBe(false);
    expect(D.SURFACE_ONLY).toContain('lp612.render.failed');
  });
});

describe('4 · the message itself', () => {
  test('it leads with what a person should do, and carries no phone numbers', () => {
    const c = clone(clean);
    c.lp.failed = 2; c.quiz.failed = 1; c.coaching.errors = 3;
    const { text } = D.buildDigest(c);
    expect(text).toMatch(/^[^\n]{10,140}\n/);            // a headline line, then detail
    expect(text).not.toMatch(/\b92\d{9,}\b/);            // never a teacher's number
    expect(text).toMatch(/lesson plan/i);
    expect(text).toMatch(/quiz/i);
    expect(text).toMatch(/coaching/i);
  });
  test('a clean family is left out rather than padded with a zero', () => {
    const c = clone(clean); c.quiz.failed = 2;
    const { text } = D.buildDigest(c);
    expect(text).toMatch(/quiz/i);
    expect(text).not.toMatch(/lesson plan/i);
  });
});

describe('5 · the queries it runs are production-scoped', () => {
  test('every query filters to production, or staging noise would page the operator', () => {
    const qs = D.QUERIES.map((q) => q.apl);
    expect(qs.length).toBeGreaterThan(0);
    qs.forEach((apl) => expect(apl).toMatch(/env == 'production'/));
  });
  test('each query names the counter it fills', () => {
    D.QUERIES.forEach((q) => {
      expect(typeof q.family).toBe('string');
      expect(typeof q.key).toBe('string');
    });
  });
});

describe('6 · it is a no-op until it is configured', () => {
  const KEYS = ['PROD_DIGEST_ENABLED', 'PROD_DIGEST_SLACK_TOKEN', 'PROD_DIGEST_SLACK_CHANNEL'];
  let saved;
  beforeEach(() => {
    saved = {};
    KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  });
  afterEach(() => KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }));

  test('with nothing set, run() does nothing and says why', async () => {
    await expect(D.run()).resolves.toMatchObject({ skipped: 'disabled' });
  });
  test('enabled but with no destination is still a no-op, not a crash', async () => {
    process.env.PROD_DIGEST_ENABLED = 'true';
    await expect(D.run()).resolves.toMatchObject({ skipped: 'unconfigured' });
  });
});

describe('7 · a redeploy must not silence it, nor make it repeat itself', () => {
  test('the guards are stated, not implied', () => {
    expect(D.MIN_GAP_MIN).toBe(45);
    expect(D.MAX_WINDOW_MIN).toBe(180);
  });
  test('the window never opens wider than the cap, however long the outage', () => {
    expect(D.MAX_WINDOW_MIN).toBeLessThanOrEqual(180);
    expect(D.MIN_GAP_MIN).toBeLessThan(D.MAX_WINDOW_MIN);
  });
  test('a run too soon after the last one is skipped rather than repeated', async () => {
    const saved = { ...process.env };
    process.env.PROD_DIGEST_ENABLED = 'true';
    process.env.PROD_DIGEST_SLACK_TOKEN = 'x';
    process.env.PROD_DIGEST_SLACK_CHANNEL = 'D1';
    process.env.AXIOM_API_TOKEN = 'x';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ buckets: { totals: [{ aggregations: [{ value: new Date().toISOString() }] }] } }),
    });
    try {
      const out = await D.run();
      expect(out.skipped).toBe('too_soon');
    } finally {
      globalThis.fetch = realFetch;
      Object.keys(process.env).forEach((k) => { if (!(k in saved)) delete process.env[k]; });
      Object.assign(process.env, saved);
    }
  });
});

describe('8 · exactly one replica speaks', () => {
  /**
   * The first live run posted the SAME digest SIX times inside 500ms — once per
   * worker replica. The 45-minute gap guard could not help: it asks Axiom when
   * the digest last spoke, and six replicas booting together all asked before
   * any of them had answered. A time-based guard cannot settle a tie between
   * processes; only a lock can.
   */
  const KEYS = ['PROD_DIGEST_ENABLED', 'PROD_DIGEST_SLACK_TOKEN', 'PROD_DIGEST_SLACK_CHANNEL', 'AXIOM_API_TOKEN'];
  let saved, realFetch;
  beforeEach(() => {
    saved = {};
    KEYS.forEach((k) => { saved[k] = process.env[k]; });
    process.env.PROD_DIGEST_ENABLED = 'true';
    process.env.PROD_DIGEST_SLACK_TOKEN = 'x';
    process.env.PROD_DIGEST_SLACK_CHANNEL = 'D1';
    process.env.AXIOM_API_TOKEN = 'x';
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    jest.resetModules();
  });

  test('a replica that does not win the tick sends nothing', async () => {
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      setNX: jest.fn().mockResolvedValue(false),      // someone else got there first
    }));
    globalThis.fetch = jest.fn();                      // must never be called
    const Fresh = require('../../bot/shared/services/monitoring/prod-failure-digest.service');
    const out = await Fresh.run();
    expect(out.skipped).toBe('another_replica');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('the winner holds the tick for the whole gap, so nobody repeats it', async () => {
    const setNX = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ setNX }));
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ buckets: { totals: [] } }),
    });
    const Fresh = require('../../bot/shared/services/monitoring/prod-failure-digest.service');
    await Fresh.run();
    expect(setNX).toHaveBeenCalledTimes(1);
    const [key, , ttl] = setNX.mock.calls[0];
    expect(key).toMatch(/digest/);
    expect(ttl).toBe(Fresh.MIN_GAP_MIN * 60);
  });

  test('if the lock cannot be reached the digest still runs — quiet beats blind', async () => {
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      setNX: jest.fn().mockRejectedValue(new Error('redis down')),
    }));
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ buckets: { totals: [] } }),
    });
    const Fresh = require('../../bot/shared/services/monitoring/prod-failure-digest.service');
    const out = await Fresh.run();
    expect(out.skipped).toBeUndefined();
  });
});

describe('9 · a quiet minute leaves a trace', () => {
  /**
   * After the lock shipped, the digest correctly stayed quiet — and logged
   * nothing at all, so "it skipped correctly" and "it never ran" looked
   * identical from outside. For a monitor that is the dangerous ambiguity: a
   * silence you cannot audit is a silence you should not trust.
   */
  test('a losing replica says so, so its silence can be audited', async () => {
    jest.resetModules();
    const logEvent = jest.fn();
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      setNX: jest.fn().mockResolvedValue(false),
    }));
    const saved = { ...process.env };
    Object.assign(process.env, {
      PROD_DIGEST_ENABLED: 'true', PROD_DIGEST_SLACK_TOKEN: 'x',
      PROD_DIGEST_SLACK_CHANNEL: 'D1', AXIOM_API_TOKEN: 'x',
    });
    try {
      const Fresh = require('../../bot/shared/services/monitoring/prod-failure-digest.service');
      await Fresh.run();
      expect(logEvent).toHaveBeenCalledWith('prod_digest.skipped',
        expect.objectContaining({ why: 'another_replica' }));
    } finally {
      Object.keys(process.env).forEach((k) => { if (!(k in saved)) delete process.env[k]; });
      Object.assign(process.env, saved);
      jest.resetModules();
    }
  });
});
