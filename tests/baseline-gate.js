#!/usr/bin/env node
/**
 * The baseline gate — computes what `tests/BASELINE.md` only described.
 *
 * This repo's suite is not green and has not been for a while, so the merge rule is
 * "no NEW failure" rather than "all green". That rule lived in prose, which gave it
 * exactly one bit of resolution: the suite is red, so a *new* violation inside an
 * already-red suite changed nothing observable and passed review unnoticed.
 *
 * That is not hypothetical. `source-hygiene` was already failing for unrelated reasons
 * when internal ticket references were added to public source — precisely what that
 * guard exists to prevent. Suite result: red before, red after. Offender list: 683
 * entries before, 686 after. Only the third number was a regression.
 *
 * So this gate compares at three levels of resolution:
 *
 *   1. SUITE    — a suite that was passing now fails
 *   2. TEST     — a suite already failing now fails additional tests
 *   3. OFFENDER — a suite already failing reports entries it did not report before
 *
 * Level 3 is the one that matters for the conformance guards in tests/setup/, because
 * those assert `expect(offenders).toEqual([])` — the whole finding lives in the diff,
 * not in the pass/fail.
 *
 * Improvements are never regressions: fewer offenders, fewer failing tests, or a suite
 * going green are all reported and all clean. A gate that fires on progress gets muted.
 *
 * Usage:
 *   node tests/baseline-gate.js              # compare this run against the snapshot
 *   node tests/baseline-gate.js --update     # re-record the snapshot (review the diff!)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(REPO, 'tests', 'baseline.snapshot.json');
const BASELINE_MD = path.join(REPO, 'tests', 'BASELINE.md');

/** Jest writes colour codes into failureMessages even under --json. */
// The ESC byte is written as an explicit \x1b escape, NOT as a literal control
// character. A literal ESC in source is invisible in every diff and review, and any
// editor or lint autofix that normalises it silently turns this into a no-op — after
// which every coloured diff line fails the `^\s*\+` anchor and offenders are dropped
// WITHOUT the gate reporting anything. `extractOffenders` has tests pinning both
// coloured cases precisely so that regression cannot land quietly.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Pull the ADDED entries out of a jest array diff.
 *
 * Only `+` lines count. A `-` line means the baseline had something this run does not,
 * which is an improvement. Returns a sorted set so jest's print order — which is not
 * stable across runs for a Set-derived array — cannot produce a phantom regression.
 */
function extractOffenders(message) {
  if (!message) return [];
  const found = new Set();
  const text = stripAnsi(message);   // hoisted: /g keeps lastIndex across iterations
  const re = /^\s*\+\s+"([^"]+)"/gm;
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found].sort();
}

