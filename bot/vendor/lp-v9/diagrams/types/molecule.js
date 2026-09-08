// molecule — a 2D structural formula rendered from SMILES by openchemlib,
// re-framed into this engine's contract; plus two fallbacks that matter for
// school chemistry: an explicit-hydrogen sketch for the one-heavy-atom hydrides
// (H2O, CH4, NH3) and a formula card for the ionic compounds (NaCl, MgO, CaCl2),
// which have no molecule to draw at all.
//
// WHY THE POST-PROCESSING BELOW EXISTS
// openchemlib's `mol.toSVG()` returns its OWN complete document: a fixed px
// width/height, an offset viewBox, an id-scoped <style> block, invisible
// `class="event"` hit-targets meant for a browser UI, and raw rgb() CPK colours.
// None of that survives inlining into a lesson-plan page unchanged, so we:
//   1. strip the outer <svg>…</svg> and its px width/height (our builder owns
//      the viewBox — a nested one would fight the A4 column);
//   2. drop the `.event` layer (dead weight in print, ~40% of the bytes);
//   3. rewrite OCL's <style> so every selector is prefixed with OUR unique id
//      (`hashId(spec) + "_m"`, the same id the builder derives) and hang that id
//      on the wrapping <g>. Two molecules on one page then cannot collide —
//      verified by rendering molecule_glucose and molecule_ethanol into one
//      document and checking each <style> is scoped to its own id;
//   4. remap the CPK rgb() literals onto the palette tokens, so a molecule
//      inherits the LP colours like every other diagram;
//   5. translate+scale the group into a target box, undoing OCL's viewBox offset.
//
// OCL's own type sizes are 18 (element) and 12 (subscript) user units before our
// scale factor, which is >= the 12-unit floor even at scale 1.
//
// WHY THE HYDRIDE FALLBACK EXISTS
// OCL condenses a molecule whose skeleton is a single heavy atom to the string
// "H2O" — correct as a depiction, useless as a *structure* for a grade-7 page
// that is trying to show two bonds. For that one case we draw the bonds
// ourselves at the textbook angles (bent for 2 H, trigonal for 3, cross for 4).

const OCL = require("openchemlib");
const { Svg, C, SIZE, FONT, hashId, hasUrdu } = require("../lib/svg");
const { drawFormula, formulaWidth, chromeWidth } = require("./chem_equation");

const PAD = 14;

// OCL emits CPK colours as rgb() literals. Map the ones a school-chemistry
// structure can actually produce onto our tokens; anything unmapped falls back
// to ink rather than leaking a raw colour into the page.
const CPK = {
  "rgb(0,0,0)": C.ink, // carbon / bonds
  "rgb(255,13,13)": C.warn, // oxygen
  "rgb(48,80,248)": C.cool, // nitrogen
  "rgb(255,181,0)": C.accent, // sulfur
  "rgb(255,128,0)": C.clay, // phosphorus
  "rgb(144,224,80)": C.leaf, // chlorine
  "rgb(31,240,31)": C.leaf, // chlorine (alt)
  "rgb(166,41,41)": C.clay, // bromine
  "rgb(148,0,148)": C.plum, // iodine
  "rgb(144,144,144)": C.muted,
  "rgb(160,0,0)": C.muted, // stereo annotations (suppressed, kept for safety)
};

const ELEMENT_COLOR = {
  O: C.warn,
  N: C.cool,
  S: C.accent,
  P: C.clay,
  Cl: C.leaf,
  F: C.leaf,
  Br: C.clay,
  I: C.plum,
};

const OCL_OPTS = {
  autoCrop: true,
  autoCropMargin: 5,
  factorTextSize: 1.25,
  strokeWidth: 1.5,
  suppressChiralText: true,
  suppressESR: true,
  suppressCIPParity: true,
};

function parseMol(smiles) {
  try {
    const mol = OCL.Molecule.fromSmiles(String(smiles));
    return mol && mol.getAllAtoms() > 0 ? mol : null;
  } catch (e) {
    return null;
  }
}

