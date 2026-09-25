// Tests for render_lp.js's pass/fail verdict (bd-9la73, Part 2).
//
// render_lp.js's own header says "NOTHING is silently clipped. Overflow is measured in the
// browser and reported with the offending section id" — but until now that was true only
// VERTICALLY. `clippedXFromElements` (bd-km7vu) already computes the standard DOM
// `scrollWidth > clientWidth` horizontal-clip signal for every element on the page, and the
// in-page PROBE already attaches it to every page's result as `clipped_x` — but its own comment
// said so plainly: "Reporting only: this never fails the render." A page whose content was
// clipped sideways (exactly what the unfixed flow.js diagrams in bd-9la73's Part 1 produced)
// exited 0 anyway.
//
// The old pass/fail block built `problems` inline inside renderDoc, which requires Playwright/
// Chrome to exercise end to end. It is extracted here as `problemsFromProbe(figureProblems,
// probe)` — a pure function taking exactly the two inputs the old inline block read — so the
// whole verdict is directly testable, and renderDoc's report section becomes a single call to
// it (no behaviour change for the checks that already existed: OVERFLOW, TYPE FLOOR).

const test = require("node:test");
const assert = require("node:assert/strict");
const { problemsFromProbe, BODY_FLOOR_PX, CHIP_FLOOR_PX } = require("./render_lp.js");

function page(overrides) {
  return {
    id: "p1",
    part: "teach",
    overflowPx: 0,
    overflowingSections: [],
    lastElement: "foot",
    clipped_x: [],
    ...overrides,
  };
}

test("problemsFromProbe: a page clipped only HORIZONTALLY (overflowPx clean) still fails — this is the bd-9la73 gap", () => {
  const probe = {
    pages: [
      page({
        id: "g5_ch10_Maths_seg4-teach-1",
        clipped_x: [
          { page: "g5_ch10_Maths_seg4-teach-1", selector: "flow-body", scrollWidth: 470, clientWidth: 381, text: "Different units" },
        ],
      }),
    ],
    minBodyFontPx: null,
    minChipFontPx: null,
  };
  const problems = problemsFromProbe([], probe);
  assert.equal(problems.length, 1, `expected exactly one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /CLIPPED HORIZONTALLY/);
  assert.match(problems[0], /g5_ch10_Maths_seg4-teach-1/);
  assert.match(problems[0], /470/);
  assert.match(problems[0], /381/);
});

test("problemsFromProbe: a page with no overflow, no clipping and floors clear reports nothing", () => {
  const probe = { pages: [page({})], minBodyFontPx: BODY_FLOOR_PX + 1, minChipFontPx: CHIP_FLOOR_PX + 1 };
  assert.deepEqual(problemsFromProbe([], probe), []);
});

test("problemsFromProbe: vertical OVERFLOW is still reported byte-identically (regression guard)", () => {
  const probe = {
    pages: [page({ overflowPx: 40, overflowingSections: [{ sec: "practice", overBy: 40 }] })],
    minBodyFontPx: BODY_FLOOR_PX + 1,
    minChipFontPx: CHIP_FLOOR_PX + 1,
  };
  const problems = problemsFromProbe([], probe);
  assert.equal(problems.length, 1);
  assert.equal(problems[0], "OVERFLOW on p1: content is 40px taller than the page. Offending: practice (+40px)");
});

test("problemsFromProbe: TYPE FLOOR checks are still reported (regression guard)", () => {
  const probe = {
    pages: [page({})],
    minBodyFontPx: BODY_FLOOR_PX - 1,
    minBodySample: "some sample",
    minChipFontPx: CHIP_FLOOR_PX - 1,
    minChipSample: "chip sample",
  };
  const problems = problemsFromProbe([], probe);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /TYPE FLOOR: smallest body text/);
  assert.match(problems[1], /TYPE FLOOR: smallest chip\/label/);
});

test("problemsFromProbe: figureProblems (an illegible or over-tall diagram) are folded in first, and a null probe (Chrome-CLI fallback) does not crash", () => {
  const problems = problemsFromProbe(["FIGURE TOO SMALL: diagram \"flow\" ..."], null);
  assert.deepEqual(problems, ["FIGURE TOO SMALL: diagram \"flow\" ..."]);
});

test("problemsFromProbe: two clipped elements on one page are two separate problems", () => {
  const probe = {
    pages: [
      page({
        clipped_x: [
          { page: "p1", selector: "flow-body", scrollWidth: 470, clientWidth: 381, text: "a" },
          { page: "p1", selector: "mlist", scrollWidth: 500, clientWidth: 381, text: "b" },
        ],
      }),
    ],
    minBodyFontPx: null,
    minChipFontPx: null,
  };
  assert.equal(problemsFromProbe([], probe).length, 2);
});
