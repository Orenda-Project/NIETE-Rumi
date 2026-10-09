import { describe, it, expect } from "vitest";
import { bookedOn, clashesAt, dayLong, dayShort, monthYear, shiftDay, sinceText, sinceTone, timeWords, weekMonth } from "./model";
import { SCHEDULE_COPY as EN, SCHEDULE_COPY_UR as UR } from "./copy";
import { TEACHER_UI_COPY, TEACHER_UI_UR } from "../../teacher/ui/copy";
import type { CoachVisit } from "../types";

const v = (id: string, day: string, slot: string | null, status = "upcoming"): CoachVisit =>
  ({ id, teacherName: id, schoolName: "S", scheduledFor: day, scheduledSlot: slot, status });

describe("bd-4404s7.3 schedule model", () => {
  it("bookedOn keeps one day, in time order, without the visit being moved or a cancelled one", () => {
    const all = [v("c", "2026-10-07", "14:00"), v("a", "2026-10-07", "08:30"), v("x", "2026-10-08", "08:30"), v("m", "2026-10-07", "09:00"), v("z", "2026-10-07", "10:00", "cancelled")];
    expect(bookedOn(all, "2026-10-07", "m").map((x) => x.id)).toEqual(["a", "c"]);
    expect(bookedOn(null, "2026-10-07")).toEqual([]);
  });

  it("clashesAt matches the exact slot only, and nothing for no slot", () => {
    const booked = [v("a", "d", "08:30"), v("b", "d", "08:30"), v("c", "d", "09:00")];
    expect(clashesAt(booked, "08:30").map((x) => x.id)).toEqual(["a", "b"]);
    expect(clashesAt(booked, "08:00")).toEqual([]);
    expect(clashesAt(booked, null)).toEqual([]);
  });

  it("sinceTone: none or over 30 days is waiting, 8 to 30 info, within a week done", () => {
    expect([null, 31, 41].map(sinceTone)).toEqual(["waiting", "waiting", "waiting"]);
    expect([8, 21, 30].map(sinceTone)).toEqual(["info", "info", "info"]);
    expect([0, 3, 7].map(sinceTone)).toEqual(["done", "done", "done"]);
  });

  it("sinceText: none, today, or N days ago", () => {
    expect(sinceText(null, EN)).toBe("No visits yet");
    expect(sinceText(0, EN)).toBe("Today");
    expect(sinceText(41, EN)).toBe("41 days ago");
    expect(sinceText(0, UR)).toBe("آج");
  });

  it("timeWords says the time with the kit's AM/PM words, in both languages", () => {
    expect(timeWords("08:30", TEACHER_UI_COPY)).toBe("8:30 AM");
    expect(timeWords("14:00", TEACHER_UI_COPY)).toBe("2:00 PM");
    expect(timeWords("08:30", TEACHER_UI_UR)).toBe("8:30 صبح");
    expect(timeWords("morning", TEACHER_UI_COPY)).toBe("morning");
    expect(timeWords(null, TEACHER_UI_COPY)).toBe("");
  });

  it("day words come from the copy, in the day's own calendar (no time zone slip)", () => {
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(dayShort("2026-10-07", EN)).toBe("Wed 7");
    expect(dayShort("2026-10-07", UR)).toBe("بدھ 7");
    expect(dayLong("2026-10-07", EN)).toBe("Wednesday 7 October");
    expect(dayLong("2026-10-07", UR)).toBe("بدھ 7 اکتوبر");
    expect(monthYear("2026-10-07", EN)).toBe("October 2026");
    expect(weekMonth(["2026-10-04", "2026-10-10"], EN)).toBe("October 2026");
    expect(weekMonth(["2026-09-27", "2026-10-03"], EN)).toBe("September – October 2026");
  });
});
