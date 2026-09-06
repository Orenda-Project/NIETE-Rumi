// count_frame — a ten-frame, or tally marks. The two ways a primary classroom
// writes a quantity down before it writes the numeral.
//
//   ten_frame (default)  a 2x5 box; counters fill it left to right, top row
//     first. Two frames for 11-20. The whole point is subitising: a child sees
//     "7" as "a full top row and two more", not by counting to seven.
//
//   tally  gates of five — four uprights and the fifth struck across them.
//
// The COUNT IS NEVER PRINTED. This type exists to be read off.
//
// Spec
//   model   "ten_frame" | "tally"    default ten_frame
//   count   7                        how many counters / strokes
//   lang    "en" | "ur"

const { Svg, C } = require("../lib/svg");

const MAX = 20;

function renderTenFrame(spec, count) {
  const CELL = spec.cellSize ?? 66;
  const PAD = 18;
  const GAP = 22; // between the two frames
  const frames = count > 10 ? 2 : 1;
  const bodyW = PAD * 2 + frames * (5 * CELL) + (frames - 1) * GAP;
  const bodyH = PAD * 2 + 2 * CELL;
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: spec.lang === "ur" ? "ur" : "en", spec,
  });
  for (let f = 0; f < frames; f += 1) {
    const fx = PAD + f * (5 * CELL + GAP);
    for (let r = 0; r < 2; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const i = f * 10 + r * 5 + c;
        const x = fx + c * CELL;
        const y = PAD + r * CELL;
        svg.rect(x, y, CELL, CELL, { fill: "none", stroke: C.ink, sw: 2 });
        if (i < count) {
          svg.circle(x + CELL / 2, y + CELL / 2, CELL * 0.32, { fill: C.accent, stroke: C.ink, sw: 1.6 });
        }
      }
    }
  }
  return svg.toString();
}

function renderTally(spec, count) {
  const H = spec.markHeight ?? 74;
  const STEP = 15;      // between two uprights of one gate
  const GATEGAP = 34;   // between gates
  const PAD = 20;
  const gates = Math.ceil(count / 5) || 1;
  const gateW = (n) => (Math.min(n, 4) - 1) * STEP + (n === 5 ? 12 : 0);
  const counts = [];
  for (let left = count; left > 0; left -= 5) counts.push(Math.min(5, left));
  const bodyW = PAD * 2 + counts.reduce((a, n) => a + gateW(n), 0) + (gates - 1) * GATEGAP;
  const bodyH = PAD * 2 + H;
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: spec.lang === "ur" ? "ur" : "en", spec,
  });
  let x = PAD;
  counts.forEach((n) => {
    const uprights = Math.min(n, 4);
    for (let i = 0; i < uprights; i += 1) {
      svg.line(x + i * STEP, PAD, x + i * STEP, PAD + H, { stroke: C.ink, sw: 3.4, cap: "round" });
    }
    if (n === 5) {
      // the fifth stroke is the one laid across the other four
      svg.line(x - 8, PAD + H - 8, x + (uprights - 1) * STEP + 8, PAD + 8, { stroke: C.ink, sw: 3.4, cap: "round" });
    }
    x += gateW(n) + GATEGAP;
  });
  return svg.toString();
}

function render(spec) {
  const count = Math.floor(Number(spec.count));
  if (!Number.isFinite(count) || count < 1) throw new Error("count_frame: `count` must be at least 1");
  if (count > MAX) throw new Error(`count_frame: ${count} is past what a frame or a tally shows a child; keep it to ${MAX}`);
  const model = spec.model === "tally" ? "tally" : "ten_frame";
  return model === "tally" ? renderTally(spec, count) : renderTenFrame(spec, count);
}

module.exports = {
  type: "count_frame",
  aliases: ["ten_frame", "tally", "tally_marks"],
  summary: "A ten-frame with counters, or tally gates of five — the two ways a quantity is written before the numeral.",
  render,
  examples: [
    { name: "count_frame_ten_7_en", spec: { type: "count_frame", count: 7 } },
    { name: "count_frame_ten_14_ur", spec: { type: "count_frame", count: 14, lang: "ur" } },
    { name: "count_frame_tally_12_en", spec: { type: "count_frame", model: "tally", count: 12 } },
  ],
};
