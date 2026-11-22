// cycle — a closed ring of stage boxes joined by curved arrows, the last stage
// leading back to the first, with an optional centre title and optional labels
// on each arrow (what goes in or comes out at that step).
//
// VENDOR DIVERGENCE (bd-zrdvmi.51) — SYNC.md §3.43. The brief has shown the model
// `{"type": "cycle"}` as its copy-this shape (`dg-water-cycle`) while the engine had
// no such type, so every Krebs / water / carbon / cell / life cycle either threw
// "unknown diagram type" or was drawn as a straight flow that never closes.
//
// Layout invariants:
//   * stages sit on one circle, stage 1 at 12 o'clock, clockwise (lang:'ur' runs
//     anticlockwise, the way an Urdu reader starts on the right)
//   * the radius is solved from the measured boxes, so neighbours never touch and
//     the centre title always clears the ring
//   * every arrow is an arc ON the ring, from the edge of one box to the edge of
//     the next; arrow labels are pushed radially outward until they clear every box
//   * the canvas is the bounding box of what was placed, so nothing is clipped

const { Svg, C, SIZE, LEADING, measure, wrap, hasUrdu, urduBoxH } = require("../lib/svg");
const { SERIES } = require("../lib/tokens");

const UR_PAD = 1.35; // Nastaliq renders up to ~35% wider than measure() predicts
const isUr = (s) => hasUrdu(String(s ?? ""));
const tw = (s, size, o = {}) => (isUr(s) ? measure(s, size, { lang: "ur" }) * UR_PAD : measure(s, size, o));

function blockH(s, size, w, weight) {
  if (s === undefined || s === null || s === "") return 0;
  if (isUr(s)) return urduBoxH(s, size, w);
  return wrap(String(s), size, w, { weight }).length * size * LEADING.latin;
}

/** Wrapped, centred text block whose vertical middle is cy. */
function drawCentred(svg, cx, cy, w, h, s, o) {
  if (s === undefined || s === null || s === "") return;
  if (isUr(s)) {
    svg.text(cx, cy, s, { ...o, anchor: "middle", baseline: "middle", w, h, lang: "ur" });
    return;
  }
  const lines = wrap(String(s), o.size, w, o);
  const lh = o.size * LEADING.latin;
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) =>
    svg.text(cx, y0 + i * lh, ln, { ...o, anchor: "middle", baseline: "middle", lang: "en" })
  );
}

const MIN_W = 84;
const MAX_W = 150;
const MAX_CENTRE_W = 150;
const PAD = 8; // clearance kept around every box

const asStage = (s) => (s && typeof s === "object" ? { ...s, label: s.label ?? s.title } : { label: s });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inflate = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const inside = (r, x, y) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;

