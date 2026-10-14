import { describe, it, expect } from "vitest";
import { ANALYTICS_HOME, homeFor, redirectFor } from "./homeRoute";
import { SCHOOLS_TABS } from "../analytics/tabs";

/**
 * bd-s6qbts.3 — where a signed-in user belongs, decided in ONE place.
 *
 *   analytics-only account  -> the schools analytics page, from anywhere in the portal except the
 *                              signed-out pages (sign-in, setup link, password reset, privacy, account deletion)
 *   everyone else           -> exactly the home they had before (leader family: My Patch; anyone else: the dashboard),
 *                              and the analytics page is not theirs
 */
const analyticsUser = { role: "unregistered", analyticsOnly: true };
const teacher = { role: "teacher" };
const coach = { role: "coach" };
const principal = { role: "principal" };

describe("homeFor", () => {
  it("is unchanged for teachers and the leader family", () => {
    expect(homeFor(teacher)).toBe("/portal/dashboard");
    expect(homeFor({ role: null })).toBe("/portal/dashboard");
    expect(homeFor(coach)).toBe("/portal/leader");
    expect(homeFor(principal)).toBe("/portal/leader");
  });

  it("an analytics-only account's home is the schools analytics page", () => {
    expect(ANALYTICS_HOME).toBe("/portal/analytics/schools");
    expect(homeFor(analyticsUser)).toBe(ANALYTICS_HOME);
  });

  it("the page's six tabs, in the ICT dashboard's order (bd-97x22y.2)", () => {
    expect(SCHOOLS_TABS).toEqual(["overview", "lp", "training", "observations", "coaching", "info"]);
  });

  it("only a literal true makes an account analytics-only", () => {
    expect(homeFor({ role: "teacher", analyticsOnly: false })).toBe("/portal/dashboard");
    expect(homeFor({ role: "teacher", analyticsOnly: "true" as unknown as boolean })).toBe("/portal/dashboard");
  });
});

describe("redirectFor — an analytics-only account", () => {
  it.each([
    "/portal/dashboard",
    "/portal/dashboard/lesson-plans",
    "/portal/curriculum",
    "/portal/training",
    "/portal/coaching/analytics",
    "/portal/leader",
    "/portal/leader/school-analytics",
    "/portal/coach",
    "/portal/teacher/lessons",
    "/portal/account",
    "/portal/analytics/somewhere-else",
    "/portal/analytics/schools/bogus",
    "/portal/analytics/schools/lp/extra",
    "/portal/analytics/schoolsx",
    "/portal",
  ])("is sent from %s to the analytics page", (path) => {
    expect(redirectFor(analyticsUser, path)).toBe(ANALYTICS_HOME);
  });

  it.each([
    "/portal/analytics/schools",
    "/portal/analytics/schools/",
    // bd-97x22y.2 — every tab of the page is the page (PLAN v6 §1).
    "/portal/analytics/schools/overview",
    "/portal/analytics/schools/lp",
    "/portal/analytics/schools/training",
    "/portal/analytics/schools/observations",
    "/portal/analytics/schools/coaching",
    "/portal/analytics/schools/info",
    "/portal/analytics/schools/lp/",
    "/portal/login",
    "/portal/setup/abc123",
    "/portal/reset-password",
    "/portal/reset-password/verify",
    "/portal/privacy",
    "/portal/delete-account",
  ])("stays on %s", (path) => {
    expect(redirectFor(analyticsUser, path)).toBeNull();
  });

  it("outside the portal (the marketing site) nothing is decided here", () => {
    expect(redirectFor(analyticsUser, "/how-it-works")).toBeNull();
    expect(redirectFor(analyticsUser, "/")).toBeNull();
  });
});

describe("redirectFor — everyone else", () => {
  it("a teacher, a coach and a principal who open the analytics page go to their own home", () => {
    expect(redirectFor(teacher, "/portal/analytics/schools")).toBe("/portal/dashboard");
    expect(redirectFor(coach, "/portal/analytics/schools")).toBe("/portal/leader");
    expect(redirectFor(principal, "/portal/analytics/schools/")).toBe("/portal/leader");
  });

  it.each(["/portal/analytics/schools/lp", "/portal/analytics/schools/coaching", "/portal/analytics/schools/info", "/portal/analytics/schools/bogus"])(
    "a teacher or a coach who opens a tab of it (%s) goes to their own home too (bd-97x22y.2)",
    (path) => {
      expect(redirectFor(teacher, path)).toBe("/portal/dashboard");
      expect(redirectFor(coach, path)).toBe("/portal/leader");
    },
  );

  it.each(["/portal/dashboard", "/portal/leader", "/portal/coach", "/portal/account", "/portal/privacy"])(
    "is never moved off %s",
    (path) => {
      expect(redirectFor(teacher, path)).toBeNull();
      expect(redirectFor(coach, path)).toBeNull();
    },
  );

  it("nobody signed in: no decision (the pages send her to sign in as before)", () => {
    expect(redirectFor(null, "/portal/dashboard")).toBeNull();
    expect(redirectFor(null, "/portal/analytics/schools")).toBeNull();
  });
});
