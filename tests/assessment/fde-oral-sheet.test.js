/**
 * The oral teacher sheet printed in a Grade 1-2 marking scheme (bd-5jmnfj.4.4):
 * per task its label, instruction, the generated script and questions with
 * answers, and its rubric read by its scoring (each / criteria / bands); then a
 * class grid with one column per task. A task with nothing generated refuses to
 * print, so the teacher never gets an empty oral sheet.
 */

const { oralSheet, ORAL_CSS } = require('../../bot/shared/services/assessment/fde-oral-sheet');

const text = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ctx = { medium: 'en', text };

const oral = () => ({
  title_en: 'Oral assessment · teacher sheet',
  title_ur: 'زبانی جائزہ',
  note_en: 'One child at a time.',
  note_ur: 'ایک ایک بچہ',
  marks: 10,
  tasks: [
    { id: 'listening', label_en: 'Listening', label_ur: 'سننا', marks: 5, instruction_en: 'Read the story twice.', instruction_ur: 'کہانی',
      scoring: 'each', rubric: [{ marks: 1, en: 'Each right answer', ur: 'ہر درست جواب' }] },
    { id: 'speaking', label_en: 'Speaking', label_ur: 'بولنا', marks: 3, instruction_en: 'Ask the prompts.', instruction_ur: 'سوال',
      scoring: 'criteria', rubric: [{ marks: 2, en: 'Confidence', ur: 'اعتماد' }, { marks: 1, en: 'Details', ur: 'تفصیل' }] },
    { id: 'quick', label_en: 'Quick maths', label_ur: 'حساب', marks: 2, instruction_en: 'Ask each.', instruction_ur: 'پوچھیں',
      scoring: 'bands', rubric: [{ marks: 2, en: 'All right', ur: 'سب' }, { marks: 0, en: 'None', ur: 'کوئی نہیں' }] },
  ],
  content: [
    { id: 'listening', script: 'Ali has a red ball.', items: [{ ask: 'What colour is the ball?', answer: 'Red' }] },
    { id: 'speaking', script: 'My family', items: [{ ask: 'Who is in your family?' }] },
    { id: 'quick', items: [{ ask: '2 + 3?', answer: '5' }] },
  ],
});

test('no oral part prints nothing', () => {
  expect(oralSheet(null, ctx)).toBe('');
});

test('prints the title, the note and every task with its marks', () => {
  const html = oralSheet(oral(), ctx);
  expect(html).toContain('Oral assessment · teacher sheet');
  expect(html).toContain('One child at a time.');
  ['Listening', 'Speaking', 'Quick maths'].forEach((l) => expect(html).toContain(l));
  expect(html).toMatch(/data-task="listening"[^]*\(5\)/);
});

test('prints the generated script, the questions and their answers', () => {
  const html = oralSheet(oral(), ctx);
  expect(html).toContain('Ali has a red ball.');
  expect(html).toContain('What colour is the ball?');
  expect(html).toContain('Red');
  expect(html).toContain('Who is in your family?');
});

test('reads each rubric by its scoring', () => {
  const html = oralSheet(oral(), ctx);
  expect(html).toMatch(/data-scoring="each"[^]*Each right answer/);
  expect(html).toMatch(/data-scoring="criteria"[^]*Confidence[^]*Details/);
  expect(html).toMatch(/data-scoring="bands"[^]*Circle one/);
});

test('the class grid has one column per task and a total out of the oral marks', () => {
  const html = oralSheet(oral(), ctx);
  const grid = html.slice(html.indexOf('class="oral-grid"'));
  expect(grid).toContain('Listening (5)');
  expect(grid).toContain('Total (10)');
  expect((grid.match(/<tr class="child">/g) || []).length).toBeGreaterThanOrEqual(10);
});

test('a task with nothing generated refuses to print', () => {
  const o = oral();
  o.content = o.content.filter((c) => c.id !== 'speaking');
  expect(() => oralSheet(o, ctx)).toThrow(/speaking/);
});

test('an Urdu sheet prints the Urdu labels', () => {
  const html = oralSheet(oral(), { medium: 'ur', text });
  expect(html).toContain('زبانی جائزہ');
  expect(html).toContain('سننا');
  expect(html).toContain('ہر درست جواب');
});

test('the css styles the sheet', () => {
  expect(ORAL_CSS).toContain('.oral');
});
