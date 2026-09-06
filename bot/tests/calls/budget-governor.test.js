/**
 * P0.5 (bd-1hae7.16) — the budget governor.
 *
 * The operator's caps, enforced in code rather than trusted to good behaviour:
 * **$150/week**, **3 calls per caller per day**, and an **80% alarm**. This is
 * the gate the engine consults before it answers anything, and it is the reason
 * a bug or an abusive caller costs a bounded amount of money.
 *
 * The load-bearing property is that it **fails CLOSED**: if the ledger cannot be
 * read we decline the call. An ungoverned call is exactly the thing the cap
 * exists to prevent, so "we couldn't check" must never mean "go ahead".
 */

const { createBudgetGovernor, estimateCallCost, weekStartPkt } = require('../../shared/calls/budget-governor');

const ledger = (over = {}) => ({
  weeklySpendUsd: async () => 0,
  callsToday: async () => 0,
  onAlarm: jest.fn(async () => {}),
  ...over,
});

const governor = (over = {}, config = {}) => createBudgetGovernor({
  ledger: ledger(over),
  config: { weeklyBudgetUsd: 150, perCallerDaily: 3, alarmAtFraction: 0.8, ...config },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
});

describe('budget governor — the weekly cap', () => {
  test('admits a call when spend is well under the cap', async () => {
    const g = governor({ weeklySpendUsd: async () => 12.5 });
    await expect(g.check({ from: '92300' })).resolves.toEqual(expect.objectContaining({ allowed: true }));
  });

  test('declines once the cap is reached', async () => {
    const g = governor({ weeklySpendUsd: async () => 150 });
    const v = await g.check({ from: '92300' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('weekly_budget');
  });

  test('declines past the cap too', async () => {
    const g = governor({ weeklySpendUsd: async () => 151.2 });
    expect((await g.check({ from: '92300' })).allowed).toBe(false);
  });

  test('the cap is configurable without a code change', async () => {
    const g = governor({ weeklySpendUsd: async () => 200 }, { weeklyBudgetUsd: 400 });
    expect((await g.check({ from: '92300' })).allowed).toBe(true);
  });
});

describe('budget governor — the 80% alarm', () => {
  test('fires once when spend crosses 80% of the cap', async () => {
    const onAlarm = jest.fn(async () => {});
    const g = governor({ weeklySpendUsd: async () => 121, onAlarm });
    await g.check({ from: '92300' });
    expect(onAlarm).toHaveBeenCalledWith(expect.objectContaining({
      spendUsd: 121, budgetUsd: 150,
    }));
  });

  test('does not fire below the threshold', async () => {
    const onAlarm = jest.fn(async () => {});
    await governor({ weeklySpendUsd: async () => 100, onAlarm }).check({ from: '92300' });
    expect(onAlarm).not.toHaveBeenCalled();
  });

  test('does not re-fire on every subsequent call in the same week', async () => {
    const onAlarm = jest.fn(async () => {});
    const g = governor({ weeklySpendUsd: async () => 130, onAlarm });
    await g.check({ from: '92300' });
    await g.check({ from: '92301' });
    await g.check({ from: '92302' });
    expect(onAlarm).toHaveBeenCalledTimes(1);
  });

  test('an alarm that fails never blocks the call', async () => {
    const g = governor({ weeklySpendUsd: async () => 130, onAlarm: async () => { throw new Error('whatsapp down'); } });
    await expect(g.check({ from: '92300' })).resolves.toEqual(expect.objectContaining({ allowed: true }));
  });

  test('the alarm still fires on the call that is ALSO declined', async () => {
    const onAlarm = jest.fn(async () => {});
    const g = governor({ weeklySpendUsd: async () => 150, onAlarm });
    const v = await g.check({ from: '92300' });
    expect(v.allowed).toBe(false);
    expect(onAlarm).toHaveBeenCalled();
  });
});

describe('budget governor — per-caller daily cap', () => {
  test('admits under the cap', async () => {
    const g = governor({ callsToday: async () => 2 });
    expect((await g.check({ from: '92300' })).allowed).toBe(true);
  });

  test('declines at the cap with its own reason', async () => {
    const g = governor({ callsToday: async () => 3 });
    const v = await g.check({ from: '92300' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('per_caller_daily');
  });

  test('counts THIS caller, not everyone', async () => {
    const callsToday = jest.fn(async () => 0);
    await governor({ callsToday }).check({ from: '923009876543' });
    expect(callsToday).toHaveBeenCalledWith('923009876543');
  });

  test('the weekly cap takes precedence over the per-caller one', async () => {
    const g = governor({ weeklySpendUsd: async () => 150, callsToday: async () => 99 });
    expect((await g.check({ from: '92300' })).reason).toBe('weekly_budget');
  });
});

describe('budget governor — fails CLOSED', () => {
  test('a ledger error declines the call rather than admitting it ungoverned', async () => {
    const g = governor({ weeklySpendUsd: async () => { throw new Error('db down'); } });
    const v = await g.check({ from: '92300' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('ledger_unavailable');
  });

  test('a per-caller lookup error also declines', async () => {
    const g = governor({ callsToday: async () => { throw new Error('db down'); } });
    expect((await g.check({ from: '92300' })).allowed).toBe(false);
  });

  test('a non-numeric spend is treated as unknown, not as zero', async () => {
    const g = governor({ weeklySpendUsd: async () => null });
    expect((await g.check({ from: '92300' })).allowed).toBe(false);
  });
});

describe('cost estimation', () => {
  test('a 5-minute call on mini lands in the modelled range', () => {
    const cost = estimateCallCost({ durationSeconds: 300, model: 'gpt-realtime-2.1-mini' });
    expect(cost).toBeGreaterThan(0.05);
    expect(cost).toBeLessThan(0.30);
  });

  test('cost scales with duration (above the fixed per-call overhead)', () => {
    const short = estimateCallCost({ durationSeconds: 60, model: 'gpt-realtime-2.1-mini' });
    const long = estimateCallCost({ durationSeconds: 300, model: 'gpt-realtime-2.1-mini' });
    // 5x the minutes, but each call also carries a flat transcription/summary
    // cost — so the ratio is below 5x by construction, not by accident.
    expect(long).toBeGreaterThan(short * 3);
    expect(long).toBeLessThan(short * 5);
  });

  test('the full 2.1 model costs roughly 3x mini — the escalation is priced', () => {
    const mini = estimateCallCost({ durationSeconds: 300, model: 'gpt-realtime-2.1-mini' });
    const full = estimateCallCost({ durationSeconds: 300, model: 'gpt-realtime-2.1' });
    expect(full / mini).toBeGreaterThan(2.5);
    expect(full / mini).toBeLessThan(3.6);
  });

  test('a zero-length call still carries the fixed overhead, never NaN', () => {
    const cost = estimateCallCost({ durationSeconds: 0, model: 'gpt-realtime-2.1-mini' });
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  test('a missing/unknown duration does not produce NaN', () => {
    expect(Number.isFinite(estimateCallCost({ model: 'gpt-realtime-2.1-mini' }))).toBe(true);
    expect(Number.isFinite(estimateCallCost({ durationSeconds: null, model: 'x' }))).toBe(true);
  });

  test('an unknown model falls back to the more expensive rate (never under-bill)', () => {
    const unknown = estimateCallCost({ durationSeconds: 300, model: 'gpt-realtime-9' });
    const mini = estimateCallCost({ durationSeconds: 300, model: 'gpt-realtime-2.1-mini' });
    expect(unknown).toBeGreaterThanOrEqual(mini);
  });

  test('is rounded to storable precision (NUMERIC(8,4))', () => {
    const cost = estimateCallCost({ durationSeconds: 137, model: 'gpt-realtime-2.1-mini' });
    expect(String(cost).split('.')[1] || '').toHaveLength(4);
  });
});

describe('the weekly window is Monday-anchored in PKT', () => {
  test('a Wednesday resolves back to that Monday 00:00 PKT', () => {
    // 2026-08-26 is a Wednesday. PKT is UTC+5, so Monday 00:00 PKT = Sun 19:00Z.
    const start = weekStartPkt(new Date('2026-08-26T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-08-23T19:00:00.000Z');
  });

  test('a Monday morning resolves to itself, not the week before', () => {
    const start = weekStartPkt(new Date('2026-08-24T06:00:00Z')); // Mon 11:00 PKT
    expect(start.toISOString()).toBe('2026-08-23T19:00:00.000Z');
  });

  test('a Sunday resolves back to the PREVIOUS Monday', () => {
    const start = weekStartPkt(new Date('2026-08-30T10:00:00Z')); // Sunday
    expect(start.toISOString()).toBe('2026-08-23T19:00:00.000Z');
  });

  test('just before Monday midnight PKT still belongs to the old week', () => {
    const start = weekStartPkt(new Date('2026-08-23T18:00:00Z')); // Sun 23:00 PKT
    expect(start.toISOString()).toBe('2026-08-16T19:00:00.000Z');
  });
});
