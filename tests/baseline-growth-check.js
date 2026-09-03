#!/usr/bin/env node
/**
 * The baseline may only ever SHRINK.
 *
 * `tests/BASELINE.md` and `CLAUDE.md` both say so. Until this script existed, nothing
 * computed it — so a PR could add its own failures to `tests/baseline.snapshot.json`
 * and `npm test` would pass, printing CLEAN, because the snapshot it compares against
 * is the one the PR just edited. That is the same shape as the bug the gate itself was
 * built to fix: a rule written in prose that nothing checks.
 *
 * This compares the snapshot in the working tree against the snapshot on the base
 * branch and fails if it grew, at all three of the levels the gate compares.
 *
 * Usage:
 *   node tests/baseline-growth-check.js                  # vs origin/staging
 *   node tests/baseline-growth-check.js --base=origin/main
 *   BASELINE_BASE_REF=origin/main node tests/baseline-growth-check.js
 *
 * Shrinking is the goal, so a removal is reported and never fails. Re-recording a
 * LARGER baseline is a deliberate act: do it in its own commit, say why in the PR, and
 * pass --allow-growth here so the intent is recorded rather than inferred.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { snapshotGrowth } = require('./baseline-gate');

const REPO = path.resolve(__dirname, '..');
const SNAPSHOT_REL = 'tests/baseline.snapshot.json';

function baseRef(argv) {
  const flag = argv.find((a) => a.startsWith('--base='));
  if (flag) return flag.slice('--base='.length);
  return process.env.BASELINE_BASE_REF || 'origin/staging';
}

/** The snapshot as it exists on the base branch, or null if the ref is unreachable. */
function snapshotAtRef(ref) {
  try {
    const out = execFileSync('git', ['show', `${ref}:${SNAPSHOT_REL}`], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function list(label, items, fmt = (x) => x) {
  if (!items.length) return;
  console.log(`\n${label}`);
  for (const i of items) console.log(`  ${fmt(i)}`);
}

function main() {
  const argv = process.argv.slice(2);
  const ref = baseRef(argv);
  const allow = argv.includes('--allow-growth');

  const before = snapshotAtRef(ref);
  if (!before) {
    // Loud, but not fatal. A shallow clone or a brand-new branch point is an
    // infrastructure condition, and a secondary guard that breaks the build for one
    // gets deleted. CI checks out with fetch-depth: 0 so this path stays exceptional.
    console.error(`baseline-growth: cannot read ${SNAPSHOT_REL} at "${ref}" — skipping.`);
    console.error('  Fetch the base branch (CI uses fetch-depth: 0) or pass --base=<ref>.');
    return;
  }

  const after = JSON.parse(fs.readFileSync(path.join(REPO, SNAPSHOT_REL), 'utf8'));
  const g = snapshotGrowth(before, after);

  const beforeN = Object.keys(before).length;
  const afterN = Object.keys(after).length;
  const off = (s) => Object.values(s).reduce((n, v) => n + (v.offenders || []).length, 0);
  console.log(`baseline-growth: vs ${ref} — suites ${beforeN} -> ${afterN}, offenders ${off(before)} -> ${off(after)}`);

  list('Retired from the baseline (thank you):', g.removedSuites);

  if (!g.grew) {
    console.log('\nbaseline-growth: OK — the baseline did not grow.');
    return;
  }

  list('NEWLY ACCEPTED failing suites:', g.addedSuites);
  list('NEWLY ACCEPTED failing tests in already-accepted suites:', g.addedTests,
    (x) => `${x.suite}\n      ${x.tests.join('\n      ')}`);
  list('NEWLY ACCEPTED offenders in already-accepted suites:', g.addedOffenders,
    (x) => `${x.suite}\n      ${x.offenders.join('\n      ')}`);

  if (allow) {
    console.log('\nbaseline-growth: growth ALLOWED by --allow-growth. Say why in the PR.');
    return;
  }

  console.error('\nbaseline-growth: THE BASELINE GREW.');
  console.error('  The snapshot records failures we have agreed to tolerate for now. Adding to it');
  console.error('  converts your regression into permanently accepted debt, invisibly — which is');
  console.error('  exactly what this check exists to prevent.');
  console.error('');
  console.error('  Fix the failure, or — if the baseline genuinely must move — re-record it in its');
  console.error('  own commit, explain why in the PR, and re-run with --allow-growth.');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { baseRef, snapshotAtRef };
