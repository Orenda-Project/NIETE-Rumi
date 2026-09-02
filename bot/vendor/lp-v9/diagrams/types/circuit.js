// circuit — IEC-style electric circuit schematics for grade 6-12 physics.
//
// ENGINE DECISION (settled — do not re-litigate):
//   default `engine:'svg'`  -> our own symbol set, drawn right here in Node.
//   opt-in  `engine:'schemdraw'` -> shells out to ./.venv/bin/python. DEV ONLY.
// The production renderer is Node, inside the NIETE bot; a python subprocess is
// not acceptable on that path. The schemdraw branch exists so a human can
// eyeball a second opinion while authoring; if the venv is absent it silently
// falls back to the pure-SVG engine, so a spec never fails because of it.
//
// Symbol conventions are IEC / Pakistani-textbook, NOT US:
//   resistor  = plain rectangle (never a zigzag)
//   cell      = one long thin plate + one short thick plate
//   battery   = two (or `cells`) such pairs
//   lamp      = circle with a cross
//   switch    = hinged blade between two contact dots
//   ammeter / voltmeter = circle with A / V
//   capacitor = two parallel plates
//   fuse      = rectangle with a line straight through it
//
// Wires are orthogonal segments drawn *between* symbol bodies, so a symbol
// never has a wire running under it and no segment ever ends in mid-air.
// Labels live outside the loop (series) or beside the branch (parallel).
// Component VALUES ("6 V", "10 Ω") stay LTR even on an Urdu page — that is how
// Pakistani textbooks set them; only the descriptive label translates.

const { Svg, C, SIZE, hasUrdu } = require("../lib/svg");

/* ------------------------------------------------------------------ */
/* geometry constants                                                  */
/* ------------------------------------------------------------------ */
const BODY_W = 640;
const LEFT_X = 122;
const RIGHT_X = 566;
const LOOP_H = 176;
const PAR_LOOP_H = 200;

const WIRE = { stroke: C.ink, sw: 2, cap: "square" };
const DOT_R = 3.4;

const KNOWN = new Set([
  "battery",
  "cell",
  "resistor",
  "lamp",
  "bulb",
  "switch",
  "ammeter",
  "voltmeter",
  "wire",
  "capacitor",
  "fuse",
]);

const HALF = {
  resistor: 24,
  fuse: 24,
  lamp: 16,
  bulb: 16,
  switch: 21,
  ammeter: 16,
  voltmeter: 16,
  capacitor: 8,
  wire: 0,
};

function plateCount(c) {
  const k = c.kind;
  if (k === "cell") return Math.max(1, Math.round(c.cells ?? 1));
  return Math.max(1, Math.round(c.cells ?? 2));
}

/** Half-length of a symbol along the wire it sits on. */
function halfLen(c) {
  const k = c.kind;
  if (k === "battery" || k === "cell") return ((plateCount(c) - 1) * 15 + 7) / 2 + 3;
  return HALF[k] ?? 20;
}

const isSource = (c) => c && (c.kind === "battery" || c.kind === "cell");

/** Half-extent PERPENDICULAR to the wire — how far a label has to stand off. */
const PERP = {
  resistor: 9,
  fuse: 9,
  lamp: 16,
  bulb: 16,
  switch: 20,
  ammeter: 16,
  voltmeter: 16,
  capacitor: 14,
  battery: 14,
  cell: 14,
  wire: 0,
};
const perp = (c) => PERP[c && c.kind] ?? 12;

/* ------------------------------------------------------------------ */
/* symbols — each draws centred on (cx,cy); `vert` rotates the body     */
/* ------------------------------------------------------------------ */
function rotG(svg, cx, cy, vert, fn) {
  if (!vert) return fn(svg);
  return svg.group({ transform: `rotate(90 ${round(cx)} ${round(cy)})` }, fn);
}
const round = (v) => Math.round(Number(v) * 100) / 100;

