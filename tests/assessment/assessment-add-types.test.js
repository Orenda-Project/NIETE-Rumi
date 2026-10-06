/**
 * Every text-only question type can be added from the portal (bd-0eupi).
 * Legacy kinds (mcq/fill/short/long) keep their path; any other kind is a
 * catalogue type id built by layout and placed under its own heading.
 */
const Changes = require('../../bot/shared/services/assessment/assessment-changes');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const { applyChanges, buildAdded, placeTyped, layoutOf, PICTURE_TYPES } = Changes;
const EN3 = { subject: 'english', grade: 3 };
const REFUSED = "That kind of question can't be added to this paper.";

const TREE = () => ({ unseen: {
  objective: {
    MCQs: [{ question: 'Which is a verb?', options: ['A) run', 'B) cat'], answer: 'A) run', marks: 1, main_question: 'Choose.' }],
    'Match the Column': [{ question: 'Match', column_a: ['cat', 'dog'], column_b: ['meow', 'woof'], marks: 2, main_question: 'Match them.' }],
  },
  subjective: { 'Short Questions': [{ question: 'What is a noun?', answer: 'A naming word.', marks: 2, lines: 4 }] },
} });
const ids = (t) => Selection.indexQuestions(t).map((x) => x.id);
const rejects = (fn) => { try { fn(); } catch (e) { expect(e.code).toBe('EDIT_REJECTED'); return e.message; } throw new Error('did not throw'); };

describe('layoutOf', () => {
  test.each([
    ['MCQs', 'options'], ['MSQs', 'options'], ['True/False', 'options'], ['Circle the Correct Answer', 'options'],
    ['Match the Column', 'columns'], ['Word Meanings', 'words'], ['Word Sentences', 'words'],
    ['Comprehension Passage', 'comprehension'], ['Reading', 'comprehension'],
    ['Essay Writing', 'standard'], ['Fill in the Blanks', 'standard'],
  ])('%s -> %s', (t, l) => expect(layoutOf(t)).toBe(l));
  test('picture types are the five', () => {
    expect([...PICTURE_TYPES].sort()).toEqual(['Flow Chart', 'Graphs & Geometric Problems', 'Label the Diagram', 'Mind Map', 'Picture Description']);
  });
});

