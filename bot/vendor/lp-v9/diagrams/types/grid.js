// grid — an N x M grid with shaded cells. Percentages, fractions, decimals,
// area models, arrays for multiplication.
//
// Reference implementation: every other type module follows this shape.
//   module.exports = { type, aliases, summary, render(spec)->svgString, examples[] }

const { Svg, C, SIZE, urduBoxH, textBox, measure, hasUrdu } = require("../lib/svg");

/** Reduce a fraction for the auto caption. */
function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

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

function render(spec) {
  const rows = spec.rows ?? 10;
  const cols = spec.cols ?? 10;
  const cell = spec.cellSize ?? (cols > 12 || rows > 12 ? 22 : 30);
  const pad = 8;
  const shaded = resolveShaded(spec, rows, cols);
  const shadeColor = spec.shadeColor || C.accent;
  const second = spec.shaded2 ? resolveShaded({ shaded: spec.shaded2 }, rows, cols) : null;
  const second2Color = spec.shade2Color || C.cool;

  const gw = cols * cell;
  const gh = rows * cell;

  // legend line, auto-built when not supplied
  let legend = spec.legend;
  if (legend === undefined && shaded.size) {
    const k = shaded.size;
    const t = rows * cols;
    const g = gcd(k, t) || 1;
    const pct = (k / t) * 100;
    const parts = [`${k}/${t}`];
    if (g > 1) parts.push(`= ${k / g}/${t / g}`);
    parts.push(`= ${Number(pct.toFixed(2))}%`);
    parts.push(`= ${Number((k / t).toFixed(4))}`);
    legend = parts.join(" ");
  }

  const legendH = legend ? SIZE.label * (spec.lang === "ur" ? 3.2 : 1.9) : 0;
  // Edge labels need their own gutter or an end-anchored Urdu box lands at a
  // negative x and is clipped away by the viewBox.
  const gutterL = spec.rowLabel ? (spec.lang === "ur" ? 54 : 26) : 0;
  const gutterT = spec.colLabel ? (spec.lang === "ur" ? 44 : 22) : 0;
  // THE CANVAS MUST FIT THE READOUT THIS TYPE GENERATES FOR ITSELF.
  // The legend above is built from rows/cols/shaded — "1/4 = 25% = 0.25" is 116 units at
  // SIZE.label — while the body used to be sized from the GRID alone. A 2x2 therefore
  // produced a 76-unit canvas carrying a readout wider than itself: the text ran edge to
  // edge, checkOverlaps flagged it against the page rect, and lint_lp.js's
  // DIAGRAM_OVERLAP — a HARD FAIL — rejected a minimal, entirely correct grid. The
  // failure only appears BELOW about 5x5, which is why a 10x10 hundred square never
  // showed it and why nobody had seen it. Measured with the engine's own estimator, so
  // the reservation and the drawing can never disagree.
  const legendW = legend
    ? measure(String(legend), SIZE.label, {
        lang: hasUrdu(String(legend)) ? "ur" : "en",
        weight: 700,
      })
    : 0;
  const bodyW = Math.max(gw + pad * 2 + gutterL, Math.ceil(legendW) + pad * 2);
  const bodyH = gh + pad * 2 + legendH + gutterT;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  // Centre the grid in whatever width the readout demanded, rather than pinning it left
  // and leaving a lopsided margin. With no readout, or a readout narrower than the grid,
  // this is exactly the old `pad + gutterL`.
  const x0 = gutterL + Math.max(pad, (bodyW - gutterL - gw) / 2);
  const y0 = pad + gutterT;

  // shaded cells first, so the rules sit on top
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const isA = shaded.has(i);
      const isB = second && second.has(i);
      if (!isA && !isB) continue;
      svg.rect(x0 + c * cell, y0 + r * cell, cell, cell, {
        fill: isA && isB ? C.leaf : isA ? shadeColor : second2Color,
        opacity: spec.shadeOpacity ?? 0.85,
      });
    }
  }

  // grid rules — drawn as lines (an SVG <pattern> is rasterised on PDF export)
  for (let r = 0; r <= rows; r++) {
    const major = spec.majorEvery && r % spec.majorEvery === 0;
    svg.line(x0, y0 + r * cell, x0 + gw, y0 + r * cell, {
      stroke: major ? C.ink : C.rule,
      sw: major ? 1.6 : 0.9,
    });
  }
  for (let c = 0; c <= cols; c++) {
    const major = spec.majorEvery && c % spec.majorEvery === 0;
    svg.line(x0 + c * cell, y0, x0 + c * cell, y0 + gh, {
      stroke: major ? C.ink : C.rule,
      sw: major ? 1.6 : 0.9,
    });
  }
  svg.rect(x0, y0, gw, gh, { stroke: C.ink, sw: 1.8, fill: "none" });

  // optional per-cell text
  if (Array.isArray(spec.cellText)) {
    spec.cellText.forEach((t) => {
      if (!t) return;
      const [r, c, txt] = t;
      svg.text(x0 + c * cell + cell / 2, y0 + r * cell + cell / 2, txt, {
        size: Math.min(SIZE.small, cell * 0.45),
        anchor: "middle",
        baseline: "middle",
        lang: spec.lang,
        fill: C.text,
      });
    });
  }

  // edge labels for area models: {rowLabel:'4', colLabel:'6'}
  // The label's BOX has to clear the grid, not just its baseline. An Urdu box is
  // ~2.2 em tall and hangs below the baseline, so `y0 - 6` put the digit inside
  // the first row of cells. Height comes from the shared estimators.
  const labelH = (s2) => {
    const ur = spec.lang === "ur" || hasUrdu(String(s2 ?? ""));
    if (!ur) return textBox(String(s2 ?? ""), SIZE.small, 0, 0, {}).h;
    const w = Math.max(measure(String(s2), SIZE.small, { lang: "ur" }) * 1.25 + SIZE.small, SIZE.small * 3);
    return urduBoxH(String(s2), SIZE.small, w);
  };
  if (spec.colLabel) {
    const h = labelH(spec.colLabel);
    svg.text(x0 + gw / 2, y0 - 5 - h / 2, spec.colLabel, {
      size: SIZE.small,
      anchor: "middle",
      baseline: "middle",
      weight: 700,
      fill: C.ink,
      lang: spec.lang,
      h,
    });
  }
  if (spec.rowLabel)
    svg.text(x0 - 8, y0 + gh / 2, spec.rowLabel, {
      size: SIZE.small,
      anchor: "end",
      baseline: "middle",
      weight: 700,
      fill: C.ink,
      lang: spec.lang,
    });

  if (legend) {
    svg.text(bodyW / 2, y0 + gh + legendH * 0.72, legend, {
      size: SIZE.label,
      anchor: "middle",
      weight: 700,
      fill: C.ink,
      lang: spec.lang,
      w: bodyW - 8,
    });
  }

  return svg.toString();
}

module.exports = {
  type: "grid",
  aliases: ["area_model", "hundred_square"],
  summary: "N x M grid with shaded cells — percentages, fractions, decimals, area models.",
  render,
  examples: [
    {
      name: "grid_percent_37",
      spec: {
        type: "grid",
        rows: 10,
        cols: 10,
        shaded: 37,
        majorEvery: 5,
        title: "37 out of 100",
        caption: "Each small square is one hundredth of the whole.",
      },
    },
    {
      name: "grid_area_model_ur",
      spec: {
        type: "grid",
        rows: 4,
        cols: 6,
        shaded: 24,
        cellSize: 34,
        colLabel: "۶",
        rowLabel: "۴",
        lang: "ur",
        title: "۴ × ۶ = ۲۴",
        legend: "۴ قطاریں × ۶ خانے = ۲۴ خانے",
        caption: "ضرب کا رقبہ ماڈل",
      },
    },
  ],
};
