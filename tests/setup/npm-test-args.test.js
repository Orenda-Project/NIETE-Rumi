/**
 * Nothing may invoke `npm test` with arguments.
 *
 * `npm test` is the baseline gate. It runs the WHOLE suite and compares the result
 * against `tests/baseline.snapshot.json`, so it cannot honour a path or pattern
 * filter — a filtered run would report every suite it did not run as "fixed", and
 * `npm test -- tests/nothing/` would exit 0 having tested nothing.
 *
 * The gate now refuses an argument it cannot honour (see `parseCliArgs`), so a stale
 * call site fails loudly at runtime. This guard catches it earlier — at review time,
 * in the diff — because the runtime failure only surfaces when that particular job
 * happens to run, and one of the call sites this was written for is a release
 * workflow that only fires on a tag.
 *
 * The incident: when `npm test` became the gate, eleven call sites were still passing
 * filters — three Android workflows, four docs, two test-file headers, and the
 * qa-testing skill (which is loaded BY AGENTS, so it actively taught the wrong
 * command). Every one of them silently went from testing a slice to testing
 * everything: `npm test -- tests/portal/` ran 4,784 tests instead of 289, stayed
 * green, and no longer did what it said.
 *
 * Filtered runs belong on `npm run test:raw`, which is plain jest and takes any jest
 * argument.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'temp', 'logs',
]);

/** Files that may legitimately contain the string, because they EXPLAIN the rule. */
const ALLOWED = new Set([
  'tests/BASELINE.md',
  'tests/baseline-gate.js',
  'tests/setup/baseline-gate.test.js',
  'tests/setup/npm-test-args.test.js',
]);

const SCAN_EXT = new Set([
  '.js', '.ts', '.json', '.md', '.yml', '.yaml', '.sh', '.txt',
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.claude') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

describe('no call site passes arguments to `npm test`', () => {
  it('every filtered run uses `npm run test:raw` instead', () => {
    // `npm test --` and `npm test -- <anything>`; also catches `npm test --flag`.
    const re = /npm\s+test\s+--/;
    const offenders = [];

    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      text.split('\n').forEach((line, i) => {
        if (re.test(line)) offenders.push(`${rel}:${i + 1} — ${line.trim().slice(0, 100)}`);
      });
    }

    expect(offenders.sort()).toEqual([]);
  });
});
