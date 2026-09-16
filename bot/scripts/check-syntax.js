#!/usr/bin/env node
'use strict';
/**
 * bd-wpx18 — parse every tracked JS file before it can reach a service.
 *
 * WHY THIS EXISTS
 * ---------------
 * PR #1008 (de980467) merged a stray `}` into bot/whatsapp-bot.js. The file did
 * not PARSE. Railway's BUILD still succeeded — a build installs dependencies, it
 * never loads the entry file — so the break only surfaced when the container
 * started, exited, and failed its healthcheck 11/11 times. Railway then kept the
 * previous deployment alive, which is why staging's bot served a stale build all
 * night while its sqs-workers happily took the new code. Nothing between "commit"
 * and "container exits" had ever asked whether the entry file was valid syntax.
 *
 * This is the cheapest possible check for that class: parse-only, no imports, no
 * side effects, no environment, no network, no database. It cannot be satisfied
 * by a passing unit test (a test only loads the modules it touches) and it cannot
 * be skipped by SKIP_QA=1, because it runs in CI on the pull request rather than
 * in a local pre-push hook.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * A parse check is not a load check: it cannot see a bad `require` path, a
 * missing export, or a ReferenceError on a branch nobody ran. It catches exactly
 * one thing — a file that node cannot compile — which is precisely the failure
 * that took staging down and precisely the failure no other gate covered.
 *
 * USAGE
 *   node bot/scripts/check-syntax.js                  # every tracked .js under bot/
 *   node bot/scripts/check-syntax.js --changed <ref>  # files changed vs <ref>, plus
 *                                                     # the three service entry points
 *   node bot/scripts/check-syntax.js --files a.js b.js
 *
 * Exits non-zero on the FIRST file that fails to parse.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * The three files a Railway service actually executes. A `--changed` run always
 * includes them even when the diff did not touch them: an entry point can be
 * broken by a change to nothing but itself, and these are the files whose parse
 * failure costs a deployment rather than a test.
 */
const ENTRY_POINTS = [
  'bot/whatsapp-bot.js',
  'bot/workers/sqs-worker.js',
  'bot/workers/stale-session.worker.js',
];

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/** Every tracked .js under bot/. Tracked only — an untracked scratch file in
 *  somebody's worktree must never be able to fail CI. */
function trackedBotFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'bot/*.js', 'bot/**/*.js'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/** Files changed against a ref (merge-base), restricted to .js under bot/, plus
 *  the entry points. Deleted files are dropped — there is nothing to parse. */
function changedBotFiles(root, ref) {
  let base = ref;
  try {
    base = execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: root, encoding: 'utf8' }).trim() || ref;
  } catch (_) { /* ref may be a bare SHA with no common ancestor; diff against it directly */ }
  const out = execFileSync('git', ['diff', '--name-only', '-z', '--diff-filter=ACMRT', base, 'HEAD'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const changed = out.split('\0').filter(Boolean)
    .filter((f) => f.startsWith('bot/') && f.endsWith('.js'));
  const set = new Set(changed);
  for (const e of ENTRY_POINTS) set.add(e);
  return [...set].filter((f) => fs.existsSync(path.join(root, f)));
}

/**
 * Parse one file the way node itself does for a CommonJS module: compile the
 * source wrapped in the module function. Compiling never executes the body, so
 * this is safe on any file and needs no environment.
 *
 * The wrapper's opening text carries no newline, so reported line numbers match
 * the real file. A shebang is blanked rather than removed, for the same reason.
 *
 * @returns {null | { line: number|null, message: string }}
 */
function parseFile(absPath) {
  let src = fs.readFileSync(absPath, 'utf8');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);            // BOM
  if (src.startsWith('#!')) src = src.replace(/^#![^\n]*/, '');     // shebang, newline kept

  const wrapped = '(function (exports, require, module, __filename, __dirname) {' + src + '\n});';
  try {
    new vm.Script(wrapped, { filename: absPath, displayErrors: true });
    return null;
  } catch (err) {
    // v8 reports the offending line in the stack's first frame: "<path>:<line>".
    let line = null;
    const m = new RegExp(`${absPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(err.stack || '');
    if (m) line = Number(m[1]);
    return { line, message: err.message };
  }
}

function main(argv) {
  const root = repoRoot();
  let files;
  let scope;

  const changedAt = argv.indexOf('--changed');
  const filesAt = argv.indexOf('--files');
  if (changedAt !== -1) {
    const ref = argv[changedAt + 1];
    if (!ref) { console.error('check-syntax: --changed needs a git ref'); return 2; }
    files = changedBotFiles(root, ref);
    scope = `changed vs ${ref} + ${ENTRY_POINTS.length} entry points`;
  } else if (filesAt !== -1) {
    files = argv.slice(filesAt + 1);
    scope = 'explicit file list';
  } else {
    files = trackedBotFiles(root);
    scope = 'all tracked .js under bot/';
  }

  if (files.length === 0) {
    console.log('check-syntax: nothing to check (%s)', scope);
    return 0;
  }

  const started = Date.now();
  for (const rel of files) {
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    const bad = parseFile(abs);
    if (bad) {
      // Fail on the FIRST failure: a file that cannot parse is a stop-the-line
      // event, and a wall of subsequent noise buries it.
      console.error('');
      console.error('✖ SYNTAX ERROR — this file cannot be parsed by node:');
      console.error('    %s%s', rel, bad.line ? `:${bad.line}` : '');
      console.error('    %s', bad.message);
      console.error('');
      console.error('  A build can succeed and a unit suite can pass with this in the tree.');
      console.error('  The service will exit at startup and the platform will keep serving');
      console.error('  the PREVIOUS deployment, so the break looks like "nothing happened".');
      console.error('  Reproduce locally with:  node --check %s', rel);
      console.error('');
      return 1;
    }
  }

  console.log('check-syntax: %d file(s) parsed cleanly in %dms (%s)',
    files.length, Date.now() - started, scope);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { parseFile, trackedBotFiles, changedBotFiles, ENTRY_POINTS, main };
