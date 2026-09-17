/**
 * bd-60116 — the I-SAPS answer keys were stored as LETTERS, not indices.
 *
 * `training_questions.correct_option` is the question's canonical 1-BASED
 * OPTION INDEX. quiz-delivery.service says so at the top of the file: the
 * button id is `training_quiz_<attempt>_<optionIndex1based>` and that index is
 * "the one `correct_option` is written in and the one 400k+ historical answer
 * rows hold". Sampling the live table agrees — '1'..'4' dominate, with a
 * comma-joined set ('1,3,4') for multi-select.
 *
 * The I-SAPS import wrote the source workbooks' Key column through unchanged,
 * so every row landed as 'A'..'D'. A letter never equals an index, so EVERY
 * answer graded wrong — all four options rejected on Unit 101, reported from
 * sandbox. This is the conversion that was missing, pinned so it cannot
 * regress.
 */

const { answerKeyToIndex } = require('../../bot/shared/services/training/isaps-import.rules');

describe('bd-60116 — answerKeyToIndex', () => {
  test('letters map to 1-based indices', () => {
    expect(answerKeyToIndex('A')).toBe('1');
    expect(answerKeyToIndex('B')).toBe('2');
    expect(answerKeyToIndex('C')).toBe('3');
    expect(answerKeyToIndex('D')).toBe('4');
  });

  test('is case insensitive and tolerates punctuation from the sheet', () => {
    expect(answerKeyToIndex('c')).toBe('3');
    expect(answerKeyToIndex(' C. ')).toBe('3');
    expect(answerKeyToIndex('Option C')).toBe('3');
  });

  test('an already-numeric key is passed through, not double-converted', () => {
    // Re-running the importer must be idempotent: a row already fixed to '3'
    // must not become 'C' -> '3' -> something else.
    expect(answerKeyToIndex('3')).toBe('3');
    expect(answerKeyToIndex(3)).toBe('3');
    expect(answerKeyToIndex('1')).toBe('1');
  });

  test('a multi-select set converts every member and keeps the order', () => {
    expect(answerKeyToIndex('A,C')).toBe('1,3');
    expect(answerKeyToIndex('B, D')).toBe('2,4');
    expect(answerKeyToIndex('1,3,4')).toBe('1,3,4');
  });

  test('E and beyond work, for a sheet with more than four options', () => {
    expect(answerKeyToIndex('E')).toBe('5');
    expect(answerKeyToIndex('F')).toBe('6');
  });

  test('an unusable key returns null rather than guessing', () => {
    // Guessing here marks a real teacher wrong on a real item.
    expect(answerKeyToIndex('')).toBeNull();
    expect(answerKeyToIndex(null)).toBeNull();
    expect(answerKeyToIndex('none')).toBeNull();
    expect(answerKeyToIndex('0')).toBeNull();
  });
});
