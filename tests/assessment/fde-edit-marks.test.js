/**
 * Marks on a board-pattern question.
 *
 * The board pattern fixes what each question is worth: the paper prints one
 * "(8×5=40)" per part, never a mark per question. So on a board-pattern item:
 *   - the mark sent back as it was is not an edit, even when it is not a whole
 *     number (the Urdu paper's 1.25-mark items); the app sends the mark with
 *     every save, so refusing the echo made those items uneditable;
 *   - a CHANGED mark is refused: 400 EDIT_REJECTED / PATTERN_FIXED_MARKS. Taken
 *     silently it would print nowhere and still cost the item its scheme points.
 * Wording and answer edits stay, and a changed answer still drops the points.
 * A paper without `_layout` keeps today's marks rules exactly.
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
const FIXED = {
  success: false, code: 'EDIT_REJECTED', errorCode: 'PATTERN_FIXED_MARKS',
  error: "Board-pattern papers fix each question's marks.",
};

describe('an echoed mark is not an edit', () => {
  test('urdu Q4: the 1.25 mark sent back with a new answer is taken, and the mark stays 1.25', () => {
    const items = inSlot(URDU, 'urdu.C.Q4');
    expect(items.length).toBeGreaterThan(0);
    for (const { question } of items) {
      expect(question.marks).toBe(1.25);
      const out = Edit.applyEdit(question, { marks: '1.25', answer: 'نیا جواب' });
      expect(out.marks).toBe(1.25);
      expect(out.answer).toBe('نیا جواب');
    }
  });

  test('urdu Q4: the 1.25 mark sent back with a wording change leaves the scheme as it was', () => {
    const { question } = inSlot(URDU, 'urdu.C.Q4')[0];
    const out = Edit.applyEdit(question, { marks: '1.25', question: `${question.question} ` + 'ـ' });
    expect(out.scheme).toEqual(question.scheme);
  });

  test('every item of every fixture survives the round trip fieldsFor → applyEdit', () => {
    const refused = [];
    for (const tree of [MATHS, URDU, layout('science')]) {
      for (const q of Selection.indexQuestions(tree)) {
        const f = Edit.fieldsFor(q.question, { type: q.type });
        try { Edit.applyEdit(q.question, { marks: f.marks }); } catch (err) { refused.push(`${q.question.slot}: ${err.message}`); }
      }
    }
    expect(refused).toEqual([]);
  });
});

describe('a changed mark on a board-pattern question is refused (PATTERN_FIXED_MARKS)', () => {
  test('applyEdit throws EDIT_REJECTED with the code and the sentence', () => {
    const { question } = inSlot(MATHS, 'maths.B.Q2')[0];
    let err;
    try { Edit.applyEdit(question, { marks: '4' }); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('EDIT_REJECTED');
    expect(err.errorCode).toBe('PATTERN_FIXED_MARKS');
    expect(err.message).toBe(FIXED.error);
  });

  test('a fractional change on an Urdu Q4 item is refused the same way', () => {
    const { question } = inSlot(URDU, 'urdu.C.Q4')[0];
    expect(() => Edit.applyEdit(question, { marks: '2' })).toThrow(FIXED.error);
  });

  test("a sub-question of a board-pattern question keeps its mark too", () => {
    const parent = { slot: 'english.C.Q6', question: 'Read the situation and answer.', questions: [
      { question: 'What should the child say?', answer: 'Sorry', marks: 2 }] };
    expect(() => Edit.applyEdit(parent, { subIndex: 0, marks: '3' })).toThrow(FIXED.error);
    expect(Edit.applyEdit(parent, { subIndex: 0, marks: '2', answer: 'I am sorry' }).questions[0])
      .toEqual({ question: 'What should the child say?', answer: 'I am sorry', marks: 2 });
  });

  test('validate answers 400 PATTERN_FIXED_MARKS', async () => {
    const { id } = inSlot(MATHS, 'maths.B.Q2')[0];
    const out = await call('/assessment/edit/validate', { userId: U, paperId: 'v1', id, edit: { marks: '4' } });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toEqual(FIXED);
  });

  test('save answers 400 PATTERN_FIXED_MARKS and writes and renders nothing', async () => {
    const [a, b] = inSlot(MATHS, 'maths.B.Q2');
    const out = await call('/assessment/edit/save', {
      userId: U, parentId: 'v1',
      changes: { removed: [b.id], edits: [{ id: a.id, edit: { marks: '4' } }] },
    });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toMatchObject(FIXED);
    expect(out.payload.errors).toEqual([{ id: a.id, message: FIXED.error }]);
    expect(mockDb.tables.assessment_papers).toHaveLength(1);
    expect(mockRenders).toHaveLength(0);
  });

  test('save: an Urdu Q4 answer edit with the 1.25 mark echoed makes v2 at 100 marks', async () => {
    mockDb.tables.assessment_requests = [{ ...REQ, subject_code: 'urdu' }];
    mockDb.tables.assessment_papers = [paper({ exam_json: URDU })];
    const { id } = inSlot(URDU, 'urdu.C.Q4')[0];
    const out = await call('/assessment/edit/save', {
      userId: U, parentId: 'v1', changes: { edits: [{ id, edit: { marks: '1.25', answer: 'نیا جواب' } }] },
    });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({ success: true, status: 'ready', version: 2, marks: 100 });
  });
});

describe('a plain paper keeps its marks rules', () => {
  test('a new whole mark is taken; a fraction or zero is refused with the old sentence', () => {
    const q = { question: 'Why?', answer: 'Because.', marks: 3 };
    expect(Edit.applyEdit(q, { marks: '2' }).marks).toBe(2);
    expect(() => Edit.applyEdit(q, { marks: '1.5' })).toThrow('Marks must be a whole number, 1 or more.');
    expect(() => Edit.applyEdit(q, { marks: '0' })).toThrow('Marks must be a whole number, 1 or more.');
  });

  test('a plain refusal carries no errorCode', () => {
    let err;
    try { Edit.applyEdit({ question: 'Why?', marks: 3 }, { marks: '1.5' }); } catch (e) { err = e; }
    expect(err.code).toBe('EDIT_REJECTED');
    expect(err).not.toHaveProperty('errorCode');
  });

  test('validate on a plain paper with a new mark answers 200 as today', async () => {
    const plain = { seen: { subjective: { short_questions: [{ question: 'Why?', answer: 'Because.', marks: 3 }] } } };
    mockDb.tables.assessment_papers = [paper({ exam_json: plain })];
    const [{ id }] = Selection.indexQuestions(plain);
    const out = await call('/assessment/edit/validate', { userId: U, paperId: 'v1', id, edit: { marks: '4' } });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({ success: true, ok: true, marks: 4 });
  });
});
