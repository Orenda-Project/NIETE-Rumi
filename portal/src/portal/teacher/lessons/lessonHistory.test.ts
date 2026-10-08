import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * bd-fmf24g.3 — "All lesson plans": the client for GET /lesson-plans/history and the shaping the
 * page needs — the query from the DateRangeBar's range and the class filter, the four KpiTiles
 * (value, change against the period before, trend), and the list grouped by Pakistan day.
 * Every number comes from the server's counts; nothing here invents one.
 */

vi.mock("../../services/api", () => ({ default: { get: vi.fn() } }));
import api from "../../services/api";
import { historyParams, loadLessonHistory, kpiItems, groupByDay, type HistoryItem } from "./lessonHistory";
import { LESSONS_V2_COPY } from "./copy";
import { openUrl } from "./paths";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
beforeEach(() => vi.clearAllMocks());

const MONTH = { preset: "month", from: "2026-10-01", to: "2026-10-08", prevFrom: "2026-09-01", prevTo: "2026-09-08" };
const ALL = { preset: "all", from: null, to: null, prevFrom: null, prevTo: null };

const ANSWER = {
  success: true,
  range: { key: "custom", from: "2026-10-01", to: "2026-10-08", timezone: "Asia/Karachi" },
  previous: { from: "2026-09-01", to: "2026-09-08" },
  filter: null,
  kpis: {
    lessonPlans: { value: 4, previous: 1 },
    classesCovered: { value: 3, previous: 1 },
    sentOnWhatsapp: { value: 3, previous: 3 },
    daysActive: { value: 4, previous: null },
  },
  trend: { bucketDays: 1, points: [1, 1, 0, 0, 0, 1, 0, 2] },
  items: ([
    { planKey: "k5:a", kind: "k5", found: true, title: "Parts of a plant", grade: 4, subject: "General Science", subjectKey: "science",
      chapterNumber: 1, chapterTitle: "Plants", dayLabel: "Day 1", pagesLabel: "p.2", lastUsedAt: "2026-10-08T04:00:00.000Z",
      day: "2026-10-08", via: "portal", open: { lane: "k5", lessonId: "a" } },
    { planKey: "k5:b", kind: "k5", found: true, title: "How plants make food", grade: 4, subject: "General Science", subjectKey: "science",
      chapterNumber: 1, chapterTitle: "Plants", dayLabel: "Day 2", pagesLabel: "p.4", lastUsedAt: "2026-10-07T20:30:00.000Z",
      day: "2026-10-08", via: "whatsapp", open: { lane: "k5", lessonId: "b" } },
    { planKey: "g612:c", kind: "g612", found: true, title: "Speed", grade: 9, subject: "Physics", subjectKey: "physics",
      chapterNumber: 2, chapterTitle: "Kinematics", dayLabel: null, pagesLabel: "p.10", lastUsedAt: "2026-10-07T05:00:00.000Z",
      day: "2026-10-07", via: "whatsapp", open: { lane: "g612", segmentId: "c", lang: "en" } },
    { planKey: "k5:d", kind: "k5", found: true, title: "Fractions", grade: 5, subject: "Math", subjectKey: "maths",
      chapterNumber: 3, chapterTitle: "Fractions", dayLabel: "Day 1", pagesLabel: "p.40", lastUsedAt: "2026-10-05T05:00:00.000Z",
      day: "2026-10-05", via: "portal", open: { lane: "k5", lessonId: "d" } },
  ] as HistoryItem[]),
  total: 4,
  truncated: false,
};

describe("historyParams — the query, from what the page shows", () => {
  it("a dated range is sent as its own dates, with the period before the page compares against", () => {
    expect(historyParams(MONTH)).toEqual({ range: "custom", from: "2026-10-01", to: "2026-10-08", prevFrom: "2026-09-01", prevTo: "2026-09-08" });
  });

  it("All time is all, with no period before", () => {
    expect(historyParams(ALL)).toEqual({ range: "all" });
  });

  it("a class filter adds grade + subject key", () => {
    expect(historyParams(MONTH, { grade: 4, subjectKey: "science" })).toEqual(expect.objectContaining({ grade: 4, subject: "science" }));
  });
});

describe("loadLessonHistory", () => {
  it("GETs /lesson-plans/history with those params and returns the answer", async () => {
    http.get.mockResolvedValue({ data: ANSWER });
    const h = await loadLessonHistory(MONTH, null);
    expect(http.get).toHaveBeenCalledWith("/lesson-plans/history", { params: historyParams(MONTH) });
    expect(h.kpis.lessonPlans).toEqual({ value: 4, previous: 1 });
    expect(h.items).toHaveLength(4);
  });

  it("a failure throws", async () => {
    http.get.mockResolvedValue({ data: { success: false } });
    await expect(loadLessonHistory(MONTH, null)).rejects.toThrow();
  });
});

describe("kpiItems — the four tiles", () => {
  it("value, change against the period before, the trend under Lesson plans; labels from copy", () => {
    const tiles = kpiItems(ANSWER);
    const C = LESSONS_V2_COPY.all.kpis;
    expect(tiles).toEqual([
      { value: 4, label: C.lessonPlans, delta: 3, trend: [1, 1, 0, 0, 0, 1, 0, 2] },
      { value: 3, label: C.classesCovered, delta: 2 },
      { value: 3, label: C.sentOnWhatsapp, delta: 0 },
      { value: 4, label: C.daysActive },
    ]);
  });

  it("no period before (All time): no change pill", () => {
    const tiles = kpiItems({ ...ANSWER, kpis: { ...ANSWER.kpis, lessonPlans: { value: 4, previous: null } } });
    expect(tiles[0]).not.toHaveProperty("delta");
  });

  it("a trend needs two points", () => {
    expect(kpiItems({ ...ANSWER, trend: { bucketDays: 1, points: [3] } })[0]).not.toHaveProperty("trend");
  });
});

describe("groupByDay — the list, by Pakistan day", () => {
  it("Today, Yesterday, then weekday + date; rows keep the server's order", () => {
    const groups = groupByDay(ANSWER.items, "2026-10-08");
    expect(groups.map((g) => [g.day, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["k5:a", "k5:b"]],
      ["Yesterday", ["g612:c"]],
      ["Mon 5 Oct", ["k5:d"]],
    ]);
  });

  it("each row: the grade and subject, the title, the chapter, how it came, and a link that reopens it by key", () => {
    const [today, yesterday] = groupByDay(ANSWER.items, "2026-10-08");
    const C = LESSONS_V2_COPY.all;
    expect(today.items[0]).toEqual(expect.objectContaining({
      id: "k5:a", grade: 4, subject: "General Science", title: "Parts of a plant", extra: C.chapter(1),
      chip: { text: C.opened, tone: "info" },
      to: openUrl({ plan: "k5:a", title: "Parts of a plant", grade: 4 }),
    }));
    expect(today.items[1]).toEqual(expect.objectContaining({ chip: { text: C.whatsapp, tone: "done" } }));
    expect(yesterday.items[0].to).toBe(openUrl({ plan: "g612:c", lang: "en", title: "Speed", grade: 9 }));
  });

  it("a plan the catalogue no longer has keeps a fallback title", () => {
    const [g] = groupByDay([{ ...ANSWER.items[0], found: false, title: null }], "2026-10-08");
    expect(g.items[0].title).toBe(LESSONS_V2_COPY.planFallback);
  });
});
