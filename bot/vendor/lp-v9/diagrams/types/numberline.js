// numberline — a labelled number line.
//
// Covers the whole 6-12 arc of "the line": integers either side of zero,
// fractions on the thirds/quarters, decimals, jump arcs for addition and
// subtraction, and inequality rays with open/closed endpoints.
//
// A number line NEVER mirrors for Urdu — mathematics stays left-to-right in
// every Pakistani textbook. Only the prose (title, caption, word labels) is
// routed through the Urdu foreignObject; digits stay LTR unless the spec asks
// for Urdu digits explicitly, in which case the glyphs themselves are Urdu and
// `text()` detects them.

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { urduBoxH, textBox, ASCENT, DESCENT } = require("../lib/measure");

const fin = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const MINUS = "−"; // U+2212 MINUS SIGN — wider than a hyphen, reads as maths

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

const UR_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toUrduDigits = (s) => String(s).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]);

/** Place a label so an Urdu foreignObject cannot drift off its anchor.
 *  `align` is VISUAL: 'left' = text starts at x, 'right' = text ends at x. */
function lab(svg, x, y, s, o = {}) {
  const str = String(s ?? "");
  if (!str) return;
  const align = o.align || "center";
  if (!hasUrdu(str)) {
    svg.text(x, y, str, {
      ...o,
      anchor: align === "center" ? "middle" : align === "right" ? "end" : "start",
    });
    return;
  }
  const w = o.w ?? Math.max(46, measure(str, o.size ?? SIZE.small, { lang: "ur" }) * 1.3 + 12);
  if (align === "center") svg.text(x, y, str, { ...o, anchor: "middle", w, lang: "ur" });
  else if (align === "right") svg.text(x - w, y, str, { ...o, anchor: "start", w, lang: "ur" });
  else svg.text(x + w, y, str, { ...o, anchor: "end", w, lang: "ur" });
}

/* ── the labels that sit above the line ──────────────────────────────────────
 *
 * bd-fa86m. Operator, on grade 6 maths: "number line diagram is bleeding into
 * one another on page 3/6". Every point label used to be drawn centred on its
 * own tick at one fixed row, axisY - 14, with a flat 26px reserved for all of
 * them together. That is right for "here" and "x > −2" — the labels this type
 * was designed against — and wrong the moment a label is a sentence. Her page
 * carried three: "3 apples = 1 melon" at 3, "8 apples, after removing 2 from
 * the right pan" at 6, "8 apples, right pan" at 8. At 640 units across ten
 * steps a tick is 56 units apart and the middle label alone is ~250. The
 * renderer never measured one, never compared two, and had nowhere to move one
 * to, so they printed straight through each other.
 *
 * So they are measured and packed into rows now. Two rules hold this together:
 *
 *   1. The BOX USED TO PACK IS THE BOX lab() PAINTS. `labBox` reproduces both
 *      of lab()'s branches exactly — the Latin ascent/descent pair from
 *      lib/measure, and the Urdu foreignObject's own width formula and
 *      urduBoxH — and the width it computes is handed back to lab() as `o.w`
 *      so the two cannot drift. A packer that measures one box and paints
 *      another is the bug with extra arithmetic.
 *   2. NOTHING MOVES WHEN NOTHING COLLIDES. One row keeps the historic 26px
 *      zone and the historic axisY - 14 baseline, so every number line already
 *      in the gallery renders byte-for-byte as before.
 */

const GAP_X = 8; // clear space between two labels sharing a row
const GAP_Y = 4; // between rows
const ROW_BASE = 14; // row 0's baseline, unchanged from the single-row layout
const LAB_WEIGHT = 700; // these labels are bold, and bold is 5% wider — measure it as such

/** The box `lab()` will actually paint: width, ink above the baseline, ink below. */
function labBox(s, size) {
  const str = String(s ?? "");
  if (!hasUrdu(str)) {
    // textBox() is the function the collision checker itself reconstructs a
    // <text> with — bold's 5% and the 2% hinting slack included. Re-deriving
    // the width from measure() alone lost both and left every plate 7% narrow.
    return {
      w: textBox(str, size, 0, 0, { weight: LAB_WEIGHT }).w,
      up: size * ASCENT,
      down: size * DESCENT,
      uw: undefined,
    };
  }
  // Same two lines lab() uses for an Urdu label, and _urduText puts the box
  // bottom 0.95em under the requested baseline.
  const w = Math.max(46, measure(str, size, { lang: "ur" }) * 1.3 + 12);
  const h = urduBoxH(str, size, w);
  return { w, up: h - size * 0.95, down: size * 0.95, uw: w };
}

