/**
 * The web quiz render matrix, no-browser half, in the root suite so CI runs it on every PR.
 * Every question shape the engine can hand the page × the mutations that break layouts × EN + UR
 * (dashboard/tests/render-matrix/shapes.js) is made into the page payload by the server's own
 * questionPayload() and rendered through the shipped page's question() and both feedback screens.
 * The browser half (360×740 layout checks) runs in dashboard/tests/web-quiz-render-matrix.service.test.js.
 */
const { cases } = require('../../dashboard/tests/render-matrix/shapes');
const E2 = require('../../dashboard/tests/render-matrix/e2');
const V = require('../../dashboard/tests/render-matrix/vm-page');

const ALL = cases();

test('the matrix has cases in both languages', () => {
  expect(ALL.length).toBeGreaterThan(100);
  expect(new Set(ALL.map((c) => c.lang))).toEqual(new Set(['en', 'ur']));
});

test.each(ALL.map((c) => [c.id, c]))('%s renders: no throw, every option shows something, no raw TeX', (id, c) => {
  const q = E2.question(c);
  expect(q).toBeTruthy();
  expect(V.renderCase(c, q, E2.payload(c, q)).faults).toEqual([]);
});
