/**
 * Round 8 (sa_r8_reading_position): when the child read nothing aloud, the phone skips the story's questions and logs
 * one no_reading_skip event { by: 'app', story, voiced_s, min_s }. The session keeps it (device.events), as it keeps
 * the round 7b stops; the questions' own result says skipped_no_voice. STOP_TYPES (the dashboard's stop audit) is
 * unchanged.
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

describe('no_reading_skip reaches the session', () => {
  beforeEach(() => jest.resetModules());
  test('the event is kept with its task and data; the skipped questions\' result goes in as sent', async () => {
    const Svc = require(SVC);
    const deps = makeDeps();
    const value = { by: 'app', story: 'ur.story_w3', voiced_s: 0.4, min_s: 1 };
    const events = [{ seq: 1, at: '2026-10-28T09:00:01Z', type: 'no_reading_skip', task_id: 'ur.story_comp_w3', value }];
    const results = [{ task_id: 'ur.story_comp_w3', mode: 'oral', stop_reason: 'skipped_no_voice', scored_on: 'none', attempted: 0 }];
    const res = await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 1, seqTo: 1, events, results }, deps);
    expect(res).toEqual({ status: 'ok', ackedTo: 1 });
    expect(deps.saStore.markSynced.mock.calls[0][1].events).toEqual([{ seq: 1, type: 'no_reading_skip', task_id: 'ur.story_comp_w3', at: '2026-10-28T09:00:01Z', data: value }]);
    expect(deps.saStore.putResults.mock.calls[0][1][0]).toMatchObject({ stop_reason: 'skipped_no_voice' });
  });
  test('STOP_TYPES is unchanged', () => {
    expect(require(SVC).STOP_TYPES).toEqual(['back', 'end_section', 'end_test', 'restart', 'silence_repeat', 'incomplete_move_on']);
  });
});
