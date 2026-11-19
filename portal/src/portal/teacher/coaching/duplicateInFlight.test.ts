import { describe, it, expect } from "vitest";
import { stoppedLine } from "./reportLive";
import { COACHING_V2_COPY as C, COACHING } from "./copy";
import type { CoachingProgress } from "../../types/portal";

/**
 * bd-r2uzg1.18.15 — the same recording sent again while the first copy is still being checked: the bot closes this
 * copy (failed_step 'duplicate_in_flight' → the progress route's stopReason) and the page says why, in both languages,
 * instead of the general "Could not analyse".
 */
const stopped = (stopReason: string | null) => ({ stage: "stopped", stopReason } as unknown as CoachingProgress);

describe("a re-sent copy closed behind the one in flight (bd-r2uzg1.18.15)", () => {
  it("says the earlier copy is being checked and its report will come", () => {
    expect(stoppedLine(stopped("duplicate_in_flight"), C)).toBe(C.duplicateInFlightNote);
    expect(C.duplicateInFlightNote).toMatch(/earlier/i);
    expect(C.duplicateInFlightNote).not.toMatch(/\bapp\b/i);
  });
  it("in Urdu, not the English", () => {
    const b = COACHING as unknown as { en: Record<string, string>; ur: Record<string, string> };
    expect(b.ur.duplicateInFlightNote).toMatch(/[؀-ۿ]/);
    expect(b.ur.duplicateInFlightNote).not.toBe(b.en.duplicateInFlightNote);
    expect(stoppedLine(stopped("duplicate_in_flight"), b.ur as unknown as typeof C)).toBe(b.ur.duplicateInFlightNote);
  });
  it("control: any other stop keeps its own line", () => {
    expect(stoppedLine(stopped(null), C)).toBe(C.stopped);
    expect(stoppedLine(stopped("not_a_class"), C)).toBe(C.classRecordAgainNote);
  });
});