function render(spec) {
  const ur = spec.lang === "ur";
  const raw = (Array.isArray(spec.stages) ? spec.stages : []).filter((s) => s !== undefined && s !== null);
  const stages = (raw.length ? raw : [{ label: "" }]).slice(0, 10).map(asStage);
  const n = stages.length;
  const arrowLabels = Array.isArray(spec.arrowLabels) ? spec.arrowLabels : [];
  const centre = spec.centre && typeof spec.centre === "object" ? spec.centre.label : spec.centre;
  const sz = { stage: ur ? 15.5 : SIZE.label, line: ur ? 14 : SIZE.small, tag: ur ? 13 : SIZE.small, centre: ur ? 17 : SIZE.title };

  // ---- stage boxes, sized to their own text ----
  const boxes = stages.map((s, i) => {
    const lines = (Array.isArray(s.lines) ? s.lines : []).filter(Boolean).slice(0, 2);
    const natural = Math.max(tw(s.label, sz.stage, { weight: 700 }), ...lines.map((l) => tw(l, sz.line)));
    const w = Math.min(ur ? MAX_W + 26 : MAX_W, Math.max(MIN_W, Math.ceil(natural) + 28));
    const lh = lines.map((l) => blockH(l, sz.line, w - 16, 400));
    const labH = blockH(s.label, sz.stage, w - 16, 700);
    const h = Math.max(36, labH + lh.reduce((a, b) => a + b + 4, 0) + 18);
    return { s, i, w, h, lines, lh, labH, colour: s.color || SERIES[i % SERIES.length] };
  });

  // ---- radius: neighbours clear each other, the ring clears the centre title ----
  const centreW = centre ? Math.min(MAX_CENTRE_W, Math.ceil(tw(centre, sz.centre, { weight: 700 })) + 12) : 0;
  const centreH = centre ? blockH(centre, sz.centre, centreW, 700) : 0;
  const diag = Math.max(...boxes.map((b) => Math.hypot(b.w, b.h)));
  const step = (2 * Math.PI) / n;
  const R = Math.max(
    110,
    n > 1 ? (diag + 2 * PAD + 34) / (2 * Math.sin(Math.min(step, Math.PI) / 2)) : 0,
    diag / 2 + Math.hypot(centreW, centreH) / 2 + 2 * PAD
  );
  const dir = ur ? -1 : 1;
  const angle = (i) => -Math.PI / 2 + dir * i * step;
  const at = (a, r = R) => [r * Math.cos(a), r * Math.sin(a)];
  boxes.forEach((b) => {
    const [x, y] = at(angle(b.i));
    Object.assign(b, { cx: x, cy: y, x: x - b.w / 2, y: y - b.h / 2 });
  });

  // ---- arcs: from the edge of box i to the edge of box i+1, along the ring ----
  const exitAngle = (b, sign) => {
    const box = inflate(b, 5);
    let a = angle(b.i);
    for (let k = 0; k < 720 && inside(box, ...at(a)); k++) a += sign * dir * (Math.PI / 360);
    return a;
  };
  const arcs = boxes.map((b, i) => {
    const nb = boxes[(i + 1) % n];
    const a1 = exitAngle(b, 1);
    let a2 = exitAngle(nb, -1);
    if (n === 1) a2 = a1 + dir * (2 * Math.PI - 2 * Math.abs(a1 - angle(0)));
    // unwrap so a2 lies ahead of a1 in the travel direction
    while (dir * (a2 - a1) <= 0) a2 += dir * 2 * Math.PI;
    return { a1, a2, mid: (a1 + a2) / 2, label: arrowLabels[i] };
  });

  // ---- arrow labels: radially outward until they clear every box and label ----
  const placedLabels = [];
  const stageRects = boxes.map((b) => inflate(b, PAD / 2));
  for (const arc of arcs) {
    if (!arc.label) continue;
    const t = String(arc.label);
    const w = isUr(t) ? measure(t, sz.tag, { lang: "ur" }) * UR_PAD + 10 : tw(t, sz.tag) + 4;
    const h = isUr(t) ? urduBoxH(t, sz.tag, w) : sz.tag * LEADING.latin;
    const half = Math.abs(Math.cos(arc.mid)) * (w / 2) + Math.abs(Math.sin(arc.mid)) * (h / 2);
    let r = R + 10 + half;
    let rect;
    for (let k = 0; k < 80; k++, r += 6) {
      const [x, y] = at(arc.mid, r);
      rect = { x: x - w / 2, y: y - h / 2, w, h, text: t };
      const hit = stageRects.some((s) => overlaps(s, rect)) || placedLabels.some((p) => overlaps(inflate(p, 3), rect));
      if (!hit) break;
    }
    placedLabels.push(rect);
  }

  // ---- canvas = bounding box of everything placed ----
  const all = [...boxes, ...placedLabels, { x: -R, y: -R, w: 2 * R, h: 2 * R }];
  const M = 8;
  const minX = Math.min(...all.map((r) => r.x)) - M;
  const minY = Math.min(...all.map((r) => r.y)) - M;
  const W = Math.max(...all.map((r) => r.x + r.w)) + M - minX;
  const H = Math.max(...all.map((r) => r.y + r.h)) + M - minY;
  const X = (x) => x - minX;
  const Y = (y) => y - minY;

  const svg = new Svg(W, H, { title: spec.title, caption: spec.caption, source: spec.source, note: spec.note, lang: spec.lang, spec });
  const stroke = spec.arrowColor || C.ink;

  for (const arc of arcs) {
    // The arc is emitted as short straight runs, not an SVG `A` command: measure.js's
    // flattenPath reads only M/L/H/V/C/Q/Z, so an `A` would be invisible to the
    // line-through-label gate (and mis-read as chords).
    const [x2, y2] = at(arc.a2);
    const k = Math.max(2, Math.ceil(Math.abs(arc.a2 - arc.a1) / (Math.PI / 60)));
    const pts = Array.from({ length: k + 1 }, (_, j) => at(arc.a1 + ((arc.a2 - arc.a1) * j) / k));
    svg.path(
      pts.map(([x, y], j) => `${j ? "L" : "M"}${X(x).toFixed(2)},${Y(y).toFixed(2)}`).join(" "),
      { fill: "none", stroke, sw: 2, cap: "round", join: "round", class: "cycle-arrow" }
    );
    // tangent at the end point, in the travel direction
    svg.head(X(x2), Y(y2), -dir * Math.sin(arc.a2), dir * Math.cos(arc.a2), { stroke });
  }

  for (const p of placedLabels) {
    const cx = X(p.x + p.w / 2);
    const cy = Y(p.y + p.h / 2);
    if (isUr(p.text)) svg.text(cx, cy, p.text, { size: sz.tag, anchor: "middle", baseline: "middle", fill: C.muted, lang: "ur", w: p.w, h: p.h });
    else svg.text(cx, cy, p.text, { size: sz.tag, anchor: "middle", baseline: "middle", fill: C.muted, lang: "en" });
  }

  for (const b of boxes) {
    svg.rect(X(b.x), Y(b.y), b.w, b.h, { rx: 9, fill: C.paper, stroke: b.colour, sw: 1.8 });
    const inner = b.w - 16;
    let y = Y(b.y) + 9;
    drawCentred(svg, X(b.cx), y + b.labH / 2, inner, b.labH, b.s.label, { size: sz.stage, weight: 700, fill: C.ink });
    y += b.labH;
    b.lines.forEach((l, k) => {
      y += 4;
      drawCentred(svg, X(b.cx), y + b.lh[k] / 2, inner, b.lh[k], l, { size: sz.line, fill: C.text });
      y += b.lh[k];
    });
  }

  if (centre) drawCentred(svg, X(0), Y(0), centreW, centreH, centre, { size: sz.centre, weight: 700, fill: C.ink });

  return svg.toString();
}

module.exports = {
  type: "cycle",
  aliases: ["ring", "cyclic_process", "life_cycle"],
  summary: "Closed ring of stage boxes on curved arrows, last stage back to the first; optional centre title and arrow labels.",
  render,
  examples: [
    {
      name: "cycle_krebs",
      spec: {
        type: "cycle",
        title: "THE KREBS CYCLE",
        centre: "Krebs cycle",
        stages: ["Acetyl CoA (2C) joins", "Citric acid (6C)", "Loses CO₂ (5C)", "Loses CO₂ (4C)", "Makes ATP, FADH₂", "Oxaloacetate (4C) again"],
        arrowLabels: ["", "NADH", "CO₂ + NADH", "CO₂ + NADH", "NADH", ""],
        caption: "Each turn: 2 CO₂, 3 NADH, 1 FADH₂, 1 ATP.",
      },
    },
    {
      name: "cycle_water_ur",
      spec: {
        type: "cycle",
        lang: "ur",
        centre: "آبی چکر",
        stages: ["بخارات بننا", "بادل بننا", "بارش", "پانی کا جمع ہونا"],
        arrowLabels: ["سورج کی گرمی", "ٹھنڈک", "", ""],
      },
    },
  ],
};
