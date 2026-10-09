import { describe, it, expect } from "vitest";
import {
  HOURS, defaultMeridiem, stepHour, toSlot, fromSlot, isAllowedSlot, formatSlot, pickHour, DEFAULT_TIME,
} from "./time";
import { parseTime } from "../teacher/ui";

/**
 * bd-o15qnr — the coach app's visit time: three toggles (hour, :00/:30, AM/PM).
 * Hours run 7 to 6. Hours 7–11 default to AM and 12–6 to PM, so a coach who
 * taps an hour never makes an out-of-hours visit by accident. Default 9:00 AM.
 * The server stores 24-hour "HH:MM"; screens show "9:00 AM".
 */
describe("coach visit time", () => {
  it("offers the hours 7 to 6, in order", () => {
    expect(HOURS).toEqual([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]);
  });

  it("defaults 7–11 to AM and 12–6 to PM", () => {
    for (const h of [7, 8, 9, 10, 11]) expect(defaultMeridiem(h)).toBe("AM");
    for (const h of [12, 1, 2, 3, 4, 5, 6]) expect(defaultMeridiem(h)).toBe("PM");
  });

  it("picking an hour sets its default AM/PM", () => {
    expect(pickHour(2)).toEqual({ hour: 2, meridiem: "PM" });
    expect(pickHour(10)).toEqual({ hour: 10, meridiem: "AM" });
  });

  it("steps through the hours and wraps at the ends", () => {
    expect(stepHour(9, 1)).toBe(10);
    expect(stepHour(11, 1)).toBe(12);
    expect(stepHour(12, 1)).toBe(1);
    expect(stepHour(6, 1)).toBe(7);
    expect(stepHour(7, -1)).toBe(6);
  });

  it("starts at 9:00 AM", () => {
    expect(DEFAULT_TIME).toEqual({ hour: 9, minute: 0, meridiem: "AM" });
    expect(toSlot(DEFAULT_TIME)).toBe("09:00");
  });

  it("turns the toggles into a 24-hour slot", () => {
    expect(toSlot({ hour: 2, minute: 30, meridiem: "PM" })).toBe("14:30");
    expect(toSlot({ hour: 12, minute: 0, meridiem: "PM" })).toBe("12:00");
    expect(toSlot({ hour: 11, minute: 30, meridiem: "AM" })).toBe("11:30");
    expect(toSlot({ hour: 6, minute: 30, meridiem: "PM" })).toBe("18:30");
  });

  it("reads a slot back into the toggles", () => {
    expect(fromSlot("14:30")).toEqual({ hour: 2, minute: 30, meridiem: "PM" });
    expect(fromSlot("09:00")).toEqual({ hour: 9, minute: 0, meridiem: "AM" });
    expect(fromSlot("12:00")).toEqual({ hour: 12, minute: 0, meridiem: "PM" });
    expect(fromSlot(null)).toEqual(DEFAULT_TIME);
    expect(fromSlot("morning")).toEqual(DEFAULT_TIME);
  });

  // bd-o15qnr.8: "AM and PM warning can be removed" — every time the toggles can make is bookable.
  it("allows any half hour of the day, plus the old slots", () => {
    expect(isAllowedSlot("07:00")).toBe(true);
    expect(isAllowedSlot("18:30")).toBe(true);
    expect(isAllowedSlot("11:30")).toBe(true);
    expect(isAllowedSlot("19:00")).toBe(true);
    expect(isAllowedSlot("06:30")).toBe(true);
    expect(isAllowedSlot("00:30")).toBe(true);
    expect(isAllowedSlot("23:30")).toBe(true);
    expect(isAllowedSlot("09:15")).toBe(false);
    expect(isAllowedSlot("24:00")).toBe(false);
    expect(isAllowedSlot("")).toBe(false);
  });

  it("shows 12-hour times", () => {
    expect(formatSlot("09:00")).toBe("9:00 AM");
    expect(formatSlot("14:00")).toBe("2:00 PM");
    expect(formatSlot("12:30")).toBe("12:30 PM");
    expect(formatSlot("morning")).toBe("Morning");
    expect(formatSlot(null)).toBe("—");
  });

  it("bd-4404s7.3: a time's words are the kit's TimeStamp clock (every half hour, and the legacy words)", () => {
    for (let h = 0; h < 24; h += 1) {
      for (const m of ["00", "30"]) {
        const slot = `${String(h).padStart(2, "0")}:${m}`;
        const p = parseTime(slot)!;
        expect(formatSlot(slot)).toBe(`${p.hm} ${p.meridiem}`);
      }
    }
    expect(formatSlot("08:30")).toBe("8:30 AM");
    expect(formatSlot("00:00")).toBe("12:00 AM");
    expect(formatSlot("morning")).toBe("Morning");
    expect(formatSlot(null)).toBe("—");
  });
});
