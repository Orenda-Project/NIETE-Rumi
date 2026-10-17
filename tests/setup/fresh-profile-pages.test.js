/**
 * Every navigable page has a fresh-profile test.
 *
 * A page that works on the phone it was built on can still fail on a phone that has never opened it: no stored
 * device id, no cookie, no cached language, no service worker. A "fresh profile" test loads the page that way.
 *
 * A navigable page, concretely:
 *   - each `bot/shared/templates/*.page.js` (the teacher pages the bot serves: the report, the Jugnu tab, the class
 *     round), id `<name>.page`;
 *   - each top-level `function render<Name>Page(` in `dashboard/routes/web-quiz*.js` (the child pages the portal edge
 *     serves at /q/, /h/, /c/, /j/ and their closed, preview and library faces), id `render<Name>Page`.
 * A page is covered when ONE describe/test/it block (a describe with everything nested in it) of some test file under
 * bot/tests or dashboard/tests names it — its id, or a /wq/ script that only that renderer loads (e.g. `hub.js` for
 * renderHubPage) — AND carries `fresh profile` (any case; its title, or a comment or string inside it). A fresh-profile
 * test elsewhere in the same file does not cover a page it never touches.
 *
 * fresh-profile-pages.allowlist.json `pages`: the pages with no such test when this gate landed. The gate fails on
 * a navigable page that is neither listed nor tested, and on a listed page that no longer exists. A listed page that
 * gains its test passes, with a console.warn "CLEAN: remove <page> from fresh-profile-pages.allowlist.json", so the
 * PR that adds the test does not also have to edit the list.
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./fresh-profile-pages.allowlist.json');
const { REPO, testFiles, navigablePages, coversFreshProfile, pagesWithoutFreshProfile, freshProfileVerdict } = require('./test-seam-gates-lib');

function pagesInTree() {
  const templates = fs.readdirSync(path.join(REPO, 'bot/shared/templates'));
  const routesDir = path.join(REPO, 'dashboard/routes');
  const routes = fs.readdirSync(routesDir).filter((n) => /^web-quiz.*\.js$/.test(n)).map((n) => ({ text: fs.readFileSync(path.join(routesDir, n), 'utf8') }));
  return navigablePages(templates, routes);
}

describe('the rule, on in-memory sources', () => {
  const routes = [{
    text: [
      'function renderHubPage({ payload }) {',
      '  return `<script src="/wq/wq-tel.js"></script><script src="/wq/hub.js"></script>`;',
      '}',
      'async function renderQuizPage() {',
      '  return `<script src="/wq/wq-tel.js"></script><script src="/wq/wq.js"></script>`;',
      '}',
      'function helper() {}',
      'module.exports = {};',
    ].join('\n'),
  }];

  test('the pages: *.page.js templates and render*Page functions, each with the scripts only it loads', () => {
    expect(navigablePages(['teacher-jugnu.page.js', 'niete-brand.js', 'teacher-class-week.card.js'], routes)).toEqual([
      { id: 'renderHubPage', scripts: ['hub.js'] },
      { id: 'renderQuizPage', scripts: ['wq.js'] },
      { id: 'teacher-jugnu.page', scripts: [] },
    ]);
  });

  test('covered: the page named (or its own script) AND the fresh-profile marker in the same file (a snippet with no test block is one block)', () => {
    const hub = { id: 'renderHubPage', scripts: ['hub.js'] };
    expect(coversFreshProfile("// fresh profile: no device yet\nrequire('../public/wq/hub.js')", hub)).toBe(true);
    expect(coversFreshProfile("describe('a Fresh-Profile phone', () => renderHubPage({}))", hub)).toBe(true);
    expect(coversFreshProfile("require('../public/wq/hub.js')", hub)).toBe(false);
    expect(coversFreshProfile("// fresh profile\nrequire('../public/wq/web-quiz-hub.js')", hub)).toBe(false);
    expect(coversFreshProfile("// fresh profile\nrequire('../public/wq/wq-tel.js')", hub)).toBe(false);
  });

  test('block scope: the page and the marker in ONE test block', () => {
    const hub = { id: 'renderHubPage', scripts: ['hub.js'] };
    // (a) one fresh-profile test that renders the page
    expect(coversFreshProfile("test('fresh profile: a new phone', () => { renderHubPage({}); });", hub)).toBe(true);
    // (b) the marker in one test, the page in another: not covered
    expect(coversFreshProfile([
      "test('fresh profile: a new phone', () => renderQuizPage({}));",
      "test('the hub', () => renderHubPage({}));",
    ].join('\n'), hub)).toBe(false);
    // (c) a describe carries the marker for every block nested in it
    expect(coversFreshProfile("describe('fresh profile', () => {\n  test('x', () => renderHubPage({}));\n});", hub)).toBe(true);
    // (d) the marker as a comment inside the block
    expect(coversFreshProfile("test('a new phone', () => {\n  // fresh profile: no device id\n  renderHubPage({});\n});", hub)).toBe(true);
    // (e) a ')' in a string, or a template with ${…}, does not end the block early
    expect(coversFreshProfile([
      "test('fresh profile: odd strings', () => {",
      "  const a = 'a ) b';",
      '  const b = `x ${ (1) } ) y`;',
      '  renderHubPage({ a, b });',
      '});',
      "test('other', () => renderQuizPage({}));",
    ].join('\n'), hub)).toBe(true);
    expect(coversFreshProfile("test('fresh profile', () => { const s = ')'; });\nrenderHubPage({});", hub)).toBe(false);
    // .each(…) with calls in its table, and .only/.skip, are blocks too
    expect(coversFreshProfile("test.each([['a', () => null]])('fresh profile %s', () => renderHubPage({}));\ntest('other', () => renderQuizPage({}));", hub)).toBe(true);
    expect(coversFreshProfile("describe.only('fresh profile', () => { it.skip('x', () => renderHubPage({})); });", hub)).toBe(true);
  });

  test('the pages without one', () => {
    const pages = navigablePages(['teacher-jugnu.page.js'], routes);
    expect(pagesWithoutFreshProfile(pages, ["// fresh profile\nrequire('teacher-jugnu.page')"])).toEqual(['renderHubPage', 'renderQuizPage']);
  });
});

describe('the verdict, on a synthetic page, test and allowlist set', () => {
  const pages = [
    { id: 'listed-tested.page', scripts: [] },
    { id: 'listed-untested.page', scripts: [] },
    { id: 'unlisted-untested.page', scripts: [] },
    { id: 'unlisted-tested.page', scripts: [] },
  ];
  const tests = [
    "// fresh profile\nrequire('listed-tested.page')",
    "describe('a fresh profile', () => require('unlisted-tested.page'))",
  ];

  test('a listed page that now has its test passes, with a CLEAN line', () => {
    const v = freshProfileVerdict(pages.filter((p) => p.id === 'listed-tested.page'), tests, ['listed-tested.page']);
    expect(v.failures).toEqual([]);
    expect(v.cleans).toEqual(['CLEAN: remove listed-tested.page from fresh-profile-pages.allowlist.json']);
  });

  test('a page neither listed nor tested fails', () => {
    const v = freshProfileVerdict(pages.filter((p) => p.id === 'unlisted-untested.page'), tests, []);
    expect(v.failures).toEqual(['NEW: unlisted-untested.page has no fresh-profile test. Add one (a test that names the page and says "fresh profile").']);
    expect(v.cleans).toEqual([]);
  });

  test('a listed page that no longer exists fails', () => {
    const v = freshProfileVerdict([], tests, ['gone.page']);
    expect(v.failures).toEqual(['GONE: gone.page is no longer a page. Remove it from fresh-profile-pages.allowlist.json.']);
    expect(v.cleans).toEqual([]);
  });

  test('a listed page still without its test passes, with no line', () => {
    const v = freshProfileVerdict(pages.filter((p) => p.id === 'listed-untested.page'), tests, ['listed-untested.page']);
    expect(v).toEqual({ failures: [], cleans: [] });
  });

  test('all together: only the unlisted untested page and the missing listed page fail', () => {
    const v = freshProfileVerdict(pages, tests, ['listed-tested.page', 'listed-untested.page', 'gone.page']);
    expect(v.failures).toEqual([
      'NEW: unlisted-untested.page has no fresh-profile test. Add one (a test that names the page and says "fresh profile").',
      'GONE: gone.page is no longer a page. Remove it from fresh-profile-pages.allowlist.json.',
    ]);
    expect(v.cleans).toEqual(['CLEAN: remove listed-tested.page from fresh-profile-pages.allowlist.json']);
  });
});

describe('the tree', () => {
  test('every navigable page has a fresh-profile test, or is listed; every listed page exists', () => {
    const tests = testFiles(['bot/tests', 'dashboard/tests']).map((f) => fs.readFileSync(f, 'utf8'));
    const { failures, cleans } = freshProfileVerdict(pagesInTree(), tests, ALLOW.pages || []);
    for (const line of cleans) console.warn(line);
    expect(failures).toEqual([]);
  });
});
