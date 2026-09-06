// geometry — a tiny declarative geometry canvas.
//
// Coordinates are written in ordinary maths space (y up, any units the author
// likes) and auto-fitted into the body: the module takes the bounding box of
// everything in the spec, scales it to fill the canvas and centres it. So a
// triangle on (0,0)-(4,3) and a circle of radius 3 both arrive the same size.
//
// The three things that make a geometry figure readable rather than merely
// correct, and which this module does for you:
//   * vertex labels are pushed OUTWARD along the ray from the shape's centroid,
//     so a label never sits on a stroke;
//   * side labels sit at the midpoint of the side, offset along the OUTWARD
//     normal of that side (again, away from the centroid);
//   * an angle is a real elliptical-arc path on the minor angle between the two
//     rays, and a right angle is the square marker, not an arc.
//
// A geometry figure is not mirrored for Urdu — a triangle is a triangle in both
// scripts. Only the labels change script, and those go through the foreignObject
// path with an explicit box so nothing lands at a negative x.

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { SERIES } = require("../lib/tokens");

const fin = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const isPt = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const RAD = Math.PI / 180;

/** Place a label so an Urdu foreignObject cannot drift off its anchor. */
function lab(svg, x, y, s, o = {}) {
  const str = String(s ?? "");
  if (!str) return;
  const align = o.align || "center";
  // Labels on a figure sit ON its lines by construction (an angle label inside
  // its arc, a side label on its own edge). They ride an opaque plate: it is
  // what keeps them readable and what clears them in checkOverlaps().
  const draw = o.plate !== false ? (a, b, t, oo) => svg.plateText(a, b, t, oo) : (a, b, t, oo) => svg.text(a, b, t, oo);
  if (!hasUrdu(str)) {
    draw(x, y, str, {
      ...o,
      anchor: align === "center" ? "middle" : align === "right" ? "end" : "start",
    });
    return;
  }
  const w = o.w ?? Math.max(44, measure(str, o.size ?? SIZE.small, { lang: "ur" }) * 1.3 + 12);
  if (align === "center") draw(x, y, str, { ...o, anchor: "middle", w, lang: "ur" });
  else if (align === "right") draw(x - w, y, str, { ...o, anchor: "start", w, lang: "ur" });
  else draw(x + w, y, str, { ...o, anchor: "end", w, lang: "ur" });
}

/** A label pushed `dist` away from (cx,cy) through (px,py). */
function outward(svg, px, py, cx, cy, s, dist, o = {}) {
  const dx = px - cx;
  const dy = py - cy;
  const m = Math.hypot(dx, dy) || 1;
  const ux = dx / m;
  const uy = dy / m;
  lab(svg, px + ux * dist, py + uy * dist, s, {
    ...o,
    align: ux > 0.3 ? "left" : ux < -0.3 ? "right" : "center",
    baseline: "middle",
  });
}

/** Label the midpoint of a segment, offset along the segment's own NORMAL.
 *  A straight vertical offset lands on the stroke as soon as the line is
 *  steep, which is most of geometry. */
function alongNormal(svg, ax, ay, bx, by, s, o = {}) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let nx = -(by - ay) / len;
  let ny = (bx - ax) / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const d = o.dist ?? 15;
  lab(svg, mx + nx * d, my + ny * d, s, {
    ...o,
    align: nx > 0.3 ? "left" : nx < -0.3 ? "right" : "center",
    baseline: "middle",
  });
}

/* ------------------------------------------------------------------ */
/* bounding box                                                        */
/* ------------------------------------------------------------------ */
function collect(shapes) {
  const pts = [];
  const push = (p) => {
    if (isPt(p)) pts.push(p);
  };
  for (const sh of shapes) {
    if (!sh || typeof sh !== "object") continue;
    if (Array.isArray(sh.points)) sh.points.forEach(push);
    push(sh.from);
    push(sh.to);
    push(sh.at);
    push(sh.vertex);
    push(sh.a);
    push(sh.b);
    if (sh.kind === "circle" && isPt(sh.c)) {
      const r = Math.abs(fin(sh.r, 1));
      pts.push([sh.c[0] - r, sh.c[1] - r], [sh.c[0] + r, sh.c[1] + r]);
      if (sh.tangent) {
        const t = fin(sh.tangent.at, 90) * RAD;
        const L = fin(sh.tangent.len, r * 1.1);
        const px = sh.c[0] + r * Math.cos(t);
        const py = sh.c[1] + r * Math.sin(t);
        pts.push([px - L * Math.sin(t), py + L * Math.cos(t)], [px + L * Math.sin(t), py - L * Math.cos(t)]);
      }
    }
  }
  return pts;
}

