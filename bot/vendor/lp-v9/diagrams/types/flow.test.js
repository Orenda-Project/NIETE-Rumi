// Tests for flow.js's viewBox-containment invariant (bd-9la73).
//
// flow.js declares `viewBox="0 0 <bodyW> <bodyH>"` (via `new Svg(bodyW, bodyH, ...)`,
// see diagrams/lib/svg.js toString()) and the SVG root uses the default
// `overflow: hidden`, so any box drawn outside [0, bodyW] is silently clipped —
// the render still exits 0, but authored text is cut mid-word on the printed
// page. This happened because `fitWidths()` re-clamps each shrunk box width to
// MIN_W (92px), so a row's total width can still exceed the canvas it was fit
// into; the centred layout (`startX = (bodyW - rowW) / 2`) then spreads that
// overflow symmetrically onto both edges.
//
// Both tests below render at width:381 — the phone-first canvas
// lib/template.js's primaryRedraw() converges on for every one of the 42 real
// grade-1-5 flow diagrams in the live ch9-10 corpus, none of which set
// spec.width themselves (confirmed by direct inspection of the reproduced
// corpus). That is the width production actually feeds this file, not the
// spec.width || 664 default.

const test = require("node:test");
const assert = require("node:assert/strict");
const { render, examples } = require("./flow.js");

// Same regex-based census used to measure all 42 real flow diagrams for
// bd-9la73: the single body <g transform="translate(...)"> wrapper holds every
// drawn rect (title/caption chrome lives outside it — see svg.js toString()),
// and flow.js never passes an Svg `pad` option, so this <g>'s translate is
// always (0, titleH) and rect x-coordinates map 1:1 onto viewBox coordinates.
function overflowOf(svg) {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) throw new Error("no viewBox found");
  const totalW = Number(vb[1]);

  const gStart = svg.indexOf('<g transform="translate(');
  const gEnd = svg.lastIndexOf("</g>");
  const body = svg.slice(gStart, gEnd);

  const rectRe = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  let m;
  let minX = Infinity;
  let maxX = -Infinity;
  let n = 0;
  while ((m = rectRe.exec(body))) {
    const x = Number(m[1]);
    const w = Number(m[3]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    n++;
  }
  if (!n) throw new Error("no rects found in body");

  return { totalW, minX, maxX, left: Math.max(0, -minX), right: Math.max(0, maxX - totalW) };
}

test("flow: the module's own 4-step lr example never draws outside its declared viewBox at the production canvas width", () => {
  const spec = examples.find((e) => e.name === "flow_mass_never_appears").spec;
  const svg = render({ ...spec, width: 381 });
  const { left, right } = overflowOf(svg);
  assert.equal(left, 0, `left overflow ${left}px — boxes outside [0, totalW] are clipped by the SVG root`);
  assert.equal(right, 0, `right overflow ${right}px — boxes outside [0, totalW] are clipped by the SVG root`);
});

test("flow: a 4-step row whose natural widths exceed the canvas stays inside the viewBox (fitWidths' MIN_W floor case)", () => {
  // Shaped like the 10 worst offenders in the real 42-flow corpus: enough
  // steps, with wide enough natural content, that fitWidths' MIN_W=92 floor
  // re-widens the row past the `avail` it was asked to fit into.
  const spec = {
    type: "flow",
    direction: "lr",
    title: "T",
    steps: [
      { title: "AAAAAAAAAAAAAAAAAAAA", lines: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] },
      { title: "CCCCCCCCCCCCCCCCCCCC", lines: ["dddddddddddddddddddddddddddddd"] },
      { title: "EEEEEEEEEEEEEEEEEEEE", lines: ["ffffffffffffffffffffffffffffff"] },
      { title: "GGGGGGGGGGGGGGGGGGGG", lines: ["hhhhhhhhhhhhhhhhhhhhhhhhhhhhhh"] },
    ],
  };
  const svg = render({ ...spec, width: 381 });
  const { left, right } = overflowOf(svg);
  assert.equal(left, 0);
  assert.equal(right, 0);
});

test("flow: a clean tb (top-to-bottom) layout is unaffected (regression guard)", () => {
  const spec = {
    type: "flow",
    direction: "tb",
    title: "T",
    steps: [{ title: "STEP ONE" }, { title: "STEP TWO" }, { title: "STEP THREE" }],
  };
  const svg = render({ ...spec, width: 381 });
  const { left, right } = overflowOf(svg);
  assert.equal(left, 0);
  assert.equal(right, 0);
});
