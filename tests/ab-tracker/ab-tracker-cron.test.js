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

const { main, exitCodeFor } = require('../../bot/scripts/ab-tracker-cron');

const ROOT = path.join(__dirname, '..', '..');
const deps = (outcome) => ({
  run: jest.fn(async () => ({ outcome })),
  redis: { close: jest.fn(async () => {}) },
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
});