function centroidOf(list) {
  if (!list.length) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const p of list) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / list.length, sy / list.length];
}

/** Minor-arc path between two rays out of a vertex, in SCREEN coords. */
function angleArc(vx, vy, ax, ay, bx, by, r) {
  const a1 = Math.atan2(ay - vy, ax - vx);
  const a2 = Math.atan2(by - vy, bx - vx);
  let d = a2 - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const sweep = d > 0 ? 1 : 0;
  const p1x = vx + r * Math.cos(a1);
  const p1y = vy + r * Math.sin(a1);
  const p2x = vx + r * Math.cos(a2);
  const p2y = vy + r * Math.sin(a2);
  return {
    d: `M${r2(p1x)},${r2(p1y)} A${r2(r)},${r2(r)} 0 0 ${sweep} ${r2(p2x)},${r2(p2y)}`,
    mid: a1 + d / 2,
    deg: Math.abs(d) / RAD,
  };
}

function render(spec) {
  const shapes = (Array.isArray(spec.shapes) ? spec.shapes : []).filter(
    (s) => s && typeof s === "object"
  );
  const all = collect(shapes);
  if (!all.length) all.push([0, 0], [1, 1]);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;

  const bodyW = fin(spec.width, 620);
  const pad = fin(spec.pad, 46);
  const innerW = bodyW - pad * 2;
  const wantH = innerW * (bh / bw);
  const bodyH = fin(spec.height, Math.max(220, Math.min(520, Math.round(wantH + pad * 2))));
  const innerH = bodyH - pad * 2;

  const s = Math.min(innerW / bw, innerH / bh);
  const ox = pad + (innerW - bw * s) / 2 - minX * s;
  const oy = pad + (innerH - bh * s) / 2 + maxY * s; // y flips: maths up, screen down
  const X = (v) => ox + v * s;
  const Y = (v) => oy - v * s;
  const P = (p) => [X(p[0]), Y(p[1])];

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  /* ---- optional unit grid, under everything ---- */
  if (spec.showGrid) {
    const step = fin(spec.gridStep, 1);
    for (let v = Math.ceil(minX / step) * step; v <= maxX + 1e-9; v += step)
      svg.line(X(v), pad * 0.4, X(v), bodyH - pad * 0.4, { stroke: C.rule, sw: 0.8 });
    for (let v = Math.ceil(minY / step) * step; v <= maxY + 1e-9; v += step)
      svg.line(pad * 0.4, Y(v), bodyW - pad * 0.4, Y(v), { stroke: C.rule, sw: 0.8 });
  }

  const LS = SIZE.label;

  shapes.forEach((sh, si) => {
    const kind = sh.kind || "polygon";
    const color = sh.color || C.ink;

    /* -------- triangle / polygon -------- */
    if (kind === "triangle" || kind === "polygon") {
      const pts = (Array.isArray(sh.points) ? sh.points : []).filter(isPt);
      if (pts.length < 3) return;
      const scr = pts.map(P);
      const cen = centroidOf(scr);
      if (sh.fill) svg.polygon(scr, { fill: sh.fill, opacity: fin(sh.fillOpacity, 0.16) });
      svg.polygon(scr, { fill: "none", stroke: color, sw: fin(sh.sw, 2.2), join: "round" });

      // side labels — midpoint, pushed along the outward normal
      const sides = Array.isArray(sh.sides) ? sh.sides : [];
      scr.forEach((p, i) => {
        const q = scr[(i + 1) % scr.length];
        const txt = sides[i];
        if (!txt) return;
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        let nx = -(q[1] - p[1]);
        let ny = q[0] - p[0];
        const m = Math.hypot(nx, ny) || 1;
        nx /= m;
        ny /= m;
        if (nx * (mx - cen[0]) + ny * (my - cen[1]) < 0) {
          nx = -nx;
          ny = -ny;
        }
        lab(svg, mx + nx * 16, my + ny * 16, txt, {
          size: SIZE.small,
          align: nx > 0.3 ? "left" : nx < -0.3 ? "right" : "center",
          baseline: "middle",
          weight: 700,
          fill: sh.sideColor || C.cool,
        });
      });

      // vertex labels — pushed outward from the centroid
      const labels = Array.isArray(sh.labels) ? sh.labels : [];
      scr.forEach((p, i) => {
        if (!labels[i]) return;
        outward(svg, p[0], p[1], cen[0], cen[1], labels[i], 17, {
          size: LS,
          weight: 700,
          fill: C.ink,
        });
        svg.circle(p[0], p[1], 3, { fill: color });
      });

      // angle arcs at named vertices
      (Array.isArray(sh.angles) ? sh.angles : []).forEach((an) => {
        if (!an) return;
        const i = Math.round(fin(an.at, 0));
        const v = scr[i];
        if (!v) return;
        const a = scr[(i + scr.length - 1) % scr.length];
        const b = scr[(i + 1) % scr.length];
        const r = fin(an.arcR, 30);
        const ac = an.color || C.plum;
        if (an.right) {
          rightAngleMark(svg, v, a, b, ac, fin(an.size, 15));
        } else if (an.arc !== false) {
          const arc = angleArc(v[0], v[1], a[0], a[1], b[0], b[1], r);
          svg.path(arc.d, { fill: "none", stroke: ac, sw: 1.8 });
          if (an.label)
            lab(svg, v[0] + Math.cos(arc.mid) * (r + 15), v[1] + Math.sin(arc.mid) * (r + 15), an.label, {
              size: LS,
              align: "center",
              baseline: "middle",
              weight: 700,
              fill: ac,
            });
        }
      });
      return;
    }

    /* -------- circle -------- */
    if (kind === "circle") {
      if (!isPt(sh.c)) return;
      const c = P(sh.c);
      const r = Math.abs(fin(sh.r, 1)) * s;
      const on = (deg) => [c[0] + r * Math.cos(deg * RAD), c[1] - r * Math.sin(deg * RAD)];
      if (sh.fill) svg.circle(c[0], c[1], r, { fill: sh.fill, opacity: fin(sh.fillOpacity, 0.12) });
      svg.circle(c[0], c[1], r, { fill: "none", stroke: color, sw: fin(sh.sw, 2.2) });
      svg.circle(c[0], c[1], 3.2, { fill: color });
      if (sh.label)
        lab(svg, c[0] - 9, c[1] + 4, sh.label, { size: LS, align: "right", weight: 700, fill: C.ink });

      if (sh.radius) {
        const at = fin(sh.radius.at, 52);
        const p = isPt(sh.radius.to) ? P(sh.radius.to) : on(at);
        svg.line(c[0], c[1], p[0], p[1], { stroke: C.warn, sw: 2, cap: "round" });
        if (sh.radius.label)
          alongNormal(svg, c[0], c[1], p[0], p[1], sh.radius.label, {
            size: SIZE.small,
            weight: 700,
            fill: C.warn,
          });
      }
      if (sh.diameter) {
        const at = fin(sh.diameter.at, 0);
        const p1 = on(at + 180);
        const p2 = on(at);
        svg.line(p1[0], p1[1], p2[0], p2[1], { stroke: C.plum, sw: 2, cap: "round" });
        if (sh.diameter.label)
          alongNormal(svg, p1[0], p1[1], p2[0], p2[1], sh.diameter.label, {
            size: SIZE.small,
            weight: 700,
            fill: C.plum,
          });
      }
      if (sh.chord) {
        const p1 = isPt(sh.chord.from) ? P(sh.chord.from) : on(fin(sh.chord.from, 200));
        const p2 = isPt(sh.chord.to) ? P(sh.chord.to) : on(fin(sh.chord.to, 340));
        svg.line(p1[0], p1[1], p2[0], p2[1], { stroke: C.leaf, sw: 2, cap: "round" });
        svg.circle(p1[0], p1[1], 3.4, { fill: C.leaf });
        svg.circle(p2[0], p2[1], 3.4, { fill: C.leaf });
        if (sh.chord.label) {
          const mx = (p1[0] + p2[0]) / 2;
          const my = (p1[1] + p2[1]) / 2;
          const away = my > c[1] ? 15 : -15;
          lab(svg, mx, my + away, sh.chord.label, {
            size: SIZE.small,
            align: "center",
            baseline: "middle",
            weight: 700,
            fill: C.leaf,
          });
        }
        if (Array.isArray(sh.chord.labels)) {
          outward(svg, p1[0], p1[1], c[0], c[1], sh.chord.labels[0], 15, {
            size: LS,
            weight: 700,
            fill: C.ink,
          });
          outward(svg, p2[0], p2[1], c[0], c[1], sh.chord.labels[1], 15, {
            size: LS,
            weight: 700,
            fill: C.ink,
          });
        }
      }
      if (sh.tangent) {
        const at = fin(sh.tangent.at, 90);
        const p = on(at);
        const L = fin(sh.tangent.len, Math.abs(fin(sh.r, 1))) * s;
        const tx = -Math.sin(at * RAD);
        const ty = -Math.cos(at * RAD);
        svg.line(p[0] - tx * L, p[1] - ty * L, p[0] + tx * L, p[1] + ty * L, {
          stroke: C.clay,
          sw: 2,
          cap: "round",
        });
        svg.circle(p[0], p[1], 3.4, { fill: C.clay });
        if (sh.tangent.label)
          outward(svg, p[0], p[1], c[0], c[1], sh.tangent.label, 18, {
            size: SIZE.small,
            weight: 700,
            fill: C.clay,
          });
      }
      return;
    }

    /* -------- standalone angle -------- */
    if (kind === "angle") {
      if (!isPt(sh.vertex) || !isPt(sh.a) || !isPt(sh.b)) return;
      const v = P(sh.vertex);
      const a = P(sh.a);
      const b = P(sh.b);
      const r = fin(sh.arcR, 36);
      const ac = sh.color || SERIES[(si + 2) % SERIES.length];
      if (sh.rays !== false) {
        svg.line(v[0], v[1], a[0], a[1], { stroke: C.ink, sw: 1.9, cap: "round" });
        svg.line(v[0], v[1], b[0], b[1], { stroke: C.ink, sw: 1.9, cap: "round" });
      }
      const arc = angleArc(v[0], v[1], a[0], a[1], b[0], b[1], r);
      svg.path(arc.d, { fill: "none", stroke: ac, sw: 2 });
      if (sh.label)
        lab(svg, v[0] + Math.cos(arc.mid) * (r + 17), v[1] + Math.sin(arc.mid) * (r + 17), sh.label, {
          size: LS,
          align: "center",
          baseline: "middle",
          weight: 700,
          fill: ac,
        });
      return;
    }

    /* -------- right-angle marker -------- */
    if (kind === "rightangle") {
      if (!isPt(sh.vertex) || !isPt(sh.a) || !isPt(sh.b)) return;
      rightAngleMark(svg, P(sh.vertex), P(sh.a), P(sh.b), sh.color || C.ink, fin(sh.size, 15));
      return;
    }

    /* -------- line / segment -------- */
    if (kind === "line" || kind === "segment") {
      if (!isPt(sh.from) || !isPt(sh.to)) return;
      const a = P(sh.from);
      const b = P(sh.to);
      if (sh.arrow) {
        svg.arrow(a[0], a[1], b[0], b[1], {
          stroke: color,
          sw: fin(sh.sw, 2),
          dash: sh.dash,
          both: sh.arrow === "both",
        });
      } else {
        svg.line(a[0], a[1], b[0], b[1], {
          stroke: color,
          sw: fin(sh.sw, 2),
          dash: sh.dash,
          cap: "round",
        });
      }
      if (sh.label) {
        alongNormal(svg, a[0], a[1], b[0], b[1], sh.label, {
          size: SIZE.small,
          weight: 700,
          fill: color,
          dist: fin(sh.offset, 15),
        });
      }
      if (Array.isArray(sh.labels)) {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        outward(svg, a[0], a[1], mid[0], mid[1], sh.labels[0], 15, {
          size: LS,
          weight: 700,
          fill: C.ink,
        });
        outward(svg, b[0], b[1], mid[0], mid[1], sh.labels[1], 15, {
          size: LS,
          weight: 700,
          fill: C.ink,
        });
      }
      return;
    }

    /* -------- bare point -------- */
    if (kind === "point") {
      if (!isPt(sh.at)) return;
      const p = P(sh.at);
      svg.circle(p[0], p[1], fin(sh.r, 4), { fill: color });
      if (sh.label)
        lab(svg, p[0] + fin(sh.dx, 9), p[1] + fin(sh.dy, -4), sh.label, {
          size: LS,
          align: fin(sh.dx, 9) < 0 ? "right" : "left",
          baseline: "middle",
          weight: 700,
          fill: C.ink,
        });
    }
  });

  return svg.toString();
}

