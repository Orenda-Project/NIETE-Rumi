import { describe, it, expect } from "vitest";
import { findStepHeading, findStepSpan, locateStep, planLines, type PlanLine } from "./planSteps";

/**
 * v10 coaching test (bd-v0toag.8, PR3) — where a step's heading sits in a v9 plan or a v10 card, read from the
 * PDF's own text. The heading rules were checked on every local render (14 Oct): all five steps found, in
 * order, on 334 of 334 v9 plans (English, Maths, Urdu, Science) and 1,084 of 1,084 v10 cards. Each step is
 * searched for after the one before it, so a bare "Check" inside the Explanation is never taken for the
 * Check step. A step that is not found is null: nothing is marked, never a guess.
 */

const item = (str: string, x: number, y: number, height = 12) => ({ str, transform: [1, 0, 0, 1, x, y], height });
const line = (page: number, y: number, text: string): PlanLine => ({ page, y, height: 12, text });

describe("planLines", () => {
  it("joins one line's pieces left to right, letters only, lowercase, top line first", () => {
    const lines = planLines(3, [item("Do", 40, 700.2), item("We ", 10, 699.8), item("(10 min)", 60, 700), item("Hello, class!", 10, 650)]);
    expect(lines).toEqual([
      { page: 3, y: 700, height: 12, text: "wedomin" },
      { page: 3, y: 650, height: 12, text: "helloclass" },
    ]);
  });

  it("a line's height is its tallest piece", () => {
    expect(planLines(1, [item("We", 10, 500, 10), item("Do", 30, 500, 18)])[0].height).toBe(18);
  });

  it("skips pieces with no position and lines with no letters", () => {
    expect(planLines(1, [{ str: "x" } as never, item("12 — 3", 10, 400)])).toEqual([]);
  });
});

describe("findStepHeading", () => {
  const plan = [
    line(1, 900, "iopeningmin"),
    line(1, 600, "dexplanationminido"),
    line(2, 800, "check"), // a check inside the explanation
    line(2, 700, "shouldbestartingwedo"),
    line(2, 650, "wedoclasspractisestogether"),
    line(3, 900, "awedocontinued"),
    line(3, 500, "ayoudomin"),
    line(4, 900, "ayoudocontinued"),
    line(4, 400, "ccheck"),
    line(4, 300, "checkbooksanswers"),
  ];

  it.each([
    [1, 1, 900],
    [2, 1, 600],
    [3, 2, 650],
    [4, 3, 500],
    [5, 4, 400],
  ])("step %i is on page %i at %i", (step, page, y) => {
    expect(findStepHeading(plan, step)).toMatchObject({ page, y });
  });

  it.each([["openingi"], ["opening"], ["explanation"], ["wedomin"], ["youdopupilsworkalone"], ["youdointhebook"], ["checkexitticket"], ["checkc"]])(
    "%s is a heading", (text) => {
      const step = /open/.test(text) ? 1 : /expl/.test(text) ? 2 : /wedo/.test(text) ? 3 : /youdo/.test(text) ? 4 : 5;
      expect(findStepHeading([line(1, 100, text)], step)).not.toBeNull();
    },
  );

  it.each([["explanationcontinued", 2], ["awedocontinued", 3], ["wedoarecipe", 3], ["halfwaycheckminute", 5], ["openexplainwedoyoudo", 3]])(
    "%s is not step %i's heading", (text, step) => {
      expect(findStepHeading([line(1, 100, text)], step)).toBeNull();
    },
  );

  it("a missing earlier step does not stop a later one", () => {
    expect(findStepHeading([line(1, 900, "iopeningmin"), line(2, 500, "youdo")], 4)).toMatchObject({ page: 2 });
  });

  it.each([[0], [6], [2.5], [null], [undefined]])("step %p: null", (step) => {
    expect(findStepHeading(plan, step as number)).toBeNull();
  });

  it("no heading for the step: null", () => {
    expect(findStepHeading([line(1, 900, "iopeningmin")], 3)).toBeNull();
  });
});

