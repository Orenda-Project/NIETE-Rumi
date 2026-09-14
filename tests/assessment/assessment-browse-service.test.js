/**
 * S4 — what the portal is allowed to offer, and what it may download.
 *
 * Surface-neutral, exactly like lp-v8-browse (bd-60063): full titles, no
 * truncation, no Flow-shaped {id,title} rows, no pagination caps borrowed from
 * a NavigationList. The Flow keeps building its own capped rows from the same
 * underlying tables; this returns the facts and lets each surface decide how it
 * looks.
 *
 * The reason it exists rather than the portal reading textbooks itself: the
 * portal offering a grade/subject the generator has no book for produces a
 * refusal she cannot act on. On the LP side that exact split — portal reading
 * one corpus, bot answering from another — put grade 5 maths at 0 chapters in
 * the portal and 8 on WhatsApp.
 */

const mockSupabase = { from: jest.fn() };
const mockGetPresignedUrl = jest.fn();
const mockBuildR2PublicUrl = jest.fn((k) => `https://r2/${k}`);

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: (...a) => mockGetPresignedUrl(...a),
  buildR2PublicUrl: (...a) => mockBuildR2PublicUrl(...a),
}));

const Browse = () => require('../../bot/shared/services/assessment/assessment-browse.service');

/** A chainable stub whose terminal call resolves to `result`. */
function table(result, capture = {}) {
  const b = {};
  const pass = () => b;
  ['select', 'eq', 'in', 'order', 'limit', 'range', 'not'].forEach((m) => {
    b[m] = (...args) => { (capture[m] ||= []).push(args); return pass(); };
  });
  b.maybeSingle = () => Promise.resolve(result);
  b.single = () => Promise.resolve(result);
  b.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return b;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('what she may pick', () => {
  it('offers only grades we hold an ICT book for', async () => {
    const cap = {};
    mockSupabase.from.mockReturnValue(table({
      data: [{ grade: 1 }, { grade: 1 }, { grade: 4 }, { grade: 5 }], error: null,
    }, cap));

    const grades = await Browse().listGrades();

    expect(grades).toEqual([1, 4, 5]);           // deduped and sorted
    // The curriculum filter is not optional: a punjab_snc_2020 book exists in
    // the same table and the ICT generator cannot read it.
    expect(JSON.stringify(cap.eq)).toContain('ict');
  });

  it('offers only subjects taught in that grade', async () => {
    mockSupabase.from.mockReturnValue(table({
      data: [
        { subject: 'maths' }, { subject: 'english' },
        // Science exists as a book but is not taught in Grade 3 — the GRADE_BANDS
        // rule. Offering it produces a refusal she cannot act on.
        { subject: 'science' },
      ],
      error: null,
    }));

    const subjects = await Browse().listSubjects(3);
    const keys = subjects.map((s) => s.subject_key);

    expect(keys).toContain('maths');
    expect(keys).toContain('english');
    expect(keys).not.toContain('science');
  });

  it('carries a printable label, so the portal does not keep its own copy', async () => {
    mockSupabase.from.mockReturnValue(table({
      data: [{ subject: 'social_studies' }], error: null,
    }));
    const [s] = await Browse().listSubjects(5);
    expect(s).toEqual({ subject_key: 'social_studies', subject: 'Social Studies' });
  });

  it('gives chapters their real titles and page spans, untruncated', async () => {
    const LONG = 'A chapter title long enough that a NavigationList row would have cut it';
    mockSupabase.from
      .mockReturnValueOnce(table({ data: { id: 'book-1' }, error: null }))   // textbook
      .mockReturnValueOnce(table({
        data: [{ chapter_number: 1, chapter_title: LONG, page_start: 4, page_end: 14 }],
        error: null,
      }));

    const chapters = await Browse().listChapters(4, 'science');

    expect(chapters).toEqual([{
      chapter_number: 1,
      chapter_title: LONG,
      page_start: 4,
      page_end: 14,
      page_count: 11,
    }]);
  });

  it('says which question types this subject and grade support, and the cap', async () => {
    const opts = await Browse().questionOptions('science', 4);
    const ids = opts.types.map((t) => t.id);

    expect(ids).toContain('Label the Diagram');     // science-only
    expect(ids).not.toContain('Essay Writing');     // english/urdu-only
    // The cap comes from the bot's own constant. The portal holds no number:
    // the dead panel used to hardcode MAX_COUNT = 20 against the bot's 25.
    expect(opts.maxQuestions).toBe(
      require('../../bot/shared/services/assessment/question-types').MAX_QUESTIONS);
    expect(opts.maxQuestions).toBe(25);
  });
});

describe('what she may download — ownership is the whole feature', () => {
  const PAPER = {
    id: 'paper-1',
    status: 'ready',
    file_r2_key: 'exams/u1/paper-1/p.pdf',
    answer_key_r2_key: 'exams/u1/paper-1/p_AnswerKey.pdf',
    assessment_requests: {
      user_id: 'u1', grade_code: 'grade_4', subject_code: 'science',
      chapter_number: 3, output_format: 'pdf',
    },
  };

  it('presigns the paper for its owner', async () => {
    mockSupabase.from.mockReturnValue(table({ data: PAPER, error: null }));
    mockGetPresignedUrl.mockResolvedValue('https://r2/signed');

    const out = await Browse().paperDownloadUrl('paper-1', 'u1', 'paper');

    expect(out.available).toBe(true);
    expect(out.url).toBe('https://r2/signed');
    expect(out.filename).toMatch(/\.pdf$/);
  });

  it("someone else's paper is indistinguishable from one that does not exist", async () => {
    mockSupabase.from.mockReturnValue(table({
      data: { ...PAPER, assessment_requests: { ...PAPER.assessment_requests, user_id: 'someone-else' } },
      error: null,
    }));

    const out = await Browse().paperDownloadUrl('paper-1', 'u1', 'paper');

    expect(out.available).toBe(false);
    // No url, and nothing that says the paper exists.
    expect(out.url).toBeUndefined();
    expect(mockGetPresignedUrl).not.toHaveBeenCalled();
  });

  it('a missing paper answers the same way', async () => {
    mockSupabase.from.mockReturnValue(table({ data: null, error: null }));
    const out = await Browse().paperDownloadUrl('nope', 'u1', 'paper');
    expect(out.available).toBe(false);
  });

  it('hands over the answer key when one was stored', async () => {
    mockSupabase.from.mockReturnValue(table({ data: PAPER, error: null }));
    mockGetPresignedUrl.mockResolvedValue('https://r2/signed-key');

    const out = await Browse().paperDownloadUrl('paper-1', 'u1', 'answer_key');

    expect(out.available).toBe(true);
    expect(out.filename).toMatch(/AnswerKey/);
  });

  it('says "not available" for a key we never recorded, rather than pretending', async () => {
    // Every paper generated before V1.4.2 is this case: the key may well be in
    // R2, but we never wrote down where. Absence is not "it was not generated".
    mockSupabase.from.mockReturnValue(table({
      data: { ...PAPER, answer_key_r2_key: null }, error: null,
    }));

    const out = await Browse().paperDownloadUrl('paper-1', 'u1', 'answer_key');

    expect(out.available).toBe(false);
    expect(mockGetPresignedUrl).not.toHaveBeenCalled();
  });

  it('refuses to hand over a paper that is not ready', async () => {
    mockSupabase.from.mockReturnValue(table({
      data: { ...PAPER, status: 'generating', file_r2_key: null }, error: null,
    }));
    const out = await Browse().paperDownloadUrl('paper-1', 'u1', 'paper');
    expect(out.available).toBe(false);
  });
});

describe('status — telling "still working" apart from "we are broken"', () => {
  const REQ = (over = {}) => ({
    id: 'req-1', user_id: 'u1',
    assessment_papers: [{ id: 'paper-1', status: 'ready', error_code: null, attempt: 1 }],
    ...over,
  });

  it('reports ready with the paper id to download', async () => {
    mockSupabase.from.mockReturnValue(table({ data: REQ(), error: null }));
    const out = await Browse().requestStatus('req-1', 'u1');
    expect(out.status).toBe('ready');
    expect(out.paperId).toBe('paper-1');
  });

  it('reports generating while the worker is still on it', async () => {
    mockSupabase.from.mockReturnValue(table({
      data: REQ({ assessment_papers: [{ id: 'paper-1', status: 'generating', attempt: 1 }] }),
      error: null,
    }));
    const out = await Browse().requestStatus('req-1', 'u1');
    expect(out.status).toBe('generating');
  });

  it('reports queued when no paper row exists yet', async () => {
    // createAndQueue writes the request and queues the job; the paper row is
    // opened by the worker when it picks the job up. Between those two moments
    // a poll finds a request with no papers, and that is "queued", not an error.
    mockSupabase.from.mockReturnValue(table({ data: REQ({ assessment_papers: [] }), error: null }));
    const out = await Browse().requestStatus('req-1', 'u1');
    expect(out.status).toBe('queued');
  });

  it('carries the error CODE on a failure, so she can be told the real reason', async () => {
    mockSupabase.from.mockReturnValue(table({
      data: REQ({ assessment_papers: [{ id: 'paper-1', status: 'failed', error_code: 'NO_CONTENT', attempt: 1 }] }),
      error: null,
    }));
    const out = await Browse().requestStatus('req-1', 'u1');
    expect(out.status).toBe('failed');
    expect(out.errorCode).toBe('NO_CONTENT');
  });

  it('reads the LATEST attempt — a retry is a new row, and the old one is a failure', async () => {
    mockSupabase.from.mockReturnValue(table({
      data: REQ({ assessment_papers: [
        { id: 'paper-1', status: 'failed', error_code: 'BAD_JSON', attempt: 1 },
        { id: 'paper-2', status: 'ready', error_code: null, attempt: 2 },
      ] }),
      error: null,
    }));
    const out = await Browse().requestStatus('req-1', 'u1');
    expect(out.status).toBe('ready');
    expect(out.paperId).toBe('paper-2');
  });

  it("someone else's request is not found, not forbidden", async () => {
    mockSupabase.from.mockReturnValue(table({ data: REQ({ user_id: 'other' }), error: null }));
    const out = await Browse().requestStatus('req-1', 'u1');
    expect(out.status).toBe('not_found');
  });
});

describe('her papers, paginated and filtered (D5)', () => {
  const ROW = {
    id: 'paper-1', status: 'ready', question_count: 20, total_marks: 45,
    ready_at: '2026-09-09T10:00:00Z', file_r2_key: 'k', answer_key_r2_key: null,
    assessment_requests: {
      user_id: 'u1', grade_code: 'grade_4', subject_code: 'science', chapter_number: 3,
    },
  };

  it('returns only ready papers, newest first', async () => {
    const cap = {};
    mockSupabase.from.mockReturnValue(table({ data: [ROW], error: null, count: 1 }, cap));
    const out = await Browse().listPapers('u1', { page: 1, pageSize: 10 });

    expect(out.papers).toHaveLength(1);
    expect(out.papers[0]).toMatchObject({
      paper_id: 'paper-1', grade: 4, subject_key: 'science',
      subject: 'Science', question_count: 20, total_marks: 45,
    });
    expect(JSON.stringify(cap.order)).toContain('ready_at');
  });

  it('says whether an answer key can be handed over', async () => {
    mockSupabase.from.mockReturnValue(table({
      data: [{ ...ROW, answer_key_r2_key: 'ak' }], error: null, count: 1,
    }));
    const [p] = (await Browse().listPapers('u1', {})).papers;
    expect(p.has_answer_key).toBe(true);
  });

  it('reports no answer key for papers generated before we stored the location', async () => {
    mockSupabase.from.mockReturnValue(table({ data: [ROW], error: null, count: 1 }));
    const [p] = (await Browse().listPapers('u1', {})).papers;
    expect(p.has_answer_key).toBe(false);
  });

  it('pages, and says how many there are in total', async () => {
    const cap = {};
    mockSupabase.from.mockReturnValue(table({ data: [ROW], error: null, count: 37 }, cap));
    const out = await Browse().listPapers('u1', { page: 3, pageSize: 10 });

    expect(out.total).toBe(37);
    expect(out.page).toBe(3);
    // page 3 of 10 = rows 20..29
    expect(cap.range).toEqual([[20, 29]]);
  });

  it('filters on the same two axes she picked when making the paper', async () => {
    const cap = {};
    mockSupabase.from.mockReturnValue(table({ data: [], error: null, count: 0 }, cap));
    await Browse().listPapers('u1', { grade: 4, subject: 'science' });

    const eqs = JSON.stringify(cap.eq);
    expect(eqs).toContain('grade_4');
    expect(eqs).toContain('science');
  });
});
