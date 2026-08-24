/**
 * bd-2443 — the scheduling UI endpoint screens (red-first).
 * Everything gated on OBSERVE_SCHEDULING_UI: flag OFF pins today's behavior
 * byte-for-byte (INIT → legacy SELECT_SCHOOL NavigationList); flag ON serves
 * MENU / DEBRIEFS / SCHEDULE / Dropdown pickers / picker / confirm / SUCCESS.
 */

process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow-123';

const mockTeachers = [];
const mockSchools = [];
const mockSchedules = [];
const mockPendings = [];
const mockUnsent = [];
const mockState = { current: null };

jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  listSchools: jest.fn(async () => mockSchools),
  listTeachers: jest.fn(async () => mockTeachers),
  buildBrief: jest.fn(async () => ({
    teacher: { teacher_name: 'Abid Ullah', school_name: 'IMCB Bhara Kau', preferred_language: 'ur', grade: null },
    strengthLabel: 's', growthLabel: 'g',
    moves: [{ areaKey: 'x', text: 'm1' }, { areaKey: 'y', text: 'm2' }, { areaKey: 'z', text: 'm3' }],
    trend: [], showTrend: false, firstVisit: true, noData: false,
  })),
  resolveTeacher: jest.fn(async () => ({
    teacher_ext_id: '923331234567', teacher_name: 'Abid Ullah',
    phone_e164: '923331234567', user_id: 'teacher-1', preferred_language: 'ur',
  })),
  leaderLang: jest.fn(async () => 'ur'),
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  saveSchedule: jest.fn(async (uid, args) => ({ id: 'os-1', ...args, scheduled_for: args.date, scheduled_slot: args.slot, status: 'upcoming' })),
  listUpcoming: jest.fn(async () => mockSchedules),
  countUpcoming: jest.fn(async () => mockSchedules.length),
  markDone: jest.fn(async () => {}),
  SLOTS: ['07:30', '13:30'],
}));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn(async () => mockPendings),
  listUnsentReports: jest.fn(async () => mockUnsent),
  listUnfinished: jest.fn(async () => []),
}));
// bd-0cxz6: menuScreen now asks how many schools she has, so this suite needs
// the same stub treatment as every other service it already mocks — otherwise
// the real module loads shared/config/supabase, which process.exit(78)s here.
jest.mock('../../shared/services/observe/observe-school-admin.service', () => ({
  listMySchools: jest.fn(async () => [{ school_ext_id: 'niete:401', school_name: 'Test School' }]),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(async (uid, s, d) => { mockState.current = { state: s, ...(d || {}) }; }),
  getState: jest.fn(async () => mockState.current),
  clearState: jest.fn(async () => { mockState.current = null; }),
}));
jest.mock('../../shared/services/observe/observe-gate', () => ({ getObserveArm: jest.fn(() => 'functional') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const Store = require('../../shared/services/observe/observe-schedule.service');

const URDU = /[؀-ۿ]/;

beforeEach(() => {
  mockTeachers.length = 0; mockSchools.length = 0; mockSchedules.length = 0;
  mockPendings.length = 0; mockUnsent.length = 0; mockState.current = null;
  process.env.OBSERVE_SCHEDULING_UI = 'true';
  jest.clearAllMocks();
});

describe('flag OFF — legacy pin', () => {
  test('INIT returns the legacy SELECT_SCHOOL NavigationList', async () => {
    process.env.OBSERVE_SCHEDULING_UI = '';
    mockSchools.push({ school_ext_id: 'niete:401', school_name: 'IMCB Bhara Kau', teacherCount: 3, dueCount: 1 });
    const res = await handler.handle('coach-1', 'INIT', '', {}, 'coach-1');
    expect(res.screen).toBe('SELECT_SCHOOL');
    expect(res.data.items[0]['main-content'].title).toBe('IMCB Bhara Kau'); // NavigationList shape
    expect(res.data.options).toBeUndefined();
  });
});

describe('MENU (flag ON)', () => {
  test('INIT → MENU with live counts; Latin-only chrome; no version field', async () => {
    mockPendings.push({ id: 'sess-1', created_at: '2026-07-29T10:00:00Z', analysis_data: {} });
    mockSchedules.push({ id: 'os-1', teacher_name: 'A', school_name: 'S', scheduled_for: '2026-08-06', scheduled_slot: '08:30', overdue: false, school_ext_id: 's', teacher_ext_id: 't' });
    const res = await handler.handle('coach-1', 'INIT', '', {}, 'coach-1');
    expect(res.screen).toBe('MENU');
    expect(res.version).toBeUndefined();
    const [d, s, n] = res.data.items;
    expect(d['main-content'].metadata).toContain('1');
    expect(s['main-content'].metadata).toContain('1');
    expect(n['on-click-action'].payload.step).toBe('schools');
    expect(URDU.test(JSON.stringify(res.data.items))).toBe(false);
  });

  test('menu counts degrade to 0 on service failure (never throws)', async () => {
    const Debrief = require('../../shared/services/observe/observe-debrief.service');
    Debrief.listPendingDebriefs.mockRejectedValueOnce(new Error('boom'));
    const res = await handler.handle('coach-1', 'INIT', '', {}, 'coach-1');
    expect(res.screen).toBe('MENU');
  });
});

describe('DEBRIEFS', () => {
  test('debrief rows on DEBRIEFS; unsent rows on their own stage screen (bd-tju8f)', async () => {
    mockPendings.push({ id: 'sess-1', created_at: '2026-07-29T10:00:00Z', analysis_data: { teacher_delivery: { teacher_name: 'Abid Ullah' } } });
    mockUnsent.push({ id: 'sess-2', created_at: '2026-07-28T10:00:00Z', analysis_data: {} });
    const res = await handler.handle('coach-1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'coach-1');
    expect(res.screen).toBe('DEBRIEFS');
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]['main-content'].title).toBe('Abid Ullah');
    expect(res.data.items[0]['on-click-action']).toEqual({
      name: 'complete',
      payload: { observe_visit_action: 'debrief', session_id: 'sess-1' },
    });
    const snd = await handler.handle('coach-1', 'data_exchange', 'MENU', { step: 'work_send' }, 'coach-1');
    expect(snd.data.items).toHaveLength(1);
    expect(snd.data.items[0]['on-click-action'].payload).toEqual(
      { observe_visit_action: 'send_report', session_id: 'sess-2' });
  });

  test('empty → self-refreshing placeholder item (no dead tap)', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'coach-1');
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]['on-click-action'].payload.step).toBe('debriefs');
  });
});

