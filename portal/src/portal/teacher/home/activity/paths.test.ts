import { describe, it, expect } from "vitest";
import { TEACHER_JOURNEY, journeyHref } from "./paths";

/** My journey's address (the page is built at this path): Home's row opens it; the Taught tile opens its taught lines. */
describe("journey paths", () => {
  it("the page, and its taught filter", () => {
    expect(TEACHER_JOURNEY).toBe("/portal/teacher/journey");
    expect(journeyHref()).toBe("/portal/teacher/journey");
    expect(journeyHref("taught")).toBe("/portal/teacher/journey?step=taught");
  });
});
