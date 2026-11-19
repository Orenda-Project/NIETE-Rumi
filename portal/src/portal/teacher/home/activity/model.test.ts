import { describe, it, expect } from "vitest";
import { activityRange, changeOf, hasNumbers, rangeHref, updatedLine } from "./model";
import { ACTIVITY_COPY as C, ACTIVITY_COPY_UR as U } from "./copy";

/**
 * The block's pure rules: the 30 days a tile opens (the Pakistan date of the run, back 29 days), the change pill
 * (both 0 → none; else now − previous), the updated line (a night run today → last night; a day run today → today,
 * time; a run yesterday → yesterday, time; anything else → null, the block hides), and the no-numbers rule.
 */
const at = (iso: string) => Date.parse(iso);

describe("activityRange / rangeHref", () => {
  it("the run's Pakistan date and the 29 days before", () => {
    // 20:30Z on 19 Nov is 01:30 on 20 Nov in Pakistan
    expect(activityRange("2026-11-19T20:30:00.000Z")).toEqual({ from: "2026-10-22", to: "2026-11-20" });
    expect(activityRange("2026-11-19T09:30:00.000Z")).toEqual({ from: "2026-10-21", to: "2026-11-19" });
    expect(activityRange("nope")).toBeNull();
  });

  it("an All page's address for those days", () => {
    expect(rangeHref("/portal/teacher/lessons/all", { from: "2026-10-21", to: "2026-11-19" }))
      .toBe("/portal/teacher/lessons/all?range=custom&from=2026-10-21&to=2026-11-19");
    expect(rangeHref("/x", null)).toBe("/x");
  });
});

describe("changeOf", () => {
  it("both 0 → no pill; else now − previous (previous 0 → up n)", () => {
    expect(changeOf({ now: 0, prev: 0 })).toBeNull();
    expect(changeOf({ now: 14, prev: 9 })).toBe(5);
    expect(changeOf({ now: 1, prev: 3 })).toBe(-2);
    expect(changeOf({ now: 2, prev: 2 })).toBe(0);
    expect(changeOf({ now: 4, prev: 0 })).toBe(4);
  });
});

describe("updatedLine", () => {
  const clock = { am: "AM", pm: "PM" };
  const NOW = at("2026-11-19T12:00:00.000Z"); // 17:00 PKT, 19 Nov
  it("a night run today → last night", () => {
    expect(updatedLine("2026-11-18T20:30:00.000Z", NOW, C, clock)).toBe(C.updatedNight);
  });
  it("a day run today → today, the time", () => {
    expect(updatedLine("2026-11-19T09:30:00.000Z", NOW, C, clock)).toBe("Updated today, 2:30 PM");
  });
  it("a run yesterday → yesterday, the time", () => {
    expect(updatedLine("2026-11-18T09:30:00.000Z", NOW, C, clock)).toBe("Updated yesterday, 2:30 PM");
  });
  it("older, unreadable or in the future → null", () => {
    expect(updatedLine("2026-11-16T09:30:00.000Z", NOW, C, clock)).toBeNull();
    expect(updatedLine("x", NOW, C, clock)).toBeNull();
    expect(updatedLine("2026-11-20T09:30:00.000Z", NOW, C, clock)).toBeNull();
  });
  it("Urdu: the kit's PM word, the time in a left-to-right isolate", () => {
    expect(updatedLine("2026-11-19T09:30:00.000Z", NOW, U, { am: "صبح", pm: "بعد دوپہر" })).toBe("اپ ڈیٹ: آج، ⁦2:30 بعد دوپہر⁩");
  });
});

describe("hasNumbers", () => {
  const z = { now: 0, prev: 0 };
  it("all ten counts 0 → false; any above 0 → true", () => {
    expect(hasNumbers({ opened: z, taught: z, coached: z, quizzes: z, papers: z })).toBe(false);
    expect(hasNumbers({ opened: z, taught: z, coached: z, quizzes: z, papers: { now: 0, prev: 1 } })).toBe(true);
  });
});
