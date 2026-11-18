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

  it("O-46: a picker the coach ended early says 'not rated (ended early)', no score, no too-few line", async () => {
    api.getResults.mockResolvedValue(RESULTS([{ ...pick, attempted: 7, correct: 7, stopReason: "end_section", unrated: true, unratedWhy: "ended", presented: 7, ofAll: 10 }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.letter_pick10");
    expect(pairs(card)).toContain("Score: not rated (ended early)");
    expect(within(card).queryByText("not rated (too few items heard)")).toBeNull();
    const labels = Array.from(card.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(labels).not.toContain("Correct");
    expect(labels).not.toContain("Chance-corrected score");
  });

  it("O-46 Urdu: the ended line in Urdu", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getResults.mockResolvedValue(RESULTS([{ ...pick, stopReason: "coach_end", unrated: true, unratedWhy: "ended", presented: 9, ofAll: 10 }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.letter_pick10");
    expect(within(card).getByText("درجہ نہیں (جلد ختم کر دیا گیا)")).toBeTruthy();
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
  it("help: 'An adult helped with the answer' with the footnote; other_child: 'Another child was reading too' with the footnote", async () => {
    api.getResults.mockResolvedValue(RESULTS([{ ...story, secondVoiceKind: "help" }]));
    const { unmount } = renderAt();
    let card = await screen.findByTestId("result-task-ur.story_w3");
    expect(within(card).getByText("An adult helped with the answer")).toBeTruthy();
    expect(within(card).queryByText("An adult said an answer")).toBeNull();
    expect(within(card).getByTestId("result-voice-note")).toHaveTextContent("A second child reading along is not yet caught.");
    unmount();
    api.getResults.mockResolvedValue(RESULTS([{ ...story, secondVoiceKind: "other_child" }]));
    renderAt();
    card = await screen.findByTestId("result-task-ur.story_w3");
    expect(within(card).getByText("Another child was reading too")).toBeTruthy();
    expect(within(card).getByTestId("result-voice-note")).toHaveTextContent("A second child reading along is not yet caught.");
  });
  it("Urdu copy for both kinds, with the footnote", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getResults.mockResolvedValue(RESULTS([{ ...story, secondVoiceKind: "help" }, { ...story, taskId: "en.story_w3", secondVoiceKind: "other_child" }]));
    renderAt();
    const ur = await screen.findByTestId("result-task-ur.story_w3");
    expect(within(ur).getByText("کسی بڑے نے جواب میں مدد کی")).toBeTruthy();
    expect(within(ur).getByTestId("result-voice-note")).toHaveTextContent("ساتھ پڑھنے والا دوسرا بچہ ابھی پکڑا نہیں جاتا۔");
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
    expect(screen.queryByTestId("result-voice-note")).toBeNull();
  });
});

// Round 28 (SPEC F): beside a tapped score, the share of children who reach its rung by guessing alone, and the
// child's own taps before the sound. Text only; today's tap and spoken rows get neither.
describe("LeaderAssessResults: round 28 guessing floor and tap-before-sound", () => {
  const pick10 = { ...pick, attempted: 10, correct: 8 };
  const mcq = { ...pick, taskId: "ur.story_mcq_w3", attempted: 6, correct: 5, optionsN: 4 };

  it("the picker card: the floor line for 8 and 6 of 10, and 'Taps before the sound: 1 of 10'", async () => {
    api.getResults.mockResolvedValue(RESULTS([{ ...pick10, tapBeforeSound: { n: 1, of: 10 } }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.letter_pick10");
    expect(within(card).getByTestId("result-guess-floor").textContent).toBe("By guessing alone, 0.008% of children reach 8 of 10 (0.6% reach 6 of 10).");
    expect(pairs(card)).toContain("Taps before the sound: 1 of 10");
  });

  it("the MCQ card: 3.8% reach 4 of 6; no tap count when the row has none", async () => {
    api.getResults.mockResolvedValue(RESULTS([mcq]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.story_mcq_w3");
    expect(within(card).getByTestId("result-guess-floor").textContent).toBe("By guessing alone, 3.8% of children reach 4 of 6.");
    expect(pairs(card).some((p) => p.startsWith("Taps before"))).toBe(false);
  });

  it("Urdu: the floor line and the tap count in Urdu", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getResults.mockResolvedValue(RESULTS([{ ...mcq, tapBeforeSound: { n: 2, of: 6 } }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.story_mcq_w3");
    expect(within(card).getByTestId("result-guess-floor").textContent).toBe("صرف اندازے سے ⁦۳.۸%⁩ بچے ⁦۶⁩ میں سے ⁦۴⁩ تک پہنچتے ہیں۔");
    expect(pairs(card)).toContain("آواز سے پہلے ٹیپ: ⁦۶⁩ میں سے ⁦۲⁩");
  });

  it("an unrated tapped row, today's tap row and a spoken row have no floor line", async () => {
    api.getResults.mockResolvedValue(RESULTS([
      { ...pick, unrated: true, presented: 4 },
      { ...pick, taskId: "ur.letter_names5", attempted: 5, correct: 4 },
      words,
    ]));
    renderAt();
    await screen.findByTestId("result-task-ur.letter_pick10");
    expect(screen.queryByTestId("result-guess-floor")).toBeNull();
  });
});

// Round 28 (lead ruling): the floor is read on the items this child actually had (presented / 6 − lost), the same
// denominator the share divides by.
describe("LeaderAssessResults: the floor on the items the child had", () => {
  it("a picker row with 9 presented reads 8 of 9 (and 6 of 9), never 8 of 10", async () => {
    api.getResults.mockResolvedValue(RESULTS([{ ...pick, attempted: 9, correct: 8, presented: 9 }]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.letter_pick10");
    expect(within(card).getByTestId("result-guess-floor").textContent).toBe("By guessing alone, 0.002% of children reach 8 of 9 (0.3% reach 6 of 9).");
  });
  it("an MCQ row with 2 lost clips reads 3 of 4 (5.1%); with 1 lost, 4 of 5 (1.6%)", async () => {
    const mcq = { ...pick, taskId: "ur.story_mcq_w3", attempted: 4, correct: 3, optionsN: 4 };
    api.getResults.mockResolvedValue(RESULTS([{ ...mcq, unavailable: 2 }, { ...mcq, taskId: "en.story_mcq_w3", unavailable: 1 }]));
    renderAt();
    const two = await screen.findByTestId("result-task-ur.story_mcq_w3");
    expect(within(two).getByTestId("result-guess-floor").textContent).toBe("By guessing alone, 5.1% of children reach 3 of 4.");
    expect(within(screen.getByTestId("result-task-en.story_mcq_w3")).getByTestId("result-guess-floor").textContent).toBe("By guessing alone, 1.6% of children reach 4 of 5.");
  });
});

// Round 28 (lead ruling): the MCQ on a 5-question story variant is read out of 5 (ofAll), never the spec's 6.
describe("LeaderAssessResults: the MCQ on the served variant's questions", () => {
  it("a 5-question variant (ofAll 5) reads 4 of 5 (1.6%), never 4 of 6", async () => {
    const mcq = { ...pick, taskId: "ur.story_mcq_w3", attempted: 5, correct: 4, optionsN: 4, presented: 5, ofAll: 5 };
    api.getResults.mockResolvedValue(RESULTS([mcq]));
    renderAt();
    const card = await screen.findByTestId("result-task-ur.story_mcq_w3");
    expect(within(card).getByTestId("result-guess-floor").textContent).toBe("By guessing alone, 1.6% of children reach 4 of 5.");
  });
});
