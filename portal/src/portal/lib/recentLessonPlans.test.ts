import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * bd-k23p38 — her recent lesson plans, for the Lesson Plans page (the old look and the new).
 *
 * "The page should show her last 10 lesson plans opened. it can be 1-12, any." … "on whatsapp
 * too." (operator, 7 Oct 2026). One list for every grade: the plans she used, from
 * GET /lesson-plans/recent (opened in the portal OR sent on WhatsApp, both grade bands), plus the
 * grades 6-12 plans she asked for here that the recent ledgers cannot know about yet — one still
 * being written (Preparing) and one written while she was away and never opened (Ready). That
 * second source is what "My lesson plans" existed for; it now lands in the same list.
 */

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../services/api";
import { RECENT_LIMIT, loadRecentLessonPlans, mergeRecent, whenLabel } from "./recentLessonPlans";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

// 7 Oct 2026, 12:00 in Pakistan (UTC+5).
const NOW = Date.parse("2026-10-07T07:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const k5 = (id: string, extra: Record<string, unknown> = {}) => ({
  planKey: `k5:${id}`, kind: "k5", lessonId: id, found: true, title: `Plan ${id}`, grade: 4, subject: "General Science",
  chapterNumber: 2, chapterTitle: "Plants", dayLabel: "Day 2", pagesLabel: null,
  lastUsedAt: ago(HOUR), lastOpenedAt: ago(HOUR), lastReceivedAt: null,
  open: { lane: "k5", lessonId: id }, ...extra,
});
const g612 = (seg: string, extra: Record<string, unknown> = {}) => ({
  planKey: `g612:${seg}`, kind: "g612", segmentId: seg, lang: "en", found: true, title: `Lesson ${seg}`, grade: 9,
  subject: "Physics", chapterNumber: 3, chapterTitle: "Dynamics", dayLabel: null, pagesLabel: null,
  lastUsedAt: ago(2 * HOUR), lastOpenedAt: ago(2 * HOUR), lastReceivedAt: null,
  open: { lane: "g612", segmentId: seg, lang: "en" }, ...extra,
});
const mine = (renderId: string, seg: string, state: string, extra: Record<string, unknown> = {}) => ({
  renderId, segmentId: seg, state, lang: "en", startedAt: ago(3 * MIN), completedAt: null,
  title: `Asked ${seg}`, grade: 10, subject: "Chemistry", ...extra,
});

describe("mergeRecent — one list, any grade, newest first", () => {
  it("names each plan by how she last had it: opened in the portal, or sent on WhatsApp", () => {
    const list = mergeRecent([
      k5("A", { lastUsedAt: ago(HOUR), lastOpenedAt: ago(HOUR), lastReceivedAt: ago(DAY) }),
      g612("S1", { lastUsedAt: ago(2 * HOUR), lastOpenedAt: ago(3 * DAY), lastReceivedAt: ago(2 * HOUR) }),
      k5("B", { lastUsedAt: ago(3 * HOUR), lastOpenedAt: null, lastReceivedAt: ago(3 * HOUR) }),
    ], [], NOW);
    expect(list.map((p) => [p.key, p.tag, p.at])).toEqual([
      ["k5:A", "opened", ago(HOUR)],
      ["g612:S1:en", "whatsapp", ago(2 * HOUR)],
      ["k5:B", "whatsapp", ago(3 * HOUR)],
    ]);
    expect(list[0]).toMatchObject({ title: "Plan A", grade: 4, subject: "General Science", chapterTitle: "Plants", dayLabel: "Day 2", found: true });
    expect(list[0].open).toEqual({ lane: "k5", lessonId: "A" });
    expect(list[1].open).toEqual({ lane: "g612", segmentId: "S1", lang: "en", renderId: null });
  });

  it("a grades 6-12 plan still being written goes FIRST, as Preparing, with its render", () => {
    const list = mergeRecent([k5("A")], [mine("R9", "S9", "authoring", { startedAt: ago(2 * MIN) })], NOW);
    expect(list.map((p) => [p.key, p.tag])).toEqual([["g612:S9:en", "preparing"], ["k5:A", "opened"]]);
    expect(list[0]).toMatchObject({ title: "Asked S9", grade: 10, subject: "Chemistry", at: ago(2 * MIN) });
    expect(list[0].open).toEqual({ lane: "g612", segmentId: "S9", lang: "en", renderId: "R9" });
  });

  it("one written while she was away and never opened is listed as Ready, at the time it was written", () => {
    const list = mergeRecent(
      [k5("A", { lastUsedAt: ago(HOUR), lastOpenedAt: ago(HOUR) }), k5("B", { lastUsedAt: ago(5 * HOUR), lastOpenedAt: ago(5 * HOUR) })],
      [mine("R5", "S5", "ready", { startedAt: ago(3 * HOUR), completedAt: ago(3 * HOUR - 3 * MIN) })],
      NOW,
    );
    expect(list.map((p) => [p.key, p.tag])).toEqual([["k5:A", "opened"], ["g612:S5:en", "ready"], ["k5:B", "opened"]]);
    expect(list[1].open).toEqual({ lane: "g612", segmentId: "S5", lang: "en", renderId: "R5" });
  });

  it("a plan already in the recent list is not listed twice; the same lesson asked twice is listed once", () => {
    const list = mergeRecent(
      [g612("S1")],
      [
        mine("R1", "S1", "ready", { completedAt: ago(10 * MIN) }),
        mine("R2", "S2", "ready", { startedAt: ago(DAY), completedAt: ago(DAY) }),
        mine("R3", "S2", "ready", { startedAt: ago(2 * DAY), completedAt: ago(2 * DAY) }),
      ],
      NOW,
    );
    expect(list.map((p) => p.key)).toEqual(["g612:S1:en", "g612:S2:en"]);
    expect(list[1].open).toMatchObject({ renderId: "R2" });
  });

  it("the same lesson in the other language is another plan", () => {
    const list = mergeRecent([g612("S1")], [mine("R4", "S1", "ready", { lang: "ur", completedAt: ago(10 * MIN) })], NOW);
    expect(list.map((p) => p.key)).toEqual(["g612:S1:ur", "g612:S1:en"]);
  });

  it("leaves out a failed write, and a 'still writing' that has gone quiet for half an hour", () => {
    const list = mergeRecent([k5("A")], [
      mine("RF", "SF", "failed"),
      mine("RS", "SS", "authoring", { startedAt: ago(31 * MIN) }),
      mine("RN", "SN", "authoring", { startedAt: null }),
    ], NOW);
    expect(list.map((p) => p.key)).toEqual(["k5:A"]);
  });

  it(`shows at most ${RECENT_LIMIT}, a plan being written always among them`, () => {
    const recent = Array.from({ length: 12 }, (_, i) => k5(`L${i}`, { lastUsedAt: ago((i + 1) * HOUR), lastOpenedAt: ago((i + 1) * HOUR) }));
    const list = mergeRecent(recent, [mine("R9", "S9", "authoring")], NOW);
    expect(RECENT_LIMIT).toBe(10);
    expect(list).toHaveLength(10);
    expect(list[0].tag).toBe("preparing");
    expect(list[9].key).toBe("k5:L8");
  });
});