function drawSymbol(svg, c, cx, cy, vert) {
  const k = KNOWN.has(c.kind) ? c.kind : "resistor";
  switch (k) {
    case "wire":
      return;

    case "resistor":
      rotG(svg, cx, cy, vert, (s) =>
        s.rect(cx - 24, cy - 9, 48, 18, { fill: C.paper, stroke: C.ink, sw: 1.8 })
      );
      return;

    case "fuse":
      rotG(svg, cx, cy, vert, (s) => {
        s.rect(cx - 24, cy - 9, 48, 18, { fill: C.paper, stroke: C.ink, sw: 1.8 });
        s.line(cx - 24, cy, cx + 24, cy, { stroke: C.ink, sw: 1.6 });
      });
      return;

    case "capacitor":
      rotG(svg, cx, cy, vert, (s) => {
        s.line(cx - 4, cy - 14, cx - 4, cy + 14, { stroke: C.ink, sw: 2.6 });
        s.line(cx + 4, cy - 14, cx + 4, cy + 14, { stroke: C.ink, sw: 2.6 });
      });
      return;

    case "battery":
    case "cell": {
      const n = plateCount(c);
      const w = (n - 1) * 15 + 7;
      rotG(svg, cx, cy, vert, (s) => {
        for (let i = 0; i < n; i++) {
          const x = cx - w / 2 + i * 15;
          // long thin plate = the + terminal, short thick plate = the − terminal
          s.line(x, cy - 14, x, cy + 14, { stroke: C.ink, sw: 1.7 });
          s.line(x + 7, cy - 7.5, x + 7, cy + 7.5, { stroke: C.ink, sw: 4.4 });
        }
      });
      return;
    }

    case "lamp":
    case "bulb": {
      svg.circle(cx, cy, 16, { fill: C.paper, stroke: C.ink, sw: 1.8 });
      const d = 16 * 0.7071;
      svg.line(cx - d, cy - d, cx + d, cy + d, { stroke: C.ink, sw: 1.6 });
      svg.line(cx - d, cy + d, cx + d, cy - d, { stroke: C.ink, sw: 1.6 });
      return;
    }

    case "switch": {
      const closed = c.closed !== undefined ? !!c.closed : String(c.value ?? "").toLowerCase() !== "open";
      rotG(svg, cx, cy, vert, (s) => {
        s.circle(cx - 21, cy, 2.8, { fill: C.ink });
        s.circle(cx + 21, cy, 2.8, { fill: C.ink });
        if (closed) s.line(cx - 21, cy, cx + 21, cy - 4, { stroke: C.ink, sw: 2.2, cap: "round" });
        else s.line(cx - 21, cy, cx + 12, cy - 19, { stroke: C.ink, sw: 2.2, cap: "round" });
      });
      return;
    }

    case "ammeter":
    case "voltmeter": {
      svg.circle(cx, cy, 16, { fill: C.paper, stroke: C.ink, sw: 1.8 });
      svg.text(cx, cy, k === "ammeter" ? "A" : "V", {
        size: SIZE.label,
        weight: 700,
        anchor: "middle",
        baseline: "middle",
        fill: C.ink,
        lang: "en",
      });
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------------ */
/* label stacks                                                        */
/* ------------------------------------------------------------------ */
function linesFor(c, lang) {
  const out = [];
  const lbl = c.label;
  if (lbl !== undefined && lbl !== null && String(lbl) !== "")
    out.push({ t: String(lbl), ur: lang === "ur" || hasUrdu(String(lbl)) });
  const val = c.value;
  if (val !== undefined && val !== null && String(val) !== "")
    out.push({ t: String(val), ur: false });
  return out;
}
const ADV = (l) => (l.ur ? 30 : 17);

function stackSum(lines) {
  let s = 0;
  for (let i = 0; i < lines.length - 1; i++) s += ADV(lines[i]);
  return s;
}
/** Baseline gap between the wire and the label line nearest to it. */
function clearUp(lines, p) {
  const last = lines[lines.length - 1];
  return p + 9 + (last && last.ur ? 13 : 0);
}
function clearDown(lines, p) {
  const first = lines[0];
  return p + 7 + (first && first.ur ? 24 : 11);
}
function needAbove(lines, p) {
  if (!lines.length) return 0;
  return clearUp(lines, p) + stackSum(lines) + (lines[0].ur ? 26 : 12);
}
function needBelow(lines, p) {
  if (!lines.length) return 0;
  const last = lines[lines.length - 1];
  return clearDown(lines, p) + stackSum(lines) + (last.ur ? 15 : 6);
}

function drawStack(svg, x, y0, lines, opt) {
  let y = y0;
  for (const l of lines) {
    svg.text(x, y, l.t, {
      size: SIZE.small,
      fill: C.text,
      weight: l === lines[0] ? 700 : undefined,
      ...opt,
      lang: l.ur ? "ur" : "en",
    });
    y += ADV(l);
  }
}
const stackUp = (svg, x, wireY, lines, opt, p = 4) =>
  lines.length && drawStack(svg, x, wireY - clearUp(lines, p) - stackSum(lines), lines, opt);
const stackDown = (svg, x, wireY, lines, opt, p = 4) =>
  lines.length && drawStack(svg, x, wireY + clearDown(lines, p), lines, opt);
const stackMid = (svg, x, cy, lines, opt) =>
  drawStack(svg, x, cy - stackSum(lines) / 2 + (lines.length && lines[0].ur ? 6 : 5), lines, opt);

/* ------------------------------------------------------------------ */
/* wire runs with gaps for symbols                                     */
/* ------------------------------------------------------------------ */
function runH(svg, y, xa, xb, stops) {
  let cur = xa;
  for (const s of stops.slice().sort((a, b) => a.x - b.x)) {
    if (s.x - s.h > cur) svg.line(cur, y, s.x - s.h, y, WIRE);
    cur = Math.max(cur, s.x + s.h);
  }
  if (xb > cur) svg.line(cur, y, xb, y, WIRE);
}
function runV(svg, x, ya, yb, stops) {
  let cur = ya;
  for (const s of stops.slice().sort((a, b) => a.y - b.y)) {
    if (s.y - s.h > cur) svg.line(x, cur, x, s.y - s.h, WIRE);
    cur = Math.max(cur, s.y + s.h);
  }
  if (yb > cur) svg.line(x, cur, x, yb, WIRE);
}

/* ------------------------------------------------------------------ */
/* spec normalisation                                                  */
/* ------------------------------------------------------------------ */
function normCells(spec) {
  const raw = Array.isArray(spec.cells) ? spec.cells : Array.isArray(spec.components) ? spec.components : [];
  const out = raw
    .filter((c) => c && typeof c === "object")
    .map((c) => ({ ...c, kind: KNOWN.has(c.kind) ? c.kind : "resistor" }))
    .filter((c) => c.kind !== "wire");
  if (out.length) return out;
  // graceful default: the simplest complete circuit a textbook ever prints
  return [
    { kind: "battery", label: "Battery", value: "6 V" },
    { kind: "resistor", label: "R", value: "10 Ω" },
    { kind: "lamp", label: "Lamp" },
  ];
}

/* ------------------------------------------------------------------ */
/* SERIES                                                              */
/* ------------------------------------------------------------------ */
function renderSeries(spec, cells) {
  const lang = spec.lang;
  const si = cells.findIndex(isSource);
  const source = si >= 0 ? cells[si] : null;
  const rest = cells.filter((_, i) => i !== si);

  let top = rest;
  let bottom = [];
  if (rest.length > 4) {
    const k = Math.ceil(rest.length / 2);
    top = rest.slice(0, k);
    bottom = rest.slice(k).reverse();
  }

  const topLines = top.map((c) => linesFor(c, lang));
  const botLines = bottom.map((c) => linesFor(c, lang));
  const marginTop = Math.max(18, ...topLines.map((l, i) => needAbove(l, perp(top[i])))) + 4;
  const marginBottom = Math.max(20, ...botLines.map((l, i) => needBelow(l, perp(bottom[i])))) + 4;

  const topY = marginTop;
  const botY = topY + LOOP_H;
  const midY = (topY + botY) / 2;
  const bodyH = marginTop + LOOP_H + marginBottom;

  const svg = new Svg(BODY_W, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang,
    spec,
  });

  const place = (arr, xa, xb) =>
    arr.map((c, i) => ({ c, x: xa + ((xb - xa) * (i + 1)) / (arr.length + 1), h: halfLen(c) }));

  const topPos = place(top, LEFT_X, RIGHT_X);
  const botPos = place(bottom, LEFT_X, RIGHT_X);

  // wires
  runH(svg, topY, LEFT_X, RIGHT_X, topPos);
  runH(svg, botY, LEFT_X, RIGHT_X, botPos);
  runV(svg, RIGHT_X, topY, botY, []);
  runV(svg, LEFT_X, topY, botY, source ? [{ y: midY, h: halfLen(source) }] : []);

  // symbols
  topPos.forEach((p) => drawSymbol(svg, p.c, p.x, topY, false));
  botPos.forEach((p) => drawSymbol(svg, p.c, p.x, botY, false));
  if (source) drawSymbol(svg, source, LEFT_X, midY, true);

  // labels, always outside the loop
  topPos.forEach((p, i) => stackUp(svg, p.x, topY, topLines[i], { anchor: "middle" }, perp(p.c)));
  botPos.forEach((p, i) => stackDown(svg, p.x, botY, botLines[i], { anchor: "middle" }, perp(p.c)));
  if (source) stackMid(svg, LEFT_X - perp(source) - 10, midY, linesFor(source, lang), { anchor: "end" });

  // conventional-current arrow on the right rail, unless switched off
  if (spec.showCurrent !== false) {
    svg.arrow(RIGHT_X, midY - 16, RIGHT_X, midY + 20, { stroke: C.accent, sw: 2.4, size: 11 });
    svg.text(RIGHT_X - 14, midY + 4, spec.currentLabel || "I", {
      size: SIZE.small,
      weight: 700,
      anchor: "end",
      baseline: "middle",
      fill: C.accent,
      lang: hasUrdu(String(spec.currentLabel ?? "")) ? "ur" : "en",
    });
  }
  return svg.toString();
}

/* ------------------------------------------------------------------ */
/* PARALLEL                                                            */
/* ------------------------------------------------------------------ */
function renderParallel(spec, cells) {
  const lang = spec.lang;
  const si = cells.findIndex(isSource);
  const source = si >= 0 ? cells[si] : null;
  const rest = cells.filter((_, i) => i !== si);

  const mains = rest.filter((c) => c.main === true);
  const across = rest.filter((c) => c.main !== true && c.across !== undefined && c.across !== null);
  const branchCells = rest.filter((c) => c.main !== true && (c.across === undefined || c.across === null));

  // explicit multi-component branches win over the flat cells list
  const branches = Array.isArray(spec.branches)
    ? spec.branches.map((b) => (Array.isArray(b) ? b : [b]).map((c) => ({ ...c, kind: KNOWN.has(c.kind) ? c.kind : "resistor" })))
    : branchCells.map((c) => [c]);
  const nb = Math.max(1, branches.length);

  const mainLines = mains.map((c) => linesFor(c, lang));
  const marginTop = Math.max(22, ...mainLines.map((l, i) => needAbove(l, perp(mains[i])))) + 4;
  const marginBottom = 26;

  const topY = marginTop;
  const botY = topY + PAR_LOOP_H;
  const midY = (topY + botY) / 2;
  const bodyH = marginTop + PAR_LOOP_H + marginBottom;

  const svg = new Svg(BODY_W, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang,
    spec,
  });

  const span = RIGHT_X - LEFT_X;
  const bx = (i) => LEFT_X + (span * (i + 1)) / (nb + 1);

  // main-line components sit on the top rail, left of the first branch
  const mainA = LEFT_X + 18;
  const mainB = bx(0) - 26;
  const mainPos = mains.map((c, i) => ({
    c,
    x: mainA + ((mainB - mainA) * (i + 1)) / (mains.length + 1),
    h: halfLen(c),
  }));

  // rails
  runH(svg, topY, LEFT_X, RIGHT_X, mainPos);
  runH(svg, botY, LEFT_X, RIGHT_X, []);
  runV(svg, RIGHT_X, topY, botY, []);
  runV(svg, LEFT_X, topY, botY, source ? [{ y: midY, h: halfLen(source) }] : []);

  if (source) {
    drawSymbol(svg, source, LEFT_X, midY, true);
    stackMid(svg, LEFT_X - perp(source) - 10, midY, linesFor(source, lang), { anchor: "end" });
  }
  mainPos.forEach((p, i) => {
    drawSymbol(svg, p.c, p.x, topY, false);
    stackUp(svg, p.x, topY, mainLines[i], { anchor: "middle" }, perp(p.c));
  });

  // branches
  branches.forEach((comps, i) => {
    const x = bx(i);
    const list = comps.filter((c) => c.kind !== "wire");
    const stops = list.map((c, j) => ({
      y: midY + (j - (list.length - 1) / 2) * 54,
      h: halfLen(c),
      c,
    }));
    runV(svg, x, topY, botY, stops);
    stops.forEach((s) => drawSymbol(svg, s.c, x, s.y, true));
    stops.forEach((s) => stackMid(svg, x - perp(s.c) - 8, s.y, linesFor(s.c, lang), { anchor: "end" }));
    svg.circle(x, topY, DOT_R, { fill: C.ink });
    svg.circle(x, botY, DOT_R, { fill: C.ink });
  });

  // instruments wired across one branch (a voltmeter, normally)
  across.forEach((c) => {
    const i = Math.max(0, Math.min(nb - 1, Math.round(Number(c.across) || 0)));
    const x = bx(i);
    const off = 62;
    const ya = midY - 48;
    const yb = midY + 48;
    const h = halfLen(c);
    svg.line(x, ya, x + off, ya, WIRE);
    svg.line(x, yb, x + off, yb, WIRE);
    svg.line(x + off, ya, x + off, midY - h, WIRE);
    svg.line(x + off, midY + h, x + off, yb, WIRE);
    svg.circle(x, ya, DOT_R, { fill: C.ink });
    svg.circle(x, yb, DOT_R, { fill: C.ink });
    drawSymbol(svg, c, x + off, midY, true);
    const lines = linesFor(c, lang);
    if (lines.length) stackUp(svg, x + off, ya - 2, lines, { anchor: "middle" }, 0);
  });

  if (spec.showCurrent !== false) {
    svg.arrow(LEFT_X + 4, topY, mainPos.length ? mainPos[0].x - mainPos[0].h - 6 : bx(0) - 34, topY, {
      stroke: C.accent,
      sw: 2.4,
      size: 11,
    });
    svg.text(LEFT_X + 16, topY - 9, spec.currentLabel || "I", {
      size: SIZE.small,
      weight: 700,
      anchor: "middle",
      fill: C.accent,
      lang: hasUrdu(String(spec.currentLabel ?? "")) ? "ur" : "en",
    });
  }
  return svg.toString();
}

/* ------------------------------------------------------------------ */
/* OPT-IN schemdraw engine — dev only, never on the production path.   */
/* ------------------------------------------------------------------ */
const SD_MAP = {
  battery: "elm.Battery()",
  cell: "elm.Cell()",
  resistor: "elm.ResistorIEC()",
  lamp: "elm.Lamp()",
  bulb: "elm.Lamp()",
  switch: "elm.Switch()",
  ammeter: "elm.MeterA()",
  voltmeter: "elm.MeterV()",
  capacitor: "elm.Capacitor()",
  fuse: "elm.Fuse()",
  wire: "elm.Line()",
};

function schemdrawScript(spec, cells) {
  const lines = [
    "import schemdraw, sys",
    "from schemdraw import elements as elm",
    "schemdraw.use('svg')",
    "d = schemdraw.Drawing(show=False)",
  ];
  const lbl = (c) => {
    const parts = [c.label, c.value].filter((v) => v !== undefined && v !== null && String(v) !== "");
    return parts.length ? `.label(${JSON.stringify(parts.join("  "))})` : "";
  };
  // one clean rectangular loop: k elements along the top, k along the bottom
  const n = cells.length;
  const k = Math.ceil(n / 2);
  const top = cells.slice(0, k);
  const bottom = cells.slice(k).reverse();
  const sym = (c) => SD_MAP[c.kind] || "elm.ResistorIEC()";
  top.forEach((c) => lines.push(`d += ${sym(c)}.right()${lbl(c)}`));
  lines.push("d += elm.Line().down()");
  bottom.forEach((c) => lines.push(`d += ${sym(c)}.left()${lbl(c)}`));
  for (let i = bottom.length; i < k; i++) lines.push("d += elm.Line().left()");
  lines.push("d += elm.Line().up()");
  lines.push("sys.stdout.write(d.get_imagedata('svg').decode())");
  return lines.join("\n");
}

function renderSchemdraw(spec, cells) {
  let fs, cp, path;
  try {
    fs = require("fs");
    cp = require("child_process");
    path = require("path");
  } catch (e) {
    return null;
  }
  const py = path.join(__dirname, "..", ".venv", "bin", "python");
  if (!fs.existsSync(py)) return null;
  let raw;
  try {
    raw = cp.execFileSync(py, ["-c", schemdrawScript(spec, cells)], {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return null;
  }
  const m = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(raw || "");
  if (!m) return null;
  const head = /<svg\b[^>]*>/.exec(raw)[0];
  const vb = /viewBox="([-\d.\s]+)"/.exec(head);
  if (!vb) return null;
  const [vx, vy, vw, vh] = vb[1].trim().split(/\s+/).map(Number);
  if (!(vw > 0 && vh > 0)) return null;
  // strip anything with a timestamp or generator note so the bytes stay stable
  const inner = m[1].replace(/<!--[\s\S]*?-->/g, "").replace(/<(title|desc)>[\s\S]*?<\/\1>/g, "");
  const bodyW = BODY_W;
  const bodyH = Math.min(430, Math.max(180, Math.round((bodyW * vh) / vw)));
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });
  svg.add(
    `<svg x="0" y="0" width="${bodyW}" height="${bodyH}" viewBox="${vx} ${vy} ${vw} ${vh}" ` +
      `preserveAspectRatio="xMidYMid meet">${inner}</svg>`
  );
  return svg.toString();
}

/* ------------------------------------------------------------------ */
function render(spec) {
  const s = spec && typeof spec === "object" ? spec : {};
  const cells = normCells(s);
  if (s.engine === "schemdraw") {
    const out = renderSchemdraw(s, cells);
    if (out) return out; // else: silent fall-through to the real engine
  }
  const layout = s.layout === "parallel" ? "parallel" : "series";
  return layout === "parallel" ? renderParallel(s, cells) : renderSeries(s, cells);
}

module.exports = {
  type: "circuit",
  aliases: ["circuit_diagram"],
  summary: "IEC-style series / parallel circuit schematic — battery, resistor, lamp, switch, meters.",
  render,
  examples: [
    {
      name: "circuit_series",
      spec: {
        type: "circuit",
        layout: "series",
        title: "A simple series circuit",
        cells: [
          { kind: "battery", label: "Battery", value: "6 V" },
          { kind: "switch", label: "Switch", value: "closed", closed: true },
          { kind: "resistor", label: "Resistor", value: "10 Ω" },
          { kind: "lamp", label: "Lamp" },
          { kind: "ammeter", label: "Ammeter", value: "0.4 A" },
        ],
        caption: "One path only — the same current passes through every component.",
      },
    },
    {
      name: "circuit_parallel_voltmeter",
      spec: {
        type: "circuit",
        layout: "parallel",
        title: "Two lamps in parallel",
        cells: [
          { kind: "battery", label: "Battery", value: "6 V" },
          { kind: "ammeter", label: "Ammeter", main: true },
          { kind: "lamp", label: "Lamp L₁" },
          { kind: "lamp", label: "Lamp L₂" },
          { kind: "voltmeter", label: "Voltmeter", value: "6 V", across: 1 },
        ],
        caption: "Each lamp gets the full 6 V; the voltmeter reads the p.d. across L₂.",
      },
    },
    {
      name: "circuit_series_ur",
      spec: {
        type: "circuit",
        layout: "series",
        lang: "ur",
        title: "سلسلہ وار سرکٹ",
        cells: [
          { kind: "battery", label: "بیٹری", value: "6 V" },
          { kind: "switch", label: "سوئچ", closed: true },
          { kind: "resistor", label: "مزاحمت", value: "10 Ω" },
          { kind: "lamp", label: "بلب" },
        ],
        currentLabel: "کرنٹ",
        caption: "ایک ہی راستہ ہے — ہر جزو میں سے ایک ہی کرنٹ گزرتی ہے۔",
      },
    },
  ],
};
