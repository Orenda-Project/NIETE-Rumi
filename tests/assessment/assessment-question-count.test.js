/**
 * She types how many questions she wants.
 *
 * It was a dropdown of 10/15/20/25/30, which made her pick from our list rather
 * than say the number she had in mind — and offered 30, which is more than the
 * generator reliably produces well.
 *
 * A Flow TextInput has NO min or max: `input-type: number` controls the keypad
 * and nothing else. So the cap is entirely ours to enforce, on a value she can
 * type anything into — including "0", "-5", "999", "abc" and empty.
 */

const { parseQuestionCount, MAX_QUESTIONS, DEFAULT_QUESTIONS } =
  require('../../bot/shared/services/assessment/question-types');

describe('parseQuestionCount', () => {
  test('a sensible number comes back as itself', () => {
    expect(parseQuestionCount('12').count).toBe(12);
    expect(parseQuestionCount(7).count).toBe(7);
    expect(parseQuestionCount('25').count).toBe(25);
  });

  test('the cap is 25 — the ceiling the generator writes well', () => {
    expect(MAX_QUESTIONS).toBe(25);
  });

  test('over the cap is REFUSED, not silently clamped', () => {
    // Clamping 40 to 25 hands her a paper she did not ask for and never says
    // so. She should be told, on the screen, while she can still change it.
    const r = parseQuestionCount('40');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/25/);
  });

  test('zero and negatives are refused', () => {
    for (const v of ['0', '-1', '-25']) {
      expect(parseQuestionCount(v).ok).toBe(false);
    }
  });

  test('a fraction is refused rather than rounded into something she did not type', () => {
    expect(parseQuestionCount('7.5').ok).toBe(false);
  });

  test('text and empty are refused with a message that names the range', () => {
    for (const v of ['abc', '', '   ', null, undefined]) {
      const r = parseQuestionCount(v);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/\b1\b/);
      expect(r.message).toMatch(/\b25\b/);
    }
  });

  test('surrounding whitespace is tolerated — a keypad can add it', () => {
    expect(parseQuestionCount(' 15 ').count).toBe(15);
  });

  test('the message never blames her', () => {
    // She typed a number into a box that accepted it. The wording says what the
    // range is, not that she did something wrong.
    const r = parseQuestionCount('99');
    expect(r.message).not.toMatch(/invalid|error|wrong|illegal/i);
  });

  test('a default exists for a paper built without an explicit count', () => {
    expect(DEFAULT_QUESTIONS).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_QUESTIONS).toBeLessThanOrEqual(MAX_QUESTIONS);
  });
});

describe('the QUESTIONS screen, end to end', () => {
  const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  const mockSupabase = { from: jest.fn() };
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

  const { handleAssessmentGenDataExchange: exchange } =
    require('../../bot/shared/routes/assessment-gen-endpoint');

  const SESSION = { userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3,
    pageRanges: '34-41', questionTypes: [] };

  beforeEach(() => {
    mockRedis.get.mockResolvedValue({ ...SESSION });
    mockRedis.set.mockResolvedValue(true);
  });

  test('a number she typed carries through to CONFIRM', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '12', pick_types: false }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('CONFIRM');
    const saved = mockRedis.set.mock.calls.at(-1)[1];
    expect(saved.questionCount).toBe(12);
  });

  test('over the cap comes STRAIGHT BACK to the same screen with the reason', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '40', pick_types: false }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('QUESTIONS');
    expect(res.data.has_error).toBe(true);
    expect(res.data.error).toMatch(/25/);
  });

  test('a refused count is NOT written to the session', async () => {
    // Otherwise she backs out, comes in again, and silently gets 40.
    await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '999', pick_types: false }, 'u1:assessment-gen:1');
    const saved = mockRedis.set.mock.calls.at(-1)[1];
    expect(saved.questionCount).toBeUndefined();
  });

  test('junk is refused the same way, not coerced to a default', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: 'abc', pick_types: false }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('QUESTIONS');
    expect(res.data.has_error).toBe(true);
  });

  test('the screen tells her the range BEFORE she submits', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '0', pick_types: false }, 'u1:assessment-gen:1');
    expect(res.data.count_hint).toMatch(/1 and 25/);
  });
});