describe("loadRecentLessonPlans — what it asks for", () => {
  beforeEach(() => vi.clearAllMocks());

  it("her last 10 from /lesson-plans/recent, and what she asked for from /lp612/mine", async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url === "/lesson-plans/recent") return { data: { success: true, plans: [k5("A")] } };
      if (url === "/lp612/mine") return { data: { success: true, lessons: [mine("R9", "S9", "authoring", { startedAt: new Date(Date.now() - MIN).toISOString() })] } };
      throw new Error(url);
    });
    const list = await loadRecentLessonPlans();
    expect(http.get).toHaveBeenCalledWith("/lesson-plans/recent", { params: { limit: 10 } });
    expect(http.get).toHaveBeenCalledWith("/lp612/mine");
    expect(list.map((p) => p.tag)).toEqual(["preparing", "opened"]);
  });

  it("/lp612/mine failing costs her nothing but the plans being written", async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url === "/lesson-plans/recent") return { data: { success: true, plans: [k5("A")] } };
      throw new Error("502");
    });
    expect((await loadRecentLessonPlans()).map((p) => p.key)).toEqual(["k5:A"]);
  });

  it("/lesson-plans/recent failing is a failure (the page then shows no list)", async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url === "/lp612/mine") return { data: { lessons: [] } };
      throw new Error("502");
    });
    await expect(loadRecentLessonPlans()).rejects.toThrow();
  });
});

describe("whenLabel — when, in Pakistan time, as a teacher says it", () => {
  it.each([
    [ago(20 * 1000), "Just now"],
    [ago(5 * MIN), "5m ago"],
    [ago(3 * HOUR), "3h ago"],
    ["2026-10-06T15:00:00Z", "Yesterday"], // 6 Oct, 20:00 PKT
    ["2026-10-05T03:00:00Z", "Mon"], // 5 Oct, 08:00 PKT
    ["2026-09-27T09:00:00Z", "27 Sep"],
  ])("%s → %s", (iso, label) => {
    expect(whenLabel(iso, NOW)).toBe(label);
  });

  it("just past midnight in Pakistan, 3 hours ago is yesterday", () => {
    const night = Date.parse("2026-10-06T20:30:00Z"); // 7 Oct, 01:30 PKT
    expect(whenLabel("2026-10-06T17:30:00Z", night)).toBe("Yesterday"); // 6 Oct, 22:30 PKT
  });

  it("no time, no label", () => {
    expect(whenLabel(null, NOW)).toBeNull();
  });
});
