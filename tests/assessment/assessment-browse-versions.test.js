/**
 * The portal's "My papers" with versions: ONE entry per paper (per family),
 * showing its latest version, and "· Version N" when N > 1.
 *
 * A family is every row with the same request_id. Three edits must not push
 * three other papers off page 1, so the list — and its exact count — is built
 * on assessment_requests, with the ready versions embedded (!inner), and the
 * newest ready version stands for the family. Polling a request's status looks
 * only at GENERATED rows: versions come from WhatsApp edits, not generation.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn(async (u) => `${u}?signed`),
  buildR2PublicUrl: (k) => `https://r2/${k}`,
}));
const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));

const Browse = require('../../bot/shared/services/assessment/assessment-browse.service');

const req = (id, over = {}) => ({ id, user_id: 'u1', grade_code: 'grade_4', subject_code: 'science', chapter_number: 3, output_format: 'pdf', created_at: '2026-09-29T00:00:00Z', ...over });
const pap = (id, request_id, over = {}) => ({
  id, request_id, attempt: 1, status: 'ready', edited_from: null, question_count: 20, total_marks: 40,
  ready_at: '2026-09-29T10:00:00Z', created_at: '2026-09-29T10:00:00Z',
  file_r2_key: `exams/u1/${id}/Grade4_Science.pdf`, answer_key_r2_key: `exams/u1/${id}/Grade4_Science_AnswerKey.pdf`, ...over,
});

beforeEach(() => {
  mockDb = makeFakeDb({
    assessment_requests: [
      req('rA', { created_at: '2026-09-30T08:00:00Z' }),
      req('rB', { created_at: '2026-09-29T08:00:00Z', subject_code: 'maths', grade_code: 'grade_3' }),
      req('rC', { created_at: '2026-09-28T08:00:00Z', user_id: 'someone-else' }),
      req('rD', { created_at: '2026-09-27T08:00:00Z' }),
    ],
    assessment_papers: [
      pap('a1', 'rA', { created_at: '2026-09-30T09:00:00Z' }),
      pap('a2', 'rA', { edited_from: 'a1', question_count: 18, total_marks: 36, created_at: '2026-09-30T09:10:00Z', ready_at: '2026-09-30T09:10:05Z' }),
      pap('ax', 'rA', { edited_from: 'a2', status: 'failed', created_at: '2026-09-30T09:15:00Z' }),
      pap('a3', 'rA', { edited_from: 'a1', question_count: 21, total_marks: 44, created_at: '2026-09-30T09:20:00Z', ready_at: '2026-09-30T09:20:05Z' }),
      pap('b1', 'rB'),
      pap('c1', 'rC'),
      pap('d1', 'rD', { status: 'failed' }),
    ],
  });
});

describe('listPapers — one entry per paper family', () => {
  test('the latest ready version stands for the family; a failed version is ignored', async () => {
    const out = await Browse.listPapers('u1', { page: 1, pageSize: 10 });
    expect(out.total).toBe(2); // rA and rB — not rC (not hers), not rD (never ready)
    expect(out.papers.map((p) => p.paper_id)).toEqual(['a3', 'b1']);
    expect(out.papers[0]).toMatchObject({ version: 3, version_count: 3, question_count: 21, total_marks: 44, has_answer_key: true });
    expect(out.papers[1]).toMatchObject({ version: 1, version_count: 1, grade: 3, subject_key: 'maths' });
  });

  test('filters and pages on families', async () => {
    const sci = await Browse.listPapers('u1', { subject: 'science', grade: 4 });
    expect(sci.papers.map((p) => p.paper_id)).toEqual(['a3']);
    const p2 = await Browse.listPapers('u1', { page: 2, pageSize: 1 });
    expect(p2).toMatchObject({ total: 2, page: 2 });
    expect(p2.papers.map((p) => p.paper_id)).toEqual(['b1']);
  });
});

describe('requestStatus — polling asks whether GENERATION finished', () => {
  test('a version is not an attempt: the generated row answers', async () => {
    const out = await Browse.requestStatus('rA', 'u1');
    expect(out).toMatchObject({ status: 'ready', paperId: 'a1' });
  });
});

describe('paperDownloadUrl — the version is in the file name', () => {
  test('_v3 for version 3, and on its key', async () => {
    const paper = await Browse.paperDownloadUrl('a3', 'u1', 'paper');
    expect(paper.filename).toMatch(/_v3\.pdf$/);
    const key = await Browse.paperDownloadUrl('a3', 'u1', 'answer_key');
    expect(key.filename).toMatch(/_v3_AnswerKey\.pdf$/);
  });
  test('the generated paper keeps its plain name', async () => {
    const paper = await Browse.paperDownloadUrl('a1', 'u1', 'paper');
    expect(paper.filename).not.toMatch(/_v\d/);
  });
});
