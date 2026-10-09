// solid — a 3-D solid drawn as a flat oblique sketch: a cube (the wireframe
// every textbook draws by hand — a front face plus one set of receding edges)
// and a sphere (a circle with a foreshortened "equator" ellipse for the curve).
//
// FIXWAVE (G4 ch9 Science, WRITE ON THE BOARD as a picture, never text). The
// two authored boards this exists for draw a cube ascii wireframe next to
// prose naming its parts ("Label one corner: vertex; label one line: edge;
// shade one square side: face") or a MODEL TABLE of face/edge/vertex counts
// for several solids. This engine had no generic 3-D renderer and does not
// need one for that: the ascii itself is already the flat oblique sketch a
// teacher draws on a real board, an SVG polygon reproduces it exactly, and
// every FACE/EDGE/VERTEX word and count is printed back as a label or folded
// into `caption` — never invented (see the Python builder's own docstring on
// where the numbers come from).
//
// Spec
//   shapes    [{kind:"cube"|"sphere", showLabels:["vertex","edge","face"]}]
//             1-2 entries, drawn left to right
//   caption   spec-level (see svg.js) — the only place per-shape fact text
//             goes; geometry.js has no per-shape caption and neither does this
//   lang      "en" | "ur"
//
// bd-yggj4o.1 (8 Oct): G2 ch13 worksheets need cube, cuboid, cone, cylinder, sphere and the book's
// pyramid as REAL pictures (Amena: "words wont do"). Per shape: `name` (false hides it, so a
// "name this shape" item never prints its own answer; a string replaces it) and `turn` (degrees,
// cube/cuboid/pyramid only: the "cube turned on its corner" item). 1-6 shapes.
// Only the six kinds below are drawn. Any other `kind` is a build-time error, not a silent placeholder:
// d0_board_draw.py's docstring is explicit that a spec the engine cannot
// render becomes a visible "not rendered" placeholder on the page, worse than
// no figure — so a builder must never emit a kind this file doesn't handle.

const { Svg, C, SIZE } = require("../lib/svg");

const D = 46 * 0.72; // oblique receding run, x and y
const KINDS = ["cube", "cuboid", "cylinder", "cone", "sphere", "pyramid", "prism"];
const TURNABLE = new Set(["cube", "cuboid", "pyramid", "prism"]);
const SIDED = { 3: "triangular", 4: "square", 5: "pentagonal", 6: "hexagonal", 8: "octagonal" };
const INK = { stroke: C.ink, sw: 2.2 };
const HIDDEN = { stroke: C.faint, sw: 1.4, dash: "4 3" };

// Each kind returns parts in local coords (front-bottom-left at 0,0; up is -y). Polygon/line/dot/text
// parts rotate; a curved kind returns {bbox, draw(svg, dx, dy)} directly.
function boxParts(w, h, want) {
  const fbl = [0, 0], fbr = [w, 0], ftr = [w, -h], ftl = [0, -h];
  const btl = [D, -h - D], btr = [w + D, -h - D], bbr = [w + D, -D];
  const parts = [
    { k: "poly", pts: [ftl, ftr, btr, btl], o: { fill: C.panel, ...INK } },
    { k: "poly", pts: [fbr, ftr, btr, bbr], o: { fill: C.panel, ...INK } },
    { k: "poly", pts: [fbl, fbr, ftr, ftl], o: { fill: want.has("face") ? C.wash : C.paper, ...INK } },
    // The three hidden edges meet at the back-bottom-left corner; drawn last, dashed, through the faces.
    { k: "line", pts: [btl, [D, -D]], o: HIDDEN },
    { k: "line", pts: [[D, -D], bbr], o: HIDDEN },
    { k: "line", pts: [[D, -D], fbl], o: HIDDEN },
  ];
  if (want.has("vertex")) {
    parts.push({ k: "dot", pts: [ftr] }, { k: "text", pts: [[w + 16, -h - 8]], str: "vertex", anchor: "start" });
  }
  if (want.has("edge")) parts.push({ k: "text", pts: [[w / 2, -h - 12]], str: "edge", anchor: "middle" });
  if (want.has("face")) parts.push({ k: "text", pts: [[w / 2, -h / 2]], str: "face", anchor: "middle" });
  return parts;
}

