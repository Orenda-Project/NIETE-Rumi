/**
 * Goldens for the G1-5 requests a portal teacher makes outside the board pattern (captured at 820045b41):
 * the request row and queued job POST /assessment/create writes for a chapter paper, a topic paper with
 * every topic ticked (= the chapter paper), a topic subset, a topic subset with ticked FDE stems (stems
 * travel to the job as text), a report-button paper (`assessment_requests.origin = 'report'`), and the
 * "My papers" page (POST /assessment/papers) with its paging.
 *
 * The real route and the real request service run; the database, queue and topic store are faked.
 * Flag states: assessment_grades_6_12 absent and true, one file per case named `g612-absent`.
 */
const H = require('./helpers/golden-g1-5');

const KEY = 'golden-g1-5-key';
const topic = (n, pages, code) => ({
  topicId: `3-english-4-t${n}`, grade: 3, subject: 'english', chapterNumber: 4, chapterTitle: 'Our Friends',
  name: `Topic ${n}`, heading: 'Vocabulary & grammar', headingOrder: 1, sortOrder: n, pages,
  sloCodes: [`E-${n}`], sloDescriptions: [`Skill ${n}`], days: [n], isCurrent: true,
});
const TOPICS = [topic(1, [58, 59], 'E-1'), topic(2, [60, 61], 'E-2'), topic(3, [90, 91], 'E-3')];
const BASE = { userId: 'u-golden-1', grade: 3, subject: 'english', chapterNumbers: [4], questionCount: 6,
  questionTypes: [{ id: 'MCQs', count: 3 }, { id: 'Fill in the Blanks', count: 3 }] };
const STEMS = ['has-have', 'is-am-are']; // ids she ticks; the job stores their text

const CASES = {
  'chapter': BASE,
  'topic-all': { ...BASE, topicIds: TOPICS.map((t) => t.topicId) },
  'topic-subset': { ...BASE, topicIds: [TOPICS[0].topicId, TOPICS[2].topicId] },
  'topic-subset-stems': { ...BASE, topicIds: [TOPICS[0].topicId],
    questionTypes: [{ id: 'MCQs', count: 3 }, { id: 'Fill in the Blanks', count: 3, stems: STEMS }] },
  'report-button': { ...BASE, grade: 4, subject: 'maths', chapterNumbers: [2], origin: 'report' },
};

let state;
function load(settings) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  state = { rows: {}, seq: 0, updates: [], settings, tables: {}, queued: [] };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
  jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: async (...a) => { state.queued.push(a); return { messageId: 'm' }; } }));
  const Real = jest.requireActual('../../bot/shared/services/assessment/assessment-browse.service');
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    ...Real,
    bookFor: async (grade, subject) => ({ id: `book-${grade}-${subject}`, total_pages: 120 }),
    listChapters: async () => [
      { chapter_number: 2, chapter_title: 'Numbers', page_start: 20, page_end: 40 },
      { chapter_number: 4, chapter_title: 'Our Friends', page_start: 58, page_end: 95 },
    ],
  }));
  jest.doMock('../../bot/shared/services/assessment/topics/topics.repo', () => ({
    ...jest.requireActual('../../bot/shared/services/assessment/topics/topics.repo'),
    listChapterTopics: async () => TOPICS,
  }));
  return require('../../bot/shared/routes/internal-api.routes');
}
afterAll(() => { delete process.env.INTERNAL_API_KEY; jest.resetModules(); });

const FLAG_STATES = [['absent', {}], ['true', { assessment_grades_6_12: true }]];
describe.each(FLAG_STATES)('golden G1-5 requests, assessment_grades_6_12 %s', (_n, g612) => {
  test.each(Object.keys(CASES))('create: %s', async (name) => {
    const router = load({ ...g612 });
    const body = CASES[name];
    const out = await H.callRoute(router, '/assessment/create', body, KEY);
    H.golden(`requests/g${body.grade}.${body.subject}.${name}.g612-absent.create.json`,
      H.json({ out, writes: state.rows, queued: state.queued }));
  });

  test.each([[1, 2], [2, 2], [3, 2], [1, 10]])('My papers: page %i of size %i', async (page, pageSize) => {
    const router = load({ ...g612 });
    state.tables.assessment_requests = [1, 2, 3, 4, 5].map((i) => ({
      id: `req-${i}`, user_id: 'u-golden-1', grade_code: `grade_${i}`, subject_code: i % 2 ? 'maths' : 'urdu',
      chapter_number: i, created_at: `2026-10-0${i}T08:00:00.000Z`,
      assessment_papers: [{ id: `paper-${i}`, status: 'ready', edited_from: null, question_count: 10 + i, total_marks: 20 + i,
        ready_at: `2026-10-0${i}T08:05:00.000Z`, created_at: `2026-10-0${i}T08:00:00.000Z`,
        answer_key_r2_key: i === 3 ? null : `keys/${i}.pdf`, pattern: i === 5 ? 'fde_g5_2027' : null, pages: null }],
    }));
    const out = await H.callRoute(router, '/assessment/papers', { userId: 'u-golden-1', page, pageSize }, KEY);
    H.golden(`requests/all.papers.my-papers-p${page}-s${pageSize}.g612-absent.json`, H.json(out));
  });
});
