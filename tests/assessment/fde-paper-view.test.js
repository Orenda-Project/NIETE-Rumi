/**
 * A board-pattern paper on the portal's paper page and in her list of papers.
 *
 * The paper page reads the same laid-out tree the PDF prints from: one section per slot, the
 * section's own heading on its first slot, and the slot's instruction with the SAME choice line
 * the paper prints (the renderer's choiceLine), so "any eight of the following eleven" cannot
 * say one thing on the phone and another on paper. The list carries the pattern and the page
 * counts as JSONB slices, so no row is read whole. A paper without `_layout` is untouched.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
const mockFrom = jest.fn((t) => mockDb.client.from(t));
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockFrom(t) }));
jest.mock('../../bot/shared/storage/r2', () => ({}));

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const FDE = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const View = require('../../bot/shared/services/assessment/assessment-paper-view.service');

const P = Patterns.get('fde_g5_2027');
function laid(subject) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${subject}.json`), 'utf8'));
  return applyLayout(raw, P.subjects[subject], { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;
}
const slotItems = (exam, slot) => Object.values(exam.unseen).flatMap((types) => Object.values(types))
  .flat().filter((q) => q && q.slot === slot);

const U = 'u1';
const REQ = { id: 'r1', user_id: U, grade_code: 'grade_5', subject_code: 'maths', chapter_number: null };
function seed(exam, subject = 'maths') {
  mockDb = makeFakeDb({
    assessment_requests: [{ ...REQ, subject_code: subject }],
    assessment_papers: [{
      id: 'p1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: exam,
      created_at: '2026-10-20T07:12:00.000Z', question_count: 48, total_marks: 100,
    }],
    app_settings: [],
  });
}

describe('buildPaperView on a board-pattern paper', () => {
  const exam = laid('maths');
  const sections = View.buildPaperView(exam);
  const L = exam._layout;

  test('one section per slot, in the paper order', () => {
    const slots = L.sections.flatMap((sec) => sec.slots.map((s) => s.slot));
    expect(sections.map((s) => s.slot)).toEqual(slots);
  });

  test('the section heading sits on its first slot only, with its time and marks', () => {
    const firstOfA = sections.find((s) => s.slot === 'maths.A.Q1a');
    const secondOfA = sections.find((s) => s.slot === 'maths.A.Q1b');
    expect(firstOfA.heading).toBe('SECTION - A · Time Allowed: 1 Hr. · 40 marks');
    expect(secondOfA.heading).toBeNull();
    expect(sections.find((s) => s.slot === 'maths.B.Q2').heading).toBe('Section-B · Time: 2 Hrs. · 40 marks');
  });

  test("the lead is the slot's label and FDE's own choice line, as the paper prints it", () => {
    const q2 = sections.find((s) => s.slot === 'maths.B.Q2');
    const slot = L.sections[1].slots[0];
    expect(q2.lead).toBe(`Q2 ${FDE.choiceLine(slot, 12, 'en').text}`);
    expect(q2.lead).toContain('Attempt any eight questions');
    expect(q2.lead).toContain('(8×5=40)');
  });

  test('a slot lists its own items, numbered straight through the paper', () => {
    const q1a = sections.find((s) => s.slot === 'maths.A.Q1a');
    expect(q1a.questions).toHaveLength(20);
    expect(q1a.questions[0].number).toBe(1);
    expect(sections.find((s) => s.slot === 'maths.A.Q1b').questions[0].number).toBe(21);
    expect(sections.flatMap((s) => s.questions)).toHaveLength(48);
  });

  test('a removed item leaves its slot and the choice line counts what is left ("eleven")', () => {
    const copy = JSON.parse(JSON.stringify(exam));
    slotItems(copy, 'maths.B.Q2')[0].removed = true;
    const q2 = View.buildPaperView(copy).find((s) => s.slot === 'maths.B.Q2');
    expect(q2.questions).toHaveLength(11);
    expect(q2.lead).toContain('eleven');
  });

  test('a paper without _layout is read exactly as before', () => {
    const plain = { seen: { objective: { MCQs: [{ question: 'Q', options: ['A) 1', 'B) 2'], marks: 1 }] } } };
    const out = View.buildPaperView(plain);
    expect(out).toEqual([{ heading: 'MCQs', lead: null, questions: [{ number: 1, text: 'Q', marks: 1, shape: 'options', options: ['A) 1', 'B) 2'] }] }]);
    expect(out[0]).not.toHaveProperty('slot');
  });
});

describe('view() on a board-pattern paper', () => {
  test('the paper carries its pattern, the pattern total, the page counts and no "you add" for maths', async () => {
    const exam = laid('maths');
    exam._layout.pages = { paper: 4, scheme: 5 };
    seed(exam);
    const out = await View.view({ userId: U, paperId: 'p1' });
    expect(out.paper).toMatchObject({ pattern: 'fde_g5_2027', totalMarks: 100, marks: 100, pages: { paper: 4, scheme: 5 }, youAdd: null });
  });

  test('science names what the teacher adds and on which paper page, when the render found it', async () => {
    const exam = laid('science');
    exam._layout.frame_pages = { 'science.A.Q1b': 2 };
    seed(exam, 'science');
    const out = await View.view({ userId: U, paperId: 'p1' });
    expect(out.paper.youAdd).toEqual({ en: 'the diagram to label', ur: expect.any(String), page: 2 });
    expect(out.paper.pages).toBeNull();
  });

  test('an Urdu-medium paper reads its Urdu headings', async () => {
    const exam = laid('urdu');
    seed(exam, 'urdu');
    const out = await View.view({ userId: U, paperId: 'p1' });
    const first = out.sections[0];
    expect(first.heading).toContain(exam._layout.sections[0].label_ur);
    expect(out.paper.pattern).toBe('fde_g5_2027');
  });

  test('a plain paper gains no pattern keys', async () => {
    seed({ seen: { objective: { MCQs: [{ question: 'Q', options: ['A) 1'], marks: 1 }] } } }, 'science');
    const out = await View.view({ userId: U, paperId: 'p1' });
    expect(out.paper).not.toHaveProperty('pattern');
    expect(out.paper).not.toHaveProperty('pages');
  });
});

describe('listPapers names the pattern and the page counts', () => {
  const mockSupabase = { from: jest.fn() };
  function table(result, capture = {}) {
    const b = {};
    ['select', 'eq', 'in', 'order', 'limit', 'range', 'not'].forEach((m) => {
      b[m] = (...args) => { (capture[m] ||= []).push(args); return b; };
    });
    b.then = (res, rej) => Promise.resolve(result).then(res, rej);
    return b;
  }
  const ROW = (paper) => ({
    id: 'req-1', grade_code: 'grade_5', subject_code: 'maths', chapter_number: null, created_at: '2026-10-20T07:00:00Z',
    assessment_papers: [{
      id: 'paper-1', status: 'ready', edited_from: null, question_count: 48, total_marks: 100,
      ready_at: '2026-10-20T07:12:00Z', created_at: '2026-10-20T07:12:00Z', answer_key_r2_key: 'k', ...paper,
    }],
  });

  test('the select reads the two JSONB slices, never the whole exam_json', async () => {
    const cap = {};
    mockFrom.mockImplementationOnce(() => table({ data: [], error: null, count: 0 }, cap));
    const Browse = require('../../bot/shared/services/assessment/assessment-browse.service');
    await Browse.listPapers('u1', {});
    const cols = cap.select[0][0];
    expect(cols).toContain('pattern:exam_json->_layout->>preset_id');
    expect(cols).toContain('pages:exam_json->_layout->pages');
    expect(cols).not.toMatch(/exam_json[,)]/);
  });

  test('a pattern paper says so; a plain paper says null', async () => {
    const Browse = require('../../bot/shared/services/assessment/assessment-browse.service');
    mockFrom.mockImplementationOnce(() => table({ data: [ROW({ pattern: 'fde_g5_2027', pages: { paper: 4, scheme: 5 } })], error: null, count: 1 }));
    const [fde] = (await Browse.listPapers('u1', {})).papers;
    expect(fde).toMatchObject({ pattern: 'fde_g5_2027', pages: { paper: 4, scheme: 5 } });

    mockFrom.mockImplementationOnce(() => table({ data: [ROW({ pattern: null, pages: null })], error: null, count: 1 }));
    const [plain] = (await Browse.listPapers('u1', {})).papers;
    expect(plain).toMatchObject({ pattern: null, pages: null });
  });
});