/** The little square that says "this is 90°", drawn as an open polyline. */
function rightAngleMark(svg, v, a, b, color, size) {
  const u1x = a[0] - v[0];
  const u1y = a[1] - v[1];
  const u2x = b[0] - v[0];
  const u2y = b[1] - v[1];
  const m1 = Math.hypot(u1x, u1y) || 1;
  const m2 = Math.hypot(u2x, u2y) || 1;
  const p1 = [v[0] + (u1x / m1) * size, v[1] + (u1y / m1) * size];
  const p2 = [v[0] + (u2x / m2) * size, v[1] + (u2y / m2) * size];
  const corner = [p1[0] + p2[0] - v[0], p1[1] + p2[1] - v[1]];
  svg.polyline([p1, corner, p2], { fill: "none", stroke: color, sw: 1.7 });
}

module.exports = {
  type: "geometry",
  aliases: ["construction"],
  summary:
    "Auto-fitted geometry canvas — triangles, polygons, circles with radius/diameter/chord/tangent, angle arcs, right-angle markers, labelled lines and points.",
  render,
  examples: [
    {
      name: "geometry_right_triangle",
      spec: {
        type: "geometry",
        height: 340,
        shapes: [
          {
            kind: "triangle",
            points: [
              [0, 0],
              [4, 0],
              [0, 3],
            ],
            labels: ["A", "B", "C"],
            sides: ["4 cm", "5 cm", "3 cm"],
            angles: [{ at: 1, label: "θ", arcR: 34, color: C.plum }],
            fill: C.cool,
          },
          { kind: "rightangle", vertex: [0, 0], a: [4, 0], b: [0, 3] },
        ],
        title: "The 3-4-5 right triangle",
        caption: "3² + 4² = 9 + 16 = 25 = 5², so the angle at A is exactly 90°. tan θ = 3/4.",
      },
    },
    {
      name: "geometry_circle_parts",
      spec: {
        type: "geometry",
        height: 340,
        shapes: [
          {
            kind: "circle",
            c: [0, 0],
            r: 3,
            label: "O",
            radius: { at: 58, label: "r = 3 cm" },
            chord: { from: 205, to: 335, label: "chord", labels: ["P", "Q"] },
          },
        ],
        title: "Centre, radius and chord",
        caption: "Every radius is the same length; a chord joins two points on the circle itself.",
      },
    },
    {
      name: "geometry_vertical_angles_ur",
      spec: {
        type: "geometry",
        height: 350,
        shapes: [
          { kind: "line", from: [-4, -2], to: [4, 2], sw: 2 },
          { kind: "line", from: [-3.4, 3.4], to: [3.4, -3.4], sw: 2 },
          { kind: "angle", vertex: [0, 0], a: [4, 2], b: [-3.4, 3.4], label: "الف", rays: false, arcR: 40, color: C.warn },
          { kind: "angle", vertex: [0, 0], a: [-4, -2], b: [3.4, -3.4], label: "الف", rays: false, arcR: 40, color: C.warn },
          { kind: "angle", vertex: [0, 0], a: [3.4, -3.4], b: [4, 2], label: "ب", rays: false, arcR: 58, color: C.cool },
          { kind: "angle", vertex: [0, 0], a: [-3.4, 3.4], b: [-4, -2], label: "ب", rays: false, arcR: 58, color: C.cool },
          { kind: "point", at: [0, 0], label: "", r: 3.5 },
        ],
        lang: "ur",
        title: "متقابل زاویے",
        caption: "جب دو خط ایک دوسرے کو کاٹتے ہیں تو آمنے سامنے کے زاویے برابر ہوتے ہیں۔",
      },
    },
  ],
};
