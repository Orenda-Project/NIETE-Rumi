/**
 * Assessment Generator client tests — FEAT-092.
 *
 * Covers:
 *  - buildRequestBody spec-to-UG_EG mapping (seen/unseen, objective/subjective,
 *    per-type counts, curriculum default)
 *  - submitJob happy path (202 + job_id)
 *  - submitJob non-2xx surface as errors, WITHOUT leaking the api-key
 *  - pollStatus completed/pending/failed
 *  - parseCallback normalisation
 */

const axios = require('axios');
const AssessmentGenClient = require('../../bot/shared/services/assessment-generator-client.service');

describe('AssessmentGenClient.buildRequestBody', () => {
  test('maps unseen + MCQs objective + Word Problems subjective (Maths shape)', () => {
    const body = AssessmentGenClient.buildRequestBody({
      generationType: 'exam',
      grade: 4,
      subject: 'Maths',
      pageRanges: '10-15',
      contentSource: 'unseen',
      questionTypes: [
        { id: 'MCQs', count: 5, category: 'objective' },
        { id: 'Word Problems', count: 2, category: 'subjective' },
      ],
    });

    expect(body).toMatchObject({
      generation_type: 'exam',
      curriculum: 'ICT',
      grade: 4,
      subject: 'Maths',
      page_ranges: '10-15',
      question_types: ['unseen'],
      unseen_categories: ['objective', 'subjective'],
      unseen_objective_types: ['MCQs'],
      unseen_objective_counts: { MCQs: 5 },
      unseen_subjective_types: ['Word Problems'],
      unseen_subjective_counts: { 'Word Problems': 2 },
      image_generation_enabled: false,
      include_answer_key: false,
      enable_review: false,
      generate_bilingual: false,
    });
  });

  test('explicit category on each item overrides the static fallback (Brief Answers as SUBJECTIVE for Science)', () => {
    const body = AssessmentGenClient.buildRequestBody({
      generationType: 'exam',
      grade: 5,
      subject: 'Science',
      pageRanges: '1-10',
      contentSource: 'unseen',
      questionTypes: [
        // Brief Answers is objective for Eng/Urdu but SUBJECTIVE for Science
        // per UG_EG's doc. The endpoint stamps `category` from the OBJ_SUBJ
        // pick so the client doesn't have to guess.
        { id: 'Brief Answers', count: 3, category: 'subjective' },
      ],
    });
    expect(body.unseen_subjective_types).toEqual(['Brief Answers']);
    expect(body.unseen_subjective_counts).toEqual({ 'Brief Answers': 3 });
    expect(body.unseen_objective_types).toBeUndefined();
  });

  test('maps seen + Fill in the Blanks only', () => {
    const body = AssessmentGenClient.buildRequestBody({
      generationType: 'class_assessment',
      grade: 3,
      subject: 'Maths',
      pageRanges: '5-9, 12',
      contentSource: 'seen',
      questionTypes: [{ id: 'Fill in the Blanks', count: 8 }],
    });

    expect(body.generation_type).toBe('class_assessment');
    expect(body.question_types).toEqual(['seen']);
    expect(body.seen_categories).toEqual(['objective']);
    expect(body.seen_objective_types).toEqual(['Fill in the Blanks']);
    expect(body.seen_objective_counts).toEqual({ 'Fill in the Blanks': 8 });
    expect(body.seen_subjective_types).toBeUndefined();
  });

  test('adds callback_url when supplied', () => {
    const body = AssessmentGenClient.buildRequestBody({
      grade: 5,
      subject: 'Urdu',
      pageRanges: '1',
      contentSource: 'unseen',
      questionTypes: [{ id: 'MCQs', count: 3 }],
      callbackUrl: 'https://example.com/cb',
    });
    expect(body.callback_url).toBe('https://example.com/cb');
  });

  test('throws when required fields missing', () => {
    expect(() => AssessmentGenClient.buildRequestBody({})).toThrow(/grade is required/);
  });

  test('throws when contentSource is not seen/unseen', () => {
    expect(() =>
      AssessmentGenClient.buildRequestBody({
        grade: 1, subject: 'Eng', pageRanges: '1',
        contentSource: 'other', questionTypes: [{ id: 'MCQs', count: 1 }],
      })
    ).toThrow(/contentSource must be/);
  });

  test('throws when no valid question types survive mapping', () => {
    expect(() =>
      AssessmentGenClient.buildRequestBody({
        grade: 1, subject: 'Eng', pageRanges: '1',
        contentSource: 'unseen', questionTypes: [{ id: 'Unknown', count: 5 }],
      })
    ).toThrow(/no valid question types/);
  });
});

