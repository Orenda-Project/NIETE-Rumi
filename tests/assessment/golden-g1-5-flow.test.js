/**
 * Goldens for the WhatsApp Flow (assessment-gen), grades 1-5: every screen a teacher sees on the way
 * to a queued paper, plus the request row and job that CONFIRM writes (captured at 820045b41).
 *
 * The walk per grade x subject on the ICT shelf (the live shelf, assessment-subjects-follow-grade):
 *   INIT -> CLASS(grade_selected) -> CLASS -> COVERAGE(chapter 1) -> QUESTIONS(unseen) -> TYPES(first two)
 *   -> COUNTS(3 + 2) -> CONFIRM -> done, plus the stale-pair CLASS error and the PAGES path for a book
 *   with no contents page.
 * The Flow has no board-pattern door (assessment-gen-endpoint.js holds no pattern code), so these are
 * plain-path screens only; the pattern path is pinned through the create route in golden-g1-5-pattern.
 *
 * Flag states: assessment_grades_6_12 absent and true, one file per walk named `g612-absent`.
 */
const H = require('./helpers/golden-g1-5');

const SHELF = {
  1: ['english', 'general_knowledge', 'islamiat', 'maths', 'urdu'],
  2: ['english', 'general_knowledge', 'islamiat', 'maths', 'urdu'],
  3: ['english', 'general_knowledge', 'islamiat', 'maths', 'urdu'],
  4: ['english', 'islamiat', 'maths', 'science', 'social_studies', 'urdu'],
  5: ['english', 'islamiat', 'maths', 'science', 'social_studies', 'urdu'],
};
const WALKS = [];
Object.entries(SHELF).forEach(([g, subs]) => subs.forEach((s) => WALKS.push([Number(g), s])));

let state;
let Flow;
function load(settings) {
  jest.resetModules();
  state = { rows: {}, seq: 0, updates: [], settings, tables: { textbooks: [] }, queued: [], redis: new Map() };
  Object.entries(SHELF).forEach(([g, subs]) => subs.forEach((s) => state.tables.textbooks.push(
    { id: `book-${g}-${s}`, curriculum: 'ict', grade: Number(g), subject: s, total_pages: 120 })));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: async (k) => (state.redis.has(k) ? JSON.parse(state.redis.get(k)) : null),
    set: async (k, v) => { state.redis.set(k, JSON.stringify(v)); return true; },
    setNX: async (k, v) => (state.redis.has(k) ? false : (state.redis.set(k, JSON.stringify(v)), true)),
    delete: async (k) => { state.redis.delete(k); return true; },
  }));
  jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: async (...a) => { state.queued.push(a); return { messageId: 'm' }; } }));
  const Real = jest.requireActual('../../bot/shared/services/assessment/book-content.service');
  jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
    ...Real,
    listChapters: async ({ grade }) => (grade === 3 ? [] : [
      { chapterNumber: 1, title: 'Our School', pageStart: 1, pageEnd: 12 },
      { chapterNumber: 2, title: 'ہمارا گھر', pageStart: 13, pageEnd: 30 },
    ]),
  }));
  Flow = require('../../bot/shared/routes/assessment-gen-endpoint');
}

const FLAG_STATES = [['absent', {}], ['true', { assessment_grades_6_12: true }]];
describe.each(FLAG_STATES)('golden G1-5 Flow, assessment_grades_6_12 %s', (_n, g612) => {
  test.each(WALKS)('grade %i %s', async (grade, subject) => {
    load({ ...g612 });
    const token = `flow-golden-${grade}-${subject}`;
    const user = 'u-golden-1';
    const steps = [];
    const step = async (name, p) => { steps.push({ step: name, screen: await p }); return steps[steps.length - 1].screen; };
    const x = (id, data) => Flow.handleAssessmentGenDataExchange(user, id, data, token);

    await step('INIT', Flow.handleAssessmentGenInit(user, token));
    await step('CLASS grade_selected', x('CLASS', { grade: String(grade), trigger: 'grade_selected' }));
    await step('CLASS stale pair', x('CLASS', { grade: String(grade), subject: 'no_such_subject' }));
    const after = await step('CLASS', x('CLASS', { grade: String(grade), subject }));
    if (after.screen === 'PAGES') await step('PAGES', x('PAGES', { page_ranges: '4-14' }));
    else await step('COVERAGE', x('COVERAGE', { chapters: ['1'] }));
    const types = await step('QUESTIONS', x('QUESTIONS', { content_source: 'unseen', total_marks: '' }));
    const offered = ((types.data && types.data.types) || []).map((t) => t.id).slice(0, 2);
    await step('TYPES', x('TYPES', { question_types: offered }));
    await step('COUNTS', x('COUNTS', { count_1: '3', count_2: '2' }));
    await step('CONFIRM', x('CONFIRM', { output_format: 'pdf', answer_lines: true }));

    H.golden(`flow/g${grade}.${subject}.flow-plain.g612-absent.screens.json`,
      H.json({ steps, writes: state.rows, queued: state.queued }));
  });
});
