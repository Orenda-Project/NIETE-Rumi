/**
 * Every Flow test that builds a title, description or row must carry an Urdu
 * fixture.
 *
 * Three script bugs shipped between 4 and 6 Sep 2026 — bidi reordering of the
 * English inside an Urdu page, and two `\W` regexes that erased whole Urdu
 * titles — and not one was caught by a test, because every fixture was English.
 * A rule written in ASCII assumptions passes an English fixture every time; only
 * a device, or an Urdu fixture, catches it. The ICT deployment is Urdu-medium
 * for most of what it teaches.
 *
 * This is a meta-test: it scans the sibling test files that exercise the row/
 * title builders and requires at least one string in Arabic script.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ARABIC_SCRIPT = /[؀-ۿ]/;
// A suite that EXECUTES a row/title builder: it loads the endpoint or the
// selection module and drives it. Source-grep suites (which mention the names
// but never run them) are not the concern — a fixture there proves nothing.
const LOADS_BUILDER = /require\(['"][./]*bot\/shared\/(routes\/assessment-gen-endpoint|services\/assessment\/assessment-selection)['"]\)/;
const BUILDS_ROWS = /optionTitle|navFit|navDescription|data\.questions|questions:|items:/;

describe('Urdu fixtures wherever a Flow row or title is built', () => {
  const files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.test.js') && f !== path.basename(__filename))
    .filter((f) => {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      return LOADS_BUILDER.test(src) && BUILDS_ROWS.test(src);
    });

  test('the scan finds the suites it is meant to guard (else it guards nothing)', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  test.each(files)('%s carries at least one Urdu fixture', (f) => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    expect(ARABIC_SCRIPT.test(src)).toBe(true);
  });
});
