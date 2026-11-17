import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Round 28: the live dashboard shows a card for a new tapped task (letter_pick10, story_mcq_w3) only when some
// session in view has a score for it; the old cards are unchanged and stay unconditional.

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

const spoken = (taskId: string, score: Record<string, number>) => ({
  taskId, mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null,
  itemsPerMin: null, stopReason: "complete", recording: "scored", score,
});
const tap = (taskId: string, correct: number) => ({
  taskId, mode: "tap", attempted: 10, correct, optionsN: 5, chanceCorrected: null,
  itemsPerMin: null, stopReason: "complete", recording: "none", score: null,
});
let n = 0;
function row(tasks: any[]) {
  n += 1;
  const at = `2026-10-27T0${n % 10}:00:00Z`;
  return {
    schoolId: "sch-1", schoolName: "School One", sector: "Urban-I", grade: 3,
    results: { session: { id: `s-${n}`, grade: 3, form: "A", block: "rdf_auto", status: "completed", startedAt: at, endedAt: null, lang: "ur" }, tasks },
  };
}
const today = () => [spoken("ur.letter_sounds5", { correct: 3 }), spoken("ur.story_w3", { correct: 20, per_minute: 24 })];

beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  api.getSwitches.mockResolvedValue({ realDashboard: true });
});

describe("LeaderAssessDashboard: round 28 tasks", () => {
  it("a cohort without the new ids renders no new card; the old cards are there", async () => {
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 6 }, () => row(today())) });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-task-ur.letter_pick10")).toBeNull();
    expect(screen.queryByTestId("dash-task-ur.story_mcq_w3")).toBeNull();
    expect(within(screen.getByTestId("dash-task-ur.letter_sounds5")).getByRole("heading").textContent).toBe("Letter sounds");
    expect(screen.getByTestId("dash-task-ur.story_comp_w3")).toBeTruthy();
  });

  it("one session carrying the picker: its card renders with the new label, the old card unchanged", async () => {
    api.getSessions.mockResolvedValue({ sessions: [...Array.from({ length: 5 }, () => row(today())), row([tap("ur.letter_pick10", 8)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.letter_pick10");
    expect(within(card).getByRole("heading").textContent).toBe("Letter sounds (listen and tap)");
    expect(within(screen.getByTestId("dash-task-ur.letter_sounds5")).getByRole("heading").textContent).toBe("Letter sounds");
    expect(screen.queryByTestId("dash-task-ur.story_mcq_w3")).toBeNull();
  });

  it("Urdu: the picker card carries the Urdu label", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSessions.mockResolvedValue({ sessions: [row([tap("ur.letter_pick10", 8)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(within(screen.getByTestId("dash-task-ur.letter_pick10")).getByRole("heading").textContent).toBe("حروف کی آوازیں (سن کر ٹیپ)");
  });
});
