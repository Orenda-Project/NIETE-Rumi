// atom — Bohr shell models and dot-and-cross bonding pictures.
//
// Two modes off one element table:
//   mode:'bohr'       nucleus (symbol + p⁺/n⁰) inside concentric shells, with
//                     the electrons as filled circles at deterministic angles
//                     and each shell labelled with its electron count.
//   mode:'dot_cross'  the outer-shell-only bonding picture for a PAIR of atoms:
//                     ionic (separated ions, charges inside square brackets) or
//                     covalent (overlapping circles with the shared pair in the
//                     lens). The first atom's electrons are DOTS, the second's
//                     are CROSSES — the whole point of the convention.
//
// The built-in table covers H..Ca plus Fe, Cu, Zn, Br, I, so a caller can write
// {element:'Na'} and get 11 protons, 12 neutrons and 2,8,1. An explicit
// `shells` in the spec always wins, and the shell counts are what the electrons
// are drawn from — so what is drawn always sums to what is labelled.

const { Svg, C, SIZE, hasUrdu, measure } = require("../lib/svg");

const SHELL_LETTERS = ["K", "L", "M", "N", "O", "P", "Q"];

// symbol: [Z, neutrons (commonest isotope), shells, name]
const TABLE = {
  H: [1, 0, [1], "Hydrogen"],
  He: [2, 2, [2], "Helium"],
  Li: [3, 4, [2, 1], "Lithium"],
  Be: [4, 5, [2, 2], "Beryllium"],
  B: [5, 6, [2, 3], "Boron"],
  C: [6, 6, [2, 4], "Carbon"],
  N: [7, 7, [2, 5], "Nitrogen"],
  O: [8, 8, [2, 6], "Oxygen"],
  F: [9, 10, [2, 7], "Fluorine"],
  Ne: [10, 10, [2, 8], "Neon"],
  Na: [11, 12, [2, 8, 1], "Sodium"],
  Mg: [12, 12, [2, 8, 2], "Magnesium"],
  Al: [13, 14, [2, 8, 3], "Aluminium"],
  Si: [14, 14, [2, 8, 4], "Silicon"],
  P: [15, 16, [2, 8, 5], "Phosphorus"],
  S: [16, 16, [2, 8, 6], "Sulfur"],
  Cl: [17, 18, [2, 8, 7], "Chlorine"],
  Ar: [18, 22, [2, 8, 8], "Argon"],
  K: [19, 20, [2, 8, 8, 1], "Potassium"],
  Ca: [20, 20, [2, 8, 8, 2], "Calcium"],
  Fe: [26, 30, [2, 8, 14, 2], "Iron"],
  Cu: [29, 35, [2, 8, 18, 1], "Copper"],
  Zn: [30, 35, [2, 8, 18, 2], "Zinc"],
  Br: [35, 45, [2, 8, 18, 7], "Bromine"],
  I: [53, 74, [2, 8, 18, 18, 7], "Iodine"],
};

const CAPS = [2, 8, 8, 18, 18, 32, 32];

function fillShells(z) {
  const out = [];
  let left = Math.max(0, Math.round(z));
  for (let i = 0; i < CAPS.length && left > 0; i++) {
    const k = Math.min(CAPS[i], left);
    out.push(k);
    left -= k;
  }
  return out.length ? out : [1];
}

/**
 * Resolve one atom spec to {symbol, name, Z, n, shells}.
 * An explicit `shells` always wins; everything else falls back to the table,
 * and an empty spec falls back to sodium (the canonical Bohr example).
 */
function resolveAtom(o) {
  const src = o && typeof o === "object" ? o : {};
  const raw = String(src.element || src.symbol || "").trim();
  const key = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "Na";
  const row = TABLE[key] || null;

  const given = Array.isArray(src.shells)
    ? src.shells.map((v) => Math.max(0, Math.round(Number(v) || 0))).filter((v) => v > 0)
    : [];
  const givenSum = given.reduce((a, b) => a + b, 0);

  const Z = Number.isFinite(Number(src.Z))
    ? Math.max(1, Math.round(Number(src.Z)))
    : row
      ? row[0]
      : givenSum || 1;
  const shells = given.length ? given : row ? row[2].slice() : fillShells(Z);
  const n = Number.isFinite(Number(src.neutrons))
    ? Math.max(0, Math.round(Number(src.neutrons)))
    : row
      ? row[1]
      : Math.max(0, Z);
  return {
    symbol: src.symbol ? String(src.symbol) : row ? key : raw || "X",
    name: src.name || (row ? row[3] : ""),
    Z,
    n,
    shells,
  };
}

