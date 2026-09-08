// compare_size — longer/shorter, taller/shorter, heavier/lighter.
//
// The Grade 1 "Long, Longer, Longest" and "Heavy, Heavier, Heaviest" chapters
// are a picture question with no counting in it, and count_objects renders the
// picture but asks the wrong question with it. Three models, one type:
//
//   length (default)  horizontal bars of different length, stacked
//   height            vertical bars of different height, side by side
//   balance           a balance scale with things on the two pans, tilted by
//                     the side that carries more
//
// The MEASUREMENT IS NEVER PRINTED. Each item carries a NAME, never a number:
// the moment a bar says "12 cm" the child reads instead of comparing, and the
// question stops being about the picture. `label` is the item's name and the
// upstream label gate throws away a name the question does not use.
//
// The balance model tilts from the pan LOADS, not from an author's `tilt` — an
// author who writes a tilt that contradicts the loads has drawn a lie, and this
// type will not draw one.
//
// Spec
//   model  "length" | "height" | "balance"
//   items  [{label:"ربن", size:3, color:"cool"}, …]  2-3 items; `size` is a
//          RELATIVE quantity, never a printed value; `color` is optional and is
//          one of ink | accent | leaf | cool | warn | plum | clay
//   left / right  [{picto:"apple", count:3}] | {label, size}   balance model
//   lang   "en" | "ur"

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { drawPictogram, descLine, has: hasPictogram } = require("../lib/pictogram");

// One colour for every bar unless the author names one. A cycling palette put a
// NAVY bar next to the label "سرخ ربن" (red ribbon) and a GREEN bar next to
// "نیلا ربن" (blue ribbon): the drawing contradicted its own labels, in a
// lesson whose whole point can be colour. Colour here is decoration, and
// decoration may never disagree with the words.
const BAR_TOKENS = { ink: C.ink, accent: C.accent, leaf: C.leaf, cool: C.cool, warn: C.warn, plum: C.plum, clay: C.clay };

function items(spec) {
  const list = (Array.isArray(spec.items) ? spec.items : []).map((it) => ({
    label: it && it.label != null ? String(it.label) : "",
    size: Number(it && it.size),
    color: it && it.color ? String(it.color) : null,
  }));
  if (list.length < 2) throw new Error("compare_size: at least 2 things are needed to compare");
  if (list.length > 3) throw new Error("compare_size: more than 3 things is a sorting exercise, not a comparison");
  list.forEach((it) => {
    if (!Number.isFinite(it.size) || it.size <= 0) throw new Error("compare_size: every item needs a positive `size`");
  });
  if (new Set(list.map((it) => it.size)).size === 1) {
    throw new Error("compare_size: every thing is the same size — there is nothing to compare");
  }
  return list;
}

function renderBars(spec, vertical) {
  const isUr = spec.lang === "ur";
  const list = items(spec);
  const max = Math.max(...list.map((i) => i.size));
  const LONG = spec.span ?? 420;   // the longest bar
  const THICK = spec.thickness ?? 54;
  const GAP = 26;
  const PAD = 18;
  const labelSize = Math.max(SIZE.label * 1.3, 20);
  const labelled = list.some((i) => i.label);
  const gutter = labelled
    ? Math.ceil(Math.max(...list.map((i) => (i.label ? measure(i.label, labelSize, { lang: hasUrdu(i.label) ? "ur" : "en" }) * 1.35 + labelSize : 0)))) + 14
    : 0;

  let bodyW;
  let bodyH;
  if (vertical) {
    bodyW = PAD * 2 + list.length * THICK + (list.length - 1) * GAP;
    bodyH = PAD * 2 + LONG + (labelled ? labelSize * 2.4 : 0);
  } else {
    bodyW = PAD * 2 + gutter + LONG;
    bodyH = PAD * 2 + list.length * THICK + (list.length - 1) * GAP;
  }
  // The name gutter sits on the side the language starts from, and every bar
  // grows AWAY from it off one shared baseline. In Urdu that is the right-hand
  // side: names down the right, bars running leftwards.
  const baseX = isUr ? bodyW - PAD - gutter : PAD + gutter;
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: isUr ? "ur" : "en", spec,
  });

  list.forEach((it, i) => {
    const len = (it.size / max) * LONG;
    const fill = (it.color && BAR_TOKENS[it.color]) || C.accent;
    if (vertical) {
      const x = PAD + i * (THICK + GAP);
      const y = PAD + (LONG - len);
      svg.rect(x, y, THICK, len, { rx: 5, fill, stroke: C.ink, sw: 1.6 });
      if (it.label) {
        svg.text(x + THICK / 2, PAD + LONG + labelSize * 1.5, it.label, {
          size: labelSize, weight: 600, anchor: "middle", fill: C.ink,
        });
      }
    } else {
      const y = PAD + i * (THICK + GAP);
      // The bars all start from the same edge — a comparison of lengths that do
      // not share a baseline compares nothing.
      const x = isUr ? baseX - len : baseX;
      svg.rect(x, y, len, THICK, { rx: 5, fill, stroke: C.ink, sw: 1.6 });
      if (it.label) {
        svg.text(isUr ? baseX + 14 : baseX - 14, y + THICK / 2, it.label, {
          size: labelSize, weight: 600, anchor: isUr ? "start" : "end", baseline: "middle", fill: C.ink,
        });
      }
    }
  });
  return svg.toString();
}