/**
 * SMILES -> {inner, vb:[x,y,w,h]} in OUR contract, or null if it cannot be drawn.
 * Never throws: a bad SMILES degrades to the formula card.
 */
function oclFragment(mol, uid) {
  let raw;
  try {
    raw = mol.toSVG(600, 460, uid, OCL_OPTS);
  } catch (e) {
    return null;
  }
  if (typeof raw !== "string" || raw.indexOf("<svg") !== 0) return null;
  const vbm = /viewBox="([-\d.\s]+)"/.exec(raw);
  if (!vbm) return null;
  const vb = vbm[1].trim().split(/\s+/).map(Number);
  if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return null;

  let inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, "") // (1) drop OCL's own <svg …> opener
    .replace(/<\/svg>\s*$/, "")
    .replace(/<style>[\s\S]*?<\/style>/g, "") // (3) our own style replaces it
    .replace(/<[a-zA-Z]+[^>]*class="event"[^>]*\/>/g, "") // (2) hit-target layer
    .replace(/\s*\n\s*/g, "");
  // (4) palette remap — every rgb() OCL can emit, mapped or inked
  inner = inner.replace(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g, (m) => CPK[m.replace(/\s+/g, "")] || C.ink);
  // strip the now-orphaned per-atom ids so two copies of one molecule stay unique
  inner = inner.replace(/\sid="[^"]*"/g, "");
  if (!inner.trim()) return null;
  return { inner, vb };
}

/** Place an OCL fragment inside a box, centred, scaled into [1,2]. */
function placeFragment(svg, frag, box, uid) {
  const [vx, vy, vw, vh] = frag.vb;
  const s = Math.max(1, Math.min(2, Math.min(box.w / vw, box.h / vh)));
  const dw = vw * s;
  const dh = vh * s;
  const r2 = (v) => Math.round(v * 100) / 100;
  const tx = box.x + (box.w - dw) / 2 - vx * s;
  const ty = box.y + (box.h - dh) / 2 - vy * s;
  // (3) id-scoped style: `#uid text` only ever matches inside THIS group.
  svg.add(
    `<style>#${uid} text{font-family:${FONT.latin};}` +
      `#${uid} line{stroke-linecap:round;}#${uid} polygon{stroke-linejoin:round;}</style>` +
      `<g id="${uid}" transform="translate(${r2(tx)},${r2(ty)}) scale(${Math.round(s * 1000) / 1000})">` +
      `${frag.inner}</g>`
  );
}

/** Natural size an OCL fragment will occupy inside a box of this width/height. */
function fragmentSize(frag, boxW, boxH) {
  const s = Math.max(1, Math.min(2, Math.min(boxW / frag.vb[2], boxH / frag.vb[3])));
  return { w: frag.vb[2] * s, h: frag.vb[3] * s };
}

/* ------------------------------------------------------------------ */
/* explicit-hydrogen sketch for a single-heavy-atom hydride            */
/* ------------------------------------------------------------------ */

// Bond directions in degrees, SVG convention (0 = right, positive = downwards).
const HYDRIDE_ANGLES = {
  1: [0],
  2: [37.75, 142.25], // bent — the 104.5° water angle
  3: [90, 210, 330], // trigonal
  4: [0, 90, 180, 270], // the textbook methane cross
};

function hydrideInfo(mol) {
  if (!mol || mol.getAllAtoms() !== 1) return null;
  const n = mol.getImplicitHydrogens(0);
  if (!(n >= 1 && n <= 6)) return null;
  return { label: mol.getAtomLabel(0), n };
}

const HYDRIDE_BOND = 54;
const HYDRIDE_R = 17; // half the visual box of one atom label

function hydrideAngles(info) {
  return HYDRIDE_ANGLES[info.n] || Array.from({ length: info.n }, (_, i) => -90 + (i * 360) / info.n);
}

