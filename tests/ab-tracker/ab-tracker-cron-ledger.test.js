'use strict';
/**
 * The cron's ledger step (bd-9nb6s0.2): after a rollup that RAN (so every rollup guard held), the cron asks the ledger
 * to advance once (planned -> running -> concluded). Any other outcome skips it. The ledger never changes the exit
 * code: the run's colour on Railway stays the rollup's.
 */
const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));

const { main } = require('../../bot/scripts/ab-tracker-cron');

const deps = (outcome, ledgerOutcome = 'advanced') => ({
  run: jest.fn(async () => ({ outcome })),
  ledger: jest.fn(async () => ({ outcome: ledgerOutcome })),
  redis: { close: jest.fn(async () => {}) },
  flush: jest.fn(async () => {}),
  exit: jest.fn(),
});

describe('ab-tracker-cron ledger step', () => {
  it('advances the ledger once after a rollup that ran, before Redis closes', async () => {
    const d = deps('ran');
    await main(d);
    expect(d.ledger).toHaveBeenCalledTimes(1);
    expect(d.ledger.mock.invocationCallOrder[0]).toBeGreaterThan(d.run.mock.invocationCallOrder[0]);
    expect(d.ledger.mock.invocationCallOrder[0]).toBeLessThan(d.redis.close.mock.invocationCallOrder[0]);
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it.each(['off', 'not_due', 'skipped', 'done_already', 'partial', 'refused'])('skips the ledger when the rollup is %s', async (o) => {
    const d = deps(o);
    await main(d);
    expect(d.ledger).not.toHaveBeenCalled();
  });

  it.each(['failed', 'not_installed'])('a ledger that answers %s leaves the exit code at the rollup\'s', async (lo) => {
    const d = deps('ran', lo);
    await main(d);
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it('a ledger that throws still exits with the rollup\'s code', async () => {
    const d = deps('ran');
    d.ledger = jest.fn(async () => { throw new Error('boom'); });
    await main(d);
    expect(d.exit).toHaveBeenCalledWith(0);
  });
});
