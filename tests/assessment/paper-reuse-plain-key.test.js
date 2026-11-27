/**
 * The reuse key of a plain (non-board) paper (bd-h8zy3q). Two requests that differ in ANY input
 * that changes the paper must never share one; inputs that only change how it is printed must.
 */
const Reuse = require('../../bot/shared/services/assessment/paper-reuse');

const BASE = {
  grade: 5, subject: 'science', chapterNumber: null, pageRanges: '10-20', questionTypes: ['mcq', 'short'],
  contentSource: 'unseen', questionCount: 10, totalMarks: 20, seenCount: null, seenTypes: null,
  scope: null, compact: false, curriculum: undefined,
};
const key = (c = {}) => Reuse.plainReuseKey({ ...BASE, ...c });

describe('plainReuseKey', () => {
  test('a stable hex digest, independent of object key order', () => {
    expect(key()).toMatch(/^[0-9a-f]{64}$/);
    expect(key({ seenTypes: { b: 1, a: 2 } })).toBe(key({ seenTypes: { a: 2, b: 1 } }));
  });

  test.each([
    ['grade', { grade: 4 }],
    ['subject', { subject: 'maths' }],
    ['chapter', { pageRanges: null, chapterNumber: 3 }],
    ['page range', { pageRanges: '10-21' }],
    ['question types', { questionTypes: ['mcq'] }],
    ['question type order', { questionTypes: ['short', 'mcq'] }],
    ['content source', { contentSource: 'seen' }],
    ['question count', { questionCount: 11 }],
    ['total marks', { totalMarks: 25 }],
    ['seen count', { seenCount: 3 }],
    ['seen types', { seenTypes: { mcq: 2 } }],
    ['topic scope', { scope: { kind: 'topics', slos: ['a'] } }],
    ['topic scope slos', { scope: { kind: 'topics', slos: ['b'] } }],
    ['compact print', { compact: true }],
    ['curriculum', { curriculum: 'sindh' }],
  ])('changes with the %s', (_n, change) => {
    expect(key(change)).not.toBe(key());
  });

  test('bd-nr8mrm.3: a page target changes the key; no target leaves every old key as it was', () => {
    expect(key({ pages: undefined })).toBe(key());
    expect(key({ pages: null })).toBe(key());
    expect(key({ pages: 1 })).not.toBe(key());
    expect(key({ pages: 1 })).not.toBe(key({ pages: 2 }));
  });

  test('a missing question type list is the same as an empty one', () => {
    expect(key({ questionTypes: undefined })).toBe(key({ questionTypes: [] }));
  });

  test('never equals a board key, whatever the shared inputs', () => {
    const board = Reuse.reuseKey({ grade: 5, subject: 'science', pageRanges: '10-20' });
    expect(key()).not.toBe(board);
  });
});
