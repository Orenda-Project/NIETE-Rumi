/**
 * TeX maths → readable Unicode, for message bodies.
 *
 * WHY THIS EXISTS (bd-lafr9). The `one_screen` field is authored with TeX in it and goes out as a
 * WhatsApp message body ahead of the lesson PDF. WhatsApp cannot typeset, so whatever the author
 * wrote lands on the handset as source: a Grade 6 maths teacher was receiving the literal string
 * `$-6 \times \square = -540$`. Measured over 642 sends from 2026-09-01: 44% of maths lessons.
 *
 * WHY UNICODE, NOT KATEX. The PDF path typesets properly and keeps doing so — this module is only
 * for the text path, where there is no markup that can draw a radical or a fraction bar. The only
 * readable destination is the Unicode a teacher's own keyboard already shows her: × ÷ · √ ² ₁ ≤ π.
 *
 * THE DEGRADATION RULE. Anything that cannot be mapped faithfully falls back to plain ASCII a
 * person can still read — `a/b` for a fraction, `^(n+1)` for an exponent with no superscript form,
 * and for an unrecognised command the bare word without its backslash. It must never fall back to
 * a backslash: a backslash on a phone is noise, and noise is the defect being fixed.
 *
 * Prose is not touched. Conversion runs inside `$…$`, `\(…\)` and `\[…\]` spans; outside them only
 * a known symbol command is rewritten, because a stray brace in teacher prose is a brace and a
 * stray `\times` is not.
 */

/** Commands that stand for exactly one character. */
const SYMBOLS = new Map(Object.entries({
  times: '×', div: '÷', cdot: '·', ast: '*', star: '⋆',
  pm: '±', mp: '∓',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', propto: '∝',
  infty: '∞', square: '□', circ: '°', degree: '°', prime: '′',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ',
  theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', Pi: 'Π',
  sigma: 'σ', Sigma: 'Σ', phi: 'φ', omega: 'ω', Omega: 'Ω',
  sum: 'Σ', prod: 'Π', int: '∫',
  angle: '∠', triangle: '△', perp: '⊥', parallel: '∥',
  rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔',
  ldots: '…', dots: '…', cdots: '…',
  therefore: '∴', because: '∵',
  in: '∈', notin: '∉', subset: '⊂', supset: '⊃',
  cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃',
  // Escaped literals — the backslash is the escape, the character is the content.
  '%': '%', $: '$', '&': '&', '#': '#', _: '_', '{': '{', '}': '}',
}));

/** Commands that are pure spacing in TeX and have no business on a phone. */
const SPACING = new Map(Object.entries({
  quad: ' ', qquad: ' ', ',': ' ', ';': ' ', ':': ' ', ' ': ' ', '!': '',
}));

const SUPERSCRIPT = Object.entries({
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
}).reduce((m, [k, v]) => m.set(k, v), new Map());

const SUBSCRIPT = Object.entries({
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ',
}).reduce((m, [k, v]) => m.set(k, v), new Map());

/**
 * Read the argument at `i`: a braced group, or the single next character.
 * Returns `[contents, indexAfter]`. An unclosed brace yields the rest of the string, which is what
 * a reader would make of it too.
 */
function readGroup(src, i) {
  if (src[i] !== '{') return [src[i] || '', i + 1];
  let depth = 1;
  let j = i + 1;
  while (j < src.length && depth > 0) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') depth -= 1;
    if (depth > 0) j += 1;
  }
  return [src.slice(i + 1, j), j + 1];
}

/** Map every character through `table`, or return null if any one of them has no form. */
function mapAll(text, table) {
  let out = '';
  for (const ch of text) {
    const mapped = table.get(ch);
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}

/** `{x}` or `x` around a converted argument: parenthesise only when it is not a single token. */
function tighten(text) {
  return /^[A-Za-z0-9.]+$/.test(text) ? text : `(${text})`;
}

/**
 * Convert the inside of a maths span. Recursive, because an exponent or a radicand is itself
 * maths — `\sqrt{x^2}` has to resolve the square before it can decide about the radical.
 */
function convertMath(src) {
  let out = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const m = /^[a-zA-Z]+/.exec(src.slice(i + 1));
      const name = m ? m[0] : src[i + 1] || '';
      let next = i + 1 + name.length;

      if (name === 'sqrt') {
        // An optional index: \sqrt[3]{x} is a cube root, and 3 and 4 have their own radicals.
        let index = '';
        if (src[next] === '[') {
          const close = src.indexOf(']', next);
          if (close !== -1) { index = src.slice(next + 1, close); next = close + 1; }
        }
        const [arg, after] = readGroup(src, next);
        const radical = index === '3' ? '∛' : index === '4' ? '∜' : '√';
        const body = convertMath(arg);
        // No index form beyond 4 exists in Unicode; say it in words rather than lose it.
        out += index && !'34'.includes(index) ? `${index}-th root of ${body}` : radical + tighten(body);
        i = after;
        continue;
      }

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [num, afterNum] = readGroup(src, next);
        const [den, afterDen] = readGroup(src, afterNum);
        out += `${tighten(convertMath(num))}/${tighten(convertMath(den))}`;
        i = afterDen;
        continue;
      }

      // Font and text wrappers carry their contents and nothing else.
      if (['text', 'textrm', 'textbf', 'mathrm', 'mathbf', 'mathit', 'operatorname'].includes(name)) {
        const [arg, after] = readGroup(src, next);
        out += convertMath(arg);
        i = after;
        continue;
      }

      // \left( and \right) size a delimiter that is emitted by the next character anyway.
      if (name === 'left' || name === 'right') { i = next; continue; }

      if (SPACING.has(name)) { out += SPACING.get(name); i = next; continue; }
      if (SYMBOLS.has(name)) { out += SYMBOLS.get(name); i = next; continue; }

      // Unrecognised: drop the backslash, keep the word. `\foo` reads as "foo", never as "\foo".
      out += name;
      i = next;
      continue;
    }

    if (ch === '^' || ch === '_') {
      const [arg, after] = readGroup(src, i + 1);
      const converted = convertMath(arg);
      const mapped = mapAll(converted, ch === '^' ? SUPERSCRIPT : SUBSCRIPT);
      out += mapped !== null ? mapped : `${ch}${tighten(converted)}`;
      i = after;
      continue;
    }

    // Grouping braces are structure, not content.
    if (ch === '{' || ch === '}') { i += 1; continue; }

    out += ch;
    i += 1;
  }

  return out;
}

/** `\times` and friends left loose in prose, outside any delimiter. */
const LOOSE_COMMAND = new RegExp(`\\\\(${[...SYMBOLS.keys()].filter((k) => /^[a-zA-Z]+$/.test(k)).join('|')})(?![a-zA-Z])`, 'g');

/**
 * Rewrite every maths span in `text` as Unicode and hand back something a teacher can read.
 *
 * Non-string input and text with no maths in it come back untouched — this runs on every body,
 * including the ~91% that never had a dollar sign in them.
 */
function texToUnicode(text) {
  if (typeof text !== 'string' || !text) return text;

  let out = text
    // Display and inline spans first; `$…$` last so a `\[ … $ … \]` cannot be split by it.
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => convertMath(inner))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => convertMath(inner))
    .replace(/\$([^$\n]+?)\$/g, (_, inner) => convertMath(inner));

  // A command that never had delimiters around it is still unreadable. Symbols only: rewriting
  // braces or exponents out here would reach into prose that legitimately contains them.
  out = out.replace(LOOSE_COMMAND, (_, name) => SYMBOLS.get(name));

  return out;
}

module.exports = { texToUnicode, convertMath };
