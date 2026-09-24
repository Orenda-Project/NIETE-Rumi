'use strict';
/**
 * MATHS IN A CLASS QUIZ — every surface a question's maths reaches, in one module.
 *
 * THE CONTRACT. The author writes a mathematical expression in a stem or an
 * option as inline TeX between single dollars — `$\frac{2}{9}$`,
 * `$3 \times 4 = 12$`, `$2\frac{1}{3}$` — and plain text everywhere else
 * (transcript-quiz-contract.js, MATH_NOTATION_RULE). The row stores that source,
 * because the pictures typeset from it; no person is ever shown it.
 *
 * THREE READERS, THREE RENDERINGS:
 *   - a PICTURE — the child's question card, the teacher's PDF: mathHtml(),
 *     KaTeX through the 6-12 lesson-plan renderer's own rich(), typeset
 *     server-side, with KaTeX's faces inlined by mathCss();
 *   - a CHECK — the validator's lengths and duplicates, the figure gates:
 *     mathToText(), the Unicode a phone keyboard already shows ("2/9", "×",
 *     "5²", "2 1/3"), so every rule measures what the child actually reads;
 *   - a WHATSAPP TEXT — a message body, a button or list title, a verdict, the
 *     class report: mathForChat(), which is mathToText() plus a LEFT-TO-RIGHT
 *     ISOLATE around each expression inside Urdu. Digits and operators are weak
 *     or neutral in the bidi algorithm, so in an Urdu line "3 × 4 = 12" is laid
 *     out "12 = 4 × 3"; the isolate (U+2066 … U+2069, already used by the
 *     catalog for "/quiz") keeps an expression in the order it was written.
 *
 * A MIXED NUMBER. `$2\frac{1}{3}$` reads "2 1/3", never "21/3" (twenty-one
 * thirds). The rule — a NO-BREAK SPACE between the whole part and the fraction,
 * chosen because U+00A0 keeps "2 1/3" one number run inside an Urdu line — is
 * tex-to-unicode's own, so the quiz, the lesson message and the diagram engine
 * all read a mixed number the same way. This module adds nothing to it.
 *
 * LOAD WEIGHT. The render contract (video-quiz-render) requires this file on
 * every send, so KaTeX is required LAZILY: only mathHtml(), mathCss() and
 * texFaults() reach it, and the text path touches nothing but the two
 * dependency-free leaves below.
 */

const { texToUnicode } = require('../../utils/tex-to-unicode');
const { esc, richNotation, hasTex } = require('./quiz-notation');

const LRI = '⁦';
const PDI = '⁩';
/** The inline span, exactly as quiz-notation and tex-to-unicode read it. */
const SPAN = /\$([^$\n]+?)\$/g;
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const PURE_NUMBER = /^[\d.,]+$/;

// ── COLUMN SUMS ──────────────────────────────────────────────────────────────
// A column sum is written as ONE expression, a KaTeX array — the numbers right-
// aligned under each other, the operator in its own column, a rule, an empty
// answer row (transcript-quiz-contract COLUMN_SUM_RULE):
//   $\begin{array}{rr} & 452 \\ - & 137 \\ \hline & \end{array}$
// The card and the PDF typeset it as a textbook prints it. Every TEXT path gets
// one line a child can read — "452 − 137 = ?" — never tex-to-unicode's generic
// rendering of an array ("rr, 452; -, 137; hline,").
const COLUMN_ARRAY = /^\s*(?:\\displaystyle\s*)?\\begin\{array\}\{[^{}]*\}([\s\S]*?)\\end\{array\}\s*$/;
const OPERATOR = { '+': '+', '-': '−', '−': '−', '\\times': '×', '×': '×', '\\div': '÷', '÷': '÷' };

/**
 * The inside of one `$…$` span as a flat column sum ("452 − 137 = ?"), or null
 * when the span is not a column sum (not an array, fewer than two numbers, or
 * no operator). Pure.
 */
