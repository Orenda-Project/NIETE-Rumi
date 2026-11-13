/**
 * A board-pattern (FDE / FBISE) paper is edited by removing questions only (bd-cj8ggk.7).
 *
 * The wording, the options, the pairs and the answer of a board-pattern question
 * are not changed by a teacher: an edit that changes any of them is refused,
 * 400 EDIT_REJECTED / PATTERN_NO_EDIT. Remove and put back stay. The rule lives
 * in applyEdit, so the app and the WhatsApp Flow both keep it. Everything sent
 * back exactly as it was is not an edit, so the app's full-form save of an
 * unchanged question still goes through. A paper without `_layout` keeps
 * today's rules.
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
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async ({ filename }) => `k/${filename}`),
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

const P = Patterns.get('fde_g5_2027');
const layout = (subject) => applyLayout(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${subject}.json`), 'utf8')),
  P.subjects[subject], { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' },
).examJson;
const MATHS = layout('maths');
const URDU = layout('urdu');

const U = 'u1';
const REQ = {
  id: 'r1', user_id: U, grade_code: 'grade_5', subject_code: 'maths', chapter_number: null,
  page_ranges: '1-12', output_format: 'pdf', has_answer_lines: true, textbook_id: 't1',
};
const paper = (over = {}) => ({
  id: 'v1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: MATHS,
  created_at: '2026-10-20T07:12:00.000Z', file_r2_key: 'k/Grade5_Maths_FDE.pdf',
  answer_key_r2_key: 'k/Grade5_Maths_FDE_MarkingScheme.pdf', question_count: 48, total_marks: 100, ...over,
});

beforeEach(() => {
  mockRenders.length = 0;
  mockDb = makeFakeDb({
    assessment_requests: [REQ],
    assessment_papers: [paper()],
    users: [{ id: U, phone_number: 'test-phone', school_name: 'School', preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_editing_enabled', value: true }],
  });
});

const router = require('../../bot/shared/routes/internal-assessment-edit.routes');

async function call(routePath, body) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.post);
  const handlers = layer.route.stack.map((s) => s.handle);
  let statusCode = 200; let payload;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await handlers[handlers.length - 1]({ body, headers: {} }, res);
  return { statusCode, payload };
}

const inSlot = (tree, slot) => Selection.indexQuestions(tree).filter((q) => q.question.slot === slot);
const NO_EDIT = {
  success: false, code: 'EDIT_REJECTED', errorCode: 'PATTERN_NO_EDIT',
  error: 'Board-pattern papers can only have questions removed.',
};

function refusal(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

describe('applyEdit refuses any change to a board-pattern question', () => {
  test('a wording change is refused with PATTERN_NO_EDIT', () => {
    const { question } = inSlot(MATHS, 'maths.B.Q2')[0];
    const err = refusal(() => Edit.applyEdit(question, { question: `${question.question} more` }));
    expect(err).not.toBeNull();
    expect(err.code).toBe('EDIT_REJECTED');
    expect(err.errorCode).toBe('PATTERN_NO_EDIT');
    expect(err.message).toBe(NO_EDIT.error);
  });

  test('an answer change is refused, even with the 1.25 mark echoed', () => {
    const { question } = inSlot(URDU, 'urdu.C.Q4')[0];
    const err = refusal(() => Edit.applyEdit(question, { marks: '1.25', answer: 'نیا جواب' }));
    expect(err && err.errorCode).toBe('PATTERN_NO_EDIT');
  });

  test("a sub-question's answer is not changed either", () => {
    const parent = { slot: 'english.C.Q6', question: 'Read the situation and answer.', questions: [
      { question: 'What should the child say?', answer: 'Sorry', marks: 2 }] };
    const err = refusal(() => Edit.applyEdit(parent, { subIndex: 0, marks: '2', answer: 'I am sorry' }));
    expect(err && err.errorCode).toBe('PATTERN_NO_EDIT');
  });

  test('a changed mark still answers PATTERN_FIXED_MARKS, as before', () => {
    const { question } = inSlot(MATHS, 'maths.B.Q2')[0];
    expect(refusal(() => Edit.applyEdit(question, { marks: '4' })).errorCode).toBe('PATTERN_FIXED_MARKS');
  });

  test('remove is taken', () => {
    const { question } = inSlot(MATHS, 'maths.B.Q2')[0];
    expect(Edit.applyEdit(question, { remove: true }).removed).toBe(true);
  });

  test('the question sent back as it was is not an edit, for every item of every fixture', () => {
    const refused = [];
    for (const tree of [MATHS, URDU, layout('science')]) {
      for (const q of Selection.indexQuestions(tree)) {
        const f = Edit.fieldsFor(q.question, { type: q.type });
        try { Edit.applyEdit(q.question, { marks: f.marks }); } catch (err) {
          refused.push(`${q.question.slot}: ${err.message}`);
        }
      }
    }
    expect(refused).toEqual([]);
  });
});

describe('the portal editor on a board-pattern paper', () => {
  test('validate answers 400 PATTERN_NO_EDIT for a wording change', async () => {
    const { id, question } = inSlot(MATHS, 'maths.B.Q2')[0];
    const out = await call('/assessment/edit/validate', {
      userId: U, paperId: 'v1', id, edit: { question: `${question.question} more` },
    });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toEqual(NO_EDIT);
  });

  test('save with an edit answers 400 PATTERN_NO_EDIT and writes and renders nothing', async () => {
    const [a, b] = inSlot(MATHS, 'maths.B.Q2');
    const out = await call('/assessment/edit/save', {
      userId: U, parentId: 'v1',
      changes: { removed: [b.id], edits: [{ id: a.id, edit: { question: `${a.question.question} more` } }] },
    });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toMatchObject(NO_EDIT);
    expect(out.payload.errors).toEqual([{ id: a.id, message: NO_EDIT.error }]);
    expect(mockDb.tables.assessment_papers).toHaveLength(1);
    expect(mockRenders).toHaveLength(0);
  });

  test('save with a removal only makes v2', async () => {
    const [, b] = inSlot(MATHS, 'maths.B.Q2');
    const out = await call('/assessment/edit/save', { userId: U, parentId: 'v1', changes: { removed: [b.id] } });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({ success: true, status: 'ready', version: 2 });
  });
});

describe('a plain paper keeps its editing', () => {
  test('wording and answer changes are taken', () => {
    const q = { question: 'Why?', answer: 'Because.', marks: 3 };
    const out = Edit.applyEdit(q, { question: 'Why not?', answer: 'Just because.' });
    expect(out).toMatchObject({ question: 'Why not?', answer: 'Just because.' });
  });
});
