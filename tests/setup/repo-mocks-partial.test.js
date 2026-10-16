/**
 * A repo is only ever PARTIALLY mocked in a test.
 *
 * A `*.repo` module is the one place a service meets its table. A test that replaces the whole repo with a factory
 * of the shape the caller wants never runs the shape the repo really returns: a page once read `{ code, expires_at }`
 * from a mocked repo while the real one returned a bare string, and every tap on sandbox answered "unavailable".
 * So a `jest.mock('<…>.repo', factory)` (the spec's last path segment ends in `.repo`, with or without `.js`) must
 * spread the real module into its factory (`...jest.requireActual('<…>.repo')`) and override only what it fakes;
 * a factory without `jest.requireActual(`, or no factory at all, is a hit. Scanned: every test file under
 * bot/tests, dashboard/tests and tests (comments and strings are not read as calls).
 *
 * The suites that held whole repo mocks before this gate are in repo-mocks-partial.allowlist.json as hit counts per
 * DIRECTORY (so the list names no test file); it only shrinks: a new directory or a higher count fails, and a
 * lower count fails until the entry is lowered (or removed at 0).
 */
const fs = require('fs');
const ALLOW = require('./repo-mocks-partial.allowlist.json');
const { wholeRepoMocks, testFiles, byDir, countRatchet } = require('./test-seam-gates-lib');

const ROOTS = ['bot/tests', 'dashboard/tests', 'tests'];

function scan() {
  return byDir(testFiles(ROOTS).map((file) => ({ file, n: wholeRepoMocks(fs.readFileSync(file, 'utf8')).length })));
}

describe('the rule, on in-memory sources', () => {
  test('a repo mock without jest.requireActual is a hit, with or without .js, with or without a factory', () => {
    const src = [
      "jest.mock('../../shared/services/quiz/child-bind-codes.repo', () => ({ mint: jest.fn(), get: jest.fn() }));",
      "jest.mock('../../shared/services/quiz/child-phone-bindings.repo.js', () => ({",
      '  eraseOne: jest.fn((x) => (x ? 1 : 0)),',
      '}));',
      "jest.mock('../../shared/calls/call-tools.repo');",
    ].join('\n');
    expect(wholeRepoMocks(src)).toEqual([
      '../../shared/services/quiz/child-bind-codes.repo',
      '../../shared/services/quiz/child-phone-bindings.repo.js',
      '../../shared/calls/call-tools.repo',
    ]);
  });

  test('a partial repo mock, a non-repo mock and a mock inside a comment or a string are not hits', () => {
    const src = [
      "jest.mock('../../shared/services/quiz/child-bind-codes.repo', () => ({",
      "  ...jest.requireActual('../../shared/services/quiz/child-bind-codes.repo'),",
      '  mint: jest.fn(),',
      '}));',
      "jest.mock('../../shared/services/quiz/web-quiz-bind-page', () => ({ f: jest.fn() }));",
      "jest.mock('../../shared/services/repository', () => ({}));",
      "// jest.mock('../../shared/services/quiz/child-phone-bindings.repo', () => ({}));",
      "const note = \"jest.mock('../x.repo', () => ({}))\";",
    ].join('\n');
    expect(wholeRepoMocks(src)).toEqual([]);
  });

  test('a factory whose own text has parentheses in strings is read whole', () => {
    const src = "jest.mock('./a.repo', () => ({ f: () => ')(', g: jest.requireActual('./a.repo').g }));";
    expect(wholeRepoMocks(src)).toEqual([]);
  });

  test('the shrink-only check: new, up, down and clean all fail; equal passes', () => {
    expect(countRatchet({ a: 1 }, { a: 1 }, 'x')).toEqual([]);
    expect(countRatchet({ b: 1 }, {}, 'x')[0]).toMatch(/^NEW: b/);
    expect(countRatchet({ a: 2 }, { a: 1 }, 'x')[0]).toMatch(/^UP: a/);
    expect(countRatchet({ a: 1 }, { a: 2 }, 'x')[0]).toMatch(/^DOWN: a .* Lower it to 1/);
    expect(countRatchet({}, { a: 2 }, 'x')[0]).toMatch(/^CLEAN: a/);
  });
});

describe('the tree', () => {
  test('no new whole mock of a repo; the allowlist matches today exactly', () => {
    expect(countRatchet(scan(), ALLOW, 'whole repo mock(s): spread jest.requireActual(<the repo>) into the factory')).toEqual([]);
  });
});
