/**
 * bd-43530 — what SELECT_TEACHER actually PUTS ON THE SCREEN (red-first).
 *
 * The row a coach reads must name the whole person and give a dialable phone:
 *   title       = full name          (30 cap; prod max is 29 code points)
 *   description = phone, ALONE       (legacy NavigationList caps this at 20 —
 *                                     a 12-digit phone fits, "LEVEL · phone"
 *                                     does not, and a clipped phone is worse
 *                                     than none)
 *   metadata    = level · status     (80 cap — "Needs support · Last visited")
 *
 * Both UIs are covered: the legacy NavigationList (`items`) and the v2 Dropdown
 * (`options`). The operator named the v2 one ("visited / not visited"), but both
 * are live at once by design — code and the Flow asset deploy at different
 * moments, so a fix in only one is a fix a coach may not get.
 */

process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow-123';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const mockTeachers = [];

jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  listSchools: jest.fn(async () => [{ school_ext_id: 'niete:401', school_name: 'IMCB Bhara Kau', teacherCount: 1, dueCount: 0 }]),
  listTeachers: jest.fn(async () => mockTeachers),
  buildBrief: jest.fn(async () => ({ teacher: {}, moves: [], trend: [], firstVisit: true })),
  leaderLang: jest.fn(async () => 'en'),
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  listUpcoming: jest.fn(async () => []), countUpcoming: jest.fn(async () => 0), SLOTS: ['07:30'],
}));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn(async () => []), listUnsentReports: jest.fn(async () => []),
  listUnfinished: jest.fn(async () => []),
}));
jest.mock('../../shared/services/observe/observe-school-admin.service', () => ({
  listMySchools: jest.fn(async () => [{ school_ext_id: 'niete:401', school_name: 'IMCB Bhara Kau' }]),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(async () => {}), getState: jest.fn(async () => null), clearState: jest.fn(async () => {}),
}));
jest.mock('../../shared/services/observe/observe-gate', () => ({ getObserveArm: jest.fn(() => 'functional') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const handler = require('../../shared/handlers/observe-visit-flow.handler');

const teacher = (over = {}) => ({
  teacher_ext_id: '923001234567',
  teacher_name: 'Muhammad Kashif Rafique',
  phone_e164: '923001234567',
  user_id: 'u1',
  level: 'PRIMARY',
  grade: null,
  lastVisitAt: null,
  needsSupport: false,
  priority: 'new',
  ...over,
});

const reset = (...rows) => { mockTeachers.length = 0; mockTeachers.push(...rows); };

// v2 Dropdown — the screen the operator pointed at.
const optionsFor = async () => {
  process.env.OBSERVE_SCHEDULING_UI = 'true';
  const res = await handler.handle('coach-1', 'data_exchange', 'SELECT_SCHOOL',
    { step: 'school', picked: 'niete:401' }, 'coach-1');
  expect(res.screen).toBe('SELECT_TEACHER');
  return res.data.options;
};

// legacy NavigationList — still live until the Flow asset catches up.
const itemsFor = async () => {
  process.env.OBSERVE_SCHEDULING_UI = 'false';
  const res = await handler.handle('coach-1', 'data_exchange', 'SELECT_SCHOOL',
    { step: 'school', school_ext_id: 'niete:401' }, 'coach-1');
  expect(res.screen).toBe('SELECT_TEACHER');
  return res.data.items;
};

describe('bd-43530 · SELECT_TEACHER (v2 Dropdown) names the person and gives her number', () => {
  beforeEach(() => reset(teacher()));

  it('shows the FULL name in the title, not a first name', async () => {
    expect((await optionsFor())[0].title).toBe('Muhammad Kashif Rafique');
  });

  it('shows the phone from users.phone_number, on its own line', async () => {
    expect((await optionsFor())[0].description).toBe('923001234567');
  });

  it('keeps the level and the visit status on the metadata line', async () => {
    const md = (await optionsFor())[0].metadata;
    expect(md).toContain('PRIMARY');
    expect(md).toContain('Not yet visited');
  });

  it('still surfaces "Needs support" and the last-visit date', async () => {
    reset(teacher({ needsSupport: true, lastVisitAt: '2026-06-12T09:00:00Z' }));
    const md = (await optionsFor())[0].metadata;
    expect(md).toContain('Needs support');
    expect(md).toContain('Last visited 12 Jun');
  });
});

describe('bd-43530 · SELECT_TEACHER (legacy NavigationList) gets the same treatment', () => {
  beforeEach(() => reset(teacher()));

  it('full name in the title', async () => {
    expect((await itemsFor())[0]['main-content'].title).toBe('Muhammad Kashif Rafique');
  });

  it('phone in the description', async () => {
    expect((await itemsFor())[0]['main-content'].description).toBe('923001234567');
  });

  it('level and status in the metadata', async () => {
    const mc = (await itemsFor())[0]['main-content'];
    expect(mc.metadata).toContain('PRIMARY');
    expect(mc.metadata).toContain('Not yet visited');
  });
});

describe('bd-43530 · a phone is never half-printed, and never faked', () => {
  it('a long level cannot eat the phone — the whole number survives (legacy 20-char description)', async () => {
    reset(teacher({ level: 'EARLY_YEARS' }));
    const desc = (await itemsFor())[0]['main-content'].description;
    expect(desc).toBe('923001234567');
    expect(desc).not.toMatch(/…/);
    const md = (await itemsFor())[0]['main-content'].metadata;
    expect(md).toContain('EARLY_YEARS');
  });

  it('no phone on the row → no description at all, rather than an empty gap or "null"', async () => {
    reset(teacher({ phone_e164: null, teacher_ext_id: 'name:kashif' }));
    const o = (await optionsFor())[0];
    expect(o.description || '').not.toMatch(/null|undefined/);
    expect(o.description || '').toBe('');
    expect(o.title).toBe('Muhammad Kashif Rafique');
  });

  it('falls back to the ext id when it IS the phone — 980 of 992 schedules key on it', async () => {
    reset(teacher({ phone_e164: null }));
    expect((await optionsFor())[0].description).toBe('923001234567');
  });

  it('a nameless person still shows her phone rather than a bare "Teacher"', async () => {
    reset(teacher({ teacher_name: null }));
    const o = (await optionsFor())[0];
    expect(o.description).toBe('923001234567');
    expect(o.title).toBe('Teacher');
  });
});
