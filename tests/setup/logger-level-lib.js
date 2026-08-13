/**
 * Shared scanner for the logger-level ratchet.
 *
 * `logToFile(message, data, level)` defaults `level` to `'info'`, which
 * `structured-logger.js` maps to `console.log` → Pino level `info`. A failure
 * logged that way is structurally invisible to any monitor filtering on
 * `@level:error`, no matter how loudly the message text says ❌. So: if a
 * message announces itself as a failure with ❌, the call must opt into
 * `'error'` (terminal) or `'warn'` (degraded but recovered).
 *
 * Extracted from `logger-level-consistency.test.js` so that the test AND the
 * allowlist generator (`gen-logger-allowlist.js`) share one implementation.
 * Previously the generator lived at `/tmp/gen-allowlist.js` — a path outside
 * the repo, so the only way to re-baseline was to reconstruct it from git
 * blame, and in practice nobody did.
 *
 * ## Why entries are keyed on file+snippet+occurrence, not file:line
 *
 * The original key was `file:line`. Line numbers move for reasons that have
 * nothing to do with logging — an import added, a function extracted above —
 * and every such move read as a brand-new violation AND left a stale entry
 * behind. On develop that was 224 "new" (148 of them merely moved) and 205
 * "stale": both assertions permanently red, so the gate was noise and 76
 * genuinely-new untagged callsites landed behind it unnoticed.
 *
 * Keying on the source line's text instead is stable across line moves. The
 * tradeoff, accepted deliberately: editing that line cosmetically (renaming a
 * variable in it) does read as new. That is both far rarer than a line shift
 * and arguably correct — the callsite changed, so re-check its severity.
 * `line` is still recorded in the allowlist, but purely so a human can find
 * the entry; it is never used for matching.
 */

const fs = require('fs');
const path = require('path');

/** Directories that never contain shippable runtime code. */
const SKIP_DIRS = new Set([
  'node_modules', '__mocks__', '__tests__', 'test', 'tests',
  'dist', 'build', 'coverage',
]);

/** A message that announces itself as a failure. */
const TRIGGER = /logToFile\s*\(\s*['"`]❌/g;

const QUOTES = new Set(['"', "'", '`']);

/**
 * Advance past a string literal that starts at `i` (which points at the quote).
 * Treats a template literal as opaque, so parens/braces inside `${...}` never
 * disturb the depth count.
 * @returns {number} index just past the closing quote
 */
function skipString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/**
 * Given the index of a `(`, return the index just past its matching `)`.
 * String-aware, so a paren inside a message literal cannot end the call early.
 * @returns {number} index past the closing paren, or -1 if unbalanced
 */
function findCallEnd(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (QUOTES.has(c)) { i = skipString(src, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/**
 * Does this call pass 'error' or 'warn' as its third positional argument?
 * @param {string} callSrc source of the call, from `logToFile` to its final `)`
 */
function hasSeverityArg(callSrc) {
  const openIdx = callSrc.indexOf('(');
  if (openIdx === -1) return false;
  let depth = 0;
  let commas = 0;
  let i = openIdx;
  while (i < callSrc.length) {
    const c = callSrc[i];
    if (QUOTES.has(c)) { i = skipString(callSrc, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return false; // call ended before a 3rd arg
    } else if (c === ',' && depth === 1) {
      commas += 1;
      if (commas === 2) {
        return /^\s*['"`](error|warn)['"`]/.test(callSrc.slice(i + 1));
      }
    }
    i += 1;
  }
  return false;
}

/** Recursively collect .js files, skipping vendor/test dirs. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

const normalizeSnippet = (s) => String(s ?? '').trim();

/**
 * Stable identity for a violation. Deliberately excludes `line`.
 * Legacy allowlist entries carry no `occurrence`; they mean the first one.
 */
function keyOf(entry) {
  return `${entry.file}|${normalizeSnippet(entry.snippet)}#${entry.occurrence ?? 0}`;
}

/**
 * Find every `logToFile('❌ …')` under `scanRoot` that does not pass an
 * explicit 'error'/'warn' level.
 *
 * @param {string} scanRoot directory to walk
 * @param {{relativeTo?: string}} [opts] base for reported paths (default scanRoot)
 * @returns {Array<{file: string, line: number, snippet: string, occurrence: number}>}
 */
function scanViolations(scanRoot, opts = {}) {
  const relativeTo = opts.relativeTo || scanRoot;
  const violations = [];

  for (const abs of walk(scanRoot)) {
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!src.includes('logToFile')) continue;

    const lines = src.split(/\r?\n/);
    const file = path.relative(relativeTo, abs).split(path.sep).join('/');
    // Per-file tally so duplicate identical callsites stay addressable.
    const seen = new Map();

    const re = new RegExp(TRIGGER.source, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      const openIdx = src.indexOf('(', m.index);
      const end = findCallEnd(src, openIdx);
      if (end === -1) continue; // unbalanced — can't judge, don't guess
      if (hasSeverityArg(src.slice(m.index, end))) continue;

      const line = src.slice(0, m.index).split('\n').length;
      const snippet = normalizeSnippet(lines[line - 1] || '').slice(0, 100);
      const occurrence = seen.get(snippet) ?? 0;
      seen.set(snippet, occurrence + 1);

      violations.push({ file, line, snippet, occurrence });
    }
  }

  violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file));
  return violations;
}

/**
 * Compare live violations against the grandfathered set.
 * @returns {{newOnes: Array, stale: Array}} `newOnes` must be empty (nothing
 *   new may be added); `stale` must be empty (fixed entries must be removed).
 */
function diffAgainstAllowlist(violations, allowlist) {
  const allowed = new Set(allowlist.map(keyOf));
  const live = new Set(violations.map(keyOf));
  return {
    newOnes: violations.filter((v) => !allowed.has(keyOf(v))),
    stale: allowlist.filter((a) => !live.has(keyOf(a))),
  };
}

module.exports = {
  scanViolations,
  keyOf,
  diffAgainstAllowlist,
  // exported for the generator + focused tests
  walk,
  findCallEnd,
  hasSeverityArg,
  SKIP_DIRS,
};
