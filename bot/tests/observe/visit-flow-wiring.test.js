/**
 * bd-2432 — the five wiring seams for the visit picker on NIETE:
 *  1. flow-type-detector: observe_visit detected ABOVE the loose attendance
 *     fallback that eats any colon-bearing flow_token.
 *  2. observe-command: maybeLaunchVisitFlow gate (env + leader_schools row),
 *     dark when env unset, fallback to bare capture when no assignment.
 *  3. flow-response: completion arms awaiting_audio + sends the FICO capture
 *     prompt naming the bound teacher.
 *  4. observe-capture: a bound teacher owns the session row; observer split kept.
 *  5. observe-strings: buildVisitCapturePrompt (en/ur, framework name, no MEWAKA).
 */

process.env.OBSERVE_MEWAKA_FLOW_ID = 'fico-form-flow';
process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow-123';
process.env.OBSERVE_FRAMEWORK = 'fico'; // prod NIETE parity — the capture prompt names the live pack
// flow-response.handler's require-graph instantiates API clients at import —
// dummy env keeps the suite hermetic (repo pattern: setupFilesAfterEnv is empty).
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

// ── shared mocks ────────────────────────────────────────────────────────────
const mockDb = { leader_schools: [], sessionsInserted: [] };

jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const api = {
      _table: table,
      select: () => api,
      eq: () => api,
      limit: () => Promise.resolve({
        data: table === 'leader_schools' ? mockDb.leader_schools.slice(0, 1) : [],
        error: null,
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
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
  listPendingDebriefs: jest.fn(async () => []),
  listUnsentReports: jest.fn(async () => []),
  buildPendingListPayload: jest.fn(() => ({})),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(async () => ({})),
}));
jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  resolveTeacher: jest.fn(async () => ({
    teacher_ext_id: '923331234567', teacher_name: 'Abid Ullah',
    phone_e164: '923331234567', user_id: 'teacher-9', preferred_language: 'ur',
  })),
  listSchools: jest.fn(async () => []),
  listTeachers: jest.fn(async () => []),
  buildBrief: jest.fn(async () => ({ teacher: {}, moves: [], trend: [] })),
  leaderLang: jest.fn(async () => 'en'),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/region', () => ({ detectRegion: jest.fn(() => 'pakistan') }));

