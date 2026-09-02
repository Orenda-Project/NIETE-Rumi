// mindmap — a rounded centre box with N branches on smooth curved connectors,
// each branch box carrying short plain-text twigs (leaves).
//
// Replaces the bio_mindmap image prompts. The branches are NOT distributed
// around a circle: at six branches a circle puts two labels at the top and two
// at the bottom, where the leaf text of one lands on the box of the next. They
// are split into two vertical columns instead — roughly half a side, ordered
// top-to-bottom — which is stable, never overlaps, and reads as an outline.
//
// Layout invariants:
//   * the canvas is computed from measured text extents, so nothing is clipped
//   * leaf text is anchored AWAY from the centre (left column 'end', right
//     column 'start'), so the twig always points at the start of the label
//   * lang:'ur' mirrors the columns — branch 1 goes on the RIGHT, where an Urdu
//     reader starts — and every Urdu box is sized to its own measured text

const { Svg, C, SIZE, LEADING, measure, wrap, hasUrdu, urduBoxH } = require("../lib/svg");
const { SERIES } = require("../lib/tokens");

const isUr = (lang, s) => hasUrdu(String(s ?? ""));  // script decides, not the declared lang

// measure() carries a Nastaliq average of 0.40em/char; rendered Noto Nastaliq
// runs up to ~35% wider. Under-estimating re-wraps the text inside its
// foreignObject and drops it out of the box, so Urdu is always padded.
const UR_PAD = 1.35;
const tw = (s, size, o = {}) =>
  isUr(o.lang, s) ? measure(s, size, { lang: "ur" }) * UR_PAD : measure(s, size, o);

function blockH(s, size, w, lang) {
  if (s === undefined || s === null || s === "") return 0;
  // urduBoxH is the SHARED estimator (lib/measure.js) that _urduText also uses,
  // so the space reserved here is exactly the box that gets drawn.
  if (isUr(lang, s)) return urduBoxH(s, size, w);
  // measure BOLD: reserving the wider case is free, while under-reserving wraps
  // an extra line at draw time and the block spills out of the box kept for it
  return wrap(String(s), size, w, { weight: 700 }).length * size * LEADING.latin;
}

/** Centred label that WRAPS. svg.text() draws Latin on one line whatever `w`
 * says, so a long centre title used to run straight out of its own box (the
 * G8 "THE BELLS — TWO SOUND DEVICES" mindmap overflowed by 235 units). Height
 * is reserved from the same wrap via blockH(), so the box always fits. */
function drawCentred(svg, cx, cy, w, h, s, o) {
  if (isUr(o.lang, s)) {
    svg.text(cx, cy, s, { ...o, anchor: "middle", baseline: "middle", w, h });
    return;
  }
  const lines = wrap(String(s ?? ""), o.size, w, o);
  const lh = o.size * LEADING.latin;
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) =>
    svg.text(cx, y0 + i * lh, ln, { ...o, anchor: "middle", baseline: "middle", lang: "en" })
  );
}

/** Draw a block anchored at `anchor`, top edge at y. Returns the height. */
function drawAnchored(svg, x, y, w, s, o) {
  const h = blockH(s, o.size, w, o.lang);
  if (!h) return 0;
  if (isUr(o.lang, s)) {
    svg.text(x, y + h / 2, s, { ...o, baseline: "middle", w, h, lang: "ur" });
  } else {
    const lines = wrap(String(s), o.size, w, o);
    const lh = o.size * LEADING.latin;
    lines.forEach((ln, i) =>
      svg.text(x, y + o.size * 0.82 + i * lh, ln, { ...o, lang: "en" })
    );
  }
  return h;
}

const MAX_BRANCH_W = 168;
const MAX_LEAF_W = 158;
const MAX_CENTRE_W = 236;
const CONN = 62; // horizontal run reserved for the curved connector
const LEAF_INDENT = 26;
const LEAF_GAP = 6;
const BRANCH_GAP = 18;

