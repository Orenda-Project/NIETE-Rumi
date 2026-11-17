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

// Round 28 (SPEC F): the headline "reading with comprehension" per form. One form: one number, today's tile. Both:
// two labelled numbers side by side, never one pooled share.
const comp = (correct: number) => spoken("ur.story_comp_w3", { correct, of: 4 });
const mcq = (correct: number) => ({ ...tap("ur.story_mcq_w3", correct), attempted: 6, optionsN: 4 });

describe("LeaderAssessDashboard: round 28 headline split", () => {
  it("a mixed cohort shows spoken and tapped apart with their labels, and no pooled number", async () => {
    // spoken: 2 of 3 at 80%+ (67%); tapped: 3 of 3 (100%); a pooled share would read 83%
    api.getSessions.mockResolvedValue({ sessions: [row([comp(4)]), row([comp(4)]), row([comp(1)]), row([mcq(5)]), row([mcq(6)]), row([mcq(5)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    const tile = screen.getByTestId("dash-rwc");
    expect(within(tile).getByTestId("dash-rwc-spoken").textContent).toBe("spoken67%");
    expect(within(tile).getByTestId("dash-rwc-tapped").textContent).toBe("listen and tap100%");
    expect(tile.textContent).not.toContain("83%");
    const cell = within(screen.getAllByTestId("dash-group-row")[0]).getByTestId("dash-group-rwc");
    expect(cell.textContent).toBe("spoken 67% · listen and tap 100%");
  });

  it("Urdu: the two labels are «بول کر» and «سن کر ٹیپ»", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSessions.mockResolvedValue({ sessions: [row([comp(4)]), row([comp(4)]), row([comp(1)]), row([mcq(5)]), row([mcq(6)]), row([mcq(5)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.getByTestId("dash-rwc-spoken").textContent).toContain("بول کر");
    expect(screen.getByTestId("dash-rwc-tapped").textContent).toContain("سن کر ٹیپ");
  });

  it("an old-form-only cohort renders today's tile: one number, no split", async () => {
    api.getSessions.mockResolvedValue({ sessions: [row([comp(4)]), row([comp(4)]), row([comp(1)]), row([comp(4)]), row([comp(2)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-rwc-spoken")).toBeNull();
    expect(screen.queryByTestId("dash-rwc-tapped")).toBeNull();
    expect(screen.getByTestId("dash-rwc").textContent).toBe("Read with comprehension · Urdu60%80% or more of the passage questions right");
  });

  it("a tapped-only cohort shows one number, named as the tapped form", async () => {
    api.getSessions.mockResolvedValue({ sessions: [row([mcq(5)]), row([mcq(6)]), row([mcq(2)]), row([mcq(5)]), row([mcq(5)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-rwc-spoken")).toBeNull();
    expect(screen.getByTestId("dash-rwc").textContent).toContain("80%");
    expect(screen.getByTestId("dash-rwc").textContent).toContain("listen and tap");
  });
});
