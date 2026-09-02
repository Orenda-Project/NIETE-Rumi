// fraction_bar — horizontal part-whole bars.
//
// Two modes, one module, because they are the same picture with a different
// rule for how wide a bar gets:
//
//   fraction mode (default) — every bar spans the SAME total width and is cut
//     into `parts` equal segments. That shared width is the whole pedagogical
//     point: 2/3 next to 3/4 only teaches anything if the wholes match.
//
//   unit mode (`unitLabel` or `model:'unit'`) — the Singapore bar model. One
//     unit is a fixed width, so Ali's 5 units is visibly longer than Sara's 3,
//     and a brace on the outside carries the total.
//
// Urdu mirrors: the name gutter, the value gutter and the brace all swap sides,
// because a labelled bar is read the way the sentence is read. (A number line
// does not mirror; maths stays LTR. A labelled bar does.)

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");

const fin = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;

const UR_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toUrduDigits = (s) => String(s).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]);

/** Place a label so an Urdu foreignObject cannot drift off its anchor.
 *  `align` is VISUAL: 'left' = text starts at x, 'right' = text ends at x. */
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
  const w = o.w ?? Math.max(46, measure(str, o.size ?? SIZE.small, { lang: "ur" }) * 1.3 + 12);
  if (align === "center") draw(x, y, str, { ...o, anchor: "middle", w, lang: "ur" });
  else if (align === "right") draw(x - w, y, str, { ...o, anchor: "start", w, lang: "ur" });
  else draw(x + w, y, str, { ...o, anchor: "end", w, lang: "ur" });
}

/** Curly brace spanning y0..y1. `dir` = +1 bulges right, -1 bulges left.
 *  Returns the x of the tip. */
function brace(svg, x, y0, y1, dir, color) {
  const w = 9 * dir;
  const mid = (y0 + y1) / 2;
  const d =
    `M${r2(x)},${r2(y0)} Q${r2(x + w)},${r2(y0)} ${r2(x + w)},${r2(y0 + 9)} ` +
    `L${r2(x + w)},${r2(mid - 9)} Q${r2(x + w)},${r2(mid)} ${r2(x + 2 * w)},${r2(mid)} ` +
    `Q${r2(x + w)},${r2(mid)} ${r2(x + w)},${r2(mid + 9)} ` +
    `L${r2(x + w)},${r2(y1 - 9)} Q${r2(x + w)},${r2(y1)} ${r2(x)},${r2(y1)}`;
  svg.path(d, { fill: "none", stroke: color, sw: 1.6, join: "round", cap: "round" });
  return x + 2 * w;
}

/** Horizontal brace under a span, tip pointing down. Returns the tip y. */
function braceUnder(svg, x0, x1, y, color) {
  const h = 8;
  const mid = (x0 + x1) / 2;
  const d =
    `M${r2(x0)},${r2(y)} Q${r2(x0)},${r2(y + h)} ${r2(x0 + h)},${r2(y + h)} ` +
    `L${r2(mid - h)},${r2(y + h)} Q${r2(mid)},${r2(y + h)} ${r2(mid)},${r2(y + 2 * h)} ` +
    `Q${r2(mid)},${r2(y + h)} ${r2(mid + h)},${r2(y + h)} ` +
    `L${r2(x1 - h)},${r2(y + h)} Q${r2(x1)},${r2(y + h)} ${r2(x1)},${r2(y)}`;
  svg.path(d, { fill: "none", stroke: color, sw: 1.5, join: "round", cap: "round" });
  return y + 2 * h;
}

function shadedSet(shaded, parts) {
  const set = new Set();
  if (typeof shaded === "number") {
    for (let i = 0; i < Math.min(Math.max(0, Math.round(shaded)), parts); i++) set.add(i);
  } else if (Array.isArray(shaded)) {
    for (const v of shaded) if (Number.isFinite(Number(v))) set.add(Number(v));
  } else if (typeof shaded === "string" && shaded.includes("/")) {
    const [nu, de] = shaded.split("/").map(Number);
    const k = Math.round((nu / de) * parts);
    for (let i = 0; i < Math.min(k, parts); i++) set.add(i);
  }
  return set;
}

