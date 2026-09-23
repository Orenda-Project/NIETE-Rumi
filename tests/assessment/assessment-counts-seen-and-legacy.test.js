/**
 * Two things the first cut of bd-60175 got wrong or left open.
 *
 * 1. `seen` was stranded. The total box came off QUESTIONS for every path, but the
 *    seen handler still demanded `question_count` — so a teacher who picked "From the
 *    book" was told to type a number into a box that no longer existed, forever. The
 *    unit tests passed the count by hand, which is why none of them noticed. Now the
 *    size of a seen paper is asked on COUNTS too, as a single box: one screen owns
 *    "how many", on every path.
 *
 * 2. The deploy order. Meta will not publish a Flow until its endpoint answers, so the
 *    code ships BEFORE the new Flow JSON, and for that window every device is still on
 *    the old published screens. The old QUESTIONS screen always posts a
 *    `question_count` key; the new one never does. Seeing that key means an old client,
 *    and an old client must get the old journey — send it to a COUNTS screen its Flow
 *    does not contain and the device shows "Something went wrong".
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));

// Superseded 23 Sep (operator's Seen/Unseen spec): the Seen number now has its
// own SEEN_COUNT screen rather than a single box on COUNTS. What these tests
// guard is unchanged — seen is never stranded without a box, and the size is
// refused, never clamped — only the screen that owns it moved.
describe('the Flow routes seen through its own Seen screen', () => {
  test('QUESTIONS reaches SEEN_COUNT, not CONFIRM directly', () => {
    expect(FLOW.routing_model.QUESTIONS).toContain('SEEN_COUNT');
    expect(FLOW.routing_model.QUESTIONS).not.toContain('CONFIRM');
  });
});

describe('the endpoint', () => {
  const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  const mockSupabase = {
    from: jest.fn(() => {
      const q = Promise.resolve({ data: [], error: null });
      q.select = () => q; q.eq = () => q; q.in = () => q;
      q.order = () => q; q.limit = () => q; q.single = () => q;
      return q;
    }),
  };
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

  const { handleAssessmentGenDataExchange: exchange, handleAssessmentGenBack: back } =
    require('../../bot/shared/routes/assessment-gen-endpoint');

  const TOKEN = 'u1:assessment-gen:1';
  const SESSION = { userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3, pageRanges: '34-41' };
  let store;
  beforeEach(() => {
    jest.clearAllMocks();
    store = { ...SESSION };
    mockRedis.get.mockImplementation(async () => ({ ...store }));
    mockRedis.set.mockImplementation(async (_k, v) => { store = { ...v }; return true; });
  });

  describe('new Flow — no question_count key on QUESTIONS', () => {
    test('seen goes to its own Seen screen — never stranded without a box', async () => {
      const res = await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
      expect(res.screen).toBe('SEEN_COUNT');
    });

    test('the seen count sizes the paper and reaches CONFIRM', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
      const res = await exchange('u1', 'SEEN_COUNT', { seen_count: '12' }, TOKEN);
      expect(res.screen).toBe('CONFIRM');
      expect(store.questionCount).toBe(12);
      expect(store.questionTypes || []).toEqual([]);
    });

    test('a bad seen count is refused on the Seen screen, not clamped', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
      for (const bad of ['', 'abc', '0', '40']) {
        const res = await exchange('u1', 'SEEN_COUNT', { seen_count: bad }, TOKEN);
        expect(res.screen).toBe('SEEN_COUNT');
        expect(res.data.error).toBeTruthy();
      }
    });

    test('back from the Seen screen lands on QUESTIONS, not TYPES', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
      const res = await back('u1', 'SEEN_COUNT', TOKEN);
      expect(res.screen).toBe('QUESTIONS');
    });
  });

  describe('old published Flow — QUESTIONS still posts question_count', () => {
    test('seen with a count goes straight to CONFIRM, as it always did', async () => {
      const res = await exchange('u1', 'QUESTIONS',
        { content_source: 'seen', question_count: '10' }, TOKEN);
      expect(res.screen).toBe('CONFIRM');
      expect(store.questionCount).toBe(10);
    });

    test('unseen still validates the total it was given', async () => {
      const res = await exchange('u1', 'QUESTIONS',
        { content_source: 'unseen', question_count: '40' }, TOKEN);
      expect(res.screen).toBe('QUESTIONS');
      expect(res.data.error).toMatch(/25/);
    });

    test('TYPES goes to CONFIRM — never to a COUNTS screen that client does not have', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'unseen', question_count: '12' }, TOKEN);
      const res = await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
      expect(res.screen).toBe('CONFIRM');
      // The old arithmetic, because that client never offered her per-type boxes.
      expect(store.questionCount).toBe(12);
    });
  });
});
