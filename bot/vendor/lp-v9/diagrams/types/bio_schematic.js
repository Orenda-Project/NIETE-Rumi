// bio_schematic — three parametric biology figures behind one type:
//
//   figure: 'cell'                a plant or animal cell, drawn from shapes
//   figure: 'leaf_cross_section'  the layered strip, stoma and vascular bundle
//   figure: 'heart_loop'          the circulatory loop as a labelled cycle
//
// The alias the spec arrives under selects the figure (`type:'leaf_cross_section'`
// works, so does `type:'cell', figure:'leaf_cross_section'`).
//
// Every label is real <text> (or a foreignObject for Urdu) placed in a margin
// column and joined to its structure by a leader line. Leader lines cannot cross
// because the labels on a side are sorted by their anchor's y and then dropped
// into slots in that same order — two monotonic sequences never interleave.

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");

const LSIZE = SIZE.small;

/* ------------------------------------------------------------------ */
/* leader-line label engine                                            */
/* ------------------------------------------------------------------ */

/**
 * @param items [{x,y,text,side:'left'|'right',color}]
 * @param o     {leftEdge,rightEdge,top,bottom,lang,size}
 */
/**
 * Slot positions: start each label level with its own structure, then push
 * apart to `spacing` and clamp into the band. The order is never permuted, so
 * anchors and slots stay two monotonic sequences — which is exactly the
 * condition for the leader lines not to cross.
 */
function slotYs(group, top, bottom, spacing) {
  const ys = group.map((g) => g.y);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + spacing);
  const over = ys[ys.length - 1] - bottom;
  if (over > 0) for (let i = 0; i < ys.length; i++) ys[i] -= over;
  for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - spacing);
  const under = top - ys[0];
  if (under > 0) for (let i = 0; i < ys.length; i++) ys[i] += under;
  return ys;
}

function drawLeaders(svg, items, o) {
  const size = o.size ?? LSIZE;
  const spacing = o.spacing ?? (o.lang === "ur" ? 36 : 26);
  for (const side of ["left", "right"]) {
    const group = items.filter((it) => it.side === side).sort((a, b) => a.y - b.y);
    if (!group.length) continue;
    const ys = slotYs(group, o.top, o.bottom, spacing);
    group.forEach((it, i) => {
      const ly = ys[i];
      const color = it.color || C.ink;
      if (side === "left") {
        const knee = Math.max(o.leftEdge + 16, it.x - 22);
        svg.polyline(
          [
            [o.leftEdge + 7, ly],
            [knee, ly],
            [it.x, it.y],
          ],
          { stroke: C.faint, sw: 1.1 }
        );
        svg.circle(it.x, it.y, 2.6, { fill: color });
        svg.plateText(o.leftEdge, ly, it.text, {
          size,
          anchor: "end",
          baseline: "middle",
          fill: C.text,
          lang: hasUrdu(it.text) ? o.lang || "ur" : "en",
          w: hasUrdu(it.text) ? o.leftEdge - 2 : undefined,
          // slotYs() already budgets exactly `spacing` between stacked labels
          // (tighter still for a predicted Urdu box height) — the plate must
          // not eat into that margin, so it hugs the text's own measured box.
          padY: 0,
        });
      } else {
        const knee = Math.min(o.rightEdge - 16, it.x + 22);
        svg.polyline(
          [
            [o.rightEdge - 7, ly],
            [knee, ly],
            [it.x, it.y],
          ],
          { stroke: C.faint, sw: 1.1 }
        );
        svg.circle(it.x, it.y, 2.6, { fill: color });
        // An Urdu box is right-aligned inside itself, so a full-margin-wide box
        // would fling the label to the far edge of the page, miles from its
        // leader. Size it to the text instead.
        const uw = hasUrdu(it.text)
          ? Math.min(o.width - o.rightEdge - 2, measure(it.text, size, { lang: "ur" }) * 1.3 + size)
          : undefined;
        svg.plateText(o.rightEdge, ly, it.text, {
          size,
          baseline: "middle",
          fill: C.text,
          lang: hasUrdu(it.text) ? o.lang || "ur" : "en",
          w: uw,
          // see the matching comment on the left-side plateText call above.
          padY: 0,
        });
      }
    });
  }
}

/** Height a side of labels needs, so the figure box is never the shorter one. */
function leaderHeight(items, lang) {
  const spacing = lang === "ur" ? 36 : 26;
  const l = items.filter((i) => i.side === "left").length;
  const r = items.filter((i) => i.side === "right").length;
  return Math.max(l, r, 1) * spacing;
}