function columnSumText(inner) {
  const m = COLUMN_ARRAY.exec(String(inner || ''));
  if (!m) return null;
  const numbers = [];
  let op = null;
  let result = null;
  let ruled = false;   // below the rule: the answer row
  m[1].split(/\\\\/).forEach((raw) => {
    const cells = raw.replace(/\\hline/g, ' ').split('&').map((c) => c.trim());
    if (/\\hline/.test(raw)) ruled = true;
    const num = cells.map((c) => c.replace(/\\[,;: ]/g, '').replace(/\s+/g, '')).find((c) => /^\d[\d,.]*$/.test(c));
    const opCell = cells.find((c) => Object.prototype.hasOwnProperty.call(OPERATOR, c.replace(/\s+/g, '')));
    if (opCell) op = OPERATOR[opCell.replace(/\s+/g, '')];
    if (!num) return;
    if (ruled) result = num; else numbers.push(num);
  });
  if (numbers.length < 2 || !op) return null;
  return `${numbers.join(` ${op} `)} = ${result || '?'}`;
}

/** One `$…$` span (or a whole string) as Unicode — a mixed number reads "2 1/3" (tex-to-unicode), a column sum "452 − 137 = ?". */
function mathToText(text) {
  if (typeof text !== 'string' || !text || (!text.includes('$') && !text.includes('\\'))) return text;
  return texToUnicode(text.replace(SPAN, (span, inner) => {
    const sum = columnSumText(inner);
    return sum !== null ? sum : span;
  }));
}

/**
 * mathToText() for a WhatsApp text. In a line that carries Urdu, each expression
 * becomes a left-to-right isolate — except a lone number, which has no internal
 * order to lose (the same exemption rich.js makes for a number in an RTL page).
 */
function mathForChat(text) {
  if (typeof text !== 'string' || !text || (!text.includes('$') && !text.includes('\\'))) return text;
  const rtl = ARABIC.test(text);
  const spanned = text.replace(SPAN, (span) => {
    const flat = mathToText(span);
    return rtl && !PURE_NUMBER.test(flat) ? `${LRI}${flat}${PDI}` : flat;
  });
  // A command left loose in prose (`\times` outside any dollars) is rewritten
  // too — the validator rejects it, but a row stored before this rule existed
  // must still never put a backslash on a phone.
  return texToUnicode(spanned);
}

/**
 * Prose and maths as HTML for a PICTURE (the card, the teacher PDF).
 *
 * The prose runs are handed to `prose` (the caller's own escape + notation +
 * Latin isolation — the card and the PDF differ there); each `$…$` run goes to
 * rich() whole, so the prose pass can never reach into KaTeX's markup. Each
 * expression is wrapped in `.qm`, which mathCss() makes a left-to-right
 * isolate.
 *
 * `display: true` sets each expression in KaTeX's DISPLAY style: a fraction is
 * then as tall as the text around it instead of shrunk to superscript size —
 * what a young child needs on a phone card (rendered and read at phone width,
 * bd-mg9c7.159.19). The A4 teacher PDF keeps the compact inline style.
 */
function mathHtml(text, { prose = (s) => richNotation(esc(s)), display = false } = {}) {
  const src = String(text == null ? '' : text);
  if (!hasTex(src)) return prose(src);
  const { rich } = require('../../../vendor/lp-v9/lib/rich');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(SPAN)) {
    out += prose(src.slice(last, m.index));
    const inner = display && !/\\displaystyle/.test(m[1]) ? `\\displaystyle ${m[1]}` : m[1];
    // A column sum stands on its own line, centred, as the textbook sets it out.
    const cls = /\\begin\{array\}/.test(m[1]) ? 'qm qm-col' : 'qm';
    out += `<span class="${cls}">${rich(`$${inner}$`)}</span>`;
    last = m.index + m[0].length;
  }
  return out + prose(src.slice(last));
}

/** True when a rendered HTML string carries typeset maths (so the page needs mathCss()). */
const usesMath = (html) => /class="katex/.test(String(html || ''));

let _katexCss = null;
/**
 * KaTeX's stylesheet with its woff2 faces inlined (the LP renderer's own
 * katexCss(), read once per process), plus the direction rule the LP renderer
 * uses: an expression is left-to-right and isolated whatever the page's
 * direction.
 */
