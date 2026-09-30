/**
 * Which edit screen a question gets, and what belongs on it.
 *
 * A multiple-choice question and a comprehension passage do not want the same
 * controls, so there is one screen per question SHAPE. The shape is not a new
 * classification invented here — it is the same discrimination the renderer
 * already makes, in the same precedence, because a question that PRINTS as a
 * match-the-column and EDITS as a plain short question would silently lose its
 * columns the moment she saved.
 *
 * That coupling is the whole risk in this file, so it is pinned first.
 */

const {
  shapeOf, fieldsFor, applyEdit, SHAPES, SLOT_CAP,
} = require('../../bot/shared/services/assessment/assessment-edit.js');

const MCQ = { question: 'Which is a living thing?', options: ['Rock', 'Plant'], marks: 1 };
const MATCH = {
  question: 'Match each animal to its home.',
  column_a: ['Dog', 'Bird'], column_b: ['Kennel', 'Nest'], marks: 4,
};
const WORDS = { question: 'Write the meaning of each word.', words: ['arid', 'fragile'], marks: 3 };
const COMP = {
  passage: 'Ali went to the market. He bought apples.',
  questions: [{ question: 'Who went?', marks: 2 }, { question: 'What did he buy?', marks: 3 }],
};
const PASSAGE = { section: 'Listening', passage: 'Birds fly south in winter.', marks: 2 };
const PLAIN = { question: 'Why do animals need air?', marks: 2 };

describe('shapeOf — one screen per question shape', () => {
  test('the six shapes the plan names', () => {
    expect(shapeOf(MCQ)).toBe('options');
    expect(shapeOf(MATCH)).toBe('columns');
    expect(shapeOf(WORDS)).toBe('words');
    expect(shapeOf(COMP)).toBe('comprehension');
    expect(shapeOf(PASSAGE)).toBe('passage');
    expect(shapeOf(PLAIN)).toBe('standard');
  });

  test('precedence matches the renderer, key by key', () => {
    // The renderer checks options → columns → words → passage+questions →
    // passage → default. A question carrying two of those keys must land on the
    // same branch in both files or the paper and the editor disagree.
    const both = { question: 'x', options: ['a', 'b'], words: ['w'], marks: 1 };
    expect(shapeOf(both)).toBe('options');
    const passageAndSubs = { passage: 'p', questions: [{ question: 'q' }] };
    expect(shapeOf(passageAndSubs)).toBe('comprehension');
    const passageOnly = { passage: 'p' };
    expect(shapeOf(passageOnly)).toBe('passage');
  });

  test('every shape has a screen, and every screen a shape', () => {
    const seen = [MCQ, MATCH, WORDS, COMP, PASSAGE, PLAIN].map(shapeOf);
    expect(new Set(seen).size).toBe(6);
    expect(new Set(SHAPES)).toEqual(new Set(seen));
  });

  test('an empty or unrecognisable question still gets a screen, not a crash', () => {
    expect(shapeOf({})).toBe('standard');
    expect(shapeOf(null)).toBe('standard');
  });
});

