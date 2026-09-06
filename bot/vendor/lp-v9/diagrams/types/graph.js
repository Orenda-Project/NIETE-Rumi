// graph — a Cartesian plot: gridlines, axes with arrowheads, ticks with
// numeric labels, sampled function curves, plotted points and straight
// segments (distance-time, cost-quantity, any two-point line).
//
// Deliberately dependency-free. Two rules the drawing obeys:
//
//   * gridlines are repeated <line>s, never an SVG <pattern> — a pattern
//     rasterises when headless Chromium prints the lesson plan to PDF.
//   * the plot is clipped by SKIPPING out-of-window samples and interpolating
//     the crossing point, never by a <clipPath> — so 1/x breaks at the
//     asymptote instead of drawing a spike through the whole figure.

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");

const fin = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const MINUS = "−";

/** Place a label so an Urdu foreignObject cannot drift off its anchor. */
function lab(svg, x, y, s, o = {}) {
  const str = String(s ?? "");
  if (!str) return;
  const align = o.align || "center";
  // `plate:true` -> the label rides on an opaque plate. Axis ticks sit ON the
  // gridlines when the axis is inside the plot, and a curve can pass through any
  // of them; the plate is what keeps the number readable and is what makes the
  // crossing legal (see lib/measure.js checkOverlaps).
  // `plate` is pulled OUT of `o` here and never forwarded. It is this function's
  // own boolean "use a plate?" switch, but svg.plateText() has an option of the
  // exact same name meaning something else entirely — an explicit plate FILL
  // COLOUR. Forwarding the boolean verbatim made every tick/point/curve label
  // plate render `fill="true"`, which is not a colour, so SVG's fallback for an
  // invalid paint (black) is what actually painted: solid black plates on every
  // graph this type ever drew. plateText() also type-guards this at the sink
  // (diagrams/lib/svg.js), so the two fixes are belt and braces — this one keeps
  // the flag from leaking into ANY future option of the same name.
  const { plate, ...rest } = o;
  const draw = plate ? (a, b, t, oo) => svg.plateText(a, b, t, oo) : (a, b, t, oo) => svg.text(a, b, t, oo);
  if (!hasUrdu(str)) {
    draw(x, y, str, {
      ...rest,
      anchor: align === "center" ? "middle" : align === "right" ? "end" : "start",
    });
    return;
  }
  const w = o.w ?? Math.max(46, measure(str, o.size ?? SIZE.small, { lang: "ur" }) * 1.3 + 12);
  if (align === "center") draw(x, y, str, { ...rest, anchor: "middle", w, lang: "ur" });
  else if (align === "right") draw(x - w, y, str, { ...rest, anchor: "start", w, lang: "ur" });
  else draw(x + w, y, str, { ...rest, anchor: "end", w, lang: "ur" });
}

/* ------------------------------------------------------------------ */
/* the expression sandbox                                              */
/* ------------------------------------------------------------------ */
const ALLOWED_IDS = new Set([
  "x", "sin", "cos", "tan", "sqrt", "abs", "exp", "log", "pow", "PI", "E",
]);
const ARGS = ["x", "sin", "cos", "tan", "sqrt", "abs", "exp", "log", "pow", "PI", "E"];
const VALUES = [
  Math.sin, Math.cos, Math.tan, Math.sqrt, Math.abs, Math.exp, Math.log, Math.pow, Math.PI, Math.E,
];

/**
 * Compile a small arithmetic string to (x)=>number. Whitelist-checked twice:
 * once on the raw characters, once on every identifier it contains. Returns
 * null — never throws — for anything that does not pass, so a bad spec loses
 * one curve rather than the whole lesson-plan page.
 */
