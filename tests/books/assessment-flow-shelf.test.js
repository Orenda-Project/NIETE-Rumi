/**
 * The WhatsApp assessment Flow offers a teacher only the G1-5 subjects whose book she has (bd-97daxo.4).
 * Assessments are keyed by book: the generator reads ICT's books, so GB (NBF English/Urdu/Maths/Science, ICT's
 * English-medium GK) is offered Islamiat in G1 until NBF topics exist. Everyone else: today's list.
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