/** Ink extent of the sketch, centred on the heavy atom at (0,0). */
function hydrideBox(info) {
  let x0 = -HYDRIDE_R;
  let x1 = HYDRIDE_R;
  let y0 = -HYDRIDE_R;
  let y1 = HYDRIDE_R;
  for (const deg of hydrideAngles(info)) {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * HYDRIDE_BOND;
    const y = Math.sin(a) * HYDRIDE_BOND;
    x0 = Math.min(x0, x - HYDRIDE_R);
    x1 = Math.max(x1, x + HYDRIDE_R);
    y0 = Math.min(y0, y - HYDRIDE_R);
    y1 = Math.max(y1, y + HYDRIDE_R);
  }
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
}

function drawHydride(svg, box, info) {
  const ext = hydrideBox(info);
  // centre the INK, not the heavy atom — a bent hydride hangs below its oxygen
  const cx = box.x + box.w / 2 - (ext.x0 + ext.x1) / 2;
  const cy = box.y + box.h / 2 - (ext.y0 + ext.y1) / 2;
  const angles = hydrideAngles(info);
  const color = ELEMENT_COLOR[info.label] || C.ink;
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    svg.line(cx + dx * 18, cy + dy * 18, cx + dx * (HYDRIDE_BOND - 15), cy + dy * (HYDRIDE_BOND - 15), {
      stroke: C.ink,
      sw: 2.2,
      cap: "round",
    });
  }
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    svg.text(cx + Math.cos(a) * HYDRIDE_BOND, cy + Math.sin(a) * HYDRIDE_BOND, "H", {
      size: 25,
      anchor: "middle",
      baseline: "middle",
      weight: 600,
      fill: C.ink,
      lang: "en",
    });
  }
  svg.text(cx, cy, info.label, {
    size: 30,
    anchor: "middle",
    baseline: "middle",
    weight: 700,
    fill: color,
    lang: "en",
  });
}

/* ------------------------------------------------------------------ */
/* ionic formula card                                                  */
/* ------------------------------------------------------------------ */

function ionSource(ion, brackets) {
  const f = String(ion.formula ?? "");
  const q = String(ion.charge ?? "");
  const neg = q.indexOf("-") >= 0 || q.indexOf("−") >= 0;
  const mag = (q.match(/\d+/) || [""])[0];
  const body = brackets && neg ? "[" + f + "]" : f;
  return body + (q ? "^" + mag + (neg ? "-" : "+") : "");
}

const LATTICE_STEP = 30;
const LATTICE_N = 3;
const LATTICE_BIG = 12.5;
const LATTICE_H = (LATTICE_N - 1) * LATTICE_STEP + LATTICE_BIG * 2 + 46;

/** A 3x3 alternating-ion lattice — the reason an ionic solid has no molecule. */
function drawLattice(svg, cx, top, ions) {
  const step = LATTICE_STEP;
  const n = LATTICE_N;
  const r = 9.5;
  const big = LATTICE_BIG;
  const x0 = cx - ((n - 1) * step) / 2;
  const y0 = top + big;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i < n - 1)
        svg.line(x0 + j * step, y0 + i * step, x0 + j * step, y0 + (i + 1) * step, { stroke: C.rule, sw: 1.2 });
      if (j < n - 1)
        svg.line(x0 + j * step, y0 + i * step, x0 + (j + 1) * step, y0 + i * step, { stroke: C.rule, sw: 1.2 });
    }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const cation = (i + j) % 2 === 0;
      svg.circle(x0 + j * step, y0 + i * step, cation ? r : big, {
        fill: cation ? C.accent : C.cool,
        opacity: 0.9,
        stroke: C.paper,
        sw: 1.4,
      });
    }
  // key
  const keyY = y0 + (n - 1) * step + big + 26;
  const entries = [];
  if (ions[0]) entries.push({ fill: C.accent, r, src: ionSource(ions[0], false) });
  if (ions[1]) entries.push({ fill: C.cool, r: big, src: ionSource(ions[1], false) });
  const wOf = (e) => e.r * 2 + 8 + formulaWidth(e.src, SIZE.label);
  const totalW = entries.reduce((a, e) => a + wOf(e), 0) + (entries.length - 1) * 26;
  let x = cx - totalW / 2;
  for (const e of entries) {
    svg.circle(x + e.r, keyY - SIZE.label * 0.34, e.r, { fill: e.fill, opacity: 0.9 });
    drawFormula(svg, x + e.r * 2 + 8, keyY, e.src, { size: SIZE.label, fill: C.text, weight: 600 });
    x += wOf(e) + 26;
  }
}

