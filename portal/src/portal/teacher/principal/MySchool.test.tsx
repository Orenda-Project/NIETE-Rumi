import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-33wxxi.3 — the principal app's Analytics › My school (#55, Analytics A): the coach's School view for her own school,
 * drawn with the coach card's own pieces (PeriodChips, LevelChips, OverviewCard countsOnly, the Teachers section and its
 * TeacherTable), counts only (#55 Q1). A row opens that teacher's Analytics page (the bands a teacher sees about herself).
 * No Where to coach, no Manage, no coach-observations table. Only for a principal on the principal app; another principal
 * keeps the earlier My school view.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getMyAnalytics: vi.fn(), getConfig: vi.fn() },
  leader: { getSchoolAnalytics: vi.fn(), getTeachers: vi.fn() },
}));

import "../routes";
import api, { portal, leader } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import i18n from "@/i18n/config";
import analyticsRoutes from "../analytics/routes";
import { ANALYTICS_HOME } from "../analytics/paths";
import { oneTeacherPath } from "../analytics/school";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

preloadFirst(() => preloadAll({ pages: true }), 120_000);

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };

const row = (id: string, ext: string, name: string, lp: number, dc: number, training: number, papers: number) => ({
  id, teacherExtId: ext, name, isPrincipal: false, levels: ["PRIMARY"],
  counts: { lp, dc, training, papers }, total: lp + dc + training + papers, contributionPct: null, star: false, lastVisitDaysAgo: null,
});
const CARD = {
  success: true,
  school: { emis: "1126", name: "GGPS Sample", teachers: 3, lastVisitDaysAgo: null, principals: [] },
  period: { key: "week" },
  level: null, levels: { PRIMARY: 2, MIDDLE: 1 },
  overview: {
    teachers: 3, active: { now: 2, prev: 1 },
    lp: { total: 9, makers: 2, perTeacherDay: 0.6, prev: { total: 4, perTeacherDay: 0.3 } },
    training: { modules: 3, makers: 1, prev: { modules: 1 } }, papers: { total: 2, makers: 1, prev: { total: 0 } },
  },
  tiles: [],
  teachers: [row("u-a", "900001", "Ayesha Sample", 7, 2, 3, 1), row("u-b", "900002", "Bina Sample", 2, 1, 0, 1), row("u-c", "900003", "Comal Sample", 0, 0, 0, 0)],
  scores: { dc: { count: 3, makers: 2 }, coach: { count: 1, makers: 1 } },
};

function serve({ principalApp = true, card = CARD as unknown } = {}) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features: { teacherV2: true, principalApp } } as never);
  vi.mocked(portal.getMyAnalytics).mockResolvedValue({ success: true, analytics: {}, presence: null, remarksReceived: [] } as never);
  vi.mocked(leader.getSchoolAnalytics).mockResolvedValue({ success: true, school: { name: "Old view", totalTeachers: 3 }, analytics: {} } as never);
  vi.mocked(leader.getTeachers).mockResolvedValue({ success: true, teachers: [] } as never);
  http.get.mockImplementation((url: string) => {
    if (url === "/principal/school/card") return card instanceof Error ? Promise.reject(card) : Promise.resolve({ data: card });
    if (url === "/progress") return Promise.resolve({ data: { success: true, counts: {} } });
    return Promise.resolve({ data: { success: true } });
  });
}

let where = "";
function Where() { where = `${useLocation().pathname}${useLocation().search}`; return null; }