/** Absolute paths differ per checkout; the snapshot has to be portable. */
function relSuite(name) {
  const i = name.lastIndexOf('/tests/');
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * Collapse a `jest --json` report into { suite: { failing, offenders } }.
 * Passing suites are omitted — the snapshot records what is broken, so a suite going
 * green shrinks the file rather than leaving a stale "expected to fail" entry behind.
 */
function summariseRun(report) {
  const out = {};
  for (const suite of report.testResults || []) {
    const failing = [];
    const offenders = new Set();
    for (const a of suite.assertionResults || []) {
      if (a.status !== 'failed') continue;
      failing.push(a.fullName);
      for (const msg of a.failureMessages || []) {
        for (const o of extractOffenders(msg)) offenders.add(o);
      }
    }
    // A suite can fail to even load, in which case there are no assertionResults but
    // the suite still counts as broken.
    const crashed = failing.length === 0 && suite.status === 'failed';
    if (failing.length || crashed) {
      out[relSuite(suite.name)] = {
        failing: failing.sort(),
        offenders: [...offenders].sort(),
      };
    }
  }
  return out;
}

const missing = (a, b) => a.filter((x) => !b.includes(x));

/**
 * Never record a documented-flaky suite as baseline.
 *
 * Without this, running --update at an unlucky moment bakes a flaky suite in as an
 * accepted failure — permanently excusing it, and making every later run where it
 * PASSES show up as "fixed" noise. Returns a new object; callers keep their input.
 */
function pruneFlaky(snapshot, flaky = []) {
  const out = {};
  for (const [suite, v] of Object.entries(snapshot)) {
    if (!flaky.includes(suite)) out[suite] = v;
  }
  return out;
}

/**
 * Sort suite keys before writing.
 *
 * Jest reports suites in a different order every run, so an unsorted snapshot changes
 * on every --update even when nothing is actually different. That matters more than it
 * sounds: "review the diff before committing" is the ONLY safeguard against --update
 * quietly swallowing a regression, and a diff that rewrites all 24 entries every time
 * is a diff nobody reads. Values are already sorted by summariseRun.
 */
function canonicalise(snapshot) {
  const out = {};
  for (const suite of Object.keys(snapshot).sort()) out[suite] = snapshot[suite];
  return out;
}

/**
 * Compare a run against the baseline snapshot.
 *
 * `opts.flaky` names suites BASELINE.md documents as non-deterministic. A failure there
 * is inconclusive by policy, so it is surfaced separately and does not fail the gate —
 * otherwise the gate is red at random and stops being read.
 */
function compareSnapshots(now, base, opts = {}) {
  const flaky = opts.flaky || [];
  const r = {
    newSuites: [],
    newTests: [],
    newOffenders: [],
    flakyFailures: [],
    fixedSuites: [],
    fixedTests: [],
    fixedOffenders: [],
    clean: true,
  };

  for (const suite of Object.keys(now)) {
    if (flaky.includes(suite)) {
      r.flakyFailures.push(suite);
      continue;
    }
    if (!(suite in base)) {
      r.newSuites.push(suite);
      continue;
    }
    const newT = missing(now[suite].failing, base[suite].failing);
    const gotT = missing(base[suite].failing, now[suite].failing);
    const newO = missing(now[suite].offenders, base[suite].offenders);
    const gotO = missing(base[suite].offenders, now[suite].offenders);
    if (newT.length) r.newTests.push({ suite, tests: newT });
    if (gotT.length) r.fixedTests.push({ suite, tests: gotT });
    if (newO.length) r.newOffenders.push({ suite, offenders: newO });
    if (gotO.length) r.fixedOffenders.push({ suite, offenders: gotO });
  }

  for (const suite of Object.keys(base)) {
    if (!(suite in now) && !flaky.includes(suite)) r.fixedSuites.push(suite);
  }

  r.newSuites.sort();
  r.fixedSuites.sort();
  r.clean = !r.newSuites.length && !r.newTests.length && !r.newOffenders.length;
  return r;
}

/**
 * Read the flaky list straight out of BASELINE.md rather than duplicating it.
 * Two sources of truth for "which suites are flaky" is one too many.
 */
function flakyFromBaselineDoc(md = BASELINE_MD) {
  if (!fs.existsSync(md)) return [];
  const text = fs.readFileSync(md, 'utf8');
  const section = text.split(/^###\s+Flaky/m)[1];
  if (!section) return [];
  const block = section.match(/```([\s\S]*?)```/);
  if (!block) return [];
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.test.js'));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function runJest() {
  const out = path.join(require('os').tmpdir(), `niete-jest-${process.pid}.json`);
  try {
    execFileSync(process.execPath, [
      path.join(REPO, 'tests', 'run.js'), '--json', `--outputFile=${out}`,
    ], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    // Non-zero exit is expected — the suite is red by design. The JSON is what matters.
  }
  if (!fs.existsSync(out)) {
    console.error('baseline-gate: jest produced no JSON report. Run `npm test` and fix that first.');
    process.exit(2);
  }
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  return report;
}

function list(label, items, fmt = (x) => x) {
  if (!items.length) return;
  console.log(`\n${label}`);
  for (const i of items) console.log(`  ${fmt(i)}`);
}

function main() {
  const update = process.argv.includes('--update');
  const flaky = flakyFromBaselineDoc();
  const now = summariseRun(runJest());

  if (update) {
    const dropped = Object.keys(now).filter((s) => flaky.includes(s));
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(canonicalise(pruneFlaky(now, flaky)), null, 2)}\n`);
    if (dropped.length) {
      console.log(`baseline-gate: excluded ${dropped.length} flaky suite(s) from the snapshot:`);
      for (const d of dropped) console.log(`  ${d}`);
    }
    const kept = pruneFlaky(now, flaky);
    const suites = Object.keys(kept).length;
    const offenders = Object.values(kept).reduce((n, s) => n + s.offenders.length, 0);
    console.log(`baseline-gate: snapshot written — ${suites} failing suites, ${offenders} offenders.`);
    console.log(`  ${path.relative(REPO, SNAPSHOT)}`);
    console.log('  Review the diff before committing: an accidental --update hides every regression it swallowed.');
    return;
  }

  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`baseline-gate: no snapshot at ${path.relative(REPO, SNAPSHOT)}.`);
    console.error('  Record one from a known-good tree: node tests/baseline-gate.js --update');
    process.exit(2);
  }

  const base = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const r = compareSnapshots(now, base, { flaky });

  list('NEW failing suites (were green):', r.newSuites);
  list('NEW failing tests in already-red suites:', r.newTests,
    (x) => `${x.suite}\n      ${x.tests.join('\n      ')}`);
  list('NEW offenders in already-red suites:', r.newOffenders,
    (x) => `${x.suite}\n      ${x.offenders.join('\n      ')}`);
  list('Fixed suites (now green):', r.fixedSuites);
  list('Fixed offenders:', r.fixedOffenders,
    (x) => `${x.suite} (-${x.offenders.length})`);
  list('Flaky suites failing — inconclusive, not gating:', r.flakyFailures);

  if (r.clean) {
    console.log('\nbaseline-gate: CLEAN — no new failing suite, test, or offender.');
    return;
  }
  console.error('\nbaseline-gate: REGRESSION — the items above are new since the snapshot.');
  console.error('  A red suite is not a licence to add to it. Fix, or justify in the PR.');
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  extractOffenders,
  pruneFlaky,
  canonicalise,
  summariseRun,
  compareSnapshots,
  flakyFromBaselineDoc,
  relSuite,
};