const LABELS = {
  en: {
    wall: "cell wall",
    membrane: "cell membrane",
    cytoplasm: "cytoplasm",
    nucleus: "nucleus",
    nucleolus: "nucleolus",
    vacuole: "central vacuole",
    chloroplast: "chloroplast",
    mitochondrion: "mitochondrion",
    ribosome: "ribosomes",
    cuticleTop: "upper cuticle",
    epidermisTop: "upper epidermis",
    palisade: "palisade mesophyll",
    spongy: "spongy mesophyll",
    airspace: "air space",
    epidermisBot: "lower epidermis",
    cuticleBot: "lower cuticle",
    xylem: "xylem",
    phloem: "phloem",
    guard: "guard cell",
    stoma: "stoma",
    heart: "heart",
    artery: "artery",
    arteriole: "arteriole",
    capillary: "capillary bed",
    venule: "venule",
    vein: "vein",
    exchange: "gas exchange happens here",
    ra: "RA",
    rv: "RV",
    la: "LA",
    lv: "LV",
  },
  ur: {
    wall: "خلوی دیوار",
    membrane: "خلوی جھلی",
    cytoplasm: "سائٹوپلازم",
    nucleus: "مرکزہ",
    nucleolus: "مرکزک",
    vacuole: "ویکیوول",
    chloroplast: "کلوروپلاسٹ",
    mitochondrion: "مائٹوکونڈریا",
    ribosome: "رائبوسوم",
    cuticleTop: "بالائی مومی تہہ",
    epidermisTop: "بالائی بشرہ",
    palisade: "عمودی خلیے",
    spongy: "اسفنجی خلیے",
    airspace: "ہوا کی جگہ",
    epidermisBot: "زیریں بشرہ",
    cuticleBot: "زیریں مومی تہہ",
    xylem: "زائلم",
    phloem: "فلوئم",
    guard: "محافظ خلیہ",
    stoma: "منفذ",
    heart: "دل",
    artery: "شریان",
    arteriole: "شریانچہ",
    capillary: "کیپلری جال",
    venule: "وریدچہ",
    vein: "ورید",
    exchange: "گیسوں کا تبادلہ یہاں ہوتا ہے",
    ra: "RA",
    rv: "RV",
    la: "LA",
    lv: "LV",
  },
};

function chromeWidth(spec, lang) {
  const w = (t, size) => (t ? measure(String(t), size, { lang: hasUrdu(String(t)) ? "ur" : lang }) + 26 : 0);
  return Math.max(
    w(spec.title, SIZE.title * 1.06),
    w(spec.caption, SIZE.caption),
    w(spec.source, SIZE.caption * 0.92),
    w(spec.note, SIZE.caption)
  );
}

/* ------------------------------------------------------------------ */
/* organelle shapes                                                    */
/* ------------------------------------------------------------------ */

/** A lens-shaped chloroplast with a grana stack line. */
function chloroplast(svg, cx, cy, rot) {
  const t = `rotate(${rot} ${cx} ${cy})`;
  svg.ellipse(cx, cy, 21, 11, { fill: C.leaf, opacity: 0.75, stroke: C.leaf, sw: 1.4, transform: t });
  svg.line(cx - 9, cy, cx + 9, cy, { stroke: C.paper, sw: 1.6, transform: t, opacity: 0.85 });
  svg.line(cx - 5, cy - 4, cx + 5, cy - 4, { stroke: C.paper, sw: 1.2, transform: t, opacity: 0.6 });
}

/** A stadium-shaped mitochondrion with an inner fold (cristae). */
function mitochondrion(svg, cx, cy, rot) {
  const w = 46;
  const h = 22;
  const t = `rotate(${rot} ${cx} ${cy})`;
  svg.rect(cx - w / 2, cy - h / 2, w, h, {
    rx: h / 2,
    fill: C.clay,
    opacity: 0.4,
    stroke: C.clay,
    sw: 1.5,
    transform: t,
  });
  svg.path(
    `M${cx - w / 2 + 7},${cy - 5} Q${cx - 6},${cy + 7} ${cx + 2},${cy - 5} Q${cx + 10},${cy + 7} ${cx + w / 2 - 7},${cy - 3}`,
    { fill: "none", stroke: C.clay, sw: 1.5, transform: t }
  );
}

