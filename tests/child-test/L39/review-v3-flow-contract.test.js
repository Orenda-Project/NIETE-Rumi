/**
 * L39 (bd-s1oo0.50.5): a v3 review page is the v2 REVIEW screen, unchanged (no new Flow to publish).
 * Every key a v3 page sends is declared on that screen with the same type, every text fits its component's
 * cap in code points, and the committed JSON is what the generator writes.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const V3 = require('../../../bot/shared/services/child-test/check-flow/review-v3');
const { buildChildTestReviewFlow } = require('../../../bot/shared/services/child-test/check-flow/review-flow');
const committed = require('../../../docs/flows/child-test-review.json');
const F = require('./fixtures/marks-v3');

const cps = (s) => [...String(s)].length;
const entry = (id, name) => ({ session: { id, grade: 3, form: 'A' }, child: { displayName: name }, blocks: Object.fromEntries(Object.entries(F.child()).map(([task, ai]) => [task, { block: task, ai_marks: ai }])) });

test('the committed Flow JSON is the generator\'s output, one screen, under 50 components', () => {
  expect(buildChildTestReviewFlow()).toEqual(committed);
  let n = 0;
  (function walk(c) { for (const x of c) { n += 1; if (x.children) walk(x.children); } }(committed.screens[0].layout.children));
  expect(n).toBeLessThanOrEqual(50);
});

test.each(['en', 'ur'])('a v3 page (%s) sends only declared keys, typed as declared, within the caps', (lang) => {
  const entries = ['A', 'B', 'C', 'D', 'E'].map((n, i) => entry(`s${i}`, `Child ${n} With A Rather Long Roster Name`));
  const { pages } = V3.paginate(entries);
  expect(pages.length).toBe(2);
  const declared = committed.screens[0].data;
  pages.forEach((items, p) => {
    const data = V3.pageScreenData(lang, items, 'rv_x', p + 1, pages.length);
    for (const [k, v] of Object.entries(data)) {
      expect(declared[k]).toBeDefined();
      const type = Array.isArray(v) ? 'array' : typeof v;
      expect(declared[k].type).toBe(type);
    }
    expect(Object.keys(declared).sort()).toEqual(Object.keys(data).sort());
    for (let i = 1; i <= 15; i += 1) {
      expect(cps(data[`i${i}_who`])).toBeLessThanOrEqual(80);   // TextSubheading
      expect(cps(data[`i${i}_h`])).toBeLessThanOrEqual(300);    // RadioButtonsGroup description
      expect(cps(data[`i${i}_q`])).toBeLessThanOrEqual(4096);   // TextBody
    }
    expect(cps(data.heading)).toBeLessThanOrEqual(80);
  });
});
