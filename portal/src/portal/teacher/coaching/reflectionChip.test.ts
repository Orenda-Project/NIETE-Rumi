import { describe, it, expect } from "vitest";
import { lessonChip } from "./api";
import { COACHING_V2_COPY as C, COACHING, COPY_ENTRY } from "./copy";
import { ASSESSMENT } from "../assessment/copy";
import { LESSONS_V2_COPY } from "../lessons/copy";

/**
 * bd-sy4kcv — her list while a lesson is not finished. The server sends no percentage until the report is
 * ready, and says which step it is waiting on: her reflection answer (needs_answer, the same chip the
 * class-confirm question uses) or the report being made (preparing).
 * bd-sy4kcv.1 — that chip names what is being made: "Report being made" / رپورٹ تیار ہو رہی ہے (the ontology's
 * in-progress phrase with its subject; رپورٹ is feminine, so رہی; four words, as narrow as the Needs your answer chip). Only Digital Coaching's word: Lesson Plans,
 * Assessment and the tray keep their own "Being made".
 */
const item = { id: "s", date: "2026-11-16", topic: null, subject: null, grade: null, minutes: 30, percentage: null, reportReady: false };

describe("her list while the lesson is not finished (bd-sy4kcv)", () => {
  it("waiting on her reflection answer: Needs your answer (amber)", () => {
    expect(lessonChip({ ...item, state: "needs_answer" }, C)).toEqual({ text: C.classNeedsAnswer, tone: "waiting" });
  });
  it("the report is being made: Report being made (amber), never a band", () => {
    expect(lessonChip({ ...item, state: "preparing" }, C)).toEqual({ text: C.reportBeingMade, tone: "waiting" });
  });
  it("Report being made: English and Urdu (feminine رپورٹ), within the four-word chip rule", () => {
    const b = COACHING as unknown as { en: Record<string, string>; ur: Record<string, string> };
    expect(b.en.reportBeingMade).toBe("Report being made");
    expect(b.ur.reportBeingMade).toBe("رپورٹ تیار ہو رہی");
    expect(b.ur.reportBeingMade.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(COPY_ENTRY.longOk).not.toContain("reportBeingMade");
  });
  it("the other features keep their own Being made", () => {
    expect(ASSESSMENT.en.beingMade).toBe("Being made");
    expect(LESSONS_V2_COPY.preparing).toBe("Being made");
  });
  it("a finished lesson still shows its band", () => {
    expect(lessonChip({ ...item, percentage: 64, reportReady: true }, C)).toEqual({ text: C.bands.good, tone: "done" });
  });
});
