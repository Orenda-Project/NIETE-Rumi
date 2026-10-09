import { describe, it, expect } from "vitest";
import { SCHEDULE, SAME } from "./copy";
import { untranslated } from "../../teacher/i18n";

describe("bd-4404s7.3 Schedule copy: English and Urdu from day one", () => {
  it("no Urdu is empty, missing or still English (except the listed same-in-both words)", () => {
    expect(untranslated(SCHEDULE, SAME)).toEqual([]);
  });

  it("the locked words: Schedule, New visit, Already booked, Clash, Change", () => {
    expect(SCHEDULE.ur.title).toBe("شیڈول");
    expect(SCHEDULE.ur.newVisit).toBe("نیا دورہ");
    expect(SCHEDULE.ur.alreadyBooked).toBe("پہلے سے بک");
    expect(SCHEDULE.ur.clash).toBe("ٹکراؤ");
    expect(SCHEDULE.ur.change).toBe("تبدیل کریں");
  });

  it("the clash words match the operator's", () => {
    expect(SCHEDULE.en.clashTitle("8:30 AM")).toBe("You already have a visit at 8:30 AM");
    expect(SCHEDULE.en.clashStill).toBe("You can still book it.");
  });
});
