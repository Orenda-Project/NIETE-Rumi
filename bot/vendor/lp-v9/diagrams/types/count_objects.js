// count_objects — n pictures of a thing, laid out to be counted or compared.
//
// The counting instrument for grades K-2, and the comparison instrument
// ("which row has more?") right after it. A number line shows a child WHERE a
// number is; this shows them WHAT a number is, which is the earlier lesson and
// the one the engine had nothing for.
//
// Three shapes of question, one type:
//
//   count      one row set of one thing            {picto:"apple", count:7}
//   compare    two or more rows, one thing each    {rows:[{picto:"apple",count:4},…]}
//   group      the same n, ringed into equal lots  {picto:"apple", count:12, group:4}
//              — this is the division/multiplication picture: 12 in 3 rings of 4.
//
// THE ANSWER IS NEVER WRITTEN. There is no count label, no total, no legend:
// the child counts. A row may carry a NAME (`label`) when the question compares
// named things, and the label gate upstream throws away a name the question
// does not use.
//
// ONE AND ZERO (NIETE divergence, SYNC.md 3.23). A grade 1 lesson on the
// numbers 0 to 4 counts one car and shows zero as an empty circle: those ARE
// its quantities. A count of 1 draws one thing. A count of 0 draws an empty,
// dashed tray where the things would be — the empty set, so a child sees
// "nothing here" rather than a picture that failed to load. Whether one thing
// is a COUNT (not a vocabulary prompt wearing a counting type) depends on the
// question, which this type never sees; the caller checks that.
//
// Spec
//   picto    "apple"          the pictogram (lib/pictogram.js) — or per row
//   count    7                how many (0 to 30; 0 is an empty tray)
//   rows     [{picto,count,label,color}]  compare mode; overrides picto/count.
//            `color` (ink, accent, leaf, cool, warn, plum, clay) draws that row's
//            things in its own colour, so a PART of a set can be seen — "the
//            coloured pencils" (NIETE divergence, SYNC.md 3.22)
//   perRow   5                items per line (default: min(5, count); min(10, widest) when comparing rows)
//   group    4                ring every `group` items (single-row specs only)
//   lang     "en" | "ur"

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { drawPictogram, descLine, has: hasPictogram, inner: pictogramInner } = require("../lib/pictogram");

const MAX_ITEMS = 30; // past this a child stops counting and starts guessing
const ROW_TOKENS = { ink: C.ink, accent: C.accent, leaf: C.leaf, cool: C.cool, warn: C.warn, plum: C.plum, clay: C.clay };

