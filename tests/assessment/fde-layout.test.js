/**
 * The layout pass: a model's board-pattern output put into FDE's shape.
 *
 * The model tags each item with the slot it was written for, but it also
 * renames types, writes extra items and gets marks wrong. applyLayout decides
 * where every item sits, sets the marks from the pattern, drops extras, and
 * reports a slot that came back short instead of padding it. It never edits a
 * question's words.
 *
 * Pure, no I/O.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { collectQuestions } = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const ID = 'fde_g5_2027';
const MATHS = Patterns.get(ID).subjects.maths;
const URDU = Patterns.get(ID).subjects.urdu;
const SCIENCE = Patterns.get(ID).subjects.science;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };

function items(n, slot, base, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({ question: `${base} ${i + 1}`, answer: String(i + 1), marks: 9, slot, ...extra }));
}

// A full Maths paper as the model writes it, every item tagged.
function mathsOutput(over = {}) {
  return {
    unseen: {
      objective: { MCQs: items(20, 'maths.A.Q1a', 'mcq', { options: ['1', '2', '3', '4'] }) },
      subjective: {
        'Short Questions': items(10, 'maths.A.Q1b', 'solve'),
        'Word Problems': items(12, 'maths.B.Q2', 'problem'),
        'Graphs & Geometric Problems': [
          ...items(1, 'maths.C.Q3', 'graph', { table: { headers: ['Day', 'Books read'], rows: [['Mon', '12']] } }),
          ...items(5, 'maths.C.Q4-8', 'geometry'),
        ],
      },
    },
    ...over,
  };
}

function slotCounts(examJson) {
  const out = {};
  for (const { question } of collectQuestions(examJson)) out[question.slot] = (out[question.slot] || 0) + 1;
  return out;
}

describe('applyLayout', () => {
  it('places by slot', () => {
    const { examJson, placed, unplaced, shortfall } = applyLayout(mathsOutput(), MATHS, FDE, { now: NOW });
    expect(placed).toBe(48);
    expect(unplaced).toBe(0);
    expect(shortfall).toEqual([]);
    expect(slotCounts(examJson)).toEqual({
      'maths.A.Q1a': 20, 'maths.A.Q1b': 10, 'maths.B.Q2': 12, 'maths.C.Q3': 1, 'maths.C.Q4-8': 5,
    });
  });

  it("maps a renamed key 'MCQ' to Q1(a)", () => {
    const raw = mathsOutput();
    raw.unseen.objective = { MCQ: raw.unseen.objective.MCQs.map(({ slot, ...q }) => q) };
    const { examJson, shortfall } = applyLayout(raw, MATHS, FDE, { now: NOW });
    expect(shortfall).toEqual([]);
    expect(slotCounts(examJson)['maths.A.Q1a']).toBe(20);
  });

  it('places an untagged item by its type into the first slot with room', () => {
    const raw = mathsOutput();
    const g = raw.unseen.subjective['Graphs & Geometric Problems'];
    raw.unseen.subjective['Graphs & Geometric Problems'] = g.map(({ slot, ...q }) => q);
    const { examJson, shortfall } = applyLayout(raw, MATHS, FDE, { now: NOW });
    expect(shortfall).toEqual([]);
    const c = slotCounts(examJson);
    expect(c['maths.C.Q3']).toBe(1);
    expect(c['maths.C.Q4-8']).toBe(5);
  });

  it('accepts a slot tag written loosely (case, spaces)', () => {
    const raw = mathsOutput();
    raw.unseen.subjective['Word Problems'].forEach((q) => { q.slot = ' MATHS.B.q2 '; });
    expect(slotCounts(applyLayout(raw, MATHS, FDE, { now: NOW }).examJson)['maths.B.Q2']).toBe(12);
  });

  it('caps a slot at generate and reports unplaced', () => {
    const raw = mathsOutput();
    raw.unseen.subjective['Word Problems'].push(...items(3, 'maths.B.Q2', 'extra'));
    const { examJson, unplaced, shortfall } = applyLayout(raw, MATHS, FDE, { now: NOW });
    expect(unplaced).toBe(3);
    expect(shortfall).toEqual([]);
    expect(slotCounts(examJson)['maths.B.Q2']).toBe(12);
    expect(examJson._layout.unplaced).toBe(3);
    expect(JSON.stringify(examJson)).not.toContain('extra 1');
  });

  it("sets marks 1/2/5 per slot and ignores the model's marks", () => {
    const { examJson } = applyLayout(mathsOutput(), MATHS, FDE, { now: NOW });
    const bySlot = {};
    for (const { question } of collectQuestions(examJson)) bySlot[question.slot] = question.marks;
    expect(bySlot).toEqual({ 'maths.A.Q1a': 1, 'maths.A.Q1b': 2, 'maths.B.Q2': 5, 'maths.C.Q3': 5, 'maths.C.Q4-8': 5 });
  });

  it('total_marks is 100 when 54 items are placed', () => {
    const raw = mathsOutput();
    raw.unseen.objective.MCQs.push(...items(6, 'maths.A.Q1a', 'more', { options: ['a', 'b', 'c', 'd'] }));
    const { examJson, placed, unplaced } = applyLayout(raw, MATHS, FDE, { now: NOW });
    expect(placed + unplaced).toBe(54);
    expect(examJson._layout.total_marks).toBe(100);
  });

  it('a shortfall is reported, not padded', () => {
    const raw = mathsOutput();
    raw.unseen.subjective['Word Problems'] = raw.unseen.subjective['Word Problems'].slice(0, 9);
    const { examJson, shortfall } = applyLayout(raw, MATHS, FDE, { now: NOW });
    expect(shortfall).toEqual([{ slot: 'maths.B.Q2', missing: 3 }]);
    expect(slotCounts(examJson)['maths.B.Q2']).toBe(9);
  });

  it('rebuilds unseen in pattern order, so the old walk reads the paper in slot order', () => {
    const raw = mathsOutput();
    // The model wrote subjective first and the types out of order.
    raw.unseen = { subjective: { 'Word Problems': raw.unseen.subjective['Word Problems'], 'Short Questions': raw.unseen.subjective['Short Questions'], 'Graphs & Geometric Problems': raw.unseen.subjective['Graphs & Geometric Problems'] }, objective: raw.unseen.objective };
    const { examJson } = applyLayout(raw, MATHS, FDE, { now: NOW });
    const order = [];
    for (const { question } of collectQuestions(examJson)) if (order[order.length - 1] !== question.slot) order.push(question.slot);
    expect(order).toEqual(['maths.A.Q1a', 'maths.A.Q1b', 'maths.B.Q2', 'maths.C.Q3', 'maths.C.Q4-8']);
    expect(Object.keys(examJson.unseen.subjective)).toEqual(['Short Questions', 'Word Problems', 'Graphs & Geometric Problems', 'Graphs & Geometric Problems (2)']);
    expect(examJson.seen).toBeUndefined();
  });

  it('attaches _layout: a copy of the pattern plus scope, unplaced, time, no pages and no notes', () => {
    const { examJson } = applyLayout(mathsOutput(), MATHS, FDE, { now: NOW });
    const L = examJson._layout;
    expect(L).toEqual(expect.objectContaining({
      v: 2, preset_id: ID, subject: 'maths', medium: 'en', total_marks: 100, unplaced: 0,
      generated_at: NOW, pages: null, frame_pages: null, notes: [],
    }));
    expect(L.scope).toEqual(expect.objectContaining({ kind: 'fde', label_en: 'FDE syllabus 2026–27', covers_en: null }));
    expect(L.sections.map((s) => s.id)).toEqual(['A', 'B', 'C']);
    expect(L.sections[1].slots[0].marks_line_en).toBe('({n:8}×5={t:40})');
    expect(Object.isFrozen(L)).toBe(false);
    L.sections[0].slots[0].generate = 1;
    expect(MATHS.sections[0].slots[0].generate).toBe(20);
  });

  it('a chapter-scoped paper says what it covers', () => {
    const { examJson } = applyLayout(mathsOutput(), MATHS, { kind: 'chapters', chapters: [3, 4], pages: null }, { now: NOW });
    expect(examJson._layout.scope.covers_en).toBe('Covers Units 3–4; every section set from these units.');
    expect(examJson._layout.scope.chapters).toEqual([3, 4]);
  });

  it('never changes a question text, answer, options or table', () => {
    const raw = mathsOutput();
    const { examJson } = applyLayout(raw, MATHS, FDE, { now: NOW });
    const before = collectQuestions(raw).map(({ question: q }) => [q.question, q.answer, q.options, q.table]);
    const after = collectQuestions(examJson).map(({ question: q }) => [q.question, q.answer, q.options, q.table]);
    expect(after).toEqual(before);
  });

  it('does not mutate its input', () => {
    const raw = mathsOutput();
    const copy = JSON.parse(JSON.stringify(raw));
    applyLayout(raw, MATHS, FDE, { now: NOW });
    expect(raw).toEqual(copy);
  });

  it('keeps the slot of a set of lines Section A asks for', () => {
    const { examJson } = applyLayout(mathsOutput(), MATHS, FDE, { now: NOW });
    const q1b = collectQuestions(examJson).find(({ question }) => question.slot === 'maths.A.Q1b').question;
    expect(q1b.lines).toBe(2);
  });

  it('lists the teacher supplies for a frame slot, with the book page and the word bank', () => {
    const raw = { unseen: { objective: { MCQs: items(20, 'science.A.Q1a', 'm', { options: ['a', 'b', 'c', 'd'] }) },
      subjective: {
        'Label the Diagram': [
          { question: 'Layers of the Earth', answer: 'crust, mantle, outer core, inner core, surface', book_page: 168, slot: 'science.A.Q1b' },
        ],
        'Draw and Label': items(2, 'science.B.Q2a', 'draw'),
        'Logical Reasoning': items(3, 'science.B.Q2b', 'situation'),
        'Brief Answers': items(10, 'science.C.Q3a', 'brief'),
        'Long Question': items(5, 'science.C.Q3b', 'long'),
      } } };
    const { examJson, shortfall } = applyLayout(raw, SCIENCE, FDE, { now: NOW });
    expect(shortfall).toEqual([]);
    expect(examJson._layout.supplies).toEqual([
      expect.objectContaining({ slot: 'science.A.Q1b', kind: 'diagram', book_page: 168, line_en: 'Q1 (b): Diagram: Layers of the Earth (book p. 168)' }),
    ]);
  });

  it('urdu: the Naat alternative is a supply line with its lesson page, never a generated item', () => {
    const raw = { unseen: {
      objective: { MCQs: items(20, 'urdu.A.Q1', 'سوال', { options: ['الف', 'ب', 'ج', 'د'] }) },
      subjective: {
        'Comprehension Passage': items(1, 'urdu.B.Q2', 'پیراگراف', { passage: 'ایک دن' }),
        'Word Meanings': items(1, 'urdu.C.Q3', 'الفاظ'),
        'Poem Explanation': items(1, 'urdu.C.Q6', 'اشعار', { passage: 'سطر' }),
        'Rewrite Sentences': items(4, 'urdu.C.Q4', 'قواعد'),
        'Word Sentences': items(1, 'urdu.C.Q5', 'جملے'),
        'Picture Description': items(1, 'urdu.C.Q7', 'منظر', { words: ['باغ', 'بچے'] }),
        'Paragraph Writing': items(2, 'urdu.C.Q8', 'موضوع'),
        'Story Writing': items(2, 'urdu.C.Q9', 'کہانی'),
        'Letter Writing': items(2, 'urdu.C.Q10', 'خط'),
      } } };
    const { examJson, shortfall } = applyLayout(raw, URDU, FDE, { now: NOW });
    expect(shortfall).toEqual([]);
    const lines = examJson._layout.supplies.map((s) => s.slot);
    expect(lines).toEqual(['urdu.C.Q6', 'urdu.C.Q7']);
    const naat = examJson._layout.supplies[0];
    expect(naat).toEqual(expect.objectContaining({ kind: 'naat', book_page: 13 }));
    expect(naat.line_ur).toContain('نعت');
    expect(examJson._layout.medium).toBe('ur');
  });

  it('never throws on garbage and reports every slot short', () => {
    const { examJson, shortfall, placed } = applyLayout(null, MATHS, FDE, { now: NOW });
    expect(placed).toBe(0);
    expect(shortfall).toHaveLength(5);
    expect(examJson._layout.preset_id).toBe(ID);
    expect(() => applyLayout({ unseen: { objective: { MCQs: [null, 3, 'text'] } } }, MATHS, FDE, { now: NOW })).not.toThrow();
  });
});