describe('AssessmentGenClient.submitJob', () => {
  beforeEach(() => {
    process.env.ASSESSMENT_GEN_BASE_URL = 'https://exam-generator-staging.taleemabad.com';
    process.env.ASSESSMENT_GEN_API_KEY = 'test-key-abc';
    axios.post.mockReset();
  });

  test('returns { jobId } on 202', async () => {
    axios.post.mockResolvedValue({
      status: 202,
      data: { status: 'accepted', job_id: '550e8400-e29b-41d4-a716-446655440000' },
    });

    const out = await AssessmentGenClient.submitJob({
      generationType: 'exam',
      grade: 4, subject: 'Eng', pageRanges: '10-15',
      contentSource: 'unseen',
      questionTypes: [{ id: 'MCQs', count: 5 }],
    });
    expect(out.jobId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://exam-generator-staging.taleemabad.com/api/v2/generate-exam');
    expect(body.grade).toBe(4);
    expect(opts.headers['api-key']).toBe('test-key-abc');
  });

  test('throws on 400 with server error text (no key echoed)', async () => {
    axios.post.mockResolvedValue({
      status: 400,
      data: { error: 'invalid page_ranges' },
    });

    let caught;
    try {
      await AssessmentGenClient.submitJob({
        grade: 4, subject: 'Eng', pageRanges: 'bad',
        contentSource: 'unseen',
        questionTypes: [{ id: 'MCQs', count: 5 }],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.status).toBe(400);
    expect(caught.message).toMatch(/invalid page_ranges/);
    expect(caught.message).not.toContain('test-key-abc');
  });

  test('throws when not configured', async () => {
    delete process.env.ASSESSMENT_GEN_BASE_URL;
    await expect(
      AssessmentGenClient.submitJob({
        grade: 4, subject: 'Eng', pageRanges: '10',
        contentSource: 'unseen',
        questionTypes: [{ id: 'MCQs', count: 5 }],
      })
    ).rejects.toThrow(/not configured/);
  });
});

describe('AssessmentGenClient.pollStatus', () => {
  beforeEach(() => {
    process.env.ASSESSMENT_GEN_BASE_URL = 'https://svc.example';
    process.env.ASSESSMENT_GEN_API_KEY = 'k';
    axios.get.mockReset();
  });

  test('returns completed with data.response payload', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        status: 'success',
        job_id: 'j1',
        job_status: 'completed',
        data: { status: 'completed', response: { exam_paper: '<html/>' } },
      },
    });
    const out = await AssessmentGenClient.pollStatus('j1');
    expect(out.status).toBe('completed');
    expect(out.data).toEqual({ exam_paper: '<html/>' });
  });

  test('returns failed with error', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        status: 'success',
        job_id: 'j1',
        job_status: 'failed',
        data: { status: 'failed', error: 'boom' },
      },
    });
    const out = await AssessmentGenClient.pollStatus('j1');
    expect(out.status).toBe('failed');
    expect(out.error).toBe('boom');
  });

  test('returns pending for in-flight jobs', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { status: 'success', job_id: 'j1', job_status: 'processing', data: {} },
    });
    const out = await AssessmentGenClient.pollStatus('j1');
    expect(out.status).toBe('processing');
  });
});

describe('AssessmentGenClient.parseCallback', () => {
  test('normalises completed callback', () => {
    const parsed = AssessmentGenClient.parseCallback({
      status: 'completed',
      job_id: 'j1',
      data: { exam_paper: '<html/>', exam_json: [] },
    });
    expect(parsed).toEqual({
      status: 'completed',
      jobId: 'j1',
      data: { exam_paper: '<html/>', exam_json: [] },
    });
  });

  test('normalises failed callback', () => {
    const parsed = AssessmentGenClient.parseCallback({
      status: 'failed', job_id: 'j2', error: 'nope',
    });
    expect(parsed).toEqual({ status: 'failed', jobId: 'j2', error: 'nope' });
  });

  test('unknown status is preserved', () => {
    const parsed = AssessmentGenClient.parseCallback({ status: 'weird', job_id: 'j3' });
    expect(parsed.status).toBe('weird');
    expect(parsed.jobId).toBe('j3');
  });
});
