'use strict';
/**
 * The teacher-nudge core — `bot/shared/services/nudges/teacher-nudges.sweeper.js`.
 *
 * The sweeper owns the periodic half of the two new asks: expire what is stuck,
 * build each kind's cohort, claim what is due, hand each claimed row to its
 * registered handler, and mark the outcome. It sends nothing itself — it has no
 * handlers of its own, on purpose, so the thing that decides WHEN is separable
 * from the things that decide WHAT.
 *
 * Pre-merge Class P is the whole design, and each clause is a test below:
 *   P1 single-flight   the claim (store.claimDue), never a check-then-act. A row
 *                      another replica won never reaches a handler here.
 *   P2 kill switch     TEACHER_NUDGES_ENABLED, read at CALL time — a flag flipped
 *                      on Railway must take effect on the next tick, not the next
 *                      deploy. Unset/false → nothing is queried at all.
 *   P3 per-tick cap    a limit, passed through to the claim
 *   P4 one log line    exactly one `teacher_nudges.sweep` event per tick, carrying
 *                      all five counts
 *
 * The store is mocked here (it has its own 30-case suite); the module under test
 * — the sweeper — is real.
 */

const mockStore = {
  claimDue: jest.fn(),
  markSent: jest.fn().mockResolvedValue(true),
  markSkipped: jest.fn().mockResolvedValue(true),
  markFailed: jest.fn().mockResolvedValue(true),
  expireStuck: jest.fn().mockResolvedValue(0),
  KINDS: { COACHING_AFTER_LP: 'coaching_after_lp', LP_QUIZ_OFFER: 'lp_quiz_offer' },
  STATUS: { PENDING: 'pending', SENDING: 'sending', SENT: 'sent', FAILED: 'failed', SKIPPED: 'skipped', EXPIRED: 'expired' },
  SKIP_REASONS: ['weekly_cap', 'window_closed', 'no_lesson'],
  DEFAULT_CLAIM_LIMIT: 200,
};
jest.mock('../../shared/services/nudges/teacher-nudges.store', () => mockStore);

const mockLogEvent = jest.fn();
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
  getCurrentCorrelationId: () => 'test',
}));

