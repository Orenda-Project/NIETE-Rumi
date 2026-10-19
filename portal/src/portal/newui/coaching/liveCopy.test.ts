import { describe, it, expect } from "vitest";
import { untranslated } from "../../teacher/i18n";
import { LIVE_COPY } from "./liveCopy";

// bd-v0toag.31 — the live-moves words a D teacher reads, in both languages (protocol §6.3: nothing falls back to English).
describe("LIVE_COPY", () => {
  it("every string has its Urdu", () => {
    expect(untranslated(LIVE_COPY)).toEqual([]);
  });

  it("Skip is چھوڑیں", () => {
    expect(LIVE_COPY.en.skip).toBe("Skip");
    expect(LIVE_COPY.ur.skip).toBe("چھوڑیں");
  });
});