/**
 * Clamp each label inside the drawing, then drop it into the lowest row where
 * it touches nothing. Left-to-right, so a reader's eye follows the same order
 * the line does.
 * @returns {{items:Array, rowH:number[], zone:number}} `zone` is the height to
 *   reserve above the axis; it is never less than the historic 26.
 */
function packAbove(items, bodyW) {
  const placed = items.map((it) => {
    const box = labBox(it.text, it.size);
    const half = box.w / 2;
    // A label shoved off the edge is not "not overlapping", it is gone.
    const lo = Math.min(half + 1, bodyW / 2);
    const cx = Math.min(Math.max(it.x, lo), Math.max(lo, bodyW - half - 1));
    return { ...it, ...box, cx, left: cx - half, right: cx + half };
  });

  const rows = [];
  for (const it of placed.slice().sort((a, b) => a.left - b.left || a.right - b.right)) {
    let r = 0;
    while (rows[r] && rows[r].some((o) => it.left < o.right + GAP_X && o.left < it.right + GAP_X)) {
      r += 1;
    }
    (rows[r] = rows[r] || []).push(it);
    it.row = r;
  }

  const rowH = rows.map((row) => Math.max(...row.map((it) => it.up + it.down)));
  const stack = rowH.reduce((a, b) => a + b, 0) + GAP_Y * Math.max(0, rows.length - 1);
  const zone = rows.length ? Math.max(26, ROW_BASE - SIZE.small * DESCENT + stack) : 0;
  return { items: placed, rowH, zone };
}

/** Smallest "nice" step that keeps the line under ~12 major ticks. */
function niceStep(range) {
  const cands = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  for (const c of cands) if (range / c <= 12.0001) return c;
  return range / 10;
}

function plainLabel(v, spec) {
  const rounded = Math.round(v * 1e6) / 1e6;
  const s = String(spec.labelFormat === "integer" ? Math.round(v) : rounded).replace(/^-/, MINUS);
  return spec.urduDigits ? toUrduDigits(s) : s;
}

/** Stacked fraction: numerator, a real rule, denominator. Never "1/2". */
function drawFraction(svg, cx, top, value, den, o = {}) {
  const size = o.size ?? SIZE.small;
  const raw = Math.round(value * den);
  const g = gcd(raw, den);
  let nu = raw / g;
  const de = den / g;
  const neg = nu < 0;
  if (neg) nu = -nu;
  const nS = o.urdu ? toUrduDigits(String(nu)) : String(nu);
  const dS = o.urdu ? toUrduDigits(String(de)) : String(de);
  const fill = o.fill ?? C.text;

  if (de === 1) {
    // Whole number — no rule, sit it on the numerator baseline of its neighbours.
    const s = (neg ? MINUS : "") + nS;
    lab(svg, cx, top + size * 1.55, s, { size, align: "center", fill, weight: o.weight });
    return size * 2.3;
  }
  const barW = Math.max(measure(nS, size), measure(dS, size)) + 7;
  const midY = top + size * 1.12;
  lab(svg, cx, top + size * 0.92, nS, { size, align: "center", fill });
  svg.line(cx - barW / 2, midY, cx + barW / 2, midY, { stroke: fill, sw: 1.3, cap: "round" });
  lab(svg, cx, midY + size * 1.0, dS, { size, align: "center", fill });
  if (neg) {
    svg.text(cx - barW / 2 - 3, midY, MINUS, {
      size,
      anchor: "end",
      baseline: "middle",
      fill,
    });
  }
  return size * 2.3;
}

