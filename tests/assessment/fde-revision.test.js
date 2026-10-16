/**
 * A new version of a board-pattern paper is the same two documents again.
 *
 * Both the paper and its marking scheme are re-rendered, each with its own PDF
 * options (the footer that carries "Page n of N"), under the pattern's file
 * names. The page counts are read again off the new PDFs, because a removed
 * question can change them and the scheme's "before the exam" box tells the
 * teacher how many pages to check. The total is the pattern's total (100) until
 * a removal takes a slot below the number the child must answer. A version never
 * rewrites its parent, and a teacher's removal never fails the paper for being
 * "short" — that check is for the model, not for her.
 *
 * Also the older in-place paths (the WhatsApp review Flow's trim, and its single
 * question edit). The real renderer runs; the database, storage and the PDF step
 * are faked. A plain paper's version renders exactly as before
 * (assessment-build-version.test.js).
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
// The paper comes back as a 3-page PDF, the marking scheme (it has the band) as 5.
const fakePdf = (pages) => Buffer.from(`%PDF ${'/Type /Page '.repeat(pages)}/Type /Pages`);
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: () => ({
    ext: 'pdf',
    render: async (...args) => {
      mockRenders.push(args);
      return fakePdf(args[0].includes('class="band"') ? 5 : 3);
    },
  }),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(async () => []),
}));
const mockSend = jest.fn(async () => true);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendDocumentByLink: (...a) => mockSend(...a),
  sendFlow: jest.fn(async () => true),
}));

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const FdeRenderer = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');

const P = Patterns.get('fde_g5_2027');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));
const BASE = applyLayout(raw, P.subjects.maths, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;
const EXAM = { ...BASE, _layout: { ...BASE._layout, pages: { paper: 4, scheme: 4 } } };

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
  mockSend.mockClear();
  mockDb = makeFakeDb({
    assessment_requests: [REQ],
    assessment_papers: [paper()],
    users: [{ id: U, phone_number: 'test-phone', school_name: 'School', preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_editing_enabled', value: true }],
  });
});

const q2Ids = (tree) => Selection.indexQuestions(tree).filter((q) => q.question.slot === 'maths.B.Q2').map((q) => q.id);
const removeQ2 = (n) => q2Ids(EXAM).slice(0, n).reduce((t, id) => Selection.setRemoved(t, id, true), EXAM);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const newRow = () => mockDb.tables.assessment_papers.find((r) => r.id !== 'v1');

describe('buildVersion on a board-pattern paper (E8.4)', () => {
  test('re-renders BOTH files, each with its own pdfOptions, under the pattern names', async () => {
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: removeQ2(1) });
    expect(out).toMatchObject({ status: 'ready', version: 2 });
    expect(mockRenders).toHaveLength(2);
    const [paperCall, schemeCall] = mockRenders;
    const tree = newRow().exam_json;
    expect(paperCall[1]).toEqual({ pdfOptions: FdeRenderer.pdfOptions(tree, 'paper') });
    expect(schemeCall[1]).toEqual({ pdfOptions: FdeRenderer.pdfOptions(tree, 'scheme') });
    expect(paperCall[0]).not.toContain('class="band"');
    expect(schemeCall[0]).toContain('class="band"');
    expect(mockUploads).toEqual(['Grade5_Maths_FDE_v2.pdf', 'Grade5_Maths_FDE_v2_MarkingScheme.pdf']);
    expect(out).toMatchObject({ fileName: 'Grade5_Maths_FDE_v2.pdf', keyFileName: 'Grade5_Maths_FDE_v2_MarkingScheme.pdf' });
  });

  test('v2 re-counts pages', async () => {
    await Revision.buildVersion({ parentId: 'v1', userId: U, tree: removeQ2(1) });
    expect(newRow().exam_json._layout.pages).toEqual({ paper: 3, scheme: 5 });
    expect(newRow().status).toBe('ready');
    // The parent keeps its own count.
    expect(mockDb.tables.assessment_papers[0].exam_json._layout.pages).toEqual({ paper: 4, scheme: 4 });
  });

  test("the scheme's box names the new paper file and its new page count", async () => {
    await Revision.buildVersion({ parentId: 'v1', userId: U, tree: removeQ2(1) });
    const box = text(mockRenders[1][0]);
    expect(box).toContain('Grade5_Maths_FDE_v2.pdf');
    expect(box).toContain('(3 pages)');
  });

  test('total from the renderer: one Q2 off keeps 100', async () => {
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: removeQ2(1) });
    expect(out.marks).toBe(100);
    expect(newRow().total_marks).toBe(100);
    expect(text(mockRenders[0][0])).toContain('any eight of the following eleven');
  });

  test('five Q2 off: 95, (7×5=35), and the paper is made, not refused as short', async () => {
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: removeQ2(5) });
    expect(out).toMatchObject({ status: 'ready', marks: 95 });
    expect(newRow().total_marks).toBe(95);
    expect(text(mockRenders[0][0])).toContain('(7×5=35)');
    expect(text(mockRenders[0][0])).toContain('Total Marks: 95');
  });

  test('a tree with an emptied slot is refused before any row or render (the review Flow path too)', async () => {
    const q3 = Selection.indexQuestions(EXAM).filter((q) => q.question.slot === 'maths.C.Q3').map((q) => q.id);
    const tree = q3.reduce((t, id) => Selection.setRemoved(t, id, true), EXAM);
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree });
    expect(out).toEqual({ status: 'failed', code: 'PATTERN_EMPTY_SLOT', slot: 'maths.C.Q3' });
    expect(mockDb.tables.assessment_papers).toHaveLength(1);
    expect(mockRenders).toHaveLength(0);
  });

  test('an answer edit lands on the v2 tree without its old scheme points', async () => {
    const id = q2Ids(EXAM)[0];
    const Edit = require('../../bot/shared/services/assessment/assessment-edit');
    const edited = Selection.replaceAt(EXAM, id, Edit.applyEdit(Selection.indexQuestions(EXAM).find((q) => q.id === id).question, { answer: 'Seven million and more' }));
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: edited });
    expect(out.status).toBe('ready');
    const q = Selection.indexQuestions(newRow().exam_json).find((x) => x.id === id).question;
    expect(q.scheme.points).toBeUndefined();
  });

  test('a plain paper still renders with one argument and the old names', async () => {
    const plain = JSON.parse(JSON.stringify(raw));
    mockDb.tables.assessment_papers = [paper({ exam_json: plain })];
    const out = await Revision.buildVersion({ parentId: 'v1', userId: U, tree: plain });
    expect(out.status).toBe('ready');
    expect(mockRenders.every((args) => args.length === 1)).toBe(true);
    expect(mockUploads).toEqual(['Grade5_Maths_v2.pdf', 'Grade5_Maths_v2_AnswerKey.pdf']);
    expect(newRow().exam_json).not.toHaveProperty('_layout');
  });
});

describe('resendVersion on a board-pattern paper whose scheme was never stored', () => {
  test('builds the marking scheme with its options, its name and the paper file it belongs to', async () => {
    mockDb.tables.assessment_papers = [paper({ answer_key_r2_key: null })];
    const out = await Revision.resendVersion({ paperId: 'v1', userId: U, phone: 'test-phone' });
    expect(out).toMatchObject({ status: 'resent', marks: 100 });
    expect(mockRenders).toHaveLength(1);
    expect(mockRenders[0][1]).toEqual({ pdfOptions: FdeRenderer.pdfOptions(EXAM, 'scheme') });
    expect(text(mockRenders[0][0])).toContain('Grade5_Maths_FDE.pdf');
    expect(mockUploads).toEqual(['Grade5_Maths_FDE_v1_MarkingScheme.pdf']);
  });
});

describe('the older in-place paths on a board-pattern paper', () => {
  test('rerender (the review Flow trim): the trimmed paper keeps the pattern, both files re-rendered', async () => {
    const drop = q2Ids(EXAM)[0];
    const keep = Selection.indexQuestions(EXAM).map((q) => q.id).filter((id) => id !== drop);
    const out = await Revision.rerender({ paperId: 'v1', userId: U, selectedIds: keep, phone: 'test-phone' });
    expect(out).toMatchObject({ status: 'ready', marks: 100 });
    expect(mockRenders).toHaveLength(2);
    expect(mockRenders[0][1]).toHaveProperty('pdfOptions');
    expect(mockRenders[1][1]).toHaveProperty('pdfOptions');
    expect(text(mockRenders[0][0])).toContain('any eight of the following eleven');
    const row = mockDb.tables.assessment_papers[0];
    expect(row.exam_json._layout.preset_id).toBe('fde_g5_2027');
    expect(row.exam_json._layout.pages).toEqual({ paper: 3, scheme: 5 });
    expect(row.total_marks).toBe(100);
  });

  test('rerender: unticking every item of a slot is refused, nothing rendered', async () => {
    const keep = Selection.indexQuestions(EXAM).filter((q) => q.question.slot !== 'maths.C.Q3').map((q) => q.id);
    const out = await Revision.rerender({ paperId: 'v1', userId: U, selectedIds: keep, phone: 'test-phone' });
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_EMPTY_SLOT' });
    expect(mockRenders).toHaveLength(0);
  });

  test('saveEdit: a wording edit is saved and the total stays the pattern total', async () => {
    const id = q2Ids(EXAM)[0];
    const out = await Revision.saveEdit({ paperId: 'v1', userId: U, questionId: id, edit: { question: 'Write 7,083,451 in words.' } });
    expect(out).toMatchObject({ status: 'ok', questionId: id });
    const row = mockDb.tables.assessment_papers[0];
    expect(row.total_marks).toBe(100);
    expect(row.exam_json._layout.preset_id).toBe('fde_g5_2027');
  });
});