function render(spec) {
  const ur = spec.lang === "ur";
  const centre = spec.centre && typeof spec.centre === "object" ? spec.centre : { label: spec.centre };
  const centreLabel = centre.label ?? "";
  const branches = (Array.isArray(spec.branches) ? spec.branches : []).filter(Boolean);
  const list = branches.length ? branches : [{ label: "" }];

  const SZ = {
    centre: ur ? 18 : SIZE.title,
    branch: ur ? 15.5 : SIZE.label,
    leaf: ur ? 14 : SIZE.small,
  };

  // ---- centre box ----
  const centreW = Math.min(
    MAX_CENTRE_W,
    Math.max(112, Math.ceil(tw(centreLabel, SZ.centre, { weight: 700, lang: spec.lang })) + 36)
  );
  const centreH = Math.max(46, blockH(centreLabel, SZ.centre, centreW - 22, spec.lang) + 24);

  // ---- per-branch geometry ----
  const geom = list.map((b, i) => {
    const bw = Math.min(
      MAX_BRANCH_W,
      Math.max(84, Math.ceil(tw(b.label, SZ.branch, { weight: 700, lang: spec.lang })) + 26)
    );
    const bh = Math.max(34, blockH(b.label, SZ.branch, bw - 18, spec.lang) + 17);
    const leaves = (Array.isArray(b.leaves) ? b.leaves : []).filter(
      (l) => l !== undefined && l !== null && l !== ""
    );
    let leafTotal = 0;
    let leafW = 0;
    const leafGeom = leaves.map((l, k) => {
      // Width FIRST, then height measured at that same width. Reserving height
      // at MAX_LEAF_W while drawing at a narrower `w` under-counts lines for any
      // leaf that does not happen to fill the max — the box then draws taller
      // than the space reserved and lands on the next branch.
      const w = Math.min(MAX_LEAF_W, Math.ceil(tw(l, SZ.leaf, { lang: spec.lang })) + 6);
      const h = blockH(l, SZ.leaf, w, spec.lang);
      const top = leafTotal + (k ? LEAF_GAP : 0);
      leafTotal = top + h;
      leafW = Math.max(leafW, w);
      return { text: l, top, h, w };
    });
    const blockTotal = bh + (leafGeom.length ? 10 + leafTotal : 0);
    const extent = Math.max(bw, leafGeom.length ? LEAF_INDENT + leafW : 0);
    return { i, b, bw, bh, leafGeom, blockTotal, extent, colour: b.color || SERIES[i % SERIES.length] };
  });

  // ---- split into two columns ----
  const firstCount = Math.ceil(geom.length / 2);
  const head = geom.slice(0, firstCount);
  const tail = geom.slice(firstCount);
  const leftCol = ur ? tail : head;
  const rightCol = ur ? head : tail;

  // ---- resolve a column into non-overlapping rows ----
  //
  // Every box in a column — branch boxes and leaf boxes alike — is laid out on
  // ONE running cursor that can only move down, and never by less than MIN_GAP.
  // That makes "no two boxes overlap" a property of the layout rather than a
  // property of the height estimator being right. Nastaliq height is always a
  // prediction; if a box turns out taller than predicted the column simply grows
  // and the viewBox grows with it, which is the cheap direction — height does not
  // affect rendered type size, only width does.
  const MIN_GAP = 4;
  function resolveColumn(col) {
    const rows = [];
    let cursor = 0;
    col.forEach((g, gi) => {
      if (gi) cursor += BRANCH_GAP;
      const boxTop = cursor;
      rows.push({ g, kind: "box", top: boxTop, h: g.bh });
      cursor = boxTop + g.bh;
      if (g.leafGeom.length) cursor += 10;
      g.leafGeom.forEach((lf, k) => {
        if (k) cursor += LEAF_GAP;
        const top = cursor;
        rows.push({ g, kind: "leaf", lf, top, h: lf.h });
        cursor = top + lf.h;
      });
      cursor += MIN_GAP;
    });
    // Second pass: hard-enforce the gap, in case any two rows were authored
    // with tops that do not respect it.
    for (let i = 1; i < rows.length; i++) {
      const need = rows[i - 1].top + rows[i - 1].h + MIN_GAP;
      if (rows[i].top < need) {
        const shift = need - rows[i].top;
        for (let j = i; j < rows.length; j++) rows[j].top += shift;
      }
    }
    const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].h : 0;
    return { rows, total };
  }

  const colH = (col) => resolveColumn(col).total;
  const colExt = (col) => (col.length ? Math.max(...col.map((g) => g.extent)) : 0);

  const leftExt = colExt(leftCol);
  const rightExt = colExt(rightCol);
  const M = 6;
  const bodyW =
    M + leftExt + (leftCol.length ? CONN : 0) + centreW + (rightCol.length ? CONN : 0) + rightExt + M;
  const bodyH = Math.max(colH(leftCol), colH(rightCol), centreH) + 10;

  const centreX = M + leftExt + (leftCol.length ? CONN : 0);
  const centreY = (bodyH - centreH) / 2;
  const cxMid = centreX + centreW / 2;
  const cyMid = centreY + centreH / 2;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  // ---- place + draw one column ----
  function drawColumn(col, side) {
    if (!col.length) return;
    const { rows, total } = resolveColumn(col);
    const y0 = (bodyH - total) / 2;
    // absolute top of every resolved row, keyed by the row object
    const topOf = new Map(rows.map((r) => [r, y0 + r.top]));
    const boxRow = new Map(rows.filter((r) => r.kind === "box").map((r) => [r.g, r]));

    for (const g of col) {
      const bx = side === "r" ? centreX + centreW + CONN : centreX - CONN - g.bw;
      const by = topOf.get(boxRow.get(g));

      // connector: centre-box edge -> branch-box inner edge, as a smooth cubic
      const ax = side === "r" ? centreX + centreW : centreX;
      const ay = Math.min(Math.max(by + g.bh / 2, centreY + 9), centreY + centreH - 9);
      const tx = side === "r" ? bx : bx + g.bw;
      const ty = by + g.bh / 2;
      const d = CONN * 0.72 * (side === "r" ? 1 : -1);
      svg.path(
        `M${ax.toFixed(2)},${ay.toFixed(2)} C${(ax + d).toFixed(2)},${ay.toFixed(2)} ` +
          `${(tx - d).toFixed(2)},${ty.toFixed(2)} ${tx.toFixed(2)},${ty.toFixed(2)}`,
        { fill: "none", stroke: g.colour, sw: 2.2, cap: "round" }
      );

      // branch box
      svg.rect(bx, by, g.bw, g.bh, { rx: 7, fill: C.paper, stroke: g.colour, sw: 1.8 });
      drawCentred(svg, bx + g.bw / 2, by + g.bh / 2, g.bw - 18, g.bh - 4, g.b.label, {
        size: SZ.branch,
        weight: 700,
        fill: C.ink,
        lang: spec.lang,
      });

      // twigs + leaves, anchored away from the centre
      const twigX = side === "r" ? bx + 12 : bx + g.bw - 12;
      const leafX = side === "r" ? bx + LEAF_INDENT : bx + g.bw - LEAF_INDENT;
      const leafRows = rows.filter((r) => r.g === g && r.kind === "leaf");
      for (const r of leafRows) {
        const lf = r.lf;
        const ly = topOf.get(r);
        const lcy = ly + lf.h / 2;
        svg.path(
          `M${twigX.toFixed(2)},${(by + g.bh).toFixed(2)} Q${twigX.toFixed(2)},${lcy.toFixed(2)} ` +
            `${(side === "r" ? leafX - 5 : leafX + 5).toFixed(2)},${lcy.toFixed(2)}`,
          { fill: "none", stroke: g.colour, sw: 1.4, cap: "round" }
        );
        drawAnchored(svg, leafX, ly, side === "r" ? lf.w : lf.w, lf.text, {
          size: SZ.leaf,
          anchor: side === "r" ? "start" : "end",
          fill: C.text,
          lang: spec.lang,
        });
      }
    }
  }

  drawColumn(leftCol, "l");
  drawColumn(rightCol, "r");

  // ---- centre box last, so the connectors tuck under it ----
  svg.rect(centreX, centreY, centreW, centreH, {
    rx: 10,
    fill: C.paper,
    stroke: centre.color || C.ink,
    sw: 2.4,
  });
  drawCentred(svg, cxMid, cyMid, centreW - 22, centreH - 6, centreLabel, {
    size: SZ.centre,
    weight: 700,
    fill: centre.color || C.ink,
    lang: spec.lang,
  });

  return svg.toString();
}

