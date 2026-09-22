// grid_notation — the PLACE-VALUE notation a `grid` can carry: one header per column
// track, and regrouping written as marks over the minuend.
//
// Lives in lib/, not types/: diagrams/index.js registers EVERY .js under types/ as a diagram
// type, so a helper module there loads as type `undefined` and breaks the registry.
//
// Split out of grid.js, which was already at the 300-line limit. Splits beat abstractions:
// nothing here is generalised, it is just the half of `grid` that deals with columns of a
// written algorithm rather than with shaded cells.
//
// Both keys are OPTIONAL and ADDITIVE. A spec that uses neither must leave grid.js on
// exactly the path it took before — the corpus byte-identity block in
// tests/lp612/grid-place-value-regroup.test.js is what holds that true.

const { C, SIZE, LEADING, measure, hasUrdu, urduBoxH } = require("./svg");

/** Renamed values are the SMALL text. SIZE.tiny is the engine's floor; never go under it. */
const MARK_SIZE = SIZE.tiny;
/** Inset of the mark from its cell's left/top edge, and its clearance from the digit. */
const PAD = 3;
const GAP = 2;

const n = (v) => {
  const r = Math.round(Number(v) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * DEFECT 1 — "Th H T O should be right above each square, not tightened together in the
 * middle". `colLabel` is a SINGLE string drawn centred on the whole grid. An author who
 * wants one header per column has no way to say so, so they pad with literal spaces —
 * "Th   H   T   O" — and spaces cannot align to a cell track at any font: the four headers
 * print as one clump over the middle of the grid and none sits over the place it names.
 *
 * So `colLabels` (an array) is the real key, and the string form is kept working by being
 * read as that array whenever it splits into exactly `cols` pieces — her document renders
 * correctly WITHOUT being re-authored.
 *
 * When the count does not match, this refuses: it returns the single centred label the type
 * has always drawn. A phrase like "Responsibilities (benefit the community)" over two
 * columns is a phrase, not a header row; splitting it would mis-align it silently, and a
 * loud, correct refusal beats a quiet wrong guess.
 *
 * @returns {{perColumn: string[]|null, single: string|undefined}}
 */
function resolveColLabels(spec, cols) {
  const fromArray = Array.isArray(spec.colLabels) ? spec.colLabels.map((s) => String(s ?? "")) : null;
  const single =
    spec.colLabel != null && String(spec.colLabel) !== ""
      ? String(spec.colLabel)
      : fromArray && fromArray.some((s) => s !== "")
        ? fromArray.join("   ")
        : undefined;
  const parts = fromArray || (single !== undefined ? single.trim().split(/\s+/) : null);
  const perColumn = parts && parts.length === cols && parts.some((s) => s !== "") ? parts : null;
  return { perColumn, single };
}

/**
 * DEFECT 2 — "the grid diagram also has 35910 under it, when it should have been carried
 * over". Renaming was authored as A SECOND ROW OF DIGITS (3, 5, 9, 10), which is not how
 * column subtraction is written, and the "10" put two glyphs in a one-digit place-value
 * cell so the row scanned as one five-digit number. A teacher writes renaming as marks over
 * the minuend, INSIDE the minuend's own row: the original digit struck through, the renamed
 * value small, above and to its left.
 *
 * `regroup: [[row, col, newValue], ...]` — the same triple shape as `cellText`, 0-based, so
 * there is one thing to learn. `newValue` may be omitted to strike a digit with no rename.
 * Junk entries are DROPPED rather than drawn at a NaN position (the silent failure mode
 * `cellText` is documented for).
 */
function resolveRegroup(spec) {
  if (!Array.isArray(spec.regroup)) return [];
  return spec.regroup
    .filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]))
    .map((e) => ({ r: e[0], c: e[1], value: e[2] == null ? "" : String(e[2]) }));
}

/** Width/height a string occupies, by the SAME estimators the drawing below uses. */
function markBox(s, size) {
  if (!s) return { w: 0, h: 0 };
  if (hasUrdu(s)) {
    const w = Math.max(measure(s, size, { lang: "ur" }) * 1.25 + size, size * 3);
    return { w, h: urduBoxH(s, size, w) };
  }
  return { w: measure(s, size, { weight: 600 }) * 1.02, h: size * LEADING.latin };
}

/**
 * Width of the digit the mark has to clear. For Urdu this must be the EXACT box arithmetic
 * `_urduText` will use, 3em floor included — using the unfloored estimate is how the mark
 * ended up printing 6.5 units into its own digit on the first Urdu render.
 */
function glyphW(s, size) {
  if (!s) return 0;
  return hasUrdu(s) ? markBox(s, size).w : measure(s, size) * 1.02;
}

/**
 * The cell a regroup mark needs. THE CELL MUST FIT THE MARK IT CARRIES — the same law the
 * rest of this type already obeys for its legend and its cell text.
 *
 * The mark sits in the cell's top-left corner and the digit stays centred, so they clear
 * each other horizontally when `PAD + markW + GAP <= cw/2 - digitW/2`; the mark also has to
 * fit inside the cell vertically above the digit's line. Reservation and drawing share
 * `markBox`, so they can never disagree.
 */
function regroupSizing(marks, cellAt, textSize) {
  let minW = 0;
  let minH = 0;
  for (const m of marks) {
    const b = markBox(m.value, MARK_SIZE);
    if (!b.w) continue;
    const d = glyphW(cellAt.get(`${m.r},${m.c}`), textSize);
    minW = Math.max(minW, 2 * (PAD + b.w + GAP) + d);
    minH = Math.max(minH, b.h + GAP * 2 + textSize * LEADING.latin);
  }
  return { minW: Math.ceil(minW), minH: Math.ceil(minH) };
}

/**
 * Strike the renamed digit and write its new value above and left of it.
 *
 * The strike is a `<line>` carrying `data-ov="skip"`. That flag is the engine's sanctioned
 * escape hatch for deliberate art — "a ray that must pass through its own tick" — and a
 * strikethrough is exactly that: without it `checkOverlaps` would report the rule running
 * through the glyph it is meant to cross, and lint_lp.js's DIAGRAM_OVERLAP would reject a
 * correct figure.
 */
function drawRegroup(svg, marks, geom) {
  const { x0, y0, cw, ch, cellAt, textSize, lang } = geom;
  for (const m of marks) {
    const left = x0 + m.c * cw;
    const top = y0 + m.r * ch;
    const digit = cellAt.get(`${m.r},${m.c}`);
    if (digit) {
      const w = glyphW(digit, textSize) / 2 + 2;
      const cx = left + cw / 2;
      const cy = top + ch / 2;
      svg.add(
        `<line data-ov="skip" x1="${n(cx - w)}" y1="${n(cy)}" x2="${n(cx + w)}" y2="${n(cy)}" ` +
          `stroke="${C.ink}" stroke-width="1.3" stroke-linecap="round"/>`
      );
    }
    if (!m.value) continue;
    const b = markBox(m.value, MARK_SIZE);
    svg.text(left + PAD, top + GAP + b.h / 2, m.value, {
      size: MARK_SIZE,
      anchor: "start",
      baseline: "middle",
      weight: 600,
      fill: C.ink,
      lang,
    });
  }
}

module.exports = { MARK_SIZE, resolveColLabels, resolveRegroup, regroupSizing, drawRegroup };
