// Inline text pipeline for LP-HTML v8.
//
// Every lp_doc string may carry:
//   **bold**            -> <b>
//   $ ... $             -> inline KaTeX
//   \ce{ ... }          -> inline mhchem (KaTeX extension)
// Maths is rendered SERVER-SIDE (katex.renderToString) — the PDF must not depend on
// client JS, and a Chrome print pass will not wait for a script we never shipped.
//
// Order matters: we tokenize on the math delimiters FIRST, HTML-escape only the prose
// runs, and hand the math runs to KaTeX untouched. Escaping first would turn \le into
// &bsol;le and silently break every formula.

const katex = require("katex");
require("katex/dist/contrib/mhchem.js"); // registers \ce and \pu

const KATEX_OPTS = {
  throwOnError: false,
  strict: false,
  output: "html",
  errorColor: "#9B2C2C",
};

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function tex(src, displayMode) {
  try {
    return katex.renderToString(src, { ...KATEX_OPTS, displayMode });
  } catch (e) {
    return `<span class="tex-err">${esc(src)}</span>`;
  }
}

// $$...$$ (display)  or  $...$ (inline)  or  \ce{...}
// The $$ alternative MUST come first or the $ alternative eats its opening pair.
const MATH = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$|\\ce\{((?:[^{}]|\{[^{}]*\})*)\}/g;

// ── v9: A MATRIX IS NEVER TYPESET AS A SUBSCRIPT ────────────────────────────
//
// The expert's printed G10 determinants LP carried inline matrices set at script size —
// KaTeX's textstyle, which is what `$\begin{bmatrix}…\end{bmatrix}$` legitimately means. On a
// page the teacher reads at arm's length that is unreadable, and on a phone it is a smear.
// A matrix environment inside an inline run is therefore promoted to \displaystyle: the same
// maths, at full height, still flowing inside the sentence. This is a RENDER decision, not an
// authoring one — the author writes $…$ and gets a legible matrix either way.
const MATRIX_ENV = /\\begin\{(?:[bBpvV]?matrix|smallmatrix|array|cases|aligned)\}/;
const hasMatrix = (src) => MATRIX_ENV.test(src);
const displayify = (src) => (hasMatrix(src) && !/\\displaystyle/.test(src) ? `\\displaystyle ${src}` : src);
/** KaTeX emits no marker of its own for this, so the promotion wears one — for CSS and for the gate. */
const inlineMath = (src) =>
  hasMatrix(src) ? `<span class="mtx" data-displaystyle="1">${tex(displayify(src), false)}</span>` : tex(src, false);

/** Prose -> HTML. Escapes, applies **bold**, renders inline/display maths and chem. */
function rich(s) {
  const src = String(s ?? "");
  let out = "";
  let last = 0;
  let m;
  MATH.lastIndex = 0;
  while ((m = MATH.exec(src)) !== null) {
    out += bold(esc(src.slice(last, m.index)));
    if (m[1] !== undefined) out += tex(m[1], true);                    // $$…$$
    else if (m[2] !== undefined) out += inlineMath(m[2]);              // $…$
    else out += tex(`\\ce{${m[3]}}`, false);
    last = m.index + m[0].length;
  }
  out += bold(esc(src.slice(last)));
  return out;
}

function bold(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

/** Display maths block. */
const display = (src) => tex(src, true);
/** Display chemistry block; `src` is the INSIDE of \ce{...}. */
const displayChem = (src) => tex(`\\ce{${src}}`, true);

/** Words in a string, ignoring markup and maths. Works for Urdu (whitespace-delimited). */
function wordCount(s) {
  return String(s ?? "")
    .replace(MATH, " x ")
    .replace(/\*\*/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

// ── mhchem: the `+` that silently becomes a CHARGE ──────────────────────────
//
// `\ce{2H2+O2->2H2O}` does NOT print "2H₂ + O₂ → 2H₂O". mhchem reads a `+` that follows a
// species with no space as an ionic charge, so the page prints `H₂⁺O₂` — plausible-looking
// chemistry that is WRONG. 28 equations in one authored sample were affected and every one of
// them rendered without a warning. So this is a gate, not a style note.
//
// The rule cannot simply be "a `+` must have spaces": `\ce{Na+}` and `\ce{Ca^2+ + 2Cl-}` are
// correct charges. What is always wrong is a `+` with a NON-SPACE on BOTH sides — an operator
// welded to the species on its right. That is the shape this detects, and the only shape it fixes.
const CE = /\\ce\{((?:[^{}]|\{[^{}]*\})*)\}/g;
const BAD_PLUS = /(?<=[^\s+])\+(?=[^\s}+])/;

/** Offending `\ce{...}` bodies in a string. `bare` treats the whole string as one \ce body. */
function chemPlusDefects(s, bare = false) {
  const src = String(s ?? "");
  const out = [];
  if (bare) {
    if (BAD_PLUS.test(src)) out.push(src);
    return out;
  }
  CE.lastIndex = 0;
  let m;
  while ((m = CE.exec(src)) !== null) if (BAD_PLUS.test(m[1])) out.push(m[1]);
  return out;
}

const spacePlus = (body) => body.replace(new RegExp(BAD_PLUS.source, "g"), " + ");

/** Insert the spaces mhchem needs. `bare` = the string IS a \ce body (a `chem` block's `tex`). */
function fixChemPlus(s, bare = false) {
  const src = String(s ?? "");
  if (bare) return spacePlus(src);
  CE.lastIndex = 0;
  return src.replace(CE, (_, body) => `\\ce{${spacePlus(body)}}`);
}

module.exports = { rich, esc, display, displayChem, wordCount, chemPlusDefects, fixChemPlus };
