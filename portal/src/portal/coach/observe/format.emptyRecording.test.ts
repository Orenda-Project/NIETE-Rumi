import { describe, it, expect } from "vitest";
import { failureWords } from "./format";
import { OBSERVE_COPY, OBSERVE_COPY_UR } from "./copy";

/**
 * bd-r2uzg1.23.5 (queue #274, call 6A; ICT sheet HITL 199): a coach's or principal's send refused because the recording
 * is empty says so in the operator's words, in English and Urdu, never the catch-all "Something was not accepted".
 */
describe("failureWords — an empty recording", () => {
  it.each([["empty_recording"], ["recording_empty"]])("%s names the empty recording (en)", (code) => {
    expect(failureWords(code, OBSERVE_COPY)).toBe("This recording didn't reach us complete. Record or upload it again.");
  });
  it("Urdu reads the same line in Urdu, not the catch-all", () => {
    const ur = failureWords("empty_recording", OBSERVE_COPY_UR);
    expect(ur).toBe("یہ ریکارڈنگ ہم تک مکمل نہیں پہنچی۔ دوبارہ ریکارڈ کریں یا اپ لوڈ کریں۔");
    expect(ur).not.toBe(OBSERVE_COPY_UR.failure.refused);
  });
});
