// base_ten — a place-value picture: thousands, hundreds, tens and ones as the class builds them.
//
// VENDOR DIVERGENCE — see SYNC.md §3.18 (the type) and §3.20 (the thousands
// place). A type this deployment added; upstream does not have it.
//
// Place value is taught with something the child can hold and TIE: ten loose
// sticks become one bundle, ten bundles one big bundle. The grade 1-5 slide
// scripts draw it on nearly every place-value page — `bundle`, `stick`,
// `bigbundle`, `flat`, `rod` and `cube` together are ~1,000 of their diagram
// tokens — and nothing in the engine could draw it. `count_objects` cannot
// stand in: a place-value picture has a 1 and a 0 in it ("1 hundred", "no
// tens"), and one of something is not something to count.
//
// Two models, the two a Pakistani primary classroom uses:
//
//   bundles (default)  ones are single sticks, a ten is ten sticks tied with a
//                      band, a hundred is a big bundle tied twice, a thousand
//                      is ten big bundles tied into one block (a big bundle's
//                      face with depth: its ten layers show on top and side).
//   blocks             ones are unit cubes, a ten is a rod of ten, a hundred is
//                      a flat of a hundred, a thousand is a cube — ten flats
//                      stacked.
//
// The picture is a PLACE-VALUE MAT: one column per place, headed with the
// place's name, laid out thousands → hundreds → tens → ones from left to right
// in every language — that is the order the digits are written in, Urdu page
// or not. A place that holds nothing is an EMPTY column, never a missing one:
// the zero in 209 is the lesson, and so is the zero in 2014.
//
// THE NUMBER IS NEVER WRITTEN, and neither is any count. The child reads it.
//
// Spec
//   thousands              0..9 (a grade 3-5 four-digit number)
//   hundreds, tens, ones   0..20 each (above 9 is a regrouping picture:
//                          "13 tens" is thirteen bundles); at least one place > 0
//   model     "bundles" | "blocks"                     default bundles
//   places    3 | 4      draw the empty hundreds (3) or thousands (4) column
//                        even when there are none
//   labels    {thousands, hundreds, tens, ones}  the column heads; defaults by `lang`
//   lang      "en" | "ur"

const { Svg, C, SIZE, measure, hasUrdu, n } = require("../lib/svg");

const MAX_PER_PLACE = 20;
// A thousand is the largest piece on the mat; more than nine of them is a
// five-digit number, which no grade 1-5 lesson builds from blocks.
const MAX_BY_PLACE = { thousands: 9 };
const PLACES = ["thousands", "hundreds", "tens", "ones"];
const ROLE = { thousands: "thousand", hundreds: "hundred", tens: "ten", ones: "one" };

// The heads a column carries when the spec names none. The quiz lane always
// passes its own (from its string catalog); these are the lesson-plan lane's.
const DEFAULT_LABELS = {
  en: { thousands: "Thousands", hundreds: "Hundreds", tens: "Tens", ones: "Ones" },
  ur: { thousands: "ہزار", hundreds: "سینکڑے", tens: "دہائیاں", ones: "اکائیاں" },
};

// Every piece of art carries data-ov="skip": its strokes are the drawing, not
// rules crossing a label, and the column heads sit outside every item's box.
const SKIP = 'data-ov="skip"';

/** One item's size and how many sit on a line, per model and place. */
const GEOMETRY = {
  bundles: {
    ones: { w: 9, h: 96, gap: 10, perRow: 5 },
    tens: { w: 46, h: 96, gap: 14, perRow: 5 },
    hundreds: { w: 100, h: 104, gap: 16, perRow: 3 },
    // a big bundle's face (100 x 104) plus the block's depth (DEPTH.bundles)
    thousands: { w: 124, h: 128, gap: 16, perRow: 3 },
  },
  blocks: {
    ones: { w: 16, h: 16, gap: 8, perRow: 5 },
    tens: { w: 16, h: 150, gap: 8, perRow: 10 },
    hundreds: { w: 150, h: 150, gap: 14, perRow: 3 },
    // a flat's face (120 x 120) plus the cube's depth (DEPTH.blocks)
    thousands: { w: 160, h: 160, gap: 14, perRow: 3 },
  },
};

