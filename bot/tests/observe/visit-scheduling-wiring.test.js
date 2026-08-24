/**
 * bd-2444/bd-2445 — scheduling wiring (red-first):
 * detector discriminator, completion 3-way (start/debrief/done), the
 * flag-gated entry change (skip chat interception when the menu covers
 * debriefs), and the capture→markDone lifecycle.
 */

process.env.OBSERVE_MEWAKA_FLOW_ID = 'fico-form-flow';
process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow-123';
process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const mockDb = { leader_schools: [], sessionsInserted: [] };

jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const api = {
      select: () => api,
      eq: () => api,
      limit: () => Promise.resolve({
        data: table === 'leader_schools' ? mockDb.leader_schools.slice(0, 1) : [],
        error: null,
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: { id: 'coach-1', preferred_language: 'ur', preferences: {} }, error: null }),
      insert: (row) => {
        mockDb.sessionsInserted.push(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'sess-1', ...row }, error: null }) }) };
      },
    };
    return api;
  },
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({})),
  sendFlow: jest.fn(async () => ({})),
  sendInteractiveMessage: jest.fn(async () => ({})),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => {
  const state = { current: null };
  return {
    __state: state,
    setState: jest.fn(async (uid, s, d) => { state.current = { state: s, ...(d || {}) }; }),
    getState: jest.fn(async () => state.current),
    clearState: jest.fn(async () => { state.current = null; }),
  };
});
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn(async () => [{ id: 'sess-9' }]),
  listUnsentReports: jest.fn(async () => []),
  listUnfinished: jest.fn(async () => []),
  buildPendingListPayload: jest.fn(() => ({})),
  startDebrief: jest.fn(async () => {}),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(async () => ({})),
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  saveSchedule: jest.fn(), listUpcoming: jest.fn(async () => []),
  countUpcoming: jest.fn(async () => 0), markDone: jest.fn(async () => {}),
  SLOTS: [],
}));
jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  resolveTeacher: jest.fn(async () => ({
    teacher_ext_id: '923331234567', teacher_name: 'Abid Ullah',
    phone_e164: '923331234567', user_id: 'teacher-9', preferred_language: 'ur',
  })),
  listSchools: jest.fn(async () => []),
  listTeachers: jest.fn(async () => []),
  buildBrief: jest.fn(async () => ({ teacher: {}, moves: [], trend: [] })),
  leaderLang: jest.fn(async () => 'ur'),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/region', () => ({ detectRegion: jest.fn(() => 'pakistan') }));

