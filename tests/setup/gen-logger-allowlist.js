#!/usr/bin/env node
/**
 * Regenerate (or inspect) the logger-level ratchet allowlist.
 *
 * This used to live at `/tmp/gen-allowlist.js`, i.e. nowhere. The test told you
 * to run a file that did not exist in the repo, so re-baselining meant digging
 * the script out of git blame, and in practice the allowlist just rotted until
 * both assertions were permanently red.
 *
 * Usage, from the repo root:
 *   node tests/setup/gen-logger-allowlist.js            # show the drift, write nothing
 *   node tests/setup/gen-logger-allowlist.js --write    # re-baseline the allowlist
 *
 * IMPORTANT — `--write` grandfathers every failure currently logged at `info`.
 * That is correct when adopting or repairing the ratchet, and wrong as a way to
 * silence a violation you just introduced: for a new callsite, add the severity
 * argument instead. The ratchet only earns its keep if this list shrinks.
 *
 * ## Resolving an allowlist merge conflict: REGENERATE, never merge
 *
 * The allowlist is a DERIVED artifact — it describes the callsites in one
 * branch's tree. Two diverged branches therefore legitimately hold different
 * allowlists (at the time of writing: 389 entries on `main`, 366 on `develop`),
 * and any cherry-pick or promotion that touches it will conflict.
 *
 * Do NOT resolve such a conflict by picking a side or hand-merging the hunks.
 * Either side is simply the wrong description of the tree you are landing on,
 * and the result silently breaks the gate in one of two ways: entries for
 * callsites that don't exist here (the stale-entry assertion fires), or missing
 * entries for ones that do (the no-new assertion fires). Instead:
 *
 *   git checkout --ours tests/setup/logger-level-consistency.allowlist.json
 *   node tests/setup/gen-logger-allowlist.js --write
 *   git add tests/setup/logger-level-consistency.allowlist.json
 *
 * Then read the resulting count. If it jumped, the branch you are landing
 * carries new untagged callsites — fix those rather than grandfathering them.
 */

const fs = require('fs');
const path = require('path');

const { scanViolations, diffAgainstAllowlist } = require('./logger-level-lib');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCAN_ROOT = path.join(REPO_ROOT, 'bot');
const ALLOWLIST_PATH = path.join(__dirname, 'logger-level-consistency.allowlist.json');

function readAllowlist() {
  try {
    return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function main() {
  const write = process.argv.includes('--write');

  if (!fs.existsSync(SCAN_ROOT)) {
    console.error(`ERROR: no bot/ directory at ${SCAN_ROOT} — run this from the repo root.`);
    process.exit(2);
  }

  const live = scanViolations(SCAN_ROOT, { relativeTo: REPO_ROOT });
  const current = readAllowlist();
  const { newOnes, stale } = diffAgainstAllowlist(live, current);

  console.log(`live ❌-without-level callsites : ${live.length}`);
  console.log(`allowlist entries              : ${current.length}`);
  console.log(`not yet allowlisted ("new")    : ${newOnes.length}`);
  console.log(`allowlisted but gone ("stale") : ${stale.length}`);

  if (!write) {
    if (newOnes.length) {
      console.log('\nNot yet allowlisted — add a severity arg, or re-baseline with --write:');
      for (const v of newOnes) console.log(`  ${v.file}:${v.line}  ${v.snippet}`);
    }
    if (stale.length) {
      console.log('\nFixed or removed — re-baseline with --write to drop these:');
      for (const a of stale) console.log(`  ${a.file}:${a.line ?? '?'}  ${a.snippet}`);
    }
    if (!newOnes.length && !stale.length) console.log('\nAllowlist is in sync. Nothing to do.');
    console.log('\n(no files written — pass --write to re-baseline)');
    return;
  }

  fs.writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(live, null, 2)}\n`);
  console.log(`\nwrote ${live.length} entries → ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
  if (live.length) {
    console.log('These are now grandfathered. Drive the number DOWN — never up.');
  }
}

main();
