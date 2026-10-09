import { describe, it, expect } from "vitest";
import { dayGroups, inSpan, kpiNumbers, pkTime, shouldLoadMore, stepIndex } from "./data";
import type { CoachReport } from "../types";

/**
 * bd-4404s7.5 — the reports lists' arithmetic, from real rows only: which Pakistan day a report falls on, which
 * period it counts in, and the four numbers on the All page. Nothing here invents a number.
 */
const R = (id: string, createdAt: string | null, extra: Partial<CoachReport> = {}): CoachReport => ({
  id, createdAt, teacherName: id, teacherPhone: null, teacherExtId: null, schoolName: null, schoolExtId: null,
  status: "x", step: "sent", score: null, portal: true, ...extra,
});

describe("pkTime / dayGroups", () => {
  it("reads the instant on Pakistan's clock, 24-hour, for TimeStamp", () => {
    expect(pkTime("2026-10-06T06:10:00Z")).toBe("11:10");
    expect(pkTime("2026-10-06T20:00:00Z")).toBe("01:00"); // next day in Pakistan
    expect(pkTime(null)).toBeNull();
  });

  it("groups by Pakistan day, keeping order; an undated report has no group", () => {
    const g = dayGroups([
      R("a", "2026-10-06T20:00:00Z"), // 7 Oct 01:00 PKT
      R("b", "2026-10-06T06:00:00Z"),
      R("c", "2026-10-05T06:00:00Z"),
      R("d", null),
    ]);
    expect(g.map((x) => [x.day, x.items.map((i) => i.id)])).toEqual([
      ["2026-10-07", ["a"]], ["2026-10-06", ["b"]], ["2026-10-05", ["c"]],
    ]);
  });
});

describe("inSpan", () => {
  it("is inclusive on both Pakistan days; null bounds are open", () => {
    const r = R("a", "2026-10-06T06:00:00Z");
    expect(inSpan(r, "2026-10-06", "2026-10-06")).toBe(true);
    expect(inSpan(r, "2026-10-07", "2026-10-09")).toBe(false);
    expect(inSpan(r, null, "2026-10-09")).toBe(true);
    expect(inSpan(R("u", null), null, null)).toBe(false);
  });
});

describe("kpiNumbers", () => {
  const items = [
    R("a", "2026-10-06T06:00:00Z", { score: 80 }),
    R("b", "2026-10-05T06:00:00Z", { score: 60 }),
    R("c", "2026-10-04T06:00:00Z", { score: null, step: "draft" }),
    R("p1", "2026-09-06T06:00:00Z", { score: 50 }),
  ];
  const span = { from: "2026-10-01", to: "2026-10-08", prevFrom: "2026-09-01", prevTo: "2026-09-08" };

  it("counts the range, averages only rows with a score, and compares with the period before", () => {
    const k = kpiNumbers(items, span, 2);
    expect(k.observations).toEqual({ value: 3, delta: 2 });
    expect(k.avg).toEqual({ value: 70, delta: 20 });
    expect(k.sent).toEqual({ value: 2, delta: 1 });
    expect(k.waiting).toEqual({ value: 2, delta: null });
  });

  it("no score in range means no average, never a zero", () => {
    expect(kpiNumbers([R("c", "2026-10-04T06:00:00Z")], span, 0).avg.value).toBeNull();
  });

  it("All time has no period to compare with: no deltas", () => {
    const k = kpiNumbers(items, { from: null, to: "2026-10-08", prevFrom: null, prevTo: null }, 0);
    expect(k.observations).toEqual({ value: 4, delta: null });
    expect(k.avg.delta).toBeNull();
  });
});

describe("shouldLoadMore", () => {
  const span = { from: "2026-10-01", to: "2026-10-08", prevFrom: "2026-09-01", prevTo: "2026-09-08" };
  it("keeps loading while the oldest row is still inside the previous period", () => {
    expect(shouldLoadMore([R("a", "2026-09-05T06:00:00Z")], 90, span)).toBe(true);
  });
  it("stops once a row is older than the previous period, or everything is in", () => {
    expect(shouldLoadMore([R("a", "2026-08-05T06:00:00Z")], 90, span)).toBe(false);
    expect(shouldLoadMore([R("a", "2026-09-05T06:00:00Z")], 1, span)).toBe(false);
  });
  it("All time needs every row", () => {
    expect(shouldLoadMore([R("a", "2020-01-01T00:00:00Z")], 5, { from: null, to: "2026-10-08", prevFrom: null, prevTo: null })).toBe(true);
  });
});

describe("stepIndex", () => {
  it("places a report on the four labelled segments: analysed, form, debrief, sent", () => {
    expect(stepIndex("analysing")).toBe(0);
    expect(stepIndex("draft")).toBe(1);
    expect(stepIndex("talk")).toBe(2);
    expect(stepIndex("report")).toBe(3);
    expect(stepIndex("sent")).toBe(4);
  });
});
