/**
 * Board-pattern papers (FDE Grades 1-5, FBISE Grades 9-12) are ICT's, not Gilgit-Baltistan's (operator, 9 Nov 2026:
 * "Those should not be the subjects for GB"). A teacher whose region names its own books (region_features.book_keys,
 * read by teacher-books bookKeysForUser — the same answer her lesson shelf and paper subjects come from) is offered
 * no pattern: /assessment/options carries neither `patternGrades` (the papers-home door) nor `patterns` (the side door
 * on Cover), and /assessment/create refuses a pattern paper for her even when the request is built by hand.
 * An ICT teacher, and a call with no userId, get exactly what they got before.
 *
 * Same harness as tests/assessment/board-wiring/board-options.test.js: the real route stack and the real pattern
 * registries; app_settings and the catalogue are faked; the shelf is faked at teacher-books.
 */

const KEY = 'gb-patterns-key';
// A GB list that holds ICT's Grade 5 Islamiat book: the FDE G5 Islamiat pattern was offered to her before this change.
const GB_KEYS = ['gb_g5_english', 'gb_g5_maths', 'grade_5_islamiat', 'grade_5_social_studies_en'];
const GB = 'gb-teacher';
const ICT = 'ict-teacher';
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

/** app_settings answers from `settings`; every other read is empty (no textbooks: her own NBF book is not loaded). */
function query(table) {
  const filters = {};
  const b = {};
  ['select', 'neq', 'in', 'is', 'order', 'limit', 'gt', 'gte', 'lt', 'lte', 'filter', 'match'].forEach((m) => { b[m] = () => b; });
  b.eq = (col, val) => { filters[col] = val; return b; };
  b.maybeSingle = async () => {
    if (table !== 'app_settings') return { data: null, error: null };
    const v = settings[filters.key];
    return { data: v === undefined ? null : { key: filters.key, value: v }, error: null };
  };
  b.single = b.maybeSingle;
  b.then = (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko);
  return b;
}

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  settings = {
    assessment_fde_pattern_enabled: true,
    assessment_board_pattern_enabled: true,
    assessment_grades_6_12: true,
  };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => query(t)) }));
  jest.doMock('../../bot/shared/services/teacher-books.service', () => ({
    ...jest.requireActual('../../bot/shared/services/teacher-books.service'),
    bookKeysForUser: jest.fn(async (id) => (id === GB ? GB_KEYS : null)),
  }));
  const Real = jest.requireActual('../../bot/shared/services/assessment/assessment-browse.service');
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    ...Real,
    listGrades: jest.fn(async () => [1, 2, 3, 4, 5, 9, 10, 11, 12].map((g) => ({ grade: g, label: `Grade ${g}` }))),
    listSubjects: jest.fn(async (grade) => ['english', 'maths', 'islamiat', 'physics']
      .map((s) => ({ subject_key: s, subject: s, grade }))),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('POST /assessment/options — board patterns are ICT\'s', () => {
  test('an ICT teacher keeps the door (patternGrades 5, 9-12) and the G5 Islamiat side door', async () => {
    const top = await invoke('/assessment/options', { userId: ICT });
    expect(top.payload.patternGrades).toEqual([5, 9, 10, 11, 12]);
    const cell = await invoke('/assessment/options', { userId: ICT, grade: 5, subject: 'islamiat' });
    expect(cell.payload.patterns.map((p) => p.id)).toEqual(['fde_g5_2027']);
  });

  test('no userId (an older portal build) is the answer it always was: the FDE grade (9-12 need a user)', async () => {
    const top = await invoke('/assessment/options', {});
    expect(top.payload.patternGrades).toEqual([5]);
  });

  test('a GB teacher gets no door: no patternGrades on any call', async () => {
    const top = await invoke('/assessment/options', { userId: GB });
    expect(top.statusCode).toBe(200);
    expect(top.payload).not.toHaveProperty('patternGrades');
    const grade = await invoke('/assessment/options', { userId: GB, grade: 5 });
    expect(grade.payload).not.toHaveProperty('patternGrades');
    // Her own paper offer is untouched: the grades and the Grade 5 subject her shelf allows are still there.
    expect(top.payload.grades.map((g) => (g && typeof g === 'object' ? g.grade : g))).toEqual([5]);
    expect(grade.payload.subjects.map((s) => s.subject_key)).toEqual(['islamiat']);
  });

  test('a GB teacher gets no side door: no patterns for G5 Islamiat, whose ICT book IS on her list', async () => {
    const cell = await invoke('/assessment/options', { userId: GB, grade: 5, subject: 'islamiat' });
    expect(cell.statusCode).toBe(200);
    expect(cell.payload).not.toHaveProperty('patterns');
    expect(cell.payload).not.toHaveProperty('patternGrades');
    expect(Array.isArray(cell.payload.types)).toBe(true);
  });
});

describe('POST /assessment/create — the guard holds for a hand-built request', () => {
  test('a GB teacher asking for the FDE G5 pattern is refused as ineligible, before anything is queued', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', {
      userId: GB, grade: 5, subject: 'islamiat', pattern: 'fde_g5_2027', scope: 'fde',
    });
    expect(JSON.stringify({ statusCode, payload })).toBe(JSON.stringify({ statusCode: 400, payload: { success: false, error: 'That board pattern is not available for this grade and subject.', errorCode: 'PATTERN_INELIGIBLE' } }));
  });
});
