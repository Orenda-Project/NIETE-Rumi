/**
 * Assessment Generator Flow endpoint tests — FEAT-092 rev2 (bd-2033).
 *
 * Covers the dynamic multi-screen state machine driven by Meta data_exchange:
 *   SPEC → SEEN_UNSEEN → (Seen fast-path → SUCCESS) OR
 *                        (Unseen/Both → OBJ_SUBJ → QUESTION_TYPES → SUCCESS)
 *
 *  - INIT returns SPEC
 *  - SPEC submit → SEEN_UNSEEN with summary + state persisted
 *  - SEEN_UNSEEN 'seen' → SUCCESS directly (fast-path submits with defaults)
 *  - SEEN_UNSEEN 'unseen' → OBJ_SUBJ
 *  - SEEN_UNSEEN 'both' → OBJ_SUBJ (treated as unseen at submit)
 *  - OBJ_SUBJ 'objective' → QUESTION_TYPES with objective type list
 *  - OBJ_SUBJ 'subjective' → QUESTION_TYPES with subjective type list
 *  - QUESTION_TYPES submit → UG_EG called, SUCCESS returned
 *  - Empty picks → stays on QUESTION_TYPES with hint
 *  - UG_EG submit failure → friendly SUCCESS message, no crash
 *  - Config returns no types for combo → friendly SUCCESS error
 */

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    get: jest.fn(async (k) => store.get(k) || null),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    _reset: () => store.clear(),
  };
});

jest.mock('../../bot/shared/services/assessment-generator-client.service', () => ({
  submitJob: jest.fn(),
  isConfigured: jest.fn(() => true),
}));

const redis = require('../../bot/shared/services/cache/railway-redis.service');
const AssessmentGenClient = require('../../bot/shared/services/assessment-generator-client.service');
const endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');

const USER_ID = 'user-1';
const FLOW_TOKEN = `${USER_ID}:assessment-gen:1234567890`;

async function seedSpec(overrides = {}) {
  const base = {
    generation_type: 'exam',
    grade: '4',
    subject: 'Eng',
    chapter: '',
    page_ranges: '10-15',
  };
  await redis.set(`assessment_gen_flow:${FLOW_TOKEN}`, { ...base, ...overrides });
}

beforeEach(() => {
  redis._reset();
  AssessmentGenClient.submitJob.mockReset();
});

describe('handleAssessmentGenInit', () => {
  test('returns SPEC screen with grade + subject data', async () => {
    const out = await endpoint.handleAssessmentGenInit(USER_ID, FLOW_TOKEN);
    expect(out.screen).toBe('SPEC');
    expect(out.data.grade_options.length).toBe(5);
    expect(out.data.subject_options.map((o) => o.id)).toEqual(
      expect.arrayContaining(['Eng', 'Maths', 'Urdu', 'Science', 'Islamiat', 'SST', 'GenK'])
    );
  });
});

describe('SPEC → SEEN_UNSEEN', () => {
  test('valid SPEC submit navigates to SEEN_UNSEEN with summary + persists state', async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'SPEC',
      {
        _action: 'spec_submit',
        generation_type: 'exam',
        grade: '4',
        subject: 'Eng',
        chapter: 'Ch 3: Numbers',
        page_ranges: '10-15',
      },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SEEN_UNSEEN');
    expect(out.data.spec_summary).toBe('Grade 4 · English · Ch 3: Numbers · Pages 10-15');
    const state = await redis.get(`assessment_gen_flow:${FLOW_TOKEN}`);
    expect(state).toMatchObject({
      generation_type: 'exam',
      grade: '4',
      subject: 'Eng',
      chapter: 'Ch 3: Numbers',
      page_ranges: '10-15',
    });
  });

  test('missing page_ranges bounces back to SPEC', async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'SPEC',
      { _action: 'spec_submit', generation_type: 'exam', grade: '4', subject: 'Eng' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SPEC');
  });
});

