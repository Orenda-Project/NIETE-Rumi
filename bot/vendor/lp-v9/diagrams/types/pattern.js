// pattern — a repeating sequence with one slot missing. "What comes next?"
//
// The earliest algebra there is: a child who can continue ▲ ● ▲ ● ▲ ? is doing
// the thing that later becomes a rule. It is also the shape of a dozen other
// early-years questions — ordering, "what is missing", skip counting — so the
// items are deliberately polymorphic: a pictogram, a plain shape, or a short
// text (a number, a letter).
//
// The `?` slot is drawn as a dashed empty box with a question mark. It is never
// the answer and never carries a hint.
//
// Spec
//   items  ["circle","square","circle","square","?"]
//          each item is a STRING or an OBJECT:
//            "?"  or {blank:true}          the slot to fill
//            {picto:"apple"}               a pictogram
//            {shape:"circle", color:"accent"}   circle | square | triangle | star
//            {text:"7"}                    a numeral or a letter
//          a bare string resolves in that order: "?" -> shape -> pictogram -> text
//   lang   "en" | "ur"    (ur lays the sequence out right-to-left)

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { drawPictogram, descLine, has: hasPictogram } = require("../lib/pictogram");

const SHAPES = new Set(["circle", "square", "triangle", "star"]);
const COLORS = { ink: C.ink, accent: C.accent, leaf: C.leaf, cool: C.cool, warn: C.warn, plum: C.plum, clay: C.clay };

function resolve(item) {
  if (item && typeof item === "object") {
    if (item.blank === true) return { kind: "blank" };
    if (item.picto) return { kind: "picto", value: String(item.picto), color: item.color };
    if (item.shape) return { kind: "shape", value: String(item.shape).toLowerCase(), color: item.color };
    if (item.text != null) return { kind: "text", value: String(item.text), color: item.color };
    throw new Error(`pattern: an item needs one of blank / picto / shape / text (got ${JSON.stringify(item)})`);
  }
  const s = String(item ?? "").trim();
  if (!s || s === "?" || s === "_") return { kind: "blank" };
  if (SHAPES.has(s.toLowerCase())) return { kind: "shape", value: s.toLowerCase() };
  if (hasPictogram(s)) return { kind: "picto", value: s };
  return { kind: "text", value: s };
}

function drawShape(svg, x, y, s, shape, color) {
  const c = COLORS[color] || C.ink;
  const paint = { fill: "none", stroke: c, sw: 3 };
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s * 0.4;
  if (shape === "circle") return svg.circle(cx, cy, r, paint);
  if (shape === "square") return svg.rect(cx - r, cy - r, r * 2, r * 2, { rx: 4, ...paint });
  if (shape === "triangle") return svg.polygon([[cx, cy - r], [cx + r, cy + r * 0.86], [cx - r, cy + r * 0.86]], paint);
  if (shape === "star") {
    const pts = [];
    for (let i = 0; i < 10; i += 1) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    return svg.polygon(pts, paint);
  }
  throw new Error(`pattern: unknown shape "${shape}" — use ${[...SHAPES].join(", ")}`);
}

function render(spec) {
  const raw = Array.isArray(spec.items) ? spec.items : [];
  if (raw.length < 3) throw new Error("pattern: a pattern needs at least 3 items, one of them the blank");
  if (raw.length > 9) throw new Error("pattern: more than 9 items does not fit a phone");
  const items = raw.map(resolve);
  const blanks = items.filter((i) => i.kind === "blank").length;
  if (!blanks) throw new Error('pattern: nothing is missing — mark the slot to fill with "?"');
  if (blanks === items.length) throw new Error("pattern: every slot is blank — there is no pattern to see");
  items.forEach((i) => {
    if (i.kind === "picto" && !hasPictogram(i.value)) throw new Error(`pattern: unknown pictogram "${i.value}"`);
  });

  const isUr = spec.lang === "ur";
  const CELL = spec.cellSize ?? 96;
  const GAP = 16;
  const PAD = 18;
  const bodyW = PAD * 2 + items.length * CELL + (items.length - 1) * GAP;
  const bodyH = PAD * 2 + CELL;
  const textSize = Math.max(SIZE.big, CELL * 0.46);

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: isUr ? "ur" : "en", spec,
  });
  if (items.some((i) => i.kind === "picto")) svg.add(`<desc>${descLine()}</desc>`);

  items.forEach((item, i) => {
    const slot = isUr ? items.length - 1 - i : i;
    const x = PAD + slot * (CELL + GAP);
    const y = PAD;
    if (item.kind === "blank") {
      svg.rect(x, y, CELL, CELL, { rx: 12, fill: C.paper, stroke: C.accent, sw: 2.8, dash: "7 6" });
      svg.text(x + CELL / 2, y + CELL / 2, "?", {
        size: textSize, weight: 700, anchor: "middle", baseline: "middle", fill: C.accent,
      });
      return;
    }
    if (item.kind === "picto") { drawPictogram(svg, x + 6, y + 6, CELL - 12, item.value, { color: COLORS[item.color] || C.ink }); return; }
    if (item.kind === "shape") { drawShape(svg, x, y, CELL, item.value, item.color); return; }
    const ur = hasUrdu(item.value);
    const w = ur ? Math.max(measure(item.value, textSize, { lang: "ur" }) * 1.25 + textSize, textSize * 3) : 0;
    if (ur && w > CELL) throw new Error(`pattern: the item "${item.value}" is too long for a pattern cell`);
    svg.text(x + CELL / 2, y + CELL / 2, item.value, {
      size: textSize, weight: 700, anchor: "middle", baseline: "middle", fill: COLORS[item.color] || C.ink,
    });
  });
  return svg.toString();
}

module.exports = {
  type: "pattern",
  aliases: ["sequence", "what_comes_next", "pattern_completion"],
  summary: "A repeating sequence of shapes, pictograms or numerals with one slot left blank — what comes next.",
  render,
  examples: [
    { name: "pattern_shapes_en", spec: { type: "pattern", items: ["circle", "square", "circle", "square", "?"] } },
    { name: "pattern_skip_count_en", spec: { type: "pattern", items: [{ text: "2" }, { text: "4" }, { text: "6" }, "?", { text: "10" }] } },
    { name: "pattern_picto_ur", spec: { type: "pattern", lang: "ur", items: [{ picto: "sun" }, { picto: "moon" }, { picto: "sun" }, "?"] } },
  ],
  SHAPES,
};
