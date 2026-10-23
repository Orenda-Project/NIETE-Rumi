'use strict';
/** Task 4 — pure diff between stored topics and a fresh grouping of the matrix. */
const { reconcile, toRow, fromRow, sameContent } = require('../../../bot/shared/services/assessment/topics/reconcile');

const topic = (id, extra = {}) => ({
  topicId: id, grade: 2, subject: 'english', chapterNumber: 1, chapterTitle: 'A', name: `Name ${id}`,
  heading: 'Reading', headingOrder: 2, sortOrder: 1, pages: [3, 4], sloCodes: ['E-1'], sloDescriptions: ['d1'], days: [1, 2],
  ...extra,
});
const stored = (id, extra = {}) => ({ ...topic(id), isCurrent: true, ...extra });
const ids = (list) => list.map((t) => t.topicId);

describe('reconcile', () => {
  test('unchanged input gives an empty diff', () => {
    const existing = [stored('a'), stored('b')];
    expect(reconcile(existing, [topic('a'), topic('b')])).toEqual({ upsert: [], retire: [] });
  });

  test('a new topic is upserted, an existing one is not', () => {
    const { upsert, retire } = reconcile([stored('a')], [topic('a'), topic('b')]);
    expect(ids(upsert)).toEqual(['b']);
    expect(retire).toEqual([]);
  });

  test('everything is upserted when nothing is stored', () => {
    expect(ids(reconcile([], [topic('a'), topic('b')]).upsert)).toEqual(['a', 'b']);
  });

  test('a topic id that disappears is retired, not deleted', () => {
    const { upsert, retire } = reconcile([stored('a'), stored('gone')], [topic('a')]);
    expect(retire).toEqual(['gone']);
    expect(upsert).toEqual([]);
  });

  test('an already-retired row that stays missing is not retired again', () => {
    expect(reconcile([stored('old', { isCurrent: false }), stored('a')], [topic('a')]).retire).toEqual([]);
  });

  test('a retired row whose id comes back is upserted (made current again)', () => {
    const { upsert } = reconcile([stored('a', { isCurrent: false })], [topic('a')]);
    expect(ids(upsert)).toEqual(['a']);
  });

  test('importing English only never retires a Maths row', () => {
    const maths = stored('m', { subject: 'maths' });
    const { retire } = reconcile([maths, stored('e-gone')], [topic('e')]);
    expect(retire).toEqual(['e-gone']);
  });

  test('scope is the (grade, subject) pair: grade 3 English is not retired by a grade 2 import', () => {
    const g3 = stored('g3', { grade: 3 });
    expect(reconcile([g3], [topic('g2')]).retire).toEqual([]);
  });

  test('a matrix typo fix that changes an English id retires the old id and upserts the new one', () => {
    const existing = [stored('2-english-1-phonics-sh-sound')];
    const incoming = [topic('2-english-1-phonics-sh-sounds', { name: 'Phonics: sh sounds' })];
    const { upsert, retire } = reconcile(existing, incoming);
    expect(ids(upsert)).toEqual(['2-english-1-phonics-sh-sounds']);
    expect(retire).toEqual(['2-english-1-phonics-sh-sound']);
  });

  test.each([
    ['chapterNumber', 9], ['chapterTitle', 'B'], ['name', 'Other'],
    ['heading', null], ['headingOrder', 5], ['sortOrder', 7],
    ['pages', [3]], ['pages', [3, 5]], ['sloCodes', ['E-2']], ['sloCodes', []],
    ['sloDescriptions', ['d1', 'd2']], ['days', [2, 1]],
  ])('a change to %s is upserted', (field, value) => {
    const incoming = topic('a', { [field]: value });
    expect(ids(reconcile([stored('a')], [incoming]).upsert)).toEqual(['a']);
  });

  test('scope pairs come from incoming, so an empty import changes nothing', () => {
    expect(reconcile([stored('a')], [])).toEqual({ upsert: [], retire: [] });
  });

  test('duplicate topic ids in the incoming set throw', () => {
    expect(() => reconcile([], [topic('a'), topic('a')])).toThrow(/duplicate topic id "a"/);
  });

  test('does not mutate its inputs', () => {
    const existing = [stored('gone')];
    const incoming = [topic('a')];
    const snap = JSON.stringify([existing, incoming]);
    reconcile(existing, incoming);
    expect(JSON.stringify([existing, incoming])).toBe(snap);
  });
});

describe('sameContent', () => {
  test.each([['grade', 3], ['subject', 'urdu']])('a different %s is different content', (field, value) => {
    expect(sameContent(topic('a'), topic('a', { [field]: value }))).toBe(false);
  });
  test('missing arrays on either side are unequal to non-empty arrays', () => {
    expect(sameContent(topic('a', { pages: null }), topic('a'))).toBe(false);
    expect(sameContent(topic('a'), topic('a', { days: undefined }))).toBe(false);
  });
  test('null and empty array compare equal (both mean "none")', () => {
    expect(sameContent(topic('a', { sloCodes: null }), topic('a', { sloCodes: [] }))).toBe(true);
  });
  test('undefined and null heading compare equal', () => {
    expect(sameContent(topic('a', { heading: undefined }), topic('a', { heading: null }))).toBe(true);
  });
});

describe('row mapping', () => {
  const NOW = '2026-10-20T00:00:00.000Z';

  test('toRow maps camelCase to the snake_case table columns', () => {
    expect(toRow(topic('a'), '2026-10-20', NOW)).toEqual({
      topic_id: 'a', grade: 2, subject: 'english', chapter_number: 1, chapter_title: 'A', name: 'Name a',
      heading: 'Reading', heading_order: 2, sort_order: 1, pages: [3, 4], slo_codes: ['E-1'],
      slo_descriptions: ['d1'], days: [1, 2], is_current: true, matrix_version: '2026-10-20', updated_at: NOW,
    });
  });

  test('toRow stores a missing heading as null', () => {
    const row = toRow(topic('a', { heading: undefined, headingOrder: undefined }), 'v', NOW);
    expect(row.heading).toBeNull();
    expect(row.heading_order).toBeNull();
  });

  test('fromRow is the inverse and keeps is_current', () => {
    const back = fromRow(toRow(topic('a'), 'v', NOW));
    expect(back).toEqual({ ...topic('a'), isCurrent: true });
    expect(fromRow({ ...toRow(topic('a'), 'v', NOW), is_current: false }).isCurrent).toBe(false);
  });

  test('a stored row read back compares unchanged against the same topic', () => {
    const existing = [fromRow(toRow(topic('a'), 'v', NOW))];
    expect(reconcile(existing, [topic('a')])).toEqual({ upsert: [], retire: [] });
  });
});
