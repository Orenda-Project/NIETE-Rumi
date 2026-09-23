'use strict';
/**
 * TeX inside a model's JSON reply: keep every backslash a backslash.
 *
 * Moved here unchanged from lp612-author.service.js (itself ported from the
 * authoring workspace's `repair_backslashes`) so the class-quiz passes can use
 * the same repair once their stems and options carry TeX (bd-mg9c7.159.19).
 * lp612-author.service.js requires it from here and still exports it.
 */

const VALID_ESCAPE = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

// LaTeX/mhchem commands beginning with a letter that is ALSO a legal JSON escape (\b \f \n \r
// \t). Everything else after a backslash — \ce, \left, \sqrt, \alpha … — is already an illegal
// escape and gets doubled unconditionally. This whitelist is why a real "line\nbreak" survives.
const LATEX_AMBIG = [
  'begin', 'bmatrix', 'binom', 'bar', 'boxed', 'bullet', 'because', 'bigg',
  'frac', 'forall', 'fbox', 'frown',
  'nabla', 'neq', 'ne', 'notin', 'nu', 'nonumber', 'newline',
  'rho', 'rightarrow', 'right', 'rangle', 'rm',
  'times', 'text', 'textbf', 'textit', 'to', 'theta', 'tau', 'therefore', 'tan',
  'triangle', 'tfrac', 'top',
];

const isAlpha = (c) => /[A-Za-z]/.test(c);

/**
 * Double every backslash inside a string literal that is not a valid JSON escape.
 *
 * The failure this exists for is silent, not loud: `\f` is a LEGAL JSON escape, so
 * `"\frac{1}{2}"` PARSES — into a form feed followed by "rac{1}{2}" — and the formula is gone
 * with no error anywhere. Three revision passes were lost to that before the repair existed.
 */
function repairBackslashes(s) {
  const out = [];
  let inStr = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (!inStr) {
      out.push(c);
      if (c === '"') inStr = true;
      i += 1;
      continue;
    }
    if (c === '\\') {
      const nxt = i + 1 < s.length ? s[i + 1] : '';
      let keep = VALID_ESCAPE.has(nxt);
      if (keep && 'bfnrt'.includes(nxt)) {
        let run = '';
        let k = i + 1;
        while (k < s.length && isAlpha(s[k])) { run += s[k]; k += 1; }
        if (LATEX_AMBIG.some((cmd) => run.startsWith(cmd))) keep = false;
      }
      if (keep) { out.push(c, nxt); i += 2; continue; }
      out.push('\\\\');
      i += 1;
      continue;
    }
    out.push(c);
    if (c === '"') inStr = false;
    i += 1;
  }
  return out.join('');
}

module.exports = { repairBackslashes, LATEX_AMBIG, VALID_ESCAPE };
