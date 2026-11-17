import { describe, it, expect } from "vitest";
import { madeWhen } from "./format";
import { OBSERVE_COPY, OBSERVE_COPY_UR } from "./copy";
import { TEACHER_UI_COPY, TEACHER_UI_UR } from "../../teacher/ui/copy";

/**
 * bd-brv7rs — when a teacher's own plan was made, in Pakistan time, so two of her plans for the same lesson can be
 * told apart on Check and send (the WhatsApp list got the same in bd-4alcjx). Pakistan's calendar day, not a
 * rolling 24 hours: a plan from 9 pm last night is "Yesterday", not "Today".
 */
const EN = { ...OBSERVE_COPY, am: TEACHER_UI_COPY.am, pm: TEACHER_UI_COPY.pm };
const UR = { ...OBSERVE_COPY_UR, am: TEACHER_UI_UR.am, pm: TEACHER_UI_UR.pm };
// 17 Nov 2026, 15:00 in Pakistan (10:00Z).
const NOW = new Date("2026-11-17T10:00:00Z");

describe("madeWhen (bd-brv7rs)", () => {
  it("today: the Pakistan clock time", () => {
    expect(madeWhen("2026-11-17T03:05:00Z", EN, NOW)).toBe("Today 8:05 AM");
    expect(madeWhen("2026-11-17T06:20:00Z", EN, NOW)).toBe("Today 11:20 AM");
  });

  it("two plans the same day read differently", () => {
    expect(madeWhen("2026-11-17T03:05:00Z", EN, NOW)).not.toBe(madeWhen("2026-11-17T06:20:00Z", EN, NOW));
  });

  it("9 pm last night in Pakistan is Yesterday, even though under 24 hours ago", () => {
    expect(madeWhen("2026-11-16T16:00:00Z", EN, NOW)).toBe("Yesterday 9:00 PM");
  });

  it("just after midnight Pakistan time is Today, though still the previous day in UTC", () => {
    expect(madeWhen("2026-11-16T19:10:00Z", EN, NOW)).toBe("Today 12:10 AM");
  });

  it("older: day, month and time", () => {
    expect(madeWhen("2026-11-12T09:40:00Z", EN, NOW)).toBe("12 Nov 2:40 PM");
  });

  it("speaks Urdu in Urdu", () => {
    expect(madeWhen("2026-11-17T03:05:00Z", UR, NOW)).toBe("آج 8:05 صبح");
    expect(madeWhen("2026-11-16T16:00:00Z", UR, NOW)).toBe("کل 9:00 بعد دوپہر");
    expect(madeWhen("2026-11-12T09:40:00Z", UR, NOW)).toBe("12 نومبر 2:40 بعد دوپہر");
  });

  it("nothing for a missing or broken time (never a made-up one)", () => {
    expect(madeWhen(null, EN, NOW)).toBe("");
    expect(madeWhen("not a date", EN, NOW)).toBe("");
  });
});