function pyramidParts() {
  const s = 130, d = 40;
  const fl = [0, 0], fr = [s, 0], br = [s + d, -d], bl = [d, -d], apex = [(s + d) / 2, -d / 2 - 135];
  return [
    { k: "poly", pts: [fr, br, apex], o: { fill: C.panel, ...INK } },
    { k: "poly", pts: [fl, fr, apex], o: { fill: C.paper, ...INK } },
    { k: "line", pts: [fl, bl], o: HIDDEN }, { k: "line", pts: [bl, br], o: HIDDEN }, { k: "line", pts: [bl, apex], o: HIDDEN },
  ];
}

// bd-yggj4o.1 (8 Oct, G3 ch14 pp.229/231): a prism or pyramid on a regular n-sided base, seen from a little
// above. The base is a squashed polygon with a corner 17 degrees off dead-front, so two faces show and no back
// edge hides behind a front one. A base edge is in front when its midpoint lies on the near (lower) half; a side face shows when its
// base edge does, and an upright or slant edge is solid when it borders a face that shows, else dashed.
function sidedParts(kind, n) {
  const rx = 62, ry = 26, h = kind === "prism" ? 120 : 140;
  const B = Array.from({ length: n }, (_, k) => {
    const a = ((107 + (360 * k) / n) * Math.PI) / 180;
    return [rx + rx * Math.cos(a), ry * Math.sin(a)];
  });
  const nx = (k) => (k + 1) % n;
  const near = B.map((p, k) => (p[1] + B[nx(k)][1]) / 2 > 0);
  const edgeShows = (k) => near[k] || near[(k + n - 1) % n];
  const parts = [], hidden = [];
  if (kind === "prism") {
    const T = B.map(([x, y]) => [x, y - h]);
    B.forEach((p, k) => near[k] && parts.push({ k: "poly", pts: [p, B[nx(k)], T[nx(k)], T[k]], o: { fill: C.paper, ...INK } }));
    parts.push({ k: "poly", pts: T, o: { fill: C.panel, ...INK } });
    B.forEach((p, k) => !edgeShows(k) && hidden.push({ k: "line", pts: [p, T[k]], o: HIDDEN }));
  } else {
    const apex = [rx, -h];
    B.forEach((p, k) => near[k] && parts.push({ k: "poly", pts: [p, B[nx(k)], apex], o: { fill: C.paper, ...INK } }));
    B.forEach((p, k) => !edgeShows(k) && hidden.push({ k: "line", pts: [p, apex], o: HIDDEN }));
  }
  B.forEach((p, k) => !near[k] && hidden.push({ k: "line", pts: [p, B[nx(k)]], o: HIDDEN }));
  return parts.concat(hidden);
}

function defaultName(s) {
  return s.sides ? `${SIDED[s.sides]} ${s.kind}` : s.kind;
}

// A turned cube is the cube seen down a body diagonal: a hexagon of three equal rhombus faces that
// meet at the near corner (an oblique sketch spun flat read as a slanted prism, not a die). `turn`
// then tips that picture so it stands on a corner.
function isoCubeParts(r) {
  const P = [0, 1, 2, 3, 4, 5].map((k) => [r * Math.cos(((-90 + 60 * k) * Math.PI) / 180), r * Math.sin(((-90 + 60 * k) * Math.PI) / 180)]);
  const c = [0, 0];
  return [
    { k: "poly", pts: [c, P[5], P[0], P[1]], o: { fill: C.panel, ...INK } },
    { k: "poly", pts: [c, P[1], P[2], P[3]], o: { fill: C.paper, ...INK } },
    { k: "poly", pts: [c, P[3], P[4], P[5]], o: { fill: C.wash, ...INK } },
  ];
}

function textW(str) { return String(str).length * 7.5; }

