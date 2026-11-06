/**
 * POST /assessment/options offers the G9-12 FBISE board patterns behind their OWN flag,
 * `assessment_board_pattern_enabled`, off by default (bd-5jmnfj.38.25.1). With it off the JSON is
 * exactly today's, whatever the FDE flag says. With it on, a grade 9-12 cell the grade gate offers
 * this user gets its board pattern in `patterns`, and `patternGrades` carries 9-12 as the gate allows.
 *
 * Same harness as fde-options.test.js: the real route stack, app_settings and the catalogue mocked.
 */


const KEY = 'board-options-key';
let router;
let settings;

function findRoute(r, method, p) {
  for (const layer of r.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === p) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(p, body) {
  const stack = findRoute(router, 'post', p);
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: p };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

/** app_settings answers from `settings` (key → value, or an Error to throw); every other read is empty. */
function query(table) {
  const filters = {};
  const b = {};
  ['select', 'neq', 'in', 'is', 'order', 'limit', 'gt', 'gte', 'lt', 'lte', 'filter', 'match'].forEach((m) => { b[m] = () => b; });
  b.eq = (col, val) => { filters[col] = val; return b; };
  b.maybeSingle = async () => {
    if (table !== 'app_settings') return { data: null, error: null };
    const v = settings[filters.key];
    if (v instanceof Error) throw v;
    return { data: v === undefined ? null : { key: filters.key, value: v }, error: null };
  };
  b.single = b.maybeSingle;
  b.then = (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko);
  return b;
}

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  settings = {};
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => query(t)) }));
  const Real = jest.requireActual('../../../bot/shared/services/assessment/assessment-browse.service');
  // A catalogue that has grades 9-12.
  jest.doMock('../../../bot/shared/services/assessment/assessment-browse.service', () => ({
    ...Real,
    listGrades: jest.fn(async () => [1, 2, 3, 4, 5, 9, 10, 11, 12].map((g) => ({ grade: g, label: `Grade ${g}` }))),
    listSubjects: jest.fn(async (grade) => [
      { subject: 'physics', label: 'Physics' }, { subject: 'maths', label: 'Mathematics' },
      { subject: 'english', label: 'English' }, { subject: 'urdu', label: 'اردو' },
    ].map((s) => ({ ...s, grade }))),
  }));
  router = require('../../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const BOARD = 'assessment_board_pattern_enabled';
const FDE = 'assessment_fde_pattern_enabled';
const GATE = 'assessment_grades_6_12';
const USER = 'u-fictional-teacher-1';
const Board = () => require('../../../bot/shared/services/assessment/patterns/board');

describe('POST /assessment/options — the G9-12 board patterns', () => {
  test('board flag off (absent) → no board pattern, no new keys, even with the gate open', async () => {
    settings[GATE] = true;
    const off = await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: USER });
    expect(off.statusCode).toBe(200);
    expect(off.payload).not.toHaveProperty('patterns');
    expect(off.payload).not.toHaveProperty('patternGrades');
    settings[BOARD] = false;
    expect((await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: USER })).payload).toEqual(off.payload);
  });

  test('board flag off + FDE flag on → the FDE answer, unchanged (no board grades)', async () => {
    settings[FDE] = true;
    settings[GATE] = true;
    const { payload } = await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: USER });
    expect(payload).not.toHaveProperty('patterns');
    expect(payload.patternGrades).toEqual([1, 2, 3, 4, 5]);
  });

  test('a board flag read that throws is off', async () => {
    settings[GATE] = true;
    settings[BOARD] = new Error('connection reset');
    const { payload } = await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: USER });
    expect(payload).not.toHaveProperty('patterns');
    expect(payload).not.toHaveProperty('patternGrades');
  });

  test('board on + gate open + G9 physics → the SSC-I pattern summary', async () => {
    settings[BOARD] = true;
    settings[GATE] = true;
    const { statusCode, payload } = await invoke('/assessment/options', { grade: 9, subject: 'Physics', userId: USER });
    expect(statusCode).toBe(200);
    expect(payload.patterns).toEqual([{ id: 'fbise_ssc1_2027', ...Board().summaryFor('fbise_ssc1_2027', 'physics') }]);
    expect(payload.patternGrades).toEqual([9, 10, 11, 12]);
  });

  test('each grade gets its own pattern', async () => {
    settings[BOARD] = 'true';
    settings[GATE] = true;
    const want = { 9: 'fbise_ssc1_2027', 10: 'fbise_ssc2_2027', 11: 'fbise_hssc1_2027', 12: 'fbise_hssc2_2027' };
    for (const [grade, id] of Object.entries(want)) {
      // eslint-disable-next-line no-await-in-loop
      const { payload } = await invoke('/assessment/options', { grade: Number(grade), subject: 'maths', userId: USER });
      expect(payload.patterns.map((p) => p.id)).toEqual([id]);
    }
  });

  test('both flags on → FDE and board grades together; a G5 cell still gets only its FDE pattern', async () => {
    settings[BOARD] = true;
    settings[FDE] = true;
    settings[GATE] = true;
    const g5 = await invoke('/assessment/options', { grade: 5, subject: 'maths', userId: USER });
    expect(g5.payload.patterns.map((p) => p.id)).toEqual(['fde_g5_2027']);
    expect(g5.payload.patternGrades).toEqual([1, 2, 3, 4, 5, 9, 10, 11, 12]);
    const g9 = await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: USER });
    expect(g9.payload.patterns.map((p) => p.id)).toEqual(['fbise_ssc1_2027']);
  });

  test('board on but the 6-12 gate shut → nothing for 9-12 (no patterns, no patternGrades)', async () => {
    settings[BOARD] = true;
    const { payload } = await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: USER });
    expect(payload).not.toHaveProperty('patterns');
    expect(payload).not.toHaveProperty('patternGrades');
  });

  test('the gate admits only listed users; a killed cell or grade is not offered', async () => {
    settings[BOARD] = true;
    settings[GATE] = [USER];
    const other = await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: 'u-fictional-other' });
    expect(other.payload).not.toHaveProperty('patterns');
    expect(other.payload).not.toHaveProperty('patternGrades');
    settings['assessment_grades_6_12_kill_cells'] = ['9:physics'];
    const cell = await invoke('/assessment/options', { grade: 9, subject: 'physics', userId: USER });
    expect(cell.payload).not.toHaveProperty('patterns');
    expect(cell.payload.patternGrades).toEqual([9, 10, 11, 12]);
    settings['assessment_grades_6_12_kill'] = [10];
    const g = await invoke('/assessment/options', { grade: 9, subject: 'maths', userId: USER });
    expect(g.payload.patterns.map((p) => p.id)).toEqual(['fbise_ssc1_2027']);
    expect(g.payload.patternGrades).toEqual([9, 11, 12]);
  });

  test('board on, a subject the pattern does not set, or a grade it does not cover → no patterns', async () => {
    settings[BOARD] = true;
    settings[GATE] = true;
    expect((await invoke('/assessment/options', { grade: 9, subject: 'art', userId: USER })).payload).not.toHaveProperty('patterns');
    expect((await invoke('/assessment/options', { grade: 4, subject: 'maths', userId: USER })).payload).not.toHaveProperty('patterns');
    const grade = await invoke('/assessment/options', { grade: 9, userId: USER });
    expect(grade.payload).not.toHaveProperty('patterns');
    expect(grade.payload.patternGrades).toEqual([9, 10, 11, 12]);
  });
});
