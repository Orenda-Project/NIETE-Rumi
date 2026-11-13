/**
 * The WhatsApp assessment Flow offers a teacher only the G1-5 subjects whose book she has (bd-97daxo.4).
 * Assessments are keyed by book: the generator reads ICT's books, so GB (NBF English/Urdu/Maths/Science, ICT's
 * English-medium GK) is offered Islamiat in G1 while no NBF book is loaded; once one is, it is offered too
 * (bd-6nskfq.1, below). Everyone else: today's list.
 */
const H = require('../assessment/helpers/golden-g1-5');

const GB_KEYS = ['gb_g1_english', 'gb_g1_urdu', 'gb_g1_maths', 'grade_1_general_knowledge_en', 'grade_1_islamiat'];
let state;
let Flow;

beforeEach(() => {
  jest.resetModules();
  state = { rows: {}, seq: 0, updates: [], settings: {}, tables: { textbooks: [] }, queued: [], redis: new Map() };
  ['english', 'general_knowledge', 'islamiat', 'maths', 'urdu'].forEach((s) => state.tables.textbooks.push(
    { id: `book-1-${s}`, curriculum: 'ict', grade: 1, subject: s, total_pages: 100 }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: async (k) => (state.redis.has(k) ? JSON.parse(state.redis.get(k)) : null),
    set: async (k, v) => { state.redis.set(k, JSON.stringify(v)); return true; },
    setNX: async (k, v) => (state.redis.has(k) ? false : (state.redis.set(k, JSON.stringify(v)), true)),
    delete: async (k) => { state.redis.delete(k); return true; },
  }));
  jest.doMock('../../bot/shared/services/teacher-books.service', () => ({
    ...jest.requireActual('../../bot/shared/services/teacher-books.service'),
    bookKeysForUser: jest.fn(async (id) => (id === 'gb-teacher' ? GB_KEYS : null)),
  }));
  Flow = require('../../bot/shared/routes/assessment-gen-endpoint');
});

const subjects = async (user) => (await Flow.handleAssessmentGenDataExchange(
  user, 'CLASS', { grade: '1', trigger: 'grade_selected' }, `cls-${user}`)).data.subjects.map((s) => s.id);

test('a GB teacher is offered Islamiat in Grade 1, and nothing from a book she does not have', async () => {
  expect(await subjects('gb-teacher')).toEqual(['islamiat']);
  const init = await Flow.handleAssessmentGenInit('gb-teacher', 'init-gb');
  expect(init.data.subjects.map((s) => s.id)).toEqual(['islamiat']);
});

test('an ICT teacher keeps every Grade 1 subject', async () => {
  expect((await subjects('sector-teacher')).sort()).toEqual(['english', 'general_knowledge', 'islamiat', 'maths', 'urdu']);
});

// bd-5jmnfj.38.42: grades 6-12 are open to everyone, but a region whose book list stops at Grade 5 (GB) must not
// be offered a grade it cannot use — picking it only led to "not covered". No list (ICT) keeps every grade.
describe('the grade list follows the region book list', () => {
  beforeEach(() => {
    state.settings.assessment_grades_6_12 = true;
    state.tables.textbooks.push({ id: 'book-7-maths', curriculum: 'ict', grade: 7, subject: 'maths', total_pages: 100 });
  });
  const grades = async (user) => (await Flow.handleAssessmentGenInit(user, `init-${user}`)).data.grades.map((g) => g.id);

  test('a GB teacher is not offered Grade 7', async () => {
    expect(await grades('gb-teacher')).toEqual(['1']);
  });

  test('an ICT teacher is offered Grade 7', async () => {
    expect(await grades('sector-teacher')).toEqual(['1', '7']);
  });
});

// bd-6nskfq.1 — once GB's own books are loaded (textbooks, curriculum nbf_snc), a GB teacher is offered each G1-5
// subject whose own book is on her list AND loaded: English and Maths here; Urdu is on her list but not loaded, so
// it stays off (never ICT's Urdu under her book's name). Islamiat stays (ICT's book, on her list).
describe('her own books, once loaded (bd-6nskfq.1)', () => {
  beforeEach(() => {
    ['english', 'maths'].forEach((s) => state.tables.textbooks.push(
      { id: `nbf-1-${s}`, curriculum: 'nbf_snc', grade: 1, subject: s, total_pages: 80 }));
    jest.doMock('../../bot/shared/services/book-curriculum.service', () => ({
      ...jest.requireActual('../../bot/shared/services/book-curriculum.service'),
      curriculumForUser: jest.fn(async (id) => (id === 'gb-teacher' ? 'nbf_snc' : 'ict')),
    }));
    jest.resetModules();
    Flow = require('../../bot/shared/routes/assessment-gen-endpoint');
  });

  test('a GB teacher is offered English, Islamiat and Maths in Grade 1', async () => {
    const init = await Flow.handleAssessmentGenInit('gb-teacher', 'init-gb-own');
    expect(init.data.subjects.map((s) => s.id).sort()).toEqual(['english', 'islamiat', 'maths']);
  });

  test('an ICT teacher keeps exactly her Grade 1 list', async () => {
    expect((await subjects('sector-teacher')).sort()).toEqual(['english', 'general_knowledge', 'islamiat', 'maths', 'urdu']);
  });
});
