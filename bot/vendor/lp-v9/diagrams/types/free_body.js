// free_body — free-body / force diagrams for grade 8-12 mechanics.
//
// Two shapes of the same idea:
//   1. a body (box or circle) with labelled force arrows radiating from its
//      centre — arrow LENGTH is proportional to magnitude, normalised so the
//      largest force is a fixed length, so a student can compare by eye;
//   2. a block on an inclined plane, where the geometry does the work: the
//      normal really is perpendicular to the surface, friction really is along
//      it, and `showComponents` resolves the weight into mg sinθ / mg cosθ with
//      the projection parallelogram drawn in.
//
// Angles are in DEGREES, measured the way a physics class measures them:
// 0 = right, 90 = up. Screen y is flipped for you.
//
// On the incline the directions fall out of θ once, and everything reuses them:
//   up-slope   θ            down-slope  180 + θ
//   normal     90 + θ       into-surface θ − 90
// The incline rises to the RIGHT, so a block left on its own slides down-left.

const { Svg, C, SIZE, hasUrdu, measure, urduBoxH, textBox, wrap, LEADING } = require("../lib/svg");

// The body chip is ONE string — "<label>  <mass>" — handed to a foreignObject whose
// direction is the page's. When the label is Urdu and the mass is not, Unicode's bidi
// algorithm reorders that trailing Latin run against the Urdu and "ڈبہ  5 kg" PRINTS AS
// "kg 5 ڈبہ": the unit before the number. Nothing in this engine can see it — the SVG
// string is right, the collision gate is clean, and the reversal happens in the browser's
// text layout. So the Latin atom is wrapped in LRI…PDI (U+2066…U+2069), the same isolate
// this pipeline already puts around a phone number and a URL. Applied ONLY when the two
// scripts actually mix, so no all-Latin figure in the shipped corpus changes by a byte.
const LRI = "\u2066";
const PDI = "\u2069";
function bodyChipText(body) {
  const label = body.label === undefined || body.label === null ? "" : String(body.label);
  const mass = body.mass === undefined || body.mass === null ? "" : String(body.mass);
  const mixed = mass && hasUrdu(label) && !hasUrdu(mass);
  return [label, mass ? (mixed ? LRI + mass + PDI : mass) : ""].filter(Boolean).join("  ");
}

const BODY_W = 620;
// Arrows leave the CENTRE of the body, but only the part OUTSIDE the body
// carries meaning — that part is what SCALE stretches, so the visible lengths
// stay exactly proportional to the magnitudes while no arrowhead is ever
// swallowed by the body it belongs to.
const SCALE = 80;
const BOX_HW = 50;
const BOX_HH = 34;
const DISC_R = 44;

const RAD = Math.PI / 180;
const num = (v, d) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

const TOKEN = {
  ink: C.ink,
  warn: C.warn,
  cool: C.cool,
  leaf: C.leaf,
  accent: C.accent,
  plum: C.plum,
  clay: C.clay,
  teal: C.teal,
  muted: C.muted,
};
const CYCLE = [C.warn, C.cool, C.leaf, C.plum, C.clay, C.teal];
const colorOf = (f, i) => TOKEN[f && f.color] || CYCLE[i % CYCLE.length];

/* ------------------------------------------------------------------ */
function normForces(list) {
  const raw = Array.isArray(list) ? list.filter((f) => f && typeof f === "object") : [];
  return raw.map((f) => ({
    name: f.name !== undefined && f.name !== null ? String(f.name) : "",
    label: f.label !== undefined && f.label !== null ? String(f.label) : "",
    magnitude: Number.isFinite(Number(f.magnitude)) ? Math.abs(Number(f.magnitude)) : null,
    angle: num(f.angle, 0),
    color: f.color,
    dashed: !!f.dashed,
    decompose: !!f.decompose,
  }));
}