/* ------------------------------------------------------------------ */
/* electron glyphs                                                     */
/* ------------------------------------------------------------------ */
function dot(svg, x, y) {
  svg.circle(x, y, 5, { fill: C.cool });
}
function cross(svg, x, y) {
  const d = 4.6;
  svg.line(x - d, y - d, x + d, y + d, { stroke: C.warn, sw: 2.4, cap: "round" });
  svg.line(x - d, y + d, x + d, y - d, { stroke: C.warn, sw: 2.4, cap: "round" });
}

function chip(svg, x, y, txt, o = {}) {
  const s = String(txt);
  const size = o.size ?? SIZE.tiny;
  const ur = o.lang === "ur" || hasUrdu(s);
  const w = measure(s, size, { weight: 700, lang: ur ? "ur" : "en" }) * (ur ? 1.3 : 1) + 8;
  const h = ur ? size * 2.6 : size * 1.6;
  svg.rect(x - w / 2, y - h / 2, w, h, { fill: C.paper, opacity: 0.95, rx: 3 });
  svg.text(x, y, s, {
    size,
    weight: 700,
    anchor: "middle",
    baseline: "middle",
    fill: o.fill ?? C.muted,
    lang: ur ? "ur" : "en",
    w: w - 4,
  });
  return w;
}

/* ------------------------------------------------------------------ */
/* BOHR                                                                */
/* ------------------------------------------------------------------ */
const NUC_R = 34;
const SHELL_0 = 62;
const SHELL_GAP = 38;

function renderBohr(sp) {
  const A = resolveAtom(sp);
  const n = A.shells.length;
  const R = SHELL_0 + (n - 1) * SHELL_GAP;
  const bodyW = Math.max(560, 2 * (R + 74));
  const bodyH = 2 * (R + 40);
  const cx = bodyW / 2;
  const cy = bodyH / 2;

  // Captions are drawn as ONE line by the builder, so they must stay short
  // enough for the body width or the ends are cut off.
  const caption =
    sp.caption !== undefined
      ? sp.caption
      : `${A.name || A.symbol} (${A.symbol}) — Z = ${A.Z}, ${A.n} neutrons, electrons ${A.shells.join(", ")}.`;

  const svg = new Svg(bodyW, bodyH, {
    title: sp.title,
    caption,
    source: sp.source,
    note: sp.note,
    lang: sp.lang,
    spec: sp,
  });

  // shells first, so the electrons and the nucleus sit on top
  A.shells.forEach((count, k) => {
    const r = SHELL_0 + k * SHELL_GAP;
    svg.circle(cx, cy, r, { fill: "none", stroke: C.rule, sw: 1.4 });
  });

  A.shells.forEach((count, k) => {
    const r = SHELL_0 + k * SHELL_GAP;
    const start = -90 + k * 13; // deterministic: shell k always starts here
    const isValence = k === A.shells.length - 1;
    for (let i = 0; i < count; i++) {
      const a = ((start + (i * 360) / count) * Math.PI) / 180;
      const ex = cx + r * Math.cos(a);
      const ey = cy + r * Math.sin(a);
      svg.circle(ex, ey, 5.2, { fill: isValence ? C.warn : C.cool });
    }
    // count label, always at the 9-o'clock side just OUTSIDE the ring, where no
    // electron can be (electrons sit ON the ring)
    svg.line(cx - r, cy, cx - r - 10, cy, { stroke: C.rule, sw: 1.2 });
    chip(svg, cx - r - 11 - 11, cy, String(count), { fill: C.ink });
  });

  if (sp.showNucleus !== false) {
    svg.circle(cx, cy, NUC_R, { fill: C.warn, opacity: 0.14 });
    svg.circle(cx, cy, NUC_R, { fill: "none", stroke: C.warn, sw: 1.8 });
    svg.text(cx, cy - 8, A.symbol, {
      size: SIZE.big,
      weight: 700,
      anchor: "middle",
      baseline: "middle",
      fill: C.ink,
      lang: "en",
    });
    svg.text(cx, cy + 14, `${A.Z}p⁺ ${A.n}n⁰`, {
      size: SIZE.tiny,
      anchor: "middle",
      baseline: "middle",
      fill: C.warn,
      weight: 700,
      lang: "en",
    });
  }

  // shell letters mirror the counts: names out to the right, counts out to the
  // left, both on the 3/9-o'clock line where an electron cannot sit on top of
  // them without also sitting on the ring's own label gutter
  A.shells.forEach((count, k) => {
    const r = SHELL_0 + k * SHELL_GAP;
    svg.line(cx + r, cy, cx + r + 10, cy, { stroke: C.rule, sw: 1.2 });
    chip(svg, cx + r + 11 + 11, cy, SHELL_LETTERS[k] || `${k + 1}`, { fill: C.muted });
    void count;
  });

  if (sp.chargeLabel) {
    svg.text(bodyW - 12, 22, String(sp.chargeLabel), {
      size: SIZE.title,
      weight: 700,
      anchor: "end",
      fill: C.ink,
      lang: "en",
    });
  }
  return svg.toString();
}