describe('fieldsFor — what the screen is pre-filled with', () => {
  test('options screen offers her options plus blanks to grow into', () => {
    const f = fieldsFor(MCQ);
    expect(f.question).toBe('Which is a living thing?');
    expect(f.slots).toEqual(['Rock', 'Plant', '', '', '', '']);
    expect(f.slots).toHaveLength(SLOT_CAP);
    expect(f.marks).toBe('1');
  });

  test('a question already at the cap is offered no blanks', () => {
    const full = { question: 'q', options: ['a', 'b', 'c', 'd', 'e', 'f'], marks: 1 };
    expect(fieldsFor(full).slots.filter((s) => s === '')).toHaveLength(0);
  });

  test('columns come back as consecutive left/right pairs, never a grid', () => {
    // Flow JSON has no row or two-column container — every published Flow in
    // this repo is SingleColumnLayout. A pair is two adjacent labelled fields.
    const f = fieldsFor(MATCH);
    expect(f.pairs.slice(0, 2)).toEqual([
      { left: 'Dog', right: 'Kennel' },
      { left: 'Bird', right: 'Nest' },
    ]);
    expect(f.pairs).toHaveLength(SLOT_CAP);
  });

  test('a ragged match — more left than right — does not lose a row', () => {
    const ragged = { question: 'm', column_a: ['a', 'b', 'c'], column_b: ['x'], marks: 3 };
    const f = fieldsFor(ragged);
    expect(f.pairs.slice(0, 3)).toEqual([
      { left: 'a', right: 'x' }, { left: 'b', right: '' }, { left: 'c', right: '' },
    ]);
  });

  test('comprehension lists its sub-questions rather than inlining them', () => {
    const f = fieldsFor(COMP);
    expect(f.passage).toContain('Ali went to the market');
    expect(f.subs).toEqual([
      { index: 0, text: 'Who went?', marks: 2 },
      { index: 1, text: 'What did he buy?', marks: 3 },
    ]);
    expect(f.slots).toBeUndefined();
  });

  test('a passage question carries its section label', () => {
    expect(fieldsFor(PASSAGE).section).toBe('Listening');
  });
});

describe('applyEdit — only what she touched, written at its own path', () => {
  test('rewriting the wording leaves everything else alone', () => {
    const out = applyEdit(MCQ, { question: 'Which of these is alive?' });
    expect(out.question).toBe('Which of these is alive?');
    expect(out.options).toEqual(['Rock', 'Plant']);
    expect(out.marks).toBe(1);
  });

  test('a filled blank becomes an option; a cleared one is removed', () => {
    const out = applyEdit(MCQ, { slots: ['Rock', '', 'Chair', '', '', ''] });
    expect(out.options).toEqual(['Rock', 'Chair']);
  });

  test('REFUSES to leave a multiple-choice question with one option', () => {
    expect(() => applyEdit(MCQ, { slots: ['Rock', '', '', '', '', ''] }))
      .toThrow(/at least two/i);
  });

  test('REFUSES an empty question — unticking is how you remove one', () => {
    expect(() => applyEdit(MCQ, { question: '   ' })).toThrow(/cannot be empty/i);
  });

  test('marks must be a positive whole number', () => {
    expect(() => applyEdit(PLAIN, { marks: '0' })).toThrow(/marks/i);
    expect(() => applyEdit(PLAIN, { marks: 'two' })).toThrow(/marks/i);
    expect(applyEdit(PLAIN, { marks: '3' }).marks).toBe(3);
  });

  test('clearing both sides of a pair removes the pair', () => {
    const out = applyEdit(MATCH, {
      pairs: [{ left: 'Dog', right: 'Kennel' }, { left: '', right: '' }],
    });
    expect(out.column_a).toEqual(['Dog']);
    expect(out.column_b).toEqual(['Kennel']);
  });

  test('a half-cleared pair is refused rather than silently mismatching the columns', () => {
    // Dropping only one side shifts every pair below it — the failure the plan
    // rejected the "two separate lists" design to avoid.
    expect(() => applyEdit(MATCH, {
      pairs: [{ left: 'Dog', right: '' }, { left: 'Bird', right: 'Nest' }],
    })).toThrow(/both sides/i);
  });

  test('words: filled slots in, cleared slots out', () => {
    const out = applyEdit(WORDS, { slots: ['arid', '', 'benevolent', '', '', ''] });
    expect(out.words).toEqual(['arid', 'benevolent']);
  });

  test('editing a sub-question touches only that sub-question', () => {
    const out = applyEdit(COMP, { subIndex: 1, question: 'What fruit?', marks: '4' });
    expect(out.questions[0]).toEqual({ question: 'Who went?', marks: 2 });
    expect(out.questions[1]).toEqual({ question: 'What fruit?', marks: 4 });
    expect(out.passage).toBe(COMP.passage);
  });

  test('never mutates the stored question', () => {
    const before = JSON.stringify(MCQ);
    applyEdit(MCQ, { question: 'changed', slots: ['a', 'b', '', '', '', ''] });
    expect(JSON.stringify(MCQ)).toBe(before);
  });

  test('an edit that changes nothing is not an error', () => {
    expect(applyEdit(PLAIN, {})).toEqual(PLAIN);
  });
});