function maxMag(forces) {
  return Math.max(...forces.map((f) => (f.magnitude === null ? 1 : f.magnitude)), 1e-9);
}
function lengths(forces, reach) {
  const max = maxMag(forces);
  return forces.map((f) => reach(f.angle) + (SCALE * (f.magnitude === null ? 1 : f.magnitude)) / max);
}
/** Distance from the centre to the body outline along a physics angle. */
function reachFor(shape) {
  if (shape === "circle") return () => DISC_R + 4;
  return (ang) => {
    const ux = Math.abs(Math.cos(ang * RAD));
    const uy = Math.abs(Math.sin(ang * RAD));
    const tx = ux > 1e-6 ? BOX_HW / ux : Infinity;
    const ty = uy > 1e-6 ? BOX_HH / uy : Infinity;
    return Math.min(tx, ty) + 4;
  };
}

/* ------------------------------------------------------------------ */
/* one labelled arrow from (ox,oy) at a physics angle                   */
/* ------------------------------------------------------------------ */
function forceArrow(svg, ox, oy, ang, len, col, o) {
  const ux = Math.cos(ang * RAD);
  const uy = Math.sin(ang * RAD);
  const tx = ox + ux * len;
  const ty = oy - uy * len;
  svg.arrow(ox, oy, tx, ty, {
    stroke: col,
    sw: o.sw ?? 2.6,
    size: 11,
    width: 9,
    dash: o.dash,
  });
  return { tx, ty, ux, uy };
}

function tipLabel(svg, tip, lines, col, lang) {
  const use = lines.filter((l) => l && l.t !== "");
  if (!use.length) return;
  const { tx, ty, ux, uy } = tip;
  const anchor = ux > 0.32 ? "start" : ux < -0.32 ? "end" : "middle";
  const dx = ux > 0.32 ? 8 : ux < -0.32 ? -8 : 0;
  // Each row's height comes from the SHARED estimators — urduBoxH for Nastaliq,
  // textBox for Latin. The old fixed 16/26 px step under-reserved an Urdu row
  // (its predicted box is ~2.2 em) and the symbol above it landed inside the
  // name below it (fbd_lift_ur: "T" on "رسی کا تناؤ").
  const GAP = 3;
  const rows = use.map((l) => {
    const size = l.small ? SIZE.tiny : SIZE.small;
    if (l.ur) {
      const w = Math.max(measure(l.t, size, { lang: "ur" }) * 1.25 + size, size * 3);
      return { l, size, h: urduBoxH(l.t, size, w) };
    }
    return { l, size, h: textBox(l.t, size, 0, 0, {}).h * 1.25 };
  });
  const total = rows.reduce((a, r) => a + r.h, 0) + GAP * (rows.length - 1);
  let top;
  if (uy > 0.32) top = ty - 12 - total;
  else if (uy < -0.32) top = ty + 10;
  else top = ty - total / 2;
  // Never let a stack walk off the body canvas — an Urdu row is ~2.2 em tall and
  // a two-row stack on an up-arrow used to poke into the title strip.
  top = Math.max(2, Math.min(top, (svg.bodyH || Infinity) - total - 2));
  for (const r of rows) {
    // plateText: a force label sits on its own arrow by construction.
    svg.plateText(tx + dx, top + r.h / 2, r.l.t, {
      size: r.size,
      weight: r.l.bold ? 700 : undefined,
      anchor,
      baseline: "middle",
      fill: col,
      lang: r.l.ur ? "ur" : "en",
      plateOpacity: 0.92,
    });
    top += r.h + GAP;
  }
  void lang;
}

function labelLines(f, lang, unit, showMag) {
  const out = [];
  if (f.name) out.push({ t: f.name, bold: true, ur: hasUrdu(f.name) });
  if (f.label) out.push({ t: f.label, ur: lang === "ur" || hasUrdu(f.label) });
  if (showMag && f.magnitude !== null)
    out.push({ t: `${f.magnitude} ${unit}`, small: true, ur: false });
  return out;
}

