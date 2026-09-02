// THE DEGENERACY CONTRACT — `checkDegenerate(svg)` returns [] for a diagram that teaches and
// one row per defect otherwise. Sibling of checkOverlaps: same input (the emitted SVG string),
// same "read what actually shipped" discipline, a different failure mode.
//
// Why it exists. The G10 determinants LP carried a parallelogram of determinant 3 that was
// GEOMETRICALLY FAITHFUL and pedagogically useless: the author picked vectors whose cross
// product is 3, the auto-fitter drew them honestly, and the result was a near-flat sliver a
// teacher cannot point at and a pupil cannot read an area off. checkOverlaps passed it — no
// two labels collided — and the judge scored the LP 100. Nothing in the pipeline could see it.
//
// Three ways a diagram is degenerate, and each is measured, never guessed:
//   sliver  a CLOSED shape big enough to be the subject, drawn so thin it carries no area:
//           an extreme bounding-box aspect, or a real area that is a sliver of its own box.
//   flat    a closed shape that spans the canvas in one direction and is hairline in the other.
//   empty   the whole canvas is white — the drawing covers a negligible fraction of its box.
//
// SIGNIFICANCE IS PART OF THE TEST. An arrowhead is a closed polygon with a hopeless aspect and
// it is not a defect, so a shape is only judged once its bounding box is >= 1% of the canvas.
// That single rule is what keeps this gate silent on all 60 shipped examples.

const { parseTransform } = require("./measure");

