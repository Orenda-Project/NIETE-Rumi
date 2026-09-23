/**
 * Seen and Unseen — the words the teacher uses, and a count she can trust on
 * every path.
 *
 *   Seen   (from the book)    → how many Seen questions. One number.
 *   Unseen (outside the book) → which types, then how many of EACH type.
 *   Both                      → how many Seen, on its own screen; THEN the
 *                               Unseen types and a count per type.
 *
 * "Both" used to collect per-type counts and then hand them to planCounts(),
 * which halved the total for Seen and re-spread the types over the rest — so
 * "10 MCQs + 2 Short Questions" came back as 3 and 3. Her Unseen counts now go
 * to the model untouched, and the Seen count travels as its own number
 * (`seenCount`) rather than being inferred, because an inference cannot tell a
 * new Both job from an old one whose types happen to sum short of its total.
 *
 * The Seen screen is separate from the Unseen counts on purpose (operator,
 * 23 Sep 2026: "I would rather it be clear").
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));
const byId = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));
const formOf = (id) => byId[id].layout.children.find((c) => c.type === 'Form').children;
const headingOf = (id) => formOf(id).find((c) => c.type === 'TextHeading').text;
const cp = (s) => [...String(s)].length;

describe('the copy uses Seen and Unseen', () => {
  const radio = () => formOf('QUESTIONS').find((c) => c.name === 'content_source');

  test('the three choices say Seen / Unseen, with a short gloss', () => {
    const titles = radio()['data-source'].map((o) => o.title);
    expect(titles[0]).toMatch(/^Seen\b/);
    expect(titles[0]).toMatch(/book/i);
    expect(titles[1]).toMatch(/^Unseen\b/);
    expect(titles[1]).toMatch(/outside/i);
    expect(titles[2]).toMatch(/Seen/);
    expect(titles[2]).toMatch(/Unseen/);
    // Ids are what the endpoint reads — only the words change.
    expect(radio()['data-source'].map((o) => o.id)).toEqual(['seen', 'unseen', 'both']);
    // Radio titles are clipped on the device past 30 code points.
    titles.forEach((t) => expect(cp(t)).toBeLessThanOrEqual(30));
  });

  test('the QUESTIONS heading asks Seen or Unseen', () => {
    expect(headingOf('QUESTIONS')).toMatch(/Seen/);
    expect(headingOf('QUESTIONS')).toMatch(/Unseen/);
  });

  test('the type-picking and per-type screens say they are about Unseen', () => {
    expect(headingOf('TYPES')).toMatch(/Unseen/);
    expect(headingOf('COUNTS')).toMatch(/Unseen/);
  });

  test('the Seen count screen says Seen', () => {
    expect(headingOf('SEEN_COUNT')).toMatch(/Seen/);
  });

  test('every literal TextInput label fits the 20-code-point cap', () => {
    for (const s of FLOW.screens) {
      const form = s.layout.children.find((c) => c.type === 'Form');
      for (const c of (form ? form.children : [])) {
        if (c.type === 'TextInput' && !String(c.label).startsWith('${')) {
          expect([s.id, c.label, cp(c.label)]).toEqual([s.id, c.label, Math.min(cp(c.label), 20)]);
        }
      }
    }
  });
});

describe('the screens and routes', () => {
  test('SEEN_COUNT exists, with one number box sent back', () => {
    const box = formOf('SEEN_COUNT').find((c) => c.name === 'seen_count');
    expect(box).toBeDefined();
    expect(box['input-type']).toBe('number');
    const footer = formOf('SEEN_COUNT').find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload.seen_count).toBe('${form.seen_count}');
  });

  test('QUESTIONS → SEEN_COUNT | TYPES; SEEN_COUNT → TYPES | CONFIRM; TYPES → COUNTS → CONFIRM', () => {
    expect(FLOW.routing_model.QUESTIONS.sort()).toEqual(['SEEN_COUNT', 'TYPES']);
    expect(FLOW.routing_model.SEEN_COUNT.sort()).toEqual(['CONFIRM', 'TYPES']);
    expect(FLOW.routing_model.TYPES).toEqual(['COUNTS']);
    expect(FLOW.routing_model.COUNTS).toEqual(['CONFIRM']);
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
  let store;
  beforeEach(() => {
    jest.clearAllMocks();
    store = { userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3, pageRanges: '34-41' };
    mockRedis.get.mockImplementation(async () => ({ ...store }));
    mockRedis.set.mockImplementation(async (_k, v) => { store = { ...v }; return true; });
  });

  describe('Seen', () => {
    test('asks how many Seen, then goes to the recap', async () => {
      const q = await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
      expect(q.screen).toBe('SEEN_COUNT');
      const s = await exchange('u1', 'SEEN_COUNT', { seen_count: '12' }, TOKEN);
      expect(s.screen).toBe('CONFIRM');
      expect(store.questionCount).toBe(12);
      expect(s.data.recap).toMatch(/Seen/);
      expect(s.data.recap).toMatch(/12/);
    });

    test('a bad Seen count stays on the Seen screen, not clamped', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
      for (const bad of ['', 'abc', '0', '60']) {
        const r = await exchange('u1', 'SEEN_COUNT', { seen_count: bad }, TOKEN);
        expect(r.screen).toBe('SEEN_COUNT');
        expect(r.data.error).toBeTruthy();
      }
    });
  });

  describe('Unseen', () => {
    test('goes straight to the types, then a count per type', async () => {
      const q = await exchange('u1', 'QUESTIONS', { content_source: 'unseen' }, TOKEN);
      expect(q.screen).toBe('TYPES');
      const t = await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
      expect(t.screen).toBe('COUNTS');
      const c = await exchange('u1', 'COUNTS', { count_1: '10', count_2: '2' }, TOKEN);
      expect(c.screen).toBe('CONFIRM');
      expect(store.questionCount).toBe(12);
      expect(store.seenCount || 0).toBe(0);
    });
  });

  describe('Both', () => {
    async function throughSeen(n) {
      await exchange('u1', 'QUESTIONS', { content_source: 'both' }, TOKEN);
      return exchange('u1', 'SEEN_COUNT', { seen_count: String(n) }, TOKEN);
    }

    test('asks the Seen count first, on its own screen', async () => {
      const q = await exchange('u1', 'QUESTIONS', { content_source: 'both' }, TOKEN);
      expect(q.screen).toBe('SEEN_COUNT');
    });

    test('then the Unseen types, then a count per Unseen type', async () => {
      const s = await throughSeen(5);
      expect(s.screen).toBe('TYPES');
      expect(store.seenCount).toBe(5);
      const t = await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
      expect(t.screen).toBe('COUNTS');
    });

    test('her Unseen counts are kept exactly, and the paper is Seen + Unseen', async () => {
      await throughSeen(5);
      await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
      const c = await exchange('u1', 'COUNTS', { count_1: '10', count_2: '2' }, TOKEN);
      expect(c.screen).toBe('CONFIRM');
      expect(store.seenCount).toBe(5);
      expect(store.questionTypes).toEqual([
        { id: 'MCQs', count: 10, category: 'objective' },
        { id: 'Brief Answers', count: 2, category: 'subjective' },
      ]);
      expect(store.questionCount).toBe(17);
      expect(c.data.recap).toMatch(/Seen[^\n]*5/);
      expect(c.data.recap).toMatch(/10 MCQs/);
      expect(c.data.recap).toMatch(/2 Brief Answers/);
      expect(c.data.recap).toMatch(/17/);
    });

    test('the 50 ceiling counts Seen AND Unseen together', async () => {
      await throughSeen(45);
      await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
      const c = await exchange('u1', 'COUNTS', { count_1: '5', count_2: '2' }, TOKEN);
      expect(c.screen).toBe('COUNTS');
      expect(c.data.error).toMatch(/50/);
    });

    test('Seen may not take the whole paper — there must be room for Unseen', async () => {
      const s = await throughSeen(50);
      expect(s.screen).toBe('SEEN_COUNT');
      expect(s.data.error).toBeTruthy();
    });

    test('back from TYPES on Both returns to the Seen screen', async () => {
      await throughSeen(5);
      const b = await back('u1', 'TYPES', TOKEN);
      expect(b.screen).toBe('SEEN_COUNT');
    });
  });

  describe('the per-type boxes', () => {
    test('each box is labelled with its type name, within the 20-code-point cap', async () => {
      await exchange('u1', 'QUESTIONS', { content_source: 'unseen' }, TOKEN);
      store.subject = 'maths'; store.grade = 5;
      const t = await exchange('u1', 'TYPES',
        { question_types: ['MCQs', 'Restricted Response Question'] }, TOKEN);
      expect(t.data.label_1).toBe('MCQs');
      expect(cp(t.data.label_2)).toBeLessThanOrEqual(20);
      // A clipped name is spelled out in full underneath.
      expect(t.data.help_2).toMatch(/Restricted Response Question/);
      expect(t.data.show_3).toBe(false);
    });
  });

  test('back from SEEN_COUNT returns to QUESTIONS', async () => {
    await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
    const b = await back('u1', 'SEEN_COUNT', TOKEN);
    expect(b.screen).toBe('QUESTIONS');
  });
});

describe('the generator honours both numbers on Both', () => {
  const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
  const TYPES = [
    { id: 'MCQs', count: 10, category: 'objective' },
    { id: 'Short Questions', count: 2, category: 'subjective' },
  ];

  test('an explicit seenCount is used as-is and the Unseen types are untouched', () => {
    const plan = Gen.planCounts({ contentSource: 'both', questionCount: 17, questionTypes: TYPES, seenCount: 5 });
    expect(plan.seenTarget).toBe(5);
    expect(plan.unseenTarget).toBe(12);
    expect(plan.total).toBe(17);
    expect(plan.questionTypes).toEqual(TYPES);
  });

  test('a Both job with no seenCount (queued before this) keeps the old half-and-half split', () => {
    const plan = Gen.planCounts({ contentSource: 'both', questionCount: 12, questionTypes: TYPES });
    expect(plan.seenTarget).toBe(6);
  });

  test('the prompt asks for exactly her Seen number and her Unseen counts', () => {
    const p = Gen.buildUserPrompt({
      grade: 4, subject: 'maths', pageContent: 'x', pageReference: '1-2',
      contentSource: 'both', questionCount: 17, questionTypes: TYPES, seenCount: 5,
    });
    expect(p).toContain('10 MCQs');
    expect(p).toContain('2 Short Questions');
    expect(p).toMatch(/Seen questions — at most 5/);
    expect(p).toMatch(/exactly 17 questions/);
  });
});

describe('seenCount survives the chain', () => {
  const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
  test('the request service puts seenCount on the job payload', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'r1' }, error: null }) }) }) }),
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
    const Req = require('../../bot/shared/services/assessment/assessment-request.service');
    await Req.createAndQueue({
      userId: 'u1', grade: 4, subject: 'science', textbookId: 't', chapterNumber: 3,
      contentSource: 'both', questionCount: 17, seenCount: 5, questionTypes: [],
    });
    expect(mockQueueJob.mock.calls[0][2].seenCount).toBe(5);
  });

  test('the orchestrator hands seenCount to generateExam', async () => {
    // Executed, not grepped: buildPaper runs for real against boundary mocks, and
    // the generator mock records what it was handed, then stops the job.
    jest.resetModules();
    const handed = [];
    const chain = () => {
      const q = Promise.resolve({ data: { id: 'paper-1' }, error: null });
      q.select = () => q; q.single = () => q; q.eq = () => q; q.insert = () => q; q.update = () => q;
      return q;
    };
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => chain() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
      loadChapterContent: async () => ({ content: 'x', pageReference: '1-2' }),
      loadPageRangeContent: async () => ({ content: 'x', pageReference: '1-2' }),
    }));
    jest.doMock('../../bot/shared/services/assessment/assessment-generation.service', () => ({
      generateExam: async (args) => { handed.push(args); throw new Error('stop-here'); },
    }));
    const Orch = require('../../bot/shared/services/assessment/assessment-orchestrator.service');
    await Orch.buildPaper({
      userId: 'u1', requestId: 'r1', grade: 4, subject: 'science', chapterNumber: 3,
      contentSource: 'both', questionCount: 17, seenCount: 5, questionTypes: [],
    }).catch(() => {});
    expect(handed).toHaveLength(1);
    expect(handed[0].seenCount).toBe(5);
  });
});
