// grid_cells — the SHADED-CELL half of `grid`: which cells are shaded, the caption that
// describes them, how much room a wrapped cell string needs, and how wide an edge label is.
//
// Lives in lib/, not types/: diagrams/index.js registers EVERY .js under types/ as a diagram
// type, so a helper module there loads as type `undefined` and breaks the registry.
//
// Split out of grid.js purely for length — grid.js was at the 300-line limit before the
// place-value notation went in, and splits beat abstractions. Nothing here is generalised:
// every function is the exact arithmetic grid.js was already doing inline, moved verbatim
// so the corpus renders byte-for-byte as before. Its companion is grid_notation.js, which
// owns the column-header and regrouping half.

const { SIZE, LEADING, urduBoxH, textBox, measure, wrap, hasUrdu } = require("./svg");

/**
 * Height `Svg.textBlock()` will consume for `s` wrapped to `w`, by the SAME arithmetic
 * textBlock uses. Reservation and drawing must never disagree — that is the whole bug
 * this module was carrying for cell text.
 */
function blockH(s, size, w) {
  const str = String(s ?? "");
  if (!str) return 0;
  if (hasUrdu(str)) {
    const nLines = Math.max(1, Math.ceil(measure(str, size, { lang: "ur" }) / (w - 4)));
    return size * LEADING.urdu * nLines + size * 0.4;
  }
  return wrap(str, size, w).length * size * LEADING.latin;
}

/** Reduce a fraction for the auto caption. */
function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/**
 * Which cell indices are shaded. `shaded` may be a count, a list of indices, a list of
 * [row, col] pairs, or a "3/4" string.
 */
function resolveShaded(spec, rows, cols) {
  const total = rows * cols;
  const s = spec.shaded;
  const set = new Set();
  if (typeof s === "number") {
    for (let i = 0; i < Math.min(s, total); i++) set.add(i);
  } else if (Array.isArray(s)) {
    for (const v of s) {
      if (Array.isArray(v)) set.add(v[0] * cols + v[1]);
      else set.add(Number(v));
    }
  } else if (typeof s === "string" && s.includes("/")) {
    const [num, den] = s.split("/").map(Number);
    const count = Math.round((num / den) * total);
    for (let i = 0; i < count; i++) set.add(i);
  }
  return set;
}

/**
 * The legend line, auto-built from rows/cols/shaded when the spec does not give one:
 * "1/4 = 25% = 0.25". An explicit `legend` — including an explicit empty string — wins.
 */
function autoLegend(spec, shadedCount, rows, cols) {
  if (spec.legend !== undefined || !shadedCount) return spec.legend;
  const t = rows * cols;
  const g = gcd(shadedCount, t) || 1;
  const parts = [`${shadedCount}/${t}`];
  if (g > 1) parts.push(`= ${shadedCount / g}/${t / g}`);
  parts.push(`= ${Number(((shadedCount / t) * 100).toFixed(2))}%`);
  parts.push(`= ${Number((shadedCount / t).toFixed(4))}`);
  return parts.join(" ");
}

/**
 * Width and height of an edge label or a column header, at SIZE.small.
 *
 * Edge labels need their own gutter or an end-anchored Urdu box lands at a negative x and
 * is clipped away by the viewBox. The gutter used to be the FIXED 26 wide / 22 tall (54 /
 * 44 for Urdu) that an area model's "4" needs. But an edge label is not always a digit:
 * "Duties (required by law)" measures 71 units, so an end-anchored label at `x0 - 8`
 * reached 45 units to the LEFT of the canvas and printed across the grid's own first
 * column; the Urdu rowLabel of a 3-word phrase did the same at 78. Measured with the
 * engine's own estimators — and for Urdu with the EXACT box arithmetic `_urduText` will
 * use, or the reservation and the drawing disagree again.
 */
function edgeLabelMetrics(spec) {
  const labelW = (s2) => {
    const str = String(s2 ?? "");
    if (!str) return 0;
    if (spec.lang === "ur" || hasUrdu(str)) {
      return Math.max(measure(str, SIZE.small, { lang: "ur" }) * 1.25 + SIZE.small, SIZE.small * 3);
    }
    return measure(str, SIZE.small, { weight: 700 }) * 1.02;
  };
  const labelH = (s2) => {
    const str = String(s2 ?? "");
    if (!str) return 0;
    if (spec.lang !== "ur" && !hasUrdu(str)) return textBox(str, SIZE.small, 0, 0, {}).h;
    return urduBoxH(str, SIZE.small, labelW(str));
  };
  return { labelW, labelH };
}

module.exports = { blockH, gcd, resolveShaded, autoLegend, edgeLabelMetrics };
