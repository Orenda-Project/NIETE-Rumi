/**
 * The mock lane checks the commit under test out INSIDE the repo (.claude/qa/results/<run>/src/) for
 * the life of a run. Jest's module map must never see that copy: with it present, every stub under
 * tests/__mocks__ exists twice and 61 suites die on "duplicate module" while a run is in flight.
 * Red-first: fails on develop — the config has no modulePathIgnorePatterns.
 */
const path = require('path');
const cfg = require('../jest.config.js');
const root = path.resolve(__dirname, '..', '..');
const inRun = path.join(root, '.claude/qa/results/whatsapp/niete/20260908-102841-abc1234-mock/src/tests/__mocks__/katex-stub/package.json');
const ours = path.join(root, 'tests/__mocks__/katex-stub/package.json');
const expand = (p) => new RegExp(p.replace('<rootDir>', path.resolve(__dirname, '..', cfg.rootDir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

test('a pinned run checkout under .claude/qa/results is outside the module map, our own tests are not', () => {
  const pats = (cfg.modulePathIgnorePatterns || []).map(expand);
  expect(pats.length).toBeGreaterThan(0);
  expect(pats.some((re) => re.test(inRun))).toBe(true);
  expect(pats.some((re) => re.test(ours))).toBe(false);
});

test('a test file inside a run checkout is never collected as a suite', () => {
  const pats = cfg.testPathIgnorePatterns.map((p) => new RegExp(p));
  expect(pats.some((re) => re.test(inRun.replace('__mocks__/katex-stub/package.json', 'e2e-mock/x.test.js')))).toBe(true);
  expect(pats.some((re) => re.test(path.join(root, 'tests/e2e-mock/x.test.js')))).toBe(false);
});
