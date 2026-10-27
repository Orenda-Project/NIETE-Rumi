import { describe, expect, it } from "vitest";
import { dateLong, dateShort, digits, durButton, fill, isolate, mmss, nOfD, range, recordings, weekday, weeks, LRI, PDI } from "../format";

/** COPY.md §F, one assertion per row, in both languages. */
describe("COPY §F formatter", () => {
  it("weekday comes from the ISO date (26 Oct 2026 is a Monday; 28 Oct a Wednesday)", () => {
    expect(weekday("2026-10-26", "en")).toBe("Mon");
    expect(weekday("2026-10-28", "en")).toBe("Wed");
    expect(weekday("2026-11-01", "en")).toBe("Sun");
    expect(weekday("2026-10-26", "ur")).toBe("پیر");
    expect(weekday("2026-10-28", "ur")).toBe("بدھ");
    expect(weekday("2026-10-30", "ur")).toBe("جمعہ");
  });

  it("weekday is the Karachi calendar day, never shifted by the device's zone", () => {
    // A date string is a calendar day; parsing it as UTC midnight then reading local time would move it in UTC-x zones.
    expect(weekday("2026-11-09", "en")).toBe("Mon");
  });

  it("{date}: weekday + day + month; the year only when it differs from today's", () => {
    expect(dateLong("2026-10-28", "en", "2026-10-26")).toBe("Wed 28 Oct");
    expect(dateLong("2026-10-28", "ur", "2026-10-26")).toBe("بدھ ۲۸ اکتوبر");
    expect(dateLong("2027-01-04", "en", "2026-10-26")).toBe("Mon 4 Jan 2027");
    expect(dateLong("2027-01-04", "ur", "2026-10-26")).toBe("پیر ۴ جنوری ۲۰۲۷");
  });

  it("{date_short} and {range}", () => {
    expect(dateShort("2026-09-28", "en")).toBe("28 Sep");
    expect(dateShort("2026-09-28", "ur")).toBe("۲۸ ستمبر");
    expect(range("2026-09-28", "2026-10-25", "en")).toBe("28 Sep to 25 Oct");
    expect(range("2026-09-28", "2026-10-25", "ur")).toBe("۲۸ ستمبر تا ۲۵ اکتوبر");
  });

  it("{n} of {d}: d first in Urdu", () => {
    expect(nOfD(17, 49, "en")).toBe("17 of 49");
    expect(nOfD(17, 49, "ur")).toBe("۴۹ میں سے ۱۷");
  });

  it("Urdu digits are U+06F0..U+06F9, never Arabic-Indic", () => {
    const s = digits(1234567890, "ur");
    expect(s).toBe("۱۲۳۴۵۶۷۸۹۰");
    expect(/[٠-٩]/.test(s)).toBe(false);
    expect(/[٠-٩]/.test(range("2026-09-28", "2026-10-25", "ur") + nOfD(3, 7, "ur") + dateLong("2026-10-28", "ur", "2026-10-26"))).toBe(false);
  });

  it("{mm:ss} stays ASCII in both languages, isolated in Urdu", () => {
    expect(mmss(1122, "en")).toBe("18:42");
    expect(mmss(1122, "ur")).toBe(`${LRI}18:42${PDI}`);
    expect(mmss(5, "en")).toBe("0:05");
  });

  it("{dur} (the Listen button): ASCII in English, Urdu digits in Urdu", () => {
    expect(durButton(38, "en")).toBe("0:38");
    expect(durButton(38, "ur")).toBe("۰:۳۸");
    expect(durButton(1660, "en")).toBe("27:40");
  });

  it("{weeks} and the recording plural", () => {
    expect(weeks(4, "en")).toBe("4 weeks");
    expect(weeks(8, "ur")).toBe("۸ ہفتے");
    expect(recordings(1, "en")).toBe("1 recording");
    expect(recordings(3, "en")).toBe("3 recordings");
    expect(recordings(1, "ur")).toBe("۱ ریکارڈنگ");
    expect(recordings(3, "ur")).toBe("۳ ریکارڈنگز");
  });

  it("codes and Latin school names are wrapped in LRI…PDI inside Urdu; never in English", () => {
    expect(isolate("T-07", "ur")).toBe(`${LRI}T-07${PDI}`);
    expect(isolate("T-07", "en")).toBe("T-07");
    expect(isolate("سکول", "ur")).toBe("سکول");
  });

  it("fill() writes numbers in the active script and isolates ASCII atoms in Urdu", () => {
    expect(fill("{code} · {n} recordings", { code: "T-07", n: 3 }, "en")).toBe("T-07 · 3 recordings");
    expect(fill("{code}، {n} ریکارڈنگز", { code: "T-07", n: 3 }, "ur")).toBe(`${LRI}T-07${PDI}، ۳ ریکارڈنگز`);
    expect(() => fill("{missing}", {}, "en")).toThrow(/missing/);
  });
});