/* ------------------------------------------------------------------ */
/* DOT AND CROSS                                                       */
/* ------------------------------------------------------------------ */
const METALS = new Set(["Li", "Be", "Na", "Mg", "Al", "K", "Ca", "Fe", "Cu", "Zn"]);

function bracket(svg, x, yTop, yBot, side) {
  const w = 11;
  const s = side === "left" ? 1 : -1;
  svg.polyline(
    [
      [x + s * w, yTop],
      [x, yTop],
      [x, yBot],
      [x + s * w, yBot],
    ],
    { stroke: C.ink, sw: 2.2, fill: "none", join: "miter" }
  );
}

/**
 * Outer-shell angles, textbook style: four sites (top, right, bottom, left)
 * filled singly first, then paired — which is exactly how an exam answer draws
 * a full octet, and it makes lone pairs vs bonding electrons readable.
 * Above 8 electrons it falls back to an even spread.
 */
function octetAngles(count) {
  if (count > 8) return Array.from({ length: count }, (_, i) => -90 + (i * 360) / count);
  const sites = [-90, 0, 90, 180];
  const singles = Math.min(count, 4);
  const paired = Math.max(0, count - 4);
  const out = [];
  for (let i = 0; i < 4; i++) {
    const isPair = i < paired;
    if (i < singles) out.push(sites[i] + (isPair ? -11 : 0));
    if (isPair) out.push(sites[i] + 11);
  }
  return out;
}

function ringElectrons(svg, cx, cy, r, list, angles) {
  list.forEach((kind, i) => {
    const a = (angles[i] * Math.PI) / 180;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (kind === "cross") cross(svg, x, y);
    else dot(svg, x, y);
  });
}

/** Even spread across an arc — used for the non-bonding side of a covalent pair. */
function arcAngles(count, a0, a1) {
  const step = (a1 - a0) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => a0 + step * (i + 0.5));
}