/**
 * bd-v0toag.78 (Amena 16 Oct: "the actual LP short and full both being highlighted with the star") — the whole
 * step, not just its heading: from its start to the next step's start, on every page it runs onto, stopping above
 * the footer. Urdu step bars are in Urdu script, which pdf.js cannot read, but each bar carries its icon letter on
 * its own line (I opening, D explanation, A we do / you do, C check). A step running onto a page repeats its bar a
 * little higher (letter top 0.041) than a new step's bar at the top of a page (0.047): measured on all 87 Urdu
 * plans, 16 Oct. Pages are 1000 high here, so a line at y has its top at (1000 - y - 12) / 1000.
 */
describe("findStepSpan", () => {
  const heights = { 1: 1000, 2: 1000, 3: 1000, 4: 1000, 5: 1000, 6: 1000, 7: 1000 };
  const english = [
    line(2, 819, "iopeningmin"),
    line(2, 475, "dexplanation"),
    line(3, 951, "explanationcontinued"),
    line(3, 237, "wedomin"),
    line(4, 951, "awedocontinued"),
    line(5, 885, "ayoudomin"),
    line(6, 951, "ayoudocontinued"),
    line(7, 823, "ccheck"),
    line(7, 215, "supportpagesfollowplanningmaterials"),
  ];
  const urdu = [
    line(2, 361, "i"),
    line(2, 360, "opening"),
    line(3, 557, "d"),
    line(3, 556, "explanation"),
    line(4, 947, "d"), // the explanation running on
    line(4, 769, "a"), // the We Do bar
    line(4, 663, "wedoclasspractisestogether"),
    line(5, 947, "a"), // We Do running on
    line(5, 489, "a"), // the You Do bar
    line(6, 947, "a"), // You Do running on
    line(6, 904, "youdopupilsworkalone"),
    line(7, 751, "c"),
    line(7, 750, "check"),
  ];

  it("a step on one page runs from its heading to the next step's", () => {
    expect(findStepSpan(english, heights, 1)).toEqual({ start: english[0], bands: [{ page: 2, top: 0.169, bottom: 0.513 }] });
  });

  it("a step running over pages: its page from the heading, the pages between whole, the last down to the next step", () => {
    expect(findStepSpan(english, heights, 3)?.bands).toEqual([
      { page: 3, top: 0.751, bottom: 0.955 },
      { page: 4, top: 0.025, bottom: 0.955 },
      { page: 5, top: 0.025, bottom: 0.103 },
    ]);
  });

  it("Check ends where the support pages begin", () => {
    expect(findStepSpan(english, heights, 5)?.bands).toEqual([{ page: 7, top: 0.165, bottom: 0.773 }]);
  });

  it("Check with no support pages, or a step whose next is missing: its own page, down to the footer", () => {
    expect(findStepSpan(english.slice(0, 8), heights, 5)?.bands).toEqual([{ page: 7, top: 0.165, bottom: 0.955 }]);
    expect(findStepSpan(english.slice(0, 2), heights, 2)?.bands).toEqual([{ page: 2, top: 0.513, bottom: 0.955 }]);
  });

  it("Urdu: We Do starts at its bar's letter, not the box under it, and ends at the You Do bar", () => {
    expect(findStepSpan(urdu, heights, 3)).toEqual({
      start: urdu[5],
      bands: [{ page: 4, top: 0.219, bottom: 0.955 }, { page: 5, top: 0.025, bottom: 0.499 }],
    });
  });

  it("Urdu: You Do starts at its bar on the page before its box, never at the letter of a step running on", () => {
    expect(findStepSpan(urdu, heights, 4)).toEqual({
      start: urdu[8],
      bands: [{ page: 5, top: 0.499, bottom: 0.955 }, { page: 6, top: 0.025, bottom: 0.955 }, { page: 7, top: 0.025, bottom: 0.237 }],
    });
  });

  it("Urdu: Opening and Explanation, whose names sit on their bars", () => {
    expect(findStepSpan(urdu, heights, 1)?.bands).toEqual([{ page: 2, top: 0.627, bottom: 0.955 }, { page: 3, top: 0.025, bottom: 0.431 }]);
    expect(findStepSpan(urdu, heights, 2)?.bands).toEqual([{ page: 3, top: 0.431, bottom: 0.955 }, { page: 4, top: 0.025, bottom: 0.219 }]);
  });

  it("Urdu: a new step's bar at the very top of a page is its start", () => {
    const top = [line(3, 600, "a"), line(3, 590, "wedoclasspractisestogether"), line(4, 941, "a"), line(4, 915, "setthetaskgoing"), line(4, 700, "youdopupilsworkalone")];
    expect(findStepSpan(top, heights, 4)?.start).toBe(top[2]);
    expect(findStepSpan(top, heights, 3)?.bands).toEqual([{ page: 3, top: 0.388, bottom: 0.955 }]);
  });

  it("a heading with its minutes is the bar itself: a lone letter in the script above it is not taken", () => {
    const stray = [line(2, 900, "dexplanationminido"), line(3, 755, "a"), line(3, 260, "awedomin")];
    expect(findStepSpan(stray, heights, 3)?.start).toBe(stray[2]);
  });

  it("Urdu with no step names at all (the September renders): the bars' letters in order, I D A A C", () => {
    const bare = [
      line(2, 783, "i"), line(2, 448, "d"), line(3, 947, "d"), line(3, 769, "a"),
      line(4, 941, "a"), line(5, 947, "a"), line(5, 725, "c"), line(5, 463, "h"),
    ];
    expect(findStepSpan(bare, heights, 3)).toEqual({ start: bare[3], bands: [{ page: 3, top: 0.219, bottom: 0.955 }] });
    expect(findStepSpan(bare, heights, 4)?.bands).toEqual([{ page: 4, top: 0.047, bottom: 0.955 }, { page: 5, top: 0.025, bottom: 0.263 }]);
    expect(findStepSpan(bare, heights, 5)?.start).toBe(bare[6]);
    expect(findStepSpan(bare.slice(0, 4), heights, 5)).toBeNull();
  });

  it("a lone letter more than a page above the box is not taken for its bar", () => {
    const far = [line(1, 900, "iopeningmin"), line(2, 500, "a"), line(4, 600, "wedoclasspractisestogether")];
    expect(findStepSpan(far, heights, 3)?.start).toBe(far[2]);
  });

  it("no heading for the step, or an unknown step: null", () => {
    expect(findStepSpan(english.slice(0, 2), heights, 3)).toBeNull();
    expect(findStepSpan(english, heights, 9)).toBeNull();
  });
});

