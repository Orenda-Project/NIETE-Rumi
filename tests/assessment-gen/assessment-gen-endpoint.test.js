/**
 * Assessment Generator Flow endpoint tests — FEAT-092.
 *
 * Covers:
 *  - INIT returns the SPEC screen with grade + subject dropdown data
 *  - SPEC submit → QUESTIONS with computed summary + state persisted
 *  - QUESTIONS submit → submits to UG_EG + SUCCESS with friendly message
 *  - QUESTIONS submit with no valid types → stays on QUESTIONS with hint
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

describe('handleAssessmentGenDataExchange — SPEC → QUESTIONS', () => {
  test('valid SPEC submit navigates to QUESTIONS with summary + persists state', async () => {
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
    expect(out.screen).toBe('QUESTIONS');
    expect(out.data.spec_summary).toBe('Grade 4 · English · Ch 3: Numbers · Pages 10-15');

    // State persisted
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

describe('handleAssessmentGenDataExchange — QUESTIONS → submit', () => {
  beforeEach(async () => {
    // Seed state as if SPEC screen already submitted.
    await redis.set(`assessment_gen_flow:${FLOW_TOKEN}`, {
      generation_type: 'exam',
      grade: '4',
      subject: 'Eng',
      chapter: '',
      page_ranges: '10-15',
    });
  });

  test('happy path submits to UG_EG + returns SUCCESS', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-abc' });

    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTIONS',
      {
        _action: 'generate',
        content_source: 'unseen',
        question_types: ['MCQs', 'Fill in the Blanks'],
        count_mcqs: '5',
        count_fill: '3',
        count_brief: '',
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
      questionTypes: [
        { id: 'MCQs', count: 5 },
        { id: 'Fill in the Blanks', count: 3 },
      ],
    });

    // Job link persisted for the callback endpoint.
    const link = await redis.get('assessment_gen_job:job-abc');
    expect(link).toMatchObject({ jobId: 'job-abc', userId: USER_ID, grade: '4', subject: 'Eng' });
  });

  test('question_types as comma-separated string is parsed', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-2' });
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTIONS',
      {
        _action: 'generate',
        content_source: 'seen',
        question_types: 'MCQs,Brief Answers',
        count_mcqs: '4',
        count_brief: '2',
      },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SUCCESS');
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.questionTypes).toEqual([
      { id: 'MCQs', count: 4 },
      { id: 'Brief Answers', count: 2 },
    ]);
  });

  test('empty count on a checked type defaults to 5', async () => {
    AssessmentGenClient.submitJob.mockResolvedValue({ jobId: 'job-3' });
    await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTIONS',
      {
        _action: 'generate',
        content_source: 'unseen',
        question_types: ['MCQs'],
        count_mcqs: '',
      },
      FLOW_TOKEN,
    );
    const spec = AssessmentGenClient.submitJob.mock.calls[0][0];
    expect(spec.questionTypes).toEqual([{ id: 'MCQs', count: 5 }]);
  });

  test('no types picked → stays on QUESTIONS with hint', async () => {
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTIONS',
      { _action: 'generate', content_source: 'unseen', question_types: [] },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('QUESTIONS');
    expect(out.data.spec_summary).toMatch(/Please pick a question type/);
    expect(AssessmentGenClient.submitJob).not.toHaveBeenCalled();
  });

  test('submitJob failure returns friendly SUCCESS message', async () => {
    AssessmentGenClient.submitJob.mockRejectedValue(new Error('upstream 500'));
    const out = await endpoint.handleAssessmentGenDataExchange(
      USER_ID,
      'QUESTIONS',
      {
        _action: 'generate',
        content_source: 'unseen',
        question_types: ['MCQs'],
        count_mcqs: '5',
      },
      FLOW_TOKEN,
    );
    expect(out.screen).toBe('SUCCESS');
    expect(out.data.message).toMatch(/wrong queueing/);
  });
});
