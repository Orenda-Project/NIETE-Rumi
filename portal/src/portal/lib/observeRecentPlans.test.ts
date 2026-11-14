import { describe, expect, it } from "vitest";
import { downloadsOnly, isOwnPlan } from "./observeRecentPlans";
import type { ObserveRecentPlan } from "../services/api";

const dl = { assetId: "a1", lessonId: "l1", topic: "Fractions", grade: 4, subject: "Maths", chapterNumber: 5, dayLabel: null, pagesLabel: null, downloadedAt: null };
const own = { own: true as const, ownId: "o1", lessonId: null, topic: "Mine", grade: 3, subject: "english", chapterNumber: "4", madeAt: null };

describe("observeRecentPlans (bd-snkn32.41)", () => {
  it("tells her own plan from a download", () => {
    expect(isOwnPlan(own)).toBe(true);
    expect(isOwnPlan(dl)).toBe(false);
  });
  it("downloadsOnly drops her own plans for the asset picker", () => {
    const plans: ObserveRecentPlan[] = [dl, own];
    expect(downloadsOnly({ plans }).plans).toEqual([dl]);
    expect(downloadsOnly({ plans: undefined as unknown as ObserveRecentPlan[] }).plans).toEqual([]);
  });
});