module.exports = {
  type: "mindmap",
  aliases: ["concept_map"],
  summary: "Radial map — centre box, curved branches in two columns, plain-text leaves on twigs.",
  render,
  examples: [
    {
      name: "mindmap_is_it_dengue",
      spec: {
        type: "mindmap",
        title: "THE SCIENTIFIC METHOD, ON ONE REAL QUESTION",
        centre: { label: "IS IT DENGUE?" },
        branches: [
          { label: "1 Problem", leaves: ["state it as a question"] },
          {
            label: "2 Observation",
            leaves: ["qualitative: rash, fever", "quantitative: how many cases"],
          },
          { label: "3 Hypothesis", leaves: ["the water tank breeds mosquitoes"] },
          { label: "4 Deduction", leaves: ["IF ... THEN ..."] },
          { label: "5 Experiment", leaves: ["change one thing only"] },
          { label: "6 Result", leaves: ["the numbers decide"] },
        ],
        caption: "Six steps, one outbreak. Each step names what you must write down before the next one.",
      },
    },
    {
      name: "mindmap_is_it_dengue_ur",
      spec: {
        type: "mindmap",
        lang: "ur",
        title: "سائنسی طریقہ ایک اصل سوال پر",
        centre: { label: "کیا یہ ڈینگی ہے؟" },
        branches: [
          { label: "۱ مسئلہ", leaves: ["سوال کی صورت میں لکھیں"] },
          { label: "۲ مشاہدہ", leaves: ["کیفیتی: بخار، خارش", "مقداری: کتنے مریض"] },
          { label: "۳ مفروضہ", leaves: ["پانی کی ٹنکی میں مچھر"] },
          { label: "۴ استخراج", leaves: ["اگر ۔۔۔ تو ۔۔۔"] },
          { label: "۵ تجربہ", leaves: ["صرف ایک چیز بدلیں"] },
          { label: "۶ نتیجہ", leaves: ["اعداد فیصلہ کریں گے"] },
        ],
        caption: "ہر قدم پر لکھیں کہ آپ نے کیا دیکھا",
      },
    },
    {
      // Collision stress test (L3 defect, G9 Bio Urdu p2): 6 branches, every one
      // carrying two or three LONG Nastaliq leaves. Urdu box height is always a
      // prediction, so this is the case that catches a layout which trusts the
      // prediction instead of resolving against it. test.js asserts that no two
      // <foreignObject> label boxes overlap.
      name: "mindmap_urdu_long_leaves_stress",
      spec: {
        type: "mindmap",
        lang: "ur",
        title: "سائنسی طریقہ — تفصیل کے ساتھ",
        centre: { label: "کیا یہ ڈینگی ہے؟" },
        branches: [
          {
            label: "۱ مسئلہ",
            leaves: [
              "مسئلے کو ایک واضح سوال کی صورت میں لکھیں",
              "یہ سوال ایسا ہو جس کا جواب مشاہدے سے مل سکے",
            ],
          },
          {
            label: "۲ مشاہدہ",
            leaves: [
              "کیفیتی مشاہدہ: بخار، جسم پر خارش، جوڑوں میں درد",
              "مقداری مشاہدہ: محلے میں کتنے مریض رپورٹ ہوئے",
              "ہر مشاہدہ تاریخ کے ساتھ لکھیں",
            ],
          },
          {
            label: "۳ مفروضہ",
            leaves: [
              "پانی کی ٹنکی میں مچھر پرورش پا رہے ہیں",
              "مفروضہ ایسا ہو جسے غلط ثابت کیا جا سکے",
            ],
          },
          {
            label: "۴ استخراج",
            leaves: [
              "اگر ٹنکی ڈھانپ دی جائے تو مریضوں کی تعداد کم ہوگی",
              "پیش گوئی پہلے لکھیں، تجربے کے بعد نہیں",
            ],
          },
          {
            label: "۵ تجربہ",
            leaves: [
              "ایک وقت میں صرف ایک چیز تبدیل کریں",
              "موازنے کے لیے ایک گروہ بغیر تبدیلی کے رکھیں",
            ],
          },
          {
            label: "۶ نتیجہ",
            leaves: [
              "اعداد و شمار فیصلہ کریں گے، ہماری توقع نہیں",
              "اگر نتیجہ مفروضے کے خلاف ہو تو مفروضہ بدلیں",
            ],
          },
        ],
        caption: "ہر قدم پر لکھیں کہ آپ نے کیا دیکھا",
      },
    },
    {
      name: "mindmap_matter_states",
      spec: {
        type: "mindmap",
        title: "THREE STATES, ONE SUBSTANCE",
        centre: { label: "WATER" },
        branches: [
          { label: "SOLID", leaves: ["fixed shape", "ice at 0 C"] },
          { label: "LIQUID", leaves: ["takes the jug's shape"] },
          { label: "GAS", leaves: ["fills the room", "steam at 100 C"] },
        ],
        caption: "Same particles throughout. Only the spacing and the energy change.",
      },
    },
  ],
};
