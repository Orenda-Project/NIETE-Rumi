import { describe, it, expect } from "vitest";
import { readHome } from "./api";

/**
 * GET /me/home's `activity` (portal_teacher_home_activity, Redis only on the server): shaped, or absent. Anything
 * unreadable is left out, never guessed: a bad block is no block; a bad trend line or tip is dropped alone.
 */
const BASE = { success: true, now: "2026-11-19T12:00:00.000Z", order: [], card: null, scores: {}, quizHome: null };
const c = (now: number, prev: number) => ({ now, prev });
const ACT = {
  updatedAt: "2026-11-19T09:30:00.000Z", slot: "day",
  tiles: { opened: c(14, 9), taught: c(3, 1), coached: c(2, 2), quizzes: c(4, 0), papers: c(1, 0) },
  trend: [{ indicator: "Checks for understanding", from: "average", to: "good" }],
  tip: { sessionId: "s3", text: "Ask two children to explain" },
};

describe("readHome activity", () => {
  it("absent → undefined (Home as today)", () => {
    expect(readHome(BASE)?.activity).toBeUndefined();
  });

  it("a well-formed block is kept", () => {
    expect(readHome({ ...BASE, activity: ACT })?.activity).toEqual(ACT);
  });

  it("no time or a missing tile → no block", () => {
    expect(readHome({ ...BASE, activity: { ...ACT, updatedAt: 1 } })?.activity).toBeUndefined();
    expect(readHome({ ...BASE, activity: { ...ACT, tiles: { ...ACT.tiles, papers: null } } })?.activity).toBeUndefined();
    expect(readHome({ ...BASE, activity: { ...ACT, tiles: { ...ACT.tiles, opened: c(-1, 0) } } })?.activity).toBeUndefined();
  });

  it("a trend line with an unknown band, or a tip with no words, is dropped alone", () => {
    const out = readHome({ ...BASE, activity: { ...ACT, trend: [...ACT.trend, { indicator: "X", from: "great", to: "good" }], tip: { sessionId: "s", text: "" } } })?.activity;
    expect(out?.trend).toEqual(ACT.trend);
    expect(out?.tip).toBeNull();
  });
});