/* ------------------------------------------------------------------ */
/* (a) cell                                                            */
/* ------------------------------------------------------------------ */

// Deterministic radii for the animal-cell blob — a fixed table, never random.
const BLOB_R = [1.0, 0.93, 1.07, 0.97, 1.09, 0.9, 1.03, 0.95, 1.06, 0.92, 1.05, 0.98];
const RIBOSOMES = [
  [-96, -54], [-64, -72], [-30, -80], [40, -70], [82, -46], [104, -8],
  [92, 40], [56, 68], [-8, 78], [-58, 66], [-100, 30], [-108, -12],
  [-40, -34], [30, 30], [-24, 44], [66, -18],
];

function blobPath(cx, cy, rx, ry) {
  const n = BLOB_R.length;
  const p = BLOB_R.map((r, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r];
  });
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const r2 = (v) => Math.round(v * 100) / 100;
  let d = `M${r2(mid(p[n - 1], p[0])[0])},${r2(mid(p[n - 1], p[0])[1])}`;
  for (let i = 0; i < n; i++) {
    const m = mid(p[i], p[(i + 1) % n]);
    d += ` Q${r2(p[i][0])},${r2(p[i][1])} ${r2(m[0])},${r2(m[1])}`;
  }
  return d + " Z";
}

function renderCell(spec, L) {
  const plant = (spec.kind || "plant") === "plant";
  const lang = spec.lang === "ur" ? "ur" : "en";
  const showLabels = spec.labels !== false;
  const want = Array.isArray(spec.parts) && spec.parts.length ? new Set(spec.parts) : null;
  const on = (k) => !want || want.has(k);

  const margin = lang === "ur" ? 138 : 126;
  const figW = 360;
  const bodyW = Math.max(margin * 2 + figW, chromeWidth(spec, lang), 620);
  const fx = (bodyW - figW) / 2;
  const figH = 274;
  const pad = 14;

  const items = [];
  const parts = [];

  // ---- geometry, gathered first so the label engine can size the body ----
  const cx = fx + figW / 2;
  const top = pad;
  const cy = top + figH / 2;

  if (plant) {
    const x = fx;
    const y = top;
    const w = figW;
    const h = figH;
    parts.push((svg) => {
      svg.rect(x, y, w, h, { rx: 26, fill: C.leaf, opacity: 0.3 }); // cell wall band
      svg.rect(x, y, w, h, { rx: 26, fill: "none", stroke: C.leaf, sw: 2 });
      svg.rect(x + 10, y + 10, w - 20, h - 20, {
        rx: 18,
        fill: C.cool,
        opacity: 0.07,
        stroke: C.ink,
        sw: 1.7,
      }); // membrane + cytoplasm
      // central vacuole
      svg.rect(x + 52, y + 34, w - 176, h - 68, { rx: 26, fill: C.cool, opacity: 0.26, stroke: C.cool, sw: 1.6 });
      // nucleus
      svg.circle(x + w - 74, y + h / 2, 36, { fill: C.plum, opacity: 0.25, stroke: C.plum, sw: 1.9 });
      svg.circle(x + w - 74, y + h / 2, 13, { fill: C.plum, opacity: 0.8 });
      chloroplast(svg, x + 32, y + 74, -24);
      chloroplast(svg, x + 32, y + 196, 22);
      chloroplast(svg, x + 128, y + h - 30, 7);
      chloroplast(svg, x + 122, y + 26, -9);
      mitochondrion(svg, x + w - 78, y + 40, -16);
      mitochondrion(svg, x + w - 70, y + h - 40, 12);
    });
    // side + anchor chosen so no leader has to cross the nucleus or the vacuole
    if (on("wall")) items.push({ x: x + 4, y: y + 42, text: L.wall, side: "left", color: C.leaf });
    if (on("membrane")) items.push({ x: x + 12, y: y + 100, text: L.membrane, side: "left", color: C.ink });
    if (on("vacuole")) items.push({ x: x + 96, y: y + h / 2, text: L.vacuole, side: "left", color: C.cool });
    if (on("chloroplast")) items.push({ x: x + 32, y: y + 196, text: L.chloroplast, side: "left", color: C.leaf });
    if (on("cytoplasm")) items.push({ x: x + 22, y: y + h - 24, text: L.cytoplasm, side: "left", color: C.cool });
    if (on("mitochondrion"))
      items.push({ x: x + w - 78, y: y + 40, text: L.mitochondrion, side: "right", color: C.clay });
    if (on("nucleus"))
      items.push({ x: x + w - 74 + 26, y: y + h / 2 - 26, text: L.nucleus, side: "right", color: C.plum });
    if (on("nucleolus")) items.push({ x: x + w - 74, y: y + h / 2, text: L.nucleolus, side: "right", color: C.plum });
  } else {
    const rx = figW / 2 - 6;
    const ry = figH / 2 - 8;
    parts.push((svg) => {
      const d = blobPath(cx, cy, rx, ry);
      svg.path(d, { fill: C.accent, opacity: 0.12 });
      svg.path(d, { fill: "none", stroke: C.ink, sw: 2.4 }); // membrane
      svg.circle(cx - 24, cy - 6, 42, { fill: C.plum, opacity: 0.25, stroke: C.plum, sw: 1.9 });
      svg.circle(cx - 24, cy - 6, 15, { fill: C.plum, opacity: 0.8 });
      mitochondrion(svg, cx + 82, cy - 46, -22);
      mitochondrion(svg, cx + 66, cy + 52, 14);
      for (const [dx, dy] of RIBOSOMES) svg.circle(cx + dx, cy + dy, 3.4, { fill: C.warn, opacity: 0.75 });
    });
    if (on("membrane")) items.push({ x: cx - rx + 6, y: cy - 40, text: L.membrane, side: "left", color: C.ink });
    if (on("cytoplasm")) items.push({ x: cx - rx + 46, y: cy + 74, text: L.cytoplasm, side: "left", color: C.accent });
    if (on("ribosome")) items.push({ x: cx - 96, y: cy - 54, text: L.ribosome, side: "left", color: C.warn });
    if (on("mitochondrion"))
      items.push({ x: cx + 82, y: cy - 46, text: L.mitochondrion, side: "right", color: C.clay });
    if (on("nucleus")) items.push({ x: cx + 6, y: cy - 36, text: L.nucleus, side: "right", color: C.plum });
    if (on("nucleolus")) items.push({ x: cx - 24, y: cy - 6, text: L.nucleolus, side: "right", color: C.plum });
  }

  const labelH = showLabels ? leaderHeight(items, lang) : 0;
  const bodyH = pad * 2 + Math.max(figH, labelH);
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });
  const shift = (bodyH - pad * 2 - figH) / 2;
  svg.group({ transform: `translate(0,${Math.round(shift * 100) / 100})` }, (g) => parts.forEach((f) => f(g)));
  if (showLabels)
    drawLeaders(
      svg,
      items.map((i) => ({ ...i, y: i.y + shift })),
      { leftEdge: fx - 22, rightEdge: fx + figW + 22, top: pad + 10, bottom: bodyH - pad - 10, lang, width: bodyW }
    );
  return svg.toString();
}