const mockLog = jest.fn();
jest.mock('../../shared/utils/logger', () => ({
  logToFile: (...a) => mockLog(...a),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const NOW = new Date('2026-09-23T10:00:00.000Z');
const row = (id, kind = 'lp_quiz_offer') => ({ id, kind, user_id: `u-${id}`, context: {} });

/** A clean module registry per test — registration is module-level state. */
function freshSweeper() {
  let mod;
  jest.isolateModules(() => { mod = require('../../shared/services/nudges/teacher-nudges.sweeper'); });
  return mod;
}

const ORIGINAL_ENABLED = process.env.TEACHER_NUDGES_ENABLED;
beforeEach(() => {
  jest.clearAllMocks();
  mockStore.claimDue.mockResolvedValue([]);
  mockStore.expireStuck.mockResolvedValue(0);
  mockStore.markSent.mockResolvedValue(true);
  mockStore.markSkipped.mockResolvedValue(true);
  mockStore.markFailed.mockResolvedValue(true);
  process.env.TEACHER_NUDGES_ENABLED = 'true';
});
afterAll(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.TEACHER_NUDGES_ENABLED;
  else process.env.TEACHER_NUDGES_ENABLED = ORIGINAL_ENABLED;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('register', () => {
  test('refuses a kind that is not one of the two the CHECK constraint allows', () => {
    const s = freshSweeper();
    expect(() => s.register('whatever', async () => ({ sent: true })))
      .toThrow(/whatever/);
  });

  test('refuses a handler that is not a function', () => {
    const s = freshSweeper();
    expect(() => s.register('lp_quiz_offer', null)).toThrow(/handler/i);
  });

  test('refuses a second registration of the same kind — two owners is a bug, not a merge', () => {
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true }));
    expect(() => s.register('lp_quiz_offer', async () => ({ sent: true }))).toThrow(/already/i);
  });
});

describe('runSweep — the tick', () => {
  test('P2 kill switch: with TEACHER_NUDGES_ENABLED unset, nothing is expired and nothing is claimed', async () => {
    delete process.env.TEACHER_NUDGES_ENABLED;
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true, messageIds: ['m'] }));

    const out = await s.runSweep({ now: NOW });

    expect(mockStore.expireStuck).not.toHaveBeenCalled();
    expect(mockStore.claimDue).not.toHaveBeenCalled();
    expect(out).toEqual(expect.objectContaining({ off: true, claimed: 0, sent: 0 }));
  });

  test('P2 the flag is read at CALL time, not at require time', async () => {
    delete process.env.TEACHER_NUDGES_ENABLED;
    const s = freshSweeper();                     // required while the flag is OFF
    s.register('lp_quiz_offer', async () => ({ sent: true, messageIds: ['m'] }));
    expect((await s.runSweep({ now: NOW })).off).toBe(true);

    process.env.TEACHER_NUDGES_ENABLED = 'true';  // flipped on Railway, no redeploy
    mockStore.claimDue.mockResolvedValue([row('a')]);
    const out = await s.runSweep({ now: NOW });
    expect(out.off).toBeUndefined();
    expect(out.sent).toBe(1);
  });

  test('an unregistered kind is never claimed — nothing can be taken that nothing can send', async () => {
    const s = freshSweeper();
    await s.runSweep({ now: NOW });
    expect(mockStore.claimDue).not.toHaveBeenCalled();

    s.register('lp_quiz_offer', async () => ({ sent: true, messageIds: ['m'] }));
    await s.runSweep({ now: NOW });
    expect(mockStore.claimDue).toHaveBeenCalledTimes(1);
    expect(mockStore.claimDue.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'lp_quiz_offer' }));
  });

  test('expireStuck runs BEFORE any claim, and its count rides in the tally', async () => {
    const order = [];
    mockStore.expireStuck.mockImplementation(async () => { order.push('expire'); return 3; });
    mockStore.claimDue.mockImplementation(async () => { order.push('claim'); return []; });

    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true }));
    const out = await s.runSweep({ now: NOW });

    expect(order).toEqual(['expire', 'claim']);
    expect(out.expired).toBe(3);
  });

  test('prepare({now}) runs BEFORE claimDue for its kind — the cohort exists before it is claimed', async () => {
    const order = [];
    const prepare = jest.fn(async () => { order.push('prepare'); });
    mockStore.claimDue.mockImplementation(async () => { order.push('claim'); return []; });

    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true }), { prepare });
    await s.runSweep({ now: NOW });

    expect(order).toEqual(['prepare', 'claim']);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ now: NOW }));
  });

  test('a prepare that throws is logged at error level and the claim STILL runs — rows scheduled earlier are still due', async () => {
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true, messageIds: ['m'] }), {
      prepare: async () => { throw new Error('cohort query timed out'); },
    });
    mockStore.claimDue.mockResolvedValue([row('a')]);

    const out = await s.runSweep({ now: NOW });

    expect(mockStore.claimDue).toHaveBeenCalledTimes(1);
    expect(out.sent).toBe(1);
    expect(mockLog.mock.calls.filter(([, , level]) => level === 'error').length).toBeGreaterThan(0);
  });

  test('a handler returning {sent} marks sent with its message ids', async () => {
    mockStore.claimDue.mockResolvedValue([row('a')]);
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true, messageIds: ['wamid.1'] }));

    const out = await s.runSweep({ now: NOW });

    expect(mockStore.markSent).toHaveBeenCalledWith('a', expect.objectContaining({ messageIds: ['wamid.1'] }));
    expect(out).toEqual(expect.objectContaining({ claimed: 1, sent: 1, skipped: 0, failed: 0 }));
  });

  test('a handler returning {skipped} marks skipped with that reason', async () => {
    mockStore.claimDue.mockResolvedValue([row('a')]);
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ skipped: 'window_closed' }));

    const out = await s.runSweep({ now: NOW });

    expect(mockStore.markSkipped).toHaveBeenCalledWith('a', 'window_closed', expect.any(Object));
    expect(mockStore.markSent).not.toHaveBeenCalled();
    expect(out).toEqual(expect.objectContaining({ claimed: 1, sent: 0, skipped: 1, failed: 0 }));
  });

  test('a handler that THROWS marks failed and the tick carries on to the next row', async () => {
    mockStore.claimDue.mockResolvedValue([row('a'), row('b')]);
    const s = freshSweeper();
    s.register('lp_quiz_offer', async (r) => {
      if (r.id === 'a') throw new Error('WhatsApp 131047');
      return { sent: true, messageIds: ['wamid.2'] };
    });

    const out = await s.runSweep({ now: NOW });

    expect(mockStore.markFailed).toHaveBeenCalledWith('a', expect.objectContaining({ message: 'WhatsApp 131047' }));
    expect(mockStore.markSent).toHaveBeenCalledWith('b', expect.anything());
    expect(out).toEqual(expect.objectContaining({ claimed: 2, sent: 1, failed: 1 }));
    expect(mockLog.mock.calls.filter(([, , level]) => level === 'error').length).toBeGreaterThan(0);
  });

  test('a handler returning nothing is a failure, not a silent success', async () => {
    mockStore.claimDue.mockResolvedValue([row('a')]);
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => undefined);

    const out = await s.runSweep({ now: NOW });

    expect(mockStore.markFailed).toHaveBeenCalledWith('a', expect.anything());
    expect(out.failed).toBe(1);
    expect(out.sent).toBe(0);
  });

  test('a handler that returns an unknown skip reason fails the row rather than losing it', async () => {
    mockStore.claimDue.mockResolvedValue([row('a')]);
    mockStore.markSkipped.mockRejectedValue(new Error('unknown skip reason "busy"'));
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ skipped: 'busy' }));

    const out = await s.runSweep({ now: NOW });

    expect(out.failed).toBe(1);
    expect(mockStore.markFailed).toHaveBeenCalledWith('a', expect.anything());
  });

  test('P1 a row another replica won never reaches a handler — the claim is the only source of rows', async () => {
    // claimDue returns ONLY what this replica's UPDATE flipped; 'b' went elsewhere.
    mockStore.claimDue.mockResolvedValue([row('a')]);
    const handler = jest.fn(async () => ({ sent: true, messageIds: ['m'] }));
    const s = freshSweeper();
    s.register('lp_quiz_offer', handler);

    await s.runSweep({ now: NOW });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].id).toBe('a');
  });

  test('P3 the per-tick cap is passed to the claim, and defaults to 200', async () => {
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true }));

    await s.runSweep({ now: NOW, limit: 25 });
    expect(mockStore.claimDue.mock.calls[0][0]).toEqual(expect.objectContaining({ limit: 25, now: NOW }));

    mockStore.claimDue.mockClear();
    await s.runSweep({ now: NOW });
    expect(mockStore.claimDue.mock.calls[0][0]).toEqual(expect.objectContaining({ limit: 200 }));
  });

  test('P4 exactly one teacher_nudges.sweep event per tick, carrying all five counts', async () => {
    mockStore.expireStuck.mockResolvedValue(2);
    mockStore.claimDue.mockResolvedValue([row('a'), row('b')]);
    const s = freshSweeper();
    s.register('lp_quiz_offer', async (r) => (r.id === 'a'
      ? { sent: true, messageIds: ['m'] }
      : { skipped: 'no_lesson' }));

    await s.runSweep({ now: NOW });

    const sweeps = mockLogEvent.mock.calls.filter(([e]) => e === 'teacher_nudges.sweep');
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0][1]).toEqual(expect.objectContaining({
      claimed: 2, sent: 1, skipped: 1, failed: 0, expired: 2,
    }));
  });

  test('both kinds are swept in one tick and the counts are the total', async () => {
    mockStore.claimDue.mockImplementation(async ({ kind }) => (
      kind === 'lp_quiz_offer' ? [row('a', kind)] : [row('c', kind), row('d', kind)]
    ));
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true, messageIds: ['m'] }));
    s.register('coaching_after_lp', async () => ({ sent: true, messageIds: ['m'] }));

    const out = await s.runSweep({ now: NOW });

    expect(mockStore.claimDue).toHaveBeenCalledTimes(2);
    expect(out).toEqual(expect.objectContaining({ claimed: 3, sent: 3 }));
  });

  test('one kind blowing up does not stop the other', async () => {
    mockStore.claimDue.mockImplementation(async ({ kind }) => {
      if (kind === 'lp_quiz_offer') throw new Error('table gone');
      return [row('c', kind)];
    });
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true }));
    s.register('coaching_after_lp', async () => ({ sent: true, messageIds: ['m'] }));

    const out = await s.runSweep({ now: NOW });

    expect(out.sent).toBe(1);
    expect(mockLog.mock.calls.filter(([, , level]) => level === 'error').length).toBeGreaterThan(0);
  });

  test('a send that succeeded but could not be marked is reported at error level, never silently', async () => {
    mockStore.claimDue.mockResolvedValue([row('a')]);
    mockStore.markSent.mockResolvedValue(false);          // the row did not flip
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true, messageIds: ['m'] }));

    const out = await s.runSweep({ now: NOW });

    expect(out.sent).toBe(1);                              // the teacher does have it
    expect(mockLog.mock.calls.filter(([, , level]) => level === 'error').length).toBeGreaterThan(0);
  });

  test('runSweep never throws, whatever the store does', async () => {
    mockStore.expireStuck.mockRejectedValue(new Error('database is on fire'));
    const s = freshSweeper();
    s.register('lp_quiz_offer', async () => ({ sent: true }));
    await expect(s.runSweep({ now: NOW })).resolves.toEqual(
      expect.objectContaining({ claimed: 0, sent: 0, expired: 0 }));
  });
});
