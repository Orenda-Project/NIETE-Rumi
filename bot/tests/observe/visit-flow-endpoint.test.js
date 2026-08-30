/**
 * bd-2430/bd-2431 — the observe-visit Flow endpoint handler on NIETE.
 * Ported pins: INIT→schools, school→teachers, teacher→BRIEF (native text, no
 * PNG), BACK semantics (screen = the screen being LEFT — bd-2365), complete→
 * bind + awaiting_audio, NO `version` field ever.
 * NEW (bd-2431): pagination — a school with >20 teachers pages at 18 + nav rows
 * (NavigationList hard cap is 20 items), page order continues the need-sort,
 * BACK returns to the remembered page.
 */

const mockTeachers = [];
const mockState = { current: null };

jest.mock('../../shared/services/observe/assignment/leader-source', () => ({
  listSchools: jest.fn(async () => [
    { school_ext_id: 'niete:401', school_name: 'IMCB Bhara Kau', emis: '401', teacherCount: 30, dueCount: 12 },
    { school_ext_id: 'niete:402', school_name: 'IMCB Chak Shahzad', emis: '402', teacherCount: 5, dueCount: 0 },
  ]),
  listTeachers: jest.fn(async () => mockTeachers),
  buildBrief: jest.fn(async () => ({
    teacher: { teacher_name: 'Abid Ullah', school_name: 'IMCB Bhara Kau', preferred_language: 'ur', grade: null },
    strengthLabel: 'strength', growthLabel: 'growth',
    moves: [{ areaKey: 'x', text: 'm1' }, { areaKey: 'y', text: 'm2' }, { areaKey: 'z', text: 'm3' }],
    trend: [], showTrend: false, firstVisit: true, noData: false,
  })),
  resolveTeacher: jest.fn(async () => ({
    teacher_ext_id: '923331234567', teacher_name: 'Abid Ullah',
    phone_e164: '923331234567', user_id: 'teacher-1', preferred_language: 'ur',
  })),
  leaderLang: jest.fn(async () => 'ur'),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(async (uid, state, data) => { mockState.current = { state, ...data }; }),
  getState: jest.fn(async () => mockState.current),
  clearState: jest.fn(async () => { mockState.current = null; }),
}));
jest.mock('../../shared/services/observe/observe-gate', () => ({ getObserveArm: jest.fn(() => 'functional') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const ObserveState = require('../../shared/services/observe/observe-state.service');

function teacherFixture(n) {
  return Array.from({ length: n }, (_, i) => ({
    teacher_ext_id: `92333000${String(i).padStart(4, '0')}`,
    teacher_name: `Teacher ${String(i).padStart(2, '0')}`,
    phone_e164: `92333000${String(i).padStart(4, '0')}`,
    user_id: null, level: 'PRIMARY', lastVisitAt: null,
    priority: 'new', needsSupport: i < 5, score: null, growthAreaKey: null,
  }));
}

beforeEach(() => { mockTeachers.length = 0; mockState.current = null; jest.clearAllMocks(); });

describe('screens', () => {
  test('INIT → SELECT_SCHOOL NavigationList items, no version field', async () => {
    const res = await handler.handle('leader-1', 'INIT', '', {}, 'leader-1');
    expect(res.screen).toBe('SELECT_SCHOOL');
    expect(res.version).toBeUndefined();
    expect(res.data.items).toHaveLength(2);
    const item = res.data.items[0];
    expect(item['main-content'].title).toBe('IMCB Bhara Kau');
    expect(item['main-content'].metadata).toContain('30 teachers');
    expect(item['on-click-action'].payload.step).toBe('school');
  });

  // bd-43530 moved the level off `description` so the PHONE can have that field
  // to itself (12 digits do not fit beside a level in a 20-char field, and a
  // clipped phone still reads as a real number). The level did not disappear —
  // it is now the head of the metadata line.
  test('school pick → SELECT_TEACHER: phone description, level in metadata, Latin-only chrome', async () => {
    mockTeachers.push(...teacherFixture(3));
    const res = await handler.handle('leader-1', 'data_exchange', 'SELECT_SCHOOL', { step: 'school', school_ext_id: 'niete:401' }, 'leader-1');
    expect(res.screen).toBe('SELECT_TEACHER');
    expect(res.version).toBeUndefined();
    expect(res.data.items).toHaveLength(3);
    const md = res.data.items.map((i) => JSON.stringify(i['main-content'])).join('');
    expect(/[؀-ۿ]/.test(md)).toBe(false); // bd-2331: NavigationList chrome must be Latin
    const mc = res.data.items[0]['main-content'];
    expect(mc.description).toBe('923330000000');
    expect(mc.metadata).toContain('PRIMARY');
  });

  test('teacher pick → BRIEF native text fields, no image, ur content allowed', async () => {
    const res = await handler.handle('leader-1', 'data_exchange', 'SELECT_TEACHER',
      { step: 'teacher', teacher_ext_id: '923331234567', school_ext_id: 'niete:401' }, 'leader-1');
    expect(res.screen).toBe('BRIEF');
    for (const f of ['teacher_name', 'subtitle', 'strength_text', 'growth_text', 'moves_intro', 'moves_text', 'trend_text', 'debrief_reminder', 'guidance_text']) {
      expect(typeof res.data[f]).toBe('string');
      expect(res.data[f].length).toBeGreaterThan(0);
    }
    expect(res.data.brief_image).toBeUndefined();
    expect(res.data.teacher_ext_id).toBe('923331234567');
  });
});

describe('BACK semantics (bd-2365)', () => {
  test('BACK leaving SELECT_TEACHER → school picker', async () => {
    const res = await handler.handle('leader-1', 'BACK', 'SELECT_TEACHER', {}, 'leader-1');
    expect(res.screen).toBe('SELECT_SCHOOL');
  });

  test('BACK leaving BRIEF → teacher list for the remembered school', async () => {
    mockTeachers.push(...teacherFixture(2));
    await handler.handle('leader-1', 'data_exchange', 'SELECT_SCHOOL', { step: 'school', school_ext_id: 'niete:401' }, 'leader-1');
    const res = await handler.handle('leader-1', 'BACK', 'BRIEF', {}, 'leader-1');
    expect(res.screen).toBe('SELECT_TEACHER');
  });
});

describe('pagination (bd-2431 — NIETE-new: 106 schools exceed 20 teachers)', () => {
  test('>18 teachers → 18 + next-row; never more than 20 items', async () => {
    mockTeachers.push(...teacherFixture(60));
    const res = await handler.handle('leader-1', 'data_exchange', 'SELECT_SCHOOL', { step: 'school', school_ext_id: 'niete:401' }, 'leader-1');
    expect(res.data.items.length).toBeLessThanOrEqual(20);
    const next = res.data.items.find((i) => i['on-click-action'].payload.page === 1);
    expect(next).toBeTruthy();
    expect(next['on-click-action'].payload.step).toBe('school');
    expect(next['on-click-action'].payload.school_ext_id).toBe('niete:401');
    // page 1 holds the head of the need-sorted list
    expect(res.data.items[0]['main-content'].title).toBe('Teacher 00');
  });

  test('page 1 continues the order and has prev + next rows', async () => {
    mockTeachers.push(...teacherFixture(60));
    const res = await handler.handle('leader-1', 'data_exchange', 'SELECT_TEACHER',
      { step: 'school', school_ext_id: 'niete:401', page: 1 }, 'leader-1');
    const titles = res.data.items.map((i) => i['main-content'].title);
    expect(titles).toContain('Teacher 18');
    expect(titles).not.toContain('Teacher 00');
    const payloads = res.data.items.map((i) => i['on-click-action'].payload);
    expect(payloads.some((p) => p.page === 0)).toBe(true); // prev
    expect(payloads.some((p) => p.page === 2)).toBe(true); // next
    expect(res.data.items.length).toBeLessThanOrEqual(20);
  });

  test('last page has prev but no next', async () => {
    mockTeachers.push(...teacherFixture(40)); // pages: 0(18) 1(18) 2(4)
    const res = await handler.handle('leader-1', 'data_exchange', 'SELECT_TEACHER',
      { step: 'school', school_ext_id: 'niete:401', page: 2 }, 'leader-1');
    const payloads = res.data.items.map((i) => i['on-click-action'].payload);
    expect(payloads.some((p) => p.page === 1)).toBe(true);
    expect(payloads.some((p) => p.page === 3)).toBe(false);
  });

  test('<=18 teachers → no nav rows (unchanged upstream behavior)', async () => {
    mockTeachers.push(...teacherFixture(5));
    const res = await handler.handle('leader-1', 'data_exchange', 'SELECT_SCHOOL', { step: 'school', school_ext_id: 'niete:401' }, 'leader-1');
    expect(res.data.items).toHaveLength(5);
    expect(res.data.items.every((i) => i['on-click-action'].payload.page === undefined)).toBe(true);
  });

  test('BACK from BRIEF returns to the remembered page', async () => {
    mockTeachers.push(...teacherFixture(60));
    await handler.handle('leader-1', 'data_exchange', 'SELECT_TEACHER', { step: 'school', school_ext_id: 'niete:401', page: 1 }, 'leader-1');
    await handler.handle('leader-1', 'data_exchange', 'SELECT_TEACHER', { step: 'teacher', teacher_ext_id: '92333000020', school_ext_id: 'niete:401' }, 'leader-1');
    const res = await handler.handle('leader-1', 'BACK', 'BRIEF', {}, 'leader-1');
    expect(res.screen).toBe('SELECT_TEACHER');
    const titles = res.data.items.map((i) => i['main-content'].title);
    expect(titles).toContain('Teacher 18'); // page 1, not page 0
  });
});

describe('complete → bind + awaiting_audio', () => {
  test('binds the teacher and arms awaiting_audio with boundTeacher', async () => {
    const res = await handler.handle('leader-1', 'complete', 'BRIEF',
      { step: 'start', teacher_ext_id: '923331234567', school_ext_id: 'niete:401' }, 'leader-1',
      { id: 'leader-1', preferences: {} });
    expect(res.action).toBe('bound');
    expect(res.boundTeacher.user_id).toBe('teacher-1');
    const armed = ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio');
    expect(armed).toBeTruthy();
    expect(armed[2].boundTeacher.phone_e164).toBe('923331234567');
  });
});