/* ------------------------------------------------------------------ */
/* (b) leaf cross section                                              */
/* ------------------------------------------------------------------ */

function renderLeaf(spec, L) {
  const lang = spec.lang === "ur" ? "ur" : "en";
  const showLabels = spec.labels !== false;
  const gas = spec.gasArrows !== false;
  const margin = lang === "ur" ? 142 : 132;
  const figW = 340;
  const bodyW = Math.max(margin * 2 + figW, chromeWidth(spec, lang), 640);
  const x = (bodyW - figW) / 2;
  const pad = 14;

  const H = { cuticle: 9, epi: 30, palisade: 72, spongy: 78 };
  const figH = H.cuticle * 2 + H.epi * 2 + H.palisade + H.spongy;
  const gasH = gas ? 74 : 0;

  const items = [];
  const yCutT = 0;
  const yEpiT = yCutT + H.cuticle;
  const yPal = yEpiT + H.epi;
  const ySpo = yPal + H.palisade;
  const yEpiB = ySpo + H.spongy;
  const yCutB = yEpiB + H.epi;

  const stomaCx = x + figW * 0.7;

  const draw = (svg, dy) => {
    const Y = (v) => v + dy;
    // cuticles
    svg.rect(x, Y(yCutT), figW, H.cuticle, { fill: C.accent, opacity: 0.55 });
    svg.rect(x, Y(yCutB), figW, H.cuticle, { fill: C.accent, opacity: 0.55 });
    // epidermis, upper
    svg.rect(x, Y(yEpiT), figW, H.epi, { fill: C.leaf, opacity: 0.13, stroke: C.ink, sw: 1.2 });
    for (let i = 1; i < 7; i++)
      svg.line(x + (figW * i) / 7, Y(yEpiT), x + (figW * i) / 7, Y(yEpiT) + H.epi, { stroke: C.rule, sw: 1 });
    // palisade — tall packed cells
    svg.rect(x, Y(yPal), figW, H.palisade, { fill: C.leaf, opacity: 0.1 });
    for (let i = 0; i < 9; i++) {
      const cw = figW / 9;
      svg.rect(x + i * cw + 2.5, Y(yPal) + 4, cw - 5, H.palisade - 8, {
        rx: 7,
        fill: C.leaf,
        opacity: 0.42,
        stroke: C.leaf,
        sw: 1.2,
      });
      svg.circle(x + i * cw + cw / 2, Y(yPal) + 20, 4.2, { fill: C.leaf, opacity: 0.95 });
      svg.circle(x + i * cw + cw / 2 - 6, Y(yPal) + 44, 4.2, { fill: C.leaf, opacity: 0.95 });
      svg.circle(x + i * cw + cw / 2 + 7, Y(yPal) + 56, 4.2, { fill: C.leaf, opacity: 0.95 });
    }
    // spongy — round cells with air spaces between
    svg.rect(x, Y(ySpo), figW, H.spongy, { fill: C.leaf, opacity: 0.07 });
    const spongy = [
      [0.07, 0.24, 16], [0.2, 0.66, 14], [0.33, 0.26, 15], [0.45, 0.7, 13],
      [0.56, 0.28, 14], [0.7, 0.68, 15], [0.83, 0.3, 16], [0.93, 0.68, 13],
      [0.13, 0.78, 10], [0.62, 0.85, 10], [0.88, 0.85, 9],
    ];
    for (const [fxr, fyr, r] of spongy)
      svg.circle(x + figW * fxr, Y(ySpo) + H.spongy * fyr, r, {
        fill: C.leaf,
        opacity: 0.4,
        stroke: C.leaf,
        sw: 1.2,
      });
    // vascular bundle, sitting inside the spongy mesophyll
    const vx = x + figW * 0.3;
    const vy = Y(ySpo) + H.spongy * 0.42;
    const rx = 44;
    const ry = 31;
    svg.path(`M${vx - rx},${vy} A${rx},${ry} 0 0 1 ${vx + rx},${vy} Z`, {
      fill: C.clay,
      opacity: 0.42,
      stroke: C.ink,
      sw: 1.4,
    });
    svg.path(`M${vx + rx},${vy} A${rx},${ry} 0 0 1 ${vx - rx},${vy} Z`, {
      fill: C.plum,
      opacity: 0.34,
      stroke: C.ink,
      sw: 1.4,
    });
    svg.line(vx - rx, vy, vx + rx, vy, { stroke: C.ink, sw: 1.3 });
    for (const dx of [-22, 0, 22]) svg.circle(vx + dx, vy - 13, 6, { fill: C.paper, stroke: C.clay, sw: 1.3 });
    for (const dx of [-16, 16]) svg.circle(vx + dx, vy + 14, 5, { fill: C.paper, stroke: C.plum, sw: 1.3 });
    // lower epidermis, broken by the stoma
    const gap = 46;
    svg.rect(x, Y(yEpiB), stomaCx - gap / 2 - x, H.epi, { fill: C.leaf, opacity: 0.13, stroke: C.ink, sw: 1.2 });
    svg.rect(stomaCx + gap / 2, Y(yEpiB), x + figW - (stomaCx + gap / 2), H.epi, {
      fill: C.leaf,
      opacity: 0.13,
      stroke: C.ink,
      sw: 1.2,
    });
    svg.rect(x, Y(yCutB), stomaCx - gap / 2 - x, H.cuticle, { fill: C.accent, opacity: 0.55 });
    svg.rect(stomaCx + gap / 2, Y(yCutB), x + figW - (stomaCx + gap / 2), H.cuticle, {
      fill: C.accent,
      opacity: 0.55,
    });
    // two guard cells forming the pore
    const gy = Y(yEpiB) + H.epi / 2 + 2;
    for (const s of [-1, 1]) {
      svg.ellipse(stomaCx + s * 19, gy, 17, 13, {
        fill: C.leaf,
        opacity: 0.6,
        stroke: C.leaf,
        sw: 1.6,
        transform: `rotate(${s * 18} ${stomaCx + s * 19} ${gy})`,
      });
      svg.circle(stomaCx + s * 24, gy - 3, 3.6, { fill: C.leaf });
    }
    svg.ellipse(stomaCx, gy, 6, 12, { fill: C.paper, stroke: C.ink, sw: 1.3 });

    if (gas) {
      const gb = Y(yCutB) + H.cuticle + 14;
      svg.arrow(stomaCx - 34, gb + 44, stomaCx - 8, gb + 4, { stroke: C.cool, sw: 2 });
      svg.text(stomaCx - 40, gb + 58, "CO₂ in", {
        size: LSIZE,
        anchor: "middle",
        fill: C.cool,
        weight: 600,
        lang: "en",
      });
      svg.arrow(stomaCx + 8, gb + 4, stomaCx + 34, gb + 44, { stroke: C.leaf, sw: 2 });
      svg.text(stomaCx + 44, gb + 58, "O₂ out", {
        size: LSIZE,
        anchor: "middle",
        fill: C.leaf,
        weight: 600,
        lang: "en",
      });
      svg.arrow(stomaCx + 22, gb + 2, stomaCx + 86, gb + 26, { stroke: C.accent, sw: 2, dash: "5 4" });
      svg.text(stomaCx + 108, gb + 32, "H₂O", {
        size: LSIZE,
        anchor: "middle",
        fill: C.clay,
        weight: 600,
        lang: "en",
      });
    }
  };

  if (showLabels) {
    // Anchor x on each side is monotonic in anchor y, which is what stops the
    // leaders crossing once the slots are handed out in that same order.
    const vy = ySpo + H.spongy * 0.42;
    items.push({ x: x + figW - 20, y: yCutT + 4, text: L.cuticleTop, side: "right", color: C.accent });
    items.push({ x: x + figW - 30, y: yEpiT + H.epi / 2, text: L.epidermisTop, side: "right", color: C.ink });
    // the centre of the 8th palisade cell, not the gap between two of them
    items.push({ x: x + (figW / 9) * 7.5, y: yPal + 30, text: L.palisade, side: "right", color: C.leaf });
    items.push({ x: x + figW * 0.83, y: ySpo + H.spongy * 0.3, text: L.spongy, side: "right", color: C.leaf });
    items.push({ x: x + figW * 0.76, y: ySpo + H.spongy * 0.45, text: L.airspace, side: "right", color: C.muted });
    items.push({ x: stomaCx + 19, y: yEpiB + H.epi / 2 + 2, text: L.guard, side: "right", color: C.leaf });
    items.push({ x: stomaCx, y: yEpiB + H.epi / 2 + 3, text: L.stoma, side: "right", color: C.ink });
    items.push({ x: x + figW * 0.3 - 22, y: vy - 13, text: L.xylem, side: "left", color: C.clay });
    items.push({ x: x + figW * 0.3 - 16, y: vy + 14, text: L.phloem, side: "left", color: C.plum });
    items.push({ x: x + 40, y: yEpiB + H.epi / 2, text: L.epidermisBot, side: "left", color: C.ink });
    items.push({ x: x + 20, y: yCutB + 4, text: L.cuticleBot, side: "left", color: C.accent });
  }

  const labelH = showLabels ? leaderHeight(items, lang) : 0;
  const bodyH = pad * 2 + Math.max(figH + gasH, labelH);
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });
  const dy = pad + Math.max(0, (bodyH - pad * 2 - (figH + gasH)) / 2);
  draw(svg, dy);
  if (showLabels)
    drawLeaders(
      svg,
      items.map((i) => ({ ...i, y: i.y + dy })),
      { leftEdge: x - 20, rightEdge: x + figW + 20, top: pad + 8, bottom: bodyH - pad - 8, lang, width: bodyW }
    );
  return svg.toString();
}