describe("locateStep", () => {
  const page = (items: ReturnType<typeof item>[], height = 1000) => ({
    getViewport: () => ({ width: 700, height }),
    getTextContent: async () => ({ items }),
  });

  it("the heading's band as fractions of its page, from the top", async () => {
    const doc = { numPages: 2, getPage: async (n: number) => (n === 1 ? page([item("Opening", 10, 900)]) : page([item("We Do", 10, 300, 20)])) };
    expect(await locateStep(doc, 3)).toEqual({ page: 2, top: 0.68, height: 0.02, bands: [{ page: 2, top: 0.68, bottom: 0.955 }] });
  });

  it("Urdu: the mark is the step's bar, and its bands run to the next bar", async () => {
    const pages: Record<number, ReturnType<typeof item>[]> = {
      1: [item("I", 500, 900), item("Opening", 10, 899)],
      2: [item("A", 500, 700), item("We Do · class practises together", 10, 600), item("A", 500, 300), item("You Do · pupils work alone", 10, 250)],
    };
    const doc = { numPages: 2, getPage: async (n: number) => page(pages[n]) };
    expect(await locateStep(doc, 3)).toEqual({
      page: 2, top: 0.288, height: 0.012, bands: [{ page: 2, top: 0.288, bottom: 0.688 }],
    });
  });

  it("not found: null", async () => {
    const doc = { numPages: 1, getPage: async () => page([item("Opening", 10, 900)]) };
    expect(await locateStep(doc, 4)).toBeNull();
  });

  it("a page whose text cannot be read: null, never throws", async () => {
    const doc = { numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 1, height: 1 }), getTextContent: async () => { throw new Error("x"); } }) };
    await expect(locateStep(doc, 1)).resolves.toBeNull();
  });

  it("an unknown step reads no page", async () => {
    let read = 0;
    const doc = { numPages: 3, getPage: async () => { read += 1; return page([]); } };
    expect(await locateStep(doc, 9)).toBeNull();
    expect(read).toBe(0);
  });
});
