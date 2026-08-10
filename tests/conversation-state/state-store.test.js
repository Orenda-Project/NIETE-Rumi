/**
 * conversation-state.service — the ONE place "what is this teacher doing right now?"
 * is written and read.
 *
 * Before this service there were four stores that disagreed:
 *   write   -> conversations.current_state          (a row of the MESSAGE LOG)
 *   read    -> conversations.current_state          (text path)
 *   read    -> conversations.conversation_state     (voice path — column never existed)
 *   clear   -> chat_sessions.conversation_state     (a different table entirely)
 * so state was never actually cleared, and every voice reply was state-blind.
 *
 * The invariants below are the ones whose absence caused real production damage,
 * each stated so it fails loudly if someone reintroduces the old shape:
 *
 *  1. Keyed on the TEACHER, not the session. chat_sessions rotate after 30 minutes
 *     idle; state scoped to a session silently vanished when a teacher stepped away
 *     and came back. The API therefore takes no sessionId at all.
 *  2. A deadline is honoured ON READ, not only by a sweeper. A sweeper that has not
 *     run yet must never be the reason a teacher gets stale state.
 *  3. Clearing is flow-scoped. Feature A finishing must not wipe feature B's state.
 *  4. Drift pushes, it does not overwrite — an interrupted flow can be resumed.
 *  5. State cannot be written without a bounded deadline.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const svc = require('../../bot/shared/services/conversation-state.service');

const USER = '11111111-2222-3333-4444-555555555555';

/**
 * Chainable Supabase double backed by a single in-memory users row, because the
 * store lives on users (one row per teacher, never rotates) rather than in a new
 * table — see the migration for the anti-sprawl reasoning.
 */
function harness(rowFields = {}) {
  const state = { row: { id: USER, ...rowFields } };
  mockSupabase.from.mockImplementation((table) => {
    if (table !== 'users') throw new Error(`unexpected table: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.row, error: null }),
          single: () => Promise.resolve({ data: state.row, error: null }),
        }),
        lt: () => ({
          not: () => ({ limit: () => Promise.resolve({ data: [state.row], error: null }) }),
        }),
      }),
      update: (patch) => ({
        eq: () => {
          Object.assign(state.row, patch);
          return Promise.resolve({ data: [state.row], error: null });
        },
      }),
    };
  });
  return state;
}

const future = () => new Date(Date.now() + 600_000).toISOString();
const past = () => new Date(Date.now() - 1_000).toISOString();

beforeEach(() => jest.clearAllMocks());

describe('conversation-state store', () => {
  it('reads back what it wrote, addressed by teacher alone', async () => {
    const store = harness();
    await svc.setState(USER, { flow: 'lesson_plan', step: 'awaiting_topic', payload: { grade: 4 }, ttlSeconds: 600 });

    const got = await svc.getState(USER);
    expect(got).toMatchObject({ flow: 'lesson_plan', step: 'awaiting_topic', payload: { grade: 4 } });
    // The whole point: no session identifier is involved anywhere.
    expect(JSON.stringify(store.row)).not.toMatch(/session/i);
  });

  it('takes no sessionId — a rotated session cannot orphan state', () => {
    // Guards the regression directly: if someone re-adds a session parameter,
    // 30-minute session rotation starts eating state again.
    expect(svc.setState.length).toBeLessThanOrEqual(2);
    expect(svc.getState.length).toBeLessThanOrEqual(1);
  });

  it('treats an expired deadline as no state, without waiting for the sweeper', async () => {
    harness({
      conversation_state: { flow: 'video', step: 'awaiting_topic', payload: {}, stack: [] },
      conversation_state_expires_at: past(),
    });
    expect(await svc.getState(USER)).toBeNull();
  });

  it('refuses to store state without a bounded deadline', async () => {
    harness();
    await expect(svc.setState(USER, { flow: 'video', step: 'awaiting_topic' })).rejects.toThrow(/ttl/i);
    await expect(
      svc.setState(USER, { flow: 'video', step: 'awaiting_topic', ttlSeconds: 60 * 60 * 24 * 7 })
    ).rejects.toThrow(/ceiling|exceed/i);
  });

  it('clears only the flow it was asked to clear', async () => {
    harness({
      conversation_state: { flow: 'coaching', step: 'awaiting_photo', payload: {}, stack: [] },
      conversation_state_expires_at: future(),
    });

    await svc.clearState(USER, { flow: 'video' }); // a different feature finishing
    expect(await svc.getState(USER)).toMatchObject({ flow: 'coaching', step: 'awaiting_photo' });

    await svc.clearState(USER, { flow: 'coaching' });
    expect(await svc.getState(USER)).toBeNull();
  });

  it('pushes an interrupted flow instead of overwriting it, and pops it back', async () => {
    harness();
    await svc.setState(USER, { flow: 'coaching', step: 'awaiting_reflection', ttlSeconds: 3600 });

    // Teacher drifts mid-coaching and starts a quiz.
    await svc.pushState(USER, { flow: 'quiz', step: 'awaiting_topic', ttlSeconds: 600 });
    expect(await svc.getState(USER)).toMatchObject({ flow: 'quiz', step: 'awaiting_topic' });

    // Quiz done — coaching is still there to come back to.
    const resumed = await svc.popState(USER);
    expect(resumed).toMatchObject({ flow: 'coaching', step: 'awaiting_reflection' });
    expect(await svc.getState(USER)).toMatchObject({ flow: 'coaching' });
  });

  it('pops to nothing when there was no interrupted flow', async () => {
    harness();
    await svc.setState(USER, { flow: 'quiz', step: 'awaiting_topic', ttlSeconds: 600 });
    expect(await svc.popState(USER)).toBeNull();
    expect(await svc.getState(USER)).toBeNull();
  });

  it('surfaces expired rows for the sweeper to offer back', async () => {
    harness({
      conversation_state: { flow: 'lesson_plan', step: 'awaiting_topic', payload: {}, stack: [] },
      conversation_state_expires_at: past(),
    });
    const stale = await svc.sweepExpired({ limit: 10 });
    expect(stale).toEqual([expect.objectContaining({ userId: USER, flow: 'lesson_plan', step: 'awaiting_topic' })]);
  });
});
