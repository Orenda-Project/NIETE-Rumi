/**
 * The order a match question prints its Column B in (bd-5jmnfj.4.23): sorted, so it never
 * follows the order the model wrote the pairs, and turned until no answer sits beside its
 * own stem.
 */

const { matchOrder, matchTable } = require('../../bot/shared/services/assessment/fde-match-block');

const beside = (answers, order) => order.filter((a, i) => a === answers[i]).length;

test.each([
  [['b', 'a', 'c']],
  [['a', 'b', 'c', 'd', 'e']],
  [['e', 'd', 'c', 'b', 'a']],
  [['صحرا', 'گھونسلہ', 'پودے', 'پانی', 'سونگھنا']],
])('%j: every answer is printed once, none beside its own stem', (answers) => {
  const order = matchOrder(answers);
  expect([...order].sort()).toEqual([...answers].sort());
  expect(beside(answers, order)).toBe(0);
});

test('two pairs swap; one pair is printed as it is', () => {
  expect(matchOrder(['x', 'y'])).toEqual(['y', 'x']);
  expect(matchOrder(['x'])).toEqual(['x']);
});

test('the table puts each stem beside a Column B cell, one row per pair', () => {
  const html = matchTable(['1 A', '2 B'], ['q', 'p']);
  expect((html.match(/<tr>/g) || [])).toHaveLength(2);
  expect(html).toContain('<td class="m-a">1 A</td><td class="m-gap"></td><td class="m-b">q</td>');
});
