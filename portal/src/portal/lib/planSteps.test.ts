import { describe, it, expect } from "vitest";
import { findStepHeading, locateStep, planLines, type PlanLine } from "./planSteps";

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

describe("locateStep", () => {
  const page = (items: ReturnType<typeof item>[], height = 1000) => ({
    getViewport: () => ({ width: 700, height }),
    getTextContent: async () => ({ items }),
  });

  it("the heading's band as fractions of its page, from the top", async () => {
    const doc = { numPages: 2, getPage: async (n: number) => (n === 1 ? page([item("Opening", 10, 900)]) : page([item("We Do", 10, 300, 20)])) };
    expect(await locateStep(doc, 3)).toEqual({ page: 2, top: 0.68, height: 0.02 });
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