/** Opaque chip so a body/angle label never has a vector running through it. */
function chip(svg, x, y, txt, o = {}) {
  const s = String(txt);
  const ur = hasUrdu(s); // script decides the path (see lib/svg.js text())
  const size = o.size ?? SIZE.small;
  // `maxW` is the body the chip is written ON. A chip wider than its body pokes
  // out of the outline and reads as a second box (PK_G9_PHYS free_body: a 110u
  // chip on a 100u block). Wrap into the body instead of overflowing it.
  const cap = o.maxW ? Math.max(40, o.maxW - 6) : Infinity;
  if (ur) {
    const w = Math.min(cap, measure(s, size, { lang: "ur" }) * 1.35 + 14);
    const h = urduBoxH(s, size, w - 6) + 4;
    svg.rect(x - w / 2, y - h / 2, w, h, { fill: C.paper, opacity: 0.92, rx: 4 });
    svg.text(x, y, s, {
      size,
      weight: 700,
      anchor: "middle",
      baseline: "middle",
      fill: o.fill ?? C.ink,
      lang: "ur",
      w: w - 6,
      h: h - 4,
    });
    return;
  }
  const inner = Math.min(cap - 14, 400);
  const lines = wrap(s, size, inner > 20 ? inner : 20, { weight: 700 });
  const w = Math.min(cap, Math.max(...lines.map((l) => measure(l, size, { weight: 700 }))) * 1.02 + 14);
  const lh = size * LEADING.latin;
  const h = lines.length * lh + size * 0.4;
  svg.rect(x - w / 2, y - h / 2, w, h, { fill: C.paper, opacity: 0.92, rx: 4 });
  const y0 = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) =>
    svg.text(x, y0 + i * lh, ln, {
      size,
      weight: 700,
      anchor: "middle",
      baseline: "middle",
      fill: o.fill ?? C.ink,
      lang: "en",
    })
  );
}

function axisKey(svg, x, y, lang) {
  svg.arrow(x, y, x + 34, y, { stroke: C.muted, sw: 1.6, size: 8, width: 6 });
  svg.arrow(x, y, x, y - 34, { stroke: C.muted, sw: 1.6, size: 8, width: 6 });
  svg.text(x + 38, y + 4, "x", { size: SIZE.tiny, fill: C.muted, weight: 700, lang: "en" });
  svg.text(x - 3, y - 38, "y", { size: SIZE.tiny, fill: C.muted, weight: 700, anchor: "middle", lang: "en" });
  void lang;
}

/* ------------------------------------------------------------------ */
/* PLAIN BODY                                                          */
/* ------------------------------------------------------------------ */
function renderPlain(sp, body, forces) {
  const lang = sp.lang;
  const unit = sp.unit || "N";
  const bodyH = 350;
  const cx = BODY_W / 2;
  const cy = 173;
  const reach = reachFor(body.shape);

  const svg = new Svg(BODY_W, bodyH, {
    title: sp.title,
    caption: sp.caption,
    source: sp.source,
    note: sp.note,
    lang,
    spec: sp,
  });

  // ground line, when the body is described as resting on something
  if (sp.ground !== false && body.shape !== "circle") {
    const gy = cy + BOX_HH;
    svg.line(cx - 190, gy, cx + 190, gy, { stroke: C.ink, sw: 2 });
    for (let i = 0; i < 15; i++) {
      const gx = cx - 186 + i * 26;
      svg.line(gx, gy, gx - 10, gy + 10, { stroke: C.faint, sw: 1.2 });
    }
  }

  // body
  if (body.shape === "circle") {
    svg.circle(cx, cy, DISC_R, { fill: C.ink, opacity: 0.1 });
    svg.circle(cx, cy, DISC_R, { fill: "none", stroke: C.ink, sw: 2 });
  } else {
    svg.rect(cx - BOX_HW, cy - BOX_HH, BOX_HW * 2, BOX_HH * 2, { fill: C.ink, opacity: 0.1, rx: 4 });
    svg.rect(cx - BOX_HW, cy - BOX_HH, BOX_HW * 2, BOX_HH * 2, { fill: "none", stroke: C.ink, sw: 2, rx: 4 });
  }

  const lens = lengths(forces, reach);
  forces.forEach((f, i) => {
    const col = colorOf(f, i);
    const tip = forceArrow(svg, cx, cy, f.angle, lens[i], col, { dash: f.dashed ? "6 5" : undefined });
    tipLabel(svg, tip, labelLines(f, lang, unit, sp.showMagnitudes === true), col, lang);
  });

  // The resultant is summed from the MAGNITUDES, not from the drawn lengths —
  // the drawn length carries a per-arrow body offset that must not be added up.
  if (sp.showResultant) {
    let rx = 0;
    let ry = 0;
    forces.forEach((f) => {
      const m = f.magnitude === null ? 1 : f.magnitude;
      rx += Math.cos(f.angle * RAD) * m;
      ry += Math.sin(f.angle * RAD) * m;
    });
    const mag = Math.hypot(rx, ry);
    if (mag > maxMag(forces) * 0.03) {
      const ang = (Math.atan2(ry, rx) * 180) / Math.PI;
      const len = reach(ang) + (SCALE * mag) / maxMag(forces);
      // nudged off the centre line: a resultant is very often collinear with one
      // of the forces it sums, and two arrows on one line read as one arrow
      const ox = cx + Math.sin(ang * RAD) * 20;
      const oy = cy + Math.cos(ang * RAD) * 20;
      const tip = forceArrow(svg, ox, oy, ang, len, C.accent, { dash: "7 5", sw: 3 });
      tipLabel(svg, tip, [{ t: sp.resultantLabel || "R", bold: true, ur: false }], C.accent, lang);
    }
  }

  // body identity last, on an opaque chip, so the arrow tails never eat it
  const bodyTxt = bodyChipText(body);
  if (bodyTxt)
    chip(svg, cx, cy, bodyTxt, { lang, maxW: body.shape === "circle" ? DISC_R * 2 : BOX_HW * 2 });
  else svg.circle(cx, cy, 3.4, { fill: C.ink });

  if (sp.axes !== false) axisKey(svg, 40, 62, lang);
  return svg.toString();
}

