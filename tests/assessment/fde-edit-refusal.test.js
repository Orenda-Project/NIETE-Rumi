/**
 * A board-pattern paper keeps its shape: the first release makes the paper and its marking
 * scheme, and does not edit them. Every way into an edit — the portal's validate, save and
 * add, and the revision service the WhatsApp review path uses — refuses a paper that carries
 * `_layout` with PATTERN_NO_EDIT, before anything is written or rendered. Looking at the paper
 * (questions, versions) still works, and says which slot each item belongs to. A paper without
 * `_layout` edits exactly as before (assessment-editor-service.test.js).
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
  uploadExamBuffer: jest.fn(async ({ filename }) => { mockUploads.push(filename); return `k/${filename}`; }),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: jest.fn(async (u) => `${u}?signed`),
}));
const mockRenders = [];
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: () => ({ ext: 'pdf', render: async (html) => { mockRenders.push(html); return Buffer.from('pdf'); } }),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(async () => []),
}));

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');

const P = Patterns.get('fde_g5_2027');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));
const EXAM = applyLayout(raw, P.subjects.maths, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;

const U = 'u1';
const REQ = {
  id: 'r1', user_id: U, grade_code: 'grade_5', subject_code: 'maths', chapter_number: null,
  page_ranges: '1-12', output_format: 'pdf', has_answer_lines: true, textbook_id: 't1',
};
const paper = (over = {}) => ({
  id: 'v1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: EXAM,
  created_at: '2026-10-20T07:12:00.000Z', file_r2_key: 'k/Grade5_Maths_FDE.pdf',
  answer_key_r2_key: 'k/Grade5_Maths_FDE_MarkingScheme.pdf', question_count: 48, total_marks: 100, ...over,
});

beforeEach(() => {
  mockUploads.length = 0;
  mockRenders.length = 0;
  mockDb = makeFakeDb({
    assessment_requests: [REQ],
    assessment_papers: [paper()],
    users: [{ id: U, phone_number: 'test-phone', school_name: 'School', preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_editing_enabled', value: true }],
  });
});

const Editor = require('../../bot/shared/services/assessment/assessment-editor.service');
const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');
const router = require('../../bot/shared/routes/internal-assessment-edit.routes');

const firstId = () => Selection.indexQuestions(EXAM)[0].id;
const papersWritten = () => mockDb.tables.assessment_papers.length;

async function call(routePath, body) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.post);
  const handlers = layer.route.stack.map((s) => s.handle);
  let statusCode = 200; let payload;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await handlers[handlers.length - 1]({ body, headers: {} }, res);
  return { statusCode, payload };
}

describe('the portal editor refuses a board-pattern paper', () => {
  test('validate, save and add answer PATTERN_NO_EDIT, and nothing is written or rendered', async () => {
    expect(await Editor.validateEdit({ userId: U, paperId: 'v1', id: firstId(), edit: { question: 'x' } }))
      .toMatchObject({ code: 'PATTERN_NO_EDIT' });
    expect(await Editor.saveVersion({ userId: U, parentId: 'v1', changes: { removed: [firstId()] } }))
      .toMatchObject({ status: 'failed', code: 'PATTERN_NO_EDIT' });
    expect(await Editor.addKinds({ userId: U, paperId: 'v1' })).toMatchObject({ code: 'PATTERN_NO_EDIT' });
    expect(papersWritten()).toBe(1);
    expect(mockRenders).toHaveLength(0);
  });

  test('through the route: 400 with the code the app reads and an English sentence', async () => {
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { removed: [firstId()] } });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toEqual({
      success: false, code: 'PATTERN_NO_EDIT', errorCode: 'PATTERN_NO_EDIT', error: 'Board-pattern papers keep their shape.',
    });
    const v = await call('/assessment/edit/validate', { userId: U, paperId: 'v1', id: firstId(), edit: { question: 'x' } });
    expect(v.statusCode).toBe(400);
    expect(v.payload.errorCode).toBe('PATTERN_NO_EDIT');
  });

  test('looking still works: questions names the pattern and each item\'s slot', async () => {
    const out = await Editor.questions({ userId: U, paperId: 'v1' });
    expect(out.paper.pattern).toBe('fde_g5_2027');
    expect(out.items[0].slot).toBe('maths.A.Q1a');
    expect((await Editor.versions({ userId: U, paperId: 'v1' })).code).toBeUndefined();
  });

  test('a plain paper\'s questions carry no pattern key', async () => {
    mockDb.tables.assessment_papers = [paper({ exam_json: raw })];
    delete mockDb.tables.assessment_papers[0].exam_json._layout;
    const out = await Editor.questions({ userId: U, paperId: 'v1' });
    expect(out.paper).not.toHaveProperty('pattern');
  });
});

describe('the revision service refuses a board-pattern paper too (the WhatsApp review path)', () => {
  test('buildVersion', async () => {
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: EXAM });
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_NO_EDIT' });
    expect(papersWritten()).toBe(1);
  });

  test('rerender (trim from the review Flow)', async () => {
    const out = await Revision.rerender({ paperId: 'v1', userId: U, selectedIds: [firstId()] });
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_NO_EDIT' });
    expect(mockRenders).toHaveLength(0);
  });

  test('saveEdit', async () => {
    const out = await Revision.saveEdit({ paperId: 'v1', userId: U, questionId: firstId(), edit: { question: 'x' } });
    expect(out).toMatchObject({ code: 'PATTERN_NO_EDIT' });
    expect(mockRenders).toHaveLength(0);
  });
});
