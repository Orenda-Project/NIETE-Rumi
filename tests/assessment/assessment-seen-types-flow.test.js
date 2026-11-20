/**
 * bd-e5n2jf — the WhatsApp Flow gives Seen questions the same per-type boxes as Unseen
 * (Mubashar Zia, 20 Nov). The new QUESTIONS Footer posts a static `seen_types: true`;
 * with it, Seen goes TYPES → COUNTS (Seen wording) instead of the single SEEN_COUNT box,
 * and Both asks Seen types and counts first, then Unseen. A device still on the
 * published Flow never sends the marker and keeps SEEN_COUNT, so nothing breaks while
 * the new Flow JSON waits for Meta.
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));
const screenOf = (id) => FLOW.screens.find((s) => s.id === id);
const footerOf = (id) => {
  const walk = (nodes) => nodes.flatMap((n) => [n, ...walk(n.children || [])]);
  return walk(screenOf(id).layout.children).find((n) => n.type === 'Footer');
};

describe('the Flow JSON', () => {
  test('QUESTIONS marks itself as the Seen-types Flow', () => {
    expect(footerOf('QUESTIONS')['on-click-action'].payload.seen_types).toBe(true);
  });
  test('COUNTS can lead on to TYPES (Both: Seen counts, then Unseen types)', () => {
    expect(FLOW.routing_model.COUNTS).toEqual(expect.arrayContaining(['CONFIRM', 'TYPES']));
    expect(FLOW.routing_model.QUESTIONS).toContain('TYPES');
  });
  test('TYPES and COUNTS headings come from the endpoint, not fixed Unseen copy', () => {
    expect(JSON.stringify(screenOf('TYPES'))).toContain('${data.heading}');
    expect(JSON.stringify(screenOf('COUNTS'))).toContain('${data.heading}');
    expect(screenOf('TYPES').data.heading).toBeDefined();
    expect(screenOf('COUNTS').data.heading).toBeDefined();
  });
});

describe('the endpoint', () => {
  const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
  const mockSupabase = {
    from: jest.fn(() => {
      const q = Promise.resolve({ data: [{ id: 'book-1' }], error: null });
      q.select = () => q; q.eq = () => q; q.in = () => q; q.insert = () => q;
      q.order = () => q; q.limit = () => q; q.single = () => Promise.resolve({ data: { id: 'r1' }, error: null });
      q.maybeSingle = () => Promise.resolve({ data: { id: 'book-1' }, error: null });
      return q;
    }),
  };
  jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
  jest.mock('../../bot/shared/config/feature-flags', () => ({
    isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
    isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
    isAssessmentVersionsEnabled: jest.fn().mockResolvedValue(false),
    isAssessmentDocxEnabled: jest.fn().mockResolvedValue(false),
    ASSESSMENT_GENERATOR_KEY: 'a', ASSESSMENT_EDITING_KEY: 'b', ASSESSMENT_DOCX_KEY: 'c',
  }));

  const { handleAssessmentGenDataExchange: exchange, handleAssessmentGenBack: back, _internal } =
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

  const NEW = { seen_types: true };

  describe('Seen only', () => {
    test('QUESTIONS → TYPES worded for Seen, not the single Seen box', async () => {
      const res = await exchange('u1', 'QUESTIONS', { content_source: 'seen', ...NEW }, TOKEN);
      expect(res.screen).toBe('TYPES');
      expect(res.data.heading).toMatch(/Seen/);
      expect(res.data.heading).not.toMatch(/Unseen/);
    });

    test('TYPES → COUNTS (Seen) → CONFIRM; the paper is the sum of her Seen counts', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'seen', ...NEW }, TOKEN);
      const counts = await exchange('u1', 'TYPES', { question_types: ['MCQs', 'True/False'] }, TOKEN);
      expect(counts.screen).toBe('COUNTS');
      expect(counts.data.heading).toMatch(/Seen/);
      expect(counts.data.heading).not.toMatch(/Unseen/);
      expect(counts.data.label_1).toBe('MCQs');
      const res = await exchange('u1', 'COUNTS', { count_1: '3', count_2: '2' }, TOKEN);
      expect(res.screen).toBe('CONFIRM');
      expect(store.questionCount).toBe(5);
      expect(store.seenTypes).toEqual([
        { id: 'MCQs', count: 3, category: 'objective' },
        { id: 'True/False', count: 2, category: 'objective' },
      ]);
      expect(res.data.recap).toMatch(/3 MCQs, 2 True\/False/);
    });

    test('no type ticked is refused in Seen words', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'seen', ...NEW }, TOKEN);
      const res = await exchange('u1', 'TYPES', { question_types: [] }, TOKEN);
      expect(res.screen).toBe('TYPES');
      expect(res.data.error).toMatch(/Seen/);
      expect(res.data.error).not.toMatch(/Unseen/);
    });

    test('Back: COUNTS → TYPES (Seen), TYPES → QUESTIONS, CONFIRM → COUNTS (Seen)', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'seen', ...NEW }, TOKEN);
      await exchange('u1', 'TYPES', { question_types: ['MCQs'] }, TOKEN);
      await exchange('u1', 'COUNTS', { count_1: '4' }, TOKEN);
      const fromConfirm = await back('u1', 'CONFIRM', TOKEN);
      expect(fromConfirm.screen).toBe('COUNTS');
      expect(fromConfirm.data.heading).toMatch(/Seen/);
      const fromCounts = await back('u1', 'COUNTS', TOKEN);
      expect(fromCounts.screen).toBe('TYPES');
      expect(fromCounts.data.heading).toMatch(/Seen/);
      expect((await back('u1', 'TYPES', TOKEN)).screen).toBe('QUESTIONS');
    });
  });

  describe('Both', () => {
    const toUnseenTypes = async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'both', ...NEW }, TOKEN);
      await exchange('u1', 'TYPES', { question_types: ['MCQs'] }, TOKEN);
      return exchange('u1', 'COUNTS', { count_1: '4' }, TOKEN);
    };

    test('Seen types and counts first, then the Unseen types', async () => {
      const first = await exchange('u1', 'QUESTIONS', { content_source: 'both', ...NEW }, TOKEN);
      expect(first.screen).toBe('TYPES');
      expect(first.data.heading).not.toMatch(/Unseen/);
      const res = await toUnseenTypes();
      expect(res.screen).toBe('TYPES');
      expect(res.data.heading).toMatch(/Unseen/);
      expect(store.seenCount).toBe(4);
    });

    test('Unseen counts add to the Seen sum; the recap shows both breakdowns', async () => {
      await toUnseenTypes();
      const counts = await exchange('u1', 'TYPES', { question_types: ['True/False'] }, TOKEN);
      expect(counts.data.heading).toMatch(/Unseen/);
      expect(counts.data.hint).toMatch(/4 Seen/);
      const res = await exchange('u1', 'COUNTS', { count_1: '6' }, TOKEN);
      expect(res.screen).toBe('CONFIRM');
      expect(store.questionCount).toBe(10);
      expect(store.questionTypes).toEqual([{ id: 'True/False', count: 6, category: 'objective' }]);
      expect(res.data.recap).toMatch(/Seen: 4 MCQs · Unseen: 6 True\/False · 10 in total/);
    });

    test('Seen may not take the whole paper', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'both', ...NEW }, TOKEN);
      await exchange('u1', 'TYPES', { question_types: ['MCQs'] }, TOKEN);
      const res = await exchange('u1', 'COUNTS', { count_1: '50' }, TOKEN);
      expect(res.screen).toBe('COUNTS');
      expect(res.data.error).toMatch(/Unseen/);
    });

    test('Back from the Unseen types returns to the Seen counts', async () => {
      await toUnseenTypes();
      const res = await back('u1', 'TYPES', TOKEN);
      expect(res.screen).toBe('COUNTS');
      expect(res.data.heading).not.toMatch(/Unseen/);
      expect(res.data.label_1).toBe('MCQs');
    });
  });

  test('Urdu: her subjective Seen types keep their category and the Urdu chapter title survives', async () => {
    store = { ...SESSION, subject: 'urdu', chapterTitle: 'ہمارا پیارا وطن' };
    await exchange('u1', 'QUESTIONS', { content_source: 'seen', ...NEW }, TOKEN);
    const counts = await exchange('u1', 'TYPES', { question_types: ['Word Meanings', 'MCQs'] }, TOKEN);
    expect(counts.data.label_1).toBe('MCQs');
    expect(counts.data.label_2).toBe('Word Meanings');
    const res = await exchange('u1', 'COUNTS', { count_1: '2', count_2: '3' }, TOKEN);
    expect(store.seenTypes).toEqual([
      { id: 'MCQs', count: 2, category: 'objective' },
      { id: 'Word Meanings', count: 3, category: 'subjective' },
    ]);
    expect(res.data.recap).toContain('ہمارا پیارا وطن');
  });

  test('without the marker (published Flow) Seen still uses the single Seen box', async () => {
    const res = await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
    expect(res.screen).toBe('SEEN_COUNT');
    expect(store.seenTypes == null).toBe(true);
  });

  test('a new pass through QUESTIONS clears the last pass\'s Seen picks', async () => {
    await exchange('u1', 'QUESTIONS', { content_source: 'seen', ...NEW }, TOKEN);
    await exchange('u1', 'TYPES', { question_types: ['MCQs'] }, TOKEN);
    await exchange('u1', 'COUNTS', { count_1: '4' }, TOKEN);
    await exchange('u1', 'QUESTIONS', { content_source: 'unseen', ...NEW }, TOKEN);
    expect(store.seenTypes == null).toBe(true);
    expect(store.seenPicked == null).toBe(true);
  });

  test('submit puts her Seen counts on the request', async () => {
    const createAndQueue = jest.fn().mockResolvedValue({});
    jest.doMock('../../bot/shared/services/assessment/assessment-request.service', () => ({ createAndQueue }));
    const seenTypes = [{ id: 'MCQs', count: 3, category: 'objective' }];
    await _internal.submit({ ...SESSION, contentSource: 'seen', questionCount: 3, seenTypes });
    expect(createAndQueue).toHaveBeenCalledWith(expect.objectContaining({ seenTypes }));
    jest.dontMock('../../bot/shared/services/assessment/assessment-request.service');
  });
});
