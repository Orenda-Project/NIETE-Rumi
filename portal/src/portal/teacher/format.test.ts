import { describe, it, expect } from "vitest";
import { shortDayLabel, todayLabel } from "./format";

/**
 * shortDayLabel: the look band's date, short ("Fri 23 Oct"); in Urdu todayLabel's own day and month words with
 * Western digits («جمعہ 23 اکتوبر»). The day is Pakistan's, whatever the device's clock zone.
 */
describe("shortDayLabel", () => {
  const FRI = new Date("2026-10-23T07:00:00Z");

  it("English: short weekday, day, short month", () => {
    expect(shortDayLabel(FRI, "en")).toBe("Fri 23 Oct");
  });

  it("Urdu: the Urdu day and month, Western digits", () => {
    expect(shortDayLabel(FRI, "ur")).toBe("جمعہ 23 اکتوبر");
  });

  it("the day is Pakistan's: 21:00Z on the 22nd is already Friday the 23rd", () => {
    expect(shortDayLabel(new Date("2026-10-22T21:00:00Z"), "en")).toBe("Fri 23 Oct");
  });

  it("todayLabel is untouched (the long form)", () => {
    expect(todayLabel(FRI, "en")).toBe("Friday 23 October");
    expect(todayLabel(FRI, "ur")).toBe("جمعہ 23 اکتوبر");
  });
});