describe('SEEN_UNSEEN → (SUCCESS | OBJ_SUBJ)', () => {
  beforeEach(async () => { await seedSpec(); });

  test("'seen' fast-path submits to UG_EG with default type coverage and lands on SUCCESS", async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-seen-1' });
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'SEEN_UNSEEN',
      { _action: 'pick_source', content_source: 'seen' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SUCCESS');
    expect(AssessmentGenClient.submitJob).toHaveBeenCalledTimes(1);
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.contentSource).toBe('seen');
    expect(spec.questionTypes.length).toBeGreaterThanOrEqual(1);
    // Default coverage: at least one objective + one subjective type included
    const ids = spec.questionTypes.map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(['MCQs']));
    // Job link persisted
    const link = await redis.get('assessment_gen_job:job-seen-1');
    expect(link).toMatchObject({ jobId: 'job-seen-1', userId: USER_ID, contentSource: 'seen' });
  });

  test("'unseen' navigates to OBJ_SUBJ (no submit yet)", async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'SEEN_UNSEEN',
      { _action: 'pick_source', content_source: 'unseen' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('OBJ_SUBJ');
    expect(AssessmentGenClient.submitJob).not.toHaveBeenCalled();
    const state = await redis.get(`assessment_gen_flow:${FLOW_TOKEN}`);
    expect(state.content_source).toBe('unseen');
  });

  test("'both' also navigates to OBJ_SUBJ (treated as unseen downstream)", async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'SEEN_UNSEEN',
      { _action: 'pick_source', content_source: 'both' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('OBJ_SUBJ');
    const state = await redis.get(`assessment_gen_flow:${FLOW_TOKEN}`);
    expect(state.content_source).toBe('both');
  });

  test('expired session (no state) resets to SPEC', async () => {
    await redis.delete(`assessment_gen_flow:${FLOW_TOKEN}`);
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'SEEN_UNSEEN',
      { _action: 'pick_source', content_source: 'unseen' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SPEC');
  });
});

