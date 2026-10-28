/**
 * Round 8 item 4 (sa_r8_lang_switch): the child's or coach's language switch during the test is one event the phone
 * sends in its batch ({type:'lang_switch', task_id, value:{from, to, item_id}}). The session keeps it on
 * child_test_sessions.device.events (an existing column; no new table), so a run that changed language reads as one.
 * An event type the server does not know stays accepted and ignored (the batch is never refused for it).
 */
const SVC = '../../../bot/shared/services/child-test/app/sa-api.service';

const COACH = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';

function makeDeps() {
  const sessions = { [SESSION]: { id: SESSION, coach_user_id: COACH, school_id: SCHOOL, grade: 3, form: 'A', status: 'in_progress', item_bank_version: 'sa-battery', visit_key: 'day:x' } };
  return {
    store: {
      getSession: jest.fn(async (id) => ({ ok: true, session: sessions[id] || null })),
      setSessionStatus: jest.fn(async () => ({ ok: true })),
      recordTiming: jest.fn(async () => ({ ok: true })),
    },
    saStore: {
      findByClient: jest.fn(async () => ({ ok: true, sessionId: null })),
      putResults: jest.fn(async () => ({ ok: true })),
      markSynced: jest.fn(async () => ({ ok: true, device: {} })),
    },
    bank: { version: 'x', forms: {}, tasks: {} },
    scoreLater: false,
    env: 'sandbox',
    now: () => new Date('2026-10-28T09:00:00Z'),
    enabled: () => true,
    log: jest.fn(),
    logError: jest.fn(),
  };
}

describe('the language switch reaches the session', () => {
  beforeEach(() => jest.resetModules());
  test('lang_switch is kept with its task, time and from/to', async () => {
    const Svc = require(SVC);
    const deps = makeDeps();
    const events = [{ seq: 1, at: '2026-10-28T09:00:01Z', type: 'lang_switch', task_id: 'ma.add1', item_id: 'ma.add1.02', value: { from: 'ur', to: 'en', item_id: 'ma.add1.02' } }];
    const res = await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 1, seqTo: 1, events, results: [] }, deps);
    expect(res).toEqual({ status: 'ok', ackedTo: 1 });
    const kept = deps.saStore.markSynced.mock.calls[0][1].events;
    expect(kept).toEqual([{ seq: 1, type: 'lang_switch', task_id: 'ma.add1', at: '2026-10-28T09:00:01Z', data: { from: 'ur', to: 'en', item_id: 'ma.add1.02' } }]);
  });
  test('an event type the server does not know is accepted and dropped, never a refused batch', async () => {
    const Svc = require(SVC);
    const deps = makeDeps();
    const events = [{ seq: 1, at: '2026-10-28T09:00:01Z', type: 'some_future_event', task_id: 'ma.add1', value: { x: 1 } }];
    const res = await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 1, seqTo: 1, events, results: [] }, deps);
    expect(res).toEqual({ status: 'ok', ackedTo: 1 });
    expect(deps.saStore.markSynced.mock.calls[0][1].events).toBeUndefined();
  });
});
