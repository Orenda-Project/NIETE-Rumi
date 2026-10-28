import { describe, it, expect } from "vitest";
import { COACH_APP_READY, coachLandingFor, coachPathReady, coachReadyFor, coachReadyHome } from "./appReady";
import { COACH_CARD_NAV_KEYS, coachNavKeysFor, currentCoachCardItem, currentCoachMenuItem } from "../../teacher/menu";

/**
 * The School card switch (features.schoolCard) in the coach app's ready list. Golden: with the switch off nothing
 * changes; with it on the slim Home is the landing page, the School card pages open, and Schedule, Observe, Reports,
 * Analytics and Insights stay shut.
 */
const ON = coachReadyFor(false, true);

describe("coachReadyFor: the switch off is exactly today", () => {
  it.each([[false, undefined], [false, false], [false, null], [null, false], [undefined, undefined]])("coachip %s, school card %s", (c, s) => {
    expect(coachReadyFor(c, s)).toBe(COACH_APP_READY);
  });

  it("COACHIP alone still puts This week first", () => {
    expect([...coachReadyFor(true, false)]).toEqual(["insights", ...COACH_APP_READY]);
    expect([...coachReadyFor(true)]).toEqual(["insights", ...COACH_APP_READY]);
  });

  it("only a literal true turns it on", () => {
    expect(coachReadyFor(false, "true" as unknown as boolean)).toBe(COACH_APP_READY);
    expect(coachReadyFor(false, 1 as unknown as boolean)).toBe(COACH_APP_READY);
  });

  it("the landing page stays the Training Library", () => {
    expect(coachLandingFor(coachReadyFor(false, false), false, false)).toBe("/portal/coach/training");
  });

  it.each(["/portal/coach", "/portal/coach/session/s-1", "/portal/coach/session"])("%s stays shut", (p) => {
    expect(coachPathReady(p, coachReadyFor(false, false))).toBe(false);
  });
});

describe("coachReadyFor: the switch on", () => {
  it("adds home first and keeps the ready list after it", () => {
    expect([...ON]).toEqual(["home", "training", "lessons", "schools"]);
  });

  it("wins over COACHIP: no Insights", () => {
    expect([...coachReadyFor(true, true)]).toEqual([...ON]);
  });

  it("lands on the slim Coach Home", () => {
    expect(coachReadyHome(ON)).toBe("/portal/coach");
    expect(coachLandingFor(ON, false, false)).toBe("/portal/coach");
  });

  it.each([
    "/portal/coach", "/portal/coach/", "/portal/coach/session/s-1",
    "/portal/coach/people", "/portal/coach/school/E-1", "/portal/coach/school/E-1/feature/lp", "/portal/coach/school/E-1/feature/papers",
    "/portal/coach/teacher/900000000001", "/portal/coach/teacher/900000000001/items/dc", "/portal/coach/teacher/900000000001/reports",
    "/portal/coach/teacher/900000000001/edit", "/portal/coach/school/E-1/add-teacher",
    "/portal/coach/training", "/portal/coach/training/module/m-1", "/portal/teacher/lessons", "/portal/coach/more", "/portal/coach/profile",
  ])("%s is reachable", (p) => expect(coachPathReady(p, ON)).toBe(true));

  it.each([
    "/portal/coach/scheduling", "/portal/coach/schedule", "/portal/coach/team", "/portal/coach/new-visit",
    "/portal/coach/observe", "/portal/coach/visit/3", "/portal/coach/observation/7", "/portal/coach/reports", "/portal/coach/reports/all",
    "/portal/coach/analytics", "/portal/coach/analytics/teacher/5", "/portal/coach/insights", "/portal/coach/insights/w/1",
    "/portal/coach/sessionx", "/portal/coach/homex",
  ])("%s stays shut", (p) => expect(coachPathReady(p, ON)).toBe(false));
});

describe("the menu with the School card on", () => {
  it("is Home · Lesson Plans · More", () => {
    expect([...COACH_CARD_NAV_KEYS]).toEqual(["home", "lessons", "more"]);
  });

  it("the ready-list menu without the switch is unchanged", () => {
    expect([...coachNavKeysFor(COACH_APP_READY)]).toEqual(["training", "lessons", "schools", "more"]);
  });

  it.each([
    ["/portal/coach", "home"], ["/portal/coach/people", "home"], ["/portal/coach/school/E-1", "home"],
    ["/portal/coach/school/E-1/feature/dc", "home"], ["/portal/coach/teacher/9/items/lp", "home"], ["/portal/coach/teacher/9/reports", "home"],
    ["/portal/coach/session/s-1", "home"], ["/portal/coach/training", "home"], ["/portal/coach/training/module/m-1", "home"],
    ["/portal/teacher/lessons", "lessons"], ["/portal/coach/more", "more"], ["/portal/coach/profile", "more"],
  ])("%s marks %s", (p, key) => expect(currentCoachCardItem(p)).toBe(key));

  it("the menu rule without the switch is unchanged", () => {
    expect(currentCoachMenuItem("/portal/coach/school/E-1")).toBe("schools");
    expect(currentCoachMenuItem("/portal/coach/training")).toBe("training");
  });
});
