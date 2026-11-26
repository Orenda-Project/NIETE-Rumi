'use strict';
/**
 * The 30-second revert (scripts/quiz-teacher-edit-revert.js): one save's audit rows replayed backwards through the
 * same save function as edited_by 'revert'. Only the quiz's LATEST version is reverted (a later save would be undone
 * blind otherwise); a removed row comes back whole, with its id; an edited row gets back every edited column as it was
 * before the save (the key fix's cleared explanation too), checked against the row as it is now.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
const Revert = require('../../../scripts/quiz-teacher-edit-revert');
const Edit = require('../../../shared/services/quiz/quiz-teacher-edit');

const Q1 = '00000000-0000-4000-8000-000000000301';
const Q2 = '00000000-0000-4000-8000-000000000302';
const beforeRow = { question_text: 'Q1', option_a: 'a', option_b: 'b', option_c: 'c', option_d: null, correct_option: 'A', explanation: 'A is right',
  misconception_feedback: null, distractor_misconceptions: null, option_feedback: { wrong: { 1: 'no' } }, media: {} };
const nowRow = { id: Q1, ...beforeRow, correct_option: 'B', explanation: null, option_feedback: null };
const removed = { id: Q2, quiz_id: 'qz', sort_order: 2, question_text: 'Q2', option_a: 'x', option_b: 'y', option_c: 'z', correct_option: 'C', media: {} };
const audit = [
  { quiz_id: 'qz', question_id: Q1, field: 'key', edit_v: 4, edited_by: 'teacher', before: { value: 'A', row: beforeRow }, after: { value: 'B' } },
  { quiz_id: 'qz', question_id: Q2, field: 'remove', edit_v: 4, edited_by: 'teacher', before: { value: 'Q2', row: removed }, after: null },
];

test('the latest save comes back: the edited row gets every column back, the removed row is re-inserted with its id', () => {
  const r = Revert.revertChanges({ audit, editV: 4, currentEditV: 4, rowsById: new Map([[Q1, nowRow]]) });
  expect(r.ok).toBe(true);
  const [edit, put] = r.changes;
  expect(edit).toMatchObject({ id: Q1, remove: false, before: Edit.editCols(nowRow), after: beforeRow });
  expect(edit.fields).toEqual([{ field: 'key', before: { value: 'B' }, after: { value: 'A' } }]);
  expect(put).toEqual({ id: Q2, insert: removed, fields: [{ field: 'remove', before: null, after: { value: 'restored' } }] });
});

test('only the latest version: a later save would be undone blind', () => {
  expect(Revert.revertChanges({ audit, editV: 4, currentEditV: 5, rowsById: new Map([[Q1, nowRow]]) }))
    .toEqual({ ok: false, reason: 'not_latest', currentEditV: 5 });
});

test('a version that is already a revert, or has no teacher rows, is not reverted', () => {
  expect(Revert.revertChanges({ audit: audit.map((a) => ({ ...a, edited_by: 'revert' })), editV: 4, currentEditV: 4, rowsById: new Map() }))
    .toEqual({ ok: false, reason: 'no_teacher_edit' });
});

test('args: --quiz is required, dry run unless --apply', () => {
  expect(Revert.parseArgs(['--quiz', 'e1e1e1e1-0000-4000-8000-000000000001'])).toEqual({ quiz: 'e1e1e1e1-0000-4000-8000-000000000001', editV: null, apply: false });
  expect(Revert.parseArgs(['--quiz', 'e1e1e1e1-0000-4000-8000-000000000001', '--edit-v', '3', '--apply'])).toMatchObject({ editV: 3, apply: true });
  expect(() => Revert.parseArgs([])).toThrow(/--quiz/);
});
