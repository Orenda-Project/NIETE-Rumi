/**
 * HOW TWO FILLS ARE COMPARED BY HOW FAR APART THEY *LOOK*.
 *
 * Extracted from readability-blocks.test.js (bd-f6opy) because a second suite now needs the
 * same maths: that suite proves the seven SECTION BANDS are far enough apart to be told
 * apart, and primary-moves.test.js proves the same thing of the three GRADUAL-RELEASE MOVE
 * pills. One law, two surfaces -- so one copy of the arithmetic. Nothing here changed in the
 * move; each function is the one readability-blocks has always run, comments included.
 *
 * This is test scaffolding, not source: it reads a stylesheet and does colour arithmetic, and
 * it has no knowledge of any block, section or grade.
 */

/** The declaration block of one rule, by exact selector text.
 *  The boundary check is load-bearing: a bare `indexOf('p{')` matches inside `.wrap{`, and the
 *  body-floor assertion would then be reading some other rule entirely and passing by accident.
 *
 *  bd-f6opy TIGHTENED IT TO THE START OF A RULE, not merely to a token boundary. The old check
 *  only refused a selector glued to a preceding word character, so a space passed -- and once
 *  `.pri .pr .tag{` was declared ABOVE the base `.pr .tag{` it owned, a lookup of `.pr .tag`
 *  returned the primary override instead. Two suites then read the wrong rule and one of them
 *  passed by accident. A selector can only begin where the last rule ended, at a `}`, at a `,`
 *  in a selector list, after a comment closes, or just inside an at-rule's `{`. */
function rule(css, selector) {
  const needle = selector + '{';
  let i = -1;
  for (;;) {
    i = css.indexOf(needle, i + 1);
    if (i < 0) return null;
    let k = i - 1;
    while (k >= 0 && /\s/.test(css[k])) k -= 1;
    if (k < 0 || '},/{'.includes(css[k])) break;
  }
  const j = css.indexOf('}', i);
  return j < 0 ? null : css.slice(i + needle.length, j);
}

/** The `background:` a rule declares, token spelling and all. Null when the rule declares none,
 *  which is itself a finding -- an unfilled pill is the defect bd-f6opy was opened for. */
function fillOf(css, cls) {
  const m = (rule(css, cls) || '').match(/background:\s*([^;]+);/);
  return m ? m[1].trim() : null;
}

/** A value chased through `:root` until it is a literal -- `var(--s-note-ink)` -> `#8A5F04`. */
function resolved(css, value) {
  const root = css.match(/:root\{([\s\S]*?)\}/)[1];
  let v = String(value).trim();
  for (let i = 0; i < 8 && v.startsWith('var('); i += 1) {
    const token = v.slice(4, v.indexOf(')')).trim();
    const m = root.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    if (!m) return null;
    v = m[1].trim();
  }
  return v;
}

/** CIE L*a*b*, so two fills can be compared by how far apart they LOOK, not by how they are spelled. */
function lab(hex) {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => f(parseInt(hex.slice(i, i + 2), 16) / 255));
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

/** WCAG 2.x relative luminance. */
function luminance(hex) {
  const ch = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => ch(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast between any two hex colours -- bd-f6opy needed the general form because a
 *  pill's name is not always white: I DO's amber carries white at only 2.11:1, so the primary
 *  sheet prints that one name in navy. The law is "the name is legible on its own fill", and
 *  only the two-colour form can state it. */
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

/** Contrast of a hex fill against the #fff a band's name and minutes are printed in. */
const contrastWithWhite = (hex) => contrast(hex, '#ffffff');

module.exports = { rule, fillOf, resolved, lab, deltaE, contrast, contrastWithWhite };
