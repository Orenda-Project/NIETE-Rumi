import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Round 7b (items 11–13), behind sa_dash_filters (switches.dashFilters) on the LIVE dashboard: a coach-led / auto filter,
// date from–to (Pakistan days) and a coach filter that apply across the board (tiles, table, task cards), and a
// "Skips and stops" view: every skip and stop by type and by coach (coach × type, heaviest first) and each one listed
// (when, school, grade, mode, type, subtask), honouring the same filters. Off: the page is as before.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ childTestSa: { getSwitches: vi.fn(), getResults: vi.fn(), getSessions: vi.fn() } }));

import { childTestSa } from "../services/api";
import LeaderAssessDashboard from "./LeaderAssessDashboard";

const api = childTestSa as any;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/leader/assess/dashboard"]}>
      <Routes>
        <Route path="/portal/leader/assess/dashboard" element={<LeaderAssessDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

const task = (taskId: string, score: Record<string, number> | null) => ({
  taskId, mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null,
  itemsPerMin: null, stopReason: null, recording: score ? "scored" : "none", score,
});
type Stop = { type: string; taskId: string | null; at: string; by: string | null; data: any };
let n = 0;
function row(o: { mode: "coach_led" | "auto"; coach: "a" | "b"; at: string; stops?: Stop[]; tasks?: boolean; school?: string; grade?: number }) {
  n += 1;
  const id = `s-${n}`;
  const grade = o.grade ?? 3;
  return {
    schoolId: o.school ?? "sch-1", schoolName: o.school === "sch-2" ? "School Two" : "School One", sector: "Urban-I", grade,
    mode: o.mode, block: o.mode === "coach_led" ? "rdf_manual" : "rdf_auto",
    coachId: o.coach === "a" ? "coach-a" : "coach-b", coachName: o.coach === "a" ? "Asim Testwala" : "Bina Testwala",
    startedAt: o.at, stops: o.stops ?? [],
    results: {
      session: { id, grade, form: "A", block: o.mode === "coach_led" ? "rdf_manual" : "rdf_auto", status: "completed", startedAt: o.at, endedAt: null, lang: "ur" },
      tasks: o.tasks === false ? [] : [task("ur.story_w3", { correct: 20, per_minute: 24 }), task("ur.words4", { correct: 3 })],
    },
  };
}
const stop = (type: string, at: string, taskId: string | null = "ur.letter_names5", by = "coach"): Stop => ({ type, taskId, at, by, data: { by } });

function fixture() {
  n = 0;
  const sessions = [
    // coach A: 6 coach-led on 23 Oct, heavy stops
    ...Array.from({ length: 6 }, (_, i) => row({ mode: "coach_led", coach: "a", at: `2026-10-23T0${i}:00:00Z`,
      stops: i < 3 ? [stop("end_section", `2026-10-23T0${i}:10:00Z`), stop("back", `2026-10-23T0${i}:11:00Z`, "ur.words4", "child")] : [] })),
    // coach B: 5 auto on 26 Oct, one silence repeat
    ...Array.from({ length: 5 }, (_, i) => row({ mode: "auto", coach: "b", at: `2026-10-26T0${i}:00:00Z`, school: "sch-2", grade: 5,
      stops: i === 0 ? [stop("silence_repeat", "2026-10-26T00:05:00Z", "en.letter_sounds5", "app")] : [] })),
  ];
  // a test coach A ended at once (no task yet): its stop must still count
  const stopSessions = [row({ mode: "auto", coach: "a", at: "2026-10-24T09:00:00Z", tasks: false, stops: [stop("end_test", "2026-10-24T09:01:00Z")] })];
  return { sessions, stopSessions };
}
const total = () => Number((screen.getByTestId("dash-total").textContent || "").replace(/\D/g, ""));

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
});

