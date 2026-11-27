'use strict';
/**
 * quiz-teacher-edit plan(): a teacher's ops become the save's changes, both copies of the content at once (the columns
 * the PDF reads and media.web the page draws a v2 item from), and every refusal the page must explain. Pure.
 */
const Edit = require('../../../shared/services/quiz/quiz-teacher-edit');

const QA = '00000000-0000-4000-8000-0000000000a1';
const QB = '00000000-0000-4000-8000-0000000000b2';
const QC = '00000000-0000-4000-8000-0000000000c3';
const QD = '00000000-0000-4000-8000-0000000000d4';

function rows() {
  return [
    { id: QA, quiz_id: 'q', sort_order: 1, question_text: 'Which animal says moo?', option_a: 'Dog', option_b: 'Cow', option_c: 'Cat', option_d: null,
      correct_option: 'A', explanation: 'A dog says moo.', misconception_feedback: null, distractor_misconceptions: { C: 'cat' },
      option_feedback: { wrong: { 1: 'Cow is not it', 2: 'Cat says meow' } }, media: { language: 'en' } },
    { id: QB, quiz_id: 'q', sort_order: 2, question_text: 'Pick the bigger number', option_a: '3', option_b: '7', option_c: '1', option_d: null,
      correct_option: 'B', explanation: null, misconception_feedback: null, distractor_misconceptions: null, option_feedback: null,
      media: { web: { v: 2, type: 'single', stem: 'Pick the bigger number', key: 'B', why: 'Seven is more than three.',
        options: [{ slot: 'A', text: '3', fb: 'too small' }, { slot: 'B', text: '7' }, { slot: 'C', text: '1' }] } } },
    { id: QC, quiz_id: 'q', sort_order: 3, question_text: 'Which is the sun?', option_a: 'sun', option_b: 'moon', option_c: 'star', option_d: null,
      correct_option: 'A', explanation: null, misconception_feedback: null, distractor_misconceptions: null, option_feedback: null,
      media: { option_images: ['https://x/a.png', 'https://x/b.png', null] } },
    { id: QD, quiz_id: 'q', sort_order: 4, question_text: 'Put in order', option_a: 'one', option_b: 'two', option_c: 'three', option_d: null,
      correct_option: 'A', explanation: null, misconception_feedback: null, distractor_misconceptions: null, option_feedback: null,
      media: { web: { v: 2, type: 'order', stem: 'Put in order', key: 'A,B,C', options: [{ slot: 'A', text: 'one' }, { slot: 'B', text: 'two' }, { slot: 'C', text: 'three' }] } } },
  ];
}

describe('plan: what a save writes', () => {
  test('a key fix writes the column, clears the feedback that named the old key, and audits the old and new key', () => {
    const p = Edit.plan(rows(), [{ op: 'key', qid: QA, slot: 'b' }]);
    expect(p.ok).toBe(true);
    const [c] = p.changes;
    expect(c.after.correct_option).toBe('B');
    expect(c.after.explanation).toBeNull();
    expect(c.after.option_feedback).toBeNull();
    expect(c.after.distractor_misconceptions).toBeNull();
    expect(c.before.correct_option).toBe('A');
    expect(c.fields).toEqual([{ field: 'key', before: { value: 'A', row: c.before }, after: { value: 'B' } }]);
  });

  test('a v2 web item: the text, option and key edits land in media.web too, where the page reads them', () => {
    const p = Edit.plan(rows(), [
      { op: 'text', qid: QB, text: '  Which number is bigger? ' },
      { op: 'option', qid: QB, slot: 'A', text: '4' },
      { op: 'key', qid: QB, slot: 'A' },
    ]);
    const { after } = p.changes[0];
    expect(after.question_text).toBe('Which number is bigger?');
    expect(after.media.web.stem).toBe('Which number is bigger?');
    expect(after.option_a).toBe('4');
    expect(after.media.web.options[0]).toEqual({ slot: 'A', text: '4' });
    expect(after.media.web.key).toBe('A');
    expect(after.correct_option).toBe('A');
    expect(after.media.web.why).toBeUndefined();
    expect(p.changes[0].fields.map((f) => f.field)).toEqual(['text', 'option_a', 'key']);
  });

  test('an option edit drops only that option\'s stored feedback', () => {
    const p = Edit.plan(rows(), [{ op: 'option', qid: QA, slot: 'C', text: 'Hen' }]);
    expect(p.changes[0].after.option_feedback).toEqual({ wrong: { 1: 'Cow is not it' } });
    expect(p.changes[0].after.explanation).toBe('A dog says moo.');
  });

  test('a remove keeps the whole row in the audit, for the revert', () => {
    const p = Edit.plan(rows(), [{ op: 'remove', qid: QC }, { op: 'text', qid: QC, text: 'ignored' }]);
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0].remove).toBe(true);
    expect(p.changes[0].fields[0].field).toBe('remove');
    expect(p.changes[0].fields[0].before.row.id).toBe(QC);
    expect(p.changes[0].fields[0].before.row.sort_order).toBe(3);
  });

  test('before is the row as read: the save compares it with the row under its lock', () => {
    const r = rows();
    const p = Edit.plan(r, [{ op: 'text', qid: QA, text: 'Which animal says moo? (farm)' }]);
    expect(p.changes[0].before).toEqual(Edit.editCols(r[0]));
    expect(Object.keys(p.changes[0].before).sort()).toEqual([...Edit.EDIT_COLS].sort());
  });
});

describe('plan: refusals', () => {
  test.each([
    ['a picture option has no words to edit', [{ op: 'option', qid: QC, slot: 'A', text: 'x' }], 'not_text'],
    ['an ordered item keeps its key', [{ op: 'key', qid: QD, slot: 'B' }], 'not_editable'],
    ['a slot the item does not have', [{ op: 'key', qid: QA, slot: 'D' }], 'bad_slot'],
    ['two keys on a single-answer item', [{ op: 'key', qid: QA, slot: 'A,B' }], 'bad_slot'],
    ['an empty question', [{ op: 'text', qid: QA, text: '   ' }], 'empty'],
    ['a question of another quiz', [{ op: 'text', qid: '00000000-0000-4000-8000-0000000000ff', text: 'x' }], 'bad_qid'],
    ['nothing changed', [{ op: 'key', qid: QA, slot: 'A' }], 'no_change'],
    ['an unknown op', [{ op: 'swap', qid: QA }], 'bad_request'],
  ])('%s', (_name, ops, reason) => {
    expect(Edit.plan(rows(), ops)).toMatchObject({ ok: false, reason });
  });

  test('the caps count code points, as the page does (an Urdu question is not cut early by UTF-16 units)', () => {
    const ur = 'ب'.repeat(Edit.TEXT_MAX);
    expect(Edit.plan(rows(), [{ op: 'text', qid: QA, text: ur }]).ok).toBe(true);
    expect(Edit.plan(rows(), [{ op: 'text', qid: QA, text: `${ur}ب` }])).toMatchObject({ ok: false, reason: 'too_long' });
    const emoji = '🐄'.repeat(Edit.OPTION_MAX);   // 2 UTF-16 units each, 1 code point
    expect(Edit.plan(rows(), [{ op: 'option', qid: QA, slot: 'B', text: emoji }]).ok).toBe(true);
  });

  test('an evening round is never edited (its rows are the round\'s copies)', () => {
    const r = rows();
    r[0].media = { round: 'lesson', round_key: 'x' };
    expect(Edit.plan(r, [{ op: 'text', qid: QB, text: 'x' }])).toMatchObject({ ok: false, reason: 'not_editable' });
  });
});
