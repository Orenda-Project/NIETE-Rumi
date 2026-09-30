/**
 * bd-5ioto.11 — "My papers" must show a family's LATEST version even when two
 * rows share a created_at.
 *
 * The paper-versions backfill inserted every v1 with the SAME created_at as the
 * edited paper P it split off (P becomes v2). listPapers then broke the tie by
 * id, so about half the backfilled families showed the untrimmed original (v1)
 * instead of her edited paper. The rule now: a row never stands for the family
 * while one of its own descendants (edited_from chain) is ready; among the rows
 * left, created_at then id decide.
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

const TIE = '2026-09-01T10:00:00.123456+00:00';
const req = (id, over = {}) => ({ id, user_id: 'u1', grade_code: 'grade_4', subject_code: 'science', chapter_number: 3, output_format: 'pdf', created_at: '2026-09-01T09:00:00Z', ...over });
const pap = (id, request_id, over = {}) => ({
  id, request_id, attempt: 1, status: 'ready', edited_from: null, question_count: 20, total_marks: 40,
  ready_at: '2026-09-01T10:01:00Z', created_at: TIE,
  file_r2_key: `exams/u1/${id}/Grade4_Science.pdf`, answer_key_r2_key: `exams/u1/${id}/Grade4_Science_AnswerKey.pdf`, ...over,
});

// Staging's two failing families had a v1 id that sorts AFTER P's id.
const P = '1b341c40-be15-4cd2-bd78-e9cf5370b68a';
const V1 = '88d1f070-6305-5541-9b0a-45a787b9dab8';
const P2 = 'a0000000-0000-4000-8000-000000000001';
const V1B = '0f000000-0000-5000-8000-000000000001';

describe('listPapers — latest version under a created_at tie', () => {
  test('v1 and v2 with equal created_at and v1 id > v2 id: the list shows v2, labelled Version 2', async () => {
    expect(V1 > P).toBe(true);
    mockDb = makeFakeDb({
      assessment_requests: [req('r1')],
      assessment_papers: [
        pap(V1, 'r1', { question_count: 30, total_marks: 60 }),
        pap(P, 'r1', { edited_from: V1, question_count: 18, total_marks: 36 }),
      ],
    });
    const out = await Browse.listPapers('u1');
    expect(out.papers).toHaveLength(1);
    expect(out.papers[0]).toMatchObject({ paper_id: P, version: 2, version_count: 2, question_count: 18, total_marks: 36 });
  });

  test('the same tie with v1 id < v2 id still shows v2', async () => {
    expect(V1B < P2).toBe(true);
    mockDb = makeFakeDb({
      assessment_requests: [req('r1')],
      assessment_papers: [pap(V1B, 'r1'), pap(P2, 'r1', { edited_from: V1B, question_count: 18 })],
    });
    const out = await Browse.listPapers('u1');
    expect(out.papers[0]).toMatchObject({ paper_id: P2, version: 2, version_count: 2 });
  });

  test('a child beats its parent even when its created_at is EARLIER (clock skew)', async () => {
    mockDb = makeFakeDb({
      assessment_requests: [req('r1')],
      assessment_papers: [
        pap('p1', 'r1', { created_at: '2026-09-01T10:00:05Z' }),
        pap('p2', 'r1', { edited_from: 'p1', created_at: '2026-09-01T10:00:00Z' }),
      ],
    });
    const out = await Browse.listPapers('u1');
    expect(out.papers[0]).toMatchObject({ paper_id: 'p2', version: 2 });
  });

  test('a backfilled v1 + v2 with a later v3 edited from v2: v3, Version 3', async () => {
    mockDb = makeFakeDb({
      assessment_requests: [req('r1')],
      assessment_papers: [
        pap(V1, 'r1'),
        pap(P, 'r1', { edited_from: V1 }),
        pap('c3', 'r1', { edited_from: P, created_at: '2026-09-30T10:00:00.000000+00:00', question_count: 12 }),
      ],
    });
    const out = await Browse.listPapers('u1');
    expect(out.papers[0]).toMatchObject({ paper_id: 'c3', version: 3, version_count: 3, question_count: 12 });
  });
});

describe('versionNumberOf under the same tie (WhatsApp + download names)', () => {
  test('the tied v2 downloads as _v2 and v1 keeps its plain name', async () => {
    mockDb = makeFakeDb({
      assessment_requests: [req('r1')],
      assessment_papers: [pap(V1, 'r1'), pap(P, 'r1', { edited_from: V1 })],
    });
    expect((await Browse.paperDownloadUrl(P, 'u1', 'paper')).filename).toMatch(/_v2\.pdf$/);
    expect((await Browse.paperDownloadUrl(V1, 'u1', 'paper')).filename).not.toMatch(/_v\d/);
  });
});
