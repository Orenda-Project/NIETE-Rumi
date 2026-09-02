// ray_diagram — geometrically CORRECT optics constructions for grade 8-12.
//
// The image position and height are SOLVED, never sketched. Everything on the
// page (F, 2F, the three construction rays, the image arrow, the u/v/f
// dimension lines) is placed from that solution, so a student can measure the
// picture and get the same answer the algebra gives.
//
// SIGN CONVENTION (one internal convention, both elements)
//   Light runs left -> right. The element sits at x = 0. The object is real and
//   sits on the LEFT at x = -u (u > 0). `f` in the spec is a MAGNITUDE; the
//   element decides its sign:
//        convex_lens / concave_mirror ->  fs = +f   (converging)
//        concave_lens / convex_mirror ->  fs = -f   (diverging)
//   Then, for BOTH families:
//        1/v = 1/fs - 1/u          m = -v/u          h' = m*h
//   v > 0 means a REAL image (lens: far side; mirror: in front of the mirror).
//   The image's x on the page is  v  for a lens and  -v  for a mirror, because a
//   mirror sends the light back the way it came.
//   Sanity, all four checked against the textbook results:
//     convex lens  f=20 u=60 -> v=+30  m=-0.50  real, inverted, diminished
//     convex lens  f=20 u=10 -> v=-20  m=+2.00  virtual, upright, magnified
//     concave lens f=20 u=30 -> v=-12  m=+0.40  virtual, upright, diminished
//     concave mir  f=15 u=40 -> v=+24  m=-0.60  real, inverted, diminished
//     convex mir   f=15 u=30 -> v=-10  m=+0.33  virtual, upright, diminished
//
// CONSTRUCTION RAYS (same three for every element)
//   A  parallel to the axis, then through the focal point
//   B  through the optical centre / to the pole, undeviated (mirror: equal angles)
//   C  through the focal point, then parallel to the axis
//   For a virtual image the outgoing rays are drawn solid in the direction the
//   light really travels, and DASHED backwards to where they appear to meet.

const { Svg, C, SIZE, hasUrdu, measure } = require("../lib/svg");

const BODY_W = 660;
const MARGIN_L = 40;
const MARGIN_R = 40;
const TOP_PAD = 20;
const AVAIL_V = 104;

const ELEMENTS = new Set([
  "convex_lens",
  "concave_lens",
  "concave_mirror",
  "convex_mirror",
  "plane_mirror",
]);