const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const ATTR = (s, k) => {
  const m = new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`).exec(s);
  return m ? m[1] : null;
};
const NUM = (s, k, d) => {
  const v = parseFloat(ATTR(s, k));
  return Number.isFinite(v) ? v : d;
};

const bboxOf = (pts) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** Shoelace. Absolute area of a closed polygon. */
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Vertices of a `d` attribute, and whether it closes. Curves are sampled at their endpoints —
 *  enough for an area/aspect judgement, and it never pretends to be a path renderer. */
function pathPoints(d) {
  const pts = [];
  let closed = /[Zz]\s*$/.test(String(d).trim()) || /[Zz]/.test(String(d));
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let cur = [0, 0], start = [0, 0], m;
  while ((m = re.exec(String(d)))) {
    const cmd = m[1];
    const n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const up = (x, y) => { cur = [x, y]; pts.push(cur); };
    switch (cmd.toUpperCase()) {
      case "M":
        for (let i = 0; i + 1 < n.length; i += 2) up(rel ? cur[0] + n[i] : n[i], rel ? cur[1] + n[i + 1] : n[i + 1]);
        start = cur;
        break;
      case "L":
        for (let i = 0; i + 1 < n.length; i += 2) up(rel ? cur[0] + n[i] : n[i], rel ? cur[1] + n[i + 1] : n[i + 1]);
        break;
      case "H": for (const v of n) up(rel ? cur[0] + v : v, cur[1]); break;
      case "V": for (const v of n) up(cur[0], rel ? cur[1] + v : v); break;
      case "C": for (let i = 0; i + 5 < n.length; i += 6) up(rel ? cur[0] + n[i + 4] : n[i + 4], rel ? cur[1] + n[i + 5] : n[i + 5]); break;
      case "S": case "Q": for (let i = 0; i + 3 < n.length; i += 4) up(rel ? cur[0] + n[i + 2] : n[i + 2], rel ? cur[1] + n[i + 3] : n[i + 3]); break;
      case "T": for (let i = 0; i + 1 < n.length; i += 2) up(rel ? cur[0] + n[i] : n[i], rel ? cur[1] + n[i + 1] : n[i + 1]); break;
      case "A": for (let i = 0; i + 6 < n.length; i += 7) up(rel ? cur[0] + n[i + 5] : n[i + 5], rel ? cur[1] + n[i + 6] : n[i + 6]); break;
      case "Z": cur = start; break;
      default: break;
    }
  }
  return { pts, closed };
}

const DEFAULTS = {
  minSignificantFrac: 0.01,  // a shape smaller than 1% of the canvas is furniture, not the subject
  subjectFrac: 0.9,          // "the subject" = within 10% of the largest closed shape's box (see below)
  maxAspect: 14,             // bounding-box aspect at which a shape stops reading as a shape
  minAreaRatio: 0.06,        // real area / bounding-box area
  minInkFrac: 0.004,         // painted fraction of the canvas below which nothing is being said
  hairlineFrac: 0.02,        // "hairline" = under 2% of the canvas's long side
  spanFrac: 0.25,            // "spans the canvas" = over 25% of its long side
};

// THE SUBJECT RULE — and it is the whole reason this gate is usable.
//
// A thin closed shape is not automatically a defect. A leaf cross-section's epidermis is a
// 340×9 band with a 38:1 aspect and it is exactly right: it is one layer of a thick stack, and
// the drawing's SUBJECT is the leaf around it. The determinant parallelogram is a 560×8 band
// with a 70:1 aspect and it is the only closed shape on the canvas — it IS the subject, and a
// subject with no area teaches nothing.
//
// So slivers are judged only against the largest closed shape in the drawing. Without this the
// gate fired on a shipped biology diagram, which is how a gate loses its authority.

/**
 * @param {string} svg  the emitted SVG
 * @param {object} o    threshold overrides (see DEFAULTS)
 * @returns {Array<{kind:string, id:string, detail:string}>}
 */
function checkDegenerate(svg, o = {}) {
  const T = { ...DEFAULTS, ...o };
  const src = String(svg || "");
  const vb = (ATTR(src, "viewBox") || "0 0 100 100").trim().split(/[\s,]+/).map(Number);
  const W = vb[2] > 0 ? vb[2] : 100;
  const H = vb[3] > 0 ? vb[3] : 100;
  const canvas = W * H;
  const long = Math.max(W, H);

  const out = [];
  const shapes = [];
  let ink = 0;

  const stack = [IDENT];
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  let m, idx = 0, skipDepth = 0;
  const top = () => stack[stack.length - 1];

  while ((m = tagRe.exec(src))) {
    const close = m[1] === "/";
    const tag = m[2];
    const at = m[3] || "";
    const selfClose = m[4] === "/";
    if (skipDepth) { if (tag === "foreignObject" && close) skipDepth = 0; continue; }
    if (close) { if (tag === "g" || tag === "svg") stack.pop(); continue; }
    const M = mul(top(), parseTransform(ATTR(at, "transform")));
    if (tag === "g" || tag === "svg") { if (!selfClose) stack.push(M); continue; }
    const id = `${tag}#${idx++}`;
    const sw = Math.max(NUM(at, "stroke-width", 1), 1);
    // A white fill is the GROUND, not a shape — every builder paints a white page rect first,
    // and counting it made the background the "largest shape", which silently disqualified
    // every real subject from the sliver test. Found by the determinant fixture returning clean.
    const filled = (f) => f && f !== "none" && f !== "transparent" &&
      !/^#(?:fff|ffffff)$/i.test(String(f).trim()) && !/^white$/i.test(String(f).trim());

    if (tag === "rect") {
      const p = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) =>
        apply(M, NUM(at, "x", 0) + u * NUM(at, "width", 0), NUM(at, "y", 0) + v * NUM(at, "height", 0)));
      const b = bboxOf(p);
      ink += filled(ATTR(at, "fill")) ? b.w * b.h : 2 * (b.w + b.h) * sw;
      // an unfilled rect is a frame (four rules), not a shape whose area teaches anything
      if (filled(ATTR(at, "fill"))) shapes.push({ id, pts: p, area: b.w * b.h, box: b });
    } else if (tag === "polygon") {
      const pts = (ATTR(at, "points") || "").trim().split(/\s+/)
        .map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite))
        .map((p) => apply(M, p[0], p[1]));
      if (pts.length >= 3) {
        const b = bboxOf(pts);
        const a = polyArea(pts);
        ink += filled(ATTR(at, "fill")) ? a : perim(pts, true) * sw;
        shapes.push({ id, pts, area: a, box: b });
      }
    } else if (tag === "path") {
      const { pts, closed } = pathPoints(ATTR(at, "d") || "");
      if (pts.length >= 2) {
        const b = bboxOf(pts);
        const a = closed && pts.length >= 3 ? polyArea(pts) : 0;
        ink += filled(ATTR(at, "fill")) && a ? a : perim(pts, closed) * sw;
        if (closed && pts.length >= 3) shapes.push({ id, pts, area: a, box: b });
      }
    } else if (tag === "line") {
      const p1 = apply(M, NUM(at, "x1", 0), NUM(at, "y1", 0));
      const p2 = apply(M, NUM(at, "x2", 0), NUM(at, "y2", 0));
      ink += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * Math.max(sw, 2);
    } else if (tag === "polyline") {
      const pts = (ATTR(at, "points") || "").trim().split(/\s+/)
        .map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite))
        .map((p) => apply(M, p[0], p[1]));
      ink += perim(pts, false) * Math.max(sw, 2);
    } else if (tag === "circle" || tag === "ellipse") {
      const rx = NUM(at, "r", NUM(at, "rx", 0));
      const ry = NUM(at, "r", NUM(at, "ry", rx));
      ink += filled(ATTR(at, "fill")) ? Math.PI * rx * ry : 2 * Math.PI * Math.max(rx, ry) * sw;
    } else if (tag === "text") {
      const end = src.indexOf("</text>", tagRe.lastIndex);
      const body = end < 0 ? "" : src.slice(tagRe.lastIndex, end).replace(/<[^>]*>/g, "");
      const size = NUM(at, "font-size", 14);
      ink += body.trim().length * size * 0.55 * size;
    } else if (tag === "foreignObject") {
      skipDepth = 1;
      ink += NUM(at, "width", 0) * NUM(at, "height", 0) * 0.5;
    } else if (tag === "image") {
      ink += NUM(at, "width", 0) * NUM(at, "height", 0);
    }
  }

  const maxBox = shapes.reduce((a, s) => Math.max(a, s.box.w * s.box.h), 0);
  for (const s of shapes) {
    const boxArea = s.box.w * s.box.h;
    if (boxArea < canvas * T.minSignificantFrac) continue;      // furniture, not the subject
    if (boxArea < maxBox * T.subjectFrac) continue;             // a part of the subject, not it
    const lo = Math.max(Math.min(s.box.w, s.box.h), 0.001);
    const hi = Math.max(s.box.w, s.box.h);
    const aspect = hi / lo;
    if (aspect > T.maxAspect) {
      out.push({ kind: "sliver", id: s.id,
        detail: `bounding box ${round(s.box.w)}×${round(s.box.h)} — aspect ${round(aspect)}:1 (limit ${T.maxAspect}:1)` });
      continue;
    }
    if (s.area > 0 && s.area / boxArea < T.minAreaRatio) {
      out.push({ kind: "sliver", id: s.id,
        detail: `area ${round(s.area)} is ${round((100 * s.area) / boxArea)}% of its own ${round(s.box.w)}×${round(s.box.h)} box (floor ${Math.round(T.minAreaRatio * 100)}%)` });
      continue;
    }
    if (lo < long * T.hairlineFrac && hi > long * T.spanFrac) {
      out.push({ kind: "flat", id: s.id,
        detail: `spans ${round(hi)} of ${round(long)} but is only ${round(lo)} thick` });
    }
  }

  const inkFrac = canvas ? ink / canvas : 0;
  if (inkFrac < T.minInkFrac) {
    out.push({ kind: "empty", id: "svg",
      detail: `the drawing covers ${(100 * inkFrac).toFixed(2)}% of its ${round(W)}×${round(H)} canvas (floor ${(100 * T.minInkFrac).toFixed(1)}%)` });
  }
  return out;
}

function perim(pts, closed) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 2) {
    n += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  }
  return n;
}
const round = (n) => Math.round(n * 10) / 10;

module.exports = { checkDegenerate, polyArea, pathPoints, DEFAULTS };