/* ------------------------------------------------------------------ */
/* (c) heart / circulatory loop                                        */
/* ------------------------------------------------------------------ */

function renderHeartLoop(spec, L) {
  const lang = spec.lang === "ur" ? "ur" : "en";
  const showLabels = spec.labels !== false;
  const bodyW = Math.max(660, chromeWidth(spec, lang));
  const bodyH = 400;
  const cx = bodyW / 2;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  const RIGHT = cx + 190; // arterial column (viewer's right)
  const LEFTX = cx - 190; // venous column
  const hw = 132; // heart width
  const hh = 108;
  const hTop = 16;
  const hy = hTop + hh / 2;
  const bedY = 268;

  const red = C.warn;
  const blue = C.cool;

  /* ---- the heart: four chambers, patient's right on the viewer's left ---- */
  svg.rect(cx - hw / 2, hTop, hw, hh, { rx: 20, fill: C.paper, stroke: C.ink, sw: 2 });
  svg.rect(cx - hw / 2 + 3, hTop + 3, hw / 2 - 3, hh * 0.4, { rx: 14, fill: blue, opacity: 0.28 });
  svg.rect(cx - hw / 2 + 3, hTop + 3 + hh * 0.4, hw / 2 - 3, hh * 0.6 - 6, { rx: 14, fill: blue, opacity: 0.45 });
  svg.rect(cx, hTop + 3, hw / 2 - 3, hh * 0.4, { rx: 14, fill: red, opacity: 0.24 });
  svg.rect(cx, hTop + 3 + hh * 0.4, hw / 2 - 3, hh * 0.6 - 6, { rx: 14, fill: red, opacity: 0.4 });
  svg.line(cx, hTop + 4, cx, hTop + hh - 4, { stroke: C.ink, sw: 2 });
  svg.line(cx - hw / 2 + 4, hTop + hh * 0.4, cx + hw / 2 - 4, hTop + hh * 0.4, { stroke: C.ink, sw: 1.5 });
  if (showLabels) {
    const t = (x, y, s) =>
      svg.text(x, y, s, { size: SIZE.tiny, anchor: "middle", baseline: "middle", weight: 700, fill: C.ink, lang: "en" });
    t(cx - hw / 4, hTop + hh * 0.2, L.ra);
    t(cx - hw / 4, hTop + hh * 0.7, L.rv);
    t(cx + hw / 4, hTop + hh * 0.2, L.la);
    t(cx + hw / 4, hTop + hh * 0.7, L.lv);
  }

  /* ---- vessels: a closed loop, tapering away from the heart ---- */
  const vessel = (d, sw, color) => svg.path(d, { fill: "none", stroke: color, sw, cap: "round" });
  // Systemic loop: OUT of the left ventricle (lower right chamber), back INTO
  // the right atrium (upper left chamber) — not ventricle-to-ventricle.
  const outY = hTop + hh * 0.72;
  const inY = hTop + hh * 0.2;
  vessel(`M${cx + hw / 2 - 6},${outY} Q${RIGHT},${outY} ${RIGHT},${hy + 66}`, 15, red);
  vessel(`M${RIGHT},${hy + 62} L${RIGHT},${hy + 128}`, 15, red); // artery
  vessel(`M${RIGHT},${hy + 126} L${RIGHT},${bedY - 40}`, 8.5, red); // arteriole
  vessel(`M${RIGHT},${bedY - 42} Q${RIGHT},${bedY} ${RIGHT - 46},${bedY}`, 8.5, red);
  // out of the bed, up the venous column
  vessel(`M${LEFTX + 46},${bedY} Q${LEFTX},${bedY} ${LEFTX},${bedY - 42}`, 8.5, blue);
  vessel(`M${LEFTX},${bedY - 40} L${LEFTX},${hy + 126}`, 8.5, blue); // venule
  vessel(`M${LEFTX},${hy + 128} L${LEFTX},${hy + 62}`, 15, blue); // vein
  vessel(`M${LEFTX},${hy + 66} Q${LEFTX},${inY} ${cx - hw / 2 + 6},${inY}`, 15, blue);

  /* ---- the capillary bed: a fine net where the colour changes ---- */
  const bedR = RIGHT - 46;
  const bedL = LEFTX + 46;
  const strands = [-26, -13, 0, 13, 26];
  for (const dy of strands) {
    vessel(`M${bedR},${bedY + dy} Q${(bedR + cx) / 2},${bedY + dy * 1.35} ${cx},${bedY + dy * 1.15}`, 2.1, red);
    vessel(`M${cx},${bedY + dy * 1.15} Q${(cx + bedL) / 2},${bedY + dy * 1.35} ${bedL},${bedY + dy}`, 2.1, blue);
  }
  for (const t of [0.1, 0.22, 0.34, 0.44, 0.56, 0.66, 0.78, 0.9]) {
    const x = bedR + (bedL - bedR) * t;
    const k = 1 - Math.abs(0.5 - t) * 2 * 0.25;
    svg.line(x, bedY - 30 * k, x, bedY + 30 * k, { stroke: t < 0.5 ? red : blue, sw: 1.5, opacity: 0.75 });
  }

  /* ---- direction of flow ---- */
  const flow = (x1, y1, x2, y2, color) => svg.arrow(x1, y1, x2, y2, { stroke: color, sw: 2.2, size: 10, width: 8 });
  flow(RIGHT + 22, hy + 74, RIGHT + 22, hy + 116, red);
  flow(LEFTX - 22, hy + 116, LEFTX - 22, hy + 74, blue);
  flow(cx + 70, bedY + 46, cx - 70, bedY + 46, C.muted);

  /* ---- gas exchange at the bed ---- */
  svg.arrow(cx - 26, bedY - 34, cx - 26, bedY - 62, { stroke: C.leaf, sw: 1.8, size: 9 });
  svg.arrow(cx + 26, bedY - 62, cx + 26, bedY - 34, { stroke: C.plum, sw: 1.8, size: 9 });
  svg.text(cx - 26, bedY - 70, "O₂", { size: LSIZE, anchor: "middle", weight: 700, fill: C.leaf, lang: "en" });
  svg.text(cx + 26, bedY - 70, "CO₂", { size: LSIZE, anchor: "middle", weight: 700, fill: C.plum, lang: "en" });

  /* ---- labels, placed beside their own segment ---- */
  if (showLabels) {
    // One consistent text colour for every label. The vessels themselves are
    // already colour-coded (red/blue); repeating that on the label text just
    // reads as noise. plateText also gives each label its own opaque backdrop,
    // so legibility never depends on what is actually behind it (a vessel path,
    // a page-level colour override) — see lib/svg.js's plateText doc.
    const lab = (x, y, s, anchor) =>
      svg.plateText(x, y, s, {
        size: LSIZE,
        anchor,
        baseline: "middle",
        weight: 600,
        fill: C.text,
        lang: hasUrdu(s) ? lang : "en",
        w: hasUrdu(s) ? 150 : undefined,
        padY: 0,
      });
    lab(cx, hTop - 8, L.heart, "middle");
    lab(RIGHT + 40, hy + 95, L.artery, "start");
    lab(RIGHT + 40, bedY - 70, L.arteriole, "start");
    lab(LEFTX - 40, hy + 95, L.vein, "end");
    lab(LEFTX - 40, bedY - 70, L.venule, "end");
    lab(cx, bedY + 70, L.capillary, "middle");
    lab(cx, bedY + 96, L.exchange, "middle");
  }

  return svg.toString();
}