function compile(expr) {
  const s = String(expr ?? "");
  if (!s.trim()) return null;
  if (/[^0-9a-zA-Z_+\-*/^().,\s]/.test(s)) return null;
  const ids = s.match(/[a-zA-Z_][a-zA-Z_0-9]*/g) || [];
  for (const id of ids) if (!ALLOWED_IDS.has(id)) return null;
  // `^` is the author's power operator; JS spells it `**`. One wrinkle: JS
  // makes `-x**2` a SyntaxError (it refuses to guess the precedence), and
  // "-x^2" is exactly what a maths teacher writes. Re-bracket that one shape
  // to what the maths means — −(x²) — and leave everything else alone.
  const body = s
    .replace(/\^/g, "**")
    .replace(
      /(^|[(,+\-*/])(\s*)-\s*([A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?)\s*\*\*\s*([A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?)/g,
      "$1$2(-($3**$4))"
    );
  let f;
  try {
    // eslint-disable-next-line no-new-func
    f = new Function(...ARGS, `"use strict"; return (${body});`);
  } catch (e) {
    return null;
  }
  return (x) => {
    try {
      const v = f(x, ...VALUES);
      return typeof v === "number" ? v : NaN;
    } catch (e) {
      return NaN;
    }
  };
}

/** Nice numeric tick label: no float dust, a real minus sign. */
function fmt(v) {
  const r = Math.round(v * 1e6) / 1e6;
  if (Object.is(r, -0)) return "0";
  return String(r).replace(/^-/, MINUS);
}

function tickList(min, max, step, given) {
  if (Array.isArray(given) && given.length) {
    return given.map((t) => (typeof t === "number" ? { at: t, label: fmt(t) } : t)).filter(Boolean);
  }
  const out = [];
  const s = step > 0 ? step : (max - min) / 8;
  const first = Math.ceil((min - 1e-9) / s) * s;
  for (let v = first, i = 0; v <= max + 1e-9 && i < 200; v += s, i++) {
    out.push({ at: Math.round(v * 1e9) / 1e9, label: fmt(v) });
  }
  return out;
}

/** Sample a function across the window, breaking wherever it leaves it. */
function sample(f, xMin, xMax, yMin, yMax, n) {
  const segs = [];
  let cur = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const x = xMin + ((xMax - xMin) * i) / n;
    const y = f(x);
    const ok = Number.isFinite(y) && y >= yMin && y <= yMax;
    if (ok) {
      if (prev && !prev.ok && Number.isFinite(prev.y) && prev.y !== y) {
        const yb = prev.y > yMax ? yMax : yMin;
        const t = (yb - prev.y) / (y - prev.y);
        if (t > 0 && t < 1) cur.push([prev.x + t * (x - prev.x), yb]);
      }
      cur.push([x, y]);
    } else {
      if (cur.length && prev && prev.ok && Number.isFinite(y) && prev.y !== y) {
        const yb = y > yMax ? yMax : yMin;
        const t = (yb - prev.y) / (y - prev.y);
        if (t > 0 && t < 1) cur.push([prev.x + t * (x - prev.x), yb]);
      }
      if (cur.length > 1) segs.push(cur);
      cur = [];
    }
    prev = { x, y, ok };
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

/* ------------------------------------------------------------------ */
/* the drawn extent — what the lint's orientation check reads          */
/* ------------------------------------------------------------------ */
/**
 * The box the plot ACTUALLY draws inside its own window: the x-range and the
 * y-range covered by the curves and straight segments, after window clipping.
 * Points are deliberately EXCLUDED — the whole purpose is to ask whether a
 * point agrees with the locus it is supposed to sit on.
 *
 * Returns null when there is no locus (a points-only scatter), because then
 * there is nothing for a point to disagree with. Shares this file's expression
 * sandbox and sampler on purpose: the lint must measure the same curve the
 * page draws, not a second implementation of it.
 *
 * bd-gel97.
 */
function drawnExtent(spec) {
  if (!spec || typeof spec !== "object") return null;
  const xMin = fin(spec.xMin, -5);
  const xMax = fin(spec.xMax, xMin + 10);
  const yMin = fin(spec.yMin, -5);
  const yMax = fin(spec.yMax, yMin + 10);
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  let n = 0;
  const take = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x);
    lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y);
    n++;
  };
  for (const f of Array.isArray(spec.functions) ? spec.functions : []) {
    if (!f) continue;
    const fn = typeof f.fn === "function" ? f.fn : compile(f.expr);
    if (!fn) continue;
    for (const seg of sample(fn, xMin, xMax, yMin, yMax, 200)) for (const [x, y] of seg) take(x, y);
  }
  for (const s of Array.isArray(spec.segments) ? spec.segments : []) {
    if (!s || !Array.isArray(s.from) || !Array.isArray(s.to)) continue;
    take(Number(s.from[0]), Number(s.from[1]));
    take(Number(s.to[0]), Number(s.to[1]));
  }
  if (!n) return null;
  return { x: [lo[0], hi[0]], y: [lo[1], hi[1]], samples: n };
}

function render(spec) {
  const xMin = fin(spec.xMin, -5);
  const xMax = fin(spec.xMax, xMin + 10);
  const yMin = fin(spec.yMin, -5);
  const yMax = fin(spec.yMax, yMin + 10);
  const xR = xMax - xMin || 1;
  const yR = yMax - yMin || 1;

  const fns = (Array.isArray(spec.functions) ? spec.functions : [])
    .map((f, i) => {
      if (!f) return null;
      const fn = typeof f.fn === "function" ? f.fn : compile(f.expr);
      if (!fn) return null;
      return {
        fn,
        label: f.label,
        color: f.color,
        dash: f.dash,
        shade: f.shade,
        shadeColor: f.shadeColor,
        shadeOpacity: f.shadeOpacity,
        i,
      };
    })
    .filter(Boolean);
  const pts = (Array.isArray(spec.points) ? spec.points : []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  const segsIn = (Array.isArray(spec.segments) ? spec.segments : []).filter(
    (s) => s && Array.isArray(s.from) && Array.isArray(s.to)
  );

  const legendItems =
    spec.legend === false
      ? []
      : fns.filter((f) => f.label).length + segsIn.filter((s) => s.legend).length > 1
      ? [
          ...fns.filter((f) => f.label).map((f) => ({ label: f.label, color: f.color, dash: f.dash })),
          ...segsIn.filter((s) => s.legend).map((s) => ({ label: s.label, color: s.color, dash: s.dash })),
        ]
      : [];

  const bodyW = fin(spec.width, 620);
  const padL = 46 + (spec.yLabel ? 22 : 0);
  const padR = 26;
  const padT = 16;
  const plotW = bodyW - padL - padR;
  const plotH = Math.round(plotW * fin(spec.aspect, 0.62));

  const X = (v) => padL + ((v - xMin) / xR) * plotW;
  const Y = (v) => padT + plotH - ((v - yMin) / yR) * plotH;

  const axisInsideY = yMin <= 0 && yMax >= 0; // x-axis drawn through the plot
  const axisInsideX = xMin <= 0 && xMax >= 0;
  const xAxisY = axisInsideY ? Y(0) : padT + plotH;
  const yAxisX = axisInsideX ? X(0) : padL;

  const xTickH = xAxisY > padT + plotH - 24 ? 24 : 8;
  const xLabelH = spec.xLabel ? 24 : 0;
  const legendH = legendItems.length ? 26 : 0;
  const bodyH = padT + plotH + xTickH + xLabelH + legendH;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  const xTicks = tickList(xMin, xMax, fin(spec.xStep, 0), spec.xTicks);
  const yTicks = tickList(yMin, yMax, fin(spec.yStep, 0), spec.yTicks);

  /* ---- gridlines: repeated <line>, never a <pattern> ---- */
  if (spec.grid !== false) {
    for (const t of xTicks)
      svg.line(X(t.at), padT, X(t.at), padT + plotH, { stroke: C.rule, sw: 0.9 });
    for (const t of yTicks)
      svg.line(padL, Y(t.at), padL + plotW, Y(t.at), { stroke: C.rule, sw: 0.9 });
  }
  svg.rect(padL, padT, plotW, plotH, { fill: "none", stroke: C.rule, sw: 1.1 });

  /* ---- axes with arrowheads ---- */
  svg.arrow(padL - 4, xAxisY, padL + plotW + 12, xAxisY, {
    stroke: C.ink,
    sw: 1.7,
    size: 9,
    both: axisInsideX && xMin < 0,
  });
  svg.arrow(yAxisX, padT + plotH + 4, yAxisX, padT - 12, {
    stroke: C.ink,
    sw: 1.7,
    size: 9,
    both: axisInsideY && yMin < 0,
  });

  /* ---- tick marks + numeric labels ----
     Drawn LAST (see the call below the points): when the axis sits inside
     the plot, a curve, a gridline and a plotted point all run through the
     tick numbers. Each number rides an opaque plate, and a plate only hides
     what was painted before it — so the ticks have to come after the data. */
  const ts = SIZE.small;
  const drawTicks = () => {
  for (const t of xTicks) {
    const px = X(t.at);
    if (Math.abs(t.at) < 1e-9 && axisInsideX) continue; // the shared origin label
    svg.line(px, xAxisY - 4, px, xAxisY + 4, { stroke: C.ink, sw: 1.3 });
    lab(svg, px, xAxisY + 6 + ts * 0.9, t.label, { size: ts, align: "center", fill: C.muted, plate: true });
  }
  for (const t of yTicks) {
    const py = Y(t.at);
    if (Math.abs(t.at) < 1e-9 && axisInsideY) continue;
    svg.line(yAxisX - 4, py, yAxisX + 4, py, { stroke: C.ink, sw: 1.3 });
    lab(svg, yAxisX - 8, py, t.label, {
      size: ts,
      align: "right",
      baseline: "middle",
      fill: C.muted,
      plate: true,
    });
  }
  if (axisInsideX && axisInsideY) {
    lab(svg, X(0) - 7, Y(0) + 6 + ts * 0.9, "0", { size: ts, align: "right", fill: C.muted, plate: true });
  }

  };

  /* ---- straight segments ---- */
  segsIn.forEach((s, i) => {
    const color = s.color || C.cool;
    svg.line(X(s.from[0]), Y(s.from[1]), X(s.to[0]), Y(s.to[1]), {
      stroke: color,
      sw: 2.6,
      dash: s.dash,
      cap: "round",
    });
    if (s.label && !s.legend) {
      const ax = X(s.from[0]);
      const ay = Y(s.from[1]);
      const bx = X(s.to[0]);
      const by = Y(s.to[1]);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      // Offset along the segment's own normal, not straight up: a steep line
      // eats a vertical offset and the label lands on the stroke.
      const len = Math.hypot(bx - ax, by - ay) || 1;
      let nx = -(by - ay) / len;
      let ny = (bx - ax) / len;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const d = fin(s.offset, 16);
      lab(svg, mx + fin(s.dx, nx * d), my + fin(s.dy, ny * d), s.label, {
        size: ts,
        align: nx > 0.3 ? "left" : nx < -0.3 ? "right" : "center",
        baseline: "middle",
        weight: 700,
        fill: color,
        lang: spec.lang,
        plate: true,
      });
    }
  });

  /* ---- the curves ---- */
  const nSamples = Math.max(40, Math.min(600, Math.round(fin(spec.samples, 200))));
  fns.forEach((f) => {
    const color = f.color || [C.ink, C.warn, C.leaf, C.plum][f.i % 4];
    const segs = sample(f.fn, xMin, xMax, yMin, yMax, nSamples);

    // Shaded half-plane (y > f(x) / y < f(x)): the standard textbook convention
    // for a linear (or any) inequality. Drawn from the SAME window-clipped
    // points sample() already produced for the curve itself — never a
    // <clipPath> (this file's own header rule: a pattern/clip rasterises in
    // Chromium's PDF pass) — closed against the plot's own top/bottom edge and
    // filled as a plain <polygon>. Two functions that both set `shade` overlap
    // where both inequalities hold, and since each fill is semi-transparent
    // that overlap reads visibly darker, which is exactly the right convention
    // for a system-of-inequalities figure with no extra code for it.
    //
    // Known limitation: if the curve leaves the window on the y-side OPPOSITE
    // the shaded side (e.g. shading "above" a line that dips below yMin), the
    // polygon covers only the curve's own visible x-range — the part beyond,
    // which should also be fully shaded, is left blank. Fine for the case this
    // serves (a single line crossing the chosen window); a general fix would
    // have to reason about where the curve went off-window.
    if (f.shade === "above" || f.shade === "below") {
      const edgeY = f.shade === "above" ? padT : padT + plotH;
      for (const seg of segs) {
        if (seg.length < 2) continue;
        const sp = seg.map((p) => [X(p[0]), Y(p[1])]);
        const first = sp[0];
        const last = sp[sp.length - 1];
        svg.polygon([...sp, [last[0], edgeY], [first[0], edgeY]], {
          fill: f.shadeColor || color,
          opacity: f.shadeOpacity ?? 0.16,
        });
      }
    }

    for (const seg of segs) {
      svg.polyline(
        seg.map((p) => [X(p[0]), Y(p[1])]),
        { stroke: color, sw: 2.4, dash: f.dash, cap: "round", join: "round", fill: "none" }
      );
    }
    if (f.label && !legendItems.length && segs.length) {
      const seg = segs[segs.length - 1];
      const end = seg[seg.length - 1];
      const px = X(end[0]);
      const py = Math.min(padT + plotH - 6, Math.max(padT + 12, Y(end[1])));
      const right = px < padL + plotW * 0.72;
      lab(svg, px + (right ? 12 : -12), py - 9, f.label, {
        size: ts,
        align: right ? "left" : "right",
        weight: 700,
        fill: color,
        plate: true,
      });
    }
  });

  /* ---- plotted points ---- */
  pts.forEach((p) => {
    const px = X(p.x);
    const py = Y(p.y);
    const color = p.color || C.warn;
    if (p.style === "open") svg.circle(px, py, 5, { fill: C.paper, stroke: color, sw: 2.4 });
    else if (p.style === "cross") {
      svg.line(px - 6, py - 6, px + 6, py + 6, { stroke: color, sw: 2.4, cap: "round" });
      svg.line(px - 6, py + 6, px + 6, py - 6, { stroke: color, sw: 2.4, cap: "round" });
    } else svg.circle(px, py, 5, { fill: color, stroke: C.paper, sw: 1.4 });
    if (p.label) {
      const dx = fin(p.dx, 9);
      lab(svg, px + dx, py + fin(p.dy, -10), p.label, {
        size: ts,
        align: dx < 0 ? "right" : "left",
        weight: 700,
        fill: color,
        lang: spec.lang,
        plate: true,
      });
    }
  });

  drawTicks();

  /* ---- axis titles ---- */
  if (spec.xLabel) {
    lab(svg, padL + plotW / 2, padT + plotH + xTickH + xLabelH - 6, spec.xLabel, {
      size: SIZE.label,
      align: "center",
      weight: 700,
      fill: C.ink,
      lang: spec.lang,
      w: plotW,
    });
  }
  if (spec.yLabel) {
    const cx = 16;
    const cy = padT + plotH / 2;
    lab(svg, cx, cy, spec.yLabel, {
      size: SIZE.label,
      align: "center",
      weight: 700,
      fill: C.ink,
      lang: spec.lang,
      w: plotH,
      transform: `rotate(-90 ${r2(cx)} ${r2(cy)})`,
    });
  }

  /* ---- legend, in its own strip so it can never sit on a curve ---- */
  if (legendItems.length) {
    const y = bodyH - legendH / 2;
    const gapX = 22;
    const widths = legendItems.map((it) => 24 + measure(String(it.label), ts) + gapX);
    const total = widths.reduce((a, b) => a + b, 0) - gapX;
    let lx = padL + Math.max(0, (plotW - total) / 2);
    legendItems.forEach((it, i) => {
      const color = it.color || [C.ink, C.warn, C.leaf, C.plum][i % 4];
      svg.line(lx, y, lx + 18, y, { stroke: color, sw: 3, dash: it.dash, cap: "round" });
      lab(svg, lx + 24, y, it.label, {
        size: ts,
        align: "left",
        baseline: "middle",
        weight: 700,
        fill: C.text,
      });
      lx += widths[i];
    });
  }

  return svg.toString();
}

module.exports = {
  type: "graph",
  drawnExtent,
  aliases: ["plot", "function_plot"],
  summary:
    "Cartesian plot, ALWAYS with both axes named (xLabel + yLabel are required by lint_lp.js GRAPH_AXES; give the quantity and its unit, or \"x\"/\"y\" for a pure-maths curve). A graph reads (x-quantity) -> (y-quantity) and every plotted point is stated in that same order — sampled function curves (safe expression strings), plotted points, straight segments, gridlines and labelled axes. A function can set shade:'above'|'below' to fill the half-plane on one side of it, for inequality diagrams; two shaded functions overlap into a visibly darker region, which is the right convention for a system of inequalities.",
  render,
  examples: [
    {
      name: "graph_quadratic_roots",
      spec: {
        type: "graph",
        xMin: -3,
        xMax: 5,
        yMin: -6,
        yMax: 8,
        xStep: 1,
        yStep: 2,
        xLabel: "x",
        yLabel: "y",
        functions: [{ expr: "x*x - 2*x - 3", label: "y = x² − 2x − 3", color: C.ink }],
        points: [
          { x: -1, y: 0, label: "(−1, 0)", color: C.warn, dx: -10, dy: -12 },
          { x: 3, y: 0, label: "(3, 0)", color: C.warn, dx: 13, dy: 17 },
          { x: 1, y: -4, label: "vertex (1, −4)", color: C.leaf, dx: 10, dy: 16 },
        ],
        title: "Roots of y = x² − 2x − 3",
        caption: "The curve cuts the x-axis at x = −1 and x = 3, so (x + 1)(x − 3) = 0.",
      },
    },
    {
      name: "graph_distance_time",
      spec: {
        type: "graph",
        xMin: 0,
        xMax: 6,
        yMin: 0,
        yMax: 120,
        xStep: 1,
        yStep: 20,
        aspect: 0.6,
        xLabel: "Time (hours)",
        yLabel: "Distance from home (km)",
        segments: [
          { from: [0, 0], to: [3, 90], label: "30 km/h", color: C.cool },
          { from: [3, 90], to: [4, 90], label: "resting", color: C.clay },
          { from: [4, 90], to: [6, 30], label: "returning", color: C.warn },
        ],
        points: [
          { x: 3, y: 90, color: C.ink, dx: 9, dy: -12, label: "" },
          { x: 4, y: 90, color: C.ink, dx: 9, dy: -12, label: "" },
        ],
        title: "A journey read from its distance-time graph",
        caption: "A steeper line means a faster journey; a flat line means no movement at all.",
      },
    },
    {
      name: "graph_sin_cos",
      spec: {
        type: "graph",
        xMin: 0,
        xMax: 6.283185307,
        yMin: -1.4,
        yMax: 1.4,
        yStep: 0.5,
        aspect: 0.44,
        xTicks: [
          { at: 0, label: "0" },
          { at: 1.570796327, label: "π/2" },
          { at: 3.141592654, label: "π" },
          { at: 4.71238898, label: "3π/2" },
          { at: 6.283185307, label: "2π" },
        ],
        functions: [
          { expr: "sin(x)", label: "y = sin x", color: C.cool },
          { expr: "cos(x)", label: "y = cos x", color: C.warn, dash: "6 4" },
        ],
        xLabel: "x (radians)",
        yLabel: "y",
        title: "y = sin x and y = cos x over one full turn",
        caption: "The two curves are the same shape, a quarter turn apart.",
      },
    },
    {
      name: "graph_linear_inequality",
      spec: {
        type: "graph",
        xMin: -3,
        xMax: 5,
        yMin: -8,
        yMax: 10,
        xStep: 1,
        yStep: 2,
        functions: [{ expr: "2*x - 1", label: "y = 2x − 1", color: C.cool, dash: "6 4", shade: "above" }],
        xLabel: "x",
        yLabel: "y",
        title: "y > 2x − 1",
        caption:
          "The line is dashed because the inequality is strict — points ON it don't count. Every point in the shaded half-plane does.",
      },
    },
  ],
};
