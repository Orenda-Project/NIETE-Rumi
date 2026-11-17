import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Round 28 on one session's Results: an extended timed task shows "First N correct: x of N" beside its rate (the
// scorer's first-N anchor), and a tapped task the child heard too few items of says "not rated", with no score.
// Today's rows (no firstN, no unrated) render as before. The network is mocked.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ childTestSa: { getResults: vi.fn() } }));

import { childTestSa } from "../services/api";
import LeaderAssessResults from "./LeaderAssessResults";
import { resultsPath } from "../lib/assess/results";

const api = childTestSa as any;
const SID = "cccccccc-0000-4000-8000-000000000003";
const words = { taskId: "ur.words4", mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "time_up", recording: "scored", score: { correct: 9, per_minute: 9 } };
const pick = { taskId: "ur.letter_pick10", mode: "tap", attempted: 4, correct: 3, optionsN: 5, chanceCorrected: 2.75, itemsPerMin: null, stopReason: "complete", recording: "none", score: null };
const RESULTS = (tasks: any[]) => ({
  status: "ok",
  session: { id: SID, grade: 3, form: "A", block: "B1", status: "completed", startedAt: "2026-10-21T05:00:00Z", endedAt: "2026-10-21T05:20:00Z", lang: "ur" },
  tasks,
});

function renderAt() {
  return render(
    <MemoryRouter initialEntries={[resultsPath(SID)]}>
      <Routes>
        <Route path="/portal/leader/assess/results/:sessionId" element={<LeaderAssessResults />} />
      </Routes>
    </MemoryRouter>,
  );
}
const pairs = (card: HTMLElement) => Array.from(card.querySelectorAll("dt")).map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`);

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
});

describe("LeaderAssessResults: round 28", () => {
  it("a row with firstN shows 'First 5 correct: 4 of 5' beside the rate", async () => {
    api.getResults.mockResolvedValue(RESULTS([{ ...words, firstN: { correct: 4, of: 5 } }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.words4");
    expect(pairs(card)).toContain("First 5 correct: 4 of 5");
    expect(pairs(card)).toContain("Score · Correct per minute: 9");
  });

  it("a row without firstN has no first-N line (today's row as before)", async () => {
    api.getResults.mockResolvedValue(RESULTS([words]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.words4");
    expect(pairs(card).some((p) => p.startsWith("First"))).toBe(false);
  });

  it("Urdu: the first-N line in Urdu", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getResults.mockResolvedValue(RESULTS([{ ...words, firstN: { correct: 4, of: 5 } }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.words4");
    expect(pairs(card)).toContain("پہلے ⁦۵⁩ درست: ⁦۵⁩ میں سے ⁦۴⁩");
  });

  it("a tap row with unrated shows the not-rated line and no score", async () => {
    api.getResults.mockResolvedValue(RESULTS([{ ...pick, unrated: true, presented: 4 }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.letter_pick10");
    expect(within(card).getByText("not rated (too few items heard)")).toBeTruthy();
    const labels = Array.from(card.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(labels).not.toContain("Correct");
    expect(labels).not.toContain("Chance-corrected score");
  });

  it("a rated tap row keeps its correct and chance-corrected rows, and no not-rated line", async () => {
    api.getResults.mockResolvedValue(RESULTS([pick]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.letter_pick10");
    expect(pairs(card)).toContain("Correct: 3");
    expect(within(card).queryByText("not rated (too few items heard)")).toBeNull();
  });
});

describe("LeaderAssessResults: round 28 voice kind", () => {
  const story = { taskId: "ur.story_w3", mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "time_up", recording: "scored", score: { correct: 20 }, secondVoice: true };
  it("help: 'An adult said an answer'; other_child: 'Another child was reading too'", async () => {
    api.getResults.mockResolvedValue(RESULTS([{ ...story, secondVoiceKind: "help" }]));
    const { unmount } = renderAt();
    let card = await screen.findByTestId("result-task-ur.story_w3");
    expect(within(card).getByText("An adult said an answer")).toBeTruthy();
    unmount();
    api.getResults.mockResolvedValue(RESULTS([{ ...story, secondVoiceKind: "other_child" }]));
    renderAt();
    card = await screen.findByTestId("result-task-ur.story_w3");
    expect(within(card).getByText("Another child was reading too")).toBeTruthy();
  });
  it("Urdu copy for both kinds", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getResults.mockResolvedValue(RESULTS([{ ...story, secondVoiceKind: "help" }, { ...story, taskId: "en.story_w3", secondVoiceKind: "other_child" }]));
    renderAt();
    expect(within(await screen.findByTestId("result-task-ur.story_w3")).getByText("ایک بڑے نے جواب بتایا")).toBeTruthy();
    expect(within(screen.getByTestId("result-task-en.story_w3")).getByText("ایک اور بچہ بھی پڑھ رہا تھا")).toBeTruthy();
  });
  it("no kind: today's copy; other_voice: no voice line", async () => {
    api.getResults.mockResolvedValue(RESULTS([story, { ...story, taskId: "en.story_w3", secondVoiceKind: "other_voice" }]));
    renderAt();
    const today = await screen.findByTestId("result-task-ur.story_w3");
    expect(within(today).getByText("Yes: listen before relying on this score")).toBeTruthy();
    const other = screen.getByTestId("result-task-en.story_w3");
    expect(within(other).queryByText("Yes: listen before relying on this score")).toBeNull();
    expect(Array.from(other.querySelectorAll("dt")).map((d) => d.textContent)).not.toContain("Another voice heard");
  });
});
