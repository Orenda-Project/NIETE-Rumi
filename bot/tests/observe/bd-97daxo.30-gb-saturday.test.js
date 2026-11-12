/**
 * bd-97daxo.30 — a Gilgit-Baltistan coach can schedule an observation on a Saturday.
 *
 * Ali Ahmed (GB), NIETE prod, 12 Nov: "GB school days are Mon - Sat, but selecting an observation date does not allow
 * selecting Sat". The visit Flow's two CalendarPickers (SCHEDULE_PICKER, SCHEDULE_EDIT) had a fixed
 * include-days of Mon-Fri. Nothing else refuses a Saturday: the bot's and the portal's schedule writers check only
 * that the date is a real YYYY-MM-DD, and the portal's day strip already lets a coach pick one.
 *
 * Now the pickers read ${data.include_days} and the endpoint sends the visit school's week: Mon-Sat for a
 * Gilgit-Baltistan school, Mon-Fri for every other region (ICT unchanged).
 *
 * The published Flow and the deployed bot change at different moments: Meta keeps serving the old JSON until the
 * asset is republished, and that is only allowed once the endpoint is live. A screen that declares a key it is not
 * sent fails, and sending a key a screen does not declare is not safe either (assessment-limit-and-errors.test.js).
 * So the new Flow's two buttons that open a picker say school_week '1', and only then does the endpoint add
 * include_days. The old Flow never says it and gets exactly today's data.
 */

process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow-123';

const mockRows = { leader_schools: [], schools: [], users: [] };
const mockFail = { on: false };

function mockChain(table) {
  const filters = [];
  const run = () => {
    if (mockFail.on) return Promise.resolve({ data: null, error: { message: 'boom' } });
    let out = mockRows[table] || [];
    for (const [col, val] of filters) out = out.filter((r) => r[col] === val);
    return Promise.resolve({ data: out, error: null });
  };
  const api = {
    select: () => api,
    eq: (col, val) => { filters.push([col, val]); return api; },
    limit: () => api,
    maybeSingle: () => run().then((r) => ({ data: r.data ? (r.data[0] || null) : null, error: r.error })),
    then: (ok, ko) => run().then(ok, ko),
  };
  return api;
}

jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockChain(t) }));

