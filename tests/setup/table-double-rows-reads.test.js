/**
 * On the shared table double (bot/tests/helpers/table-double.js, and teacher-quiz-menu/fake-db.js built on it) a
 * write's `rows` is ALWAYS an array; `raw` is the payload exactly as the product passed it (an object or an array).
 * A test that reads `w.rows.someField` gets undefined and passes or fails for the wrong reason (it broke a seam test
 * once). So in any test file that uses the double, `.rows.<field>` on a write is a failure: read `.raw.<field>`, or
 * `.rows[0].<field>`, or an array method (`.rows.length`, `.rows.map(...)`).
 *
 * What counts as a read: `.rows.x`, `.rows?.x`, `.rows['x']`, and `rows.x` after a destructured `{ rows }`. What does
 * not: anything that exists on Array.prototype (`push`, `length`, `map` …), an index (`.rows[0]`), and text inside a
 * comment.
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
const FIELD = '([A-Za-z_$][\\w$]*)';
// `.rows.x` / `.rows?.x` / `.rows['x']`, and a bare `rows.x` (the same three forms) once `{ rows }` is destructured.
const READ = new RegExp(`\\.rows\\s*(?:\\?\\.|\\.)\\s*${FIELD}|\\.rows\\s*(?:\\?\\.)?\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g');
const BARE_READ = new RegExp(`(?<![\\w$.])rows\\s*(?:\\?\\.|\\.)\\s*${FIELD}|(?<![\\w$.])rows\\s*(?:\\?\\.)?\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g');
const DESTRUCTURED = /\{[^{}]*\brows\b[^{}]*\}\s*=[^=>]/;

const tracked = () => execFileSync('git', ['ls-files', '-z', '--', 'bot/tests', 'dashboard/tests', 'tests'], { cwd: REPO })
  .toString('utf8').split('\0').filter((f) => f.endsWith('.js'));

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** Field reads of a write's `rows` (not Array.prototype names) in one file's source. Pure over the source text. */
function rowsFieldReads(src) {
  const code = stripComments(src);
  const count = (re) => [...code.matchAll(re)].filter((m) => !(m[1] !== undefined && m[1] in Array.prototype)).length;
  return count(READ) + (DESTRUCTURED.test(code) ? count(BARE_READ) : 0);
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
  // Built from parts so the repo's require scanner does not read these sample lines as requires of this file.
  const req = (spec) => `const x = ${'req'}${'uire'}('${spec}');`;

  test('the pattern: a field read counts; array methods, an index and raw do not', () => {
    expect(rowsFieldReads('w.rows.canonical_id; w.rows.length; w.rows.map((r) => r.id); w.rows[0].id; w.raw.id')).toBe(1);
    expect(USES_DOUBLE.test(req('../quiz/teacher-quiz-menu/fake-db'))).toBe(true);
    expect(USES_DOUBLE.test(req('../helpers/table-double'))).toBe(true);
  });

  test('optional chaining, a quoted key and a destructured rows count as reads', () => {
    expect(rowsFieldReads('w.rows?.canonical_id;')).toBe(1);
    expect(rowsFieldReads("w.rows['canonical_id'];")).toBe(1);
    expect(rowsFieldReads('w.rows?.["canonical_id"];')).toBe(1);
    expect(rowsFieldReads('w.rows .canonical_id;')).toBe(1);
    expect(rowsFieldReads('const { rows } = w; expect(rows.canonical_id).toBe(1);')).toBe(1);
    expect(rowsFieldReads('const { table, rows } = w; rows?.["canonical_id"];')).toBe(1);
  });

  test('every Array.prototype name, an index and a comment do not count', () => {
    expect(rowsFieldReads('t.rows.push(1); t.rows.pop(); t.rows.findLast(Boolean); t.rows.at(-1); t.rows?.length;')).toBe(0);
    expect(rowsFieldReads('// w.rows.canonical_id\n/* w.rows.canonical_id */ w.rows[0].canonical_id;')).toBe(0);
    expect(rowsFieldReads('rows.canonical_id;')).toBe(0);
    expect(rowsFieldReads("const url = 'http://x/rows.canonical_id'; w.rows.length;")).toBe(0);
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