function render(spec) {
  const from = fin(spec.from, -5);
  const toRaw = fin(spec.to, from + 10);
  const to = toRaw === from ? from + 1 : toRaw;
  const range = to - from;

  const step = fin(spec.step, niceStep(range));
  const minorStep = fin(spec.minorStep, 0);
  const isFrac = spec.labelFormat === "fraction";
  const den = fin(spec.denominator, step < 1 ? Math.max(1, Math.round(1 / step)) : 1);

  const points = Array.isArray(spec.points) ? spec.points : [];
  const arcs = Array.isArray(spec.arcs) ? spec.arcs : [];
  const intervals = Array.isArray(spec.intervals) ? spec.intervals : [];

  const bodyW = fin(spec.width, 640);
  const marginX = 40;
  const x0 = marginX;
  const x1 = bodyW - marginX;
  const axisW = x1 - x0;
  const X = (v) => x0 + ((v - from) / range) * axisW;

  // Interval geometry is resolved up front because the label packer needs each
  // band's midpoint, and the packer has to run before anything vertical is
  // known — the height it asks for is what pushes the axis down the page.
  const ivGeom = intervals
    .filter(Boolean)
    .map((iv) => {
      const color = iv.color || C.cool;
      const hasL = typeof iv.from === "number" && isFinite(iv.from);
      const hasR = typeof iv.to === "number" && isFinite(iv.to);
      return {
        iv,
        color,
        hasL,
        hasR,
        a: hasL ? X(Math.max(from, iv.from)) : x0 - 14,
        b: hasR ? X(Math.min(to, iv.to)) : x1 + 14,
      };
    });

  const above = [];
  for (const g of ivGeom) {
    if (g.iv.label) {
      above.push({ x: (g.a + g.b) / 2, text: g.iv.label, size: SIZE.label, fill: g.color });
    }
  }
  for (const p of points) {
    if (p && typeof p.at === "number" && p.label) {
      above.push({ x: X(p.at), text: p.label, size: SIZE.small, fill: p.color || C.warn });
    }
  }
  const packed = packAbove(above, bodyW);
  const labelZone = packed.zone;

  // An arc has to clear whatever the labels grew to, or its own apex label
  // lands back on top of the stack the packing just untangled.
  const arcH = arcs.length
    ? Math.max(fin(spec.arcHeight, 40), labelZone + 10)
    : fin(spec.arcHeight, 40);
  const arcZone = arcs.length ? arcH + 24 : 0;
  const axisY = 10 + arcZone + labelZone;

  // Row 0 keeps the baseline it has always had; each row above sits on the ink
  // of the one below it, not on a guessed pitch.
  let floorY = axisY - ROW_BASE + SIZE.small * DESCENT;
  packed.rowH.forEach((h, r) => {
    for (const it of packed.items) if (it.row === r) it.y = floorY - it.down;
    floorY -= h + GAP_Y;
  });

  const tickSize = SIZE.small;
  const tickTop = axisY + 13;
  const tickH = isFrac ? tickSize * 2.4 : tickSize * 1.5;
  const bodyH = tickTop + tickH + 10;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  /* ---- minor ticks (drawn first, they sit under everything) ---- */
  if (minorStep > 0) {
    const nMinor = Math.round(range / minorStep);
    for (let i = 0; i <= nMinor; i++) {
      const v = from + i * minorStep;
      const x = X(v);
      svg.line(x, axisY - 4, x, axisY + 4, { stroke: C.faint, sw: 1 });
    }
  }

  /* ---- the axis itself: arrowheads at BOTH ends, the line continues ---- */
  svg.arrow(x0 - 20, axisY, x1 + 20, axisY, {
    both: true,
    stroke: C.ink,
    sw: 1.9,
    size: 10,
    width: 7,
  });

  /* ---- major ticks + labels ---- */
  const tickValues = Array.isArray(spec.ticks)
    ? spec.ticks.filter((v) => typeof v === "number")
    : (() => {
        const out = [];
        const count = Math.max(1, Math.round(range / step));
        for (let i = 0; i <= count; i++) out.push(from + i * step);
        return out;
      })();

  const labelEvery = Math.max(1, Math.round(fin(spec.labelEvery, tickValues.length > 15 ? 2 : 1)));

  tickValues.forEach((v, i) => {
    if (v < from - 1e-9 || v > to + 1e-9) return;
    const x = X(v);
    const isZero = Math.abs(v) < 1e-9;
    svg.line(x, axisY - (isZero ? 9 : 7), x, axisY + (isZero ? 9 : 7), {
      stroke: C.ink,
      sw: isZero ? 2 : 1.4,
    });
    if (i % labelEvery !== 0) return;
    if (isFrac) {
      drawFraction(svg, x, tickTop, v, den, {
        size: tickSize,
        urdu: !!spec.urduDigits,
        fill: isZero ? C.ink : C.text,
        weight: isZero ? 700 : undefined,
      });
    } else {
      lab(svg, x, tickTop + tickSize * 0.92, plainLabel(v, spec), {
        size: tickSize,
        align: "center",
        fill: isZero ? C.ink : C.text,
        weight: isZero ? 700 : undefined,
      });
    }
  });

  /* ---- intervals: a thick band ON the line, endpoints open or closed ---- */
  ivGeom.forEach(({ iv, color, hasL, hasR, a, b }) => {
    svg.line(a, axisY, b, axisY, { stroke: color, sw: 5.5, cap: "butt", opacity: 0.9 });
    if (!hasR) svg.head(x1 + 20, axisY, 1, 0, { stroke: color, size: 11, width: 8 });
    if (!hasL) svg.head(x0 - 20, axisY, -1, 0, { stroke: color, size: 11, width: 8 });
    const closedL = iv.closedLeft !== false;
    const closedR = iv.closedRight !== false;
    if (hasL)
      svg.circle(a, axisY, 5.5, {
        fill: closedL ? color : C.paper,
        stroke: color,
        sw: 2.4,
      });
    if (hasR)
      svg.circle(b, axisY, 5.5, {
        fill: closedR ? color : C.paper,
        stroke: color,
        sw: 2.4,
      });
  });

  /* ---- marked points ---- */
  points.forEach((p) => {
    if (!p || typeof p.at !== "number") return;
    const x = X(p.at);
    const color = p.color || C.warn;
    const style = p.style || "dot";
    if (style === "cross") {
      svg.line(x - 6, axisY - 6, x + 6, axisY + 6, { stroke: color, sw: 2.6, cap: "round" });
      svg.line(x - 6, axisY + 6, x + 6, axisY - 6, { stroke: color, sw: 2.6, cap: "round" });
    } else if (style === "open") {
      svg.circle(x, axisY, 5.5, { fill: C.paper, stroke: color, sw: 2.4 });
    } else {
      svg.circle(x, axisY, 5.5, { fill: color, stroke: color, sw: 1 });
    }
  });

  /* ---- jump arcs above the line ---- */
  arcs.forEach((arc) => {
    if (!arc || typeof arc.from !== "number" || typeof arc.to !== "number") return;
    const ax = X(arc.from);
    const bx = X(arc.to);
    const above = arc.above !== false;
    const h = fin(arc.height, arcH);
    const y = axisY - 3;
    // curveArrow's control point is offset by `bend` along the LEFT normal of
    // the travel direction, so the sign has to follow the direction of travel.
    const dirSign = bx >= ax ? -1 : 1;
    const bend = (above ? dirSign : -dirSign) * h * 2;
    const color = arc.color || C.plum;
    svg.curveArrow(ax, y, bx, y, { bend, stroke: color, sw: 2, size: 10, dash: arc.dash });
    if (arc.label) {
      const apexY = above ? y - h : y + h;
      lab(svg, (ax + bx) / 2, above ? apexY - 7 : apexY + SIZE.label, arc.label, {
        size: SIZE.label,
        align: "center",
        weight: 700,
        fill: color,
      });
    }
  });

  /* ---- the packed labels, painted LAST ----------------------------------
   *
   * Last, and on a plate when the figure has arcs. A jump arc leaves the line
   * AT a marked point and comes back down AT another, so near its two ends it
   * runs exactly where those points' labels are — the arc through "8 apples,
   * right pan" is the same complaint as the labels through each other, and
   * raising the arc cannot fix it, because the endpoints are fixed by what the
   * arc means. lib/measure names the remedy: a label on an opaque plate painted
   * after the line is not a collision, because on the page the plate genuinely
   * hides the stroke. Document order is what makes it true, so this pass has to
   * stay at the bottom of render().
   */
  packed.items.forEach((it) => {
    if (arcs.length) {
      svg.rect(it.left - 3, it.y - it.up - 1, it.w + 6, it.up + it.down + 2, {
        fill: C.paper,
        rx: 3,
      });
    }
    lab(svg, it.cx, it.y, it.text, {
      size: it.size,
      align: "center",
      weight: LAB_WEIGHT,
      fill: it.fill,
      w: it.uw,
    });
  });

  return svg.toString();
}