const num = (v, d) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const fmt = (x) => {
  const r = Math.round(Number(x) * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};

/* ------------------------------------------------------------------ */
/* segment clipping (Liang-Barsky) — rays leave the frame, never the   */
/* drawing area                                                        */
/* ------------------------------------------------------------------ */
function clipSeg(p, q, b) {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const tests = [
    [-dx, p[0] - b.x0],
    [dx, b.x1 - p[0]],
    [-dy, p[1] - b.y0],
    [dy, b.y1 - p[1]],
  ];
  for (const [pp, qq] of tests) {
    if (pp === 0) {
      if (qq < 0) return null;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    [p[0] + t0 * dx, p[1] + t0 * dy],
    [p[0] + t1 * dx, p[1] + t1 * dy],
  ];
}

/** y on the line through a and b at x. */
function yAt(a, b, x) {
  if (Math.abs(b[0] - a[0]) < 1e-12) return a[1];
  return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
}

/* ------------------------------------------------------------------ */
function solve(element, f, u) {
  if (element === "plane_mirror") {
    return { v: -u, m: 1, real: false, imageX: u, fs: Infinity, mirror: true };
  }
  const mirror = element.indexOf("mirror") >= 0;
  const converging = element === "convex_lens" || element === "concave_mirror";
  const fs = converging ? f : -f;
  const invV = 1 / fs - 1 / u;
  if (Math.abs(invV) < 1e-9) return { v: Infinity, m: Infinity, real: false, imageX: null, fs, mirror };
  const v = 1 / invV;
  const m = -v / u;
  return { v, m, real: v > 0, imageX: mirror ? -v : v, fs, mirror };
}

function autoCaption(el, s, u, f, unit) {
  if (el === "plane_mirror")
    return `Virtual, upright, same-size image ${fmt(u)} ${unit} behind the mirror (laterally inverted).`;
  if (!Number.isFinite(s.v)) return `The object sits at the focus — the emerging rays are parallel and no image is formed.`;
  const size = Math.abs(s.m) > 1.02 ? "magnified" : Math.abs(s.m) < 0.98 ? "diminished" : "same-size";
  const where = s.mirror
    ? s.real
      ? "in front of the mirror"
      : "behind the mirror"
    : s.real
      ? "on the far side of the lens"
      : "on the same side as the object";
  return `${s.real ? "Real" : "Virtual"}, ${s.m < 0 ? "inverted" : "upright"}, ${size} image — v = ${fmt(
    Math.abs(s.v)
  )} ${unit} ${where} (m = ${s.m.toFixed(2)}).`;
}

/* ------------------------------------------------------------------ */
function render(spec) {
  const sp = spec && typeof spec === "object" ? spec : {};
  const element = ELEMENTS.has(sp.element) ? sp.element : "convex_lens";
  const isMirror = element.indexOf("mirror") >= 0;
  const isPlane = element === "plane_mirror";
  const unit = sp.unit || "cm";
  const lang = sp.lang;
  const L = sp.labels && typeof sp.labels === "object" ? sp.labels : {};

  let f = Math.abs(num(sp.f, 20)) || 20;
  let u = Math.abs(num(sp.u, 60)) || 60;
  if (!isPlane && Math.abs(u - f) < f * 0.02) u = f * 1.02; // never divide by ~0
  const h = Math.abs(num(sp.hObject, Math.max(f, u) * 0.22)) || 10;

  const S = solve(element, f, u);
  const hasImage = S.imageX !== null && Number.isFinite(S.imageX);
  const hp = hasImage ? S.m * h : 0;
  const P = [-u, h];
  const Q = hasImage ? [S.imageX, hp] : null;
  const Fpt = isPlane ? null : [isMirror ? -S.fs : -S.fs, 0]; // ray-C focal point
  const FptOut = isPlane ? null : [S.fs, 0]; // ray-A focal point (lens only)

  /* ---- x window -------------------------------------------------- */
  const xs = [0, -u];
  if (hasImage) xs.push(S.imageX);
  if (!isPlane) {
    if (isMirror) {
      xs.push(-S.fs, -2 * S.fs);
    } else {
      xs.push(f, -f, 2 * f, -2 * f);
    }
  }
  let xmin = Math.min(...xs);
  let xmax = Math.max(...xs);
  if (xmax - xmin < 1e-6) {
    xmin -= 1;
    xmax += 1;
  }
  const padX = (xmax - xmin) * 0.09;
  xmin -= padX;
  xmax += padX;

  /* ---- y window --------------------------------------------------- */
  const yKey = Math.max(h, Math.abs(hp), h * 0.5) || 1;
  const yExt = yKey * 1.32;
  const BOX = { x0: xmin, x1: xmax, y0: -yExt, y1: yExt };

  /* ---- rays, in optical coordinates -------------------------------- */
  const solid = [];
  const dashed = [];
  const guides = [];
  const RAY_C_COLOR = [C.cool, C.plum, C.clay];

  if (sp.showRays !== false && hasImage) {
    if (isPlane) {
      // two rays reflecting off a plane mirror, dashed back to the image
      [0.42, -0.18].forEach((k, i) => {
        const M = [0, h * k];
        const d = [u, M[1] - h];
        solid.push({ a: P, b: M, c: RAY_C_COLOR[i] });
        solid.push({ a: M, b: [M[0] - d[0], M[1] + d[1]], c: RAY_C_COLOR[i] });
        dashed.push({ a: M, b: Q, c: RAY_C_COLOR[i] });
      });
    } else if (isMirror) {
      const back = [xmin, 0];
      // A — parallel in, through F out
      const A1 = [0, h];
      solid.push({ a: P, b: A1, c: RAY_C_COLOR[0] });
      const aOut = [xmin, yAt(A1, Fpt, xmin)];
      solid.push({ a: A1, b: aOut, c: RAY_C_COLOR[0] });
      if (!S.real) dashed.push({ a: A1, b: Q, c: RAY_C_COLOR[0] });
      // B — to the pole, reflects at equal angles
      const B1 = [0, 0];
      solid.push({ a: P, b: B1, c: RAY_C_COLOR[1] });
      solid.push({ a: B1, b: [xmin, yAt(B1, Q, xmin)], c: RAY_C_COLOR[1] });
      if (!S.real) dashed.push({ a: B1, b: Q, c: RAY_C_COLOR[1] });
      // C — through F in, parallel out
      const C1 = [0, hp];
      solid.push({ a: P, b: C1, c: RAY_C_COLOR[2] });
      solid.push({ a: C1, b: [xmin, hp], c: RAY_C_COLOR[2] });
      if (!S.real) dashed.push({ a: C1, b: Q, c: RAY_C_COLOR[2] });
      guides.push({ a: [Math.min(-u, Fpt[0], 0), yAt(P, Fpt, Math.min(-u, Fpt[0], 0))], b: [Math.max(-u, Fpt[0], 0), yAt(P, Fpt, Math.max(-u, Fpt[0], 0))] });
      void back;
    } else {
      // A — parallel in, through F' out
      const A1 = [0, h];
      solid.push({ a: P, b: A1, c: RAY_C_COLOR[0] });
      solid.push({ a: A1, b: [xmax, yAt(A1, FptOut, xmax)], c: RAY_C_COLOR[0] });
      if (!S.real) dashed.push({ a: A1, b: Q, c: RAY_C_COLOR[0] });
      // B — straight through the optical centre
      const B1 = [0, 0];
      solid.push({ a: P, b: B1, c: RAY_C_COLOR[1] });
      solid.push({ a: B1, b: [xmax, yAt(P, B1, xmax)], c: RAY_C_COLOR[1] });
      if (!S.real) dashed.push({ a: B1, b: Q, c: RAY_C_COLOR[1] });
      // C — through F in, parallel out
      const C1 = [0, hp];
      solid.push({ a: P, b: C1, c: RAY_C_COLOR[2] });
      solid.push({ a: C1, b: [xmax, hp], c: RAY_C_COLOR[2] });
      if (!S.real) dashed.push({ a: C1, b: Q, c: RAY_C_COLOR[2] });
      const g0 = Math.min(-u, Fpt[0], 0);
      const g1 = Math.max(-u, Fpt[0], 0);
      guides.push({ a: [g0, yAt(P, Fpt, g0)], b: [g1, yAt(P, Fpt, g1)] });
    }
  }

  /* ---- page geometry ---------------------------------------------- */
  const dimRows = isPlane ? 2 : 3;
  const dimBand = 24 + dimRows * 26;
  const bodyH = TOP_PAD + AVAIL_V * 2 + dimBand;
  const yAxis = TOP_PAD + AVAIL_V;
  const drawW = BODY_W - MARGIN_L - MARGIN_R;
  const sx = drawW / (xmax - xmin);
  const sy = (AVAIL_V - 14) / yExt;
  const X = (x) => MARGIN_L + (x - xmin) * sx;
  const Y = (y) => yAxis - y * sy;

  const caption = sp.caption !== undefined ? sp.caption : autoCaption(element, S, u, f, unit);
  const svg = new Svg(BODY_W, bodyH, {
    title: sp.title,
    caption,
    source: sp.source,
    note: sp.note,
    lang,
    spec: sp,
  });

  /* ---- principal axis --------------------------------------------- */
  svg.line(MARGIN_L - 8, yAxis, BODY_W - MARGIN_R + 8, yAxis, { stroke: C.faint, sw: 1.3 });

  /* ---- the element ------------------------------------------------- */
  const half = AVAIL_V - 10;
  const yTop = yAxis - half;
  const yBot = yAxis + half;
  const cx = X(0);
  if (isPlane) {
    svg.line(cx, yTop, cx, yBot, { stroke: C.ink, sw: 3 });
    for (let i = 0; i <= 10; i++) {
      const yy = yTop + ((yBot - yTop) * i) / 10;
      svg.line(cx, yy, cx + 11, yy + 11, { stroke: C.ink, sw: 1.1 });
    }
  } else if (isMirror) {
    // Endpoints at cx-b with the control at cx+b puts the VERTEX exactly on the
    // pole (x = 0) — the point every ray equation is written about. Concave
    // (b > 0) then curves its rim toward the object, convex away from it.
    const b = element === "concave_mirror" ? 15 : -15;
    const x0 = cx - b;
    const x1 = cx + b;
    svg.path(`M${x0},${yTop} Q${x1},${yAxis} ${x0},${yBot}`, {
      fill: "none",
      stroke: C.ink,
      sw: 3,
    });
    for (let i = 1; i <= 11; i++) {
      const t = i / 12;
      const px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x0;
      const py = (1 - t) * (1 - t) * yTop + 2 * (1 - t) * t * yAxis + t * t * yBot;
      svg.line(px, py, px + 11, py + 10, { stroke: C.ink, sw: 1.1 });
    }
  } else {
    const b = 12;
    if (element === "convex_lens") {
      svg.path(`M${cx},${yTop} Q${cx + b},${yAxis} ${cx},${yBot} Q${cx - b},${yAxis} ${cx},${yTop} Z`, {
        fill: C.cool,
        opacity: 0.12,
        stroke: "none",
      });
      svg.path(`M${cx},${yTop} Q${cx + b},${yAxis} ${cx},${yBot} Q${cx - b},${yAxis} ${cx},${yTop} Z`, {
        fill: "none",
        stroke: C.ink,
        sw: 2,
      });
      svg.head(cx, yTop - 2, 0, -1, { stroke: C.ink, size: 10, width: 9 });
      svg.head(cx, yBot + 2, 0, 1, { stroke: C.ink, size: 10, width: 9 });
    } else {
      const d = `M${cx - b},${yTop} L${cx + b},${yTop} Q${cx},${yAxis} ${cx + b},${yBot} L${cx - b},${yBot} Q${cx},${yAxis} ${cx - b},${yTop} Z`;
      svg.path(d, { fill: C.cool, opacity: 0.12, stroke: "none" });
      svg.path(d, { fill: "none", stroke: C.ink, sw: 2 });
      svg.head(cx, yTop + 16, 0, 1, { stroke: C.ink, size: 10, width: 9 });
      svg.head(cx, yBot - 16, 0, -1, { stroke: C.ink, size: 10, width: 9 });
    }
  }

  /* ---- F and 2F ---------------------------------------------------- */
  const mark = (xo, txt) => {
    if (xo < xmin || xo > xmax) return;
    const px = X(xo);
    svg.line(px, yAxis - 5, px, yAxis + 5, { stroke: C.ink, sw: 1.4 });
    svg.circle(px, yAxis, 2.6, { fill: C.ink });
    svg.text(px, yAxis + 19, txt, {
      size: SIZE.tiny,
      weight: 700,
      anchor: "middle",
      fill: C.ink,
      lang: "en",
    });
  };
  if (!isPlane) {
    if (isMirror) {
      mark(-S.fs, "F");
      mark(-2 * S.fs, "C");
    } else {
      mark(-f, "F");
      mark(f, "F′");
      mark(-2 * f, "2F");
      mark(2 * f, "2F′");
    }
  }

  /* ---- rays -------------------------------------------------------- */
  const drawSeg = (s, o) => {
    const cl = clipSeg(s.a, s.b, BOX);
    if (!cl) return null;
    const p = [X(cl[0][0]), Y(cl[0][1])];
    const q = [X(cl[1][0]), Y(cl[1][1])];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.5) return null;
    svg.line(p[0], p[1], q[0], q[1], { stroke: s.c || C.cool, sw: o.sw ?? 1.7, dash: o.dash, cap: "round" });
    return [p, q];
  };
  guides.forEach((g) => {
    const cl = clipSeg(g.a, g.b, BOX);
    if (!cl) return;
    svg.line(X(cl[0][0]), Y(cl[0][1]), X(cl[1][0]), Y(cl[1][1]), {
      stroke: C.faint,
      sw: 1,
      dash: "2 4",
    });
  });
  dashed.forEach((s) => drawSeg(s, { dash: "6 5", sw: 1.5 }));
  solid.forEach((s) => {
    const seg = drawSeg(s, {});
    if (!seg) return;
    const [p, q] = seg;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const m = Math.hypot(dx, dy);
    if (m < 34) return;
    svg.head(p[0] + dx * 0.58, p[1] + dy * 0.58, dx, dy, { stroke: s.c || C.cool, size: 9, width: 7 });
  });

  /* ---- object + image arrows --------------------------------------- */
  // Labels sit BESIDE the shaft, never at the tip: the tip is exactly where the
  // construction rays converge, so a label there always lands on a ray.
  /** Text on an opaque backing box, so it survives whatever it lands on. */
  const halo = (px, py, txt, fill, anchor) => {
    const s = String(txt);
    const ur = lang === "ur" || hasUrdu(s);
    const tw = measure(s, SIZE.small, { weight: 700, lang: ur ? "ur" : "en" }) * (ur ? 1.3 : 1) + 10;
    const th2 = ur ? SIZE.small * 2.6 : SIZE.small * 1.5;
    const bx = anchor === "end" ? px - tw : anchor === "middle" ? px - tw / 2 : px;
    svg.rect(bx, py - th2 / 2, tw, th2, { fill: C.paper, opacity: 0.9 });
    svg.text(anchor === "end" ? px - 5 : anchor === "middle" ? px : px + 5, py, txt, {
      size: SIZE.small,
      weight: 700,
      anchor,
      baseline: "middle",
      fill,
      lang: lang === "ur" ? "ur" : "en",
    });
  };
  const sideLabel = (px, py, txt, fill) => {
    const left = px - MARGIN_L > BODY_W - MARGIN_R - px;
    halo(px + (left ? -9 : 9), py, txt, fill, left ? "end" : "start");
  };

  const objTip = Y(h);
  svg.arrow(X(-u), yAxis, X(-u), objTip, { stroke: C.leaf, sw: 3, size: 11, width: 9 });
  sideLabel(X(-u), (yAxis + objTip) / 2, L.object || "Object", C.leaf);

  if (hasImage && Math.abs(hp) > 1e-6) {
    const ix = X(S.imageX);
    const iy = Y(hp);
    svg.arrow(ix, yAxis, ix, iy, {
      stroke: C.warn,
      sw: 3,
      size: 11,
      width: 9,
      dash: S.real ? undefined : "6 5",
    });
    // BEYOND the arrowhead, never beside the shaft: the shaft sits on the axis
    // where the F / 2F tick labels live, and mid-shaft is where the arrowhead is.
    // The clamp keeps a short image arrow's label out of that tick-label band.
    const up = hp > 0;
    const ly = up ? Math.min(iy - 15, yAxis - 34) : Math.max(iy + 15, yAxis + 44);
    halo(ix, ly, L.image || "Image", C.warn, "middle");
  }

  /* ---- u / v / f dimension lines ------------------------------------ */
  const rowY = (i) => yAxis + AVAIL_V + 8 + i * 26;
  const dim = (xa, xb, i, txt) => {
    if (!Number.isFinite(xa) || !Number.isFinite(xb)) return;
    const y = rowY(i);
    const a = X(xa);
    const b = X(xb);
    if (Math.abs(b - a) < 8) return;
    svg.line(a, y - 8, a, y + 4, { stroke: C.faint, sw: 1 });
    svg.line(b, y - 8, b, y + 4, { stroke: C.faint, sw: 1 });
    svg.arrow(a, y, b, y, { stroke: C.muted, sw: 1.3, size: 8, width: 6, both: true });
    svg.text((a + b) / 2, y - 6, txt, {
      size: SIZE.small,
      anchor: "middle",
      fill: C.muted,
      weight: 700,
      lang: "en",
    });
  };
  dim(-u, 0, 0, L.u || `u = ${fmt(u)} ${unit}`);
  if (hasImage) dim(0, S.imageX, 1, L.v || `v = ${fmt(Math.abs(S.v))} ${unit}`);
  if (!isPlane) dim(0, isMirror ? -S.fs : f, 2, L.f || `f = ${fmt(f)} ${unit}`);

  return svg.toString();
}

module.exports = {
  type: "ray_diagram",
  aliases: ["optics", "lens", "mirror"],
  summary: "Solved lens / mirror ray construction — F, 2F, three rays, real or virtual image.",
  render,
  examples: [
    {
      name: "ray_convex_lens_beyond_2f",
      spec: {
        type: "ray_diagram",
        element: "convex_lens",
        f: 20,
        u: 60,
        hObject: 14,
        title: "Convex lens — object beyond 2F",
        source: "1/v − 1/u = 1/f, real-is-positive",
      },
    },
    {
      name: "ray_convex_lens_inside_f",
      spec: {
        type: "ray_diagram",
        element: "convex_lens",
        f: 20,
        u: 12,
        hObject: 9,
        title: "Convex lens — object inside F (a magnifying glass)",
      },
    },
    {
      name: "ray_concave_mirror",
      spec: {
        type: "ray_diagram",
        element: "concave_mirror",
        f: 15,
        u: 40,
        hObject: 11,
        title: "Concave mirror — object beyond C",
      },
    },
  ],
};