function render(spec) {
  const lang = spec.lang;
  const rtl = lang === "ur";
  const urduNums = spec.urduDigits === true || (rtl && spec.urduDigits !== false);
  const nf = (v) => (urduNums ? toUrduDigits(String(v)) : String(v));

  const barsIn =
    Array.isArray(spec.bars) && spec.bars.length ? spec.bars : [{ parts: 4, shaded: 3 }];
  const bars = barsIn.map((b, i) => {
    const src = b && typeof b === "object" ? b : {};
    const parts = Math.max(1, Math.min(24, Math.round(fin(src.parts, 4))));
    return {
      parts,
      shaded: shadedSet(src.shaded, parts),
      label: src.label,
      value: src.value,
      color: src.color,
      partLabels: Array.isArray(src.partLabels) ? src.partLabels : null,
      i,
    };
  });

  const unitMode = spec.model === "unit" || !!spec.unitLabel;
  const anyName = bars.some((b) => b.label);
  // In unit mode the brace and the unit label carry the numbers, so the value
  // gutter only opens if a bar asked for one by name.
  const anyValue = bars.some((b) => b.value !== undefined && b.value !== "");
  const showValues =
    spec.showLabels === true ? true : spec.showLabels === false ? false : unitMode ? anyValue : true;

  const bodyW = fin(spec.width, 640);
  const barH = fin(spec.barHeight, bars.length > 4 ? 36 : 46);
  const gap = fin(spec.gap, 16);
  const pad = 6;

  // Gutters. An Urdu box that runs off the left edge is clipped away by the
  // viewBox, so the name gutter is sized generously and passed as an explicit
  // box width to every Urdu label.
  const nameW = anyName ? fin(spec.labelWidth, rtl ? 128 : 108) : 0;
  const valueW = showValues ? fin(spec.valueWidth, rtl ? 92 : 74) : 0;
  const braceW = unitMode && bars.length > 1 ? fin(spec.braceWidth, rtl ? 120 : 104) : 0;

  // LTR: names left | bars | values | brace.   Urdu mirrors the whole row.
  const leftW = rtl ? valueW + braceW : nameW;
  const rightW = rtl ? nameW : valueW + braceW;
  const barW = Math.max(80, bodyW - pad * 2 - leftW - rightW);
  const barX = pad + leftW;

  const unitBraceH = unitMode && spec.unitLabel ? 38 : 0;
  const bodyH = bars.length * barH + (bars.length - 1) * gap + 8 + unitBraceH;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang,
    spec,
  });

  const maxParts = Math.max(...bars.map((b) => b.parts));
  const unitW = barW / maxParts;
  const palette = [C.accent, C.cool, C.leaf, C.plum, C.clay, C.teal];

  let y = 4;
  const rows = [];
  bars.forEach((b) => {
    const color = b.color || palette[b.i % palette.length];
    const w = unitMode ? unitW * b.parts : barW;
    // Bars grow away from the side the reader starts on, so in Urdu a shorter
    // bar still begins at the shared right-hand edge.
    const bx = rtl && unitMode ? barX + (barW - w) : barX;
    const segW = w / b.parts;

    for (let k = 0; k < b.parts; k++) {
      const idx = rtl ? b.parts - 1 - k : k; // k counts from the reader's start
      const isOn = b.shaded.has(k);
      svg.rect(bx + idx * segW, y, segW, barH, {
        fill: isOn ? color : C.panel,
        opacity: isOn ? 0.88 : 1,
        stroke: C.ink,
        sw: 1.1,
      });
      if (b.partLabels && b.partLabels[k]) {
        lab(svg, bx + idx * segW + segW / 2, y + barH / 2, b.partLabels[k], {
          size: SIZE.tiny,
          align: "center",
          baseline: "middle",
          fill: isOn ? C.paper : C.text,
          weight: 700,
          w: Math.max(20, segW - 4),
        });
      }
    }
    svg.rect(bx, y, w, barH, { fill: "none", stroke: C.ink, sw: 1.9, rx: 2 });

    if (b.label) {
      const nx = rtl ? barX + barW + 12 : barX - 12;
      lab(svg, nx, y + barH / 2, b.label, {
        size: SIZE.label,
        align: rtl ? "left" : "right",
        baseline: "middle",
        weight: 700,
        fill: C.ink,
        w: nameW - 14,
      });
    }
    if (showValues) {
      const val =
        b.value !== undefined
          ? b.value
          : unitMode
          ? nf(b.parts)
          : `${nf(b.shaded.size)}/${nf(b.parts)}`;
      const vx = rtl ? barX - 12 : barX + barW + 12;
      lab(svg, vx, y + barH / 2, val, {
        size: SIZE.label,
        align: rtl ? "right" : "left",
        baseline: "middle",
        weight: 700,
        fill: C.ink,
        w: valueW - 14,
      });
    }
    rows.push({ y, bx, w, segW, color });
    y += barH + gap;
  });

  const lastY = y - gap;

  /* ---- the total brace, outermost, in unit mode ---- */
  if (braceW) {
    const totalParts = bars.reduce((s, b) => s + b.parts, 0);
    const totalLabel =
      spec.totalLabel ||
      (spec.unitLabel ? `${nf(totalParts)} × ${spec.unitLabel}` : `${nf(totalParts)} units`);
    const dir = rtl ? -1 : 1;
    const bxStart = rtl ? pad + braceW : bodyW - pad - braceW;
    const tip = brace(svg, bxStart, 4, lastY, dir, C.ink);
    lab(svg, tip + dir * 14, (4 + lastY) / 2, totalLabel, {
      size: SIZE.small,
      align: rtl ? "right" : "left",
      baseline: "middle",
      weight: 700,
      fill: C.ink,
      w: braceW - 30,
    });
  }

  /* ---- one unit, named, under the reader-side segment of the first bar ---- */
  if (unitMode && spec.unitLabel && rows.length) {
    const r0 = rows[0];
    const k0 = rtl ? r0.bx + r0.w - r0.segW : r0.bx;
    const tipY = braceUnder(svg, k0, k0 + r0.segW, lastY + 4, C.muted);
    lab(svg, k0 + r0.segW / 2, tipY + SIZE.small * 0.95, spec.unitLabel, {
      size: SIZE.small,
      align: "center",
      weight: 700,
      fill: C.muted,
    });
  }

  return svg.toString();
}

