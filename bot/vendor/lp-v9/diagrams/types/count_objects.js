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
// Spec
//   picto    "apple"          the pictogram (lib/pictogram.js) — or per row
//   count    7                how many
//   rows     [{picto,count,label}]  compare mode; overrides picto/count
//   perRow   5                items per line (default: min(5, count))
//   group    4                ring every `group` items (single-row specs only)
//   lang     "en" | "ur"

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { drawPictogram, descLine, has: hasPictogram, names: pictogramNames } = require("../lib/pictogram");

const MAX_ITEMS = 30; // past this a child stops counting and starts guessing

function render(spec) {
  const isUr = spec.lang === "ur";
  const rows = (Array.isArray(spec.rows) && spec.rows.length
    ? spec.rows
    : [{ picto: spec.picto, count: spec.count, label: spec.label }]
  ).map((r) => ({
    picto: String(r.picto ?? spec.picto ?? ""),
    count: Math.max(0, Math.floor(Number(r.count) || 0)),
    label: r.label == null ? "" : String(r.label),
  }));
  if (!rows.length) throw new Error("count_objects: nothing to count");
  rows.forEach((r) => {
    if (!r.picto) throw new Error("count_objects: every row needs a `picto`");
    if (!hasPictogram(r.picto)) {
      throw new Error(`count_objects: unknown pictogram "${r.picto}" — the set is: ${pictogramNames().join(", ")}`);
    }
    if (r.count < 1) throw new Error(`count_objects: "${r.picto}" has a count of ${r.count} — there is nothing to count`);
    if (r.count > MAX_ITEMS) throw new Error(`count_objects: ${r.count} items is past counting; keep it to ${MAX_ITEMS}`);
  });

  const CELL = spec.cellSize ?? 84;
  const PAD = 18;
  const LGAP = 16;                 // gutter between a row's name and its things
  const group = rows.length === 1 && Number(spec.group) > 1 ? Math.floor(Number(spec.group)) : 0;
  const perRow = group
    ? group
    : Math.max(1, Math.floor(Number(spec.perRow) || Math.min(5, Math.max(...rows.map((r) => r.count)))));

  const labelSize = SIZE.label * 1.5;
  const labelW = Math.max(
    0,
    ...rows.map((r) => (r.label ? measure(r.label, labelSize, { lang: hasUrdu(r.label) ? "ur" : "en" }) * 1.3 + labelSize : 0))
  );
  const gutter = labelW ? labelW + LGAP : 0;

  // One LINE per `perRow` items; a row with more items than perRow wraps.
  const lines = [];
  rows.forEach((r, ri) => {
    for (let i = 0; i < r.count; i += perRow) {
      lines.push({ ri, picto: r.picto, n: Math.min(perRow, r.count - i), first: i === 0 });
    }
  });
  const wide = Math.max(...lines.map((l) => l.n));
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
    const runW = line.n * CELL;
    const x0 = isUr
      ? bodyW - PAD - gutter - (group ? RING : 0) - runW
      : PAD + gutter + (group ? RING : 0);
    if (group) {
      // The ring is an UNFILLED rect: measure.js reads that as four lines, not
      // as a box, so it can never be mistaken for a label-bearing panel.
      svg.rect(x0 - RING, y - RING + 4, runW + RING * 2, CELL + RING * 2 - 8, {
        rx: 16, fill: "none", stroke: C.accent, sw: 2.2,
      });
    }
    for (let i = 0; i < line.n; i += 1) {
      drawPictogram(svg, x0 + i * CELL, y + 6, CELL - 10, line.picto, { color: C.ink });
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
  ],
};