describe('SCHEDULE screen', () => {
  test('Dropdown options: overdue-first with Overdue prefix, date - slot metadata', async () => {
    mockSchedules.push(
      { id: 'os-2', teacher_name: 'Past Teacher', school_name: 'S1', school_ext_id: 's1', teacher_ext_id: 'p', scheduled_for: '2020-01-01', scheduled_slot: '08:30', overdue: true },
      { id: 'os-3', teacher_name: 'Future Teacher', school_name: 'S2', school_ext_id: 's2', teacher_ext_id: 'f', scheduled_for: '2026-08-06', scheduled_slot: '10:00', overdue: false },
    );
    const res = await handler.handle('coach-1', 'data_exchange', 'MENU', { step: 'schedule' }, 'coach-1');
    expect(res.screen).toBe('SCHEDULE');
    expect(res.data.options[0].title).toBe('Past Teacher');
    expect(res.data.options[0].metadata).toMatch(/^Overdue/);
    expect(res.data.options[1].metadata).toContain('10:00');
    expect(URDU.test(JSON.stringify(res.data.options))).toBe(false);
  });

  test('empty schedule → placeholder option; picking it re-serves SCHEDULE', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'MENU', { step: 'schedule' }, 'coach-1');
    expect(res.data.options).toHaveLength(1);
    const again = await handler.handle('coach-1', 'data_exchange', 'SCHEDULE', { step: 'sched_teacher', picked: res.data.options[0].id }, 'coach-1');
    expect(again.screen).toBe('SCHEDULE');
  });

  // bd-88krt changed this contract: picking a row now opens the action bar
  // (run / reschedule / cancel) instead of jumping straight to the brief.
  // Running the observation is still one tap away, and BACK still returns to
  // SCHEDULE — both asserted below, so the original guarantee survives.
  test('picking a schedule row → VISIT_ACTION, then "run" → BRIEF with origin remembered', async () => {
    mockSchedules.push({ id: 'os-1', teacher_name: 'Abid Ullah', school_name: 'IMCB', school_ext_id: 'niete:401', teacher_ext_id: '923331234567', scheduled_for: '2026-08-06', scheduled_slot: '08:30', overdue: false });
    const bar = await handler.handle('coach-1', 'data_exchange', 'SCHEDULE', { step: 'sched_teacher', picked: 'os-1' }, 'coach-1');
    expect(bar.screen).toBe('VISIT_ACTION');
    expect(bar.data.visit_id).toBe('os-1');
    expect(bar.data.summary).toContain('Abid Ullah');

    const res = await handler.handle('coach-1', 'data_exchange', 'VISIT_ACTION', { step: 'visit_action', visit_id: 'os-1', choice: 'run' }, 'coach-1');
    expect(res.screen).toBe('BRIEF');
    expect(res.data.teacher_ext_id).toBe('923331234567');
    // BACK from BRIEF (schedule origin) returns to SCHEDULE, not the teacher list
    const back = await handler.handle('coach-1', 'BACK', 'BRIEF', {}, 'coach-1');
    expect(back.screen).toBe('SCHEDULE');
  });

  test('choosing "reschedule" opens the edit screen with a date window and slots', async () => {
    mockSchedules.push({ id: 'os-2', teacher_name: 'Abid Ullah', school_name: 'IMCB', school_ext_id: 'niete:401', teacher_ext_id: '923331234567', scheduled_for: '2026-08-06', scheduled_slot: '08:30', overdue: false });
    const res = await handler.handle('coach-1', 'data_exchange', 'VISIT_ACTION', { step: 'visit_action', visit_id: 'os-2', choice: 'reschedule' }, 'coach-1');
    expect(res.screen).toBe('SCHEDULE_EDIT');
    expect(res.data.visit_id).toBe('os-2');
    expect(res.data.min_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(res.data.slots)).toBe(true);
  });

  test('an unknown visit id falls back to the schedule rather than dead-ending', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'VISIT_ACTION', { step: 'visit_action', visit_id: 'nope', choice: 'cancel' }, 'coach-1');
    expect(res.screen).toBe('SCHEDULE');
  });
});

