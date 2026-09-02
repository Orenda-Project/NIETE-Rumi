/**
 * katex stub for the ROOT test suite.
 *
 * `katex` is a bot-only dependency (bot/vendor/lp-v9/lib/rich.js typesets every maths and
 * mhchem run SERVER-SIDE), and CI runs the root suite before `bot/ npm ci`. Same reason as
 * every other stub in this directory: an unresolved require kills the whole suite file.
 *
 * This stub is FUNCTIONAL rather than a no-op, because the vendored lint builds the real
 * print DOM and walks it — `renderToString` returning undefined would break `buildHtml()`
 * for every document and turn a lint test into a crash.
 *
 * WHAT IT PAINTS, AND WHY IT MATTERS: the vendored `MATH_LEAK` gate FAILS any painted text
 * run that still contains `$`, `\begin`/`\end{` or a `\control` sequence — that is the whole
 * point of the gate. Real KaTeX emits glyphs, never the source. So this stub emits the
 * source with exactly those markers stripped: it stands in for "the maths got typeset"
 * without forging a false MATH_LEAK failure on correct input. It cannot stand in for the
 * paint-level questions (which font drew this glyph) — those need real KaTeX and a browser,
 * and they are not asked in the root suite.
 */

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Source -> something glyph-shaped: no $, no backslash commands, no braces. */
const flatten = (src) =>
  String(src == null ? '' : src)
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[\\${}$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function renderToString(src, opts = {}) {
  const body = esc(flatten(src)) || '&#183;';
  const cls = opts && opts.displayMode ? 'katex katex-display' : 'katex';
  return `<span class="${cls}"><span class="katex-html" aria-hidden="true">${body}</span></span>`;
}

function render(src, node, opts) {
  if (node) node.innerHTML = renderToString(src, opts);
}

class ParseError extends Error {}

module.exports = { renderToString, render, ParseError, version: '0.16.0-stub' };
module.exports.default = module.exports;
