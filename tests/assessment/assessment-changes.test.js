const { applyChanges } = require('../../bot/shared/services/assessment/assessment-changes');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');

const TREE = { unseen: {
  objective: {
    MCQs: [
      { question: 'Which is a verb?', options: ['A) run', 'B) cat'], answer: 'A) run', marks: 1 },
      { question: 'Which is a noun?', options: ['A) cat', 'B) run'], answer: 'A) cat', marks: 1 },
    ],
    'Match the Column': [{ question: 'Match', column_a: ['cat', 'dog'], column_b: ['meow', 'woof'], marks: 2 }],
  },
  subjective: {
    'Comprehension Passage': [{ passage: 'The crow was thirsty.', question: 'Read and answer',
      questions: [{ question: 'Who was thirsty?', answer: 'The crow', marks: 1 }] }],
    'Short Questions': [{ question: 'What is a noun?', answer: 'A naming word.', marks: 2, lines: 4 }],
  },
} };
const CTX = { subject: 'english', grade: 3 };
const ids = (t) => Selection.indexQuestions(t).map((q) => q.id);
const q = (t, id) => Selection.indexQuestions(t).find((x) => x.id === id).question;

test('edits an options question with the bot rules', () => {
  const out = applyChanges(TREE, { edits: [{ id: 'unseen.objective.MCQs.0', edit: { question: 'Pick the verb', slots: ['A) jump', 'B) cat', '', '', '', ''], correct: '0' } }] }, CTX);
  expect(out.ok).toBe(true);
  expect(q(out.tree, 'unseen.objective.MCQs.0')).toMatchObject({ question: 'Pick the verb', options: ['A) jump', 'B) cat'], answer: 'A) jump' });
});

test('edits a match-the-column pair list', () => {
  const out = applyChanges(TREE, { edits: [{ id: 'unseen.objective.Match the Column.0', edit: { pairs: [{ left: 'cow', right: 'moo' }] } }] }, CTX);
  expect(q(out.tree, 'unseen.objective.Match the Column.0')).toMatchObject({ column_a: ['cow'], column_b: ['moo'] });
});

test('edits a comprehension sub-question by subIndex', () => {
  const out = applyChanges(TREE, { edits: [{ id: 'unseen.subjective.Comprehension Passage.0', edit: { subIndex: 0, question: 'Who drank?' } }] }, CTX);
  expect(q(out.tree, 'unseen.subjective.Comprehension Passage.0').questions[0].question).toBe('Who drank?');
});

test('edit then remove: removed from the paper, edit kept in the tree', () => {
  const id = 'unseen.subjective.Short Questions.0';
  const out = applyChanges(TREE, { edits: [{ id, edit: { question: 'Define a noun.' } }], removed: [id] }, CTX);
  expect(q(out.tree, id)).toMatchObject({ question: 'Define a noun.', removed: true });
  expect(Selection.activeTree(out.tree).unseen.subjective['Short Questions']).toBeUndefined();
});

test('restores a removed question', () => {
  const removed = Selection.setRemoved(TREE, 'unseen.objective.MCQs.1', true);
  const out = applyChanges(removed, { restored: ['unseen.objective.MCQs.1'] }, CTX);
  expect(q(out.tree, 'unseen.objective.MCQs.1').removed).toBeUndefined();
});

test.each(['mcq', 'fill', 'short', 'long'])('adds a %s question at the end, existing ids unchanged', (kind) => {
  const edit = kind === 'mcq'
    ? { question: 'New MCQ?', slots: ['A) yes', 'B) no', '', '', '', ''], correct: '0' }
    : { question: `New ${kind}?`, answer: 'An answer' };
  const before = ids(TREE);
  const out = applyChanges(TREE, { added: [{ kind, edit }] }, CTX);
  expect(out.ok).toBe(true);
  const after = ids(out.tree);
  for (const id of before) expect(after).toContain(id);
  expect(after.length).toBe(before.length + 1);
  expect(Selection.indexQuestions(out.tree).find((x) => !before.includes(x.id)).question.source).toBe('teacher');
});

test('edits + removes + adds in one list all address the PARENT ids', () => {
  const out = applyChanges(TREE, {
    added: [{ kind: 'mcq', edit: { question: 'Added', slots: ['A) 1', 'B) 2', '', '', '', ''], correct: '1' } }],
    removed: ['unseen.objective.MCQs.1'],
    edits: [{ id: 'unseen.objective.MCQs.0', edit: { marks: '3' } }],
  }, CTX);
  expect(q(out.tree, 'unseen.objective.MCQs.0').marks).toBe(3);
  expect(q(out.tree, 'unseen.objective.MCQs.1').removed).toBe(true);
  expect(q(out.tree, 'unseen.objective.MCQs.2').question).toBe('Added');
});

test('every bad question comes back at once, with the bot wording', () => {
  const out = applyChanges(TREE, {
    edits: [{ id: 'unseen.objective.MCQs.0', edit: { slots: ['A) only', '', '', '', '', ''] } }],
    added: [{ kind: 'mcq', edit: { question: 'No answer', slots: ['A) 1', 'B) 2', '', '', '', ''] } }],
  }, CTX);
  expect(out.ok).toBe(false);
  expect(out.code).toBe('INVALID_CHANGES');
  expect(out.errors).toEqual([
    { id: 'unseen.objective.MCQs.0', message: 'A multiple-choice question needs at least two options.' },
    { addedIndex: 0, message: 'Mark the correct option — it goes in the answer key.' },
  ]);
});

test('an unknown id is an error, not a crash', () => {
  const out = applyChanges(TREE, { edits: [{ id: 'unseen.objective.MCQs.9', edit: { marks: '2' } }] }, CTX);
  expect(out).toMatchObject({ ok: false, code: 'INVALID_CHANGES', errors: [{ id: 'unseen.objective.MCQs.9', message: 'That question is no longer on this paper.' }] });
});

test('removing every question is EMPTY_SELECTION', () => {
  const out = applyChanges(TREE, { removed: ids(TREE) }, CTX);
  expect(out).toMatchObject({ ok: false, code: 'EMPTY_SELECTION' });
});

test('an empty changes list is NO_CHANGES', () => {
  expect(applyChanges(TREE, {}, CTX)).toMatchObject({ ok: false, code: 'NO_CHANGES' });
});

test('the input tree is never mutated', () => {
  const copy = JSON.parse(JSON.stringify(TREE));
  applyChanges(TREE, { removed: ['unseen.objective.MCQs.0'], edits: [{ id: 'unseen.objective.MCQs.1', edit: { marks: '4' } }] }, CTX);
  expect(TREE).toEqual(copy);
});

test('an Urdu edit and an Urdu added question pass through unchanged', () => {
  const out = applyChanges(TREE, {
    edits: [{ id: 'unseen.subjective.Short Questions.0', edit: { question: 'اسم کیا ہے؟', answer: 'کسی چیز کا نام۔' } }],
    added: [{ kind: 'short', edit: { question: 'فعل کیا ہے؟', answer: 'کام کو ظاہر کرنے والا لفظ۔' } }],
  }, CTX);
  expect(out.ok).toBe(true);
  expect(q(out.tree, 'unseen.subjective.Short Questions.0')).toMatchObject({ question: 'اسم کیا ہے؟', answer: 'کسی چیز کا نام۔' });
  expect(q(out.tree, 'unseen.subjective.Short Questions.1').question).toBe('فعل کیا ہے؟');
});