describe('the editor and the renderer must never disagree', () => {
  // If a question prints as one thing and edits as another, saving silently
  // destroys the half the editor did not know about. Nothing else in the system
  // would notice, so it is pinned here against the renderer's real output.
  const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');

  const CASES = [
    ['options', MCQ, 'Plant'],
    ['columns', MATCH, 'Kennel'],
    ['words', WORDS, 'fragile'],
    ['comprehension', COMP, 'What did he buy'],
    ['passage', PASSAGE, 'Birds fly south'],
    ['standard', PLAIN, 'Why do animals need air'],
  ];

  test.each(CASES)('%s: what the editor preserves, the paper still prints', (shape, q, marker) => {
    expect(shapeOf(q)).toBe(shape);
    // A no-op edit must survive a round trip through the renderer intact.
    const after = applyEdit(q, {});
    const html = Renderer.renderPaper({
      examJson: { unseen: { objective: { T: [after] } } },
      grade: 4, subject: 'science', answerLines: false,
    });
    expect(html).toContain(marker);
  });

  test('an edited MCQ still prints all of its options', () => {
    const after = applyEdit(MCQ, { slots: ['Rock', 'Plant', 'Chair', '', '', ''] });
    const html = Renderer.renderPaper({
      examJson: { unseen: { objective: { MCQs: [after] } } },
      grade: 4, subject: 'science', answerLines: false,
    });
    for (const o of ['Rock', 'Plant', 'Chair']) expect(html).toContain(o);
  });

  test('an edited match still prints both columns, aligned', () => {
    const after = applyEdit(MATCH, {
      pairs: [{ left: 'Cow', right: 'Shed' }, { left: 'Bird', right: 'Nest' }],
    });
    expect(after.column_a).toEqual(['Cow', 'Bird']);
    expect(after.column_b).toEqual(['Shed', 'Nest']);
    const html = Renderer.renderPaper({
      examJson: { unseen: { objective: { Match: [after] } } },
      grade: 4, subject: 'science', answerLines: false,
    });
    for (const v of ['Cow', 'Shed', 'Bird', 'Nest']) expect(html).toContain(v);
  });
});

/*
 * Versioned editing: every edit screen also carries the question's answer-key
 * entry, a written question carries its answer lines, and an edit can take the
 * question off the paper. Nothing here writes a row — the result goes into the
 * draft held by the Flow session.
 */
