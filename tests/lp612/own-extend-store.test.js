/**
 * bd-snkn32.14 — the catalogue reads behind "Add the next lesson's pages": one book, one chapter, current rows, the
 * book's order. A failed read is "no next lesson", never a throw.
 */
const { loadSegment, chapterSegments } = require('../../bot/shared/services/lp612-own-extend.store');

function fakeClient(result) {
  const calls = [];
  const q = {
    select: (c) => { calls.push(['select', c]); return q; },
    eq: (k, v) => { calls.push(['eq', k, v]); return q; },
    order: (k, o) => { calls.push(['order', k, o]); return Promise.resolve(result); },
    maybeSingle: () => Promise.resolve(result),
  };
  return { client: { from: (t) => { calls.push(['from', t]); return q; } }, calls };
}

test('chapterSegments reads the same book and chapter, current rows only, in the book order', async () => {
  const { client, calls } = fakeClient({ data: [{ segment_id: 'a' }], error: null });
  const rows = await chapterSegments(client, { book_stem: 'g8sci', chapter_key: 'c02' });
  expect(rows).toEqual([{ segment_id: 'a' }]);
  expect(calls).toEqual(expect.arrayContaining([
    ['from', 'niete_lp612_segments'], ['eq', 'book_stem', 'g8sci'], ['eq', 'chapter_key', 'c02'],
    ['eq', 'is_current', true], ['order', 'order_index', { ascending: true }],
  ]));
});

test('a failed read is no rows / no segment', async () => {
  expect(await chapterSegments(fakeClient({ data: null, error: { message: 'x' } }).client, { book_stem: 'b', chapter_key: 'c' })).toEqual([]);
  expect(await chapterSegments(fakeClient({}).client, null)).toEqual([]);
  expect(await loadSegment(fakeClient({ data: null, error: { message: 'x' } }).client, 's')).toBeNull();
});

test('loadSegment reads one row by id', async () => {
  const { client, calls } = fakeClient({ data: { segment_id: 's' }, error: null });
  expect(await loadSegment(client, 's')).toEqual({ segment_id: 's' });
  expect(calls).toContainEqual(['eq', 'segment_id', 's']);
});