describe('OBJ_SUBJ → QUESTION_TYPES (dynamic)', () => {
  beforeEach(async () => { await seedSpec({ content_source: 'unseen' }); });

  test("'objective' populates QUESTION_TYPES with the full UG_EG English objective list", async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'OBJ_SUBJ',
      { _action: 'pick_category', category: 'objective' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('QUESTION_TYPES');
    expect(out.data.type_options.length).toBeGreaterThan(0);
    const ids = out.data.type_options.map((o) => o.id);
    // Per docs/question-types-ict.md, Eng Objective = MCQs, MSQs,
    // Fill in the Blanks, Missing Letters, True/False, Match the Column,
    // Circle the Correct Answer, Rewrite Sentences, Brief Answers,
    // Listening, Speaking, Reading. Brief Answers is OBJECTIVE for Eng/Urdu
    // (SUBJECTIVE only for Science).
    expect(ids).toEqual(expect.arrayContaining([
      'MCQs', 'MSQs', 'Fill in the Blanks', 'True/False',
      'Match the Column', 'Brief Answers',
    ]));
    // Comprehension Passage is Eng/Urdu SUBJECTIVE, not objective
    expect(ids).not.toContain('Comprehension Passage');
  });

  test("'subjective' populates QUESTION_TYPES with the English subjective list (grade band 3-5)", async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'OBJ_SUBJ',
      { _action: 'pick_category', category: 'subjective' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('QUESTION_TYPES');
    const ids = out.data.type_options.map((o) => o.id);
    // Grade 4 English Subjective per UG_EG doc (Grades 3-5 band): Word
    // Meanings, Word Sentences, Comprehension Passage, Letter Writing,
    // Application Writing, Story Writing, Essay Writing, Paragraph Writing,
    // Picture Description.
    expect(ids).toEqual(expect.arrayContaining([
      'Comprehension Passage', 'Word Meanings', 'Letter Writing',
      'Story Writing', 'Paragraph Writing',
    ]));
    // Objective-only types don't leak
    expect(ids).not.toContain('MCQs');
    expect(ids).not.toContain('Brief Answers'); // objective for Eng
  });

  test('config with no matching types returns friendly SUCCESS', async () => {
    // Seed a subject that is not in SUBJECT_RELEVANCE — should fallback but
    // if we force an unrecognised category we should still handle gracefully.
    await seedSpec({ content_source: 'unseen', subject: 'Eng' });
    // Force the config to return empty by monkey-patching for this test.
    const QuestionConfig = require('../../bot/shared/services/assessment-question-config.service');
    const orig = QuestionConfig.getQuestionTypes;
    QuestionConfig.getQuestionTypes = () => [];
    try {
      const out = await endpoint.handleAssessmentGenDataExchange(
        USER_ID,
        'OBJ_SUBJ',
        { _action: 'pick_category', category: 'objective' },
        FLOW_TOKEN,
      );
      expect(out.screen).toBe('SUCCESS');
      expect(out.data.message).toMatch(/couldn't find any question types/i);
    } finally {
      QuestionConfig.getQuestionTypes = orig;
    }
  });
});

describe('QUESTION_TYPES → SUCCESS', () => {
  beforeEach(async () => {
    await seedSpec({ content_source: 'unseen', category: 'objective' });
  });

  test('happy path submits to UG_EG + returns SUCCESS with per-type counts', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-abc' });
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      {
        _action: 'generate',
        question_types: ['MCQs', 'Fill in the Blanks'],
        count_mcqs: '5',
        count_fill_in_the_blanks: '3',
        count_brief_answers: '',
      },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SUCCESS');
    expect(out.data.message).toMatch(/Grade 4/);
    expect(out.data.message).toMatch(/pages 10-15/);
    expect(AssessmentGenClient.submitJob).toHaveBeenCalledTimes(1);
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec).toMatchObject({
      generationType: 'exam',
      grade: '4',
      subject: 'Eng',
      pageRanges: '10-15',
      contentSource: 'unseen',
      questionTypes: expect.arrayContaining([
        { id: 'MCQs', count: 5, category: 'objective' },
        { id: 'Fill in the Blanks', count: 3, category: 'objective' },
      ]),
    });
    const link = await redis.get('assessment_gen_job:job-abc');
    expect(link).toMatchObject({ jobId: 'job-abc', userId: USER_ID });
  });

  test('question_types as comma-separated string is parsed', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-2' });
    await seedSpec({ content_source: 'unseen', category: 'subjective' });
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      {
        _action: 'generate',
        question_types: 'Brief Answers',
        count_brief_answers: '2',
      },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SUCCESS');
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    // Brief Answers is subjective for Science; here the seeded state uses
    // Eng + subjective (from seedSpec override two lines up), so category comes
    // straight from state.category = 'subjective'.
    expect(spec.questionTypes).toEqual([{ id: 'Brief Answers', count: 2, category: 'subjective' }]);
  });

  test('empty count on a checked type defaults to config default (3)', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-3' });
    await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      {
        _action: 'generate',
        question_types: ['MCQs'],
        count_mcqs: '',
      },
      FLOW_TOKEN,
    );
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.questionTypes).toEqual([{ id: 'MCQs', count: 3, category: 'objective' }]);
  });

  test('count is capped at MAX_COUNT_PER_TYPE (20)', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-4' });
    await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      {
        _action: 'generate',
        question_types: ['MCQs'],
        count_mcqs: '999',
      },
      FLOW_TOKEN,
    );
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.questionTypes).toEqual([{ id: 'MCQs', count: 20, category: 'objective' }]);
  });

  test('unsupported type IDs are dropped', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-5' });
    await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      {
        _action: 'generate',
        // 'Not A Real Type' and '__bogus__' are not in UG_EG's catalogue.
        // MCQs + True/False are both valid and should survive.
        question_types: ['MCQs', 'True/False', 'Not A Real Type', '__bogus__'],
        count_mcqs: '2',
        count_true_false: '4',
      },
      FLOW_TOKEN,
    );
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.questionTypes.map((q) => q.id).sort()).toEqual(['MCQs', 'True/False']);
  });

  test('newly-enabled UG_EG types survive and are stamped with the picked category', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-newtypes' });
    await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      {
        _action: 'generate',
        question_types: ['MSQs', 'True/False', 'Match the Column'],
        count_msqs: '4',
        count_true_false: '5',
        count_match_the_column: '2',
      },
      FLOW_TOKEN,
    );
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.questionTypes).toEqual(expect.arrayContaining([
      { id: 'MSQs',             count: 4, category: 'objective' },
      { id: 'True/False',       count: 5, category: 'objective' },
      { id: 'Match the Column', count: 2, category: 'objective' },
    ]));
  });

  test('subjective picks (Word Problems, Comprehension Passage) survive and carry category', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-subj' });
    // Word Problems is Maths-only. Seed a Maths + subjective session.
    await seedSpec({ subject: 'Maths', content_source: 'unseen', category: 'subjective' });
    await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      {
        _action: 'generate',
        question_types: ['Word Problems'],
        count_word_problems: '6',
      },
      FLOW_TOKEN,
    );
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.questionTypes).toEqual([
      { id: 'Word Problems', count: 6, category: 'subjective' },
    ]);
  });

  test("'both' at content_source submits as 'unseen' upstream", async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-6' });
    await seedSpec({ content_source: 'both', category: 'objective' });
    await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      { _action: 'generate', question_types: ['MCQs'], count_mcqs: '3' },
      FLOW_TOKEN,
    );
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.contentSource).toBe('unseen');
  });

  test('no types picked → stays on QUESTION_TYPES with hint', async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      { _action: 'generate', question_types: [] },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('QUESTION_TYPES');
    expect(out.data.spec_summary).toMatch(/Please pick a question type/);
    expect(AssessmentGenClient.submitJob).not.toHaveBeenCalled();
  });

  test('submitJob failure returns friendly SUCCESS message (no crash)', async () => {
    AssessmentGenClient.submitJob.mockRejectedValue(new Error('upstream 500'));
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTION_TYPES',
      { _action: 'generate', question_types: ['MCQs'], count_mcqs: '5' },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SUCCESS');
    expect(out.data.message).toMatch(/wrong queueing/);
  });
});
