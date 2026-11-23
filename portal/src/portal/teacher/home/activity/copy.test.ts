import { describe, it, expect } from "vitest";
import { ACTIVITY_COPY_UR } from "./copy";
import { JOURNEY_COPY_UR } from "../../journey/copy";

/**
 * Design review (360 px, Urdu): Home's updated line read "بعد دوپہر 8:08" because the whole time, PM word included,
 * sat in a left-to-right isolate. The time goes in as My journey's does; the kit's bidi isolates only the digits.
 */
const LRI = "⁦";
const URDU_TIME = "8:08 بعد دوپہر";

describe("Home activity copy (Urdu)", () => {
  it("never wraps the Urdu AM/PM word in a left-to-right isolate", () => {
    for (const line of [ACTIVITY_COPY_UR.updatedToday(URDU_TIME), ACTIVITY_COPY_UR.updatedYesterday(URDU_TIME)]) {
      expect(line.includes(LRI)).toBe(false);
      expect(line.endsWith(URDU_TIME)).toBe(true);
    }
  });

  it("says the time the same way My journey does", () => {
    expect(ACTIVITY_COPY_UR.updatedToday(URDU_TIME)).toBe(JOURNEY_COPY_UR.updatedToday(URDU_TIME));
  });

  // Design review #3 (bd-96f69c.18): two labels wrapped to two Nastaliq lines at 360 px.
  it("the Urdu tile labels are short (lesson plans opened, coaching observations)", () => {
    expect(ACTIVITY_COPY_UR.opened).toBe("لیسن پلان کھولے");
    expect(ACTIVITY_COPY_UR.coached).toBe("کوچنگ مشاہدات");
    expect(ACTIVITY_COPY_UR.paper).toBe("پرچہ");
  });
});