describe('schedule-new path (Dropdown pickers)', () => {
  beforeEach(() => {
    mockSchools.push({ school_ext_id: 'niete:401', school_name: 'IMCB Bhara Kau', teacherCount: 3, dueCount: 1 });
    mockTeachers.push({ teacher_ext_id: '923331234567', teacher_name: 'Abid Ullah', phone_e164: '923331234567', user_id: 'teacher-1', level: 'HIGH', lastVisitAt: null, priority: 'new', needsSupport: true, score: null, growthAreaKey: null });
  });

  test('schools step → Dropdown options (id = school_ext_id)', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'MENU', { step: 'schools' }, 'coach-1');
    expect(res.screen).toBe('SELECT_SCHOOL');
    expect(res.data.options[0]).toMatchObject({ id: 'niete:401', title: 'IMCB Bhara Kau' });
  });

  test('school picked → SELECT_TEACHER Dropdown with support metadata', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'SELECT_SCHOOL', { step: 'school', picked: 'niete:401' }, 'coach-1');
    expect(res.screen).toBe('SELECT_TEACHER');
    expect(res.data.school_ext_id).toBe('niete:401');
    expect(res.data.options[0].metadata).toContain('Needs support');
  });

  test('legacy NavigationList school tap (school_ext_id, no picked) still serves the legacy teacher list', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'SELECT_SCHOOL', { step: 'school', school_ext_id: 'niete:401' }, 'coach-1');
    expect(res.screen).toBe('SELECT_TEACHER');
    expect(res.data.items).toBeDefined(); // NavigationList shape, not Dropdown
  });

  test('teacher picked → BRIEF_SCHEDULE (brief fields + ids)', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'SELECT_TEACHER', { step: 'teacher', picked: '923331234567', school_ext_id: 'niete:401' }, 'coach-1');
    expect(res.screen).toBe('BRIEF_SCHEDULE');
    expect(res.data.teacher_name).toBe('Abid Ullah');
    expect(res.data.teacher_ext_id).toBe('923331234567');
  });

  test('legacy teacher tap (teacher_ext_id, no picked) still lands on BRIEF', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'SELECT_TEACHER', { step: 'teacher', teacher_ext_id: '923331234567', school_ext_id: 'niete:401' }, 'coach-1');
    expect(res.screen).toBe('BRIEF');
  });

  test('to_picker → SCHEDULE_PICKER with min/max dates and recap', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'BRIEF_SCHEDULE', { step: 'to_picker', teacher_ext_id: '923331234567', school_ext_id: 'niete:401' }, 'coach-1');
    expect(res.screen).toBe('SCHEDULE_PICKER');
    expect(res.data.min_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.data.max_date > res.data.min_date).toBe(true);
    expect(res.data.recap).toContain('Abid Ullah');
  });

  test('save_schedule → CONFIRM_SCHEDULED with recap + params for the done exit', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'SCHEDULE_PICKER',
      { step: 'save_schedule', obs_date: '2026-08-06', obs_slot: '08:30', teacher_ext_id: '923331234567', school_ext_id: 'niete:401' }, 'coach-1');
    expect(Store.saveSchedule).toHaveBeenCalledWith('coach-1', expect.objectContaining({ date: '2026-08-06', slot: '08:30' }));
    expect(res.screen).toBe('CONFIRM_SCHEDULED');
    expect(res.data.recap).toContain('Abid Ullah');
    expect(res.data.sched_date).toBe('2026-08-06');
  });

  test('done → SUCCESS close with observe_visit_action + recap params', async () => {
    const res = await handler.handle('coach-1', 'data_exchange', 'CONFIRM_SCHEDULED',
      { step: 'done', teacher_name: 'Abid Ullah', sched_date: '2026-08-06', sched_slot: '08:30' }, 'coach-1');
    expect(res.screen).toBe('SUCCESS');
    const params = res.data.extension_message_response.params;
    expect(params.observe_visit_action).toBe('done');
    expect(params.teacher_name).toBe('Abid Ullah');
    expect(params.flow_token).toBe('coach-1');
  });

  test('"Observe someone now" (step schedule from CONFIRM) → SCHEDULE incl. the new row', async () => {
    mockSchedules.push({ id: 'os-1', teacher_name: 'Abid Ullah', school_name: 'IMCB', school_ext_id: 'niete:401', teacher_ext_id: '923331234567', scheduled_for: '2026-08-06', scheduled_slot: '08:30', overdue: false });
    const res = await handler.handle('coach-1', 'data_exchange', 'CONFIRM_SCHEDULED', { step: 'schedule' }, 'coach-1');
    expect(res.screen).toBe('SCHEDULE');
    expect(res.data.options[0].title).toBe('Abid Ullah');
  });
});