describe('fieldsFor — answer, lines and the correct option', () => {
  const Edit = require('../../bot/shared/services/assessment/assessment-edit.js');

  test('a written question carries its answer and its lines, with the lines offered 0–15', () => {
    const f = Edit.fieldsFor({ question: 'Why?', answer: 'Because.', marks: 2, lines: 6 }, { type: 'Short Questions' });
    expect(f.answer).toBe('Because.');
    expect(f.lines).toBe('6');
    expect(f.show_lines).toBe(true);
    expect(f.lines_options.map((o) => o.id)).toEqual(Array.from({ length: 16 }, (_, i) => String(i)));
  });

  // The renderer (items 3+4) believes a stored `lines` only inside 0–15; a
  // stored 20 prints the type's default. The screen shows what PRINTS, so the
  // pre-fill is always one of the 0–15 options and saving it is not an edit.
  test('a stored 20 pre-fills what the paper prints (the type default), always a valid option', () => {
    const f = Edit.fieldsFor({ question: 'Essay', marks: 10, lines: 20 }, { type: 'Essay Writing' });
    expect(f.lines).toBe('10');
    expect(f.lines_default).toBe(10);
    expect(f.lines_options.map((o) => o.id)).toContain(f.lines);
    const q = { question: 'Essay', marks: 10, lines: 20 };
    expect(Edit.applyEdit(q, { lines: '10', linesDefault: 10 })).toEqual(q);
  });

  test('no stored lines pre-fills what the paper prints today, and says so', () => {
    const f = Edit.fieldsFor({ question: 'Why?', marks: 2 }, { type: 'Short Questions' });
    expect(f.lines).toBe('4');
    expect(f.lines_default).toBe(4);
  });

  test('a no-lines type does not show the lines control', () => {
    expect(Edit.fieldsFor({ question: 'A __ B', marks: 1 }, { type: 'Fill in the Blanks' }).show_lines).toBe(false);
    expect(Edit.fieldsFor(MCQ, { type: 'MCQs' }).show_lines).toBe(false);
  });

  test('an MCQ pre-selects the correct option: exact text, then leading letter, else none', () => {
    const exact = { question: 'q', options: ['A) 5', 'B) 6'], answer: 'B) 6', marks: 1 };
    const letter = { question: 'q', options: ['A) 5', 'B) 6'], answer: 'b', marks: 1 };
    const none = { question: 'q', options: ['A) 5', 'B) 6'], answer: 'seven', marks: 1 };
    expect(Edit.correctIndexOf(exact)).toBe('1');
    expect(Edit.correctIndexOf(letter)).toBe('1');
    expect(Edit.correctIndexOf(none)).toBe('none');
    const f = Edit.fieldsFor(exact, { type: 'MCQs' });
    expect(f.correct).toBe('1');
    expect(f.show_correct).toBe(true);
    expect(f.show_answer_text).toBe(false);
  });

  test('correct_options: the filled options, the first blank, and "not set" — titles within 30', () => {
    const long = { question: 'q', options: ['A) ' + 'x'.repeat(70), 'B) y'], answer: 'B) y', marks: 1 };
    const f = Edit.fieldsFor(long, { type: 'MCQs' });
    expect(f.correct_options.map((o) => o.id)).toEqual(['0', '1', '2', 'none']);
    for (const o of f.correct_options) expect([...o.title].length).toBeLessThanOrEqual(30);
  });

  test('an MSQ gets a text answer instead of the single-choice radio', () => {
    const f = Edit.fieldsFor({ question: 'q', options: ['a', 'b', 'c'], answer: 'a, c', marks: 2 }, { type: 'MSQs' });
    expect(f.show_correct).toBe(false);
    expect(f.show_answer_text).toBe(true);
    expect(f.answer).toBe('a, c');
  });
});

