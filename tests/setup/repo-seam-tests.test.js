/**
 * Every repo seam has a seam test.
 *
 * A seam is a (module, repo) pair: a module under bot/shared/services (any depth; the quiz services and the student
 * ingress among them) that requires a `*.repo` module by a relative path (`require('./child-bind-codes.repo')`).
 * Its seam test is a file under bot/tests named `<m>-seam.test.js`, or `<m>-<more>-seam.test.js` (a prefix match,
 * so `web-quiz-bind-page-mint-seam.test.js` is a seam test of web-quiz-bind-page.js), where `<m>` is the module's
 * file name without `.js` — and that file must load the REAL repo (a `require` or `jest.requireActual` whose spec
 * names `<repo>`) and must never `jest.mock` / `jest.doMock` it. Only the network is faked in a seam test.
 *
 * repo-seam-tests.allowlist.json:
 *   - `missing`: the seams that had no seam test before this gate, as "<module> > <repo>"; only shrinks (a new
 *     seam without a test fails; a listed seam that now has one, or no longer exists, fails until removed);
 *   - `pure`: { "<module> > <repo>": "<one-word reason>" } for a module that uses only a pure function of the repo
 *     (e.g. parseCode), which never reaches the table; only shrinks the same way.
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./repo-seam-tests.allowlist.json');
const { REPO, walk, relativeRepoRequires, isSeamTestName, seamTestLoadsRealRepo, seamsWithoutTest, listRatchet } = require('./test-seam-gates-lib');

const SERVICES = path.join(REPO, 'bot/shared/services');

function scan() {
  const modules = walk(SERVICES, (n) => n.endsWith('.js') && !/\.repo\.js$/.test(n))
    .map((f) => ({ id: path.relative(SERVICES, f).split(path.sep).join('/'), base: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  const tests = walk(path.join(REPO, 'bot/tests'), (n) => n.endsWith('-seam.test.js'))
    .map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  return seamsWithoutTest(modules, tests);
}

// The in-memory sources spell require as REQ( so the require-graph audit never reads them as this file's requires.
const live = (s) => s.replace(/\bREQ\(/g, `${'req'}uire(`);

describe('the rule, on in-memory sources', () => {
  test('a module\'s relative repo requires are its seams (top-level, inline, a .js spelling); a package or a non-repo is not', () => {
    const src = [
      "const BindRepo = REQ('./child-phone-bindings.repo');",
      "async function f() { return REQ('./child-bind-codes.repo.js').mint(1); }",
      "const Other = REQ('./web-quiz-token');",
      "const pg = REQ('some.repo');",
      "// REQ('./ghost.repo')",
    ].join('\n');
    expect(relativeRepoRequires(live(src))).toEqual(['child-bind-codes.repo', 'child-phone-bindings.repo']);
  });

  test('a seam test name is <m>-seam.test.js or <m>-<more>-seam.test.js; a near miss is not', () => {
    expect(isSeamTestName('web-quiz-bind-page-seam.test.js', 'web-quiz-bind-page.js')).toBe(true);
    expect(isSeamTestName('web-quiz-bind-page-mint-seam.test.js', 'web-quiz-bind-page.js')).toBe(true);
    expect(isSeamTestName('web-quiz-bind.service-seam.test.js', 'web-quiz-bind.service.js')).toBe(true);
    expect(isSeamTestName('web-quiz-bind-page.test.js', 'web-quiz-bind-page.js')).toBe(false);
    expect(isSeamTestName('web-quiz-bind-seam.test.js', 'web-quiz-bind-page.js')).toBe(false);
  });

  test('a seam test loads the real repo and never mocks it', () => {
    const real = "const Codes = REQ('../../../shared/services/quiz/child-bind-codes.repo');";
    const mocked = `jest.mock('../../../shared/services/quiz/child-bind-codes.repo', () => ({ ...jest.requireActual('../../../shared/services/quiz/child-bind-codes.repo') }));\n${real}`;
    expect(seamTestLoadsRealRepo(live(real), 'child-bind-codes.repo')).toBe(true);
    expect(seamTestLoadsRealRepo(live(mocked), 'child-bind-codes.repo')).toBe(false);
    expect(seamTestLoadsRealRepo(live(real), 'child-phone-bindings.repo')).toBe(false);
  });

  test('the seams without a test: one covered, one missing, one covered by a mocking file only', () => {
    const modules = [
      { id: 'quiz/a.js', base: 'a.js', text: "REQ('./x.repo'); REQ('./y.repo');" },
      { id: 'quiz/b.js', base: 'b.js', text: "REQ('./x.repo');" },
    ];
    const tests = [
      { name: 'a-seam.test.js', text: "REQ('../../shared/services/quiz/x.repo');" },
      { name: 'b-write-seam.test.js', text: "jest.mock('../../shared/services/quiz/x.repo'); REQ('../../shared/services/quiz/x.repo');" },
    ];
    const L = (xs) => xs.map((x) => ({ ...x, text: live(x.text) }));
    expect(seamsWithoutTest(L(modules), L(tests))).toEqual(['quiz/a.js > y.repo', 'quiz/b.js > x.repo']);
  });

  test('the list check: new fails, stale fails, equal passes', () => {
    expect(listRatchet(['a'], ['a'], 'x')).toEqual([]);
    expect(listRatchet(['a', 'b'], ['a'], 'x')).toEqual(['NEW: b x.']);
    expect(listRatchet([], ['a'], 'x')[0]).toMatch(/^CLEAN: a/);
  });
});

describe('the tree', () => {
  test('every repo seam has a seam test, or is listed (missing / pure); both lists match today exactly', () => {
    const found = scan();
    const pure = Object.keys(ALLOW.pure || {});
    for (const k of pure) expect([k, /^[a-z]+$/i.test(ALLOW.pure[k])]).toEqual([k, true]);
    expect(listRatchet(found, [...(ALLOW.missing || []), ...pure], 'has no <module>-seam.test.js that loads the real repo')).toEqual([]);
  });
});
