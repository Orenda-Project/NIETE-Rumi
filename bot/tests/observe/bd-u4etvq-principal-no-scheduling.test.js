/**
 * bd-u4etvq, REVERSED by bd-31ziu8 (18 Nov): a principal books a visit exactly as a coach does.
 *
 * Operator, 18 Nov ~16:40: "I think there is one more difference that the principal does not do scheduling? If that is
 * the case, drop it. It has to be the same as coach." What #141 added for principals and is KEPT: /observe opens the
 * visit Flow for a principal (no leader_schools row needed), their own school (users.school_id) counts as one of theirs,
 * no empty Manage teachers row, and "My own lesson" (the DC). What is DROPPED: "Observe a teacher" / start at once.
 * The original (15 Nov) intent, for the record:
 *
 * Operator, 15 Nov: "for the principal, there is no need to schedule anything. You will just directly go and observe a
 * teacher, unlike a coach who has to schedule it first." Then: "principals never schedule; they observe whenever they
 * want. Coaches unchanged."
 *
 * Before: /observe (scheduling UI on) let only role 'coach' straight into the visit Flow; a principal with no
 * leader_schools row was redirected. Picking a teacher always led to a brief whose button was "Pick date & time", and
 * the observation ran from My schedule > Run.
 *
 *   - /observe opens the visit Flow for a principal, school row or not (as for a coach)
 *   - the menu says "Observe a teacher" to a principal and shows no empty "My schedule"; a coach's menu is unchanged
 *   - a principal whose only school is their own (users.school_id) gets the full menu, not "add your first school",
 *     and no Manage teachers row (that screen lists leader_schools holdings only)
 *   - picking a teacher takes a principal to the Start screen (BRIEF, "Start observation"); a coach still gets the
 *     brief with "Pick date & time". A Flow published before this change (no at_once marker) keeps the old screen, so
 *     the code can deploy before the Flow is republished.
 *   - a principal can never open the date picker: "Pick date & time" on an old Flow starts the observation instead
 *   - the visit Flow JSON: the teacher pickers carry at_once and may route to BRIEF; still forward-only
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow-123';
process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'observe-on'; // the market's /observe switch

const fs = require('fs');
const path = require('path');

// Phone-shaped fixtures are built at runtime from parts: the repo is public (tests/setup/phone-shaped-fixtures).
const mockPh = (rest) => `92${rest}`;

const mockUsers = {
  'principal-own': { id: 'principal-own', role: 'principal', preferred_language: 'ur', school_id: 'sOwn',
    phone_number: mockPh('3000000001'), preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' } },
  'principal-held': { id: 'principal-held', role: 'principal', preferred_language: 'en', school_id: 'sOwn2',
    phone_number: mockPh('3000000002'), preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' } },
  'principal-none': { id: 'principal-none', role: 'principal', preferred_language: 'ur', school_id: null,
    phone_number: mockPh('3000000003'), preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' } },
  'coach-1': { id: 'coach-1', role: 'coach', preferred_language: 'en', school_id: 'sCoachHome',
    phone_number: mockPh('3000000004'), preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' } },
};
let mockCurrentUser = 'principal-own';
const mockHoldings = { 'principal-own': [], 'principal-held': [{ school_ext_id: 'niete:502', school_name: 'Held' }],
  'principal-none': [], 'coach-1': [{ school_ext_id: 'niete:502', school_name: 'Held' }] };
const mockUpcoming = { n: 0 };

jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const api = {
      select: () => api,
      eq: () => api,
      // observe-command's leaderHasAssignment: leader_schools rows of the current user
      limit: () => Promise.resolve({ data: table === 'leader_schools' ? (mockHoldings[mockCurrentUser] || []) : [], error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      maybeSingle: () => Promise.resolve({ data: mockUsers[mockCurrentUser] || null, error: null }),
      single: () => Promise.resolve({ data: mockUsers[mockCurrentUser] || null, error: null }),
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
  countUpcoming: jest.fn(async () => mockUpcoming.n), markDone: jest.fn(async () => {}),
  SLOTS: ['08:00'],
}));
jest.mock('../../shared/services/observe/observe-school-admin.service', () => ({
  listMySchools: jest.fn(async (uid) => mockHoldings[uid] || []),
}));
jest.mock('../../shared/services/observe/school-week', () => ({ schoolWeekFor: jest.fn(async () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) }));
jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  resolveTeacher: jest.fn(async (uid, ext) => ({
    teacher_ext_id: ext, teacher_name: 'Own Teacher One', phone_e164: ext, user_id: 'tO1', preferred_language: 'ur' })),
  listSchools: jest.fn(async () => [{ school_ext_id: 'niete:501', school_name: 'IMSG Own School', teacherCount: 2, dueCount: 2 }]),
  listTeachers: jest.fn(async () => [{ teacher_ext_id: mockPh('3110000001'), teacher_name: 'Own Teacher One', school_ext_id: 'niete:501' }]),
  buildBrief: jest.fn(async () => ({ teacher: { teacher_name: 'Own Teacher One', school_name: 'IMSG Own School', preferred_language: 'ur' }, moves: [], trend: [], noData: true })),
  leaderLang: jest.fn(async () => 'ur'),
  leaderProfile: jest.fn(async (id) => {
    const u = mockUsers[id];
    return u ? { role: u.role, preferred_language: u.preferred_language, school_id: u.school_id } : null;
  }),
}));
jest.mock('../../shared/services/menu.service');
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'chat-1') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/region', () => ({ detectRegion: jest.fn(() => 'pakistan') }));

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const { maybeLaunchVisitFlow, handleObserveCommand } = require('../../shared/handlers/observe-command.handler');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const LeaderSource = require('../../shared/services/observe/assignment/leader-source');

const FLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/flows/observe-visit-v2.json'), 'utf8'));
const screenOf = (id) => FLOW.screens.find((s) => s.id === id);
const footerOf = (node) => {
  let hit = null;
  (function walk(n) {
    if (!n || hit) return;
    if (n.type === 'Footer') { hit = n; return; }
    for (const c of (n.children || [])) walk(c);
  }(node.layout));
  return hit;
};

const ids = (res) => ((res && res.data && res.data.items) || []).map((i) => i.id);
const row = (res, id) => ((res && res.data && res.data.items) || []).find((i) => i.id === id);
const as = (uid) => { mockCurrentUser = uid; return uid; };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = 'principal-own';
  mockUpcoming.n = 0;
  ObserveState.__state.current = null;
  process.env.OBSERVE_SCHEDULING_UI = 'true';
});

describe('/observe opens the visit Flow for a principal', () => {
  test('a principal with no leader_schools row goes straight in, like a coach (no redirect line)', async () => {
    const u = mockUsers[as('principal-own')];
    expect(await maybeLaunchVisitFlow(u, u.phone_number)).toBe('launched');
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
  });

  test('the /observe command: one Flow, nothing else sent', async () => {
    const u = mockUsers[as('principal-own')];
    expect(await handleObserveCommand(u, u.phone_number, '/observe')).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a principal with no school at all is let in too: the menu offers "add a school" and their own lesson', async () => {
    const u = mockUsers[as('principal-none')];
    expect(await maybeLaunchVisitFlow(u, u.phone_number)).toBe('launched');
    const res = await handler.handle(u.id, 'INIT', '', {}, u.id);
    expect(ids(res)).toEqual(['manage', 'self_dc']);
  });

  test('a coach: unchanged (straight in)', async () => {
    const u = mockUsers[as('coach-1')];
    expect(await maybeLaunchVisitFlow(u, u.phone_number)).toBe('launched');
  });
});

describe('the /observe menu', () => {
  test('a principal whose only school is their own: the coach\'s menu (My schedule, Schedule new observation), no Manage teachers', async () => {
    const res = await handler.handle(as('principal-own'), 'INIT', '', {}, 'principal-own');
    expect(res.screen).toBe('MENU');
    expect(ids(res)).toEqual(['schedule', 'new', 'self_dc', 'manage']);
    expect(row(res, 'new')['main-content']).toEqual({ title: 'Schedule new observation', metadata: 'Pick a school and teacher' });
    expect(row(res, 'schedule')['main-content'].title).toBe('My schedule');
    expect(row(res, 'new')['on-click-action']).toEqual({ name: 'data_exchange', payload: { step: 'schools' } });
  });

  test('a principal with holdings keeps Manage teachers', async () => {
    const res = await handler.handle(as('principal-held'), 'INIT', '', {}, 'principal-held');
    expect(ids(res)).toEqual(['schedule', 'new', 'self_dc', 'manage', 'manage_teachers']);
  });

  test('My schedule is there with no visits booked, as for a coach', async () => {
    mockUpcoming.n = 0;
    const res = await handler.handle(as('principal-held'), 'INIT', '', {}, 'principal-held');
    expect(ids(res)).toContain('schedule');
  });

  test('a coach: byte-for-byte the menu they had', async () => {
    const res = await handler.handle(as('coach-1'), 'INIT', '', {}, 'coach-1');
    expect(ids(res)).toEqual(['schedule', 'new', 'manage', 'manage_teachers']);
    expect(row(res, 'new')['main-content']).toEqual({ title: 'Schedule new observation', metadata: 'Pick a school and teacher' });
    expect(row(res, 'schedule')['main-content'].title).toBe('My schedule');
  });
});

describe('picking a teacher', () => {
  const pick = (uid, extra = {}) => handler.handle(uid, 'data_exchange', 'SELECT_TEACHER',
    { step: 'teacher', picked: mockPh('3110000001'), school_ext_id: 'niete:501', ...extra }, uid);

  test('a principal gets the brief with "Pick date & time", as a coach does (even when the Flow sends at_once)', async () => {
    const res = await pick(as('principal-own'), { at_once: '1' });
    expect(res.screen).toBe('BRIEF_SCHEDULE');
    expect(res.data).toMatchObject({ teacher_ext_id: mockPh('3110000001'), school_ext_id: 'niete:501' });
  });

  test('a principal searching by name: the same', async () => {
    as('principal-own');
    const res = await handler.handle('principal-own', 'data_exchange', 'TEACHER_RESULTS',
      { step: 'teacher', picked: mockPh('3110000001'), school_ext_id: '', at_once: '1' }, 'principal-own');
    expect(res.screen).toBe('BRIEF_SCHEDULE');
    expect(res.data.school_ext_id).toBe('niete:501');
  });

  test('a coach still gets the brief with "Pick date & time"', async () => {
    const res = await pick(as('coach-1'), { at_once: '1' });
    expect(res.screen).toBe('BRIEF_SCHEDULE');
  });

  test('a Flow published before this change (no at_once): the old screen, which the old Flow can route to', async () => {
    const res = await pick(as('principal-own'));
    expect(res.screen).toBe('BRIEF_SCHEDULE');
  });

  test('a failed profile read is treated as a coach: the booking path, never a guess', async () => {
    LeaderSource.leaderProfile.mockImplementationOnce(async () => null);
    const res = await pick(as('principal-own'), { at_once: '1' });
    expect(res.screen).toBe('BRIEF_SCHEDULE');
  });

  test('Start observation binds the teacher and arms the recording, as a coach\'s Run does', async () => {
    const res = await handler.handle(as('principal-own'), 'complete', 'BRIEF',
      { step: 'start', teacher_ext_id: mockPh('3110000001'), school_ext_id: 'niete:501' }, 'principal-own');
    expect(res).toMatchObject({ action: 'bound' });
    expect(ObserveState.__state.current).toMatchObject({ state: 'awaiting_audio', origin: 'observe' });
    expect(ObserveState.__state.current.boundTeacher).toMatchObject({ teacher_ext_id: mockPh('3110000001'), school_ext_id: 'niete:501' });
  });
});

describe('a principal books a visit, as a coach does (bd-31ziu8)', () => {
  test('"Pick date & time" opens the date picker for a principal', async () => {
    const res = await handler.handle(as('principal-own'), 'data_exchange', 'BRIEF_SCHEDULE',
      { step: 'to_picker', teacher_ext_id: mockPh('3110000001'), school_ext_id: 'niete:501', school_week: '1' }, 'principal-own');
    expect(res.screen).toBe('SCHEDULE_PICKER');
  });

  test('a coach still gets the date picker', async () => {
    const res = await handler.handle(as('coach-1'), 'data_exchange', 'BRIEF_SCHEDULE',
      { step: 'to_picker', teacher_ext_id: mockPh('3110000001'), school_ext_id: 'niete:501', school_week: '1' }, 'coach-1');
    expect(res.screen).toBe('SCHEDULE_PICKER');
  });
});

describe('the visit Flow JSON', () => {
  test.each(['SELECT_TEACHER', 'TEACHER_RESULTS'])('%s: its Continue carries at_once and may route to BRIEF', (id) => {
    const footer = footerOf(screenOf(id));
    expect(footer['on-click-action'].payload).toMatchObject({ step: 'teacher', at_once: '1' });
    expect(FLOW.routing_model[id]).toContain('BRIEF');
    expect(FLOW.routing_model[id]).toContain('BRIEF_SCHEDULE');
  });

  test('BRIEF stays terminal with no routes out, so the new routes are forward-only', () => {
    expect(screenOf('BRIEF').terminal).toBe(true);
    expect(FLOW.routing_model.BRIEF).toEqual([]);
    for (const [from, tos] of Object.entries(FLOW.routing_model)) {
      for (const to of tos) expect(FLOW.routing_model[to] || []).not.toContain(from);
    }
  });
});
