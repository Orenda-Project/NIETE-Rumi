/**
 * Phone-shaped fixtures: scanning and the shrink-only allowlist check.
 *
 * The public repo carries no phone-shaped digit strings. A synthetic test
 * fixture uses the letters form (`+92300FIXTURE<n>`), or, where the code under
 * test needs digits, builds them at runtime from parts so no 11+ digit literal
 * sits in a file.
 *
 * Pure functions, shared by `phone-shaped-fixtures.test.js` (the ratchet over
 * the tree) and exercised on in-memory strings by the same test file.
 */

const fs = require('fs');
const path = require('path');

/** The banned shape: a 92-prefixed run of 11+ digits (optional +), or an 11-digit 03… local number. */
const PHONE_SHAPED_SOURCE = String.raw`(\+?92\d{9,}|\b03\d{9}\b)`;

function phoneShapedRx() {
  return new RegExp(PHONE_SHAPED_SOURCE, 'g');
}

/** The phone-shaped strings in one text (in order). */
function findPhoneShaped(text) {
  return String(text || '').match(phoneShapedRx()) || [];
}

/** How many phone-shaped strings one text holds. */
function countPhoneShaped(text) {
  return findPhoneShaped(text).length;
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/**
 * Scan every file under `roots` (absolute dirs) → { 'repo/relative/path': hitCount } for files with ≥ 1 hit.
 * Paths use forward slashes, relative to `relativeTo`.
 */
function scanTree(roots, { relativeTo }) {
  const hits = {};
  for (const root of roots) {
    for (const file of walk(root, [])) {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch (_) {
        continue;
      }
      const n = countPhoneShaped(text);
      if (n > 0) hits[path.relative(relativeTo, file).split(path.sep).join('/')] = n;
    }
  }
  return hits;
}

/**
 * Compare live hits against the allowlist ({ path: count }; the tree check passes directories). Shrink-only:
 *   - a hit in a file not on the list fails;
 *   - a listed file whose count went up fails;
 *   - a listed file whose count went down (or to 0) fails until the entry is lowered or removed.
 * → array of human-readable problems ([] = clean).
 */
function checkAgainstAllowlist(hits, allowlist) {
  const problems = [];
  const files = new Set([...Object.keys(hits), ...Object.keys(allowlist)]);
  for (const file of [...files].sort()) {
    const now = hits[file] || 0;
    const allowed = Object.prototype.hasOwnProperty.call(allowlist, file) ? allowlist[file] : null;
    if (allowed === null) {
      problems.push(`NEW: ${file} has ${now} phone-shaped string(s). Use the letters form '+92300FIXTURE<n>', or build digits at runtime from parts.`);
    } else if (now > allowed) {
      problems.push(`UP: ${file} has ${now} phone-shaped string(s), the allowlist allows ${allowed}. Do not add new ones.`);
    } else if (now < allowed) {
      problems.push(now === 0
        ? `CLEAN: ${file} has no phone-shaped strings now. Remove its entry from phone-shaped-fixtures.allowlist.json.`
        : `DOWN: ${file} has ${now} phone-shaped string(s), the allowlist says ${allowed}. Lower its entry in phone-shaped-fixtures.allowlist.json to ${now}.`);
    }
  }
  return problems;
}

/** Per-file hits summed per directory ({ 'bot/tests/calls': 59 }): the allowlist's key, so it names no test file. */
function byDirectory(hits) {
  const out = {};
  for (const [file, n] of Object.entries(hits)) {
    const dir = file.split('/').slice(0, -1).join('/');
    out[dir] = (out[dir] || 0) + n;
  }
  return out;
}

module.exports = { PHONE_SHAPED_SOURCE, phoneShapedRx, findPhoneShaped, countPhoneShaped, scanTree, checkAgainstAllowlist, byDirectory };
