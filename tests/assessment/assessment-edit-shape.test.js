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
