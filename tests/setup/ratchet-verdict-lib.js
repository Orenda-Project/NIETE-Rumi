/**
 * The verdict of a shrink-only allowlist gate, as { failures, warnings }.
 *
 * A ratchet allowlist records the debt a gate found when it landed. The list shrinks on the branch that owns it
 * (a cleanup commit lowers or removes the entry); on any other branch the tree may hold LESS debt than the list
 * (a fix landed, a file is not there yet), and that is never a reason to fail. So:
 *   - FAIL: a new offender (a key not on the list), or a count ABOVE its entry;
 *   - WARN and pass: a count BELOW its entry (`DOWN:`/`CLEAN:`), or a listed path that is not in the tree (`GONE:`).
 * A gate prints each warning with console.warn and asserts `failures` is empty.
 *
 * Pure functions; the gates pass in what they scanned and how to tell whether a listed path is in the tree.
 */

/**
 * Counts per key ({ 'bot/tests/calls': 3 }) against an allowlist of the same shape.
 *   what   — the offender, plural noun phrase, for the messages ("phone-shaped string(s)")
 *   list   — the allowlist file name, for the messages
 *   exists — optional (key) => boolean: false makes a listed key with no hits a `GONE:` line instead of `CLEAN:`
 */
function countVerdict(hits, allow, { what = 'hit(s)', list = 'the allowlist', exists = null } = {}) {
  const failures = [];
  const warnings = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(allow, k);
  for (const key of [...new Set([...Object.keys(hits), ...Object.keys(allow)])].sort()) {
    const now = hits[key] || 0;
    if (!has(key)) {
      if (now > 0) failures.push(`NEW: ${key} has ${now} ${what}.`);
      continue;
    }
    const ok = allow[key];
    if (now > ok) failures.push(`UP: ${key} has ${now} ${what}, ${list} allows ${ok}.`);
    else if (now < ok) {
      if (now === 0 && exists && !exists(key)) warnings.push(`GONE: ${key} is not in this tree. Remove its entry from ${list}.`);
      else if (now === 0) warnings.push(`CLEAN: ${key} has none now. Remove its entry from ${list}.`);
      else warnings.push(`DOWN: ${key} has ${now}, ${list} says ${ok}. Lower it to ${now}.`);
    }
  }
  return { failures, warnings };
}

/**
 * Found items against a listed set.
 *   gone — optional (item) => boolean: true makes a listed item no longer found a `GONE:` line instead of `CLEAN:`
 */
function listVerdict(found, allowed, { what = 'is new', list = 'the allowlist', gone = null } = {}) {
  const f = new Set(found);
  const a = new Set(allowed);
  const failures = [];
  const warnings = [];
  for (const x of [...f].sort()) if (!a.has(x)) failures.push(`NEW: ${x} ${what}.`);
  for (const x of [...a].sort()) {
    if (f.has(x)) continue;
    if (gone && gone(x)) warnings.push(`GONE: ${x} names a file not in this tree. Remove it from ${list}.`);
    else warnings.push(`CLEAN: ${x} is fixed. Remove it from ${list}.`);
  }
  return { failures, warnings };
}

/** Print a verdict's warnings (console.warn) and return its failures, for `expect(report(v)).toEqual([])`. */
function report(v) {
  for (const w of v.warnings) console.warn(w);
  return v.failures;
}

module.exports = { countVerdict, listVerdict, report };
