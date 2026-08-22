/**
 * clearState() against an EXPIRED row — the case the sweeper actually hands it.
 *
 * bd-43517. `clearState(userId, {flow})` decided whether the state was "someone
 * else's" by calling `getState()`, which applies the deadline and returns null once
 * it has passed. So for exactly the rows the sweeper exists to clean, the guard read
 * null, concluded there was nothing of that flow to clear, and returned false
 * WITHOUT WRITING — while the sweeper counted it as cleaned.
 *
 * Both of runSweep()'s cleanup branches call it:
 *   step === OFFERED        -> clearState(...)   "we asked, she never answered"
 *   !shouldOffer(row.flow)  -> clearState(...)   "expired and unnameable, let it go"
 * so expired state was immortal. Measured on staging: three `menu` rows expired
 * 2026-08-14, 08-15 and 08-18 were still present on 08-21, and were observed
 * surviving a sweep in which the setState (offer) branch wrote successfully in the
 * same batch.
 *
 * The damage is not the row itself — getState already treats it as absent, so no
 * teacher is served stale state. It is that `sweepExpired` takes `limit: 100` with
 * no ORDER BY, riding the partial index oldest-first, so immortal rows occupy the
 * front of the window permanently. `menu` has a 1h TTL and is absent from
 * TASK_LABEL, so every abandoned menu row becomes immortal: once ~100 accumulate,
 * no newly-expired teacher is ever offered her task back, and the resume feature
 * dies silently with the tally still reporting success.
 *
 * WHY THE EXISTING SUITE MISSED IT — two independent reasons, both worth keeping in
 * mind when reading the assertions below:
 *
 *   1. state-store.test.js's "clears only the flow it was asked to clear" seeds
 *      `conversation_state_expires_at: future()`. A LIVE row. The expired case,
 *      which is the only case the sweeper produces, was never exercised.
 *   2. resume-offer.test.js mocks the whole state service and sets
 *      `mockState.clearState.mockResolvedValue(true)`, then asserts it was CALLED.
 *      A stub that always succeeds cannot observe a function that returns false.
 *      (pre-merge-checklist Class O.)
 *
 * So this file deliberately uses the REAL service against a storing fake, and every
 * assertion checks the STORED ROW, not just the return value.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const svc = require('../../bot/shared/services/conversation-state.service');

const USER = '11111111-2222-3333-4444-555555555555';

/**
 * Storing fake — writes land in `row` and reads see them. A stub that merely
 * returned `{error: null}` would make every assertion below vacuous, which is the
 * whole failure this file exists to prevent, so it also counts writes.
 */
function harness(rowFields = {}) {
  const store = { row: { id: USER, ...rowFields }, writes: 0 };
  mockSupabase.from.mockImplementation((table) => {
    if (table !== 'users') throw new Error(`unexpected table: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: store.row, error: null }),
          single: () => Promise.resolve({ data: store.row, error: null }),
        }),
        lt: () => ({
          not: () => ({ limit: () => Promise.resolve({ data: [store.row], error: null }) }),
        }),
      }),
      update: (patch) => ({
        eq: () => {
          store.writes += 1;
          Object.assign(store.row, patch);
          return Promise.resolve({ data: [store.row], error: null });
        },
      }),
    };
  });
  return store;
}

const stateOf = (flow, step = 'AWAITING_CLASSROOM_AUDIO') => ({
  flow, step, payload: {}, stack: [], version: 1, updated_at: new Date().toISOString(),
});
const future = () => new Date(Date.now() + 600_000).toISOString();
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => jest.clearAllMocks());

describe('clearState on an expired row (bd-43517)', () => {
  it('clears an EXPIRED row of the named flow — the sweeper hands it nothing else', async () => {
    const store = harness({
      conversation_state: stateOf('coaching'),
      conversation_state_expires_at: minutesAgo(45),
    });

    const cleared = await svc.clearState(USER, { flow: 'coaching' });

    expect(cleared).toBe(true);
    expect(store.writes).toBe(1);                            // it must actually WRITE
    expect(store.row.conversation_state).toBeNull();
    expect(store.row.conversation_state_expires_at).toBeNull();
  });

  it('CONTROL: the same call on a LIVE row clears too — so the fake is not what makes this pass', async () => {
    const store = harness({
      conversation_state: stateOf('coaching'),
      conversation_state_expires_at: future(),
    });

    expect(await svc.clearState(USER, { flow: 'coaching' })).toBe(true);
    expect(store.writes).toBe(1);
    expect(store.row.conversation_state).toBeNull();
  });

  it('still refuses to clear a DIFFERENT flow, expired or not — the fix must not become an unconditional wipe', async () => {
    // This is the invariant the original getState() gate was protecting, and the
    // reason the fix cannot simply drop the guard: one feature finishing must never
    // wipe another feature's task. Expiry changes WHEN it may be cleared, never WHOSE.
    const store = harness({
      conversation_state: stateOf('coaching'),
      conversation_state_expires_at: minutesAgo(45),
    });

    expect(await svc.clearState(USER, { flow: 'video' })).toBe(false);
    expect(store.writes).toBe(0);
    expect(store.row.conversation_state).toMatchObject({ flow: 'coaching' });
  });

  it('clears an expired non-offerable flow — the !shouldOffer sweep branch', async () => {
    // `menu` is deliberately absent from TASK_LABEL, so the sweeper clears it
    // silently rather than sending a mystery offer. That clear is the one that has
    // been failing on every sweep since the feature shipped.
    const store = harness({
      conversation_state: stateOf('menu', 'AWAITING_MENU_CHOICE'),
      conversation_state_expires_at: minutesAgo(60 * 24 * 3),
    });

    expect(await svc.clearState(USER, { flow: 'menu' })).toBe(true);
    expect(store.row.conversation_state).toBeNull();
  });

  it('clears an expired offer nobody answered — the OFFERED sweep branch (ask once)', async () => {
    const store = harness({
      conversation_state: {
        ...stateOf('coaching', 'offered_resume'),
        payload: { resumeStep: 'AWAITING_CLASSROOM_AUDIO' },
      },
      conversation_state_expires_at: minutesAgo(60 * 8),
    });

    expect(await svc.clearState(USER, { flow: 'coaching' })).toBe(true);
    expect(store.row.conversation_state).toBeNull();
  });

  it('an unscoped clear still wipes whatever is there, expired included', async () => {
    const store = harness({
      conversation_state: stateOf('coaching'),
      conversation_state_expires_at: minutesAgo(5),
    });

    expect(await svc.clearState(USER)).toBe(true);
    expect(store.row.conversation_state).toBeNull();
  });

  it('a row with no state at all is a no-op, not a spurious write', async () => {
    const store = harness({ conversation_state: null, conversation_state_expires_at: null });

    expect(await svc.clearState(USER, { flow: 'coaching' })).toBe(false);
    expect(store.writes).toBe(0);
  });

  it('getState is unchanged — an expired row is still served as NO state', async () => {
    // The fix must not "helpfully" start returning expired state to callers. The
    // read-path deadline is the invariant that stops a sweeper-that-has-not-run
    // from serving a stale step.
    harness({
      conversation_state: stateOf('coaching'),
      conversation_state_expires_at: minutesAgo(1),
    });

    expect(await svc.getState(USER)).toBeNull();
  });
});
