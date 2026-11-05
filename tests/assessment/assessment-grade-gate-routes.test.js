/**
 * G6-12 contract 1 §3 and §8: the grade gate at every server-side door (E1-E6), driven through the
 * real routes, the real browse service and the real Flow endpoint over a fake database that HOLDS
 * G6-12 textbooks rows. The picker is never trusted: a forged request for a hidden grade is refused.
 *
 *   flag absent  -> G6-12 rows exist but nothing offers them, and every create path refuses them
 *   flag on      -> offered, numeric order 1..12, and the same forged requests queue (positive control)
 *   pilot list   -> only the users on it; kill / kill_cells hide a grade / one cell on the next request
 */
const H = require('./helpers/golden-g1-5');

const KEY = 'grade-gate-routes-key';
const U = 'u-qa-1';
const SHELF = { 1: ['english', 'maths', 'urdu'], 4: ['science', 'maths'], 5: ['english'],
  6: ['english'], 9: ['physics', 'chemistry'], 10: ['english'], 11: ['physics', 'chemistry'], 12: ['maths'] };
const NOT_OFFERED = 'NOT_ELIGIBLE'; // the lifecycle vocabulary's "deliberate policy" code

let state;
let router;
let Flow;
function load(settings) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  state = { rows: {}, seq: 0, updates: [], settings, tables: { textbooks: [] }, queued: [], redis: new Map() };
  // Inserted lexically on purpose: '10' before '6' is how Array#sort() alone would order them.
  Object.entries(SHELF).forEach(([g, subs]) => subs.forEach((s) => state.tables.textbooks.push(
    { id: `book-${g}-${s}`, curriculum: 'ict', grade: Number(g), subject: s, total_pages: 120 })));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
  jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: async (...a) => { state.queued.push(a); return { messageId: 'm' }; } }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: async (k) => (state.redis.has(k) ? JSON.parse(state.redis.get(k)) : null),
    set: async (k, v) => { state.redis.set(k, JSON.stringify(v)); return true; },
    setNX: async (k, v) => (state.redis.has(k) ? false : (state.redis.set(k, JSON.stringify(v)), true)),
    delete: async (k) => { state.redis.delete(k); return true; },
  }));
  const Real = jest.requireActual('../../bot/shared/services/assessment/book-content.service');
  jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
    ...Real, listChapters: async () => [{ chapterNumber: 1, title: 'Motion', pageStart: 1, pageEnd: 12 }],
  }));
  const RealBrowse = jest.requireActual('../../bot/shared/services/assessment/assessment-browse.service');
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    ...RealBrowse, // listGrades / listSubjects stay real: they are the doors under test
    bookFor: async (grade, subject) => ({ id: `book-${grade}-${subject}`, total_pages: 120 }),
    listChapters: async () => [{ chapter_number: 1, chapter_title: 'Motion', page_start: 1, page_end: 12 }],
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
  Flow = require('../../bot/shared/routes/assessment-gen-endpoint');
}
afterAll(() => { delete process.env.INTERNAL_API_KEY; jest.resetModules(); });

const post = (p, body) => H.callRoute(router, p, body, KEY);
const options = async (body) => (await post('/assessment/options', body)).payload;
const flowGrades = async (user) => (await Flow.handleAssessmentGenInit(user, `init-${user}`)).data.grades.map((g) => g.id);
const flowSubjects = async (user, grade) => (await Flow.handleAssessmentGenDataExchange(
  user, 'CLASS', { grade: String(grade), trigger: 'grade_selected' }, `cls-${user}`)).data.subjects.map((s) => s.id);
const CREATE = { userId: U, grade: 9, subject: 'physics', chapterNumbers: [1], questionCount: 4,
  questionTypes: [{ id: 'mcq', count: 2 }, { id: 'srq', count: 2 }] };
const requests = () => (state.rows.assessment_requests || []).length;

/** A Flow session already at CONFIRM for grade 9 physics: what a stale or forged client holds. */
function forgeSession(token, user, grade = 9, subject = 'physics') {
  state.redis.set(`assessment_gen:${token}`, JSON.stringify({
    userId: user, grade, subject, chapterNumbers: [1], chapterTitles: ['Motion'], pageRanges: '1-12',
    contentSource: 'unseen', questionCount: 4, pickedTypes: ['mcq', 'srq'],
    questionTypes: [{ id: 'mcq', count: 2, category: 'objective' }, { id: 'srq', count: 2, category: 'subjective' }],
  }));
}
const confirm = (token, user) => Flow.handleAssessmentGenDataExchange(user, 'CONFIRM', { output_format: 'pdf', answer_lines: true }, token);

