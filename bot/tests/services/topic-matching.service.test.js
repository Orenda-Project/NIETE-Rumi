/**
 * TopicMatchingService tests
 *
 * Locks in three fixes:
 *  (a) grade + subject inputs must be filtered in the query (previously ignored → cross-grade collisions)
 *  (b) ILIKE fallback direction bug — natural sentences longer than chapter_title never matched
 *  (c) topic_keywords Postgres contains hit path still works
 */

// Programmable mock: each .from() call returns a fresh builder tied to a scripted result.
// Tests push results into `mockResultQueue`; the builder resolves against the next result once
// awaited via .limit()/.single()/.maybeSingle() (terminal), or when the chain itself is awaited.
const mockResultQueue = [];
const mockCapturedCalls = [];

function mockMakeBuilder(tableName) {
  const state = { table: tableName, filters: [] };
  const consume = () => {
    mockCapturedCalls.push({ ...state, filters: [...state.filters] });
    const next = mockResultQueue.shift();
    return next || { data: null, error: null };
  };
  const record = (fn) => (...args) => {
    state.filters.push({ fn, args });
    return builder;
  };
  const terminalRecord = (fn) => (...args) => {
    state.filters.push({ fn, args });
    return Promise.resolve(consume());
  };
  const builder = {
    select: record('select'),
    eq: record('eq'),
    contains: record('contains'),
    ilike: record('ilike'),
    order: record('order'),
    limit: terminalRecord('limit'),
    single: terminalRecord('single'),
    maybeSingle: terminalRecord('maybeSingle'),
    // Real Supabase PostgrestFilterBuilder is thenable — awaiting the raw chain resolves it.
    then(onFulfilled, onRejected) {
      return Promise.resolve(consume()).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((tableName) => mockMakeBuilder(tableName)),
}));

jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

const TopicMatchingService = require('../../shared/services/topic-matching.service');

const TIME_TO_RECALL = {
  id: 'toc-g1-en-ch1',
  curriculum: 'punjab_snc_2020',
  grade: 1,
  subject: 'english',
  chapter_number: 1,
  chapter_title: 'Time to Recall',
  topic_keywords: ['time to recall', 'recall', 'letter sounds'],
};

describe('TopicMatchingService.findChapterByTopic', () => {
  beforeEach(() => {
    mockResultQueue.length = 0;
    mockCapturedCalls.length = 0;
    jest.clearAllMocks();
  });

  it('returns the chapter when a topic_keywords array-contains match hits', async () => {
    mockResultQueue.push({ data: [TIME_TO_RECALL], error: null });

    const result = await TopicMatchingService.findChapterByTopic({
      topic: 'Time to Recall',
      grade: 1,
      subject: 'english',
      curriculum: 'punjab_snc_2020',
    });

    expect(result).toEqual(TIME_TO_RECALL);
  });

  it('scopes the query by grade AND subject in addition to curriculum', async () => {
    mockResultQueue.push({ data: [TIME_TO_RECALL], error: null });

    await TopicMatchingService.findChapterByTopic({
      topic: 'Time to Recall',
      grade: 1,
      subject: 'english',
      curriculum: 'punjab_snc_2020',
    });

    const eqCalls = mockCapturedCalls[0].filters.filter(f => f.fn === 'eq').map(f => f.args);
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ['curriculum', 'punjab_snc_2020'],
        ['grade', 1],
        ['subject', 'english'],
      ]),
    );
  });

  it('matches when the teacher\'s topic CONTAINS the chapter_title (natural sentence)', async () => {
    // Step 1 (contains) misses — no keyword row.
    mockResultQueue.push({ data: [], error: null });
    // Step 2 (fetch candidates) returns all chapters in scope; JS filter picks the match.
    mockResultQueue.push({ data: [TIME_TO_RECALL, {
      ...TIME_TO_RECALL,
      id: 'toc-g1-en-ch2', chapter_number: 2, chapter_title: 'Sounds and Letters', topic_keywords: [],
    }], error: null });

    const result = await TopicMatchingService.findChapterByTopic({
      topic: 'send me the lesson plan for time to recall',
      grade: 1,
      subject: 'english',
      curriculum: 'punjab_snc_2020',
    });

    expect(result && result.chapter_title).toBe('Time to Recall');
  });

  it('still matches when the chapter_title CONTAINS the topic (short user query)', async () => {
    mockResultQueue.push({ data: [], error: null });
    mockResultQueue.push({ data: [TIME_TO_RECALL], error: null });

    const result = await TopicMatchingService.findChapterByTopic({
      topic: 'recall',
      grade: 1,
      subject: 'english',
      curriculum: 'punjab_snc_2020',
    });

    expect(result && result.chapter_title).toBe('Time to Recall');
  });

  it('returns null when neither the keyword nor the bidirectional substring hits', async () => {
    mockResultQueue.push({ data: [], error: null });
    mockResultQueue.push({ data: [TIME_TO_RECALL], error: null });

    const result = await TopicMatchingService.findChapterByTopic({
      topic: 'photosynthesis of the mitochondria',
      grade: 1,
      subject: 'english',
      curriculum: 'punjab_snc_2020',
    });

    expect(result).toBeNull();
  });

  it('omits grade / subject filters when they are not supplied', async () => {
    mockResultQueue.push({ data: [TIME_TO_RECALL], error: null });

    await TopicMatchingService.findChapterByTopic({
      topic: 'time to recall',
      curriculum: 'punjab_snc_2020',
    });

    const eqCalls = mockCapturedCalls[0].filters.filter(f => f.fn === 'eq').map(f => f.args[0]);
    expect(eqCalls).toEqual(['curriculum']);
  });
});
