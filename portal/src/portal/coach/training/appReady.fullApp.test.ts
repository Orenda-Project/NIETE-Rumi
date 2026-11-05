import { describe, it, expect } from "vitest";
import { COACH_APP_READY, coachFeatureReady, coachPathReady, coachReadyFor, coachReadyHome } from "./appReady";
import { coachFullAppOn } from "./useCoachFullApp";
import { COACH_CARD_FULL_NAV_KEYS, COACH_CARD_NAV_KEYS, currentCoachCardItem } from "../../teacher/menu";

/**
 * bd-jjcofw — the per-user "full coach app" switch (app_settings `portal_coach_full_app`, /config
 * `features.coachFullApp`). Golden: off, absent or unread, the ready list is exactly what it was. On (a literal true),
 * Schedule and Observe open for her: scheduling, the visit and recording pages, the observation pages. The School card
 * keeps working: its Home stays her landing page.
 */
const SCHEDULE = ["/portal/coach/scheduling", "/portal/coach/schedule", "/portal/coach/team", "/portal/coach/new-visit"];
const OBSERVE = [
  "/portal/coach/observe", "/portal/coach/observe/pick", "/portal/coach/visit/7", "/portal/coach/visit/7/record",
  "/portal/coach/visit/7/attach", "/portal/coach/visit/7/check", "/portal/coach/observation/9", "/portal/coach/reports",
];

// main has no COACHIP: coachReadyFor(schoolCard, fullApp).
describe("coachReadyFor: the switch off is exactly today", () => {
  it.each([undefined, null, false, "true", 1])("full app %s", (f) => {
    expect(coachReadyFor(true, f as never)).toEqual(coachReadyFor(true));
    expect(coachReadyFor(false, f as never)).toBe(COACH_APP_READY);
  });

  it.each([...SCHEDULE, ...OBSERVE])("%s stays shut", (p) => {
    expect(coachPathReady(p, coachReadyFor(true, false))).toBe(false);
    expect(coachPathReady(p, coachReadyFor(false, false))).toBe(false);
  });

  it("coachFeatureReady is unchanged without the switch", () => {
    expect(coachFeatureReady("schedule")).toBe(false);
    expect(coachFeatureReady("observe")).toBe(false);
    expect(coachFeatureReady("schedule", false)).toBe(false);
    expect(coachFeatureReady("observe", null)).toBe(false);
    expect(coachFeatureReady("schools")).toBe(true);
  });
});

describe("coachReadyFor: the switch on", () => {
  it("with the School card: its list, then Schedule and Observe", () => {
    expect([...coachReadyFor(true, true)]).toEqual(["home", "training", "lessons", "schools", "schedule", "observe"]);
  });

  it("without the School card: today's list, then Schedule and Observe", () => {
    expect([...coachReadyFor(false, true)]).toEqual([...COACH_APP_READY, "schedule", "observe"]);
  });

  it("the School card Home stays her landing page", () => {
    expect(coachReadyHome(coachReadyFor(true, true))).toBe("/portal/coach");
  });

  it.each([...SCHEDULE, ...OBSERVE])("%s opens", (p) => {
    expect(coachPathReady(p, coachReadyFor(true, true))).toBe(true);
  });

  it("Analytics stays shut", () => {
    expect(coachPathReady("/portal/coach/analytics", coachReadyFor(true, true))).toBe(false);
  });

  it("coachFeatureReady opens Schedule and Observe for her only", () => {
    expect(coachFeatureReady("schedule", true)).toBe(true);
    expect(coachFeatureReady("observe", true)).toBe(true);
    expect(coachFeatureReady("analytics", true)).toBe(false);
  });
});

describe("the switch's own rule: a literal true only", () => {
  it.each([
    [{ features: { coachFullApp: true } }, true],
    [{ features: { coachFullApp: "true" } }, false],
    [{ features: { coachFullApp: 1 } }, false],
    [{ features: {} }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ])("%j -> %s", (cfg, want) => {
    expect(coachFullAppOn(cfg)).toBe(want);
  });
});

describe("the School card menu with the switch on", () => {
  it("Home, Schedule, Observe, Lesson Plans, More", () => {
    expect([...COACH_CARD_FULL_NAV_KEYS]).toEqual(["home", "schedule", "observe", "lessons", "more"]);
    expect([...COACH_CARD_NAV_KEYS]).toEqual(["home", "lessons", "more"]);
  });

  it("Schedule and Observe stay current on their pages", () => {
    expect(currentCoachCardItem("/portal/coach/new-visit")).toBe("schedule");
    expect(currentCoachCardItem("/portal/coach/scheduling")).toBe("schedule");
    expect(currentCoachCardItem("/portal/coach/visit/7/record")).toBe("observe");
    expect(currentCoachCardItem("/portal/coach/observe")).toBe("observe");
  });
});