const { detectFlowType } = require('../../shared/utils/flow-type-detector');
const { maybeLaunchVisitFlow, handleObserveCommand } = require('../../shared/handlers/observe-command.handler');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const { buildVisitCapturePrompt } = require('../../shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'ur', preferences: { observe_onboarded: true } };

beforeEach(() => {
  mockDb.leader_schools = [];
  mockDb.sessionsInserted = [];
  ObserveState.__state.current = null;
  jest.clearAllMocks();
});

describe('1. flow-type-detector', () => {
  test('completion payload → observe_visit, NOT eaten by the loose attendance fallback', () => {
    // flow_token carries a ':' — exactly what the loose attendance_marking
    // fallback matches today. The observe_visit rule must win.
    expect(detectFlowType({ step: 'start', teacher_ext_id: '923331234567', flow_token: 'coach-1' }))
      .toBe('observe_visit');
    expect(detectFlowType({ step: 'start', teacher_ext_id: 'x', flow_token: 'a:b' }))
      .toBe('observe_visit');
  });

  test('existing detections unchanged', () => {
    expect(detectFlowType({ flow_token: 'a:b' })).toBe('attendance_marking');
  });
});

describe('2. maybeLaunchVisitFlow gate', () => {
  test('env set + assignment → sends the Flow with flowToken=user.id', async () => {
    mockDb.leader_schools = [{ id: 'ls-1', leader_user_id: 'coach-1' }];
    const launched = await maybeLaunchVisitFlow(COACH, '923268124132');
    expect(launched).toBe(true);
    const call = WhatsAppService.sendFlow.mock.calls[0];
    expect(call[1].flowId).toBe('visit-flow-123');
    expect(call[1].flowToken).toBe('coach-1');
  });

  test('no assignment → TRUE for a coach (the menu is how she adds her first school)', async () => {
    // bd-0cxz6 (R53, Fatima 18 Aug): this asserted the OPPOSITE until 19 Aug —
    // that a coach with no assignment keeps the legacy path. That WAS the bug.
    // The menu is the only route to "Add a school", so gating the menu on
    // already having one locked 22 of 80 production coaches out of /observe.
    // A coach now gets the Flow regardless of assignment; a non-coach without
    // one still falls back (pinned by the non-coach test).
    mockDb.leader_schools = [];
    expect(await maybeLaunchVisitFlow(COACH, '92326')).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
  });

  test('no assignment AND not a coach → still false', async () => {
    mockDb.leader_schools = [];
    const TEACHER = { id: 'teacher-1', role: 'teacher', preferred_language: 'ur' };
    expect(await maybeLaunchVisitFlow(TEACHER, '92326')).toBe(false);
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });

  test('null user never throws', async () => {
    expect(await maybeLaunchVisitFlow(null, '92326')).toBe(false);
  });

  test('/observe capture branch routes through the picker when assigned', async () => {
    mockDb.leader_schools = [{ id: 'ls-1', leader_user_id: 'coach-1' }];
    const handled = await handleObserveCommand(COACH, '923268124132', '/observe');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
  });

  test('/observe without assignment now opens the Flow for a coach (bd-0cxz6)', async () => {
    const handled = await handleObserveCommand(COACH, '923268124132', '/observe');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
  });
});

describe('3. completion → capture prompt', () => {
  test('handleObserveVisitFlow arms awaiting_audio and names the teacher + FICO', async () => {
    const FlowResponseHandler = require('../../shared/handlers/flow-response.handler');
    const message = {
      interactive: {
        nfm_reply: {
          response_json: JSON.stringify({
            flow_token: 'coach-1', step: 'start',
            teacher_ext_id: '923331234567', school_ext_id: 'niete:401',
          }),
        },
      },
    };
    const ok = await FlowResponseHandler.handleObserveVisitFlow(message, '923268124132', 'coach-1');
    expect(ok).toBe(true);
    const armed = ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio');
    expect(armed[2].boundTeacher.user_id).toBe('teacher-9');
    const prompt = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join(' ');
    expect(prompt).toContain('Abid Ullah');
    expect(prompt).not.toMatch(/MEWAKA/i);
  });
});

describe('4. capture binding', () => {
  test('bound teacher owns the session; observer split preserved', async () => {
    const ObserveCapture = require('../../shared/services/observe/observe-capture.service');
    ObserveState.__state.current = {
      state: 'awaiting_audio', arm: 'functional',
      boundTeacher: { teacher_ext_id: '923331234567', teacher_name: 'Abid Ullah', phone_e164: '923331234567', user_id: 'teacher-9', preferred_language: 'ur' },
    };
    const session = await ObserveCapture.startFromAudio(COACH, '923268124132', 'audio-1', 'sess-ext-1', 120);
    expect(session).toBeTruthy();
    const row = mockDb.sessionsInserted[0];
    expect(row.user_id).toBe('teacher-9');          // the TEACHER owns the row → trend keys on her
    expect(row.observer_user_id).toBe('coach-1');   // the coach stays the observer
    expect(row.observation_type).toBe('leader_observation');
  });

  test('no bound teacher → unchanged behavior (observer owns the row)', async () => {
    const ObserveCapture = require('../../shared/services/observe/observe-capture.service');
    ObserveState.__state.current = { state: 'awaiting_audio', arm: 'functional' };
    await ObserveCapture.startFromAudio(COACH, '923268124132', 'audio-1', 'sess-ext-2', 120);
    const row = mockDb.sessionsInserted[0];
    expect(row.user_id).toBe('coach-1');
    expect(row.observer_user_id).toBe('coach-1');
  });
});

describe('5. buildVisitCapturePrompt', () => {
  test('en names teacher + framework; ur is Urdu; no MEWAKA on FICO', () => {
    const en = buildVisitCapturePrompt('en', { teacherName: 'Abid Ullah', framework: 'FICO' });
    expect(en).toContain('Abid Ullah');
    expect(en).toContain('FICO');
    const ur = buildVisitCapturePrompt('ur', { teacherName: 'Abid Ullah', framework: 'FICO' });
    expect(/[؀-ۿ]/.test(ur)).toBe(true);
    expect(ur).toContain('Abid Ullah');
    expect(buildVisitCapturePrompt('en', { framework: 'FICO' })).not.toMatch(/MEWAKA/i);
  });
});
