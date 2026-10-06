'use strict';
/**
 * teacher-report-gate.js: ONE app_settings read (both keys, one `.in()`),
 * cached 30 s, failing closed; and the links it mints live under the report
 * path `/r/<token>` (+ `/remind`). Boundary faked: Supabase.
 */
jest.mock('../../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const supabase = require('../../../shared/config/supabase');
const Gate = require('../../../shared/services/quiz/teacher-report-gate');
const Token = require('../../../shared/services/quiz/teacher-report-token');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const BASE = 'https://portal.example.test';

let reads;
function settings(rows, { error = null } = {}) {
  reads = [];
  supabase.from.mockImplementation((table) => {
    const q = { table, select: null, filter: null };
    reads.push(q);
    const b = {
      select(cols) { q.select = cols; return b; },
      eq(c, v) { q.filter = ['eq', c, v]; return b; },
      in(c, vs) { q.filter = ['in', c, vs]; return b; },
      then(res, rej) {
        const keys = q.filter && q.filter[0] === 'in' ? q.filter[2] : [q.filter && q.filter[2]];
        const data = error ? null : rows.filter((r) => keys.includes(r.key));
        return Promise.resolve({ data, error }).then(res, rej);
      },
    };
    return b;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Gate._resetCache();
  process.env.WEB_QUIZ_BASE_URL = BASE;
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
});

test('both switches come from ONE read of app_settings, then the 30 s cache', async () => {
  settings([
    { key: 'teacher_report_teachers', value: JSON.stringify([TEACHER]) },
    { key: 'teacher_report_template', value: 'quiz_teacher_report_v1' },
  ]);
  expect(await Gate.teacherReportOn(TEACHER)).toBe(true);
  expect(await Gate.reportTemplate()).toBe('quiz_teacher_report_v1');
  expect(reads).toHaveLength(1);
  expect(reads[0].filter).toEqual(['in', 'key', ['teacher_report_teachers', 'teacher_report_template']]);
});

test('no template row: null (the link goes as text); the teacher switch still reads', async () => {
  settings([{ key: 'teacher_report_teachers', value: '"all"' }]);
  expect(await Gate.reportTemplate()).toBeNull();
  expect(await Gate.teacherReportOn(TEACHER)).toBe(true);
});

test('a read error fails closed for both and never throws', async () => {
  settings([], { error: { message: 'boom' } });
  expect(await Gate.reportTemplate()).toBeNull();
  expect(await Gate.teacherReportOn(TEACHER)).toBe(false);
});

test('the report links live under /r/: the live report and its /remind share', () => {
  const urls = Gate.reportUrls({ teacherId: TEACHER, quizId: QUIZ });
  expect(urls.live.startsWith(`${BASE}/r/`)).toBe(true);
  expect(urls.remind).toBe(`${urls.live}/remind`);
  expect(Token.verifyTeacherReport(decodeURIComponent(urls.live.slice(`${BASE}/r/`.length))))
    .toEqual({ teacherId: TEACHER, quizId: QUIZ });
  expect(urls.live).not.toContain('/t/');
});

test('the links follow the report page\'s own REPORT_PATH (the route that serves them), never a copy', () => {
  jest.isolateModules(() => {
    jest.doMock('../../../shared/templates/teacher-report.page', () => ({ REPORT_PATH: '/report-moved' }));
    const G = require('../../../shared/services/quiz/teacher-report-gate');
    const urls = G.reportUrls({ teacherId: TEACHER, quizId: QUIZ });
    expect(urls.live.startsWith(`${BASE}/report-moved/`)).toBe(true);
  });
  jest.dontMock('../../../shared/templates/teacher-report.page');
});
