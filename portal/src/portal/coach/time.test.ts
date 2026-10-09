import { describe, it, expect } from "vitest";
import { isAllowedSlot, formatSlot } from "./time";
import { parseTime } from "../teacher/ui";

/**
 * bd-o15qnr — the coach app's visit time. The server stores 24-hour "HH:MM" (any half hour, plus three old slots);
 * screens show "9:00 AM". Picking a time is the kit's TimePicker (bd-4404s7.3), tested there.
 */
describe("coach visit time", () => {
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
