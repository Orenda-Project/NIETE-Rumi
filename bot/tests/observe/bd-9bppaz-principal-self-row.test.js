/**
 * bd-9bppaz — a principal choosing THEMSELVES in /observe gets the Digital Coach, never an observation.
 *
 * Operator, 15 Nov: "When they select themselves it is a DC flow, and when they choose their teachers it is an HITL
 * flow." The /observe menu (the visit Flow, scheduling UI on) only offered observing someone else: the teacher picker
 * never lists the leader (leader-source.js, "a leader is never her own coachee"), and a principal with no school saw
 * nothing but "Add or remove a school". A recording sent first already offers "My own lesson" in the binding list
 * (observe-binding.service); this adds the same choice to the /observe menu.
 *
 *   - a principal (may self-coach AND observe) sees a "My own lesson" row; a coach never does
 *   - tapping it closes the Flow with observe_visit_action 'self_dc'
 *   - the chat side opens the Classroom Coaching door (MenuService._handleClassroomCoachingChoice), clears any armed
 *     observe state, and binds no teacher
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow-123';

const mockUsers = {
  'principal-1': { id: 'principal-1', role: 'principal', preferred_language: 'ur', preferences: { observe_onboarded: true } },
  'principal-en': { id: 'principal-en', role: 'principal', preferred_language: 'en', preferences: { observe_onboarded: true } },
  'coach-1': { id: 'coach-1', role: 'coach', preferred_language: 'ur', preferences: { observe_onboarded: true } },
};
let mockCurrentUser = 'principal-1';
const mockSchools = { list: [{ school_ext_id: 'niete:401', school_name: 'Test School' }] };

jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const api = {
      select: () => api,
      eq: () => api,
      limit: () => Promise.resolve({ data: [], error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      maybeSingle: () => Promise.resolve({ data: mockUsers[mockCurrentUser] || null, error: null }),
      single: () => Promise.resolve({ data: mockUsers[mockCurrentUser] || null, error: null }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'sess-1' }, error: null }) }) }),
    };
    return api;
  },
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({})),
  sendFlow: jest.fn(async () => ({})),
  sendInteractiveMessage: jest.fn(async () => ({})),
  sendInteractiveButtons: jest.fn(async () => ({})),
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
  listUnfinished: jest.fn(async () => []),
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  saveSchedule: jest.fn(), listUpcoming: jest.fn(async () => []),
  countUpcoming: jest.fn(async () => 0), markDone: jest.fn(async () => {}),
  SLOTS: [],
}));
jest.mock('../../shared/services/observe/observe-school-admin.service', () => ({
  listMySchools: jest.fn(async () => mockSchools.list),
}));
jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  resolveTeacher: jest.fn(async () => null),
  listSchools: jest.fn(async () => []),
  listTeachers: jest.fn(async () => []),
  buildBrief: jest.fn(async () => ({ teacher: {}, moves: [], trend: [] })),
  leaderLang: jest.fn(async () => 'ur'),
  leaderProfile: jest.fn(async (id) => {
    const u = mockUsers[id];
    return u ? { role: u.role, preferred_language: u.preferred_language } : null;
  }),
}));
jest.mock('../../shared/services/menu.service');
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'chat-1') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/region', () => ({ detectRegion: jest.fn(() => 'pakistan') }));

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const LeaderSource = require('../../shared/services/observe/assignment/leader-source');
const MenuService = require('../../shared/services/menu.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');

const URDU = /[؀-ۿ]/;
const selfRow = (res) => ((res && res.data && res.data.items) || []).find((i) => i.id === 'self_dc');

function nfm(payload) {
  return { interactive: { nfm_reply: { response_json: JSON.stringify(payload) } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = 'principal-1';
  mockSchools.list = [{ school_ext_id: 'niete:401', school_name: 'Test School' }];
  ObserveState.__state.current = null;
  process.env.OBSERVE_SCHEDULING_UI = 'true';
});

describe('the /observe menu offers a principal their own lesson', () => {
  test('a principal sees "My own lesson", in their language, tapping it asks the endpoint for self_dc', async () => {
    const res = await handler.handle('principal-1', 'INIT', '', {}, 'principal-1');
    expect(res.screen).toBe('MENU');
    const row = selfRow(res);
    expect(row).toBeDefined();
    expect(URDU.test(row['main-content'].title)).toBe(true);
    expect(row['main-content'].title.length).toBeLessThanOrEqual(30);
    expect(row['main-content'].metadata.length).toBeLessThanOrEqual(80);
    expect(row['on-click-action']).toEqual({ name: 'data_exchange', payload: { step: 'self_dc' } });
    // observing a teacher is still there
    expect(res.data.items.map((i) => i.id)).toContain('new');
  });

  test('English for a principal who reads English', async () => {
    mockCurrentUser = 'principal-en';
    const row = selfRow(await handler.handle('principal-en', 'INIT', '', {}, 'principal-en'));
    expect(row['main-content'].title).toBe('My own lesson');
  });

  test('a principal with no school still sees it, after "add your first school"', async () => {
    mockSchools.list = [];
    const res = await handler.handle('principal-1', 'INIT', '', {}, 'principal-1');
    expect(res.data.items.map((i) => i.id)).toEqual(['manage', 'self_dc']);
  });

  test('a coach never sees it (coaches observe, they are not coached here)', async () => {
    mockCurrentUser = 'coach-1';
    const res = await handler.handle('coach-1', 'INIT', '', {}, 'coach-1');
    expect(selfRow(res)).toBeUndefined();
  });

  test('a failed profile read shows no row (never offer DC on a guess)', async () => {
    LeaderSource.leaderProfile.mockImplementationOnce(async () => null);
    const res = await handler.handle('principal-1', 'INIT', '', {}, 'principal-1');
    expect(selfRow(res)).toBeUndefined();
  });

  test('BACK to the menu keeps the row', async () => {
    const res = await handler.handle('principal-1', 'BACK', 'SELECT_SCHOOL', {}, 'principal-1');
    expect(selfRow(res)).toBeDefined();
  });
});

describe('tapping it closes the Flow as self_dc', () => {
  test('a principal: SUCCESS carrying observe_visit_action self_dc, and no teacher bound', async () => {
    const res = await handler.handle('principal-1', 'data_exchange', 'MENU', { step: 'self_dc' }, 'principal-1');
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.extension_message_response.params.observe_visit_action).toBe('self_dc');
    const armed = ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio');
    expect(armed).toBeUndefined();
  });

  test('a coach who sends self_dc anyway gets the menu back, not a DC handoff', async () => {
    mockCurrentUser = 'coach-1';
    const res = await handler.handle('coach-1', 'data_exchange', 'MENU', { step: 'self_dc' }, 'coach-1');
    expect(res.screen).toBe('MENU');
  });
});

describe('the chat side opens the Digital Coach door', () => {
  test('self_dc → Classroom Coaching door in the principal\'s language; armed observe state cleared; no capture prompt', async () => {
    ObserveState.__state.current = { state: 'awaiting_pick', schoolExtId: 'niete:401' };
    const FlowResponseHandler = require('../../shared/handlers/flow-response.handler');
    const ok = await FlowResponseHandler.handleObserveVisitFlow(
      nfm({ flow_token: 'principal-1', observe_visit_action: 'self_dc', visit_next: 'done' }), '92326', 'principal-1');
    expect(ok).toBe(true);
    expect(ObserveState.clearState).toHaveBeenCalledWith('principal-1');
    expect(MenuService._handleClassroomCoachingChoice).toHaveBeenCalledWith('principal-1', 'chat-1', '92326', 'ur');
    // nothing that belongs to an observation
    expect(WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join(' ')).not.toMatch(/observing|record it and send me the audio/i);
    expect(ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio')).toBeUndefined();
  });

  test('a coach\'s forged self_dc opens nothing', async () => {
    mockCurrentUser = 'coach-1';
    const FlowResponseHandler = require('../../shared/handlers/flow-response.handler');
    await FlowResponseHandler.handleObserveVisitFlow(
      nfm({ flow_token: 'coach-1', observe_visit_action: 'self_dc' }), '92326', 'coach-1');
    expect(MenuService._handleClassroomCoachingChoice).not.toHaveBeenCalled();
  });
});
