import { describe, it, expect } from "vitest";
import { coachPathReady } from "./appReady";

/**
 * bd-o15qnr.28 (v7) — seen on sandbox 21 Nov: a coach on the v6/v7 switch who tapped My progress was sent straight back
 * to Home. Root cause: /portal/coach/progress was not in the coach app's open addresses, so CoachAppGuard sent her to
 * her landing page before the page mounted (the page itself turns away anyone off the switch). It opens like her debrief
 * report and her week.
 */
describe("My progress is a page the coach app opens", () => {
  it("/portal/coach/progress is open, as the debrief report and the week are", () => {
    expect(coachPathReady("/portal/coach/progress")).toBe(true);
    expect(coachPathReady("/portal/coach/progress/")).toBe(true);
    expect(coachPathReady("/portal/coach/report/abc")).toBe(true);
    expect(coachPathReady("/portal/coach/week/2026-11-16")).toBe(true);
  });

  it("nothing under it is opened by accident", () => {
    expect(coachPathReady("/portal/coach/progress/x")).toBe(false);
    expect(coachPathReady("/portal/coach/progressive")).toBe(false);
  });
});