/* ------------------------------------------------------------------ */
/* BLOCK ON AN INCLINE                                                 */
/* ------------------------------------------------------------------ */
function renderIncline(sp, body, forcesIn) {
  const lang = sp.lang;
  const unit = sp.unit || "N";
  const inc = sp.incline && typeof sp.incline === "object" ? sp.incline : {};
  let th = num(inc.angle, 30);
  th = Math.max(8, Math.min(70, th));
  const t = Math.tan(th * RAD);

  const Wb = Math.min(330, 190 / t);
  const H = Wb * t;
  const xL = (BODY_W - Wb) / 2 - 8;
  const xR = xL + Wb;

  // default force set, when the spec does not name one
  let forces = forcesIn;
  if (!forces.length) {
    forces = normForces([
      { name: "W", label: "weight", angle: 270, magnitude: 100, color: "warn", decompose: true },
      { name: "N", label: "normal", angle: 90 + th, magnitude: 100 * Math.cos(th * RAD), color: "cool" },
      { name: "f", label: "friction", angle: th, magnitude: 100 * Math.sin(th * RAD), color: "leaf" },
    ]);
  }
  const reach = () => 30; // the block is small and rotated — one flat stand-off
  const lens = lengths(forces, reach);

  let wi = forces.findIndex((f) => f.decompose);
  if (wi < 0)
    wi = forces.reduce(
      (best, f, i) => {
        const d = Math.abs((((f.angle % 360) + 360) % 360) - 270);
        return d < best.d ? { d, i } : best;
      },
      { d: 1e9, i: -1 }
    ).i;

  // Measure the drawing against the base line (y = 0 here) and only then decide
  // the body height, so a shallow incline does not ship 100 units of white.
  const pos = Math.max(0.25, Math.min(0.8, num(inc.pos, 0.56)));
  const nx = -Math.sin(th * RAD);
  const ny = -Math.cos(th * RAD); // outward normal, screen
  const bw = 78;
  const bh = 46;
  const dyc = -H * pos + ny * (bh / 2); // block centre, relative to the base line
  const showMag = sp.showMagnitudes === true;

  let top = Math.min(-H - 4, -6);
  let bot = 14;
  const measureTip = (rel, uy, lines) => {
    top = Math.min(top, rel - 12);
    bot = Math.max(bot, rel + 12);
    if (!lines.length) return;
    const st = lines[0].ur ? 26 : 16;
    const extra = (lines.length - 1) * st;
    if (uy > 0.32) top = Math.min(top, rel - 10 - extra - 13);
    else if (uy < -0.32) bot = Math.max(bot, rel + 17 + extra + 7);
    else {
      top = Math.min(top, rel + 5 - extra / 2 - 13);
      bot = Math.max(bot, rel + 5 + extra / 2 + 7);
    }
  };
  forces.forEach((f, i) => {
    const uy = Math.sin(f.angle * RAD);
    measureTip(dyc - uy * lens[i], uy, labelLines(f, lang, unit, showMag));
  });
  if (sp.showComponents && wi >= 0) {
    const Lw = lens[wi];
    measureTip(dyc + Math.sin(th * RAD) * Lw * Math.sin(th * RAD), -Math.sin(th * RAD), [
      { t: "mg sin θ" },
    ]);
    measureTip(dyc + Math.cos(th * RAD) * Lw * Math.cos(th * RAD), -Math.cos(th * RAD), [
      { t: "mg cos θ" },
    ]);
  }

  const yB = -top + 8;
  const bodyH = Math.max(yB + bot + 8, sp.axes === false ? 0 : 92);
  const P1 = [xL, yB];
  const P2 = [xR, yB];
  const P3 = [xR, yB - H];

  const svg = new Svg(BODY_W, bodyH, {
    title: sp.title,
    caption: sp.caption,
    source: sp.source,
    note: sp.note,
    lang,
    spec: sp,
  });

  // the wedge
  svg.polygon([P1, P2, P3], { fill: C.ink, opacity: 0.08 });
  svg.polygon([P1, P2, P3], { fill: "none", stroke: C.ink, sw: 2, join: "round" });
  // hatch only OUTSIDE the wedge footprint — the space under the block has to
  // stay clean for the weight vector and its label
  for (let i = 0; i < 24; i++) {
    const gx = xL - 76 + i * 26;
    if (gx > xL - 4 && gx < xR + 26) continue;
    svg.line(gx, yB, gx - 11, yB + 11, { stroke: C.faint, sw: 1.2 });
  }
  svg.line(xL - 80, yB, xR + 76, yB, { stroke: C.ink, sw: 2 });

  // angle arc at the foot of the slope
  const ar = 52;
  svg.path(
    `M${xL + ar},${yB} A${ar},${ar} 0 0 0 ${xL + ar * Math.cos(th * RAD)},${yB - ar * Math.sin(th * RAD)}`,
    { fill: "none", stroke: C.accent, sw: 1.8 }
  );
  svg.text(xL + ar + 12, yB - ar * 0.34, `${Math.round(th)}°`, {
    size: SIZE.small,
    weight: 700,
    fill: C.accent,
    baseline: "middle",
    lang: "en",
  });

  // block, sitting on the hypotenuse
  const sx = P1[0] + (P3[0] - P1[0]) * pos;
  const cx = sx + nx * (bh / 2);
  const cy = yB + dyc;
  svg.group({ transform: `rotate(${Math.round(-th * 100) / 100} ${Math.round(cx * 100) / 100} ${Math.round(cy * 100) / 100})` }, (s) => {
    s.rect(cx - bw / 2, cy - bh / 2, bw, bh, { fill: C.paper, stroke: "none" });
    s.rect(cx - bw / 2, cy - bh / 2, bw, bh, { fill: C.ink, opacity: 0.14, rx: 3 });
    s.rect(cx - bw / 2, cy - bh / 2, bw, bh, { fill: "none", stroke: C.ink, sw: 2, rx: 3 });
  });

  // weight components + the projection parallelogram
  if (sp.showComponents && wi >= 0) {
    const Lw = lens[wi];
    const along = Lw * Math.sin(th * RAD); // mg sinθ, down the slope
    const into = Lw * Math.cos(th * RAD); // mg cosθ, into the surface
    const aTip = forceArrow(svg, cx, cy, 180 + th, along, C.plum, { dash: "6 4", sw: 2.2 });
    const iTip = forceArrow(svg, cx, cy, th - 90, into, C.plum, { dash: "6 4", sw: 2.2 });
    const wTipX = cx;
    const wTipY = cy + Lw;
    svg.line(aTip.tx, aTip.ty, wTipX, wTipY, { stroke: C.faint, sw: 1.1, dash: "3 4" });
    svg.line(iTip.tx, iTip.ty, wTipX, wTipY, { stroke: C.faint, sw: 1.1, dash: "3 4" });
    tipLabel(svg, aTip, [{ t: "mg sin θ", bold: true, ur: false }], C.plum, lang);
    tipLabel(svg, iTip, [{ t: "mg cos θ", bold: true, ur: false }], C.plum, lang);
  }

  forces.forEach((f, i) => {
    const col = colorOf(f, i);
    const tip = forceArrow(svg, cx, cy, f.angle, lens[i], col, { dash: f.dashed ? "6 5" : undefined });
    tipLabel(svg, tip, labelLines(f, lang, unit, sp.showMagnitudes === true), col, lang);
  });

  const bodyTxt = bodyChipText(body);
  if (bodyTxt) chip(svg, cx, cy, bodyTxt, { lang, size: SIZE.tiny, maxW: bw });
  else svg.circle(cx, cy, 3.4, { fill: C.ink });

  if (sp.axes !== false) axisKey(svg, 40, 62, lang);
  return svg.toString();
}

