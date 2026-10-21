'use strict';
/**
 * The one-at-a-time record screen's chip (RULING W3-12 4c): a task that names its own chip (the mental sums: "Say the
 * answer") shows it; every other task keeps the page's "Read aloud".
 */
const { recChip, COPY } = require('../sa/sa-ui');

test('a task\'s own chip wins; without one the page copy\'s read_aloud', () => {
  expect(recChip({ id: 'ma.add2i', chip: 'جواب بتائیں' }, COPY.ur)).toBe('جواب بتائیں');
  expect(recChip({ id: 'ma.number_id8' }, COPY.ur)).toBe(COPY.ur.read_aloud);
  expect(recChip({ id: 'en.words4' }, COPY.en)).toBe('Read aloud');
});