const { detectFlowType } = require('../../shared/utils/flow-type-detector');
const { handleObserveCommand } = require('../../shared/handlers/observe-command.handler');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const ObserveDebrief = require('../../shared/services/observe/observe-debrief.service');
const Store = require('../../shared/services/observe/observe-schedule.service');
const { buildScheduleDoneAck } = require('../../shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'ur', preferences: { observe_onboarded: true } };
const URDU = /[؀-ۿ]/;

function nfm(payload) {
  return { interactive: { nfm_reply: { response_json: JSON.stringify(payload) } } };
}

beforeEach(() => {
  mockDb.leader_schools = [{ id: 'ls-1', leader_user_id: 'coach-1' }];
  mockDb.sessionsInserted = [];
  ObserveState.__state.current = null;
  process.env.OBSERVE_SCHEDULING_UI = 'true';
  jest.clearAllMocks();
});

describe('detector discriminator', () => {
  test('observe_visit_action payloads → observe_visit (colon token immune)', () => {
    expect(detectFlowType({ observe_visit_action: 'debrief', session_id: 's1', flow_token: 'a:b' })).toBe('observe_visit');
    expect(detectFlowType({ observe_visit_action: 'done', flow_token: 'coach-1' })).toBe('observe_visit');
  });
  test('legacy start payload + attendance fallback unchanged', () => {
    expect(detectFlowType({ step: 'start', teacher_ext_id: 'x', flow_token: 'a' })).toBe('observe_visit');
    expect(detectFlowType({ flow_token: 'a:b' })).toBe('attendance_marking');
  });
});

describe('completion 3-way', () => {
  test('debrief tap → startDebrief with session id + user row', async () => {
    const FlowResponseHandler = require('../../shared/handlers/flow-response.handler');
    const ok = await FlowResponseHandler.handleObserveVisitFlow(
      nfm({ flow_token: 'coach-1', observe_visit_action: 'debrief', session_id: 'sess-9' }), '92326', 'coach-1');
    expect(ok).toBe(true);
    expect(ObserveDebrief.startDebrief).toHaveBeenCalledWith('sess-9', '92326', expect.objectContaining({ id: 'coach-1' }));
  });

  test('done → localized Urdu ack naming teacher + /observe re-entry; no bind', async () => {
    const FlowResponseHandler = require('../../shared/handlers/flow-response.handler');
    await FlowResponseHandler.handleObserveVisitFlow(
      nfm({ flow_token: 'coach-1', observe_visit_action: 'done', teacher_name: 'Abid Ullah', sched_date: '2026-08-06', sched_slot: '08:30' }), '92326', 'coach-1');
    const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join(' ');
    expect(sent).toContain('Abid Ullah');
    expect(sent).toContain('/observe');
    expect(URDU.test(sent)).toBe(true); // coach preferred_language = ur
    const armed = ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio');
    expect(armed).toBeUndefined();
  });

  test('start (legacy payload) still binds + prompts — regression pin', async () => {
    const FlowResponseHandler = require('../../shared/handlers/flow-response.handler');
    await FlowResponseHandler.handleObserveVisitFlow(
      nfm({ flow_token: 'coach-1', step: 'start', teacher_ext_id: '923331234567', school_ext_id: 'niete:401' }), '92326', 'coach-1');
    const armed = ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio');
    expect(armed[2].boundTeacher.user_id).toBe('teacher-9');
    expect(armed[2].boundTeacher.school_ext_id).toBe('niete:401'); // NEW: school rides along for markDone
  });
});

describe('entry-point flag gate', () => {
  test('flag ON + assigned: /observe launches the Flow, chat interception SKIPPED', async () => {
    const handled = await handleObserveCommand(COACH, '92326', '/observe');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
  });

  test('flag OFF: pending-debrief interception first — today pinned', async () => {
    process.env.OBSERVE_SCHEDULING_UI = '';
    const handled = await handleObserveCommand(COACH, '92326', '/observe');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });

  test('flag ON + NOT assigned: a coach now gets the Flow (bd-0cxz6)', async () => {
    // bd-0cxz6 (R53, Fatima 18 Aug): this asserted the OPPOSITE until 19 Aug —
    // that a coach with no assignment keeps the legacy path. That WAS the bug.
    // The menu is the only route to "Add a school", so gating the menu on
    // already having one locked 22 of 80 production coaches out of /observe.
    // A coach now gets the Flow regardless of assignment; a non-coach without
    // one still falls back (pinned by the non-coach test).
    mockDb.leader_schools = [];
    const handled = await handleObserveCommand(COACH, '92326', '/observe');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
  });
});

describe('capture → markDone lifecycle', () => {
  test('bound capture retires the matching schedule with the session id', async () => {
    const ObserveCapture = require('../../shared/services/observe/observe-capture.service');
    ObserveState.__state.current = {
      state: 'awaiting_audio', arm: 'functional',
      boundTeacher: { teacher_ext_id: '923331234567', school_ext_id: 'niete:401', teacher_name: 'Abid Ullah', phone_e164: '923331234567', user_id: 'teacher-9', preferred_language: 'ur' },
    };
    await ObserveCapture.startFromAudio(COACH, '92326', 'audio-1', 'ext-1', 120);
    expect(Store.markDone).toHaveBeenCalledWith('coach-1', '923331234567', 'niete:401', 'sess-1');
  });

  test('unbound capture never touches schedules; markDone failure never blocks capture', async () => {
    const ObserveCapture = require('../../shared/services/observe/observe-capture.service');
    ObserveState.__state.current = { state: 'awaiting_audio', arm: 'functional' };
    await ObserveCapture.startFromAudio(COACH, '92326', 'audio-1', 'ext-2', 120);
    expect(Store.markDone).not.toHaveBeenCalled();
    ObserveState.__state.current = {
      state: 'awaiting_audio', arm: 'functional',
      boundTeacher: { teacher_ext_id: 't', school_ext_id: 's', user_id: 'teacher-9' },
    };
    Store.markDone.mockRejectedValueOnce(new Error('boom'));
    const session = await ObserveCapture.startFromAudio(COACH, '92326', 'audio-1', 'ext-3', 120);
    expect(session).toBeTruthy();
  });
});

describe('buildScheduleDoneAck', () => {
  test('ur + en variants name the teacher, date/slot, and /observe', () => {
    const ur = buildScheduleDoneAck('ur', { teacherName: 'Abid Ullah', date: '2026-08-06', slot: '08:30' });
    expect(URDU.test(ur)).toBe(true);
    expect(ur).toContain('Abid Ullah');
    expect(ur).toContain('/observe');
    const en = buildScheduleDoneAck('en', { teacherName: 'Abid Ullah', date: '2026-08-06', slot: '08:30' });
    expect(en).toContain('6 Aug');
    expect(en).toContain('08:30');
    expect(en).toContain('/observe');
  });
});
