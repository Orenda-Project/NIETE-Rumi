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

// ── RTL prose mode: numeric-range isolation (the 2026-09 mixed-script audit) ─
//
// «صفحہ 6-7» paints «7-6» under an RTL base direction: UAX#9 W2 reclassifies a
// European digit whose nearest preceding strong character is Arabic-class as an
// Arabic Number, W4 re-joins a hyphen only between EUROPEAN numbers, and N1
// then orders the two now-separate number runs right-to-left. The same range
// after Latin text («p.122-124») survives — which is why this shipped unseen on
// three audited documents until the rendered pages were read. Deterministic, so
// it belongs to the renderer, never to the authoring model: every numeric range
// in prose is wrapped in a LEFT-TO-RIGHT ISOLATE (U+2066 … U+2069) when the
// document renders RTL. A lone number is left alone — it has no internal order
// to lose — and math runs are exempt by construction: rich() tokenizes on the
// math delimiters FIRST and this pass touches only the prose slices (KaTeX
// already carries direction:ltr + unicode-bidi:isolate).
//
// Module state, set by buildHtml at entry, cleared nowhere: buildHtml is fully
// synchronous, so two documents cannot interleave inside one process, and every
// build sets the mode for itself.
const LRI = "⁦", PDI = "⁩";
const NUM_RANGE = /[0-9۰-۹]+(?:\s*[-–—~]\s*[0-9۰-۹]+)+/g;
let RTL_PROSE = false;
function setRtlProse(on) { RTL_PROSE = !!on; }
const isolateRanges = (s) => String(s ?? "").replace(NUM_RANGE, (m) => LRI + m + PDI);
const prose = (s) => (RTL_PROSE ? isolateRanges(s) : s);

// ── LTR prose mode: Nastaliq metrics for Arabic runs on an English page (bd-b8ypq) ─
//
// bd-jdtdl made the Nastaliq FACE reachable whenever the document carries Urdu, whatever chrome
// it is served with. It did not carry the LINE BOX across: `urduScript` feeds the font stack and
// nothing else, so every line-height, and .hero's and .foot's paddings, still key off `rtl`. An
// English lesson quoting «حضرت محمد ﷺ» therefore paints Nastaliq ink into a 1.55 line box and the
// glyphs land on the lines above and below — the operator's Grade 6 English chapter overlapped in
// the hero, in a Development paragraph, and in the footer.
//
// Taking the whole page to the Nastaliq branch is the wrong lever: it inflates every English page
// carrying one honorific by ~50% and blows the packer's page budget (render_lp.js:94-117). Only
// the runs that actually carry Arabic need the taller box, so only they get it.
//
// The ﷺ ligature is a second defect wearing the same costume. Measured over every glyph in
// ../fonts/NotoNastaliqUrdu.ttf (unitsPerEm 1000): ordinary Nastaliq wants 1.944em at the 99th
// percentile, but U+FDFA alone paints 3.190em — more even than its own font's 2.50em content box,
// so no line-height an English page can afford would contain it. It is drawn far larger than the
// script around it by design, so scaling it to ~0.61em still leaves ~1.95em of ink — bigger than
// the Latin beside it, and inside the run's own line box. A `size-adjust` @font-face scoped to
// `unicode-range:U+FDFA` computes the same number, but a second @font-face means a second copy of
// a 1.1 MB base64 face on every page that quotes the Prophet's name; the wrapper is free.
//
// Same module-state contract as RTL_PROSE above: set by buildHtml at entry, and buildHtml is
// synchronous, so two documents cannot interleave.
// Exactly the set buildHtml tests for when it decides to embed the face — the two must agree, or
// a run could be wrapped on a page that carries no Nastaliq, or carry Nastaliq unwrapped.
const AR = "؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿";
// A run is Arabic-script characters plus whatever holds a run together: spaces, and the zero-width
// non-joiner/joiner (U+200B-U+200D, escaped because they are invisible in source). It must START
// and END on a strong Arabic character, so the English on either side is never swept in.
const AR_RUN = new RegExp(`[${AR}](?:[${AR}\\s\\u200B-\\u200D]*[${AR}])?`, "g");
const AR_LIG = /ﷺ/g;
let URDU_INLINE = false;
function setUrduInline(on) { URDU_INLINE = !!on; }
const markArabic = (s) =>
  URDU_INLINE
    ? String(s ?? "").replace(AR_RUN, (m) =>
      `<span class="ar">${m.replace(AR_LIG, '<span class="ar-lig">$&</span>')}</span>`)
    : s;

/** Prose -> HTML. Escapes, applies **bold**, renders inline/display maths and chem. */
function rich(s) {
  const src = String(s ?? "");
  let out = "";
  let last = 0;
  let m;
  MATH.lastIndex = 0;
  // markArabic runs AFTER esc(), or its markup would be escaped into visible angle brackets.
  // esc() itself must stay markup-free — it is also used in HTML attribute contexts.
  while ((m = MATH.exec(src)) !== null) {
    out += markArabic(bold(esc(prose(src.slice(last, m.index)))));
    if (m[1] !== undefined) out += tex(m[1], true);                    // $$…$$
    else if (m[2] !== undefined) out += inlineMath(m[2]);              // $…$
    else out += tex(`\\ce{${m[3]}}`, false);
    last = m.index + m[0].length;
  }
  out += markArabic(bold(esc(prose(src.slice(last)))));
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

module.exports = {
  rich, esc, display, displayChem, wordCount, chemPlusDefects, fixChemPlus,
  setRtlProse, isolateRanges, setUrduInline,
};
