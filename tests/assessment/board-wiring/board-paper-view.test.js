/**
 * A G9-12 board paper on the portal's paper page (bd-5jmnfj.38.25.5). A board layout has flat `slots[]` and no
 * `sections[].slots`, so it reads through board-render/view.js: one entry per slot in paper order, the section
 * heading on its first slot, the slot label with the paper's own "Attempt any N" line, a new entry where a new
 * stimulus starts, items numbered per slot as the paper prints them, the board total. Never an answer or key.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const { makeFakeDb } = require('../helpers/fake-postgrest');
let mockDb;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));
jest.mock('../../../bot/shared/storage/r2', () => ({}));

const F = require('../board-render/_fixtures');
const View = require('../../../bot/shared/services/assessment/assessment-paper-view.service');
const BoardView = require('../../../bot/shared/services/assessment/board-render/view');

const slotsOf = (exam) => exam._layout.slots.map((s) => s.slot);
const entries = (out, slot) => out.filter((e) => e.slot === slot);

function seed(exam, subject = 'physics') {
  mockDb = makeFakeDb({
    assessment_requests: [{ id: 'r1', user_id: 'u1', grade_code: 'grade_9', subject_code: subject, chapter_number: null }],
    assessment_papers: [{
      id: 'p1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: exam,
      created_at: '2026-11-05T07:00:00.000Z', question_count: 68, total_marks: 60,
    }],
    app_settings: [],
  });
}

describe('buildPaperView on an English board paper', () => {
  const exam = F.fbise50();
  const out = View.buildPaperView(exam);

  test('every slot appears, in paper order', () => {
    expect([...new Set(out.map((e) => e.slot))]).toEqual(slotsOf(exam));
  });

  test('the section heading sits on its first entry only: section, time, marks', () => {
    expect(entries(out, 'A.Q1-40')[0].heading).toBe('Section A · 80 min · 30 marks');
    expect(entries(out, 'A.Q41-60')[0].heading).toBeNull();
    expect(entries(out, 'B.Q1-6')[0].heading).toBe('Section B · 18 marks');
  });

  test('items are numbered per slot as printed, with their options and marks; answers never leave', () => {
    const a = entries(out, 'A.Q1-40')[0];
    expect(a.lead).toBe('Q1-40');
    expect(a.questions).toHaveLength(40);
    expect(a.questions[0]).toEqual({ number: 1, shape: 'options', text: 'Fictional question A.Q1-40 #1?', marks: 0.5, options: ['alpha', 'beta', 'gamma', 'delta'] });
    expect(a.questions[39].number).toBe(40);
    expect(entries(out, 'B.Q1-6')[0].questions[0]).toEqual({ number: 1, shape: 'standard', text: 'Fictional question B.Q1-6 #1?', marks: 3 });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|"key"|scheme/);
  });

  test('a new stimulus starts its own entry led by the passage; numbering runs on through the slot', () => {
    const s = entries(out, 'A.Q41-60');
    expect(s.length).toBeGreaterThan(1);
    expect(s[0].lead).toBe('Q41-60\nFictional passage 0.');
    expect(s[1].lead).toBe('Fictional passage 1.');
    expect(s[1].heading).toBeNull();
    expect(s.flatMap((e) => e.questions).map((q) => q.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test('"Attempt any N" when fewer are attempted than printed; a removed item leaves its slot', () => {
    const copy = F.fbise50();
    const slot = copy._layout.slots.find((x) => x.slot === 'B.Q1-6');
    slot.attempt = 4;
    copy.seen.all.items.find((q) => q.slot === 'B.Q1-6').removed = true;
    const b = entries(View.buildPaperView(copy), 'B.Q1-6')[0];
    expect(b.lead).toBe('Q1-6 Attempt any 4 questions.');
    expect(b.questions).toHaveLength(5);
  });

  test('a teacher-marked slot shows its instruction and no questions; an OR slot says OR in its lead', () => {
    const copy = F.fbise50();
    copy._layout.slots[3].teacher_marked = true;
    copy._layout.slots[3].project = { instruction_en: 'Do the practical.', marks: 12 };
    copy._layout.slots[2].or = { branches: [{}, {}] };
    const res = View.buildPaperView(copy);
    expect(entries(res, 'C.Q7-8')[0]).toMatchObject({ lead: 'Q7-8 Do the practical.', questions: [] });
    expect(entries(res, 'B.Q1-6')[0].lead).toBe('Q1-6 (answer one: OR)');
  });
});

describe('an Urdu-medium board paper', () => {
  test('Urdu section words, the Urdu slot label, and the "any N" line in Urdu', () => {
    const exam = F.urdu();
    exam._layout.slots[1].attempt = 6;
    const out = View.buildPaperView(exam);
    expect(out[0].heading).toBe('حصہ A · 20 منٹ · 15 نمبر');
    expect(entries(out, 'B.Q2 الف نثر')[0].lead).toBe('Q2 الف نثر کوئی سے 6 سوال حل کریں۔');
  });

  test('label_ur wins on an Urdu paper only; text is trimmed; a teacher slot falls back to the English instruction', () => {
    const ur = F.urdu();
    ur._layout.slots[0].label_ur = 'سوال 1';
    const q7 = ur._layout.slots.find((s) => s.slot === 'C.Q7');
    q7.teacher_marked = true;
    q7.project = { instruction_en: 'Read aloud.' };
    const q = ur.seen.all.items.find((x) => x.slot === 'A.Q1');
    q.question = '  padded  ';
    q.options = [' a ', null, 'b'];
    const out = View.buildPaperView(ur);
    expect(out[0].lead).toBe('سوال 1');
    expect(out[0].questions[0]).toMatchObject({ text: 'padded', options: ['a', 'b'] });
    expect(entries(out, 'C.Q7')[0].lead).toBe('سوال 7 Read aloud.');
    const en = F.fbise50();
    en._layout.slots[0].label_ur = 'سوال';
    en._layout.slots[1].label = '';
    en.seen.all.items.find((x) => x.slot === 'A.Q41-60').stimulus.text = '  Passage.  ';
    const eo = View.buildPaperView(en);
    expect(eo[0].lead).toBe('Q1-40');
    expect(entries(eo, 'A.Q41-60')[0].lead).toBe('Passage.');
  });
});

describe('view() on a board paper', () => {
  test('carries the board total (quarters kept), the page counts and no pattern-only extras', async () => {
    const exam = F.fbise50();
    exam._layout.pages = { paper: 6, scheme: 3 };
    seed(exam);
    const out = await View.view({ userId: 'u1', paperId: 'p1' });
    expect(out.paper).toMatchObject({ totalMarks: 60, marks: 60, pages: { paper: 6, scheme: 3 }, pattern: null, youAdd: null });
    expect(out.sections[0].slot).toBe('A.Q1-40');
  });

  test('no pages yet → null', async () => {
    seed(F.urdu(), 'urdu');
    const out = await View.view({ userId: 'u1', paperId: 'p1' });
    expect(out.paper).toMatchObject({ totalMarks: 75, pages: null });
  });
});

test('board-render/view refuses a non-board paper (NO_LAYOUT)', () => {
  const fde = F.fbise50();
  fde._layout.profile = 'fde';
  expect(() => BoardView.sections(fde)).toThrow(expect.objectContaining({ code: 'NO_LAYOUT' }));
  expect(() => BoardView.paperFields({})).toThrow(expect.objectContaining({ code: 'NO_LAYOUT' }));
});
