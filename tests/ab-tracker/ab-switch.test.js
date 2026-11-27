'use strict';
/**
 * The switch (bd-9nb6s0.6): when the ledger concludes a test, ab_ledger_switch (V1.10.13) writes the winner to the
 * test's switch_key in app_settings (or records a pending flip), and ab-assign serves that winner to every unit.
 * Covers: the ledger service's flip(), the tracker cron's switch step, and ab-assign's winner, readSwitch, assignArmLive.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));

const { flip } = require('../../bot/shared/services/ab-tracker/ab-ledger.service');
const { main } = require('../../bot/scripts/ab-tracker-cron');
const ab = require('../../bot/shared/services/ab-assign.service');

const db = (result) => ({ rpc: jest.fn(async () => result) });

describe('ab-ledger flip', () => {
  beforeEach(() => mockLogToFile.mockClear());

  it('calls ab_ledger_switch once and returns its counts', async () => {
    const d = db({ data: { flipped: 0, pending: 1, auto: false }, error: null });
    expect(await flip({ writer: () => d })).toEqual({ outcome: 'switched', flipped: 0, pending: 1, auto: false });
    expect(d.rpc).toHaveBeenCalledTimes(1);
    expect(d.rpc).toHaveBeenCalledWith('ab_ledger_switch');
  });

  it('a database without V1.10.13 answers not_installed', async () => {
    expect(await flip({ writer: () => db({ data: null, error: { code: '42883', message: 'no fn' } }) }))
      .toEqual({ outcome: 'not_installed' });
  });

  it('errors and throws answer failed, never throw', async () => {
    expect(await flip({ writer: () => db({ data: null, error: { code: '57014', message: 'timeout' } }) }))
      .toEqual({ outcome: 'failed', error: 'timeout' });
    expect(await flip({ writer: () => { throw new Error('no client'); } })).toEqual({ outcome: 'failed', error: 'no client' });
  });
});

describe('ab-tracker-cron switch step', () => {
  const deps = (outcome) => ({
    run: jest.fn(async () => ({ outcome })),
    ledger: jest.fn(async () => ({ outcome: 'advanced' })),
    switcher: jest.fn(async () => ({ outcome: 'switched' })),
    redis: { close: jest.fn(async () => {}) },
    flush: jest.fn(async () => {}),
    exit: jest.fn(),
  });

  it('flips after the ledger advances, before Redis closes', async () => {
    const d = deps('ran');
    await main(d);
    expect(d.switcher).toHaveBeenCalledTimes(1);
    expect(d.switcher.mock.invocationCallOrder[0]).toBeGreaterThan(d.ledger.mock.invocationCallOrder[0]);
    expect(d.switcher.mock.invocationCallOrder[0]).toBeLessThan(d.redis.close.mock.invocationCallOrder[0]);
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it.each(['off', 'not_due', 'refused'])('skips the switch when the rollup is %s', async (o) => {
    const d = deps(o);
    await main(d);
    expect(d.switcher).not.toHaveBeenCalled();
  });

  it('a switch that throws leaves the exit code at the rollup\'s', async () => {
    const d = deps('ran');
    d.switcher = jest.fn(async () => { throw new Error('boom'); });
    await main(d);
    expect(d.exit).toHaveBeenCalledWith(0);
  });
});

describe('ab-assign serves the winner once the switch is flipped', () => {
  const SHA = 'a'.repeat(64);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-sw-'));
  fs.mkdirSync(path.join(repo, 'ab'));
  fs.writeFileSync(path.join(repo, 'ab', 'registry.json'),
    JSON.stringify({ tests: [{ test_id: 'ict-x', flag_key: 'ab_x', card_sha256: SHA }] }));
  const TEST = { flagKey: 'ab_x', salt: 'ict-x:school', sharesBp: { a: 5000, b: 5000 }, controlArm: 'a' };
  const opts = { repoRoot: repo, log: () => {} };
  const units = Array.from({ length: 40 }, (_, i) => `u${i}`);
  beforeEach(() => ab._resetCache());

  test('without a switch the split serves both arms', () => {
    const arms = new Set(units.map((u) => ab.assignArm({ ...TEST, unitId: u }, opts)));
    expect([...arms].sort()).toEqual(['a', 'b']);
  });

  test('{winner: b} serves b to every unit; {winner: a} serves a', () => {
    for (const w of ['a', 'b']) {
      for (const u of units) expect(ab.assignArm({ ...TEST, unitId: u, switch: { winner: w } }, opts)).toBe(w);
    }
  });

  test('a winner that is not an arm, or a non-object switch, leaves the split alone', () => {
    for (const sw of [{ winner: 'z' }, true, 'b', null, { winner: 3 }]) {
      const arms = new Set(units.map((u) => ab.assignArm({ ...TEST, unitId: u, switch: sw }, opts)));
      expect(arms.size).toBe(2);
    }
  });

  test('G1 still holds: an unregistered flag serves control even with a winner', () => {
    expect(ab.assignArm({ ...TEST, flagKey: 'ab_other', unitId: 'u1', switch: { winner: 'b' } }, opts)).toBe('a');
  });

  test('readSwitch reads the key once per ttl and fails safe to null', async () => {
    const reader = jest.fn(async () => ({ winner: 'b' }));
    let t = 1000;
    const o = { reader, ttlMs: 60000, now: () => t };
    expect(await ab.readSwitch('ab_x', o)).toEqual({ winner: 'b' });
    expect(await ab.readSwitch('ab_x', o)).toEqual({ winner: 'b' });
    expect(reader).toHaveBeenCalledTimes(1);
    t += 60001;
    await ab.readSwitch('ab_x', o);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(await ab.readSwitch('ab_y', { reader: async () => { throw new Error('down'); }, now: () => t })).toBeNull();
  });

  test('assignArmLive reads the switch_key and serves the winner', async () => {
    const reader = jest.fn(async (key) => (key === 'ab_x' ? { winner: 'b' } : null));
    for (const u of units.slice(0, 10)) {
      expect(await ab.assignArmLive({ ...TEST, unitId: u }, { ...opts, reader })).toBe('b');
    }
    expect(reader).toHaveBeenCalledWith('ab_x');
  });
});
