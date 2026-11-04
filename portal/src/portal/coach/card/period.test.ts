import { describe, it, expect } from "vitest";
import { SCHOOL_CARD } from "./copy";
import { aheadLine, bucketLabels, dayLabel, perDayLine, perDayOf, periodOf, withPeriod } from "./period";
import type { Bucket } from "./types";

const C = SCHOOL_CARD.en;
const U = SCHOOL_CARD.ur;
const day = (date: string, future = false): Bucket => ({ key: date, label: "", date, future, partial: false });
const WEEK = [day("2026-10-26"), day("2026-10-27"), day("2026-10-28"), day("2026-10-29", true), day("2026-10-30", true)];
const MONTH = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((d) => day(d));

describe("the period in the address", () => {
  it("This week is the default; anything else unknown is too", () => {
    expect(periodOf(null)).toBe("week");
    expect(periodOf("year")).toBe("week");
    expect(periodOf("today")).toBe("today");
    expect(periodOf("month")).toBe("month");
  });
  it("links carry it, except the default", () => {
    expect(withPeriod("/portal/coach/school/1", "week")).toBe("/portal/coach/school/1");
    expect(withPeriod("/portal/coach/school/1", "month")).toBe("/portal/coach/school/1?period=month");
  });
});

describe("bar and column labels", () => {
  it("This week: the weekday over its date", () => {
    expect(bucketLabels("week", WEEK, C)).toEqual([["Mon", "26"], ["Tue", "27"], ["Wed", "28"], ["Thu", "29"], ["Fri", "30"]]);
  });
  it("This month: Wk 1… over its Monday", () => {
    expect(bucketLabels("month", MONTH, C)[0]).toEqual(["Wk 1", "28 Sep"]);
    expect(bucketLabels("month", MONTH, C)[4]).toEqual(["Wk 5", "26 Oct"]);
  });
  it("Urdu labels, same order (the bars stay left to right)", () => {
    expect(bucketLabels("week", WEEK, U).map(([a]) => a)).toEqual(["پیر", "منگل", "بدھ", "جمعرات", "جمعہ"]);
  });
});

describe("about N a day", () => {
  it("rounds the server's number", () => {
    expect(perDayLine("week", 9, 27, C)).toBe("about 9 a day");
    expect(perDayLine("week", 2.6, 8, C)).toBe("about 3 a day");
  });
  it("less than 1 a day when it rounds to 0 and something happened", () => {
    expect(perDayLine("month", 0.3, 5, C)).toBe("less than 1 a day");
    expect(perDayLine("month", 0, 1, C)).toBe("less than 1 a day");
  });
  it("nothing for Today, for nothing done, or for a number that did not load", () => {
    expect(perDayLine("today", 4, 8, C)).toBeNull();
    expect(perDayLine("week", 0, 0, C)).toBeNull();
    expect(perDayLine("week", null, 27, C)).toBeNull();
    expect(perDayLine("week", 3, null, C)).toBeNull();
  });
  it("the grid's own: total over school days so far", () => {
    expect(perDayOf(27, 3)).toBe(9);
    expect(perDayOf(5, 0)).toBeNull();
  });
});

describe("days still ahead", () => {
  it("names them under a week grid", () => {
    expect(aheadLine("week", WEEK, C)).toBe("Thu and Fri are still ahead");
    expect(aheadLine("week", [day("2026-10-30", true)], C)).toBe("Fri is still ahead");
    expect(aheadLine("week", [day("2026-10-28", true), day("2026-10-29", true), day("2026-10-30", true)], C)).toBe("Wed, Thu and Fri are still ahead");
  });
  it("nothing for a month or when no day is ahead", () => {
    expect(aheadLine("month", MONTH, C)).toBeNull();
    expect(aheadLine("week", WEEK.slice(0, 3), C)).toBeNull();
  });
});

describe("a row's day", () => {
  it("Today, Yesterday, then the date", () => {
    expect(dayLabel("2026-10-28", "2026-10-28", C)).toBe("Today");
    expect(dayLabel("2026-10-27", "2026-10-28", C)).toBe("Yesterday");
    expect(dayLabel("2026-10-21", "2026-10-28", C)).toBe("Wed 21 Oct");
    expect(dayLabel("2026-10-01T03:00:00Z", "2026-10-28", C)).toBe("Thu 1 Oct");
  });
  it("an instant is read as a Pakistan day", () => {
    // 20:30 UTC on the 26th is 01:30 on the 27th in Pakistan.
    expect(dayLabel("2026-10-26T20:30:00Z", "2026-10-28", C)).toBe("Yesterday");
  });
  it("no date is a dash", () => {
    expect(dayLabel(null, "2026-10-28", C)).toBe("—");
  });
});