describe('BACK matrix (flag ON)', () => {
  test('DEBRIEFS/SCHEDULE/SELECT_SCHOOL → MENU; SELECT_TEACHER → SELECT_SCHOOL; SCHEDULE_PICKER → BRIEF_SCHEDULE; CONFIRM → SCHEDULE', async () => {
    mockSchools.push({ school_ext_id: 'niete:401', school_name: 'S', teacherCount: 1, dueCount: 0 });
    mockTeachers.push({ teacher_ext_id: 't1', teacher_name: 'T', level: 'HIGH', lastVisitAt: null, priority: 'new', needsSupport: false });
    expect((await handler.handle('coach-1', 'BACK', 'DEBRIEFS', {}, 'coach-1')).screen).toBe('MENU');
    expect((await handler.handle('coach-1', 'BACK', 'SCHEDULE', {}, 'coach-1')).screen).toBe('MENU');
    expect((await handler.handle('coach-1', 'BACK', 'SELECT_SCHOOL', {}, 'coach-1')).screen).toBe('MENU');
    expect((await handler.handle('coach-1', 'BACK', 'SELECT_TEACHER', {}, 'coach-1')).screen).toBe('SELECT_SCHOOL');
    await handler.handle('coach-1', 'data_exchange', 'SELECT_TEACHER', { step: 'teacher', picked: 't1', school_ext_id: 'niete:401' }, 'coach-1');
    expect((await handler.handle('coach-1', 'BACK', 'SCHEDULE_PICKER', {}, 'coach-1')).screen).toBe('BRIEF_SCHEDULE');
    expect((await handler.handle('coach-1', 'BACK', 'CONFIRM_SCHEDULED', {}, 'coach-1')).screen).toBe('SCHEDULE');
  });

  test('flag OFF: legacy BACK pin — BACK leaving SELECT_TEACHER → legacy school list', async () => {
    process.env.OBSERVE_SCHEDULING_UI = '';
    mockSchools.push({ school_ext_id: 'niete:401', school_name: 'S', teacherCount: 1, dueCount: 0 });
    const res = await handler.handle('coach-1', 'BACK', 'SELECT_TEACHER', {}, 'coach-1');
    expect(res.screen).toBe('SELECT_SCHOOL');
    expect(res.data.items).toBeDefined(); // legacy NavigationList shape
  });
});