/** How far a thousand's top and side recede, up and to the right (an oblique view). */
const DEPTH = { bundles: 24, blocks: 40 };

// ─── the art ────────────────────────────────────────────────────────────────

function stick(x, y, w, h) {
  return `<rect ${SKIP} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(w / 2)}" fill="${C.clay}" stroke="${C.ink}" stroke-width="1.4"/>`;
}

function band(x, y, w) {
  return `<rect ${SKIP} x="${n(x - 3)}" y="${n(y)}" width="${n(w + 6)}" height="12" rx="3" fill="${C.accent}" stroke="${C.ink}" stroke-width="1.6"/>`;
}

/** Ten sticks side by side, tied once. The sticks show; the tie says "one ten". */
function bundle(x, y, w, h) {
  const parts = [`<rect ${SKIP} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="6" fill="${C.clay}" stroke="${C.ink}" stroke-width="1.8"/>`];
  const step = w / 10;
  for (let k = 1; k < 10; k += 1) {
    parts.push(`<line ${SKIP} x1="${n(x + k * step)}" y1="${n(y + 3)}" x2="${n(x + k * step)}" y2="${n(y + h - 3)}" stroke="${C.ink}" stroke-width="1" stroke-opacity="0.5"/>`);
  }
  parts.push(band(x, y + h * 0.44, w));
  return parts.join("");
}

/** Ten bundles tied together: ten stripes of ten, and two ties. */
function bigBundle(x, y, w, h) {
  const parts = [`<rect ${SKIP} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8" fill="${C.clay}" stroke="${C.ink}" stroke-width="2"/>`];
  const step = w / 10;
  for (let k = 1; k < 10; k += 1) {
    parts.push(`<line ${SKIP} x1="${n(x + k * step)}" y1="${n(y + 3)}" x2="${n(x + k * step)}" y2="${n(y + h - 3)}" stroke="${C.ink}" stroke-width="1.5" stroke-opacity="0.7"/>`);
  }
  for (let k = 0; k < 10; k += 1) {
    const mx = x + (k + 0.5) * step;
    parts.push(`<line ${SKIP} x1="${n(mx)}" y1="${n(y + 6)}" x2="${n(mx)}" y2="${n(y + h - 6)}" stroke="${C.ink}" stroke-width="0.8" stroke-opacity="0.3"/>`);
  }
  parts.push(band(x, y + h * 0.26, w));
  parts.push(band(x, y + h * 0.62, w));
  return parts.join("");
}

/** A block of `cols` x `rows` unit squares: a cube (1x1), a rod (1x10), a flat (10x10). */
function block(x, y, w, h, cols, rows) {
  const parts = [`<rect ${SKIP} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${C.accent}" fill-opacity="0.45" stroke="${C.ink}" stroke-width="1.8"/>`];
  const cw = w / cols;
  const rh = h / rows;
  for (let k = 1; k < cols; k += 1) {
    parts.push(`<line ${SKIP} x1="${n(x + k * cw)}" y1="${n(y)}" x2="${n(x + k * cw)}" y2="${n(y + h)}" stroke="${C.ink}" stroke-width="0.9" stroke-opacity="0.6"/>`);
  }
  for (let k = 1; k < rows; k += 1) {
    parts.push(`<line ${SKIP} x1="${n(x)}" y1="${n(y + k * rh)}" x2="${n(x + w)}" y2="${n(y + k * rh)}" stroke="${C.ink}" stroke-width="0.9" stroke-opacity="0.6"/>`);
  }
  return parts.join("");
}

/**
 * A thousand: a front face with its top and side receding up and to the right,
 * each receding face cut into ten layers — the ten flats (or ten big bundles)
 * the thousand is made of. `face(x, y, w, h)` draws the front.
 */