function polyShape(parts, turn) {
  const all = parts.flatMap((p) => p.pts);
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const a = ((turn || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const rot = ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
  const rp = parts.map((p) => ({ ...p, pts: p.pts.map(rot) }));
  const ext = rp.flatMap((p) => {
    if (p.k !== "text") return p.pts;
    const [x, y] = p.pts[0], w = textW(p.str), x0 = p.anchor === "middle" ? x - w / 2 : x;
    return [[x0, y - 14], [x0 + w, y + 4]];
  });
  const bbox = [Math.min(...ext.map((p) => p[0])), Math.min(...ext.map((p) => p[1])),
    Math.max(...ext.map((p) => p[0])), Math.max(...ext.map((p) => p[1]))];
  const draw = (svg, dx, dy) => rp.forEach((p) => {
    const q = p.pts.map(([x, y]) => [x + dx, y + dy]);
    if (p.k === "poly") svg.polygon(q, p.o);
    else if (p.k === "line") svg.line(q[0][0], q[0][1], q[1][0], q[1][1], p.o);
    else if (p.k === "dot") svg.circle(q[0][0], q[0][1], 4.5, { fill: C.accent, stroke: C.ink, sw: 1 });
    else svg.plateText(q[0][0], q[0][1], p.str, { size: SIZE.small, fill: C.ink, anchor: p.anchor });
  });
  return { bbox, draw };
}

function cylinder() {
  const rx = 55, ry = 16, h = 130;
  return {
    bbox: [0, -h - ry, 2 * rx, ry],
    draw(svg, dx, dy) {
      const L = dx, R = dx + 2 * rx, B = dy, T = dy - h;
      svg.path(`M ${L} ${T} L ${L} ${B} A ${rx} ${ry} 0 0 0 ${R} ${B} L ${R} ${T}`, { fill: C.paper, ...INK });
      svg.path(`M ${L} ${B} A ${rx} ${ry} 0 0 1 ${R} ${B}`, { fill: "none", ...HIDDEN });
      svg.ellipse(dx + rx, T, rx, ry, { fill: C.panel, ...INK });
    },
  };
}

function cone() {
  const rx = 60, ry = 17, h = 140;
  return {
    bbox: [0, -h, 2 * rx, ry],
    draw(svg, dx, dy) {
      const L = dx, R = dx + 2 * rx, B = dy;
      svg.path(`M ${L} ${B} L ${dx + rx} ${B - h} L ${R} ${B} A ${rx} ${ry} 0 0 1 ${L} ${B} Z`, { fill: C.paper, ...INK });
      svg.path(`M ${L} ${B} A ${rx} ${ry} 0 0 1 ${R} ${B}`, { fill: "none", ...HIDDEN });
    },
  };
}

function sphere() {
  const r = 52;
  return {
    bbox: [0, -2 * r, 2 * r, 0],
    draw(svg, dx, dy) {
      svg.circle(dx + r, dy - r, r, { fill: C.paper, ...INK });
      // The foreshortened "equator" is how every textbook draws the curve of a sphere on a flat board.
      svg.ellipse(dx + r, dy - r, r, r * 0.32, { fill: "none", stroke: C.ink, sw: 1.6, dash: "5 4" });
    },
  };
}

function shapeOf(s) {
  const want = new Set(s.showLabels || []);
  if (s.turn && !TURNABLE.has(s.kind)) throw new Error(`solid: \`turn\` is for cube, cuboid or pyramid, not ${s.kind}`);
  if (s.kind === "prism" || s.sides !== undefined) {
    if (!SIDED[s.sides] || !["prism", "pyramid"].includes(s.kind)) {
      throw new Error(`solid: a prism or pyramid needs \`sides\` of ${Object.keys(SIDED).join(", ")} (got ${s.kind} ${s.sides})`);
    }
    return polyShape(sidedParts(s.kind, s.sides), s.turn);
  }
  if (s.kind === "cube" && s.turn) return polyShape(isoCubeParts(95), s.turn);
  if (s.kind === "cube") return polyShape(boxParts(120, 120, want), s.turn);
  if (s.kind === "cuboid") return polyShape(boxParts(170, 85, want), s.turn);
  if (s.kind === "pyramid") return polyShape(pyramidParts(), s.turn);
  return { cylinder, cone, sphere }[s.kind]();
}

function render(spec) {
  const shapes = Array.isArray(spec.shapes) ? spec.shapes : [];
  if (!shapes.length) throw new Error("solid: `shapes` needs at least one shape");
  if (shapes.length > 6) throw new Error("solid: at most 6 shapes in one picture");
  shapes.forEach((s) => {
    if (!s || !KINDS.includes(s.kind)) {
      throw new Error(`solid: unknown shape kind ${JSON.stringify(s && s.kind)} (drawn: ${KINDS.join(", ")})`);
    }
  });

  const PAD = 30, NAME_H = 44, GAP = shapes.length > 2 ? 34 : 60;
  const drawn = shapes.map((s) => {
    const g = shapeOf(s);
    const name = s.name === false ? "" : typeof s.name === "string" ? s.name : defaultName(s);
    const w = Math.max(g.bbox[2] - g.bbox[0], name ? textW(name) * 1.5 : 0);
    return { g, name, w, h: g.bbox[3] - g.bbox[1] };
  });
  const maxH = Math.max(...drawn.map((d) => d.h));
  const bodyW = drawn.reduce((t, d) => t + d.w, 0) + GAP * (drawn.length - 1) + PAD * 2;
  const bodyH = maxH + PAD * 2 + NAME_H;
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: spec.lang === "ur" ? "ur" : "en", spec,
  });

  const baseY = PAD + maxH;
  let x = PAD;
  for (const d of drawn) {
    const sw = d.g.bbox[2] - d.g.bbox[0];
    d.g.draw(svg, x + (d.w - sw) / 2 - d.g.bbox[0], baseY - d.g.bbox[3]);
    if (d.name) svg.text(x + d.w / 2, bodyH - 8, d.name, { size: SIZE.big, weight: 700, anchor: "middle", fill: C.ink });
    x += d.w + GAP;
  }
  return svg.toString();
}