function renderAnalytics(path = ANALYTICS_HOME) {
  vi.mocked(useAuth).mockReturnValue({ user: PRINCIPAL, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>{analyticsRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
    </MemoryRouter>,
  );
}

const cardCalls = () => http.get.mock.calls.filter((c) => c[0] === "/principal/school/card");

describe("Analytics › My school, the principal app", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    forgetConfig();
    await i18n.changeLanguage("en");
  });

  it("the coach's School view pieces for her own school: period, levels, the overview, the teacher table", async () => {
    serve();
    renderAnalytics();
    const ov = await screen.findByTestId("overview", {}, { timeout: 8000 });
    await waitFor(() => expect(within(ov).getByTestId("used-count").textContent).toBe("2 of 3"));
    expect(screen.getByText("GGPS Sample · 3 teachers")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "This month" })).toBeTruthy();
    expect(screen.getByTestId("teacher-table")).toBeTruthy();
    expect(cardCalls()[0][1]).toEqual({ params: { period: "week" } });
  });

  it("Q1: the DC and coach boxes are counts with by-N-of-M, never an average", async () => {
    serve();
    renderAnalytics();
    const dc = await screen.findByTestId("box-dc", {}, { timeout: 8000 });
    await waitFor(() => expect(within(dc).getByTestId("box-number").textContent).toBe("3"));
    expect(within(dc).getByText("DC observations")).toBeTruthy();
    expect(within(dc).getByText("by 2 of 3 teachers")).toBeTruthy();
    const coach = screen.getByTestId("box-coach");
    expect(within(coach).getByTestId("box-number").textContent).toBe("1");
    expect(within(coach).getByText("coach observation")).toBeTruthy();
    expect(within(coach).getByText("by 1 of 3 teachers")).toBeTruthy();
    expect(screen.getByTestId("overview").textContent).not.toMatch(/%|average/i);
  });

  it("the boxes are information, not links (there is no principal page behind them)", async () => {
    serve();
    renderAnalytics();
    const ov = await screen.findByTestId("overview", {}, { timeout: 8000 });
    await waitFor(() => expect(within(ov).getByTestId("used-count").textContent).toBe("2 of 3"));
    expect(within(ov).queryAllByRole("link")).toHaveLength(0);
    // and nothing tells her to tap one
    expect(within(ov).queryByText(/tap a box/i)).toBeNull();
  });

  it("a teacher row opens that teacher's Analytics page (by her id)", async () => {
    serve();
    renderAnalytics();
    const table = await screen.findByTestId("teacher-table", {}, { timeout: 8000 });
    const rows = within(table).getAllByRole("link");
    expect(rows.map((a) => a.getAttribute("href"))).toEqual([oneTeacherPath("u-a"), oneTeacherPath("u-b"), oneTeacherPath("u-c")]);
  });

  it("a coach's extras are not here: no Where to coach, no Manage, no coach-observations table", async () => {
    serve();
    renderAnalytics();
    await screen.findByTestId("teacher-table", {}, { timeout: 8000 });
    expect(screen.queryByTestId("first-door")).toBeNull();
    expect(screen.queryByTestId("where-door")).toBeNull();
    expect(screen.queryByTestId("coach-obs-table")).toBeNull();
    expect(screen.queryByTestId("no-coach-obs")).toBeNull();
    expect(screen.queryByText(/Manage/)).toBeNull();
  });

  it("This month: asks the server again for the month", async () => {
    serve();
    renderAnalytics();
    await screen.findByTestId("teacher-table", {}, { timeout: 8000 });
    await userEvent.click(screen.getByRole("radio", { name: "This month" }));
    await waitFor(() => expect(cardCalls().some((c) => c[1].params.period === "month")).toBe(true));
    expect(where).toContain("period=month");
  });

  it("her row names no school: No school, nothing else", async () => {
    serve({ card: { success: true, school: null } });
    renderAnalytics();
    await waitFor(() => expect(screen.getByText("No school")).toBeTruthy(), { timeout: 8000 });
    expect(screen.queryByTestId("teacher-table")).toBeNull();
  });

  it("a principal the switch does not name keeps the earlier My school view", async () => {
    serve({ principalApp: false });
    renderAnalytics();
    await waitFor(() => expect(vi.mocked(leader.getSchoolAnalytics)).toHaveBeenCalled());
    expect(cardCalls()).toHaveLength(0);
  });

  it("in Urdu: the coach box's word is the reviewed Urdu term", async () => {
    await i18n.changeLanguage("ur");
    serve();
    renderAnalytics();
    const coach = await screen.findByTestId("box-coach", {}, { timeout: 8000 });
    await waitFor(() => expect(within(coach).getByTestId("box-number").textContent).toBe("1"));
    // its name and its word are the same reviewed term, as on the Assessments box (the house pattern)
    expect(within(coach).getAllByText("کوچ کے مشاہدات").length).toBe(2);
    expect(within(coach).queryByText(/اوسط/)).toBeNull();
  });
});
