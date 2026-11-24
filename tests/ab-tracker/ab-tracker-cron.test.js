'use strict';
/**
 * The A/B tracker's nightly rollup gets its own Railway project, the way RDF has one (Amena, 23 Nov 2026;
 * bd-3kshar.6.5). Railway's cron starts bot/scripts/ab-tracker-cron.js every 15 minutes
 * (the rollup runs once per slot: 15 min in school hours, 2 h outside); the script runs the rollup once, closes Redis and exits. A refused, partial or failed run exits 1
 * so Railway shows the run red; every quiet outcome (off, not due, done already) exits 0.
 */
const fs = require('fs');
const path = require('path');

const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));

const { main, exitCodeFor, flushLogs } = require('../../bot/scripts/ab-tracker-cron');

const ROOT = path.join(__dirname, '..', '..');
const deps = (outcome) => ({
  run: jest.fn(async () => ({ outcome })),
  redis: { close: jest.fn(async () => {}) },
  flush: jest.fn(async () => {}),
  exit: jest.fn(),
});

describe('ab-tracker-cron entry point', () => {
  beforeEach(() => mockLogToFile.mockClear());

  it.each(['ran', 'off', 'not_due', 'skipped', 'done_already'])('%s exits 0', (o) => {
    expect(exitCodeFor({ outcome: o })).toBe(0);
  });

  it.each(['partial', 'refused', 'error'])('%s exits 1 so Railway shows the run red', (o) => {
    expect(exitCodeFor({ outcome: o })).toBe(1);
  });

  it('skipped because Redis is unavailable exits 1: with no Redis the claim never succeeds, so the job never runs', () => {
    expect(exitCodeFor({ outcome: 'skipped', reason: 'unavailable' })).toBe(1);
  });

  it('skipped because another process holds the tick exits 0', () => {
    expect(exitCodeFor({ outcome: 'skipped', reason: 'other' })).toBe(0);
  });

  it('an empty result exits 1', () => {
    expect(exitCodeFor(undefined)).toBe(1);
  });

  it('runs the rollup once, closes Redis, then exits with the outcome code', async () => {
    const d = deps('ran');
    await main(d);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.redis.close).toHaveBeenCalledTimes(1);
    expect(d.exit).toHaveBeenCalledWith(0);
    expect(d.redis.close.mock.invocationCallOrder[0]).toBeLessThan(d.exit.mock.invocationCallOrder[0]);
  });

  it('a Redis close that throws still exits with the outcome code', async () => {
    const d = deps('partial');
    d.redis.close = jest.fn(async () => { throw new Error('gone'); });
    await main(d);
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('a run that throws exits 1 and never leaves the process hanging', async () => {
    const d = deps('ran');
    d.run = jest.fn(async () => { throw new Error('boom'); });
    await main(d);
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('logs the outcome and never a unit id', async () => {
    const d = deps('ran');
    await main(d);
    const logged = JSON.stringify(mockLogToFile.mock.calls);
    expect(logged).toMatch(/ran/);
  });

  // bd-3kshar.20: structured-logger buffers lines and sends them on a 5 s timer or on beforeExit. process.exit() skips
  // beforeExit, so before this fix not one cron line reached niete-logs and a failed run could not be alerted on.
  it('sends the buffered log lines to Axiom before it exits', async () => {
    const d = deps('refused');
    await main(d);
    expect(d.flush).toHaveBeenCalledTimes(1);
    expect(d.flush.mock.invocationCallOrder[0]).toBeLessThan(d.exit.mock.invocationCallOrder[0]);
    expect(mockLogToFile.mock.invocationCallOrder.at(-1)).toBeLessThan(d.flush.mock.invocationCallOrder[0]);
  });

  it('a flush that throws still exits with the outcome code', async () => {
    const d = deps('ran');
    d.flush = jest.fn(async () => { throw new Error('axiom down'); });
    await main(d);
    expect(d.exit).toHaveBeenCalledWith(0);
  });
});

describe('flushLogs', () => {
  it('starts a flush and waits until the ingest request is done', async () => {
    const b = { isFlushing: false, flush: jest.fn(function () { this.isFlushing = true; setTimeout(() => { this.isFlushing = false; }, 30); }) };
    const t0 = Date.now();
    await flushLogs({ batcher: b, timeoutMs: 2000, stepMs: 5 });
    expect(b.flush).toHaveBeenCalledTimes(1);
    expect(b.isFlushing).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });

  it('gives up at the cap, so a hung Axiom never holds the cron open', async () => {
    const b = { isFlushing: true, flush: jest.fn() };
    const t0 = Date.now();
    await flushLogs({ batcher: b, timeoutMs: 50, stepMs: 5 });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('does nothing when Axiom is not configured', async () => {
    await expect(flushLogs({ batcher: undefined })).resolves.toBeUndefined();
  });
});

describe('railway.ab-tracker-cron.json (config as code for the cron service)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'railway.ab-tracker-cron.json'), 'utf8'));

  it('fires every 15 minutes; the rollup itself decides the slot (15 min in school hours, 2 h outside)', () => {
    expect(cfg.deploy.cronSchedule).toBe('*/15 * * * *');
  });

  it('starts the entry point, and that file exists', () => {
    expect(cfg.deploy.startCommand).toBe('node bot/scripts/ab-tracker-cron.js');
    expect(fs.existsSync(path.join(ROOT, 'bot/scripts/ab-tracker-cron.js'))).toBe(true);
  });

  it('never restarts: a cron run that ends is done until the next night', () => {
    expect(cfg.deploy.restartPolicyType).toBe('NEVER');
  });

  // 23 Nov 2026: the root install has no pino, so the first runs died on MODULE_NOT_FOUND until this was set by hand
  // in the dashboard (bd-3kshar.6.5.3). Kept here so a reset service still installs the bot's own dependencies.
  it('installs the bot package, where the entry point and its dependencies (pino) live', () => {
    expect(cfg.build.buildCommand).toBe('npm ci --prefix bot --omit=dev');
    const botPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'bot/package.json'), 'utf8'));
    expect(botPkg.dependencies.pino).toBeDefined();
  });
});