function thousand(x, y, g, d, face, fill, fillOpacity) {
  const w = g.w - d;
  const h = g.h - d;
  const fy = y + d;                       // the front face's top edge
  const pts = (arr) => arr.map(([px, py]) => `${n(px)},${n(py)}`).join(" ");
  const top = [[x, fy], [x + d, y], [x + d + w, y], [x + w, fy]];
  const side = [[x + w, fy], [x + w + d, y], [x + w + d, y + h], [x + w, fy + h]];
  const parts = [
    `<polygon ${SKIP} points="${pts(top)}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${C.ink}" stroke-width="1.8" stroke-linejoin="round"/>`,
    `<polygon ${SKIP} points="${pts(side)}" fill="${fill}" fill-opacity="${Math.min(1, fillOpacity + 0.2)}" stroke="${C.ink}" stroke-width="1.8" stroke-linejoin="round"/>`,
  ];
  // Ten layers from front to back, on the top and on the side.
  for (let k = 1; k < 10; k += 1) {
    const t = k / 10;
    parts.push(`<line ${SKIP} x1="${n(x + d * t)}" y1="${n(fy - d * t)}" x2="${n(x + w + d * t)}" y2="${n(fy - d * t)}" stroke="${C.ink}" stroke-width="0.8" stroke-opacity="0.55"/>`);
    parts.push(`<line ${SKIP} x1="${n(x + w + d * t)}" y1="${n(fy - d * t)}" x2="${n(x + w + d * t)}" y2="${n(fy + h - d * t)}" stroke="${C.ink}" stroke-width="0.8" stroke-opacity="0.55"/>`);
  }
  parts.push(face(x, fy, w, h));
  return parts.join("");
}

function drawItem(model, place, x, y, g) {
  if (place === "thousands") {
    const d = DEPTH[model];
    return model === "blocks"
      ? thousand(x, y, g, d, (fx, fy, w, h) => block(fx, fy, w, h, 10, 10), C.accent, 0.45)
      : thousand(x, y, g, d, (fx, fy, w, h) => bigBundle(fx, fy, w, h), C.clay, 0.85);
  }
  if (model === "blocks") {
    if (place === "hundreds") return block(x, y, g.w, g.h, 10, 10);
    if (place === "tens") return block(x, y, g.w, g.h, 1, 10);
    return block(x, y, g.w, g.h, 1, 1);
  }
  if (place === "hundreds") return bigBundle(x, y, g.w, g.h);
  if (place === "tens") return bundle(x, y, g.w, g.h);
  return stick(x, y, g.w, g.h);
}

// ─── the mat ────────────────────────────────────────────────────────────────

function count(v, place) {
  if (v === undefined || v === null || v === "") return 0;
  const k = Number(v);
  if (!Number.isInteger(k) || k < 0) throw new Error(`base_ten: \`${place}\` must be a whole number, got ${JSON.stringify(v)}`);
  const max = MAX_BY_PLACE[place] || MAX_PER_PLACE;
  if (k > max) throw new Error(`base_ten: ${k} ${place} is past what a child can read off a mat; keep ${place} to ${max}`);
  return k;
}

