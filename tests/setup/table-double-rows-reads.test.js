/**
 * On the shared table double (bot/tests/helpers/table-double.js, and teacher-quiz-menu/fake-db.js built on it) a
 * write's `rows` is ALWAYS an array; `raw` is the payload exactly as the product passed it (an object or an array).
 * A test that reads `w.rows.someField` gets undefined and passes or fails for the wrong reason (it broke a seam test
 * once). So in any test file that uses the double, `.rows.<field>` on a write is a failure: read `.raw.<field>`, or
 * `.rows[0].<field>`, or an array method (`.rows.length`, `.rows.map(...)`).
 *
 * Shrink-only allowlist: table-double-rows-reads.allowlist.json (empty).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { countVerdict } = require('./ratchet-verdict-lib');
const ALLOW = require('./table-double-rows-reads.allowlist.json');

const REPO = path.resolve(__dirname, '../..');
const USES_DOUBLE = /require\(\s*['"][^'"]*(?:helpers\/table-double|teacher-quiz-menu\/fake-db)['"]\s*\)/;
const ARRAY_METHODS = new Set(['length', 'map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'includes',
  'slice', 'reduce', 'flatMap', 'flat', 'concat', 'indexOf', 'join', 'at', 'entries', 'keys', 'values', 'sort']);
const READ = /\.rows\.([A-Za-z_$][\w$]*)/g;

const tracked = () => execFileSync('git', ['ls-files', '-z', '--', 'bot/tests', 'dashboard/tests'], { cwd: REPO })
  .toString('utf8').split('\0').filter((f) => f.endsWith('.js'));

/** `.rows.<field>` reads (not array methods) per file that uses the double. Pure over the source text. */
function rowsFieldReads(src) {
  let n = 0;
  for (const m of src.matchAll(READ)) if (!ARRAY_METHODS.has(m[1])) n += 1;
  return n;
}

function hits() {
  const out = {};
  for (const f of tracked()) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    if (!USES_DOUBLE.test(src)) continue;
    const n = rowsFieldReads(src);
    if (n) out[f] = n;
  }
  return out;
}

describe('a write\'s rows on the shared table double are read as an array', () => {
  test('the pattern: a field read counts; array methods, an index and raw do not', () => {
    expect(rowsFieldReads('w.rows.canonical_id; w.rows.length; w.rows.map((r) => r.id); w.rows[0].id; w.raw.id')).toBe(1);
    expect(USES_DOUBLE.test("const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');")).toBe(true);
    expect(USES_DOUBLE.test("const { tableDouble } = require('../helpers/table-double');")).toBe(true);
  });

  test('no test reads a write\'s rows as one object', () => {
    const { failures, warnings } = countVerdict(hits(), ALLOW, {
      what: 'read(s) of a write\'s rows as one object (use .raw or .rows[0])', list: 'table-double-rows-reads.allowlist.json',
      exists: (f) => fs.existsSync(path.join(REPO, f)),
    });
    for (const line of warnings) console.warn(line);
    expect(failures).toEqual([]);
  });
});
