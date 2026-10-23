/**
 * TYPES says "up to 8" before she ticks, and every refusal there is logged.
 *
 * English and Urdu offer 18 types but COUNTS has 8 boxes, so TYPES refuses a
 * ninth pick. Nothing on the screen said so until she had been sent back, and
 * TYPES never called refused(), so the bounce left no trace in the logs.
 * Amena, 23 Oct 2026 on sandbox: nine Continue taps on G1 English in five
 * minutes, none of them visible in Axiom (bd-5jmnfj.4.18).
 *
 * The caption is server data, so this lands without republishing the Flow.
 */
const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = {
  from: jest.fn(() => {
    const q = Promise.resolve({ data: [], error: null });
    q.select = () => q; q.eq = () => q; q.in = () => q;
    q.order = () => q; q.limit = () => q; q.single = () => q;
    return q;
  }),
};
const mockLog = jest.fn();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: mockLog }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
  isAssessmentVersionsEnabled: jest.fn().mockResolvedValue(false),
  isAssessmentDocxEnabled: jest.fn().mockResolvedValue(false),
  ASSESSMENT_GENERATOR_KEY: 'a', ASSESSMENT_EDITING_KEY: 'b', ASSESSMENT_DOCX_KEY: 'c',
}));

const QuestionTypes = require('../../bot/shared/services/assessment/question-types');
const { handleAssessmentGenDataExchange: exchange } =
  require('../../bot/shared/routes/assessment-gen-endpoint');

const TOKEN = 'u1:assessment-gen:1';
const SESSION = {
  userId: 'u1', grade: 1, subject: 'english', chapterNumber: 2,
  pageRanges: '10-14', questionTypes: [], contentSource: 'unseen',
};
const offered = QuestionTypes.forSubject('english', 1).map((t) => t.id);
const refusals = () => mockLog.mock.calls.filter(([msg]) => msg === '[assessment-flow] input refused');

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue({ ...SESSION });
  mockRedis.set.mockResolvedValue(true);
});

test('G1 English offers more types than there are count boxes', () => {
  expect(offered.length).toBeGreaterThan(QuestionTypes.MAX_TYPE_SLOTS);
});

test('arriving on TYPES, the caption already says how many she may pick', async () => {
  const res = await exchange('u1', 'QUESTIONS', { content_source: 'unseen' }, TOKEN);
  expect(res.screen).toBe('TYPES');
  expect(res.data.summary).toContain(`up to ${QuestionTypes.MAX_TYPE_SLOTS}`);
  expect(res.data.has_error).toBe(false);
});

test('a ninth pick is refused, the limit stays in view, and the refusal is logged', async () => {
  const res = await exchange('u1', 'TYPES',
    { question_types: offered.slice(0, QuestionTypes.MAX_TYPE_SLOTS + 1) }, TOKEN);
  expect(res.screen).toBe('TYPES');
  expect(res.data.has_error).toBe(true);
  expect(res.data.summary).toContain(`up to ${QuestionTypes.MAX_TYPE_SLOTS}`);
  expect(refusals()).toHaveLength(1);
  expect(refusals()[0][1]).toMatchObject({ screen: 'TYPES', userId: 'u1', picked: 9 });
});

test('no pick at all is refused and logged too', async () => {
  const res = await exchange('u1', 'TYPES', { question_types: [] }, TOKEN);
  expect(res.screen).toBe('TYPES');
  expect(refusals()).toHaveLength(1);
  expect(refusals()[0][1]).toMatchObject({ screen: 'TYPES', picked: 0 });
});

test('exactly eight picks go through to COUNTS with no refusal', async () => {
  const res = await exchange('u1', 'TYPES',
    { question_types: offered.slice(0, QuestionTypes.MAX_TYPE_SLOTS) }, TOKEN);
  expect(res.screen).toBe('COUNTS');
  expect(refusals()).toHaveLength(0);
});