function render(spec) {
  const isUr = spec.lang === "ur";
  const rows = (Array.isArray(spec.rows) && spec.rows.length
    ? spec.rows
    : [{ picto: spec.picto, count: spec.count, label: spec.label }]
  ).map((r) => ({
    picto: String(r.picto ?? spec.picto ?? ""),
    // A count that is not a number is NOT zero: only an explicit 0 draws the
    // empty tray. (Before 3.23 a missing count became 0 and failed the floor.)
    count: r.count === "" || r.count == null || !Number.isFinite(Number(r.count)) ? NaN : Math.floor(Number(r.count)),
    label: r.label == null ? "" : String(r.label),
    color: (r.color && ROW_TOKENS[String(r.color)]) || C.ink,
  }));
  if (!rows.length) throw new Error("count_objects: nothing to count");
  rows.forEach((r) => {
    if (!r.picto) throw new Error("count_objects: every row needs a `picto`");
    if (!hasPictogram(r.picto)) {
      try { pictogramInner(r.picto); } catch (e) { throw new Error(`count_objects: ${e.message}`); }
    }
    if (!Number.isFinite(r.count)) throw new Error(`count_objects: "${r.picto}" needs a \`count\` — a whole number from 0 to ${MAX_ITEMS}`);
    if (r.count < 0) throw new Error(`count_objects: "${r.picto}" has a count of ${r.count}; a count is 0 or more`);
    if (r.count > MAX_ITEMS) throw new Error(`count_objects: ${r.count} items is past counting; keep it to ${MAX_ITEMS}`);
  });

  const CELL = spec.cellSize ?? 84;
  const PAD = 18;
  const LGAP = 16;                 // gutter between a row's name and its things
  const group = rows.length === 1 && rows[0].count > 0 && Number(spec.group) > 1 ? Math.floor(Number(spec.group)) : 0;
  // VENDOR DIVERGENCE — see SYNC.md §3.18. Rows being COMPARED stay on one line
  // each (up to ten): wrapping a row of six at five put its sixth thing on a
  // line of its own with no name, and "which row has more?" was drawn as three
  // rows. A single row still wraps at five, which is how a child counts it.
  const widest = Math.max(...rows.map((r) => r.count));
  const perRow = group
    ? group
    : Math.max(1, Math.floor(Number(spec.perRow) || Math.min(rows.length > 1 ? 10 : 5, widest)));

  const labelSize = SIZE.label * 1.5;
  const labelW = Math.max(
    0,
    ...rows.map((r) => (r.label ? measure(r.label, labelSize, { lang: hasUrdu(r.label) ? "ur" : "en" }) * 1.3 + labelSize : 0))
  );
  const gutter = labelW ? labelW + LGAP : 0;

  // One LINE per `perRow` items; a row with more items than perRow wraps. An
  // empty row (count 0) is one line holding an empty tray TRAY_CELLS wide — or
  // as wide as the widest row it is compared with, so "none" sits where the
  // things would be.
  const TRAY_CELLS = 3;
  const lines = [];
  rows.forEach((r, ri) => {
    if (r.count === 0) { lines.push({ ri, picto: r.picto, n: 0, first: true, empty: true }); return; }
    for (let i = 0; i < r.count; i += perRow) {
      lines.push({ ri, picto: r.picto, n: Math.min(perRow, r.count - i), first: i === 0 });
    }
  });
  const trayCells = Math.max(TRAY_CELLS, ...lines.filter((l) => !l.empty).map((l) => l.n));
  const wide = Math.max(...lines.map((l) => (l.empty ? trayCells : l.n)));
  const RING = group ? 12 : 0; // breathing room inside a group ring
  const lineH = CELL + (group ? RING * 2 + 10 : 12);
  const bodyW = PAD * 2 + gutter + wide * CELL + (group ? RING * 2 : 0);
  const bodyH = PAD * 2 + lines.length * lineH;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: isUr ? "ur" : "en", spec,
  });
  svg.add(`<desc>${descLine()}</desc>`);

  // A row is read from the side its language starts on: an Urdu row runs
  // right-to-left with its name on the right, and the things march leftwards.
  // A counting picture laid out the wrong way is not merely untidy — the child
  // counts against the direction they read, and the name ends up trailing the
  // things it names.
  lines.forEach((line, li) => {
    const y = PAD + li * lineH;
    const runW = (line.empty ? trayCells : line.n) * CELL;
    const x0 = isUr
      ? bodyW - PAD - gutter - (group ? RING : 0) - runW
      : PAD + gutter + (group ? RING : 0);
    if (line.empty) {
      // The empty set: a dashed tray with nothing in it. Dashed and unfilled,
      // so it reads as a place for things, never as a thing to be counted.
      // Inset like a pictogram in its cell, so it keeps clear of the row's name.
      svg.rect(x0 + 12, y + 10, runW - 24, CELL - 18, {
        rx: 18, fill: "none", stroke: C.ink, sw: 2.6, dash: "12 9",
      });
    }
    if (group) {
      // The ring is an UNFILLED rect: measure.js reads that as four lines, not
      // as a box, so it can never be mistaken for a label-bearing panel.
      svg.rect(x0 - RING, y - RING + 4, runW + RING * 2, CELL + RING * 2 - 8, {
        rx: 16, fill: "none", stroke: C.accent, sw: 2.2,
      });
    }
    for (let i = 0; i < line.n; i += 1) {
      drawPictogram(svg, x0 + i * CELL, y + 6, CELL - 10, line.picto, { color: rows[line.ri].color });
    }
    const row = rows[line.ri];
    if (row.label && line.first) {
      // The name sits in its own gutter, clear of the things and of any ring.
      svg.text(isUr ? bodyW - PAD : PAD, y + CELL / 2, row.label, {
        size: labelSize, weight: 600, anchor: isUr ? "end" : "start", baseline: "middle", fill: C.ink,
      });
    }
  });

  return svg.toString();
}

module.exports = {
  type: "count_objects",
  aliases: ["counting", "pictograph_count", "count_pictures"],
  summary: "N pictograms of one thing (or two rows to compare, or equal rings for grouping) — counting, comparing, sharing.",
  render,
  examples: [
    { name: "count_objects_apples_en", spec: { type: "count_objects", picto: "apple", count: 7 } },
    { name: "count_objects_compare_ur", spec: { type: "count_objects", lang: "ur", rows: [{ picto: "apple", count: 5, label: "سیب" }, { picto: "banana", count: 3, label: "کیلے" }] } },
    { name: "count_objects_groups_en", spec: { type: "count_objects", picto: "star", count: 12, group: 4 } },
    { name: "count_objects_one_en", spec: { type: "count_objects", picto: "car", count: 1 } },
    { name: "count_objects_zero_ur", spec: { type: "count_objects", lang: "ur", picto: "counter", count: 0 } },
    { name: "count_objects_compare_zero_ur", spec: { type: "count_objects", lang: "ur", rows: [{ picto: "star", count: 3, label: "رات" }, { picto: "star", count: 0, label: "دن" }] } },
  ],
};
