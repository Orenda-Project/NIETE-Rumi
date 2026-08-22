/**
 * The voice wait, against the REAL conversation-state service. (bd-43520, Class O)
 *
 * Class O of the pre-merge checklist exists because of this exact file's shape: a
 * suite that mocks conversation-state and asserts `toHaveBeenCalledWith` has tested
 * the CALLER, not the behaviour — and the behaviour is where the bug lived
 * (bd-43517: clearState issues no write at all once a row has expired, while still
 * reporting success).
 *
 * The voice roll call hangs entirely off that service: arm before the note, read it
 * when the note arrives, stash the extraction, read it again when the Flow opens.
 * Four reads and writes across three webhooks, and if any of them silently no-ops
 * the principal talks to nobody. So this suite runs the real module against an
 * in-memory store that actually holds rows.
 *
 * The CONTROL arm is not optional: without it a broken fake produces the same red as
 * a real bug.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

// An in-memory `users` table — stores what is written and returns what is stored.
const mockRows = new Map();
const mockCounters = { writes: 0 };

jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    if (table !== 'users') throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({
        eq: (col, id) => ({
          maybeSingle: async () => ({ data: mockRows.get(id) || null, error: null }),
        }),
      }),
      update: (patch) => ({
        eq: (col, id) => {
          mockCounters.writes += 1;
          mockRows.set(id, { ...(mockRows.get(id) || {}), ...patch });
          return Promise.resolve({ error: null });
        },
      }),
    };
  },
}));

const voice = require('../../bot/shared/services/voice-attendance.service');
const ConversationState = require('../../bot/shared/services/conversation-state.service');

const USER = 'p1';

beforeEach(() => {
  mockRows.clear();
  mockRows.set(USER, { conversation_state: null, conversation_state_expires_at: null });
  mockCounters.writes = 0;
});

describe('arming the wait actually persists it', () => {
  it('writes a row, and reading it back says we are waiting', async () => {
    await voice.arm(USER, { schoolId: 'sch1' });

    expect(mockCounters.writes).toBe(1);
    const waiting = await voice.armed(USER);
    expect(waiting).toEqual({ schoolId: 'sch1' });
  });

  it('says we are NOT waiting when nothing was armed — the control', async () => {
    expect(await voice.armed(USER)).toBeNull();
    expect(mockCounters.writes).toBe(0);
  });

  it('stops waiting once the deadline has passed', async () => {
    await voice.arm(USER, { schoolId: 'sch1' });
    // Expire it the way real time would.
    mockRows.set(USER, {
      ...mockRows.get(USER),
      conversation_state_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(await voice.armed(USER)).toBeNull();
  });

  it('does not mistake another feature\'s state for a voice wait', async () => {
    // State is CONTEXT, not permission: a principal mid-coaching must not have their
    // next voice note read as a roll call.
    await ConversationState.setState(USER, { flow: 'coaching', step: 'awaiting_audio', ttlSeconds: 600 });
    expect(await voice.armed(USER)).toBeNull();
  });
});

describe('the extraction survives the gap between the note and the Flow', () => {
  it('stashes and reads back the selection, the transcript and the unplaced names', async () => {
    await voice.arm(USER, { schoolId: 'sch1' });
    await voice.stashResult(USER, {
      schoolId: 'sch1',
      absentIds: ['u1', 'u2'],
      leaveIds: ['u3'],
      transcript: 'Ayesha aur Bilal ghair hazir hain',
      unmatched: ['Zubair'],
    });

    const pending = await voice.pendingResult(USER);
    expect(pending).toMatchObject({
      schoolId: 'sch1',
      absentIds: ['u1', 'u2'],
      leaveIds: ['u3'],
      unmatched: ['Zubair'],
    });
    expect(pending.transcript).toContain('ghair hazir');
  });

  it('is no longer "waiting for a note" once the note has been processed', async () => {
    // Otherwise a second voice note would be re-extracted while the first is still
    // open in a Flow, and whichever finished last would win.
    await voice.arm(USER, { schoolId: 'sch1' });
    await voice.stashResult(USER, { schoolId: 'sch1', absentIds: [], leaveIds: [], transcript: 'x' });

    expect(await voice.armed(USER)).toBeNull();
    expect(await voice.pendingResult(USER)).not.toBeNull();
  });

  it('has nothing pending before a note is processed — the control', async () => {
    await voice.arm(USER, { schoolId: 'sch1' });
    expect(await voice.pendingResult(USER)).toBeNull();
  });
});

describe('disarming', () => {
  it('clears a live wait, and a write really happens', async () => {
    await voice.arm(USER, { schoolId: 'sch1' });
    const before = mockCounters.writes;

    expect(await voice.disarm(USER)).toBe(true);
    expect(mockCounters.writes).toBe(before + 1);
    expect(await voice.armed(USER)).toBeNull();
  });

  it('leaves another feature\'s state alone', async () => {
    // bd-43517's other half: an unconditional clear is how one feature finishing
    // wiped another feature's state.
    await ConversationState.setState(USER, { flow: 'coaching', step: 'awaiting_audio', ttlSeconds: 600 });

    expect(await voice.disarm(USER)).toBe(false);
    expect((await ConversationState.getState(USER)).flow).toBe('coaching');
  });

  it('is a harmless no-op on an already-expired wait', async () => {
    // clearState issues NO write once the row is past its deadline (bd-43517). That
    // is fine HERE and this test says why: an expired wait already reads as "not
    // waiting", so nothing downstream can act on the row it declines to clear.
    await voice.arm(USER, { schoolId: 'sch1' });
    mockRows.set(USER, {
      ...mockRows.get(USER),
      conversation_state_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(await voice.disarm(USER)).toBe(false);
    expect(await voice.armed(USER)).toBeNull();
    expect(await voice.pendingResult(USER)).toBeNull();
  });
});
