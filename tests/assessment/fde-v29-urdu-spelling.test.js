/** Urdu spelling map (bd-5jmnfj.4.58.4): G2 Urdu Q1 vi printed the poet «نادیہ نغمان»; the spelling is «نعمان». */
const { urduSpelling } = require('../../bot/shared/services/assessment/fde-urdu-spelling');

test('every string of an item is corrected, a picture data URI is not touched', () => {
  const q = { slot: 'urdu.A.Q1', question: 'نغمان کی نظم', options: ['الف) نادیہ نغمان'], answer: 'الف) نادیہ نغمان', scheme: { accept: ['نغمان'] }, picture: { src: 'data:x/نغمان' } };
  const { examJson, notes } = urduSpelling({ unseen: { objective: { MCQs: [q] } } });
  const out = examJson.unseen.objective.MCQs[0];
  expect(out.question).toBe('نعمان کی نظم');
  expect(out.options).toEqual(['الف) نادیہ نعمان']);
  expect(out.answer).toBe('الف) نادیہ نعمان');
  expect(out.scheme.accept).toEqual(['نعمان']);
  expect(out.picture.src).toBe('data:x/نغمان');
  expect(notes).toHaveLength(1);
});

test('a paper with no misspelling is returned as it was', () => {
  const paper = { unseen: { objective: { MCQs: [{ question: 'نعمان' }] } } };
  const r = urduSpelling(paper);
  expect(r.examJson).toEqual(paper);
  expect(r.notes).toEqual([]);
  expect(urduSpelling(null).notes).toEqual([]);
});