/* ------------------------------------------------------------------ */
function render(spec) {
  const sp = spec && typeof spec === "object" ? spec : {};
  const body = sp.body && typeof sp.body === "object" ? sp.body : {};
  const forces = normForces(sp.forces);
  const onIncline =
    body.shape === "block_on_incline" || (sp.incline && typeof sp.incline === "object");
  if (onIncline) return renderIncline(sp, body, forces);
  if (!forces.length) {
    return renderPlain(
      sp,
      body,
      normForces([
        { name: "W", label: "weight", angle: 270, magnitude: 20, color: "warn" },
        { name: "N", label: "normal", angle: 90, magnitude: 20, color: "cool" },
      ])
    );
  }
  return renderPlain(sp, body, forces);
}

module.exports = {
  type: "free_body",
  aliases: ["fbd", "force_diagram", "vector"],
  summary: "Free-body diagram — scaled force arrows on a body, or a block on an inclined plane.",
  render,
  examples: [
    {
      name: "fbd_box_on_table",
      spec: {
        type: "free_body",
        title: "Box on a table",
        body: { shape: "box", label: "Box", mass: "5 kg" },
        forces: [
          { name: "W", label: "weight", angle: 270, magnitude: 50, color: "warn" },
          { name: "N", label: "normal force", angle: 90, magnitude: 50, color: "cool" },
          { name: "F", label: "applied force", angle: 0, magnitude: 30, color: "leaf" },
          { name: "f", label: "friction", angle: 180, magnitude: 18, color: "clay" },
        ],
        showMagnitudes: true,
        showResultant: true,
        caption: "F is larger than f, so the box accelerates to the right.",
      },
    },
    {
      name: "fbd_block_on_incline",
      spec: {
        type: "free_body",
        title: "Block on a 30° incline",
        body: { shape: "block_on_incline", label: "m" },
        incline: { angle: 30 },
        forces: [
          { name: "W", label: "weight", angle: 270, magnitude: 100, color: "warn", decompose: true },
          { name: "N", label: "normal", angle: 120, magnitude: 86.6, color: "cool" },
          { name: "f", label: "friction", angle: 30, magnitude: 50, color: "leaf" },
        ],
        showComponents: true,
        caption: "The normal force balances mg cos θ; friction balances mg sin θ, so the block stays put.",
      },
    },
    {
      name: "fbd_lift_ur",
      spec: {
        type: "free_body",
        lang: "ur",
        title: "لفٹ اوپر کی طرف تیز ہو رہی ہے",
        body: { shape: "box", label: "لفٹ" },
        ground: false,
        forces: [
          { name: "T", label: "رسی کا تناؤ", angle: 90, magnitude: 12000, color: "cool" },
          { name: "W", label: "وزن", angle: 270, magnitude: 10000, color: "warn" },
        ],
        showResultant: true,
        resultantLabel: "ma",
        caption: "تناؤ وزن سے زیادہ ہے، اس لیے حاصل قوت اوپر کی طرف ہے۔",
      },
    },
  ],
};
