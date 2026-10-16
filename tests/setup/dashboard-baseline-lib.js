/**
 * The dashboard Jest run's known failures, so a folder count reads "N new" mechanically.
 *
 * The full dashboard run (`cd dashboard && npx jest`) fails the same tests in the same four suites on every base:
 * dashboard-baseline.json names each suite (path relative to dashboard/), its failing test names ('*': the whole
 * suite, for the one that calls a live network service), and why. Given a
 * `jest --json` output, `newFailures` returns the failures outside that list. A baseline test that now passes is
 * reported as `FIXED:` (a warning: drop it from the baseline), never as a failure.
 *
 *   node tests/setup/dashboard-baseline-lib.js <jest --json output file>
 * prints the counts and "N new", and exits 1 when N > 0.
 */
const fs = require('fs');
const path = require('path');

const BASELINE = require('./dashboard-baseline.json');

const rot13 = (s) => String(s).replace(/[a-z]/gi, (c) => {
  const b = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
});
/** A baseline test name; one behind `rot13:` is stored encoded (it names a private tracker id). */
const nameOf = (n) => (String(n).startsWith('rot13:') ? rot13(String(n).slice(6)) : String(n));

/** A suite path as the baseline keys it: relative to dashboard/, forward slashes. */
function suiteKey(file) {
  const f = String(file).split(path.sep).join('/');
  const at = f.lastIndexOf('/dashboard/');
  return at >= 0 ? f.slice(at + '/dashboard/'.length) : f.replace(/^dashboard\//, '');
}

/** Every test in a jest --json result: [{ suite, name, status }]; a suite that failed to run is one 'suite' entry. */
function testsOf(result) {
  const out = [];
  for (const s of (result && result.testResults) || []) {
    const suite = suiteKey(s.name || s.testFilePath || '');
    const asserts = s.assertionResults || s.testResults || [];
    if (!asserts.length && s.status === 'failed') out.push({ suite, name: '(suite failed to run)', status: 'failed' });
    for (const a of asserts) out.push({ suite, name: a.fullName || [...(a.ancestorTitles || []), a.title].join(' '), status: a.status });
  }
  return out;
}

/** { total, failed, baseline, new: [...], fixed: [...] } for one jest --json result against the baseline. */
function newFailures(result, baseline = BASELINE) {
  const known = new Map(Object.entries(baseline.suites || {}).map(([suite, e]) => [suite, new Set((e.tests || []).map(nameOf))]));
  const isKnown = (t) => known.has(t.suite) && (known.get(t.suite).has(t.name) || known.get(t.suite).has('*'));
  const all = testsOf(result);
  const failed = all.filter((t) => t.status === 'failed');
  const fresh = failed.filter((t) => !isKnown(t)).map((t) => `${t.suite} › ${t.name}`);
  const passedKnown = all.filter((t) => t.status === 'passed' && isKnown(t) && !known.get(t.suite).has('*')).map((t) => `${t.suite} › ${t.name}`);
  return { total: all.length, failed: failed.length, baseline: failed.length - fresh.length, new: fresh, fixed: passedKnown };
}

/** The one-line summary: "<passed>/<total> passed; <failed> failed: <baseline> baseline, N new". */
function summary(v) {
  return `${v.total - v.failed}/${v.total} passed; ${v.failed} failed: ${v.baseline} baseline, ${v.new.length} new`;
}

module.exports = { BASELINE, suiteKey, testsOf, newFailures, summary };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { process.stderr.write('usage: node tests/setup/dashboard-baseline-lib.js <jest --json output>\n'); process.exit(2); }
  const v = newFailures(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const t of v.new) process.stdout.write(`NEW: ${t}\n`);
  for (const t of v.fixed) process.stdout.write(`FIXED: ${t} (drop it from tests/setup/dashboard-baseline.json)\n`);
  process.stdout.write(`${summary(v)}\n`);
  process.exit(v.new.length ? 1 : 0);
}
