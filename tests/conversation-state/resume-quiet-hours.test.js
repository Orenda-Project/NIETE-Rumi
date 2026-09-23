'use strict';
/**
 * The interrupted-task resume offer keeps the quiet hours.
 *
 * "Earlier you started a classroom observation but we did not finish. Shall we
 * pick up where you left off?" is a message the bot starts, on a 30-minute
 * timer — so, like every other message sent to a teacher later (the six-hour
 * quiz nudge, the coaching ask, the afternoon quiz offer), it must not arrive
 * between 21:00 and 07:00 PKT. On production it did: 365 offers in one week
 * went out inside that window.
 *
 * What the sweep must do at night, and why each half is what it is:
 *
 *   SEND NOTHING   An offer that falls due at night is DEFERRED, not dropped:
 *                  the row is left exactly as it is — expired, still offerable —
 *                  and the first tick after the window ends offers it.
 *
 *   STILL EXPIRE   Closing an unanswered offer, or letting go of a flow the bot
 *                  cannot name, writes state and sends nothing, so it runs at
 *                  any hour.
 *
 *   NO NEW CLOCK   There is no "resume window" to extend: an expired row stays
 *                  offerable until it is offered, however long ago it expired.
 *                  So a flow interrupted at 20:50 is offered at 07:00 rather than
 *                  lapsing overnight — the night-long test below proves it.
 *
 * ONE RULE. The window is the one every other deferred message uses
 * (nudgeTargetUtc, configurable by NUDGE_QUIET_HOURS_PKT). A second copy of
 * "21 to 7" here would pass today and drift the first time the window moves —
 * the custom-window test would catch that copy.
 *
 * WHY THE REAL SERVICES. sweepAndOffer and the conversation-state store run for
 * real, over an in-memory `users` table that answers the same query chains
 * Supabase does. Only the boundaries are doubled: the database client, the
 * WhatsApp send, the lock cache, the logger.
 */

// ── boundaries ───────────────────────────────────────────────────────────────
const mockWhatsApp = {
  sendInteractiveButtons: jest.fn(),
  sendMessage: jest.fn(),
};
const mockRedis = { acquireLock: jest.fn(), releaseLock: jest.fn() };
const mockLog = jest.fn();

/**
 * An in-memory `users` table behind the Supabase query-builder surface the sweep
 * and the state store use: select / update, eq / in / lt / not-is-null, limit,
 * maybeSingle, and `.select()` after an update to learn which rows were hit.
 */
