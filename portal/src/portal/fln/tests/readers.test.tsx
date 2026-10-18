import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-t7zk3t.12 — the teacher app's readers of "plans she used" keep working when one of them is a
 * Reading Hour / Numeracy (FLN) plan (`kind: 'fln'`, `open: { lane: 'fln', planId }` from
 * lp-activity / lp-history). Before this, every non-k5 row was treated as grades 6-12: the Home list
 * asked /lp612/request for a segment that does not exist, "All lesson plans" linked `g612:undefined`,
 * the Lesson Plans page dropped the row, and Coaching offered it as a 6-12 segment to record against.
 *
 *   Home "Lesson plans used" row  → opens /portal/fln/p/<id>
 *   Recent lesson plans           → listed, opens /portal/fln/p/<id>
 *   "All lesson plans" row        → links /portal/fln/p/<id>
 *   Coaching's recent-plan pick   → FLN left out (no FLN coaching yet, SPEC_v2 §6 row 24)
 */

vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getAssessmentDownload: vi.fn() },
}));
import api from "../../services/api";
import HomeList from "../../newui/home/HomeList";
import { mergeRecent } from "../../lib/recentLessonPlans";
import { groupByDay, type HistoryItem } from "../../teacher/lessons/lessonHistory";
import { getRecentPlans } from "../../newui/coaching/coachingApi";
import { recentGroups } from "../../teacher/lessons/recent";
import { flnPlanPath } from "../lib/flnPath";

const RANGE = { key: "this_month", from: "2026-10-01", to: "2026-10-18", timezone: "Asia/Karachi" };
const COUNTS = {
  success: true, range: RANGE,
  lessonPlans: { used: 2, opened: 2, received: 0, days: 2 },
  training: { completed: 0 }, coaching: { total: 0, digitalCoach: 0, observations: 0 },
  assessments: { made: 0 }, attendance: { days: 0, registers: 0, unit: "days" },
};
const FLN_ROW = {
  planKey: "fln:11156", kind: "fln", planId: "11156", lang: "en", found: true,
  title: "Sounds of 'c/k, e, h, r, m, d' (Fluency)", grade: null, subject: "Reading Hour · English",
  chapterNumber: null, chapterTitle: "Level 1 · Grade 1", dayLabel: "Lesson 7/48", pagesLabel: null,
  lastUsedAt: "2026-10-18T05:00:00Z", lastOpenedAt: "2026-10-18T05:00:00Z", lastReceivedAt: null,
  open: { lane: "fln", planId: "11156" },
};
const K5_ROW = {
  planKey: "k5:L1", kind: "k5", lessonId: "L1", found: true, title: "Leaves make food", grade: 4, subject: "Science",
  chapterNumber: 2, chapterTitle: "Plants", dayLabel: "Day 3", pagesLabel: "p.18",
  lastUsedAt: "2026-10-17T05:00:00Z", lastOpenedAt: "2026-10-17T05:00:00Z", lastReceivedAt: null,
  open: { lane: "k5", lessonId: "L1" },
};

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

beforeEach(() => vi.clearAllMocks());

describe("the FLN plan path", () => {
  it("is the deep link route, id encoded", () => {
    expect(flnPlanPath("11156")).toBe("/portal/fln/p/11156");
    expect(flnPlanPath("1/2")).toBe("/portal/fln/p/1%2F2");
  });
});

describe("Home — Lesson plans used", () => {
  it("tapping an FLN plan opens the FLN plan page, never the 6-12 request", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({
      data: url === "/progress" ? COUNTS : { success: true, range: RANGE, metric: "lesson-plans", total: 2, truncated: false, items: [FLN_ROW, K5_ROW] },
    }));
    render(
      <MemoryRouter initialEntries={["/portal/dashboard/lesson-plans"]}>
        <Routes>
          <Route path="/portal/dashboard/:metric" element={<HomeList />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText(FLN_ROW.title));
    expect((await screen.findByTestId("where")).textContent).toBe("/portal/fln/p/11156");
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("Recent lesson plans", () => {
  it("lists an FLN plan with its own key and open, next to k5 unchanged", () => {
    const list = mergeRecent([FLN_ROW, K5_ROW], [], Date.parse("2026-10-18T06:00:00Z"));
    expect(list.map((p) => p.key)).toEqual(["fln:11156", "k5:L1"]);
    expect(list[0]).toMatchObject({ title: FLN_ROW.title, tag: "opened", found: true, open: { lane: "fln", planId: "11156" } });
    expect(list[1].open).toEqual({ lane: "k5", lessonId: "L1" });
  });

  it("the Lessons page's Recent row links the FLN plan page", () => {
    const list = mergeRecent([FLN_ROW, K5_ROW], [], Date.parse("2026-10-18T06:00:00Z"));
    const rows = recentGroups(list, "2026-10-18").flatMap((g) => g.items) as { id: string; to?: string }[];
    expect(rows.find((r) => r.id === "fln:11156")?.to).toBe("/portal/fln/p/11156");
    expect(rows.find((r) => r.id === "k5:L1")?.to).toMatch(/^\/portal\/teacher\/lessons\/open\?plan=k5%3AL1/);
  });

  it("an FLN row without an id is dropped, like any row it cannot open", () => {
    expect(mergeRecent([{ ...FLN_ROW, planId: undefined, open: { lane: "fln" } }], [])).toEqual([]);
  });
});

describe("All lesson plans", () => {
  it("an FLN row links the FLN plan page", () => {
    const item = { ...FLN_ROW, subjectKey: null, day: "2026-10-18", via: "portal", lastUsedAt: FLN_ROW.lastUsedAt } as unknown as HistoryItem;
    const groups = groupByDay([item], "2026-10-18");
    const row = groups[0].items[0] as { to?: string };
    expect(row.to).toBe("/portal/fln/p/11156");
  });
});

describe("Coaching — recent plans to record against", () => {
  it("leaves FLN plans out (there is no FLN coaching yet)", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { plans: [FLN_ROW, K5_ROW] } });
    await waitFor(async () => {
      const plans = await getRecentPlans(20);
      expect(plans.map((p) => p.planKey)).toEqual(["k5:L1"]);
    });
  });
});
