/**
 * The web quiz render matrix, no-browser half, in the root suite so CI runs it on every PR.
 * Every item shape the engine can emit (scripts/qa/render-matrix/build_matrix.js — real
 * questionPayload, real page shell) is rendered through the shipped page's question() and both
 * feedback screens (a wrong pick and the right one) in a vm: nothing throws, every option shows a
 * word or a picture, and no maths reaches the child as raw TeX or as a TeX command spelled out.
 * The 360x740 layout half needs a browser: dashboard/tests/web-quiz-render-matrix.service.test.js.
 */
const { shapes, pageFor, answers, LANGS } = require('../../scripts/qa/render-matrix/build_matrix');
const { renderCase } = require('../../scripts/qa/render-matrix/vm_page');

const ALL = LANGS.flatMap((lang) => shapes(lang));

test('the matrix has every item type, in both languages', () => {
  const kinds = new Set(ALL.map((s) => pageFor(s).item.type || 'row'));
  ['single', 'picture', 'listen', 'tf', 'order', 'match', 'label', 'row'].forEach((k) => expect(kinds.has(k)).toBe(true));
  expect(new Set(ALL.map((s) => s.lang))).toEqual(new Set(LANGS));
});

test.each(ALL.map((s) => [s.id, s]))('%s renders: no throw, every option shows something, no raw TeX', (id, s) => {
  const p = pageFor(s);
  expect(renderCase(p.item, p.html, 1, answers(p.item)).faults).toEqual([]);
});
