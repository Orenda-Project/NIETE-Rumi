import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.17 (UI half) — the lists behind Home's tiles, as inner pages (deep-screens.html:
 * "Lesson plans used", "Coaching & observations"). A light bar whose breadcrumb is Home; the
 * same date range; the items from GET /api/portal/progress/:metric. Ratings appear only here,
 * and only as a band word.
 */

vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../../services/api";
import HomeList from "./HomeList";

const RANGE = { key: "this_month", from: "2026-10-01", to: "2026-10-03", timezone: "Asia/Karachi" };
const COUNTS = {
  success: true, range: RANGE,
  lessonPlans: { used: 4, opened: 3, received: 2, days: 3 },
  training: { completed: 0 }, coaching: { total: 3, digitalCoach: 1, observations: 2 },
  assessments: { made: 0 }, attendance: { days: 0, registers: 0, unit: "days" },
};

const plan = (over: Record<string, unknown>) => ({
  planKey: "k5:L1", kind: "k5", lessonId: "L1", found: true, title: "Leaves make food", grade: 4, subject: "Science",
  chapterNumber: 2, chapterTitle: "Plants", dayLabel: "Day 3", pagesLabel: "p.18–20",
  lastUsedAt: "2026-10-02T20:30:00Z", lastOpenedAt: "2026-10-02T20:30:00Z", lastReceivedAt: null,
  open: { lane: "k5", lessonId: "L1" }, ...over,
});

const PLANS = {
  success: true, range: RANGE, metric: "lesson-plans", total: 4, truncated: false,
  items: [
    // 20:30 UTC on 2 Oct is 01:30 on 3 Oct in Pakistan: the row says 3.
    plan({}),
    plan({ planKey: "k5:L2", lessonId: "L2", title: "Number discs", subject: "Math", lastUsedAt: "2026-10-01T05:00:00Z", open: { lane: "k5", lessonId: "L2" } }),
    plan({ planKey: "g612:S9", kind: "g612", lessonId: undefined, segmentId: "S9", lang: "en", title: "Newton's laws", grade: 9, subject: "Physics", lastUsedAt: "2026-09-30T05:00:00Z", open: { lane: "g612", segmentId: "S9", lang: "en" } }),
    plan({ planKey: "k5:GONE", lessonId: "GONE", found: false, title: null, grade: null, subject: null, lastUsedAt: "2026-09-29T05:00:00Z", open: { lane: "k5", lessonId: "GONE" } }),
  ],
};

const COACHING = {
  success: true, range: RANGE, metric: "coaching", total: 3, truncated: false,
  items: [
    { id: "s-dc", date: "2026-10-02T05:00:00Z", kind: "digital_coach", observerRole: null, observerName: null, band: "good", topic: null, subject: null },
    { id: "s-co", date: "2026-09-12T05:00:00Z", kind: "observation", observerRole: "coach", observerName: "Noor", band: "average", topic: null, subject: null },
    { id: "s-pr", date: "2026-08-28T05:00:00Z", kind: "observation", observerRole: "principal", observerName: "Sana", band: null, topic: null, subject: null },
  ],
};

function Where() {
  const { pathname, search, state } = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(state ?? null)}>{pathname + search}</output>;
}

function renderList(path: string, history: string[] = []) {
  return render(
    <MemoryRouter initialEntries={[...history, path]} initialIndex={history.length}>
      <Routes>
        <Route path="/portal/dashboard/:metric" element={<HomeList />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function answer(list: unknown, counts: unknown = COUNTS) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === "/progress") return Promise.resolve({ data: counts });
    return Promise.resolve({ data: list });
  });
}

beforeEach(() => vi.clearAllMocks());

