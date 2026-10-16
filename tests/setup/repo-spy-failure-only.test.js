/**
 * A repo is spied on only to make it FAIL.
 *
 * `jest.spyOn(<repo>, 'fn').mockResolvedValue(<shape>)` is a whole-repo mock by another name: the test hands the
 * caller the shape it wants instead of the shape the repo returns. Spying on a repo is fine for one thing — making
 * it throw or go away, to prove the caller survives — so a `jest.spyOn(<repo>, …)` must sit inside a `describe(`
 * whose title says so: it contains "failure" or "unavailable" (any case).
 * `<repo>` is `require('<…>.repo')` / `jest.requireActual('<…>.repo')` written inline as the first argument, or a
 * name the same file binds to one (`const repo = require(BIND_REPO)`, a const string spec resolved). Scanned: every
 * test file under bot/tests, dashboard/tests and tests.
 *
 * Suites that spied on a repo outside such a describe before this gate are in repo-spy-failure-only.allowlist.json
 * as hit counts per DIRECTORY; it only shrinks (new or up fails; down fails until lowered; 0 removes the entry).
 */
const fs = require('fs');
const ALLOW = require('./repo-spy-failure-only.allowlist.json');
const { repoSpiesOutsideFailure, testFiles, byDir, countRatchet } = require('./test-seam-gates-lib');

const ROOTS = ['bot/tests', 'dashboard/tests', 'tests'];

function scan() {
  return byDir(testFiles(ROOTS).map((file) => ({ file, n: repoSpiesOutsideFailure(fs.readFileSync(file, 'utf8')).length })));
}

// The in-memory sources spell require as REQ( so the require-graph audit never reads them as this file's requires.
const live = (s) => s.replace(/\bREQ\(/g, `${'req'}uire(`);

describe('the rule, on in-memory sources', () => {
  test('a spy on a bound repo, on an inline require, and through a const spec is a hit outside a failure describe', () => {
    const src = [
      "const BIND = '../../shared/services/quiz/child-phone-bindings.repo';",
      "const Codes = REQ('../../shared/services/quiz/child-bind-codes.repo');",
      "describe('the bind page', () => {",
      "  test('a', () => { jest.spyOn(Codes, 'mint').mockResolvedValue({ code: 'X' }); });",
      "  test('b', () => { jest.spyOn(REQ('../../shared/services/quiz/child-bind-codes.repo'), 'get'); });",
      "  test('c', () => { const repo = REQ(BIND); jest.spyOn(repo, 'activeForChild'); });",
      '});',
    ].join('\n');
    expect(repoSpiesOutsideFailure(live(src))).toEqual([4, 5, 6]);
  });

  test('inside a describe titled failure or unavailable (any case, nested) it is not a hit; a non-repo spy never is', () => {
    const src = [
      "const Codes = REQ('../../shared/services/quiz/child-bind-codes.repo');",
      "const Svc = REQ('../../shared/services/quiz/web-quiz-bind-page');",
      "describe('when the table is UNAVAILABLE', () => {",
      "  test('a', () => { jest.spyOn(Codes, 'mint').mockRejectedValue(new Error('down (pool)')); });",
      '});',
      "describe('outer', () => { describe('a write Failure', () => {",
      "  test('b', () => { jest.spyOn(Codes, 'get').mockRejectedValue(new Error('x')); });",
      '}); });',
      "test('c', () => { jest.spyOn(Svc, 'mint'); });",
    ].join('\n');
    expect(repoSpiesOutsideFailure(live(src))).toEqual([]);
  });

  test('a describe title in a comment does not count; a failure word in the TEST title does not count', () => {
    const src = [
      "const Codes = REQ('./child-bind-codes.repo');",
      "// describe('failure', () => {",
      "describe('renewal', () => {",
      "  test('a failing renewal is logged', () => { jest.spyOn(Codes, 'mint'); });",
      '});',
    ].join('\n');
    expect(repoSpiesOutsideFailure(live(src))).toEqual([4]);
  });
});

describe('the tree', () => {
  test('no new repo spy outside a failure describe; the allowlist matches today exactly', () => {
    expect(countRatchet(scan(), ALLOW, "repo spy(ies) outside a describe titled 'failure'/'unavailable'")).toEqual([]);
  });
});