describe('buildAdded per layout', () => {
  test('standard', () => {
    expect(buildAdded('Essay Writing', { question: 'Write about your school.', answer: 'Any essay.', marks: '', lines: '' }, EN3))
      .toEqual({ question: 'Write about your school.', answer: 'Any essay.', marks: 5, lines: 10, source: 'teacher' });
    expect(buildAdded('Fill in the Blanks', { question: 'The sky is __', answer: 'blue' }, EN3))
      .toMatchObject({ marks: 1, lines: 0, source: 'teacher' });
    expect(buildAdded('Brief Answers', { question: 'q', answer: 'a', marks: '3', lines: '5' }, EN3))
      .toMatchObject({ marks: 3, lines: 5 });
  });

  test('options single-choice', () => {
    const out = buildAdded('MCQs', { question: 'Pick', slots: ['a', 'b', '', 'd', '', ''], correct: '3' }, EN3);
    expect(out).toMatchObject({ question: 'Pick', options: ['a', 'b', 'd'], answer: 'd', marks: 1, source: 'teacher' });
  });

  test('MSQ via correctMany', () => {
    const out = buildAdded('MSQs', { question: 'Pick all', slots: ['a', 'b', 'c', '', '', ''], correctMany: ['0', '2'] }, EN3);
    expect(out).toMatchObject({ options: ['a', 'b', 'c'], answer: 'a, c' });
  });

  test('True/False uses the preset when no slots are sent', () => {
    const out = buildAdded('True/False', { question: 'The sun is hot.', correct: '0' }, EN3);
    expect(out).toMatchObject({ options: ['True', 'False'], answer: 'True', marks: 1 });
  });

  test('columns: b rotated so no right stays beside its left; answer string', () => {
    const out = buildAdded('Match the Column', { pairs: [{ left: 'cat', right: 'meow' }, { left: 'dog', right: 'woof' }, { left: '', right: '' }, { left: 'cow', right: 'moo' }] }, EN3);
    expect(out.column_a).toEqual(['cat', 'dog', 'cow']);
    expect(out.column_b).toEqual(['woof', 'moo', 'meow']);
    expect(out.answer).toBe('cat → meow; dog → woof; cow → moo');
    expect(out).toMatchObject({ question: 'Match column A with column B.', marks: 2, source: 'teacher' });
  });

  test('columns with a single pair is not rotated', () => {
    const out = buildAdded('Match the Column', { question: 'Join', pairs: [{ left: 'a', right: 'b' }] }, EN3);
    expect(out).toMatchObject({ column_a: ['a'], column_b: ['b'], question: 'Join' });
  });

  test('words', () => {
    expect(buildAdded('Word Meanings', { slots: ['big', '', 'small'] }, EN3))
      .toMatchObject({ question: 'Write the meaning of each word.', words: ['big', 'small'], marks: 2 });
    expect(buildAdded('Word Sentences', { slots: ['run'], answer: 'I run.' }, EN3))
      .toMatchObject({ question: 'Use each word in a sentence.', words: ['run'], answer: 'I run.' });
  });

  test('comprehension: subs carry marks, parent has none, marksOf sums', () => {
    const out = buildAdded('Comprehension Passage', { passage: 'The crow was thirsty.', subs: [
      { question: 'Who was thirsty?', answer: 'The crow', marks: '2' }, { question: 'Why?', answer: 'No water', marks: '' }] }, EN3);
    expect(out.question).toBe('Read the passage and answer the questions.');
    expect(out.marks).toBeUndefined();
    expect(out.questions.map((s) => s.marks)).toEqual([2, 1]);
    expect(Selection.marksOf(out)).toBe(3);
  });

  test('Urdu text survives every layout', () => {
    const a = buildAdded('Match the Column', { pairs: [{ left: 'بلی', right: 'میاؤں' }, { left: 'کتا', right: 'بھونکنا' }] }, { subject: 'urdu', grade: 3 });
    expect(a.answer).toBe('بلی → میاؤں; کتا → بھونکنا');
    const b = buildAdded('Word Meanings', { slots: ['کتاب', 'قلم'] }, { subject: 'urdu', grade: 3 });
    expect(b.words).toEqual(['کتاب', 'قلم']);
    const c = buildAdded('Comprehension Passage', { passage: 'ایک کوّا تھا۔', subs: [{ question: 'کون تھا؟', answer: 'کوّا' }] }, { subject: 'urdu', grade: 3 });
    expect(c.passage).toBe('ایک کوّا تھا۔');
  });
});

describe('refusals', () => {
  test.each([
    ['Essay Writing', { question: '', answer: 'a' }, 'The question cannot be empty.'],
    ['Essay Writing', { question: 'q', answer: ' ' }, 'Write the answer too — it goes in the answer key.'],
    ['Essay Writing', { question: 'q', answer: 'a', lines: '99' }, 'Answer lines must be a whole number from 0 to 15.'],
    ['Essay Writing', { question: 'q', answer: 'a', marks: '0' }, 'Marks must be a whole number, 1 or more.'],
    ['MCQs', { question: 'q', slots: ['a', '', '', '', '', ''], correct: '0' }, 'A multiple-choice question needs at least two options.'],
    ['MCQs', { question: 'q', slots: ['a', 'b', '', '', '', ''] }, 'Mark the correct option — it goes in the answer key.'],
    ['MCQs', { question: 'q', slots: ['a', 'b', '', '', '', ''], correct: '3' }, 'The option you marked correct is empty.'],
    ['Match the Column', { pairs: [{ left: 'a', right: '' }] }, 'A pair needs both sides. Clear both to remove it.'],
    ['Match the Column', { pairs: [{ left: '', right: '' }] }, 'Add at least one pair.'],
    ['Word Meanings', { slots: ['', ''] }, 'Add at least one word.'],
    ['Comprehension Passage', { passage: ' ', subs: [{ question: 'q', answer: 'a' }] }, 'The passage cannot be empty.'],
    ['Comprehension Passage', { passage: 'p', subs: [] }, 'Add at least one question about the passage.'],
    ['Comprehension Passage', { passage: 'p', subs: [{ question: 'q', answer: 'a' }, { question: 'q', answer: '' }] }, 'Question 2 needs its question and its answer.'],
  ])('%s %j -> %s', (kind, edit, message) => {
    expect(rejects(() => buildAdded(kind, edit, EN3))).toBe(message);
  });

  test('picture types and types outside the catalogue are refused', () => {
    for (const kind of ['Label the Diagram', 'Mind Map', 'Flow Chart', 'Picture Description', 'Graphs & Geometric Problems', 'Sequences', 'Nonsense']) {
      expect(rejects(() => buildAdded(kind, { question: 'q', answer: 'a' }, EN3))).toBe(REFUSED);
    }
    // Sequences is a Maths type: fine there, refused for English.
    expect(buildAdded('Sequences', { question: '2, 4, _', answer: '6' }, { subject: 'maths', grade: 3 })).toMatchObject({ answer: '6' });
  });
});