function defaultIons(formula) {
  const known = {
    NaCl: [{ formula: "Na", charge: "+" }, { formula: "Cl", charge: "-" }],
    MgO: [{ formula: "Mg", charge: "2+" }, { formula: "O", charge: "2-" }],
    CaCl2: [{ formula: "Ca", charge: "2+" }, { formula: "Cl", charge: "-" }],
    KBr: [{ formula: "K", charge: "+" }, { formula: "Br", charge: "-" }],
    LiF: [{ formula: "Li", charge: "+" }, { formula: "F", charge: "-" }],
  };
  return known[String(formula ?? "").replace(/\s+/g, "")] || null;
}

/* ------------------------------------------------------------------ */

const FORMULA_SIZE = 27;

function render(spec) {
  const s = spec || {};
  const name = s.name ? String(s.name) : "";
  const formula = s.formula ? String(s.formula) : "";
  const bodyW = Math.max(420, chromeWidth(s, 660), Math.min(660, s.w ?? 520));

  // The uid must be known BEFORE the builder exists (the fragment carries it in
  // its <style>), so derive it the same way the builder does — from the spec.
  const uid = hashId(s) + "_m";
  const ions = Array.isArray(s.ions) && s.ions.length ? s.ions : defaultIons(formula);
  const mol = s.ionic === true || !s.smiles ? null : parseMol(s.smiles);
  const hyd = mol ? hydrideInfo(mol) : null;
  // a SMILES that will not parse degrades to the formula card, it never throws
  const frag = mol && !hyd ? oclFragment(mol, uid) : null;
  const mode = hyd ? "hydride" : frag ? "ocl" : "ionic";

  const innerW = bodyW - (PAD + 12) * 2;
  const wantH = s.h ?? 210;
  let drawH = 0;
  if (mode === "hydride") drawH = s.h ?? Math.ceil(hydrideBox(hyd).h) + 14;
  else if (mode === "ocl") drawH = Math.min(wantH, Math.max(120, fragmentSize(frag, innerW, wantH).h + 26));

  const nameSize = SIZE.label;
  const nameH = name ? nameSize * (hasUrdu(name) ? 2.9 : 1.9) : 0;
  const formulaH = formula ? FORMULA_SIZE * 1.4 : 0;

  const topPad = 22;
  const botPad = 20;
  const bodyH =
    mode === "ionic"
      ? PAD + topPad + formulaH + (ions ? 40 + LATTICE_H + 16 : 0) + nameH + botPad
      : PAD + topPad + drawH + 14 + formulaH + nameH + botPad;

  const svg = new Svg(bodyW, bodyH, {
    title: s.title,
    caption: s.caption,
    source: s.source,
    note: s.note,
    lang: s.lang,
    spec: s,
  });

  svg.rect(PAD * 0.4, PAD * 0.4, bodyW - PAD * 0.8, bodyH - PAD * 0.8, {
    rx: 12,
    fill: C.panel,
    stroke: C.rule,
    sw: 1.3,
  });

  let y = PAD + topPad;

  if (mode === "hydride") {
    drawHydride(svg, { x: PAD + 12, y, w: innerW, h: drawH }, hyd);
    y += drawH + 14;
  } else if (mode === "ocl") {
    placeFragment(svg, frag, { x: PAD + 12, y, w: innerW, h: drawH }, uid);
    y += drawH + 14;
  }

  if (formula) {
    drawFormula(svg, bodyW / 2, y + FORMULA_SIZE * 0.78, formula, {
      size: FORMULA_SIZE,
      anchor: "middle",
      fill: C.ink,
    });
    y += formulaH;
  }

  if (mode === "ionic" && ions && ions.length) {
    // Na⁺ [Cl]⁻ — the ion pair, charges raised, the anion bracketed
    const srcs = ions.map((i) => ionSource(i, true));
    const ws = srcs.map((t) => formulaWidth(t, 23));
    const gap = 30;
    const totalW = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
    let ix = bodyW / 2 - totalW / 2;
    srcs.forEach((src, i) => {
      drawFormula(svg, ix, y + 24, src, { size: 23, fill: i === 0 ? C.clay : C.cool });
      ix += ws[i] + gap;
    });
    y += 40;
    drawLattice(svg, bodyW / 2, y, ions);
    y += LATTICE_H + 16;
  }

  if (name) {
    // The BASELINE offset has to follow the same script rule the HEIGHT reservation
    // above already does (nameH: 2.9x for Urdu vs 1.9x). A Nastaliq label rides in a
    // foreignObject whose box grows UPWARD from this baseline, so a flat 1.05x pushed
    // that box back into the formula's subscript — visually a near-miss, but
    // checkOverlaps() saw the boxes touch and lint_lp.js's DIAGRAM_OVERLAP is a hard
    // fail, so an Urdu molecule name made the whole lesson plan unshippable. The extra
    // drop stays inside the room nameH already reserved, so nothing else moves, and a
    // Latin name keeps its 1.05x exactly.
    svg.text(bodyW / 2, y + nameSize * (hasUrdu(name) ? 1.95 : 1.05), name, {
      size: nameSize,
      anchor: "middle",
      weight: 600,
      fill: C.text,
      lang: hasUrdu(name) ? s.lang || "ur" : "en",
      w: bodyW - 24,
    });
  }

  return svg.toString();
}

