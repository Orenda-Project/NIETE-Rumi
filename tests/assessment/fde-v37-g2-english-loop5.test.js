/**
 * v37 loop 5 G2 English (bd-5jmnfj.4.58.9.1 / .9.2), verified panel findings:
 *   the read-aloud rubric paid "rises at question marks" on a book passage with no question mark;
 *   Q14 said "Put a full stop" while the key paid a rewritten sentence;
 *   Q11 "Dani" gave no he/she cue; Q7 accepted "small" for "tall";
 *   listening item 5 keyed one opinion answer for an open question.
 */
const g2 = require('../../bot/shared/services/assessment/patterns/early/g2-english');

const slot = (id) => g2.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const task = (id) => g2.oral.tasks.find((t) => t.id === id);

describe('G2 English loop 5 pattern fixes', () => {
  test('the read-aloud intonation row pays question marks only when the passage has one', () => {
    const row = task('read_aloud').rubric.find((r) => /full stop/.test(r.en));
    expect(row.en).toMatch(/when the passage has one/);
    expect(row.ur).toMatch(/اگر عبارت میں ہو/);
  });

  test('Q14 tells the child to write the sentence again', () => {
    expect(slot('g2.english.C.Q14').instruction_en).toMatch(/^Write each sentence again\./);
  });

  test('Q11 names only people whose name shows he or she', () => {
    expect(slot('g2.english.C.Q11').prompt_rule).toMatch(/plainly a boy's or a girl's name/);
  });

  test('Q7 accepts only a true opposite of the given word', () => {
    expect(slot('g2.english.B.Q7').prompt_rule).toMatch(/never small for tall/);
  });

  test('Q10 never accepts near for a thing drawn under, on, in or behind', () => {
    const rule = slot('g2.english.B.Q10').prompt_rule;
    expect(rule).toMatch(/scheme\.accept never lists near/);
    expect(rule).not.toMatch(/list near in scheme\.accept when it is also true/);
  });

  test('listening question 5 credits any sensible answer from the story', () => {
    expect(task('listening').ask).toMatch(/any sensible answer that fits the story earns the mark/);
  });
});