const mockDb = (() => {
  const users = new Map();
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function run(q) {
    let rows = [...users.values()].filter((r) => q.filters.every((f) => f(r)));
    if (q.limitN != null) rows = rows.slice(0, q.limitN);
    if (q.op === 'update') {
      for (const r of rows) Object.assign(r, clone(q.patch));
      return { data: q.returning ? rows.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: rows.map(clone), error: null };
  }

  function builder(table) {
    if (table !== 'users') throw new Error(`unexpected table ${table}`);
    const q = { op: 'select', filters: [], patch: null, returning: false, limitN: null };
    const b = {
      select() { if (q.op === 'update') q.returning = true; return b; },
      update(patch) { q.op = 'update'; q.patch = patch; return b; },
      eq(col, v) { q.filters.push((r) => r[col] === v); return b; },
      in(col, vs) { q.filters.push((r) => vs.includes(r[col])); return b; },
      lt(col, iso) {
        q.filters.push((r) => r[col] != null && Date.parse(r[col]) < Date.parse(iso));
        return b;
      },
      not(col, op, v) {
        if (op !== 'is' || v !== null) throw new Error(`unsupported not(${col}, ${op}, ${v})`);
        q.filters.push((r) => r[col] != null);
        return b;
      },
      limit(n) { q.limitN = n; return b; },
      maybeSingle() {
        const res = run(q);
        return Promise.resolve({ data: (res.data && res.data[0]) || null, error: null });
      },
      then(resolve, reject) { return Promise.resolve(run(q)).then(resolve, reject); },
    };
    return b;
  }

  return { users, client: { from: jest.fn(builder) } };
})();

jest.mock('../../bot/shared/config/supabase', () => mockDb.client);
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const Resume = require('../../bot/shared/services/conversation-resume.service');
const ConversationState = require('../../bot/shared/services/conversation-state.service');
const { atPkt } = require('../../bot/shared/services/nudges/pkt-time');

const TEACHER = '11111111-2222-3333-4444-555555555555';
const PHONE = '923000000000';
// 2026-09-23 is a Wednesday; the night runs into Thursday 2026-09-24.
const EVENING = '2026-09-23';
const MORNING = '2026-09-24';

const KEY = 'NUDGE_QUIET_HOURS_PKT';
const savedWindow = process.env[KEY];

/** Move the clock (Date only — nothing here waits on a timer). */
function clockAt(instant) {
  jest.setSystemTime(instant);
}

/** The teacher's row as the store holds it right now. */
const row = () => mockDb.users.get(TEACHER);

/**
 * A teacher who asked for a classroom observation at `interruptedAt` and never
 * sent the recording: written through the REAL store, with the same one-hour
 * wait the recording step uses.
 */
async function interruptedAt(instant, { flow = 'coaching', step = 'AWAITING_CLASSROOM_AUDIO', ttlSeconds = 3600 } = {}) {
  clockAt(instant);
  const ok = await ConversationState.setState(TEACHER, {
    flow, step, payload: { sessionId: 's-1' }, ttlSeconds,
  });
  expect(ok).not.toBeNull();
}

/** One tick of the sweep at `instant`. */
async function tickAt(instant) {
  clockAt(instant);
  return Resume.sweepAndOffer({ limit: 100 });
}

beforeAll(() => {
  // Only Date is faked: the code under test awaits promises, never timers.
  jest.useFakeTimers({
    now: atPkt(EVENING, 12, 0),
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate'],
  });
});
afterAll(() => {
  jest.useRealTimers();
  if (savedWindow === undefined) delete process.env[KEY];
  else process.env[KEY] = savedWindow;
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env[KEY];                      // production: unset = 21:00–07:00
  mockWhatsApp.sendInteractiveButtons.mockResolvedValue(true);
  mockWhatsApp.sendMessage.mockResolvedValue(true);
  mockRedis.acquireLock.mockResolvedValue(true);
  mockRedis.releaseLock.mockResolvedValue(true);
  mockDb.users.clear();
  mockDb.users.set(TEACHER, {
    id: TEACHER, phone_number: PHONE, preferred_language: 'en',
    conversation_state: null, conversation_state_expires_at: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('at night the sweep defers the offer instead of sending it', () => {
  test('01:00 PKT: nothing is sent, the flow is left exactly as it was, and it is still offerable', async () => {
    await interruptedAt(atPkt(EVENING, 20, 50));
    const before = JSON.parse(JSON.stringify(row()));

    const tally = await tickAt(atPkt(MORNING, 1, 0));

    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(mockWhatsApp.sendMessage).not.toHaveBeenCalled();
    // Not converted to an offer, not cleared, deadline untouched.
    expect(row()).toEqual(before);
    expect(row().conversation_state.step).toBe('AWAITING_CLASSROOM_AUDIO');
    // Still what the NEXT sweep will pick up.
    const still = await ConversationState.sweepExpired({ limit: 100 });
    expect(still).toEqual([expect.objectContaining({ userId: TEACHER, flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO' })]);
    // Counted, so the tick line can say it.
    expect(tally.deferredQuietHours).toBe(1);
    expect(tally.offered).toBe(0);
    expect(tally.expired).toBe(0);
  });

  test('07:30 PKT, after a deferring night tick: offered once, with the step kept for "Pick up"', async () => {
    await interruptedAt(atPkt(EVENING, 20, 50));
    await tickAt(atPkt(MORNING, 1, 0));
    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();

    const tally = await tickAt(atPkt(MORNING, 7, 30));

    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, msg] = mockWhatsApp.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(msg.body).toMatch(/classroom observation/);
    expect(msg.buttons.map((b) => b.id)).toEqual(['resume_yes:coaching', 'resume_no:coaching']);
    expect(row().conversation_state.step).toBe(Resume.OFFERED);
    expect(row().conversation_state.payload.resumeStep).toBe('AWAITING_CLASSROOM_AUDIO');
    expect(tally.offered).toBe(1);
    expect(tally.deferredQuietHours).toBe(0);
  });

  test('interrupted at 20:50: every tick through the night defers, the 07:00 tick offers, and it is never asked twice', async () => {
    // The step's one-hour wait lapses at 21:50 — inside the window. Nothing may
    // expire it unoffered overnight; the morning must still ask.
    await interruptedAt(atPkt(EVENING, 20, 50));

    const night = [
      atPkt(EVENING, 22, 0), atPkt(EVENING, 22, 30), atPkt(EVENING, 23, 30),
      atPkt(MORNING, 0, 30), atPkt(MORNING, 3, 0), atPkt(MORNING, 6, 30),
    ];
    for (const t of night) {
      const tally = await tickAt(t);
      expect(tally.deferredQuietHours).toBe(1);
    }
    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();

    const seven = await tickAt(atPkt(MORNING, 7, 0));
    expect(seven.offered).toBe(1);
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);

    // The offer is live now, so later morning ticks leave it alone.
    await tickAt(atPkt(MORNING, 7, 30));
    await tickAt(atPkt(MORNING, 8, 0));
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });
});

describe('what still happens at night', () => {
  test('an unanswered offer is closed and an unnameable flow is let go — both silent', async () => {
    const OTHER = '66666666-7777-8888-9999-000000000000';
    mockDb.users.set(OTHER, {
      id: OTHER, phone_number: '923000000001', preferred_language: 'en',
      conversation_state: null, conversation_state_expires_at: null,
    });

    // Offered at 20:30 (before the window) with the six-hour offer wait: lapses 02:30.
    await interruptedAt(atPkt(EVENING, 19, 0));
    await tickAt(atPkt(EVENING, 20, 30));
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(row().conversation_state.step).toBe(Resume.OFFERED);

    // A flow the bot cannot name (no label), lapsed at 22:00.
    clockAt(atPkt(EVENING, 21, 0));
    await ConversationState.setState(OTHER, { flow: 'lesson_plan', step: 'awaiting_topic', ttlSeconds: 3600 });

    mockWhatsApp.sendInteractiveButtons.mockClear();
    const tally = await tickAt(atPkt(MORNING, 3, 0));

    expect(tally.expired).toBe(1);
    expect(tally.skipped).toBe(1);
    expect(row().conversation_state).toBeNull();
    expect(mockDb.users.get(OTHER).conversation_state).toBeNull();
    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(mockWhatsApp.sendMessage).not.toHaveBeenCalled();
  });

  test('daytime is unchanged: an offer due at 15:00 goes at 15:00', async () => {
    await interruptedAt(atPkt(EVENING, 13, 0));
    const tally = await tickAt(atPkt(EVENING, 15, 0));
    expect(tally.offered).toBe(1);
    expect(tally.deferredQuietHours).toBe(0);
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });
});

describe('the window is the shared, configurable one', () => {
  test('NUDGE_QUIET_HOURS_PKT=off: offered at 01:00', async () => {
    process.env[KEY] = 'off';
    await interruptedAt(atPkt(EVENING, 20, 50));

    const tally = await tickAt(atPkt(MORNING, 1, 0));

    expect(tally.offered).toBe(1);
    expect(tally.deferredQuietHours).toBe(0);
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(row().conversation_state.step).toBe(Resume.OFFERED);
  });

  test('NUDGE_QUIET_HOURS_PKT=22-6: 21:30 is outside that window and sends; 22:30 is inside and defers', async () => {
    process.env[KEY] = '22-6';
    await interruptedAt(atPkt(EVENING, 20, 0));
    const early = await tickAt(atPkt(EVENING, 21, 30));
    expect(early.offered).toBe(1);

    mockDb.users.get(TEACHER).conversation_state = null;
    mockWhatsApp.sendInteractiveButtons.mockClear();
    await interruptedAt(atPkt(EVENING, 21, 20));
    const late = await tickAt(atPkt(EVENING, 22, 30));
    expect(late.offered).toBe(0);
    expect(late.deferredQuietHours).toBe(1);
    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});
