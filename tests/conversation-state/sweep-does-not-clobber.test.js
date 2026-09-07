/**
 * The resume sweeper must not overwrite a teacher who came back.
 *
 * sweepExpired() selects rows whose deadline has passed, and then, per row,
 * runSweep() writes step=OFFERED. Those are two statements with a gap between
 * them, and the write was unconditional — so a teacher who became active inside
 * that gap had her LIVE state replaced by an offer for the task she had already
 * left, and was then messaged about it. The gap is not hypothetical: the write
 * happens inside the per-row loop, after the WhatsApp send for every row before
 * her, so it widens with batch position.
 *
 * Production sends ~1,436 of these offers a week, which is ~1,436 chances a week.
 *
 * THE PREDICATE. Scoping the write to "only if this row is STILL expired" is the
 * whole fix, and it is the right predicate rather than a version compare: a fresh
 * setState always writes a FUTURE deadline, so "still expired" is exactly "she has
 * not come back". If she restarted the very same flow, her new row is live and the
 * offer is correctly refused — she is doing it, she does not need asking.
 *
 * WHY THE REAL SERVICE. The write being guarded lives in conversation-state, so
 * mocking it would test the caller and not the behaviour (pre-merge-checklist
 * Class O — the class this repo's own state bug hid behind). Only the boundaries
 * are doubled: the lock, the WhatsApp send, the copy.
 *
 * THE CONTROL ARM IS NOT OPTIONAL. A guard that refuses everything would pass the
 * first test and silently kill the resume feature, so the second test proves an
 * offer still lands when she has NOT come back.
 */

const mockRedis = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(true),
};
const mockWhatsApp = { sendInteractiveButtons: jest.fn().mockResolvedValue(true), sendMessage: jest.fn().mockResolvedValue(true) };

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../bot/shared/config/ux-strings', () => ({
  resolveUx: (k) => k,
  clampLanguage: (l) => (l === 'ur' ? 'ur' : 'en'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const USER = '11111111-2222-3333-4444-555555555555';
const PHONE = '923000000000';

/**
 * One users row, held in memory, reachable through the four chains the sweep uses:
 * sweepExpired's select, the batch phone lookup, readRow's maybeSingle, and the
 * update. `onSweepRead` is the seam that models the race — it fires the instant the
 * sweeper has read the expired row, which is exactly when the teacher's own write
 * would land.
 */
function harness({ expiresAt, onSweepRead = null }) {
  const store = {
    row: {
      id: USER, phone_number: PHONE, preferred_language: 'en',
      conversation_state: {
        flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO',
        payload: { sessionId: 's-1' }, stack: [], version: 1,
        updated_at: new Date().toISOString(),
      },
      conversation_state_expires_at: expiresAt,
    },
    writes: 0,
  };
  const nowMs = () => Date.now();
  const isExpired = () => Date.parse(store.row.conversation_state_expires_at) <= nowMs();

  const mockSupabase = {
    from: jest.fn((table) => {
      if (table !== 'users') throw new Error(`unexpected table ${table}`);
      const api = {};
      api.select = () => api;
      api.eq = () => api;
      api.in = () => api;
      api.not = () => api;
      api.gte = () => api;
      api.order = () => api;
      // sweepExpired: .lt(expiry).not(...).limit(n) -> awaited
      api.lt = (_col, iso) => {
        api.__guardIso = iso;
        return api;
      };
      api.limit = () => ({
        then: (res) => {
          const rows = isExpired() ? [{ ...store.row }] : [];
          if (onSweepRead) onSweepRead(store);   // the teacher's write lands HERE
          return res({ data: rows, error: null });
        },
      });
      api.maybeSingle = () => Promise.resolve({ data: { ...store.row }, error: null });
      api.update = (patch) => {
        const upd = {
          __guard: null,
          eq: () => upd,
          lt: (_c, iso) => { upd.__guard = iso; return upd; },
          // guarded path asks for the affected rows back
          select: () => ({
            then: (res) => {
              const ok = !upd.__guard || Date.parse(store.row.conversation_state_expires_at) < Date.parse(upd.__guard);
              if (ok) { store.writes += 1; Object.assign(store.row, patch); }
              return res({ data: ok ? [{ id: USER }] : [], error: null });
            },
          }),
          then: (res) => {
            const ok = !upd.__guard || Date.parse(store.row.conversation_state_expires_at) < Date.parse(upd.__guard);
            if (ok) { store.writes += 1; Object.assign(store.row, patch); }
            return res({ error: null });
          },
        };
        return upd;
      };
      // the batch phone lookup awaits directly off .in()
      const inFn = api.in;
      api.in = () => ({ then: (res) => res({ data: [{ id: USER, phone_number: PHONE, preferred_language: 'en' }], error: null }) });
      void inFn;
      return api;
    }),
  };
  jest.doMock('../../bot/shared/config/supabase', () => mockSupabase);
  return store;
}

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const minutesAhead = (m) => new Date(Date.now() + m * 60_000).toISOString();

beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

describe('resume sweep vs a teacher who came back', () => {
  it('does NOT replace her live state with an offer, and does not message her', async () => {
    // She was expired when the sweep read the batch, then tapped something and got a
    // fresh 1h deadline before the sweeper reached her row.
    const store = harness({
      expiresAt: minutesAgo(45),
      onSweepRead: (s) => {
        s.row.conversation_state = {
          flow: 'menu', step: 'AWAITING_MENU_CHOICE', payload: {}, stack: [],
          version: 1, updated_at: new Date().toISOString(),
        };
        s.row.conversation_state_expires_at = minutesAhead(60);
      },
    });
    const Resume = require('../../bot/shared/services/conversation-resume.service');

    const tally = await Resume.sweepAndOffer({ limit: 100 });

    // Her fresh work survives, untouched.
    expect(store.row.conversation_state.flow).toBe('menu');
    expect(store.row.conversation_state.step).toBe('AWAITING_MENU_CHOICE');
    expect(store.writes).toBe(0);
    // And she is NOT asked about the task she already moved on from.
    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
    // The outcome is counted, so a silent no-op cannot look like a healthy sweep.
    expect(tally.skippedActive).toBe(1);
    expect(tally.offered).toBe(0);
  });

  it('CONTROL: still offers when she has NOT come back — the guard must not kill the feature', async () => {
    const store = harness({ expiresAt: minutesAgo(45) });
    const Resume = require('../../bot/shared/services/conversation-resume.service');

    const tally = await Resume.sweepAndOffer({ limit: 100 });

    expect(tally.offered).toBe(1);
    expect(tally.skippedActive || 0).toBe(0);
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(store.row.conversation_state.step).toBe('offered_resume');
    expect(store.row.conversation_state.payload.resumeStep).toBe('AWAITING_CLASSROOM_AUDIO');
  });
});