module.exports = {
  type: "numberline",
  aliases: ["number_line"],
  summary:
    "Number line — integers across zero, stacked fraction ticks, jump arcs for +/-, inequality rays with open/closed ends.",
  render,
  examples: [
    {
      name: "numberline_integers",
      spec: {
        type: "numberline",
        from: -5,
        to: 5,
        step: 1,
        labelFormat: "integer",
        points: [
          { at: -3, color: C.warn, style: "dot" },
          { at: 1, color: C.leaf, style: "dot" },
        ],
        arcs: [{ from: -3, to: 1, label: "+ 4", above: true }],
        title: "Adding on the number line: −3 + 4 = 1",
        caption: "Start at −3, jump four units to the right, land on 1.",
      },
    },
    {
      name: "numberline_thirds",
      spec: {
        type: "numberline",
        from: 0,
        to: 2,
        step: 1 / 3,
        labelFormat: "fraction",
        denominator: 3,
        points: [{ at: 5 / 3, color: C.accent, style: "dot", label: "here" }],
        title: "Thirds from 0 to 2",
        caption: "Every whole is cut into three equal parts, so 3/3 = 1 and 6/3 = 2.",
      },
    },
    {
      name: "numberline_inequality_ur",
      spec: {
        type: "numberline",
        from: -6,
        to: 6,
        step: 1,
        labelFormat: "integer",
        intervals: [
          {
            from: -2,
            closedLeft: false,
            label: "x > −2",
            color: C.cool,
          },
        ],
        lang: "ur",
        title: "عددی خط پر عدم مساوات",
        caption:
          "خالی دائرہ ظاہر کرتا ہے کہ منفی دو شامل نہیں ہے۔",
      },
    },
  ],
};
