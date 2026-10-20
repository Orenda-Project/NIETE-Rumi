/**
 * Task 5 — topics.repo: one chapter's current topics from assessment_topics, camelCase, in sort_order.
 * Supabase is mocked: this suite never touches a database.
 */
const mockCalls = [];
let mockReply = { data: [], error: null };
const mockChain = {
  from: (t) => { mockCalls.push(['from', t]); return mockChain; },
  select: (c) => { mockCalls.push(['select', c]); return mockChain; },
  eq: (c, v) => { mockCalls.push(['eq', c, v]); return mockChain; },
  order: (c, o) => { mockCalls.push(['order', c, o]); return Promise.resolve(mockReply); },
};
const mockLogError = jest.fn();

jest.mock('../../../bot/shared/config/supabase', () => mockChain);
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: mockLogError, logWarn: jest.fn() }));

const { listChapterTopics } = require('../../../bot/shared/services/assessment/topics/topics.repo');

const ROW = {
  topic_id: '1-maths-3-m-01-as-01', grade: 1, subject: 'maths', chapter_number: 3, chapter_title: 'Addition',
  name: 'How many more?', heading: null, heading_order: null, sort_order: 1, pages: [58, 59],
  slo_codes: ['M-01-AS-01'], slo_descriptions: ['I can compare numbers.'], days: [31], is_current: true,
};

beforeEach(() => { mockCalls.length = 0; mockReply = { data: [], error: null }; mockLogError.mockClear(); });

test('reads the current topics of one grade + subject + chapter, in sort_order', async () => {
  await listChapterTopics(1, 'maths', 3);
  expect(mockCalls).toEqual([
    ['from', 'assessment_topics'],
    ['select', '*'],
    ['eq', 'grade', 1],
    ['eq', 'subject', 'maths'],
    ['eq', 'chapter_number', 3],
    ['eq', 'is_current', true],
    ['order', 'sort_order', { ascending: true }],
  ]);
});

test('maps rows to camelCase topics', async () => {
  mockReply = { data: [ROW], error: null };
  const [topic] = await listChapterTopics(1, 'maths', 3);
  expect(topic).toMatchObject({
    topicId: '1-maths-3-m-01-as-01', chapterNumber: 3, name: 'How many more?', sortOrder: 1,
    pages: [58, 59], sloCodes: ['M-01-AS-01'], sloDescriptions: ['I can compare numbers.'],
  });
});

test('a chapter that was never loaded gives []', async () => {
  mockReply = { data: null, error: null };
  expect(await listChapterTopics(5, 'science', 9)).toEqual([]);
});

test('a database error is logged and thrown, never read as "no topics"', async () => {
  mockReply = { data: null, error: { message: 'relation "assessment_topics" does not exist' } };
  await expect(listChapterTopics(1, 'maths', 3)).rejects.toThrow('relation "assessment_topics" does not exist');
  expect(mockLogError).toHaveBeenCalled();
});
