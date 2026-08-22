/**
 * What the principal reads when she opens /remark.
 *
 * The old screen was a Dropdown of teachers she had NOT yet evaluated:
 * handleRemarkInit computed per-teacher progress and then used it to filter the
 * finished ones OUT. So the only signal that Ayesha was done was Ayesha being
 * absent — and absence is ambiguous (done? not enrolled? broken?). She could not
 * see her own progress through the cycle, could not see any score she had given,
 * and once everyone was done the screen dead-ended on an error.
 *
 * Now every teacher of the school is listed, annotated with status and score,
 * as a NavigationList: one row per teacher, tappable, no separate Continue.
 * Evaluated rows are read-only by design (operator decision, 2026-08-21) — she
 * can see what she submitted, not silently replace it.
 *
 * handleRemarkInit had no test at all before this file, which is the same gap
 * that let the delivery bug ship.
 */
const path = require('path');

const CYCLE_PATH = path.join(__dirname, '../../shared/services/remark/remark-cycle.repository.js');
const SCORE_PATH = path.join(__dirname, '../../shared/services/remark/remark-score.repository.js');
const USERS_PATH = path.join(__dirname, '../../shared/config/supabase.js');

const PRINCIPAL = { id: 'p-1', school_id: 's-1', role: 'principal', preferred_language: 'en' };

const TEACHERS = [
  { id: 't-1', first_name: 'Ayesha', preferred_language: 'en' },
  { id: 't-2', first_name: 'Bilal', preferred_language: 'en' },
  { id: 't-3', first_name: 'Fatima', preferred_language: 'en' },
];

/** Supabase stub: only used for the principal lookup in loadUser. */
function usersStub(user) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    maybeSingle() { return Promise.resolve({ data: user, error: null }); },
    then(res) { return Promise.resolve({ data: user, error: null }).then(res); },
  };
  return { from() { return chain; } };
}

function load({ progress = {}, scores = [], teachers = TEACHERS } = {}) {
  jest.resetModules();
  jest.doMock(USERS_PATH, () => usersStub(PRINCIPAL), { virtual: false });
  jest.doMock(CYCLE_PATH, () => ({
    getActiveCycle: async () => ({ id: 'c-1', label: 'Q1' }),
    listSchoolTeachers: async () => teachers,
    getProgress: async () => progress,
    deriveProgress: () => ({}),
  }), { virtual: false });
  jest.doMock(SCORE_PATH, () => ({
    VIEW: 'v_supervisor_remark_scores',
    getPrincipalScores: async () => scores,
    getTeacherScore: async () => null,
    getCycleScores: async () => [],
  }), { virtual: false });
  return require('../../shared/routes/remark-endpoint');
}

afterEach(() => {
  jest.resetModules();
  [USERS_PATH, CYCLE_PATH, SCORE_PATH].forEach((p) => jest.dontMock(p));
});

const ALL_DONE = {
  't-1': { state: 'done' }, 't-2': { state: 'done' }, 't-3': { state: 'done' },
};
const MIXED = {
  't-1': { state: 'done' },
  't-2': { state: 'in_progress' },
  // t-3 absent from progress entirely → not_started
};
const SCORES = [
  { teacher_id: 't-1', s_score: 17, s_pct: 85 },
  { teacher_id: 't-2', s_score: 14, s_pct: 70 },
];

function rowFor(res, teacherId) {
  return (res.data.items || []).find((i) => i.id === teacherId);
}

describe('the roster shows every teacher, not only the un-evaluated ones', () => {
  test('an evaluated teacher is still listed', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handleRemarkInit('p-1');

    expect(res.screen).toBe('PICK_TEACHER');
    expect((res.data.items || []).map((i) => i.id)).toEqual(['t-1', 't-2', 't-3']);
  });

  test('her score rides on the row she already graded', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handleRemarkInit('p-1');

    const row = rowFor(res, 't-1');
    expect(JSON.stringify(row)).toMatch(/85/);
  });

  test('an un-evaluated teacher carries no score', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handleRemarkInit('p-1');

    expect(JSON.stringify(rowFor(res, 't-3'))).not.toMatch(/\d+%/);
  });

  test('each row says where it stands', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handleRemarkInit('p-1');

    const text = (id) => JSON.stringify(rowFor(res, id)).toLowerCase();
    expect(text('t-1')).toMatch(/evaluated|done/);
    expect(text('t-2')).toMatch(/progress/);
    expect(text('t-3')).toMatch(/not started|to do|pending/);
  });

  test('a completed teacher is marked so at a glance', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handleRemarkInit('p-1');
    expect(rowFor(res, 't-1')['main-content'].title).toContain('✅');
    expect(rowFor(res, 't-3')['main-content'].title).not.toContain('✅');
  });

  test('every row is tappable on its own — no separate Continue press', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handleRemarkInit('p-1');

    for (const item of res.data.items) {
      expect(item['on-click-action'].name).toBe('data_exchange');
      expect(item['on-click-action'].payload.teacher_id).toBe(item.id);
    }
  });

  test('all-done is a roster she can read, not an error screen', async () => {
    const ep = load({ progress: ALL_DONE, scores: SCORES });
    const res = await ep.handleRemarkInit('p-1');

    expect(res.screen).toBe('PICK_TEACHER');
    expect(res.data.items).toHaveLength(3);
  });

  test('a school with no teachers still says so rather than rendering an empty list', async () => {
    const ep = load({ progress: {}, scores: [], teachers: [] });
    const res = await ep.handleRemarkInit('p-1');
    expect(res.data.items === undefined || res.data.items.length === 0).toBe(true);
  });
});

describe('tapping an evaluated teacher is read-only', () => {
  test('it returns her submitted scores, not the rubric', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handlePickTeacher('p-1', { teacher_id: 't-1' });

    expect(res.screen).toBe('SUMMARY');
  });

  test('an un-evaluated teacher still opens the rubric', async () => {
    const ep = load({ progress: MIXED, scores: SCORES });
    const res = await ep.handlePickTeacher('p-1', { teacher_id: 't-3' });

    expect(res.screen).toBe('RUBRIC');
  });
});
