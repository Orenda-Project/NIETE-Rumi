import { describe, it, expect } from "vitest";
import { COACHING, COACHING_V2_COPY as C } from "./copy";
import { dcSteps } from "./report";

/**
 * bd-dpen4t — ICT IAB rows 22, 25, 26, 27 (20 Oct): the Digital Coach headings, in English and Urdu.
 *   22  step 3 on the new-observation screen   Recording / ریکارڈنگ جاری       → Class recording / کلاس کی ریکارڈنگ
 *   26  progress step 1                        Analysing / تجزیہ جاری          → Lesson analysis / سبق کا تجزیہ
 *   27  progress step 2 and its question       Reflection question / غور کا سوال → Reflection question / Reflection کا سوال
 *   25  progress step 3                        Report ready / رپورٹ تیار        → Feedback / فیڈ بیک
 * The live "Recording" indicator and the "Analysing" list chip keep their words.
 */
const UR = (COACHING as unknown as { ur: typeof C }).ur;

describe("the Digital Coach headings (bd-dpen4t)", () => {
  it("English", () => {
    expect(C.stepRecording).toBe("Class recording");
    expect(dcSteps("queued", false, C).map((s) => s.label)).toEqual(["Lesson analysis", "Reflection question", "Feedback"]);
  });
  it("Urdu", () => {
    expect(UR.stepRecording).toBe("کلاس کی ریکارڈنگ");
    expect(dcSteps("queued", false, UR).map((s) => s.label)).toEqual(["سبق کا تجزیہ", "Reflection کا سوال", "فیڈ بیک"]);
  });
  it("the live Recording indicator and the Analysing chip are unchanged", () => {
    expect([C.recording, UR.recording]).toEqual(["Recording", "ریکارڈنگ جاری"]);
    expect([C.analysing, UR.analysing]).toEqual(["Analysing", "تجزیہ جاری"]);
  });
});