describe("Lesson plans used", () => {
  it("is an inner page: light bar, breadcrumb Home, its title", async () => {
    answer(PLANS);
    renderList("/portal/dashboard/lesson-plans");
    expect(screen.getByTestId("newui-inner-bar")).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Home");
    expect(screen.getByRole("heading", { level: 1, name: "Lesson plans used" })).toBeInTheDocument();
    await screen.findByText("Leaves make food");
  });

  it("asks for the same range Home had, and shows it on a light date button with the plan and day counts", async () => {
    answer(PLANS);
    renderList("/portal/dashboard/lesson-plans?range=this_week");
    await screen.findByText("Leaves make food");
    expect(api.get).toHaveBeenCalledWith("/progress/lesson-plans", { params: { range: "this_week" } });
    expect(screen.getByRole("button", { name: "Date range: This week" })).toBeInTheDocument();
    expect(screen.getByText("4 plans")).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });

  it("each plan: the day in Pakistan time in the tile, its title, Grade, subject and month chips", async () => {
    answer(PLANS);
    renderList("/portal/dashboard/lesson-plans");
    const row = (await screen.findByText("Leaves make food")).closest("li")!;
    expect(within(row).getByTestId("newui-row-tile")).toHaveTextContent(/^3$/);
    expect(row).toHaveTextContent("Grade 4");
    expect(row).toHaveTextContent("Science");
    expect(row).toHaveTextContent("Oct");
    expect(row.querySelector("[data-chevron]")).not.toBeNull();
  });

  it("tapping a grades 1-5 plan opens it in the portal's viewer", async () => {
    answer(PLANS);
    renderList("/portal/dashboard/lesson-plans");
    fireEvent.click(await screen.findByRole("button", { name: /Leaves make food/ }));
    const where = await screen.findByTestId("where");
    expect(where).toHaveTextContent("/portal/curriculum");
    expect(JSON.parse(where.getAttribute("data-state")!)).toEqual({
      lessonPlan: { source: { lane: "k5", lessonId: "L1", assetKind: "lesson" }, title: "Leaves make food" },
    });
  });

  it("tapping a grades 6-12 plan asks for it in its language, then opens it", async () => {
    answer(PLANS);
    vi.mocked(api.post).mockResolvedValue({ data: { state: "ready", renderId: "R-77" } });
    renderList("/portal/dashboard/lesson-plans");
    fireEvent.click(await screen.findByRole("button", { name: /Newton's laws/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "S9", lang: "en" }));
    const where = await screen.findByTestId("where");
    expect(JSON.parse(where.getAttribute("data-state")!).lessonPlan.source).toEqual({ lane: "g612", renderId: "R-77" });
  });

  it("a 6-12 plan that is not ready yet says so on its row (amber), and stays put", async () => {
    answer(PLANS);
    vi.mocked(api.post).mockResolvedValue({ data: { state: "authoring", renderId: "R-78" } });
    renderList("/portal/dashboard/lesson-plans");
    fireEvent.click(await screen.findByRole("button", { name: /Newton's laws/ }));
    const chip = await screen.findByText("Preparing");
    expect(chip.className).toMatch(/bg-nu-chip-warning-bg/);
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("a plan no longer in the catalogue is shown, not offered", async () => {
    answer(PLANS);
    renderList("/portal/dashboard/lesson-plans");
    const row = (await screen.findByText("Lesson plan")).closest("li")!;
    expect(within(row).queryByRole("button")).toBeNull();
    expect(row.querySelector("[data-chevron]")).toBeNull();
  });

  it("every target is at least 56px", async () => {
    answer(PLANS);
    renderList("/portal/dashboard/lesson-plans");
    await screen.findByText("Leaves make food");
    expect(tapProblems(document.body)).toEqual([]);
  });
});

describe("Coaching & observations", () => {
  it("is an inner page under Home with the range and the filters All n · Digital Coach · Coach · Principal", async () => {
    answer(COACHING);
    renderList("/portal/dashboard/coaching");
    expect(screen.getByRole("heading", { level: 1, name: "Coaching & observations" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Home");
    await screen.findByText("Coach visit");
    expect(api.get).toHaveBeenCalledWith("/progress/coaching", { params: { range: "this_month" } });
    const filters = screen.getByRole("radiogroup", { name: "Coaching & observations" });
    expect(within(filters).getAllByRole("radio").map((r) => r.textContent)).toEqual(["All 3", "Digital Coach", "Coach", "Principal"]);
    expect(within(filters).getByRole("radio", { name: "All 3" })).toHaveAttribute("aria-checked", "true");
  });

  it("each row: who, the day in its tile, the rating as a band word (good green, average amber), the month; it opens the session", async () => {
    answer(COACHING);
    renderList("/portal/dashboard/coaching");
    const dc = (await screen.findByText("Digital Coach", { selector: "li *" })).closest("a")!;
    expect(dc).toHaveAttribute("href", "/portal/coaching/session/s-dc");
    expect(within(dc).getByTestId("newui-row-tile")).toHaveTextContent(/^2$/);
    expect(within(dc).getByText("Good").className).toMatch(/bg-nu-chip-done-bg/);
    expect(dc).toHaveTextContent("Oct");
    const coach = screen.getByText("Coach visit").closest("a")!;
    expect(within(coach).getByText("Average").className).toMatch(/bg-nu-chip-warning-bg/);
    expect(coach).toHaveTextContent("Sep");
    const principal = screen.getByText("Principal visit").closest("a")!;
    expect(principal).toHaveTextContent("Aug");
    expect(principal.textContent).not.toMatch(/Good|Average/);
  });

  it("a filter narrows the list", async () => {
    answer(COACHING);
    renderList("/portal/dashboard/coaching");
    await screen.findByText("Coach visit");
    fireEvent.click(screen.getByRole("radio", { name: "Principal" }));
    expect(screen.queryByText("Coach visit")).toBeNull();
    expect(screen.getByText("Principal visit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Digital Coach" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("the band words match the portal's own scale", async () => {
    const { BAND_THRESHOLDS } = await import("../../lib/scoreBands");
    const { HOME_COPY } = await import("../copy");
    expect(Object.fromEntries(BAND_THRESHOLDS.map((b) => [b.key, b.label]))).toEqual(HOME_COPY.bands);
  });
});

describe("Home's lists — not there, empty, unknown", () => {
  it("while loading: a spinner word, no list", () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    renderList("/portal/dashboard/coaching");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("when the API fails: Not loaded, and Try again asks again", async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error("502"), { response: { status: 502 } }));
    renderList("/portal/dashboard/lesson-plans");
    expect(await screen.findByText("Not loaded")).toBeInTheDocument();
    answer(PLANS);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Leaves make food")).toBeInTheDocument();
  });

  it("an empty range says Nothing yet", async () => {
    answer({ ...COACHING, total: 0, items: [] }, { ...COUNTS, coaching: { total: 0, digitalCoach: 0, observations: 0 } });
    renderList("/portal/dashboard/coaching");
    expect(await screen.findByText("Nothing yet")).toBeInTheDocument();
  });

  it("an unknown list goes back to Home", async () => {
    answer(PLANS);
    renderList("/portal/dashboard/everything");
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/portal\/dashboard$/);
  });

  it("Back with nothing behind goes to Home, keeping the range", async () => {
    answer(COACHING);
    renderList("/portal/dashboard/coaching?range=this_week");
    await screen.findByText("Coach visit");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/portal/dashboard?range=this_week");
  });
});
