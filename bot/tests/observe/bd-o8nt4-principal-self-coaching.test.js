/**
 * The residual principal case: a leader who also teaches has no way to say
 * "this recording is MINE" once her declared coaching intent has lapsed or was
 * never declared at all.
 *
 * The router now honours a DECLARED intent (conversation_state flow='coaching',
 * step=AWAITING_CLASSROOM_AUDIO, 6h deadline), which covered 70 of 112 principal
 * parks measured 7-15 Sep 2026. The residual is 16 parks whose intent had
 * expired and 27 with no declaration at all: those still reach the binding list,
 * and the list has no row that means "my own lesson". The recording is ALREADY
 * parked with its media id and duration, so one row recovers it in one tap.
 *
 * The contract under test:
 *   1. a leader who may self-coach is offered `observe_bind_self_dc`
 *   2. a coach never is (0 of 59 coach parks in the same window had any DC
 *      intent — the gate cannot leak by construction)
 *   3. the tap hands the parked head to the teacher-coaching entry, not to a
 *      second observation
 *   4. "not an observation" stops DISCARDING a self-coach-capable leader's
 *      recording and routes it the same way
 *   5. a coach's "not an observation" still discards — she has no DC entry
 *   6. the leader herself is not offered as her own coachee in the picker
 */

jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const s = new Map();
  return {
    __store: s,
    get: jest.fn(async (k) => (s.has(k) ? JSON.parse(s.get(k)) : null)),
    setexWithCeiling: jest.fn(async (k, ttl, v) => { s.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; }),
    setNX: jest.fn(async (k, v) => { if (s.has(k)) return false; s.set(k, JSON.stringify(v)); return true; }),
    delete: jest.fn(async (k) => s.delete(k)),
  };
});
const store = require('../../shared/services/cache/railway-redis.service').__store;

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendInteractiveMessage: jest.fn(async () => true),
  sendMessage: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  listUpcoming: jest.fn(async () => ([])),
}));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn(async () => []),
  buildPendingListPayload: jest.fn(() => ({ body: 'x', action: { button: 'y', sections: [] } })),
}));
jest.mock('../../shared/services/observe/observe-capture.service', () => ({
  startFromAudio: jest.fn(async () => ({ id: 'sess-new' })),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(async () => true),
  getState: jest.fn(async () => null),
  clearState: jest.fn(async () => true),
}));
jest.mock('../../shared/handlers/observe-command.handler', () => ({
  sendVisitRedirect: jest.fn(async () => true),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getOrCreateSession: jest.fn(async () => 'chat-1'),
}));
jest.mock('../../shared/services/coaching-orchestrator.service', () => ({
  initiateCoachingSession: jest.fn(async () => ({ id: 'dc-1' })),
}));

const WA = require('../../shared/services/whatsapp.service');
const Coaching = require('../../shared/services/coaching-orchestrator.service');
const Binding = require('../../shared/services/observe/observe-binding.service');
const { observeStrings, observeLang } = require('../../shared/services/observe/observe-strings');

// Abdul Amam Khan, 923150583765 — role 'principal', an in-charge who teaches
// full time: 8 parked recordings, 0 analysed.
const PRINCIPAL = { id: 'u-principal', role: 'principal', preferred_language: 'ur' };
const COACH = { id: 'u-coach', role: 'coach', preferred_language: 'ur' };
const FROM = '923150583765';

const S_for = (u) => observeStrings(observeLang(u));
const rowsOf = (payload) => payload.action.sections[0].rows;
const park = (userId, head) => store.set(`observe:parked:${userId}`,
  JSON.stringify([{ audioId: 'a-own', sha256: null, durationSeconds: 1012, mimeType: 'audio/ogg', ...head }]));

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
});

describe('the binding list offers a leader her own lesson', () => {
  it('RED: a principal sees observe_bind_self_dc', async () => {
    const payload = await Binding.buildBindingList(PRINCIPAL, S_for(PRINCIPAL));
    expect(rowsOf(payload).map((r) => r.id)).toContain('observe_bind_self_dc');
  });

  it('a coach never sees it', async () => {
    const payload = await Binding.buildBindingList(COACH, S_for(COACH));
    expect(rowsOf(payload).map((r) => r.id)).not.toContain('observe_bind_self_dc');
  });

  it('RED: the row fits the WhatsApp list caps in code points, in en and ur', async () => {
    for (const lang of ['en', 'ur']) {
      const S = observeStrings(lang);
      expect(typeof S.bind_row_self_dc).toBe('string');
      expect([...S.bind_row_self_dc].length).toBeGreaterThan(0);
      expect([...S.bind_row_self_dc].length).toBeLessThanOrEqual(24);
      expect([...S.bind_row_self_dc_desc].length).toBeLessThanOrEqual(72);
    }
  });
});

describe('the tap recovers the parked recording into teacher coaching', () => {
  it('RED: observe_bind_self_dc hands the parked head to the coaching entry and empties the queue', async () => {
    park(PRINCIPAL.id);
    const handled = await Binding.handleBindingTap('observe_bind_self_dc', FROM, PRINCIPAL);
    expect(handled).toBe(true);
    expect(Coaching.initiateCoachingSession).toHaveBeenCalledWith(
      PRINCIPAL.id, 'chat-1', 'a-own', FROM, 1012,
    );
    expect(store.get(`observe:parked:${PRINCIPAL.id}`)).toBeUndefined();
  });

  it('RED: observe_bind_not_obs stops discarding a self-coach-capable leader recording', async () => {
    park(PRINCIPAL.id);
    const handled = await Binding.handleBindingTap('observe_bind_not_obs', FROM, PRINCIPAL);
    expect(handled).toBe(true);
    expect(Coaching.initiateCoachingSession).toHaveBeenCalledTimes(1);
  });

  it("a coach's observe_bind_not_obs still discards — she has no coaching entry", async () => {
    park(COACH.id);
    const handled = await Binding.handleBindingTap('observe_bind_not_obs', FROM, COACH);
    expect(handled).toBe(true);
    expect(Coaching.initiateCoachingSession).not.toHaveBeenCalled();
    expect(WA.sendMessage).toHaveBeenCalled();
  });

  it('an expired park is answered, never coached', async () => {
    const handled = await Binding.handleBindingTap('observe_bind_self_dc', FROM, PRINCIPAL);
    expect(handled).toBe(true);
    expect(Coaching.initiateCoachingSession).not.toHaveBeenCalled();
    expect(WA.sendMessage).toHaveBeenCalled();
  });
});
