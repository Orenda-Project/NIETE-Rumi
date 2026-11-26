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
  expect(Revert.parseArgs(['--quiz', 'e1e1e1e1-0000-4000-8000-000000000001'])).toEqual({ quiz: 'e1e1e1e1-0000-4000-8000-000000000001', editV: null, toV: null, apply: false });
  expect(Revert.parseArgs(['--quiz', 'e1e1e1e1-0000-4000-8000-000000000001', '--edit-v', '3', '--apply'])).toMatchObject({ editV: 3, apply: true });
  expect(() => Revert.parseArgs([])).toThrow(/--quiz/);
});

describe('--to <v>: several teacher saves undone in one go (a revert after a revert is refused, so one by one cannot)', () => {
  const Q3 = '00000000-0000-4000-8000-000000000303';
  const orig1 = { ...beforeRow, question_text: 'Q1 original' };
  const first1 = { ...orig1, question_text: 'Q1 first edit' };
  const now1 = { id: Q1, ...orig1, question_text: 'Q1 second edit' };
  const gone3 = { id: Q3, quiz_id: 'qz', sort_order: 3, question_text: 'Q3', option_a: 'x', option_b: 'y', option_c: 'z', correct_option: 'A', media: {} };
  const chain = [
    { quiz_id: 'qz', question_id: Q1, field: 'text', edit_v: 1, edited_by: 'teacher', before: { value: 'Q1 original', row: orig1 }, after: { value: 'Q1 first edit' } },
    { quiz_id: 'qz', question_id: Q3, field: 'remove', edit_v: 2, edited_by: 'teacher', before: { value: 'Q3', row: gone3 }, after: null },
    { quiz_id: 'qz', question_id: Q1, field: 'text', edit_v: 3, edited_by: 'teacher', before: { value: 'Q1 first edit', row: first1 }, after: { value: 'Q1 second edit' } },
  ];

  test('back to version 0: each row as it was before its FIRST save in the range, the removed row re-inserted', () => {
    const r = Revert.revertChanges({ audit: chain, editV: 3, toV: 0, currentEditV: 3, rowsById: new Map([[Q1, now1]]) });
    expect(r.ok).toBe(true);
    const byId = new Map(r.changes.map((c) => [c.id, c]));
    expect(byId.get(Q1)).toMatchObject({ remove: false, before: Edit.editCols(now1), after: orig1 });
    expect(byId.get(Q1).fields).toEqual([{ field: 'text', before: { value: 'Q1 second edit' }, after: { value: 'Q1 original' } }]);
    expect(byId.get(Q3)).toEqual({ id: Q3, insert: gone3, fields: [{ field: 'remove', before: null, after: { value: 'restored' } }] });
  });

  test('a row edited and then removed in the range comes back whole, with its pre-range text', () => {
    const edited3 = { ...Edit.editCols(gone3), question_text: 'Q3 original' };
    const audit3 = [
      { quiz_id: 'qz', question_id: Q3, field: 'text', edit_v: 1, edited_by: 'teacher', before: { value: 'Q3 original', row: edited3 }, after: { value: 'Q3' } },
      { quiz_id: 'qz', question_id: Q3, field: 'remove', edit_v: 2, edited_by: 'teacher', before: { value: 'Q3', row: gone3 }, after: null },
    ];
    const r = Revert.revertChanges({ audit: audit3, editV: 2, toV: 0, currentEditV: 2, rowsById: new Map() });
    expect(r.changes).toEqual([{ id: Q3, insert: { ...gone3, ...edited3 }, fields: [{ field: 'remove', before: null, after: { value: 'restored' } }] }]);
    expect(r.changes[0].insert).toMatchObject({ id: Q3, quiz_id: 'qz', sort_order: 3, question_text: 'Q3 original' });
  });

  test('a revert inside the range is refused (it would be undone blind)', () => {
    const mixed = chain.map((a) => (a.edit_v === 2 ? { ...a, edited_by: 'revert' } : a));
    expect(Revert.revertChanges({ audit: mixed, editV: 3, toV: 0, currentEditV: 3, rowsById: new Map([[Q1, now1]]) }))
      .toEqual({ ok: false, reason: 'revert_in_range', editV: 2 });
  });

  test('args: --to takes a version below the current one', () => {
    expect(Revert.parseArgs(['--quiz', 'e1e1e1e1-0000-4000-8000-000000000001', '--to', '0'])).toMatchObject({ toV: 0, apply: false });
    expect(() => Revert.parseArgs(['--quiz', 'e1e1e1e1-0000-4000-8000-000000000001', '--to', '-1'])).toThrow(/--to/);
    expect(() => Revert.parseArgs(['--quiz', 'e1e1e1e1-0000-4000-8000-000000000001', '--to', '0', '--edit-v', '2'])).toThrow(/--to/);
  });
});
