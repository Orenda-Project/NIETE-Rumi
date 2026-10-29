/**
 * Tracked files carry no phone number and no machine path (bd-5gyspy.3).
 *
 * The repo is public. The QA ledger (.claude/qa/ledgers/runs.jsonl) carried the live driver's phone and the
 * home-directory path of the worktree each run came from, in hundreds of rows; no check looked outside the
 * test folders (phone-shaped-fixtures covers bot/tests and dashboard/tests). This one scans every tracked file
 * that is not a test or a fixture for:
 *   - a Pakistani mobile, `(?:\+?92|0)3\d{9}` bounded by non-digits (phone-shaped-fixtures-lib.js's looser rule also
 *     hits epoch-ms timestamps like 17921…, which this scan would then list as phones);
 *   - a home directory (`/Users/` and a user name).
 * Files that held either when this landed are listed, with their counts, in tracked-files-pii.allowlist.json.
 * The list only shrinks (ratchet-verdict-lib.js). The QA ledger may never be on it.
 *
 * CLI (the pre-push hook): `node tests/setup/tracked-files-pii-lib.js --check` → exit 1 on a new or higher count.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { countVerdict } = require('./ratchet-verdict-lib');

const LEDGER = '.claude/qa/ledgers/runs.jsonl';
const ALLOWLIST_FILE = 'tracked-files-pii.allowlist.json';
const PHONE_RX = /(?<!\d)(?:\+?92|0)3\d{9}(?!\d)/g;
const HOME_RX = /\/Users\/[^/\s"'`]+/g;

/** Test and fixture files are the phone-shaped-fixtures ratchet's (and their own) business, not this one's. */
function isTestPath(p) {
  return /(^|\/)(tests|fixtures|__tests__|__fixtures__|__mocks__)\//.test(p)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)
    || /(^|\/)test_[^/]+\.(py|[cm]?js)$/.test(p)
    || /\.test\.(sh|py)$/.test(p);
}

/** A git sha or content hash: its digits can spell a phone by chance (kg/summaries "sha" fields, bd-v0toag.129.1). */
const HASH_RX = /[0-9a-f]{32,}/gi;

/** Phone-shaped strings + home directories in one text. */
function countPii(text) {
  const s = String(text || '').replace(HASH_RX, '');
  return (s.match(PHONE_RX) || []).length + (s.match(HOME_RX) || []).length;
}

function trackedFiles(repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0').filter(Boolean);
}

/** { 'repo/relative/path': hits } for tracked, non-test text files with ≥ 1 hit. */
function scanTracked(repoRoot, files = trackedFiles(repoRoot)) {
  const hits = {};
  for (const rel of files) {
    if (isTestPath(rel)) continue;
    let buf;
    try {
      buf = fs.readFileSync(path.join(repoRoot, rel));
    } catch (_) {
      continue;
    }
    if (buf.length > 20 << 20 || buf.includes(0)) continue; // binary or huge
    const n = countPii(buf.toString('utf8'));
    if (n > 0) hits[rel] = n;
  }
  return hits;
}

function checkTracked(hits, allowlist, exists = null) {
  const verdict = countVerdict(hits, allowlist, {
    what: 'phone number(s) or home-directory path(s). Mask the phone (92•••••1234) and make the path repo-relative',
    list: ALLOWLIST_FILE,
    exists,
  });
  if (Object.prototype.hasOwnProperty.call(allowlist, LEDGER)) {
    verdict.failures.push(`LEDGER: ${LEDGER} may not be on ${ALLOWLIST_FILE}. Run python3 scripts/qa/mask-ledger.py.`);
  }
  return verdict;
}

module.exports = { LEDGER, ALLOWLIST_FILE, isTestPath, countPii, scanTracked, checkTracked };

if (require.main === module && process.argv.includes('--check')) {
  const root = path.resolve(__dirname, '../..');
  const allow = JSON.parse(fs.readFileSync(path.join(__dirname, ALLOWLIST_FILE), 'utf8'));
  const { failures } = checkTracked(scanTracked(root), allow);
  for (const f of failures) console.error(`pii: ${f}`);
  process.exit(failures.length ? 1 : 0);
}