describe('flag absent, G6-12 rows present: nothing is offered and every door refuses (§8.1)', () => {
  beforeEach(() => load({}));

  test('portal options list grades 1..5 and no subjects for grade 9', async () => {
    expect((await options({ userId: U })).grades).toEqual([1, 4, 5]);
    expect((await options({ userId: U, grade: 9 })).subjects).toEqual([]);
  });
  test('Flow INIT and CLASS offer grades 1..5 only', async () => {
    expect(await flowGrades(U)).toEqual(['1', '4', '5']);
    expect(await flowSubjects(U, 9)).toEqual([]);
  });
  test('Flow CLASS with a forged grade 9 pair re-renders with the stale-pair error', async () => {
    const out = await Flow.handleAssessmentGenDataExchange(U, 'CLASS', { grade: '9', subject: 'physics' }, 'cls-forged');
    expect(out.screen).toBe('CLASS');
    expect(out.data.error).toMatch(/Grade 9/);
  });
  test('create grade 9 -> 400 NOT_ELIGIBLE, no request, no job', async () => {
    const out = await post('/assessment/create', CREATE);
    expect(out.statusCode).toBe(400);
    expect(out.payload.errorCode).toBe(NOT_OFFERED);
    expect(requests()).toBe(0);
    expect(state.queued).toHaveLength(0);
  });
  test('pattern create grade 9 is refused by the gate before any PATTERN_CODE', async () => {
    const out = await post('/assessment/create', { ...CREATE, pattern: 'fde_g5_2027' });
    expect(out.payload.errorCode).toBe(NOT_OFFERED);
  });
  test.each([['/assessment/chapters', {}], ['/assessment/topics', { chapterNumber: 1 }]])('%s grade 9 -> 400 NOT_ELIGIBLE', async (p, extra) => {
    const out = await post(p, { userId: U, grade: 9, subject: 'physics', ...extra });
    expect(out.statusCode).toBe(400);
    expect(out.payload.errorCode).toBe(NOT_OFFERED);
  });
  test('forged Flow CONFIRM grade 9 -> the failure screen, no job', async () => {
    forgeSession('tok-confirm', U);
    const out = await confirm('tok-confirm', U);
    expect(JSON.stringify(out)).toMatch(/queue_failed|try again/i);
    expect(state.queued).toHaveLength(0);
    expect(requests()).toBe(0);
  });
  test('submitFromCompletion grade 9 -> failed NOT_ELIGIBLE, no insert', async () => {
    forgeSession('tok-complete', U);
    expect(await Flow.submitFromCompletion({ flowToken: 'tok-complete', userId: U, outputFormat: 'pdf', answerLines: true }))
      .toEqual({ status: 'failed', code: NOT_OFFERED });
    expect(requests()).toBe(0);
  });
  test('grade 4 still creates (G1-5 untouched)', async () => {
    const out = await post('/assessment/create', { ...CREATE, grade: 4, subject: 'science',
      questionTypes: [{ id: 'MCQs', count: 2 }, { id: 'Fill in the Blanks', count: 2 }] });
    expect(out.payload).toMatchObject({ success: true });
    expect(state.queued).toHaveLength(1);
  });
});

describe('flag on: offered in numeric order, and the same forged requests now queue (§8.2)', () => {
  beforeEach(() => load({ assessment_grades_6_12: true }));

  test('portal and Flow list 1..12 numerically', async () => {
    expect((await options({ userId: U })).grades).toEqual([1, 4, 5, 6, 9, 10, 11, 12]);
    expect(await flowGrades(U)).toEqual(['1', '4', '5', '6', '9', '10', '11', '12']);
    expect((await options({ userId: U, grade: 9 })).subjects.map((s) => s.subject_key)).toEqual(['physics', 'chemistry']);
    expect(await flowSubjects(U, 9)).toEqual(['physics', 'chemistry']);
  });
  test('create grade 9 queues a job', async () => {
    const out = await post('/assessment/create', CREATE);
    expect(out.payload.errorCode).not.toBe(NOT_OFFERED);
    expect(state.queued).toHaveLength(1);
  });
  test('Flow CONFIRM and completion for grade 9 queue', async () => {
    forgeSession('tok-on-1', U);
    expect((await confirm('tok-on-1', U)).screen).toBeDefined();
    forgeSession('tok-on-2', U);
    expect((await Flow.submitFromCompletion({ flowToken: 'tok-on-2', userId: U, outputFormat: 'pdf', answerLines: true })).status).toBe('queued');
    expect(state.queued).toHaveLength(2);
  });
  test('options with no userId hide G6-12 (§8.4)', async () => {
    expect((await options({})).grades).toEqual([1, 4, 5]);
  });
});

describe('pilot list, kill and kill cells (§8.2-§8.3)', () => {
  test('a pilot list admits only the users on it', async () => {
    load({ assessment_grades_6_12: [U] });
    expect((await options({ userId: U })).grades).toEqual([1, 4, 5, 6, 9, 10, 11, 12]);
    expect((await options({ userId: 'u-teacher-7' })).grades).toEqual([1, 4, 5]);
    expect(await flowGrades('u-teacher-7')).toEqual(['1', '4', '5']);
    expect((await post('/assessment/create', { ...CREATE, userId: 'u-teacher-7' })).payload.errorCode).toBe(NOT_OFFERED);
  });
  test('kill [11] hides grade 11 on the next request; an accepted job is not recalled', async () => {
    load({ assessment_grades_6_12: true });
    await post('/assessment/create', { ...CREATE, grade: 11 });
    expect(state.queued).toHaveLength(1);
    state.settings.assessment_grades_6_12_kill = [11];
    expect((await options({ userId: U })).grades).toEqual([1, 4, 5, 6, 9, 10, 12]);
    expect((await post('/assessment/create', { ...CREATE, grade: 11 })).payload.errorCode).toBe(NOT_OFFERED);
    expect(state.queued).toHaveLength(1);
  });
  test('kill cells hide one cell only', async () => {
    load({ assessment_grades_6_12: true, assessment_grades_6_12_kill_cells: ['9:chemistry'] });
    expect((await options({ userId: U, grade: 9 })).subjects.map((s) => s.subject_key)).toEqual(['physics']);
    expect(await flowSubjects(U, 9)).toEqual(['physics']);
    expect((await post('/assessment/create', { ...CREATE, subject: 'chemistry' })).payload.errorCode).toBe(NOT_OFFERED);
    expect((await post('/assessment/create', CREATE)).payload.errorCode).not.toBe(NOT_OFFERED);
  });
  test('a malformed kill row kills all of 6-12', async () => {
    load({ assessment_grades_6_12: true, assessment_grades_6_12_kill: '[11' });
    expect((await options({ userId: U })).grades).toEqual([1, 4, 5]);
  });
});
