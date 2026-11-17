import { describe, it, expect } from "vitest";
import { lessonChip } from "./api";
import { COACHING_V2_COPY as C, COACHING } from "./copy";

/**
 * bd-sy4kcv — her list while a lesson is not finished. The server sends no percentage until the report is
 * ready, and says which step it is waiting on: her reflection answer (needs_answer, the same chip the
 * class-confirm question uses) or the report being made (preparing) — the ontology's word "Being made" / تیار ہو رہا ہے, never "Preparing".
 */
const item = { id: "s", date: "2026-11-16", topic: null, subject: null, grade: null, minutes: 30, percentage: null, reportReady: false };

describe("her list while the lesson is not finished (bd-sy4kcv)", () => {
  it("waiting on her reflection answer: Needs your answer (amber)", () => {
    expect(lessonChip({ ...item, state: "needs_answer" }, C)).toEqual({ text: C.classNeedsAnswer, tone: "waiting" });
  });
  it("the report is being made: Being made (amber), never a band", () => {
    expect(lessonChip({ ...item, state: "preparing" }, C)).toEqual({ text: C.beingMade, tone: "waiting" });
  });
  it("Being made: the ontology's English and Urdu, within four words", () => {
    const b = COACHING as unknown as { en: Record<string, string>; ur: Record<string, string> };
    expect(b.en.beingMade).toBe("Being made");
    expect(b.ur.beingMade).toBe("تیار ہو رہا ہے");
    expect(b.ur.beingMade).toBeTruthy();
    expect(b.ur.beingMade).not.toBe(b.en.beingMade);
    expect(b.ur.beingMade.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
  });
  it("a finished lesson still shows its band", () => {
    expect(lessonChip({ ...item, percentage: 64, reportReady: true }, C)).toEqual({ text: C.bands.good, tone: "done" });
  });
});
