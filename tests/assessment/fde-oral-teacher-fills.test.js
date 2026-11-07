/**
 * bd-5jmnfj.39: a teacher-filled oral task (G5 Islamiat Nazra) prints with nothing generated:
 * its label, marks, instruction, a «teacher writes this» note, blank lines for the teacher to
 * write the ayat/words/hadith/dua in, and its rubric. Any other task with no content still throws.
 */
const { oralSheet } = require('../../bot/shared/services/assessment/fde-oral-sheet');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const text = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const nazra = () => Patterns.get('fde_g5_2027').subjects.islamiat.oral;

test('every Nazra task prints with no content: label, instruction, blank write-in lines, rubric', () => {
  const html = oralSheet({ ...nazra(), content: [] }, { medium: 'ur', text });
  for (const t of nazra().tasks) {
    const block = html.split(`data-task="${t.id}"`)[1].split('class="oral-task"')[0];
    expect(block).toContain(text(t.label_ur));
    expect(block).toContain(text(t.instruction_ur));
    expect(block).toContain('oral-fill');
    expect((block.match(/class="fill-line"/g) || []).length).toBe(t.lines);
    expect(block).toContain(`data-scoring="${t.scoring}"`);
  }
  expect(html).toContain(text('ناظرہ (زبانی) · استاد کی شیٹ'));
});

test('a teacher-filled task never prints generated text, even if some arrives', () => {
  const o = { ...nazra(), content: [{ id: 'ayat', script: 'GENERATED', items: [{ ask: 'GENERATED ASK' }] }] };
  expect(oralSheet(o, { medium: 'ur', text })).not.toContain('GENERATED');
});

test('an ordinary task with nothing generated still refuses to print', () => {
  const o = nazra();
  const one = { ...o, tasks: [{ ...o.tasks[1], teacher_fills: false }], content: [] };
  expect(() => oralSheet(one, { medium: 'ur', text })).toThrow(/nothing was generated/);
});