function pan(spec, side) {
  const raw = spec[side];
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (!entry) throw new Error(`compare_size: the balance model needs \`${side}\``);
  const picto = entry.picto ? String(entry.picto) : null;
  if (picto && !hasPictogram(picto)) throw new Error(`compare_size: unknown pictogram "${picto}"`);
  const count = Math.max(1, Math.floor(Number(entry.count) || 1));
  const load = Number.isFinite(Number(entry.size)) ? Number(entry.size) : count;
  return { picto, count, load, label: entry.label == null ? "" : String(entry.label) };
}

function renderBalance(spec) {
  const L = pan(spec, "left");
  const R = pan(spec, "right");
  if (L.load === R.load && spec.allowEqual !== true) {
    throw new Error("compare_size: both pans carry the same load — set allowEqual:true if the balance is the point");
  }
  const PAD = 20;
  const BEAM = 400;
  const PANW = 190;
  const ITEM = 62;
  const HANG = 54;
  // The body must clear HALF A PAN past each end of the beam. It did not, and
  // the left-hand pan (and one of the things on it) was drawn outside the
  // viewBox and silently clipped — the one defect a collision check cannot see,
  // because nothing collided.
  const bodyW = PAD * 2 + BEAM + PANW;
  const bodyH = PAD * 2 + 340;
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: spec.lang === "ur" ? "ur" : "en", spec,
  });
  if (L.picto || R.picto) svg.add(`<desc>${descLine()}</desc>`);

  const cx = bodyW / 2;
  const beamY = PAD + 132;          // the pivot
  const baseY = PAD + 320;
  // The beam tilts TOWARD the heavier pan, by a fixed angle rather than a
  // proportional one: a proportional tilt invites a child to read a quantity
  // off an angle, which is not something this picture can honestly say.
  const drop = L.load === R.load ? 0 : 30;
  const dir = L.load > R.load ? 1 : -1;
  const lx = cx - BEAM / 2;
  const rx = cx + BEAM / 2;
  const ly = beamY + dir * drop;
  const ry = beamY - dir * drop;

  // stand and base
  svg.polygon([[cx, beamY], [cx - 44, baseY], [cx + 44, baseY]], { fill: "none", stroke: C.ink, sw: 3.2 });
  svg.line(cx - 74, baseY, cx + 74, baseY, { stroke: C.ink, sw: 4.5, cap: "round" });
  // beam
  svg.line(lx, ly, rx, ry, { stroke: C.ink, sw: 5, cap: "round" });
  svg.circle(cx, beamY, 9, { fill: C.ink });

  // pans: ONE straight cord down to a shallow bowl. A V of two cords from the
  // beam end to the pan's two lips is what a balance looks like, and it is also
  // a pair of rules running diagonally across whatever is on the pan — the
  // apples read as crossed out. A single cord leaves the load clear.
  const pans = [[lx, ly, L], [rx, ry, R]];
  pans.forEach(([px, py, p]) => {
    const top = py + HANG;
    const half = PANW / 2;
    svg.line(px, py, px, top, { stroke: C.ink, sw: 2.4 });
    svg.path(`M${px - half},${top} Q${px},${top + 40} ${px + half},${top}`, { fill: "none", stroke: C.ink, sw: 3.6, cap: "round" });
    if (!p.picto) return;
    // The things REST on the pan: their feet are on its lip, never floating.
    const n = Math.min(p.count, 3);
    const w = n * ITEM;
    for (let i = 0; i < n; i += 1) {
      drawPictogram(svg, px - w / 2 + i * ITEM, top - ITEM + 8, ITEM, p.picto, { color: C.ink });
    }
  });
  return svg.toString();
}

function render(spec) {
  const model = ["length", "height", "balance"].includes(spec.model) ? spec.model : "length";
  if (model === "balance") return renderBalance(spec);
  return renderBars(spec, model === "height");
}

module.exports = {
  type: "compare_size",
  aliases: ["longer_shorter", "taller_shorter", "heavier_lighter", "balance_scale"],
  summary: "Bars of different length or height, or a balance scale — longer/shorter, taller/shorter, heavier/lighter.",
  render,
  examples: [
    { name: "compare_size_length_ur", spec: { type: "compare_size", lang: "ur", items: [{ label: "سرخ ربن", size: 5 }, { label: "نیلا ربن", size: 3 }, { label: "ہرا ربن", size: 8 }] } },
    { name: "compare_size_height_en", spec: { type: "compare_size", model: "height", items: [{ label: "Ali", size: 4 }, { label: "Sara", size: 5 }] } },
    { name: "compare_size_balance_en", spec: { type: "compare_size", model: "balance", left: { picto: "apple", count: 3 }, right: { picto: "apple", count: 1 } } },
  ],
};
