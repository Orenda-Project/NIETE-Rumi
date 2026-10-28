'use strict';
/**
 * Round 8, item 35 (sa_r8_counts): the scorer reads the form the phone ran. The battery file on the server is today's
 * (the switch is applied when the battery is served), so a result that names an item only the counts form carries is
 * scored against the counts form: its extra word / sums are scored and counted, never dropped.
 */
const score = require('../../shared/services/child-test/sa/score');

const session = () => ({ id: 's1', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed' });
const row = (block, lang, res, over = {}) => ({ id: `row-${block}`, session_id: 's1', block, lang, response_mode: 'record',
  audio_r2_key: 'k', audio_r2_keys: null, responses: [{ kind: 'result', mode: 'record', session_id: 'p1', ...res }], ...over });
const cells = (id, n) => Array.from({ length: n }, (_, i) => ({ i, item_id: `${id}.${String(i + 1).padStart(2, '0')}`, at_ms: i * 1000 }));

describe('the scorer and the counts form', () => {
  test('five words reached (one-at-a-time cells name ur.words4.05): five words scored', () => {
    const got = score.phoneSpecFor(session(), row('ur.words4', 'ur', { cells: cells('ur.words4', 5) }));
    expect(got.spec.record.items).toHaveLength(5);
    expect(got.spec.record.grid[4]).toBe('گھر');
  });
  test('today\'s form (four cells): four words, as today', () => {
    const got = score.phoneSpecFor(session(), row('ur.words4', 'ur', { cells: cells('ur.words4', 4) }));
    expect(got.spec.record.items).toHaveLength(4);
  });
  test('English words: the fifth is "come"', () => {
    const got = score.phoneSpecFor(session(), row('en.words4', 'en', { cells: cells('en.words4', 5) }));
    expect(got.spec.record.grid).toEqual(['go', 'sad', 'up', 'find', 'come']);
  });
  test('mental sums recorded one clip per sum: the clips name ma.add2i.05, so five sums with their answers', () => {
    const keys = cells('ma.add2i', 5).map((c) => ({ i: c.item_id, key: `k/${c.item_id}` }));
    const got = score.phoneSpecFor(session(), row('ma.add2i', 'ur', {}, { audio_r2_keys: keys }));
    expect(got.spec.record.items.map((x) => [x.show, x.answer])).toEqual([['13 + 6', 19], ['18 + 7', 25], ['12 + 14', 26], ['22 + 37', 59], ['38 + 26', 64]]);
  });
  test('multiplication: four (6 × 6 and 7 × 8 added)', () => {
    const keys = cells('ma.mul2i', 4).map((c) => ({ i: c.item_id, key: `k/${c.item_id}` }));
    const got = score.phoneSpecFor(session(), row('ma.mul2i', 'en', {}, { audio_r2_keys: keys }));
    expect(got.spec.record.items.map((x) => x.answer)).toEqual([12, 72, 36, 56]);
  });
  test('today\'s sums (two clips): two', () => {
    const keys = cells('ma.sub2i', 2).map((c) => ({ i: c.item_id, key: `k/${c.item_id}` }));
    expect(score.phoneSpecFor(session(), row('ma.sub2i', 'en', {}, { audio_r2_keys: keys })).spec.record.items).toHaveLength(2);
  });
});