function renderDotCross(sp) {
  const A = resolveAtom(sp);
  const B = resolveAtom(sp.partner && typeof sp.partner === "object" ? sp.partner : { element: "Cl" });
  const vA = A.shells[A.shells.length - 1];
  const vB = B.shells[B.shells.length - 1];
  const bond = sp.bond === "covalent" || sp.bond === "ionic" ? sp.bond : METALS.has(A.symbol) || METALS.has(B.symbol) ? "ionic" : "covalent";
  const lang = sp.lang;

  const bodyW = 640;
  const bodyH = 226;
  const cy = 118;
  const r = 68;
  const svg0 = (caption) =>
    new Svg(bodyW, bodyH, {
      title: sp.title,
      caption: sp.caption !== undefined ? sp.caption : caption,
      source: sp.source,
      note: sp.note,
      lang,
      spec: sp,
    });

  if (bond === "ionic") {
    const transfer = Math.max(1, Math.round(Number(sp.transfer) || Math.min(vA, 8 - vB)));
    const cx1 = 158;
    const cx2 = 458;
    const caption = `${A.symbol} gives ${transfer} outer electron${transfer === 1 ? "" : "s"} to ${
      B.symbol
    } — dots are ${A.symbol} electrons, crosses are ${B.symbol}.`;
    const svg = svg0(caption);

    // donor: what is left of its outer shell after the transfer
    const leftCount = Math.max(0, vA - transfer);
    svg.circle(cx1, cy, r, { fill: "none", stroke: C.rule, sw: 1.6 });
    ringElectrons(svg, cx1, cy, r, new Array(leftCount).fill("dot"), octetAngles(leftCount));
    svg.text(cx1, cy, A.symbol, {
      size: SIZE.big,
      weight: 700,
      anchor: "middle",
      baseline: "middle",
      fill: C.ink,
      lang: "en",
    });
    bracket(svg, cx1 - r - 24, cy - r - 18, cy + r + 18, "left");
    bracket(svg, cx1 + r + 24, cy - r - 18, cy + r + 18, "right");
    svg.text(cx1 + r + 32, cy - r - 10, `${transfer === 1 ? "" : transfer}+`, {
      size: SIZE.big,
      weight: 700,
      fill: C.warn,
      lang: "en",
    });

    // acceptor: its own electrons as crosses, the transferred ones as dots
    const list = new Array(vB).fill("cross").concat(new Array(transfer).fill("dot"));
    svg.circle(cx2, cy, r, { fill: "none", stroke: C.rule, sw: 1.6 });
    ringElectrons(svg, cx2, cy, r, list, octetAngles(list.length));
    svg.text(cx2, cy, B.symbol, {
      size: SIZE.big,
      weight: 700,
      anchor: "middle",
      baseline: "middle",
      fill: C.ink,
      lang: "en",
    });
    bracket(svg, cx2 - r - 24, cy - r - 18, cy + r + 18, "left");
    bracket(svg, cx2 + r + 24, cy - r - 18, cy + r + 18, "right");
    svg.text(cx2 + r + 32, cy - r - 10, `${transfer === 1 ? "" : transfer}−`, {
      size: SIZE.big,
      weight: 700,
      fill: C.cool,
      lang: "en",
    });

    // the transfer itself
    const ax = cx1 + r + 46;
    const bx = cx2 - r - 46;
    svg.curveArrow(ax, cy - 26, bx, cy - 26, { bend: 30, stroke: C.leaf, sw: 2.4, size: 11 });
    svg.text((ax + bx) / 2, cy - 52, `${transfer} e⁻`, {
      size: SIZE.small,
      weight: 700,
      anchor: "middle",
      fill: C.leaf,
      lang: "en",
    });
    return svg.toString();
  }

  // covalent: overlapping outer shells, the shared pair(s) in the lens
  const pairs = Math.max(1, Math.round(Number(sp.pairs) || 1));
  const cx1 = bodyW / 2 - 54;
  const cx2 = bodyW / 2 + 54;
  const caption = `${A.symbol} and ${B.symbol} share ${pairs} pair${pairs === 1 ? "" : "s"} — dots are ${
    A.symbol
  } electrons, crosses are ${B.symbol}.`;
  const svg = svg0(caption);
  svg.circle(cx1, cy, r, { fill: "none", stroke: C.rule, sw: 1.6 });
  svg.circle(cx2, cy, r, { fill: "none", stroke: C.rule, sw: 1.6 });
  const nA = Math.max(0, vA - pairs);
  const nB = Math.max(0, vB - pairs);
  ringElectrons(svg, cx1, cy, r, new Array(nA).fill("dot"), arcAngles(nA, 100, 260));
  ringElectrons(svg, cx2, cy, r, new Array(nB).fill("cross"), arcAngles(nB, -80, 80));
  svg.text(cx1 - 20, cy, A.symbol, {
    size: SIZE.big,
    weight: 700,
    anchor: "middle",
    baseline: "middle",
    fill: C.ink,
    lang: "en",
  });
  svg.text(cx2 + 20, cy, B.symbol, {
    size: SIZE.big,
    weight: 700,
    anchor: "middle",
    baseline: "middle",
    fill: C.ink,
    lang: "en",
  });
  const mid = (cx1 + cx2) / 2;
  for (let i = 0; i < pairs; i++) {
    const yy = cy + (i - (pairs - 1) / 2) * 30;
    dot(svg, mid - 9, yy);
    cross(svg, mid + 9, yy);
  }
  return svg.toString();
}

/* ------------------------------------------------------------------ */
function render(spec) {
  const sp = spec && typeof spec === "object" ? spec : {};
  const mode = sp.mode === "dot_cross" ? "dot_cross" : "bohr";
  return mode === "dot_cross" ? renderDotCross(sp) : renderBohr(sp);
}

module.exports = {
  type: "atom",
  aliases: ["bohr", "electron_shells", "dot_and_cross"],
  summary: "Bohr shell model (H–Ca + Fe/Cu/Zn/Br/I built in) or a dot-and-cross bonding picture.",
  render,
  examples: [
    {
      name: "atom_bohr_sodium",
      spec: {
        type: "atom",
        element: "Na",
        mode: "bohr",
        title: "Sodium atom — Bohr model",
      },
    },
    {
      name: "atom_bohr_oxygen",
      spec: {
        type: "atom",
        element: "O",
        mode: "bohr",
        title: "Oxygen atom — 2, 6",
        note: "Six electrons in the outer shell: oxygen needs two more to fill it.",
      },
    },
    {
      name: "atom_dot_cross_nacl",
      spec: {
        type: "atom",
        mode: "dot_cross",
        bond: "ionic",
        element: "Na",
        partner: { element: "Cl" },
        transfer: 1,
        title: "Sodium chloride — electron transfer",
      },
    },
  ],
};