describe('applyEdit — answer, correct option, lines and remove', () => {
  const Edit = require('../../bot/shared/services/assessment/assessment-edit.js');
  const MC = () => ({ question: 'q', options: ['A) 5', 'B) 6'], answer: 'A) 5', marks: 1 });

  test('answer is trimmed; cleared deletes it; over 600 code points is refused', () => {
    expect(Edit.applyEdit(PLAIN, { answer: '  Air.  ' }).answer).toBe('Air.');
    expect('answer' in Edit.applyEdit({ ...PLAIN, answer: 'x' }, { answer: '' })).toBe(false);
    expect(() => Edit.applyEdit(PLAIN, { answer: 'ب'.repeat(601) })).toThrow(/600/);
  });

  test('marking another option correct stores that option\'s text; "none" leaves the answer', () => {
    expect(Edit.applyEdit(MC(), { correct: '1', slots: ['A) 5', 'B) 6', '', '', '', ''] }).answer).toBe('B) 6');
    expect(Edit.applyEdit(MC(), { correct: 'none' }).answer).toBe('A) 5');
  });

  test('the correct option follows its edited text, and a new option in the first blank can be correct', () => {
    const a = Edit.applyEdit(MC(), { correct: '0', slots: ['A) 50', 'B) 6', '', '', '', ''] });
    expect(a.answer).toBe('A) 50');
    const b = Edit.applyEdit(MC(), { correct: '2', slots: ['A) 5', 'B) 6', 'C) 7', '', '', ''] });
    expect(b.options).toEqual(['A) 5', 'B) 6', 'C) 7']);
    expect(b.answer).toBe('C) 7');
  });

  test('an unchanged correct option leaves a letter-only answer alone (no phantom edit)', () => {
    const q = { question: 'q', options: ['A) 5', 'B) 6'], answer: 'B', marks: 1 };
    expect(Edit.applyEdit(q, { correct: '1', slots: ['A) 5', 'B) 6', '', '', '', ''] }).answer).toBe('B');
  });

  test('marking an EMPTY option correct is refused', () => {
    expect(() => Edit.applyEdit(MC(), { correct: '3', slots: ['A) 5', 'B) 6', '', '', '', ''] }))
      .toThrow('The option you marked correct is empty.');
  });

  test('lines: blank leaves them; 0–15 sets them; out of range is refused; the default is not an edit', () => {
    expect(Edit.applyEdit({ ...PLAIN, lines: 4 }, { lines: '' }).lines).toBe(4);
    expect(Edit.applyEdit({ ...PLAIN, lines: 4 }, { lines: '0' }).lines).toBe(0);
    expect(Edit.applyEdit({ ...PLAIN, lines: 4 }, { lines: '7' }).lines).toBe(7);
    expect(() => Edit.applyEdit(PLAIN, { lines: '16' })).toThrow();
    expect('lines' in Edit.applyEdit(PLAIN, { lines: '4', linesDefault: 4 })).toBe(false);
  });

  test('remove flags the question AFTER applying her other edits, so they survive an add-back', () => {
    const out = Edit.applyEdit(PLAIN, { question: 'Why do plants need air?', remove: true });
    expect(out.removed).toBe(true);
    expect(out.question).toBe('Why do plants need air?');
    expect('removed' in Edit.applyEdit(PLAIN, { remove: false })).toBe(false);
  });

  test('saving without touching anything changes nothing', () => {
    const q = { question: 'Why?  ', answer: 'Air', marks: 2 };
    expect(Edit.applyEdit(q, { question: 'Why?', answer: 'Air', marks: '2', lines: '4', linesDefault: 4 }))
      .toEqual(q);
  });

  test('a sub-question carries its own answer', () => {
    const out = Edit.applyEdit(COMP, { subIndex: 1, answer: 'Apples' });
    expect(out.questions[1].answer).toBe('Apples');
    expect(out.questions[0].answer).toBeUndefined();
  });
});

describe('newQuestion — a question she adds must come with its answer', () => {
  const Edit = require('../../bot/shared/services/assessment/assessment-edit.js');

  test('a short question: text and answer required; marks and lines default', () => {
    const q = Edit.newQuestion('short', { question: 'Name a planet.', answer: 'Mars' });
    expect(q).toMatchObject({ question: 'Name a planet.', answer: 'Mars', marks: 2, lines: 4, source: 'teacher' });
    expect(Edit.newQuestion('long', { question: 'Describe.', answer: 'x' })).toMatchObject({ marks: 5, lines: 8 });
    expect(Edit.newQuestion('fill', { question: 'A __', answer: 'b' })).toMatchObject({ marks: 1, lines: 0 });
    expect(() => Edit.newQuestion('short', { question: 'Name a planet.', answer: '' })).toThrow(/answer/i);
    expect(() => Edit.newQuestion('short', { question: ' ', answer: 'x' })).toThrow();
  });

  test('marks and lines she typed win over the defaults', () => {
    expect(Edit.newQuestion('short', { question: 'q', answer: 'a', marks: '3', lines: '6' }))
      .toMatchObject({ marks: 3, lines: 6 });
  });

  test('an MCQ needs two options and a correct one; the answer is that option\'s text', () => {
    const q = Edit.newQuestion('mcq', { question: 'q', slots: ['A) 1', 'B) 2', '', '', '', ''], correct: '1' });
    expect(q).toMatchObject({ options: ['A) 1', 'B) 2'], answer: 'B) 2', marks: 1, lines: 0 });
    expect(() => Edit.newQuestion('mcq', { question: 'q', slots: ['A) 1', 'B) 2'], correct: 'none' })).toThrow();
    expect(() => Edit.newQuestion('mcq', { question: 'q', slots: ['A) 1'], correct: '0' })).toThrow();
  });
});
