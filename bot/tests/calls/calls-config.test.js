/**
 * P0.4 (bd-1hae7.4) — the flag and the runtime config.
 *
 * The flag convention here is the repo's live one — `=== 'true'`, as
 * LP_FIDELITY_ENABLED does — NOT a presence gate. That matters: a leftover
 * `CALLS_ENABLED=false` in a Railway env must keep calls OFF, and under a
 * presence gate it would silently turn them ON.
 *
 * Defaults are asserted because they are the operator's decisions in code form:
 * mini for v1, 5 concurrent, 5-minute cap with a 4:30 wrap-up, $150/week,
 * 3 calls per caller per day.
 */

describe('calls-config', () => {
  const KEYS = [
    'CALLS_ENABLED', 'OPENAI_REALTIME_MODEL', 'OPENAI_REALTIME_VOICE', 'CALLS_VAD',
    'CALLS_MAX_CONCURRENT', 'CALLS_MAX_SECONDS', 'CALLS_WRAPUP_SECONDS',
    'CALLS_WEEKLY_BUDGET_USD', 'CALLS_PER_CALLER_DAILY', 'CALLS_FORWARD_SECRET',
    'CALLS_SERVICE_URL', 'CALLS_DRAIN_GRACE_MS', 'CALLS_SILENCE_TIMEOUT_MS',
  ];
  let saved;

  beforeEach(() => {
    saved = {};
    KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    jest.resetModules();
  });

  afterEach(() => {
    KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  const load = () => require('../../shared/calls/calls-config');

  describe('the flag', () => {
    test('is OFF when unset — the feature ships dark', () => {
      expect(load().isCallsEnabled()).toBe(false);
    });

    test('is ON only for the literal string "true"', () => {
      process.env.CALLS_ENABLED = 'true';
      expect(load().isCallsEnabled()).toBe(true);
    });

    test('a leftover "false" keeps calls OFF (the presence-gate trap)', () => {
      process.env.CALLS_ENABLED = 'false';
      expect(load().isCallsEnabled()).toBe(false);
    });

    test('"1" and "yes" do NOT enable it — one unambiguous spelling', () => {
      process.env.CALLS_ENABLED = '1';
      expect(load().isCallsEnabled()).toBe(false);
      jest.resetModules();
      process.env.CALLS_ENABLED = 'yes';
      expect(load().isCallsEnabled()).toBe(false);
    });

    test('is read live, so a restart is all it takes to flip it', () => {
      const cfg = load();
      expect(cfg.isCallsEnabled()).toBe(false);
      process.env.CALLS_ENABLED = 'true';
      expect(cfg.isCallsEnabled()).toBe(true);
    });
  });

  describe('the defaults (the operator decisions, in code)', () => {
    test('model is mini for v1', () => {
      expect(load().getCallsConfig().model).toBe('gpt-realtime-2.1-mini');
    });

    test('caps: 5 concurrent, 300s hard, 270s wrap-up, $150/week, 3 per caller per day', () => {
      const c = load().getCallsConfig();
      expect(c.maxConcurrent).toBe(5);
      expect(c.maxSeconds).toBe(300);
      expect(c.wrapUpSeconds).toBe(270);
      expect(c.weeklyBudgetUsd).toBe(150);
      expect(c.perCallerDaily).toBe(3);
    });

    test('server_vad by default (snappy, interruptible — Noor tuning)', () => {
      expect(load().getCallsConfig().vad).toBe('server_vad');
    });

    // Noisy classrooms were the reason semantic_vad was the original default.
    // The way back must stay one env var wide.
    test('CALLS_VAD=semantic_vad still switches back for noisy callers', () => {
      process.env.CALLS_VAD = 'semantic_vad';
      expect(load().getCallsConfig().vad).toBe('semantic_vad');
    });
  });

  describe('overrides', () => {
    test('every numeric cap is env-tunable — raising concurrency is config, not code', () => {
      process.env.CALLS_MAX_CONCURRENT = '12';
      process.env.CALLS_MAX_SECONDS = '600';
      process.env.CALLS_WEEKLY_BUDGET_USD = '400';
      process.env.CALLS_PER_CALLER_DAILY = '10';
      const c = load().getCallsConfig();
      expect(c.maxConcurrent).toBe(12);
      expect(c.maxSeconds).toBe(600);
      expect(c.weeklyBudgetUsd).toBe(400);
      expect(c.perCallerDaily).toBe(10);
    });

    test('the model escalation to 2.1 is one env var', () => {
      process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime-2.1';
      expect(load().getCallsConfig().model).toBe('gpt-realtime-2.1');
    });

    test('garbage numerics fall back to the default rather than NaN', () => {
      process.env.CALLS_MAX_CONCURRENT = 'lots';
      process.env.CALLS_MAX_SECONDS = '';
      const c = load().getCallsConfig();
      expect(c.maxConcurrent).toBe(5);
      expect(c.maxSeconds).toBe(300);
    });

    test('a wrap-up at or past the hard cap is clamped below it', () => {
      process.env.CALLS_MAX_SECONDS = '300';
      process.env.CALLS_WRAPUP_SECONDS = '400';
      const c = load().getCallsConfig();
      expect(c.wrapUpSeconds).toBeLessThan(c.maxSeconds);
    });

    test('a non-positive concurrency is refused (0 would mean a dead line)', () => {
      process.env.CALLS_MAX_CONCURRENT = '0';
      expect(load().getCallsConfig().maxConcurrent).toBe(5);
    });
  });

  describe('the bot↔calls forward secret', () => {
    test('absent by default — callers of it must fail closed', () => {
      expect(load().getCallsConfig().forwardSecret).toBe('');
    });

    test('is read from the env when set', () => {
      process.env.CALLS_FORWARD_SECRET = 's3cret';
      expect(load().getCallsConfig().forwardSecret).toBe('s3cret');
    });
  });
});
