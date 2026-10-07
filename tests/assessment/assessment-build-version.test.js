/**
 * Every "Make my paper" is a NEW version — a new row that names the row it was
 * edited from — and no code path rewrites a version that is ready.
 *
 * The family is every row with the same request_id: a version copies its
 * parent's request_id AND attempt (the unique index covers generated rows only).
 * The version number is worked out, never stored: the generated row is 1, any
 * other is 1 + the ready non-generated rows in the family created no later.
 *
 * The REAL renderer and WhatsApp service run; the network (axios), storage (R2)
 * and the database (an in-memory PostgREST) are faked.
 */
jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));
const mockUploads = [];
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async ({ userId, examId, filename }) => {
    const key = `exams/${userId}/${examId}/${filename}`;
    mockUploads.push(key);
    return key;
  }),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: jest.fn(async (u) => `${u}?signed`),
}));
const mockRenders = [];
const mockRendererFor = jest.fn(() => ({ ext: 'pdf', render: async (html) => { mockRenders.push(html); return Buffer.from('pdf'); } }));
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: (...a) => mockRendererFor(...a),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(async () => [{ chapterNumber: 2, title: 'The Thirsty Crow' }]),
}));

const axios = require('axios');
const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');

const U = 'u1';
const REQ = {
  id: 'r1', user_id: U, grade_code: 'grade_3', subject_code: 'maths', chapter_number: 2,
  page_ranges: null, output_format: 'pdf', has_answer_lines: false, textbook_id: 't1',
};
const TREE = {
  seen: { objective: { MCQs: [
    { question: 'Q one', options: ['A) 1', 'B) 2'], answer: 'A) 1', marks: 1 },
    { question: 'Q two', options: ['A) 3', 'B) 4'], answer: 'B) 4', marks: 2 },
  ] }, subjective: { 'Short Questions': [{ question: 'Why?', answer: 'Because.', marks: 3, lines: 4 }] } },
};
const paper = (id, over = {}) => ({
  id, request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: TREE,
  created_at: '2026-09-30T09:00:00.000Z', file_r2_key: `exams/${U}/${id}/Grade3_Maths.pdf`,
  answer_key_r2_key: `exams/${U}/${id}/Grade3_Maths_AnswerKey.pdf`, question_count: 3, total_marks: 6, ...over,
});

function seed(extra = []) {
  mockDb = makeFakeDb({
    assessment_requests: [REQ],
    assessment_papers: [paper('v1'), ...extra],
    users: [{ id: U, phone_number: '923000000000', school_name: 'School', preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_editing_enabled', value: true }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploads.length = 0;
  mockRenders.length = 0;
  process.env.ASSESSMENT_REVIEW_FLOW_ID = 'REVIEW_FLOW';
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.x' }] } });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.t' }] }) }));
  seed();
});

// Documents and Flow messages go through axios; plain text through fetch.
const edited = () => {
  let t = Selection.replaceAt(TREE, 'seen.objective.MCQs.1', { ...TREE.seen.objective.MCQs[1], marks: 5 });
  t = Selection.setRemoved(t, 'seen.objective.MCQs.0', true);
  return t;
};

describe('buildVersion', () => {
  test('makes a ready child version and sends NOTHING', async () => {
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: edited() });
    expect(out).toMatchObject({ status: 'ready', version: 2, parentVersion: 1, questionCount: 2, marks: 8 });
    const child = mockDb.tables.assessment_papers.find((p) => p.id === out.paperId);
    expect(child).toMatchObject({ status: 'ready', edited_from: 'v1' });
    expect(child.file_r2_key).toMatch(/_v2\.pdf$/);
    expect(child.answer_key_r2_key).toMatch(/_v2_AnswerKey\.pdf$/);
    expect(axios.post).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refuses an empty paper without opening a row or sending', async () => {
    let t = TREE;
    for (const id of ['seen.objective.MCQs.0', 'seen.objective.MCQs.1', 'seen.subjective.Short Questions.0']) {
      t = Selection.setRemoved(t, id, true);
    }
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: t });
    expect(out).toEqual({ status: 'failed', code: 'EMPTY_SELECTION' });
    expect(mockDb.writes.filter((w) => w.op === 'insert')).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("someone else's paper is NOT_FOUND and sends nothing", async () => {
    const out = await Revision.buildVersion({ parentId: 'v1', userId: 'someone-else', tree: edited() });
    expect(out).toEqual({ status: 'failed', code: 'NOT_FOUND' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a render failure marks the child failed with RENDER_FAILED and sends nothing', async () => {
    mockRendererFor.mockReturnValueOnce({ ext: 'pdf', render: async () => { throw new Error('chromium'); } });
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: edited() });
    expect(out).toMatchObject({ status: 'failed', code: 'RENDER_FAILED' });
    const child = mockDb.tables.assessment_papers.find((p) => p.id === out.paperId);
    expect(child).toMatchObject({ status: 'failed', error_code: 'RENDER_FAILED' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
});