function render(spec) {
  const isUr = spec.lang === "ur";
  const model = spec.model === "blocks" ? "blocks" : "bundles";
  const counts = {};
  PLACES.forEach((p) => { counts[p] = count(spec[p], p); });
  if (!PLACES.some((p) => counts[p] > 0)) throw new Error("base_ten: nothing to show — give at least one of thousands, hundreds, tens or ones");

  // Columns: tens and ones always (a lone "7" is still 0 tens and 7 ones), and
  // every place from the highest the number has — or the one `places` asks
  // for — down: 2014 keeps an EMPTY hundreds column under its thousands.
  const places = Number(spec.places);
  const first = counts.thousands > 0 || places >= 4 ? 0
    : counts.hundreds > 0 || places === 3 ? 1 : 2;
  const cols = PLACES.slice(first);

  const heads = { ...DEFAULT_LABELS[isUr ? "ur" : "en"], ...((spec.labels && typeof spec.labels === "object") ? spec.labels : {}) };
  // The heads are the mat's only text, so they carry its legibility: at 1.4 a four-place blocks
  // mat (1310 wide) put them at 7.05px on the phone, under the 8.74px floor. 1.75 gives 8.82px
  // there and widens no other mat past the floor (bd-oak77.15).
  const headSize = SIZE.label * 1.75;
  const headW = (s) => measure(String(s), headSize, { lang: hasUrdu(String(s)) ? "ur" : "en" }) * (hasUrdu(String(s)) ? 1.3 : 1.05);
  const headH = headSize * (isUr ? 2.2 : 1.5);
  const PADC = 16;       // inside a column's panel
  const COLGAP = 20;     // between panels
  const PAD = 14;        // around the mat
  const ROWGAP = 14;

  const layout = cols.map((place) => {
    const g = GEOMETRY[model][place];
    const k = counts[place];
    const perLine = Math.min(g.perRow, Math.max(1, k));
    const lines = Math.max(1, Math.ceil(k / g.perRow));
    const itemsW = perLine * g.w + (perLine - 1) * g.gap;
    const innerW = Math.max(itemsW, g.w * 2, headW(heads[place]));
    return {
      place, g, k, perLine, lines, itemsW, w: innerW + PADC * 2, h: lines * g.h + (lines - 1) * ROWGAP,
    };
  });
  const panelH = Math.max(...layout.map((c) => c.h)) + PADC * 2;
  const bodyW = PAD * 2 + layout.reduce((a, c) => a + c.w, 0) + (layout.length - 1) * COLGAP;
  const bodyH = PAD * 2 + headH + 8 + panelH;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: isUr ? "ur" : "en", spec,
  });

  let x = PAD;
  const top = PAD + headH + 8;
  layout.forEach((c) => {
    svg.text(x + c.w / 2, PAD + headH / 2, heads[c.place], {
      size: headSize, weight: 700, anchor: "middle", baseline: "middle", fill: C.ink,
    });
    svg.rect(x, top, c.w, panelH, { rx: 12, fill: C.panel, stroke: C.rule, sw: 1.6 });
    const items = [];
    for (let i = 0; i < c.k; i += 1) {
      const line = Math.floor(i / c.g.perRow);
      const pos = i % c.g.perRow;
      const onLine = Math.min(c.g.perRow, c.k - line * c.g.perRow);
      const lineW = onLine * c.g.w + (onLine - 1) * c.g.gap;
      const ix = x + (c.w - lineW) / 2 + pos * (c.g.w + c.g.gap);
      // Items sit at the bottom of the panel, as they would on a desk, so a
      // short column (two sticks) lines up with a tall one (nine bundles).
      const iy = top + panelH - PADC - (c.lines - line) * c.g.h - (c.lines - line - 1) * ROWGAP;
      items.push(`<g data-bt="${ROLE[c.place]}">${drawItem(model, c.place, ix, iy, c.g)}</g>`);
    }
    if (items.length) svg.add(`<g data-model="${model}">${items.join("")}</g>`);
    x += c.w + COLGAP;
  });
  return svg.toString();
}

module.exports = {
  type: "base_ten",
  aliases: ["place_value", "base_ten_blocks", "bundles"],
  summary: "A place-value mat — thousands, hundreds, tens and ones as bundles of sticks or as cubes, flats, rods and unit cubes; the number is never written.",
  render,
  examples: [
    { name: "base_ten_bundles_342_en", spec: { type: "base_ten", hundreds: 3, tens: 4, ones: 2 } },
    { name: "base_ten_bundles_209_ur", spec: { type: "base_ten", hundreds: 2, tens: 0, ones: 9, lang: "ur" } },
    { name: "base_ten_blocks_136_en", spec: { type: "base_ten", model: "blocks", hundreds: 1, tens: 3, ones: 6 } },
    { name: "base_ten_blocks_1986_en", spec: { type: "base_ten", model: "blocks", thousands: 1, hundreds: 9, tens: 8, ones: 6 } },
    { name: "base_ten_bundles_2014_ur", spec: { type: "base_ten", thousands: 2, hundreds: 0, tens: 1, ones: 4, lang: "ur" } },
  ],
};