module.exports = {
  type: "molecule",
  aliases: ["smiles", "structure"],
  summary:
    "2D structural formula from SMILES (openchemlib), with explicit-hydrogen sketches for hydrides and a formula card + lattice for ionic compounds.",
  render,
  examples: [
    {
      name: "molecule_water",
      spec: {
        type: "molecule",
        smiles: "O",
        formula: "H2O",
        name: "water",
        title: "Water",
        caption: "One oxygen atom joined to two hydrogen atoms by covalent bonds.",
      },
    },
    {
      name: "molecule_methane",
      spec: {
        type: "molecule",
        smiles: "C",
        formula: "CH4",
        name: "methane — the simplest hydrocarbon",
        title: "Methane",
        caption: "Carbon makes four bonds; here all four are to hydrogen.",
      },
    },
    {
      name: "molecule_glucose",
      spec: {
        type: "molecule",
        smiles: "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O",
        formula: "C6H12O6",
        name: "glucose — six carbon atoms",
        w: 560,
        h: 250,
        title: "Glucose",
        caption: "The sugar photosynthesis builds. Five carbons and one oxygen make the ring.",
      },
    },
    {
      name: "molecule_nacl_ionic",
      spec: {
        type: "molecule",
        ionic: true,
        formula: "NaCl",
        name: "sodium chloride — a giant lattice, not a molecule",
        ions: [
          { formula: "Na", charge: "+" },
          { formula: "Cl", charge: "-" },
        ],
        title: "Sodium chloride",
        caption: "Sodium gives one electron to chlorine; the ions stack in a repeating lattice.",
      },
    },
    {
      name: "molecule_ethanol",
      spec: {
        type: "molecule",
        smiles: "CCO",
        formula: "C2H5OH",
        name: "ethanol",
        h: 170,
        title: "Ethanol",
        caption: "The zig-zag line is the carbon skeleton — every bend is a carbon atom.",
      },
    },
  ],
};