const mockSchedules = [];
jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  listSchools: jest.fn(async () => [
    { school_ext_id: 'niete:gb-test-primary-rumi-qa', school_name: 'GB Test Primary (Rumi QA)', teacherCount: 2, dueCount: 2 },
    { school_ext_id: 'niete:401', school_name: 'IMCB Bhara Kau', teacherCount: 3, dueCount: 1 },
  ]),
  listTeachers: jest.fn(async () => []),
  buildBrief: jest.fn(async () => ({
    teacher: { teacher_name: 'Amina Karim (Test)', school_name: 'GB Test Primary (Rumi QA)', preferred_language: 'en', grade: null },
    strengthLabel: null, growthLabel: null, moves: [], trend: [], showTrend: false, firstVisit: true, noData: true,
  })),
  resolveTeacher: jest.fn(async () => ({
    teacher_ext_id: '923990108101', teacher_name: 'Amina Karim (Test)', phone_e164: '923990108101', user_id: 't-1', preferred_language: 'en',
  })),
  leaderLang: jest.fn(async () => 'en'),
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  saveSchedule: jest.fn(async (uid, args) => ({ id: 'os-1', ...args, scheduled_for: args.date, scheduled_slot: args.slot, status: 'upcoming' })),
  listUpcoming: jest.fn(async () => mockSchedules),
  countUpcoming: jest.fn(async () => mockSchedules.length),
  rescheduleById: jest.fn(async () => true),
  cancelById: jest.fn(async () => true),
  markDone: jest.fn(async () => {}),
  SLOTS: ['07:30', '13:30'],
}));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn(async () => []),
  listUnsentReports: jest.fn(async () => []),
  listUnfinished: jest.fn(async () => []),
}));
jest.mock('../../shared/services/observe/observe-school-admin.service', () => ({
  listMySchools: jest.fn(async () => []),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(async () => {}),
  getState: jest.fn(async () => null),
  clearState: jest.fn(async () => {}),
}));
jest.mock('../../shared/services/observe/observe-gate', () => ({ getObserveArm: jest.fn(() => 'functional') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const flow = require('../../../docs/flows/observe-visit-v2.json');
const handler = require('../../shared/handlers/observe-visit-flow.handler');
// Required per call, so a missing module fails these tests alone and the rest still say what is wrong.
const schoolWeekForRegion = (r) => require('../../shared/services/observe/school-week').schoolWeekForRegion(r);

const MON_FRI = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MON_SAT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COACH = 'coach-1';
const GB_SCHOOL = 'niete:gb-test-primary-rumi-qa';
const ICT_SCHOOL = 'niete:401';

const screenOf = (id) => flow.screens.find((s) => s.id === id);
function findAll(node, pred, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, pred, out));
  else if (node && typeof node === 'object') {
    if (pred(node)) out.push(node);
    Object.values(node).forEach((v) => findAll(v, pred, out));
  }
  return out;
}
const actionsWithStep = (screenId, step) => findAll(screenOf(screenId).layout,
  (n) => n.name === 'data_exchange' && n.payload && n.payload.step === step);

beforeEach(() => {
  process.env.OBSERVE_SCHEDULING_UI = 'true';
  mockFail.on = false;
  mockRows.leader_schools = [
    { leader_user_id: COACH, school_ext_id: GB_SCHOOL, school_id: 's-gb' },
    { leader_user_id: COACH, school_ext_id: ICT_SCHOOL, school_id: 's-401' },
  ];
  mockRows.schools = [
    { id: 's-gb', region: 'Gilgit-Baltistan' },
    { id: 's-401', region: 'Sihala' },
  ];
  mockRows.users = [{ id: COACH, region: 'Gilgit-Baltistan' }];
  mockSchedules.length = 0;
});

describe('the Flow JSON: both pickers take the school week from the endpoint', () => {
  test.each(['SCHEDULE_PICKER', 'SCHEDULE_EDIT'])('%s: include-days is ${data.include_days}, declared as an array', (id) => {
    const s = screenOf(id);
    const pickers = findAll(s.layout, (n) => n.type === 'CalendarPicker');
    expect(pickers).toHaveLength(1);
    expect(pickers[0]['include-days']).toBe('${data.include_days}');
    expect(s.data.include_days).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(s.data.include_days.__example__).toEqual(MON_FRI);
  });

  test('the two buttons that open a picker say the Flow reads the school week', () => {
    const toPicker = actionsWithStep('BRIEF_SCHEDULE', 'to_picker');
    const visitAction = actionsWithStep('VISIT_ACTION', 'visit_action');
    expect(toPicker).toHaveLength(1);
    expect(visitAction).toHaveLength(1);
    expect(toPicker[0].payload.school_week).toBe('1');
    expect(visitAction[0].payload.school_week).toBe('1');
  });
});

describe('the school week of a region', () => {
  test.each([
    ['Gilgit-Baltistan', MON_SAT],
    ['gilgit_baltistan', MON_SAT], // one self-registered principal's spelling on prod
    ['  GILGIT-BALTISTAN ', MON_SAT],
    ['Sihala', MON_FRI],
    ['Urban-I', MON_FRI],
    ['', MON_FRI],
    [null, MON_FRI],
    [undefined, MON_FRI],
  ])('%p → %p', (region, week) => {
    expect(schoolWeekForRegion(region)).toEqual(week);
  });

  test('a caller cannot change the shared list', () => {
    schoolWeekForRegion('Gilgit-Baltistan').push('Sun');
    schoolWeekForRegion('Sihala').push('Sat');
    expect(schoolWeekForRegion('Gilgit-Baltistan')).toEqual(MON_SAT);
    expect(schoolWeekForRegion('Sihala')).toEqual(MON_FRI);
  });
});

describe('SCHEDULE_PICKER (Schedule from a teacher brief)', () => {
  const open = (school, extra = {}) => handler.handle(COACH, 'data_exchange', 'BRIEF_SCHEDULE',
    { step: 'to_picker', teacher_ext_id: '923990108101', school_ext_id: school, school_week: '1', ...extra }, COACH);

  test('a Gilgit-Baltistan school: Monday to Saturday', async () => {
    const res = await open(GB_SCHOOL);
    expect(res.screen).toBe('SCHEDULE_PICKER');
    expect(res.data.include_days).toEqual(MON_SAT);
  });

  test('an ICT school: Monday to Friday, as today', async () => {
    const res = await open(ICT_SCHOOL);
    expect(res.data.include_days).toEqual(MON_FRI);
  });

  test('the school is not one of hers: her own region decides', async () => {
    const res = await open('niete:999');
    expect(res.data.include_days).toEqual(MON_SAT);
    mockRows.users = [{ id: COACH, region: 'Tarnol' }];
    expect((await open('niete:999')).data.include_days).toEqual(MON_FRI);
  });

  test('a failed read is Monday to Friday, never a refusal', async () => {
    mockFail.on = true;
    const res = await open(GB_SCHOOL);
    expect(res.screen).toBe('SCHEDULE_PICKER');
    expect(res.data.include_days).toEqual(MON_FRI);
  });

  test('the Flow published today (no school_week) gets exactly the data it declares', async () => {
    const res = await open(GB_SCHOOL, { school_week: undefined });
    expect(res.data).not.toHaveProperty('include_days');
    expect(Object.keys(res.data).sort()).toEqual(['max_date', 'min_date', 'recap', 'school_ext_id', 'teacher_ext_id']);
  });

  test('every key it sends is one the new screen declares, and every declared key is sent', async () => {
    const res = await open(GB_SCHOOL);
    expect(Object.keys(res.data).sort()).toEqual(Object.keys(screenOf('SCHEDULE_PICKER').data).sort());
  });
});

describe('SCHEDULE_EDIT (Reschedule an upcoming visit)', () => {
  const reschedule = (extra = {}) => handler.handle(COACH, 'data_exchange', 'VISIT_ACTION',
    { step: 'visit_action', visit_id: 'os-9', choice: 'reschedule', school_week: '1', ...extra }, COACH);

  const visitAt = (school) => mockSchedules.push({
    id: 'os-9', school_ext_id: school, teacher_ext_id: '923990108101', teacher_name: 'Amina Karim (Test)',
    school_name: 'X', scheduled_for: '2026-11-16', scheduled_slot: '08:30', overdue: false,
  });

  test('a visit at a Gilgit-Baltistan school: Monday to Saturday', async () => {
    visitAt(GB_SCHOOL);
    const res = await reschedule();
    expect(res.screen).toBe('SCHEDULE_EDIT');
    expect(res.data.include_days).toEqual(MON_SAT);
  });

  test('a visit at an ICT school: Monday to Friday, as today', async () => {
    visitAt(ICT_SCHOOL);
    mockRows.users = [{ id: COACH, region: 'Sihala' }];
    expect((await reschedule()).data.include_days).toEqual(MON_FRI);
  });

  test('the Flow published today gets exactly the data it declares', async () => {
    visitAt(GB_SCHOOL);
    const res = await reschedule({ school_week: undefined });
    expect(res.data).not.toHaveProperty('include_days');
  });

  test('every key it sends is one the new screen declares, and every declared key is sent', async () => {
    visitAt(GB_SCHOOL);
    const res = await reschedule();
    expect(Object.keys(res.data).sort()).toEqual(Object.keys(screenOf('SCHEDULE_EDIT').data).sort());
  });
});

describe('a Saturday visit saves like any other day', () => {
  test('save_schedule passes a Saturday through to the store', async () => {
    const Store = require('../../shared/services/observe/observe-schedule.service');
    const res = await handler.handle(COACH, 'data_exchange', 'SCHEDULE_PICKER',
      { step: 'save_schedule', obs_date: '2026-11-14', obs_slot: '08:30', teacher_ext_id: '923990108101', school_ext_id: GB_SCHOOL }, COACH);
    expect(res.screen).toBe('CONFIRM_SCHEDULED');
    expect(Store.saveSchedule).toHaveBeenCalledWith(COACH, expect.objectContaining({ date: '2026-11-14' }));
    expect(res.data.recap).toMatch(/^Amina Karim \(Test\) - Sat 14 Nov at 08:30/);
  });
});