function mathCss() {
  if (_katexCss === null) {
    const { katexCss } = require('../../../vendor/lp-v9/lib/fonts');
    _katexCss = katexCss();
  }
  return `${_katexCss}\n.qm,.qm .katex,.qm .katex *{direction:ltr;unicode-bidi:isolate}\n.qm-col{display:block;text-align:center;margin:.3em 0 .5em}`;
}

// ── the validator's half ─────────────────────────────────────────────────────

/** Arguments that are TEXT inside maths — a word there is legitimate (`5\,\text{cm}`). */
const TEXT_ARG = /\\(?:text|textrm|textbf|mathrm|mathbf|mbox|operatorname)\s*\{[^{}]*\}/g;
/** `\\begin{array}{rr}` / `\\end{array}` — an environment and its column spec. */
const ENV_ARG = /\\(?:begin|end)\s*\{[a-zA-Z*]+\}(?:\{[^{}]*\})?/g;
const clip = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let _katex = null;
const katex = () => {
  if (_katex === null) _katex = require('katex');
  return _katex;
};

/**
 * What is wrong with the maths in one field, as sentences the retry prompt can
 * quote back. Empty when the field is fine or has no maths. Each fault names
 * the expression, so the rewrite knows which one to fix.
 *
 * The parse check asks KaTeX itself (throwOnError): a card must never paint
 * KaTeX's red error box where a fraction should be. Chemistry is refused before
 * the parse, deliberately: `\ce` exists only once rich.js has loaded mhchem, so
 * leaving it to the parser would make the verdict depend on load order.
 */
function texFaults(text) {
  const s = String(text == null ? '' : text);
  if (!s.includes('$') && !s.includes('\\')) return [];
  const out = [];
  if (s.includes('$$')) {
    out.push('uses "$$" — write every expression inline between single dollars, e.g. $\\frac{2}{9}$');
    return out;
  }
  if ((s.match(/\$/g) || []).length % 2) {
    out.push('has an unmatched "$" — every expression opens AND closes with one "$" ($\\frac{2}{9}$), and "$" is never money (write Rs)');
    return out;
  }
  const loose = /\\[a-zA-Z]+/.exec(s.replace(SPAN, ' '));
  // A column sum whose rows ran together — the JSON's "\\\\" arrived as one
  // backslash, a control space — would typeset as one long row.
  for (const m of s.matchAll(SPAN)) {
    if (/\\begin\{array\}/.test(m[1]) && !/\\\\/.test(m[1])) {
      out.push(`"$${clip(m[1], 60)}$" — a column sum puts each number on its own row: end each row with \\\\ (in the JSON you return, \\\\\\\\), e.g. $\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & \\end{array}$`);
      return out;
    }
  }
  if (loose) out.push(`has "${loose[0]}" outside the dollars — put every expression between single dollars ($…$), and only the maths inside them`);
  for (const m of s.matchAll(SPAN)) {
    const inner = m[1];
    const shown = `$${clip(inner, 60)}$`;
    if (/\\(?:ce|pu)\b/.test(inner)) {
      out.push(`"${shown}" — chemistry is written plain (H2O, CO2), never as TeX`);
      continue;
    }
    if (ARABIC.test(inner)) {
      out.push(`"${shown}" — Urdu words go outside the dollars; only the maths goes inside, with digits 0-9`);
      continue;
    }
    // An environment's name and a column spec ("\\begin{array}{rr}") are TeX, not words.
    const word = /[A-Za-z]{3,}/.exec(inner.replace(ENV_ARG, ' ').replace(TEXT_ARG, ' ').replace(/\\[a-zA-Z]+/g, ' '));
    if (word) {
      out.push(`"${shown}" — the word "${word[0]}" is inside the dollars; words go outside, only the maths goes inside`);
      continue;
    }
    try {
      katex().renderToString(inner, { throwOnError: true, strict: 'ignore' });
    } catch (err) {
      const why = String((err && err.message) || err).replace(/^KaTeX parse error:\s*/, '');
      out.push(`"${shown}" is not valid TeX (${clip(why, 80)}) — write simple inline maths such as $\\frac{2}{9}$ or $3 \\times 4$`);
    }
  }
  return out;
}

module.exports = {
  mathToText, mathForChat, mathHtml, mathCss, usesMath, texFaults, hasTex, LRI, PDI,
};