/* ------------------------------------------------------------------ */

function render(spec) {
  const s = spec || {};
  const lang = s.lang === "ur" ? "ur" : "en";
  const L = Object.assign({}, LABELS[lang], s.labelText || {});
  const fig = s.figure || (s.type !== "cell" && s.type !== "bio_schematic" ? s.type : "cell");
  if (fig === "leaf_cross_section" || fig === "leaf") return renderLeaf(s, L);
  if (fig === "heart_loop" || fig === "heart") return renderHeartLoop(s, L);
  return renderCell(s, L);
}

module.exports = {
  type: "cell",
  aliases: ["leaf_cross_section", "heart_loop", "bio_schematic"],
  summary:
    "Three parametric biology schematics — plant/animal cell, leaf cross section with stoma, and the circulatory loop — all with leader-line labels.",
  render,
  examples: [
    {
      name: "cell_plant",
      spec: {
        type: "cell",
        kind: "plant",
        title: "A plant cell",
        caption: "The wall, the big central vacuole and the chloroplasts are what an animal cell has not got.",
      },
    },
    {
      name: "cell_animal_ur",
      spec: {
        type: "cell",
        kind: "animal",
        lang: "ur",
        title: "جانوروں کا خلیہ",
        caption: "نہ خلوی دیوار، نہ کلوروپلاسٹ، نہ بڑا ویکیوول۔",
      },
    },
    {
      name: "leaf_cross_section",
      spec: {
        type: "leaf_cross_section",
        gasArrows: true,
        title: "Inside a leaf",
        caption: "Light is caught in the palisade layer; gases move through the stoma between the guard cells.",
      },
    },
    {
      name: "heart_loop",
      spec: {
        type: "heart_loop",
        title: "One trip round the circulation",
        caption: "Blood leaves bright red, gives up its oxygen in the capillary bed, and returns dark.",
      },
    },
  ],
};
