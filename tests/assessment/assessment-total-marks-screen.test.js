/**
 * The QUESTIONS screen, once it also asks for a marks budget.
 *
 * The field sits beside "how many questions" and is OPTIONAL, which is the
 * difference that drives every test here: question_count refuses an empty box,
 * total_marks accepts one and means "no budget". A teacher who ignores the new
 * field must reach CONFIRM exactly as she did before it existed.
 *
 * The review summary is the other half. It used to read "12 questions · 30
 * marks"; with a budget set it has to show the target too, because enforcement
 * can drop a question to fit and she deserves to see that happened rather than
 * count the paper herself.
 */

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockListQuestions = jest.fn();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
  isAssessmentDocxEnabled: jest.fn().mockResolvedValue(false),
  ASSESSMENT_GENERATOR_KEY: 'a', ASSESSMENT_EDITING_KEY: 'b', ASSESSMENT_DOCX_KEY: 'c',
}));
jest.mock('../../bot/shared/services/assessment/assessment-revision.service', () => ({
  rerender: jest.fn(),
  listQuestions: (...a) => mockListQuestions(...a),
  saveEdit: jest.fn().mockResolvedValue({ status: 'ok' }),
}));

const {
  handleAssessmentGenDataExchange: exchange,
  handleAssessmentGenInit: init,
} = require('../../bot/shared/routes/assessment-gen-endpoint');

const SESSION = {
  userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3,
  pageRanges: '34-41', questionTypes: [],
};

// `seen` because it is the category that goes straight to CONFIRM: types are
// fixed by the book questions, so there is no TYPES screen in the way (bd-60100).
// What is under test here is the marks budget, not the routing — an `unseen`
// helper would stop at TYPES and assert nothing about the budget.
const ask = (data) => exchange('u1', 'QUESTIONS',
  { content_source: 'seen', ...data }, 'u1:assessment-gen:1');

beforeEach(() => {
  mockRedis.get.mockResolvedValue({ ...SESSION });
  mockRedis.set.mockResolvedValue(true);
});

describe('the marks box on the QUESTIONS screen', () => {
  test('a budget she typed is carried into the session', async () => {
    const res = await ask({ question_count: '12', total_marks: '40' });
    expect(res.screen).toBe('CONFIRM');
    expect(mockRedis.set.mock.calls.at(-1)[1].totalMarks).toBe(40);
  });

  test('LEAVING IT BLANK is fine and reaches CONFIRM exactly as before', async () => {
    const res = await ask({ question_count: '12', total_marks: '' });
    expect(res.screen).toBe('CONFIRM');
    expect(mockRedis.set.mock.calls.at(-1)[1].totalMarks).toBeNull();
  });

  test('omitting the field entirely behaves the same — an older client sends nothing', async () => {
    const res = await ask({ question_count: '12' });
    expect(res.screen).toBe('CONFIRM');
  });

  test('junk comes STRAIGHT BACK to the same screen with the reason', async () => {
    const res = await ask({ question_count: '12', total_marks: 'abc' });
    expect(res.screen).toBe('QUESTIONS');
    expect(res.data.has_error).toBe(true);
  });

  test('a refused budget is NOT written to the session', async () => {
    // Otherwise she backs out, comes in again, and silently gets the bad value.
    await ask({ question_count: '12', total_marks: '99999' });
    expect(mockRedis.set.mock.calls.at(-1)[1].totalMarks).toBeUndefined();
  });

  test('the screen tells her the marks range BEFORE she submits', async () => {
    const res = await ask({ question_count: '0' });
    expect(res.data.marks_hint).toMatch(/\d/);
  });

  test('a bad count is still refused when the marks box is fine', async () => {
    const res = await ask({ question_count: '60', total_marks: '40' });
    expect(res.screen).toBe('QUESTIONS');
    expect(res.data.error).toMatch(/50/);
  });
});

describe('the review summary shows target against actual', () => {
  const REVIEW_TOKEN = 'u1:assessment-review:p1';
  // One Urdu question, because this deployment is Urdu-medium for most of what
  // it teaches and an all-English fixture cannot catch a script bug in the row
  // builders the summary is rendered beside (see assessment-urdu-fixtures).
  const ITEMS = [
    { id: 'a', number: 1, marks: 5, type: 'MCQs', text: 'q1', selected: true },
    {
      id: 'b',
      number: 2,
      marks: 5,
      type: 'MCQs',
      text: 'سوال نمبر ۲ — محترمہ فاطمہ جناح کے بارے میں بتائیں',
      selected: true,
    },
  ];

  beforeEach(() => mockListQuestions.mockResolvedValue({ items: ITEMS }));

  test('with a budget set, the summary names the target as well as the total', async () => {
    // She asked for 8 marks and the paper in front of her is worth 10 — both
    // numbers have to be on screen or she cannot tell she is over.
    mockRedis.get.mockResolvedValue({ userId: 'u1', totalMarks: 8 });
    const res = await init('u1', REVIEW_TOKEN);
    expect(res.data.summary).toMatch(/10/);
    expect(res.data.summary).toMatch(/8/);
  });

  test('with no budget the summary is unchanged from today', async () => {
    mockRedis.get.mockResolvedValue({ userId: 'u1' });
    const res = await init('u1', REVIEW_TOKEN);
    expect(res.data.summary).toBe('2 questions · 10 marks');
  });
});
