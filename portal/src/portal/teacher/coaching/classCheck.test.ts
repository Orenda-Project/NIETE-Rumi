import { describe, it, expect } from "vitest";
import { lessonChip } from "./api";
import { COACHING_V2_COPY as C, COACHING } from "./copy";

/** bd-aqotzx — her list: a recording that did not sound like a class says so, in both languages. */
const item = { id: "s", date: "2026-10-19", topic: null, subject: null, grade: null, minutes: 26, percentage: null, reportReady: false };

describe("her list (bd-aqotzx)", () => {
  it("waiting for her answer: Needs your answer (amber), not Analysing", () => {
    expect(lessonChip({ ...item, state: "needs_answer" }, C)).toEqual({ text: C.classNeedsAnswer, tone: "waiting" });
  });
  it("closed unanswered: Stopped", () => {
    expect(lessonChip({ ...item, state: "stopped" }, C)).toEqual({ text: C.stoppedChip, tone: "error" });
  });
  it("every new line has an Urdu version that is not the English", () => {
    const keys = ["classNeedsAnswer", "classQuestion", "classWhy", "classYes", "classNo", "classDeadline", "classNoAnswerNote", "classRecordAgainNote", "stoppedChip"] as const;
    const b = COACHING as unknown as { en: Record<string, string>; ur: Record<string, string> };
    for (const k of keys) {
      expect(b.ur[k]).toBeTruthy();
      expect(b.ur[k]).not.toBe(b.en[k]);
    }
  });
  it("the two buttons are short (icon + at most 3 words)", () => {
    expect(C.classYes.split(/\s+/).length).toBeLessThanOrEqual(3);
    expect(C.classNo.split(/\s+/).length).toBeLessThanOrEqual(3);
  });
});
