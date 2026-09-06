// match — two columns of things, lettered on one side and numbered on the
// other, with NO lines drawn between them. The child picks the pair.
//
// Matching is one of the commonest early-years exercises (word to picture,
// animal to its young, shape to its name, half to half) and it is also the
// commonest way a printed exercise leaks its answer: a worksheet joins the
// pairs it wants and asks about the ones it does not. Here nothing is joined.
// The picture supplies the two columns; the OPTIONS supply the candidate pairs
// ("A-2", "B-1", "C-3"), so the handles are on the drawing and every option's
// text appears on it — the legal labelled case under the leak rule.
//
// Rows are NOT drawn in the order the author writes them being the answer:
// the author writes left[] and right[] exactly as the child should see them,
// and pairing is the question, not the layout.
//
// Spec
//   left    [{picto:"cat"} | {text:"cat"}, …]   2-4 entries
//   right   [{text:"بلی"} | {picto:"cat"}, …]   the same number of entries
//   handles true (default)  A/B/C down the left, 1/2/3 down the right
//   lang    "en" | "ur"     (ur puts the lettered column on the right)

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { drawPictogram, descLine, has: hasPictogram } = require("../lib/pictogram");

const LETTERS = ["A", "B", "C", "D"];

function cellOf(entry, where) {
  if (entry && typeof entry === "object") {
    if (entry.picto) return { kind: "picto", value: String(entry.picto) };
    if (entry.text != null) return { kind: "text", value: String(entry.text) };
  }
  const s = String(entry ?? "").trim();
  if (!s) throw new Error(`match: an empty entry in ${where}`);
  return hasPictogram(s) ? { kind: "picto", value: s } : { kind: "text", value: s };
}

function render(spec) {
  const left = (Array.isArray(spec.left) ? spec.left : []).map((e) => cellOf(e, "left"));
  const right = (Array.isArray(spec.right) ? spec.right : []).map((e) => cellOf(e, "right"));
  if (left.length < 2 || right.length < 2) throw new Error("match: both columns need at least 2 entries");
  if (left.length !== right.length) throw new Error(`match: the columns must be the same length (${left.length} vs ${right.length})`);
  if (left.length > 4) throw new Error("match: more than 4 pairs does not fit a phone");
  [...left, ...right].forEach((c) => {
    if (c.kind === "picto" && !hasPictogram(c.value)) throw new Error(`match: unknown pictogram "${c.value}"`);
  });

  const isUr = spec.lang === "ur";
  const handles = spec.handles !== false;
  const ROW = spec.rowHeight ?? 104;
  const GAP = 14;
  const PAD = 18;
  const MID = 76;             // the empty channel between the columns
  const HANDLE = handles ? 46 : 0;
  const textSize = Math.max(SIZE.label * 1.4, 22);

  const colW = (cells) => Math.max(
    170,
    ...cells.map((c) => (c.kind === "picto"
      ? ROW - 16
      : Math.ceil(measure(c.value, textSize, { lang: hasUrdu(c.value) ? "ur" : "en" }) * (hasUrdu(c.value) ? 1.35 : 1.15)) + 34))
  );
  const lw = colW(left);
  const rw = colW(right);
  const bodyW = PAD * 2 + HANDLE + lw + MID + rw + HANDLE;
  const bodyH = PAD * 2 + left.length * ROW + (left.length - 1) * GAP;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: isUr ? "ur" : "en", spec,
  });
  if ([...left, ...right].some((c) => c.kind === "picto")) svg.add(`<desc>${descLine()}</desc>`);

  // Column origins, laid out as five bands across the body:
  //   LTR   [pad][A B C][left col][channel][right col][1 2 3][pad]
  //   RTL   [pad][1 2 3][right col][channel][left col][A B C][pad]
  // In Urdu the LETTERED column is the one the reader meets first, so it moves
  // to the right — and with it its handle band, which is why the bands mirror
  // as a block rather than the handles being nudged.
  const lhx = isUr ? bodyW - PAD - HANDLE : PAD;
  const lx = isUr ? lhx - lw : PAD + HANDLE;
  const rx = isUr ? PAD + HANDLE : lx + lw + MID;
  const rhx = isUr ? PAD : rx + rw;

  const cell = (x, w, y, c) => {
    svg.rect(x, y, w, ROW, { rx: 12, fill: C.paper, stroke: C.rule, sw: 1.8 });
    if (c.kind === "picto") {
      const s = ROW - 22;
      drawPictogram(svg, x + (w - s) / 2, y + 11, s, c.value, { color: C.ink });
    } else {
      svg.text(x + w / 2, y + ROW / 2, c.value, {
        size: textSize, weight: 600, anchor: "middle", baseline: "middle", fill: C.ink,
      });
    }
  };

  left.forEach((c, i) => {
    const y = PAD + i * (ROW + GAP);
    cell(lx, lw, y, c);
    cell(rx, rw, y, right[i]);
    if (handles) {
      svg.text(lhx + HANDLE / 2, y + ROW / 2, LETTERS[i], { size: textSize, weight: 700, anchor: "middle", baseline: "middle", fill: C.accent });
      svg.text(rhx + HANDLE / 2, y + ROW / 2, String(i + 1), { size: textSize, weight: 700, anchor: "middle", baseline: "middle", fill: C.accent });
    }
  });
  return svg.toString();
}

module.exports = {
  type: "match",
  aliases: ["matching", "two_columns", "pair_up"],
  summary: "Two columns of pictures or words, lettered and numbered, with no lines drawn — the child picks the pair.",
  render,
  examples: [
    { name: "match_animal_word_en", spec: { type: "match", left: [{ picto: "cat" }, { picto: "dog" }, { picto: "fish" }], right: [{ text: "dog" }, { text: "fish" }, { text: "cat" }] } },
    { name: "match_urdu_en_ur", spec: { type: "match", lang: "ur", left: [{ picto: "sun" }, { picto: "moon" }], right: [{ text: "چاند" }, { text: "سورج" }] } },
  ],
};