module.exports = {
  type: "fraction_bar",
  aliases: ["bar_model", "tape_diagram"],
  summary:
    "Part-whole bars — one bar, an equivalent-fraction comparison on a shared whole, or a Singapore unit bar model with a total brace.",
  render,
  examples: [
    {
      name: "fraction_bar_three_eighths",
      spec: {
        type: "fraction_bar",
        bars: [{ parts: 8, shaded: 3, label: "Shaded", color: C.accent }],
        title: "Three eighths of one whole",
        caption: "The whole is cut into 8 equal parts; 3 of them are shaded.",
      },
    },
    {
      name: "fraction_bar_compare",
      spec: {
        type: "fraction_bar",
        showLabels: false,
        barHeight: 40,
        bars: [
          { parts: 3, shaded: 2, label: "2/3", color: C.cool },
          { parts: 4, shaded: 3, label: "3/4", color: C.leaf },
          { parts: 12, shaded: 8, label: "2/3 = 8/12", color: C.cool },
          { parts: 12, shaded: 9, label: "3/4 = 9/12", color: C.leaf },
        ],
        title: "Which is bigger — 2/3 or 3/4?",
        caption:
          "Same whole, different cuts. Rewritten over twelfths the answer is visible: 9/12 beats 8/12.",
      },
    },
    {
      name: "fraction_bar_model_ur",
      spec: {
        type: "fraction_bar",
        bars: [
          { parts: 5, shaded: 5, label: "علی", color: C.cool },
          { parts: 3, shaded: 3, label: "ثمینہ", color: C.accent },
        ],
        unitLabel: "۴۰ روپے",
        totalLabel: "کل ۳۲۰ روپے",
        lang: "ur",
        title: "بار ماڈل: علی اور ثمینہ کے پیسے",
        caption: "ہر خانہ چالیس روپے کا ہے۔ علی کے پاس پانچ خانے، ثمینہ کے پاس تین۔",
      },
    },
  ],
};