describe("LeaderAssessDashboard: round 7b filters and stops (sa_dash_filters)", () => {
  it("off: no mode, date or coach filter and no Skips and stops", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: false });
    api.getSessions.mockResolvedValue({ sessions: fixture().sessions });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-mode-all")).toBeNull();
    expect(screen.queryByTestId("dash-date-from")).toBeNull();
    expect(screen.queryByTestId("dash-coach")).toBeNull();
    expect(screen.queryByTestId("dash-stops")).toBeNull();
  });

  it("item 11: coach-led / auto / all applies to the totals, the table and the task cards", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    await screen.findByTestId("dash-live");
    expect(total()).toBe(11);
    fireEvent.click(screen.getByTestId("dash-mode-coach_led"));
    expect(total()).toBe(6);
    expect(within(screen.getByTestId("dash-groups")).getAllByTestId("dash-group-row")[0]).toHaveTextContent("6");
    expect(screen.getByTestId("dash-showing")).toHaveTextContent(/6 of 11/);
    fireEvent.click(screen.getByTestId("dash-mode-auto"));
    expect(total()).toBe(5);
    fireEvent.click(screen.getByTestId("dash-mode-all"));
    expect(total()).toBe(11);
    expect(screen.queryByTestId("dash-showing")).toBeNull();
  });

  it("item 12: date from–to (Pakistan days) and coach, combinable with the mode", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    await screen.findByTestId("dash-live");
    fireEvent.change(screen.getByTestId("dash-date-from"), { target: { value: "2026-10-25" } });
    expect(total()).toBe(5);
    fireEvent.change(screen.getByTestId("dash-date-from"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("dash-date-to"), { target: { value: "2026-10-23" } });
    expect(total()).toBe(6);
    fireEvent.click(screen.getByTestId("dash-date-clear"));
    expect(total()).toBe(11);
    const coach = screen.getByTestId("dash-coach") as HTMLSelectElement;
    expect(Array.from(coach.options).map((o) => o.textContent)).toEqual(["All coaches", "Asim Testwala", "Bina Testwala"]);
    fireEvent.change(coach, { target: { value: "coach-b" } });
    expect(total()).toBe(5);
    fireEvent.click(screen.getByTestId("dash-mode-coach_led"));
    expect(screen.getByTestId("dash-total")).toHaveTextContent(/^0$|–|0/);
  });

  it("a Pakistan day: 20:00Z on the 22nd is the 23rd in Pakistan", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    n = 0;
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, () => row({ mode: "auto", coach: "a", at: "2026-10-22T20:00:00Z" })), stopSessions: [] });
    renderPage();
    await screen.findByTestId("dash-live");
    fireEvent.change(screen.getByTestId("dash-date-from"), { target: { value: "2026-10-23" } });
    expect(total()).toBe(5);
  });

  it("item 13: every skip and stop by type and by coach (heaviest first), and each one listed", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    const stops = await screen.findByTestId("dash-stops");
    expect(within(stops).getByTestId("dash-stop-total-end_section")).toHaveTextContent("3");
    expect(within(stops).getByTestId("dash-stop-total-back")).toHaveTextContent("3");
    expect(within(stops).getByTestId("dash-stop-total-end_test")).toHaveTextContent("1");
    expect(within(stops).getByTestId("dash-stop-total-silence_repeat")).toHaveTextContent("1");
    expect(within(stops).getByTestId("dash-stop-total-restart")).toHaveTextContent("0");
    expect(within(stops).getByTestId("dash-stop-total-under20_move_on")).toHaveTextContent("0");
    const coaches = within(within(stops).getByTestId("dash-stops-by-coach")).getAllByTestId("dash-stops-coach-row");
    expect(coaches.map((r) => r.getAttribute("data-coach"))).toEqual(["coach-a", "coach-b"]);
    expect(coaches[0]).toHaveTextContent("Asim Testwala");
    expect(coaches[0].getAttribute("data-total")).toBe("7");
    expect(coaches[0].getAttribute("data-sessions")).toBe("7");
    const items = within(within(stops).getByTestId("dash-stops-list")).getAllByTestId("dash-stops-item");
    expect(items).toHaveLength(8);
    const ended = items.find((i) => i.getAttribute("data-type") === "end_test") as HTMLElement;
    expect(ended).toHaveTextContent(/End test/);
    expect(ended).toHaveTextContent(/School One/);
    expect(ended).toHaveTextContent(/Grade 3/);
    expect(ended).toHaveTextContent(/Auto/);
    expect(ended).toHaveTextContent(/Letter names/);
    expect(ended).toHaveTextContent(/24\/10 14:01/);
  });

  it("item 13 honours the filters: coach-led only leaves coach A's end-section and back", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    await screen.findByTestId("dash-stops");
    fireEvent.click(screen.getByTestId("dash-mode-coach_led"));
    const stops = screen.getByTestId("dash-stops");
    expect(within(stops).getByTestId("dash-stop-total-end_test")).toHaveTextContent("0");
    expect(within(stops).getByTestId("dash-stop-total-silence_repeat")).toHaveTextContent("0");
    expect(within(within(stops).getByTestId("dash-stops-list")).getAllByTestId("dash-stops-item")).toHaveLength(6);
    fireEvent.click(screen.getByTestId("dash-mode-auto"));
    fireEvent.change(screen.getByTestId("dash-coach"), { target: { value: "coach-a" } });
    fireEvent.click(screen.getByTestId("dash-mode-coach_led"));
    fireEvent.change(screen.getByTestId("dash-date-from"), { target: { value: "2026-10-27" } });
    expect(within(screen.getByTestId("dash-stops")).getByTestId("dash-stops-none")).toBeInTheDocument();
  });

  it("a single coach (not an admin): no coach picker, their own stops", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    const f = fixture();
    api.getSessions.mockResolvedValue({ sessions: f.sessions.filter((s) => s.coachId === "coach-a"), stopSessions: f.stopSessions });
    renderPage();
    await screen.findByTestId("dash-stops");
    expect(screen.queryByTestId("dash-coach")).toBeNull();
    expect(within(screen.getByTestId("dash-stops-by-coach")).getAllByTestId("dash-stops-coach-row")).toHaveLength(1);
  });

  it("Urdu: the filters and the stops view in Urdu, with Urdu digits", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    const stops = await screen.findByTestId("dash-stops");
    expect(stops.textContent).toMatch(/[؀-ۿ]/);
    expect(within(stops).getByTestId("dash-stop-total-end_section").textContent).toMatch(/۳/);
    expect(screen.getByTestId("dash-mode-coach_led").textContent).toMatch(/[؀-ۿ]/);
  });
});
