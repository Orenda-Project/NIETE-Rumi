// grid — an N x M grid with shaded cells. Percentages, fractions, decimals,
// area models, arrays for multiplication.
//
// Reference implementation: every other type module follows this shape.
//   module.exports = { type, aliases, summary, render(spec)->svgString, examples[] }

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { resolveColLabels, resolveRegroup, regroupSizing, drawRegroup } = require("../lib/grid_notation");
const { blockH, resolveShaded, autoLegend, edgeLabelMetrics } = require("../lib/grid_cells");

function render(spec) {
  const rows = spec.rows ?? 10;
  const cols = spec.cols ?? 10;
  const cell = spec.cellSize ?? (cols > 12 || rows > 12 ? 22 : 30);
  const pad = 8;
  const shaded = resolveShaded(spec, rows, cols);
  const shadeColor = spec.shadeColor || C.accent;
  const second = spec.shaded2 ? resolveShaded({ shaded: spec.shaded2 }, rows, cols) : null;
  const second2Color = spec.shade2Color || C.cool;

  // ── Edge-label gutters ─────────────────────────────────────────────────────
  // Measured (grid_cells.edgeLabelMetrics) rather than fixed, then floored at the old
  // 26/22 (54/44 Urdu) constants so every existing area model keeps its geometry to the
  // unit while a long phrase label stops printing across the grid's own first column.
  const { labelW, labelH } = edgeLabelMetrics(spec);
  const gutterL = spec.rowLabel
    ? Math.max(spec.lang === "ur" ? 54 : 26, Math.ceil(labelW(spec.rowLabel)) + 10)
    : 0;
  // One header per COLUMN TRACK when the spec gives (or implies) one, else the single
  // centred label this type has always drawn. grid_notation.resolveColLabels owns the
  // decision and the refusal; here it is just a list of labels to reserve room for.
  const colHead = resolveColLabels(spec, cols);
  const heads = colHead.perColumn || (colHead.single ? [colHead.single] : []);
  const gutterT = heads.length
    ? Math.max(spec.lang === "ur" ? 44 : 22, Math.ceil(Math.max(...heads.map((s2) => labelH(s2)))) + 5)
    : 0;

  // ── Cell text decides the cell size ────────────────────────────────────────
  // Same law as the legend: THE CANVAS MUST FIT THE READOUT THIS TYPE GENERATES FOR
  // ITSELF. `cellText` was the one readout left out — it was drawn centred inside a
  // 30-unit cell at whatever length the author wrote, with no wrapping and no effect
  // on the geometry. A comparison table ("Registering for selective service" against
  // "Running for offices") therefore printed its two columns ON TOP OF EACH OTHER in
  // a 50-unit-wide figure. Cells now grow to the text and the text wraps inside them.
  const cellStrings = (Array.isArray(spec.cellText) ? spec.cellText : [])
    .filter((t) => t && t[2] != null && String(t[2]) !== "")
    .map((t) => String(t[2]));
  const smallSize = Math.min(SIZE.small, cell * 0.45);
  // A digit or a short token in an area model still fits the plain cell — leave that
  // path byte-identical, it is the overwhelmingly common case.
  const cellTextFits = cellStrings.every(
    (s) => measure(s, smallSize, { lang: hasUrdu(s) ? "ur" : "en" }) * 1.02 <= cell - 6
  );
  const textSize = cellTextFits ? smallSize : SIZE.small;
  let cw = cell;
  let ch = cell;
  if (!cellTextFits) {
    // Natural width the widest string wants, bounded so the canvas stays at the
    // ~640-unit norm the other multi-column types (panels) render at.
    const MAX_BODY = 640;
    const wNat = Math.ceil(
      Math.max(
        ...cellStrings.map((s) => measure(s, textSize, { lang: hasUrdu(s) ? "ur" : "en" }) * 1.02)
      ) + 12
    );
    const wMax = Math.max(cell, Math.floor((MAX_BODY - pad * 2 - gutterL) / cols));
    cw = Math.min(Math.max(cell, wNat), wMax);
    ch = Math.max(cell, Math.ceil(Math.max(...cellStrings.map((s) => blockH(s, textSize, cw - 12)))) + 8);
  }

  // Same law once more, for the two place-value notations: THE CELL MUST FIT WHAT IT
  // CARRIES. A per-column header wider than its track, or a renamed value that does not
  // clear the digit it sits beside, grows the cell rather than printing over its neighbour.
  // Neither branch can fire for a spec that uses neither key, so the corpus is untouched.
  const cellAt = new Map(
    (Array.isArray(spec.cellText) ? spec.cellText : [])
      .filter((t) => t && t[2] != null && String(t[2]) !== "")
      .map((t) => [`${t[0]},${t[1]}`, String(t[2])])
  );
  if (colHead.perColumn)
    cw = Math.max(cw, Math.ceil(Math.max(...colHead.perColumn.map((s) => labelW(s)))) + 6);
  const marks = resolveRegroup(spec);
  if (marks.length) {
    const need = regroupSizing(marks, cellAt, textSize);
    cw = Math.max(cw, need.minW);
    ch = Math.max(ch, need.minH);
  }

  const gw = cols * cw;
  const gh = rows * ch;

  const legend = autoLegend(spec, shaded.size, rows, cols);

  const legendH = legend ? SIZE.label * (spec.lang === "ur" ? 3.2 : 1.9) : 0;
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
  // ...and the colLabel is a readout too. It is centred on the GRID's centre, which sits
  // `gutterL / 2` right of the canvas centre, so the gutter is part of its reservation.
  // A per-column header row is never wider than the grid itself — `cw` grew to hold it.
  const colLabelW = colHead.perColumn ? 0 : labelW(colHead.single);
  const bodyW = Math.max(
    gw + pad * 2 + gutterL,
    Math.ceil(legendW) + pad * 2,
    Math.ceil(colLabelW) + pad * 2 + gutterL
  );
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
      svg.rect(x0 + c * cw, y0 + r * ch, cw, ch, {
        fill: isA && isB ? C.leaf : isA ? shadeColor : second2Color,
        opacity: spec.shadeOpacity ?? 0.85,
      });
    }
  }

  // grid rules — drawn as lines (an SVG <pattern> is rasterised on PDF export)
  for (let r = 0; r <= rows; r++) {
    const major = spec.majorEvery && r % spec.majorEvery === 0;
    svg.line(x0, y0 + r * ch, x0 + gw, y0 + r * ch, {
      stroke: major ? C.ink : C.rule,
      sw: major ? 1.6 : 0.9,
    });
  }
  for (let c = 0; c <= cols; c++) {
    const major = spec.majorEvery && c % spec.majorEvery === 0;
    svg.line(x0 + c * cw, y0, x0 + c * cw, y0 + gh, {
      stroke: major ? C.ink : C.rule,
      sw: major ? 1.6 : 0.9,
    });
  }
  svg.rect(x0, y0, gw, gh, { stroke: C.ink, sw: 1.8, fill: "none" });

  // optional per-cell text — one line centred in the cell when it fits, wrapped and
  // vertically centred when the cell had to grow to hold it.
  if (Array.isArray(spec.cellText)) {
    spec.cellText.forEach((t) => {
      if (!t) return;
      const [r, c, txt] = t;
      if (txt == null || String(txt) === "") return;
      const cx = x0 + c * cw + cw / 2;
      const cy = y0 + r * ch + ch / 2;
      if (cellTextFits) {
        svg.text(cx, cy, txt, {
          size: textSize,
          anchor: "middle",
          baseline: "middle",
          lang: spec.lang,
          fill: C.text,
        });
        return;
      }
      const boxW = cw - 12;
      const h = blockH(txt, textSize, boxW);
      svg.textBlock(cx, cy - h / 2, boxW, String(txt), {
        size: textSize,
        anchor: "middle",
        lang: spec.lang,
        fill: C.text,
      });
    });
  }

  // Regrouping marks go on TOP of the digits they rename — document order is what puts the
  // strike over the glyph rather than under it.
  if (marks.length)
    drawRegroup(svg, marks, { x0, y0, cw, ch, cellAt, textSize, lang: spec.lang });

  // edge labels for area models: {rowLabel:'4', colLabel:'6'}
  // The label's BOX has to clear the grid, not just its baseline. An Urdu box is
  // ~2.2 em tall and hangs below the baseline, so `y0 - 6` put the digit inside
  // the first row of cells. Height comes from the shared estimators.
  // (`labelH` is declared with the gutters above — the reservation and the draw have to be
  // the same number, so they share one helper.)
  const head = (x, s2) => {
    const h = labelH(s2);
    svg.text(x, y0 - 5 - h / 2, s2, {
      size: SIZE.small,
      anchor: "middle",
      baseline: "middle",
      weight: 700,
      fill: C.ink,
      lang: spec.lang,
      h,
    });
  };
  if (colHead.perColumn)
    colHead.perColumn.forEach((s2, c) => s2 && head(x0 + c * cw + cw / 2, s2));
  else if (colHead.single) head(x0 + gw / 2, colHead.single);
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
