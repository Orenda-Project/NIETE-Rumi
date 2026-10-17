/**
 * No new "Tests only" knob in .env.template.
 *
 * A test that re-records its golden pins from an env name (FOO_RECORD=1) puts that name in .env.template under a
 * "# Tests only" comment, where every such block collides with the next one (add/add on the same lines). A golden test
 * records instead when its pinned file is missing, and that run fails, so a missing file is never a silent pass; then
 * no env name is read and the template gains nothing.
 *
 * KNOWN lists the names that are still there, each with the change that retires it. The list only shrinks: a name in a
 * "# Tests only" block that is not on it fails here. A name on it that has left the template is reported, not failed
 * (its retiring change removes it from the list).
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.resolve(__dirname, '../../.env.template');

const KNOWN = Object.freeze({
  PG_BIN: 'not a golden knob: the throwaway-database tests find the Postgres binaries through it',
  GOLDEN_WRITE: 'retire: the golden tests that read it record when their pinned file is missing',
  RECORD_GOLDEN: 'retire after the teacher-home paging change lands',
  TEACHER_HOME_RECORD: 'retire after the teacher-home lines change lands',
});

/** The names (uncommented NAME= lines) inside every "# Tests only" block; a block ends at a blank line. */
function testsOnlyNames(text) {
  const names = [];
  let inBlock = false;
  for (const line of String(text).split('\n')) {
    if (/^#\s*Tests only\b/i.test(line)) { inBlock = true; continue; }
    if (!line.trim()) { inBlock = false; continue; }
    if (!inBlock) continue;
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

const unknownKnobs = (text) => testsOnlyNames(text).filter((n) => !Object.prototype.hasOwnProperty.call(KNOWN, n));

describe('.env.template: no new "Tests only" env knob', () => {
  test('the reader finds a "Tests only" name, and a new one is flagged (fixture)', () => {
    const fixture = [
      '# Tests only: the throwaway-database tests.', 'PG_BIN=', '',
      '# Tests only: re-records the widget goldens (WIDGET_RECORD=1).', '# never read by product code.', 'WIDGET_RECORD=', 'WIDGET_DUMP_DIR=', '',
      '# --- Optional: something real', 'REAL_SETTING=',
    ].join('\n');
    expect(testsOnlyNames(fixture)).toEqual(['PG_BIN', 'WIDGET_RECORD', 'WIDGET_DUMP_DIR']);
    expect(unknownKnobs(fixture)).toEqual(['WIDGET_RECORD', 'WIDGET_DUMP_DIR']);
  });

  test('a commented-out name and a name outside a "Tests only" block are not knobs (fixture)', () => {
    const fixture = ['# Tests only: an example.', '# OLD_RECORD=', '', 'ONE_RECORD=', '# Sandbox/test only: echo.', 'ECHO_TO='].join('\n');
    expect(testsOnlyNames(fixture)).toEqual([]);
  });

  test('every "Tests only" name in .env.template is a known one', () => {
    const extra = unknownKnobs(fs.readFileSync(TEMPLATE, 'utf8'));
    expect({ newTestsOnlyNames: extra }).toEqual({ newTestsOnlyNames: [] });
  });

  test('known names that have left the template are reported (never failed)', () => {
    const present = new Set(testsOnlyNames(fs.readFileSync(TEMPLATE, 'utf8')));
    const gone = Object.keys(KNOWN).filter((n) => !present.has(n));
    for (const n of gone) console.warn(`env-template-test-knobs: ${n} is no longer in .env.template; remove it from KNOWN`);
    expect(Array.isArray(gone)).toBe(true);
  });
});
