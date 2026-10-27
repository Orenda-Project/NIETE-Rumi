import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Round 7b item 14 (sa_cwpm, switches.cwpm): every words-per-minute number is correct words per minute and reads
// "CWPM", with its formula: the dashboard's tile, task card, table column and rules; the per-session Results row of a
// words task (familiar words, passage); the review page's app score of a words task. Letters and maths keep
// "per minute". Off: the words as before.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ childTestSa: { getSwitches: vi.fn(), getResults: vi.fn(), getSessions: vi.fn(), getReview: vi.fn(), markReviewItem: vi.fn() } }));

import { childTestSa } from "../services/api";
import LeaderAssessDashboard from "./LeaderAssessDashboard";
import LeaderAssessResults from "./LeaderAssessResults";
import LeaderAssessReview from "./LeaderAssessReview";

const api = childTestSa as any;
const SID = "cccccccc-0000-4000-8000-000000000003";

const page = (path: string, route: string, el: JSX.Element) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>,
);
const task = (taskId: string, mode: string, score: Record<string, number> | null, extra: Record<string, unknown> = {}) => ({
  taskId, mode, attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "time_up",
  recording: score ? "scored" : "none", score, ...extra,
});
const RESULTS = {
  status: "ok",
  session: { id: SID, grade: 3, form: "A", block: "rdf_auto", status: "completed", startedAt: "2026-10-27T05:00:00Z", endedAt: "2026-10-27T05:20:00Z", lang: "ur" },
  tasks: [
    task("ur.story_w3", "record", { correct: 30, attempted: 34, per_minute: 36, seconds_used: 50 }),
    task("ur.letter_names5", "record", { correct: 4, attempted: 5, per_minute: 24, seconds_used: 10 }),
  ],
};
const session = (i: number) => ({
  schoolId: "sch-1", schoolName: "School One", sector: "Urban-I", grade: 3,
  results: { session: { id: `s-${i}`, grade: 3, form: "A", block: "rdf_auto", status: "completed", startedAt: "2026-10-27T05:00:00Z", endedAt: null, lang: "ur" },
    tasks: [task("ur.story_w3", "record", { correct: 20, attempted: 22, per_minute: 24, seconds_used: 50 })] },
});
const review = () => ({
  session: { id: SID, grade: 3, block: "rdf_auto", status: "completed", startedAt: "2026-10-27T05:00:00Z", endedAt: "2026-10-27T05:30:00Z", minutes: 30 },
  fixAt: "2026-10-22T06:37:45Z",
  tasks: [
    { taskId: "ur.words4", mode: "record", timeUsedS: 7.8, app: { correct: 3, attempted: 4, of: null, perMinute: 23.1 }, scoredAt: null, scoredAfterFix: null, clips: [], items: [], agreement: { reviewed: 0, earAgreesWithApp: 0, agentsAgreeWithApp: 0, withAgents: 0 } },
    { taskId: "ur.letter_names5", mode: "record", timeUsedS: 10, app: { correct: 4, attempted: 5, of: null, perMinute: 24 }, scoredAt: null, scoredAfterFix: null, clips: [], items: [], agreement: { reviewed: 0, earAgreesWithApp: 0, agentsAgreeWithApp: 0, withAgents: 0 } },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
});

describe("CWPM (sa_cwpm)", () => {
  it("dashboard ON: the tile, the task card and the rule say CWPM and its formula", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, cwpm: true });
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, (_, i) => session(i)) });
    page("/d", "/d", <LeaderAssessDashboard />);
    expect(await screen.findByTestId("dash-orf")).toHaveTextContent(/CWPM \(median\)/);
    const card = screen.getByTestId("dash-task-ur.story_w3");
    expect(card).toHaveTextContent(/Mean CWPM/);
    expect(within(card).getByTestId("dash-rule")).toHaveTextContent(/correct words × 60 ÷ the seconds the child read \(60 at most\)/);
    expect(screen.getByTestId("dash-groups")).toHaveTextContent(/CWPM/);
  });
  it("dashboard OFF: words per minute as before", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, cwpm: false });
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, (_, i) => session(i)) });
    page("/d", "/d", <LeaderAssessDashboard />);
    expect(await screen.findByTestId("dash-orf")).toHaveTextContent(/Words per minute \(median\)/);
    expect(screen.getByTestId("dash-orf").textContent).not.toMatch(/CWPM/);
  });
  it("dashboard ON, Urdu: CWPM isolated in the Urdu label", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSwitches.mockResolvedValue({ realDashboard: true, cwpm: true });
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, (_, i) => session(i)) });
    page("/d", "/d", <LeaderAssessDashboard />);
    expect((await screen.findByTestId("dash-orf")).textContent).toMatch(/⁨CWPM⁩/);
  });
  it("Results ON: the passage's rate reads CWPM; a letters task keeps 'Correct per minute'; the formula is in How", async () => {
    api.getSwitches.mockResolvedValue({ cwpm: true });
    api.getResults.mockResolvedValue(RESULTS);
    page(`/portal/leader/assess/results/${SID}`, "/portal/leader/assess/results/:sessionId", <LeaderAssessResults />);
    const story = await screen.findByTestId("result-task-ur.story_w3");
    expect(await within(story).findByText(/CWPM \(correct words per minute\)/)).toBeInTheDocument();
    const letters = screen.getByTestId("result-task-ur.letter_names5");
    expect(letters).toHaveTextContent(/Correct per minute/);
    expect(letters.textContent).not.toMatch(/CWPM/);
  });
  it("Results OFF (or no switches): as before", async () => {
    api.getSwitches.mockRejectedValue(new Error("down"));
    api.getResults.mockResolvedValue(RESULTS);
    page(`/portal/leader/assess/results/${SID}`, "/portal/leader/assess/results/:sessionId", <LeaderAssessResults />);
    const story = await screen.findByTestId("result-task-ur.story_w3");
    expect(story).toHaveTextContent(/Correct per minute/);
    expect(story.textContent).not.toMatch(/CWPM/);
  });
  it("Review ON: a words task's app score reads CWPM; letters keep 'per minute'", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: true, cwpm: true });
    api.getReview.mockResolvedValue(review());
    page(`/portal/leader/assess/review/${SID}`, "/portal/leader/assess/review/:sessionId", <LeaderAssessReview />);
    expect(await screen.findByTestId("review-task-ur.words4")).toHaveTextContent(/23.1 CWPM/);
    expect(screen.getByTestId("review-task-ur.letter_names5")).toHaveTextContent(/24 per minute/);
  });
});
