import { describe, it, expect } from "vitest";
import { COACH_APP_READY, coachPathReady, coachReadyHome } from "./appReady";

/** bd-s42dye.2 — the coach app v2 allow-list: one constant, training only for now. */
describe("COACH_APP_READY", () => {
  it("is training only", () => {
    expect([...COACH_APP_READY]).toEqual(["training"]);
    expect(coachReadyHome()).toBe("/portal/coach/training");
  });

  it.each([
    "/portal/coach/training", "/portal/coach/training/ISAPS", "/portal/coach/training/module/m-1", "/portal/coach/training/preview",
    "/portal/coach/more", "/portal/coach/profile", "/portal/account", "/portal/login",
  ])("%s is reachable", (p) => expect(coachPathReady(p)).toBe(true));

  it.each([
    "/portal/coach", "/portal/coach/scheduling", "/portal/coach/schedule", "/portal/coach/team", "/portal/coach/new-visit",
    "/portal/coach/observe", "/portal/coach/visit/3", "/portal/coach/reports", "/portal/coach/people", "/portal/coach/school/1",
    "/portal/coach/analytics", "/portal/coach/teacher/5", "/portal/dashboard", "/portal/leader", "/portal/leader/teachers",
    "/portal/leader/observations", "/portal/training", "/portal/training/v2", "/portal/training/provider/X", "/portal/curriculum", "/",
  ])("%s is not", (p) => expect(coachPathReady(p)).toBe(false));

  // bd-tbprit.6 — the disagreement card gates itself on coach_disagreement_card, so the guard lets it through;
  // otherwise its /cv link and its list land her back on the Training Library.
  it.each(["/portal/coach/disagreements", "/portal/coach/disagreements/", "/portal/coach/disagreements/4650f2b9"])(
    "%s is reachable (the card's own flag gates it)", (p) => expect(coachPathReady(p)).toBe(true));

  it("only the card's addresses open, not look-alikes", () => {
    expect(coachPathReady("/portal/coach/disagreementsx")).toBe(false);
    expect(coachPathReady("/portal/coach/disagreements/4650f2b9/edit")).toBe(false);
  });

  it("enabling observe later is one entry: its pages open, the others stay shut", () => {
    expect(coachPathReady("/portal/coach/observe", ["training", "observe"])).toBe(true);
    expect(coachPathReady("/portal/coach/visit/3/record", ["training", "observe"])).toBe(true);
    expect(coachPathReady("/portal/coach/scheduling", ["training", "observe"])).toBe(false);
  });
});
