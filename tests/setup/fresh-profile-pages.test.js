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
 * A page is covered when some test file under bot/tests or dashboard/tests names it — its id, or a /wq/ script that
 * only that renderer loads (e.g. `hub.js` for renderHubPage) — AND carries `fresh profile` (any case; a comment
 * marker or a describe/test title) in the same file.
 *
 * fresh-profile-pages.allowlist.json `pages`: the pages with no such test when this gate landed; it only shrinks
 * (a new page without one fails; a listed page that gains one, or goes away, fails until removed).
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./fresh-profile-pages.allowlist.json');
const { REPO, testFiles, navigablePages, coversFreshProfile, pagesWithoutFreshProfile, listRatchet } = require('./test-seam-gates-lib');

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

  test('covered: the page named (or its own script) AND the fresh-profile marker in the same file', () => {
    const hub = { id: 'renderHubPage', scripts: ['hub.js'] };
    expect(coversFreshProfile("// fresh profile: no device yet\nrequire('../public/wq/hub.js')", hub)).toBe(true);
    expect(coversFreshProfile("describe('a Fresh-Profile phone', () => renderHubPage({}))", hub)).toBe(true);
    expect(coversFreshProfile("require('../public/wq/hub.js')", hub)).toBe(false);
    expect(coversFreshProfile("// fresh profile\nrequire('../public/wq/web-quiz-hub.js')", hub)).toBe(false);
    expect(coversFreshProfile("// fresh profile\nrequire('../public/wq/wq-tel.js')", hub)).toBe(false);
  });

  test('the pages without one', () => {
    const pages = navigablePages(['teacher-jugnu.page.js'], routes);
    expect(pagesWithoutFreshProfile(pages, ["// fresh profile\nrequire('teacher-jugnu.page')"])).toEqual(['renderHubPage', 'renderQuizPage']);
  });
});

describe('the tree', () => {
  test('every navigable page has a fresh-profile test, or is listed; the list matches today exactly', () => {
    const tests = testFiles(['bot/tests', 'dashboard/tests']).map((f) => fs.readFileSync(f, 'utf8'));
    expect(listRatchet(pagesWithoutFreshProfile(pagesInTree(), tests), ALLOW.pages || [], 'has no fresh-profile test')).toEqual([]);
  });
});
