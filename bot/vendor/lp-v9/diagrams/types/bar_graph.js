// bar_graph — a primary-school bar graph: one upright bar per category on a labelled, numbered scale.
//
// bd-yggj4o.1 (Amena, 8 Oct: "pictures for Maths - we should create them, words wont do"). G2 ch15 asks
// children to READ a bar graph and to DRAW one from tally data. `graph` plots functions of x and has no
// category axis, so both items printed as words. `blank: true` draws the same axes, scale and category
// names with no bars: the "draw the bars" space, already labelled.
//
// Spec
//   categories  1-8 names along the bottom (left to right; reversed for lang "ur")
//   values      one whole number per category (omit with blank: true)
//   yMax        top of the scale; yStep (default 1) spaces its numbers and grid lines
//   xLabel, yLabel  REQUIRED, like graph's: an unlabelled graph cannot be read
//   blank, lang ("en" | "ur")

const { Svg, C, SIZE } = require("../lib/svg");

const BAR_W = 46;
const SLOT = 86;
const UNIT_MAX = 26; // px per scale unit, shrunk for tall scales
const PLOT_H_MAX = 220;

function check(spec) {
  const cats = Array.isArray(spec.categories) ? spec.categories : [];
  if (cats.length < 1 || cats.length > 8) throw new Error("bar_graph: needs 1-8 categories");
  if (!spec.xLabel || !spec.yLabel) throw new Error("bar_graph: xLabel and yLabel are required");
  const yMax = Number(spec.yMax);
  if (!(yMax > 0)) throw new Error("bar_graph: yMax must be a positive number");
  if (!spec.blank) {
    const v = Array.isArray(spec.values) ? spec.values : [];
    if (v.length !== cats.length) throw new Error("bar_graph: needs one value per category");
    v.forEach((x, i) => {
      if (!(x >= 0)) throw new Error(`bar_graph: value for ${cats[i]} must be 0 or more`);
      if (x > yMax) throw new Error(`bar_graph: value ${x} for ${cats[i]} is above yMax ${yMax}`);
    });
  }
  return { cats, yMax };
}

function render(spec) {
  const { cats, yMax } = check(spec);
  const ur = spec.lang === "ur";
  const step = Number(spec.yStep) > 0 ? Number(spec.yStep) : 1;
  const unit = Math.min(UNIT_MAX, PLOT_H_MAX / yMax);
  const plotH = unit * yMax;
  const plotW = SLOT * cats.length;
  const L = 74, TOP = 22, BOTTOM = 70;
  const bodyW = L + plotW + 24;
  const bodyH = TOP + plotH + BOTTOM;
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note, lang: ur ? "ur" : "en", spec,
  });
  const x0 = L, y0 = TOP + plotH;

  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const y = y0 - v * unit;
    if (v > 0) svg.line(x0, y, x0 + plotW, y, { stroke: C.rule, sw: 1 });
    svg.text(x0 - 8, y + 5, String(+v.toFixed(2)), { size: SIZE.small, anchor: "end", fill: C.ink });
  }
  const order = cats.map((c, i) => i);
  if (ur) order.reverse();
  order.forEach((i, slot) => {
    const cx = x0 + SLOT * slot + SLOT / 2;
    if (!spec.blank) {
      const h = spec.values[i] * unit;
      svg.add(`<rect data-bar="${String(cats[i]).replace(/"/g, "&quot;")}" x="${(cx - BAR_W / 2).toFixed(1)}" y="${(y0 - h).toFixed(1)}" width="${BAR_W}" height="${h.toFixed(1)}" fill="${C.cool}" stroke="${C.ink}" stroke-width="1.2"/>`);
    }
    svg.text(cx, y0 + 20, cats[i], { size: SIZE.small, anchor: "middle", fill: C.ink });
  });
  svg.line(x0, TOP - 6, x0, y0, { stroke: C.ink, sw: 2 });
  svg.line(x0, y0, x0 + plotW, y0, { stroke: C.ink, sw: 2 });
  svg.text(x0 + plotW / 2, y0 + 50, spec.xLabel, { size: SIZE.label, weight: 700, anchor: "middle", fill: C.ink });
  const ym = TOP + plotH / 2;
  svg.text(18, ym, spec.yLabel, { size: SIZE.label, weight: 700, anchor: "middle", fill: C.ink, transform: `rotate(-90 18 ${ym})` });
  return svg.toString();
}

module.exports = {
  type: "bar_graph",
  aliases: ["bar_chart", "column_graph"],
  summary: "A bar graph: one upright bar per category on a labelled, numbered scale; blank:true for a draw-the-bars item.",
  render,
  examples: [
    {
      name: "bar_graph_fruit",
      spec: { type: "bar_graph", categories: ["Orange", "Apple", "Kiwi", "Banana"], values: [4, 2, 3, 5], yMax: 6,
        xLabel: "Fruit", yLabel: "Children" },
    },
    {
      name: "bar_graph_blank",
      spec: { type: "bar_graph", categories: ["Orange", "Apple", "Kiwi", "Banana"], blank: true, yMax: 6,
        xLabel: "Fruit", yLabel: "Children" },
    },
  ],
};