describe('placeTyped', () => {
  test('joins an existing Match the Column list and copies main_question', () => {
    const q = buildAdded('Match the Column', { pairs: [{ left: 'a', right: 'b' }] }, EN3);
    const out = placeTyped(TREE(), { type: 'Match the Column', ...EN3 }, q);
    expect(out.id).toBe('unseen.objective.Match the Column.1');
    expect(out.tree.unseen.objective['Match the Column']).toHaveLength(2);
    expect(out.tree.unseen.objective['Match the Column'][1].main_question).toBe('Match them.');
  });

  test('appends to the last sub-type array when the entry is an object of arrays', () => {
    const tree = TREE();
    tree.unseen.objective['Match the Column'] = { A: [{ question: 'x', column_a: ['1'], column_b: ['2'] }], B: [{ question: 'y', column_a: ['1'], column_b: ['2'] }] };
    const out = placeTyped(tree, { type: 'Match the Column', ...EN3 }, { question: 'z', column_a: ['1'], column_b: ['2'] });
    expect(out.id).toBe('unseen.objective.Match the Column.B.1');
  });

  test('creates a new heading under the right section and category when absent', () => {
    const out = placeTyped(TREE(), { type: 'Word Meanings', ...EN3 }, { question: 'q', words: ['a'] });
    expect(out.id).toBe('unseen.subjective.Word Meanings.0');
    const seenOnly = { seen: { objective: { MCQs: [{ question: 'q', options: ['a', 'b'], answer: 'a' }] } } };
    const o2 = placeTyped(seenOnly, { type: 'Essay Writing', ...EN3 }, { question: 'q', answer: 'a' });
    expect(o2.id).toBe('seen.subjective.Essay Writing.0');
  });

  test('existing ids never move', () => {
    const before = ids(TREE());
    const out = placeTyped(TREE(), { type: 'Word Meanings', ...EN3 }, { question: 'q', words: ['a'] });
    for (const id of before) expect(ids(out.tree)).toContain(id);
  });
});

describe('applyChanges with catalogue kinds', () => {
  test('mixed legacy and catalogue additions are both placed and print', () => {
    const out = applyChanges(TREE(), { added: [
      { kind: 'short', edit: { question: 'Define verb.', answer: 'A doing word.' } },
      { kind: 'Match the Column', edit: { pairs: [{ left: 'cat', right: 'meow' }, { left: 'dog', right: 'woof' }] } },
    ] }, EN3);
    expect(out.ok).toBe(true);
    const items = Selection.indexQuestions(out.tree);
    expect(items.filter((x) => x.type === 'Short Questions')).toHaveLength(2);
    expect(items.filter((x) => x.type === 'Match the Column')).toHaveLength(2);
    const html = Renderer.renderPaper({ examJson: out.tree, grade: 3, subject: 'english', schoolName: 'S' });
    expect(html).toContain('<td>dog</td><td>meow</td>');
    expect(Renderer.renderAnswerKey({ examJson: out.tree, grade: 3, subject: 'english', schoolName: 'S' })).toContain('cat → meow');
  });

  test('a refused catalogue kind is collected with its addedIndex', () => {
    const out = applyChanges(TREE(), { added: [{ kind: 'Mind Map', edit: { question: 'q', answer: 'a' } }] }, EN3);
    expect(out).toEqual({ ok: false, code: 'INVALID_CHANGES', errors: [{ addedIndex: 0, message: REFUSED }] });
  });
});
