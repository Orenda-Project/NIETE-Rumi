/**
 * Exam-generator question-type multi-select — behaviour contract.
 *
 * Two things are pinned here:
 *   1. bankTypesForQuestionTypes() — the pure user-facing-ID → bank.type mapper.
 *      Empty / unknown input returns null (= no filter), which is the
 *      back-compat path for old client caches that submit without the field.
 *   2. The exam-generator Flow endpoint — when CHAPTERS returns select_chapters
 *      the next screen is QUESTION_TYPES (with all 7 pre-checked), and when
 *      QUESTION_TYPES returns generate the queued job carries the picked types
 *      through to the composer.
 */

// ─── #1 mapper --------------------------------------------------------------

// Composer requires supabase — stub it out; the mapper doesn't touch it.
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));

const {
  bankTypesForQuestionTypes,
  QUESTION_TYPE_MAP,
} = require('../../bot/shared/services/exam/exam-composer.service');

describe('bankTypesForQuestionTypes', () => {
  it('returns null when passed nothing (back-compat path — no filter)', () => {
    expect(bankTypesForQuestionTypes(undefined)).toBeNull();
    expect(bankTypesForQuestionTypes(null)).toBeNull();
    expect(bankTypesForQuestionTypes([])).toBeNull();
  });

  it('returns null when passed only unknown IDs', () => {
    expect(bankTypesForQuestionTypes(['not_a_real_id'])).toBeNull();
  });

  it('maps mcq to the objective MCQ-family bank types', () => {
    const result = bankTypesForQuestionTypes(['mcq']);
    expect(result).toBeInstanceOf(Set);
    expect(result.has('MCQs')).toBe(true);
    expect(result.has('MSQs')).toBe(true);
    // Does NOT bleed into other buckets
    expect(result.has('Fill in the Blanks')).toBe(false);
    expect(result.has('True/False')).toBe(false);
  });

  it('unions across multiple picked types', () => {
    const result = bankTypesForQuestionTypes(['true_false', 'fill_blanks']);
    expect(result.has('True/False')).toBe(true);
    expect(result.has('Fill in the Blanks')).toBe(true);
    expect(result.has('Missing Letters')).toBe(true);
    expect(result.has('MCQs')).toBe(false);
  });

  it('covers all 7 user-facing IDs', () => {
    // If someone adds a new option to the flow endpoint but forgets to add
    // its bank-type mapping here, this fails fast.
    const ids = ['mcq', 'short_answer', 'long_answer', 'fill_blanks',
                 'true_false', 'match_columns', 'comprehension'];
    for (const id of ids) {
      expect(QUESTION_TYPE_MAP[id]).toBeDefined();
      expect(QUESTION_TYPE_MAP[id].length).toBeGreaterThan(0);
    }
  });
});

// ─── #2 endpoint screen transitions ----------------------------------------

// Stub the collaborators the endpoint pulls in. Names prefixed with `mock`
// to satisfy jest's factory hoisting guard.
const mockRedisStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get:    async (k)          => mockRedisStore.get(k) ?? null,
  set:    async (k, v, _ttl) => { mockRedisStore.set(k, v); },
  delete: async (k)          => { mockRedisStore.delete(k); },
}));

const mockQueuedJobs = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueJob: async (userId, type, payload) => {
    mockQueuedJobs.push({ userId, type, payload });
    return { ok: true };
  },
}));

describe('exam-generator endpoint — question_types screen transitions', () => {
  let handler;

  beforeEach(() => {
    mockRedisStore.clear();
    mockQueuedJobs.length = 0;
    jest.resetModules();
    // Re-require after redis + queue mocks are in place so the endpoint picks them up.
    // (Prior jest.mock calls hoist above, so this is only re-requiring the module
    // graph — not the mocks themselves.)
    // eslint-disable-next-line global-require
    handler = require('../../bot/shared/routes/exam-generator-endpoint');
  });

  it('CHAPTERS with select_chapters advances to QUESTION_TYPES with all 7 pre-checked', async () => {
    // Seed a session so the endpoint doesn't dead-end on missing state.
    await require('../../bot/shared/services/cache/railway-redis.service').set(
      'exam_flow:tok-1',
      { exam_type: 'WEEKLY', grade: 'Grade Five', subject: 'Math', language: 'en' }
    );

    const res = await handler.handleExamGeneratorDataExchange(
      'user-1', 'CHAPTERS',
      { _action: 'select_chapters', chapters: ['1', '2'] },
      'tok-1'
    );

    expect(res.screen).toBe('QUESTION_TYPES');
    expect(res.data.question_type_options).toHaveLength(7);
    // All 7 IDs are the defaults so a teacher who just taps "Generate exam"
    // gets identical behaviour to the old flow.
    expect(res.data.question_type_defaults).toEqual(
      res.data.question_type_options.map(o => o.id)
    );
  });

  it('QUESTION_TYPES with generate queues a job carrying the picked question_types', async () => {
    // Seed both prior selections in the session.
    await require('../../bot/shared/services/cache/railway-redis.service').set(
      'exam_flow:tok-2',
      {
        exam_type: 'WEEKLY',
        grade: 'Grade Five',
        subject: 'Math',
        language: 'en',
        chapters: [1, 2],
      }
    );

    const res = await handler.handleExamGeneratorDataExchange(
      'user-1', 'QUESTION_TYPES',
      { _action: 'generate', question_types: ['mcq', 'true_false'] },
      'tok-2'
    );

    expect(res.screen).toBe('SUCCESS');
    expect(mockQueuedJobs).toHaveLength(1);
    expect(mockQueuedJobs[0].type).toBe('exam_generate');
    expect(mockQueuedJobs[0].payload.question_types).toEqual(['mcq', 'true_false']);
    expect(mockQueuedJobs[0].payload.chapters).toEqual([1, 2]);
    expect(mockQueuedJobs[0].payload.grade).toBe('Grade Five');
  });

  it('QUESTION_TYPES with an empty picker falls back to all-types (v1 back-compat)', async () => {
    await require('../../bot/shared/services/cache/railway-redis.service').set(
      'exam_flow:tok-3',
      {
        exam_type: 'WEEKLY',
        grade: 'Grade Five',
        subject: 'Math',
        language: 'en',
        chapters: [1],
      }
    );

    const res = await handler.handleExamGeneratorDataExchange(
      'user-1', 'QUESTION_TYPES',
      { _action: 'generate', question_types: [] },
      'tok-3'
    );

    expect(res.screen).toBe('SUCCESS');
    expect(mockQueuedJobs).toHaveLength(1);
    // Empty → filled with all 7 IDs (defensive; a bank-type filter of "everything"
    // is equivalent to no filter for a well-covered subject, but we prefer to
    // be explicit at the job boundary rather than pass an empty array around).
    expect(mockQueuedJobs[0].payload.question_types).toEqual(handler.QUESTION_TYPE_IDS);
  });
});
