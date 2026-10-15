/**
 * Editing a board-pattern paper.
 *
 * A teacher can take a question off an FDE paper, put it back, and change its
 * wording, marks or answer; the next version keeps the pattern's shape. So the
 * selection keeps `_layout` (without it the paper would print as a plain paper),
 * the printed counts follow the questions still on the paper ("any eight of the
 * following eleven"), a changed mark or answer drops the marking-scheme points
 * that were worked for the old one, and adding a question is refused — the
 * pattern fixes how many questions each slot holds.
 *
 * The editor service, the selection, the edit rules, the renderer and the route
 * run for real; the database (in-memory PostgREST), storage and the PDF step
 * are faked. A paper without `_layout` edits exactly as before
 * (assessment-editor-service.test.js, assessment-selection.test.js).
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
  rendererFor: () => ({
    ext: 'pdf',
    render: async (html, opts) => { mockRenders.push({ html, opts }); return Buffer.from('%PDF /Type /Page /Type /Pages'); },
  }),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(async () => []),
}));

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const Edit = require('../../bot/shared/services/assessment/assessment-edit');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');

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
const router = require('../../bot/shared/routes/internal-assessment-edit.routes');

const idsOf = (tree, slot) => Selection.indexQuestions(tree).filter((q) => q.question.slot === slot).map((q) => q.id);
const allIds = (tree) => Selection.indexQuestions(tree).map((q) => q.id);
const papersWritten = () => mockDb.tables.assessment_papers.length;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function call(routePath, body) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.post);
  const handlers = layer.route.stack.map((s) => s.handle);
  let statusCode = 200; let payload;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await handlers[handlers.length - 1]({ body, headers: {} }, res);
  return { statusCode, payload };
}

describe('the selection keeps the pattern (E8.1)', () => {
  test('applySelection keeps _layout', () => {
    const drop = idsOf(EXAM, 'maths.B.Q2')[0];
    const out = Selection.applySelection(EXAM, allIds(EXAM).filter((id) => id !== drop));
    expect(out._layout).toEqual(EXAM._layout);
  });

  test('activeTree keeps _layout', () => {
    const flagged = Selection.setRemoved(EXAM, idsOf(EXAM, 'maths.B.Q2')[0], true);
    expect(Selection.activeTree(flagged)._layout).toEqual(EXAM._layout);
  });

  test("a selection one Q2 short prints 'eleven' and keeps (8×5=40) and Total Marks 100", () => {
    const drop = idsOf(EXAM, 'maths.B.Q2')[0];
    const out = Selection.applySelection(EXAM, allIds(EXAM).filter((id) => id !== drop));
    const html = text(Renderer.renderPaper({ examJson: out, grade: 5, subject: 'maths', answerLines: true }));
    expect(html).toContain('Attempt any eight of the following eleven questions. All questions carry equal marks.');
    expect(html).toContain('(8×5=40)');
    expect(html).toContain('Total Marks: 100');
  });

  test('a plain paper\'s selection carries no _layout key (unchanged)', () => {
    const plain = { seen: { objective: { MCQs: [{ question: 'a', marks: 1 }, { question: 'b', marks: 1 }] } } };
    const out = Selection.applySelection(plain, ['seen.objective.MCQs.1']);
    expect(out).toEqual({ seen: { objective: { MCQs: [{ question: 'b', marks: 1 }] } } });
    expect(Object.keys(Selection.activeTree(plain))).toEqual(['seen']);
  });
});

describe('a changed mark or answer drops the worked scheme points (E8.2)', () => {
  const q2 = () => Selection.indexQuestions(EXAM).find((q) => q.question.slot === 'maths.B.Q2').question;

  test('marks: points gone, checked null, accept and common error kept', () => {
    const before = { ...q2(), scheme: { ...q2().scheme, checked: 'ok', common_error: 'x' } };
    const out = Edit.applyEdit(before, { marks: '4' });
    expect(out.marks).toBe(4);
    expect(out.scheme.points).toBeUndefined();
    expect(out.scheme.checked).toBeNull();
    expect(out.scheme.accept).toEqual(before.scheme.accept);
    expect(out.scheme.common_error).toBe('x');
  });

  test('answer: points gone, checked null', () => {
    const out = Edit.applyEdit({ ...q2(), scheme: { ...q2().scheme, checked: 'replaced' } }, { answer: 'Seven million and more' });
    expect(out.scheme.points).toBeUndefined();
    expect(out.scheme.checked).toBeNull();
  });

  test('wording only: the scheme is untouched', () => {
    const out = Edit.applyEdit(q2(), { question: 'Write 7,083,451 in words.' });
    expect(out.scheme).toEqual(q2().scheme);
  });

  test('the same mark sent back is not a change', () => {
    const out = Edit.applyEdit(q2(), { marks: '5', answer: q2().answer });
    expect(out.scheme).toEqual(q2().scheme);
  });

  test("a sub-question's new answer drops the parent's points", () => {
    const parent = { question: 'Read and answer.', questions: [{ question: 'a', answer: 'x', marks: 1 }], scheme: { points: [{ text: 'x', marks: 1, kind: 'A' }], checked: 'ok' } };
    const out = Edit.applyEdit(parent, { subIndex: 0, answer: 'y' });
    expect(out.scheme.points).toBeUndefined();
    expect(out.scheme.checked).toBeNull();
  });

  test("a sub-question's own scheme (situation, comprehension) loses its points when its marks change", () => {
    const parent = { slot: 'english.C.Q6', question: 'Read the situation and answer.', questions: [
      { question: 'What should the child say?', answer: 'Sorry', marks: 2, scheme: { points: [{ text: 'an apology', marks: 2, kind: 'A' }], checked: 'ok' } },
      { question: 'Why?', answer: 'He was late', marks: 2, scheme: { points: [{ text: 'late', marks: 2, kind: 'A' }], checked: 'ok' } }] };
    const out = Edit.applyEdit(parent, { subIndex: 0, marks: '3' });
    expect(out.questions[0].scheme.points).toBeUndefined();
    expect(out.questions[0].scheme.checked).toBeNull();
    expect(out.questions[1].scheme).toEqual(parent.questions[1].scheme);
  });

  test('a plain question (no scheme) gains no scheme key', () => {
    const out = Edit.applyEdit({ question: 'Why?', answer: 'Because.', marks: 3 }, { marks: '2', answer: 'So.' });
    expect(out).toEqual({ question: 'Why?', answer: 'So.', marks: 2 });
  });
});

describe('adding a question to a board-pattern paper is refused (E8.3)', () => {
  test('appendQuestion throws EDIT_REJECTED with errorCode PATTERN_NO_ADD', () => {
    let err;
    try { Selection.appendQuestion(EXAM, { kind: 'short', subject: 'maths', grade: 5 }, { question: 'New?', answer: 'Yes' }); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('EDIT_REJECTED');
    expect(err.errorCode).toBe('PATTERN_NO_ADD');
  });

  test('save with an added question: refused, nothing written or rendered', async () => {
    const out = await Editor.saveVersion({
      userId: U, parentId: 'v1', changes: { added: [{ kind: 'short', edit: { question: 'New?', answer: 'Yes' } }] },
    });
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_NO_ADD' });
    expect(papersWritten()).toBe(1);
    expect(mockRenders).toHaveLength(0);
  });

  test.each([
    ['/assessment/edit/save', { parentId: 'v1', changes: { added: [{ kind: 'short', edit: { question: 'New?', answer: 'Yes' } }] } }],
    ['/assessment/edit/validate', { paperId: 'v1', kind: 'short', edit: { question: 'New?', answer: 'Yes' } }],
    ['/assessment/edit/add-kinds', { paperId: 'v1' }],
  ])('%s answers 400 EDIT_REJECTED / PATTERN_NO_ADD', async (route, body) => {
    const out = await call(route, { userId: U, ...body });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toEqual({
      success: false, code: 'EDIT_REJECTED', errorCode: 'PATTERN_NO_ADD', error: 'Board-pattern papers keep their shape.',
    });
  });
});

describe('a removal that would empty a slot is refused', () => {
  const EMPTY = {
    success: false, code: 'EDIT_REJECTED', errorCode: 'PATTERN_EMPTY_SLOT',
    error: 'Keep at least one question in every part of a board-pattern paper.',
  };

  test('the one Q3 item: 400 PATTERN_EMPTY_SLOT naming the slot, nothing made', async () => {
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { removed: idsOf(EXAM, 'maths.C.Q3') } });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toEqual({ ...EMPTY, slot: 'maths.C.Q3' });
    expect(papersWritten()).toBe(1);
    expect(mockRenders).toHaveLength(0);
  });

  test('both alternatives of an either/or question (Urdu Q8): refused, never "Attempt zero"', async () => {
    const rawUr = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'urdu.json'), 'utf8'));
    const UR = applyLayout(rawUr, P.subjects.urdu, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;
    mockDb.tables.assessment_requests = [{ ...REQ, subject_code: 'urdu' }];
    mockDb.tables.assessment_papers = [paper({ exam_json: UR })];
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { removed: idsOf(UR, 'urdu.C.Q8') } });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toEqual({ ...EMPTY, slot: 'urdu.C.Q8' });
    expect(mockRenders).toHaveLength(0);
  });

  test('one of the two alternatives is fine', async () => {
    const rawUr = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'urdu.json'), 'utf8'));
    const UR = applyLayout(rawUr, P.subjects.urdu, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;
    mockDb.tables.assessment_requests = [{ ...REQ, subject_code: 'urdu' }];
    mockDb.tables.assessment_papers = [paper({ exam_json: UR })];
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { removed: idsOf(UR, 'urdu.C.Q8').slice(0, 1) } });
    expect(out.statusCode).toBe(200);
  });
});

describe('the edit routes answer for a board-pattern paper as for a plain one (E8.5)', () => {
  test('validate: 200 with the edited question', async () => {
    const id = idsOf(EXAM, 'maths.B.Q2')[0];
    const out = await call('/assessment/edit/validate', { userId: U, paperId: 'v1', id, edit: { question: 'Write 7,083,451 in words.' } });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({ success: true, ok: true, text: 'Write 7,083,451 in words.' });
    expect(out.payload.question.slot).toBe('maths.B.Q2');
  });

  test('save: Remove one Q2 makes v2 with both files, the parent untouched', async () => {
    const id = idsOf(EXAM, 'maths.B.Q2')[0];
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { removed: [id] } });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({ success: true, status: 'ready', version: 2, marks: 100 });
    expect(papersWritten()).toBe(2);
    expect(mockDb.tables.assessment_papers[0].exam_json).toEqual(EXAM);
    const v2 = mockDb.tables.assessment_papers[1];
    expect(v2.exam_json._layout.preset_id).toBe('fde_g5_2027');
    expect(mockRenders).toHaveLength(2);
    expect(text(mockRenders[0].html)).toContain('any eight of the following eleven');
    expect(mockUploads).toEqual(['Grade5_Maths_FDE_v2.pdf', 'Grade5_Maths_FDE_v2_MarkingScheme.pdf']);
  });

  test('save: Put back restores the count', async () => {
    const id = idsOf(EXAM, 'maths.B.Q2')[0];
    const flagged = Selection.setRemoved(EXAM, id, true);
    mockDb.tables.assessment_papers = [paper({ exam_json: flagged })];
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { restored: [id] } });
    expect(out.statusCode).toBe(200);
    expect(text(mockRenders[0].html)).toContain('Attempt any eight questions. All questions carry equal marks.');
    expect(text(mockRenders[0].html)).not.toContain('eleven');
  });

  test('questions: paper.pattern, subjectKey, choices from the paper\'s own layout, marks from the renderer, items[].slot', async () => {
    const drop = idsOf(EXAM, 'maths.B.Q2').slice(0, 5);
    let tree = EXAM;
    for (const id of drop) tree = Selection.setRemoved(tree, id, true);
    mockDb.tables.assessment_papers = [paper({ exam_json: tree })];
    const out = await call('/assessment/edit/questions', { userId: U, paperId: 'v1' });
    expect(out.statusCode).toBe(200);
    const p = out.payload.paper;
    expect(p.pattern).toBe('fde_g5_2027');
    expect(p.subjectKey).toBe('maths');
    expect(p.marks).toBe(95);
    const q2 = p.choices.find((c) => c.slot === 'maths.B.Q2');
    expect(q2).toEqual({ slot: 'maths.B.Q2', label: 'Q2.', generate: 12, attempt: 8, marks_each: 5, live: 7 });
    expect(p.choices.map((c) => c.slot)).toEqual(EXAM._layout.sections.flatMap((s) => s.slots.map((x) => x.slot)));
    expect(out.payload.items[0].slot).toBe('maths.A.Q1a');
  });

  test("a plain paper's questions carry none of the pattern keys", async () => {
    const plain = JSON.parse(JSON.stringify(raw));
    mockDb.tables.assessment_papers = [paper({ exam_json: plain })];
    const out = await Editor.questions({ userId: U, paperId: 'v1' });
    expect(Object.keys(out.paper).sort()).toEqual(
      ['chapterNumber', 'grade', 'marks', 'paperId', 'questionCount', 'rtl', 'subject', 'version'],
    );
  });

  test('versions still answer', async () => {
    const out = await call('/assessment/edit/versions', { userId: U, paperId: 'v1' });
    expect(out.statusCode).toBe(200);
    expect(out.payload.versions[0]).toMatchObject({ paperId: 'v1', version: 1 });
  });
});

describe('an Urdu-medium board-pattern paper edits the same way', () => {
  const rawUr = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'urdu.json'), 'utf8'));
  const UR = applyLayout(rawUr, P.subjects.urdu, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;

  beforeEach(() => {
    mockDb.tables.assessment_requests = [{ ...REQ, subject_code: 'urdu' }];
    mockDb.tables.assessment_papers = [paper({ exam_json: UR })];
  });

  test('questions: Urdu item text, rtl, and the slot counts', async () => {
    const out = await call('/assessment/edit/questions', { userId: U, paperId: 'v1' });
    expect(out.payload.paper).toMatchObject({ pattern: 'fde_g5_2027', subjectKey: 'urdu', rtl: true, marks: 100 });
    expect(out.payload.items[0].text).toBe('"سانحہ" کا مطلب ہے');
    expect(out.payload.paper.choices.find((c) => c.slot === 'urdu.A.Q1')).toMatchObject({ generate: 20, attempt: 20, live: 20 });
  });

  test('Remove one MCQ: v2 is an Urdu paper and its scheme, 99 marks', async () => {
    const id = idsOf(UR, 'urdu.A.Q1')[0];
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { removed: [id] } });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({ status: 'ready', version: 2, marks: 99 });
    expect(mockRenders).toHaveLength(2);
    expect(mockRenders[0].html).toContain('dir="rtl"');
    expect(mockRenders[1].html).toContain('مارکنگ اسکیم');
    expect(mockUploads).toEqual(['Grade5_Urdu_FDE_v2.pdf', 'Grade5_Urdu_FDE_v2_MarkingScheme.pdf']);
  });
});
