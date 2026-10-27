/**
 * Round 7b: every skip and stop is one event record, kept on the session (child_test_sessions.device.events — an
 * existing column; no new table). type ∈ back | end_section | end_test | restart | silence_repeat | incomplete_move_on;
 * the session, the child and the coach are the session row's; the subtask is task_id; at is the phone's time.
 * The kept-events cap never drops one of these.
 */
const SVC = '../../../bot/shared/services/child-test/app/sa-api.service';

const COACH = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const STOP_TYPES = ['back', 'end_section', 'end_test', 'restart', 'silence_repeat', 'incomplete_move_on'];

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
    now: () => new Date('2026-10-27T09:00:00Z'),
    enabled: () => true,
    log: jest.fn(),
    logError: jest.fn(),
  };
}

describe('the stop events reach the session', () => {
  beforeEach(() => jest.resetModules());
  test('each of the six types is kept with its task, time and data', async () => {
    const Svc = require(SVC);
    const deps = makeDeps();
    const events = STOP_TYPES.map((type, i) => ({ seq: i + 1, at: '2026-10-27T09:00:0' + i + 'Z', type, task_id: 'ur.letters', value: { by: 'coach' } }));
    const res = await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 1, seqTo: 6, events, results: [] }, deps);
    expect(res).toEqual({ status: 'ok', ackedTo: 6 });
    const kept = deps.saStore.markSynced.mock.calls[0][1].events;
    expect(kept.map((e) => e.type)).toEqual(STOP_TYPES);
    expect(kept[0]).toEqual({ seq: 1, type: 'back', task_id: 'ur.letters', at: '2026-10-27T09:00:00Z', data: { by: 'coach' } });
  });
  test('STOP_TYPES is exported for the dashboard', () => {
    expect(require(SVC).STOP_TYPES).toEqual(STOP_TYPES);
  });
});

describe('the kept-events cap (sa-store.js) never drops a stop event', () => {
  test('past 200 other events, a later stop event is still kept', () => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({}));
    const { __internals: { keepEvents } } = require('../../../bot/shared/services/child-test/sa-store');
    const flood = Array.from({ length: 250 }, (_, i) => ({ seq: i, type: 'visibility_lost' }));
    const out = keepEvents([], [...flood, { seq: 300, type: 'end_test' }, { seq: 301, type: 'back' }]);
    expect(out.filter((e) => e.type === 'visibility_lost')).toHaveLength(200);
    expect(out.slice(-2).map((e) => e.type)).toEqual(['end_test', 'back']);
  });
});