module.exports = {
  type: "solid",
  aliases: ["solid_shape", "cube_sphere", "3d_shape"],
  summary: "3-D solids (cube, cuboid, cylinder, cone, sphere, pyramid, n-sided prism/pyramid) as flat sketches; names can be hidden.",
  render,
  examples: [
    {
      name: "solid_cube_labelled",
      spec: {
        type: "solid",
        shapes: [{ kind: "cube", showLabels: ["vertex", "edge", "face"] }],
        caption: "cube: 6 faces, 12 edges, 8 vertices",
      },
    },
    {
      name: "solid_cube_and_sphere",
      spec: {
        type: "solid",
        shapes: [{ kind: "cube", showLabels: ["vertex", "edge", "face"] }, { kind: "sphere" }],
        caption: "cube: 6 faces, 12 edges, 8 vertices; sphere: 1 face, 0 edges, 0 vertices",
      },
    },
    {
      name: "solid_g2_five",
      spec: { type: "solid", shapes: ["cube", "cuboid", "cylinder", "cone", "sphere"].map((kind) => ({ kind })) },
    },
    {
      name: "solid_identify_unnamed",
      spec: { type: "solid", shapes: [{ kind: "cone", name: "A" }, { kind: "cube", turn: 40, name: "B" }, { kind: "pyramid", name: "C" }] },
    },
    // VENDOR DIVERGENCE (bd-yggj4o.2) — SYNC.md 2026-10-09: upstream ships ONE six-shape example
    // (three prisms + three pyramids). Its smallest label renders at 7.51px in the full phone
    // column, under the 8.74px floor tests/lp612/diagram-label-floor.test.js sweeps every example
    // against. Split into two three-shape examples (15.5px / 14.0px); the render code is untouched.
    {
      name: "solid_g3_prisms",
      spec: { type: "solid", shapes: [3, 6, 8].map((sides) => ({ kind: "prism", sides })) },
    },
    {
      name: "solid_g3_pyramids",
      spec: { type: "solid", shapes: [3, 6, 8].map((sides) => ({ kind: "pyramid", sides })) },
    },
  ],
};
