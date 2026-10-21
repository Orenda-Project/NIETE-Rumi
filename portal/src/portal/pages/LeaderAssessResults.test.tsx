import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// One session's results (/portal/leader/assess/results/:sessionId), behind sa_results_view on the server: the
// session line, one card per task (the SA scale for tap / keypad, "recording kept, scored later" for a spoken
// task), the How scoring works panel, Urdu digits, and "not available" on a 404. The URL carries the session id
// only, never a name. The network is mocked.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ childTestSa: { getResults: vi.fn() } }));

import { childTestSa } from "../services/api";
import LeaderAssessResults from "./LeaderAssessResults";
import { resultsPath } from "../lib/assess/results";

const api = childTestSa as any;
const SID = "cccccccc-0000-4000-8000-000000000003";
const RESULTS = {
  success: true,
  status: "ok",
  session: { id: SID, grade: 3, form: "A", block: "B1", status: "completed", startedAt: "2026-10-21T05:00:00Z", endedAt: "2026-10-21T05:20:00Z", lang: "ur" },
  tasks: [
    { taskId: "ur.letters", mode: "tap", attempted: 24, correct: 18, optionsN: 5, chanceCorrected: 16.5, itemsPerMin: 24, stopReason: "time_up", recording: "none", score: null },
    { taskId: "ma.add1", mode: "keypad", attempted: 9, correct: 7, optionsN: null, chanceCorrected: null, itemsPerMin: 9, stopReason: "complete", recording: "none", score: null },
    { taskId: "ur.story", mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "complete", recording: "scored_later", score: null },
    { taskId: "ur.listening", mode: "oral", attempted: 3, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "complete", recording: "scored", score: { correct: 2 } },
  ],
  // a field the page must never show, should one ever arrive
  name: "Asha Testwala",
};

function renderAt(path = resultsPath(SID)) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/leader/assess/results/:sessionId" element={<LeaderAssessResults />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  api.getResults.mockResolvedValue(RESULTS);
});

describe("LeaderAssessResults", () => {
  it("the path names the session only, and the page asks for that session", async () => {
    expect(resultsPath(SID)).toBe(`/portal/leader/assess/results/${SID}`);
    expect(resultsPath("a/b")).toBe("/portal/leader/assess/results/a%2Fb");
    renderAt();
    await screen.findByTestId("result-task-ur.letters");
    expect(api.getResults).toHaveBeenCalledWith(SID);
  });

  it("renders the session line and one card per task, with the SA scale for a tap task", async () => {
    renderAt();
    const tap = await screen.findByTestId("result-task-ur.letters");
    expect(screen.getByTestId("results-session").textContent).toContain("Grade 3");
    expect(screen.getByTestId("results-session").textContent).toContain("Completed");
    expect(within(tap).getByText("Tap")).toBeTruthy();
    expect(within(tap).getByText("16.5")).toBeTruthy();
    expect(within(tap).getByText("Options per tile")).toBeTruthy();
    expect(within(tap).getByText("Time up")).toBeTruthy();
    const keypad = screen.getByTestId("result-task-ma.add1");
    expect(within(keypad).getByText("Keypad")).toBeTruthy();
    expect(within(keypad).queryByText("Options per tile")).toBeNull();
    expect(screen.getAllByTestId(/^result-task-/)).toHaveLength(4);
  });

  it("a recorded task says the recording is kept and scored later; a scored one shows its score", async () => {
    renderAt();
    const story = await screen.findByTestId("result-task-ur.story");
    expect(within(story).getByText("Recording kept, scored later")).toBeTruthy();
    const listening = screen.getByTestId("result-task-ur.listening");
    expect(within(listening).getByText("Recording scored")).toBeTruthy();
    expect(listening.textContent).toContain("2");
  });

  it("a recorded task with null score fields says scored later and never shows 0", async () => {
    api.getResults.mockResolvedValue({ ...RESULTS, tasks: [
      { taskId: "ur.letter_sounds", mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: null, recording: "scored_later", score: null },
      { taskId: "ur.story_comp", mode: "oral", attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: null, recording: "scored", score: {} },
    ] });
    renderAt();
    const card = await screen.findByTestId("result-task-ur.letter_sounds");
    expect(within(card).getByText("Recording kept, scored later")).toBeTruthy();
    expect(card.textContent).not.toMatch(/0/);
    const comp = screen.getByTestId("result-task-ur.story_comp");
    expect(within(comp).getByText("Recording kept, scored later")).toBeTruthy();
    expect(comp.textContent).not.toMatch(/0/);
  });

  it("the RDF block is named in the header; an unknown block does not break the page", async () => {
    api.getResults.mockResolvedValue({ ...RESULTS, session: { ...RESULTS.session, block: "rdf" } });
    const first = renderAt();
    expect((await screen.findByTestId("results-session")).textContent).toContain("RDF");
    first.unmount();
    window.localStorage.setItem("niete-assess-lang", "ur");
    const second = renderAt();
    expect((await screen.findByTestId("results-session")).textContent).toContain("آر ڈی ایف");
    second.unmount();
    api.getResults.mockResolvedValue({ ...RESULTS, session: { ...RESULTS.session, block: "B9" } });
    renderAt();
    expect((await screen.findByTestId("results-session")).textContent).toContain("B9");
  });

  it("How scoring works opens and closes", async () => {
    renderAt();
    const toggle = await screen.findByRole("button", { name: /How scoring works/ });
    expect(screen.queryByTestId("results-how")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId("results-how").textContent).toMatch(/clpm/);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("results-how")).toBeNull();
  });

  it("Urdu: right to left, Urdu digits for the scores", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    renderAt();
    const tap = await screen.findByTestId("result-task-ur.letters");
    expect(screen.getByTestId("results-root").getAttribute("dir")).toBe("rtl");
    expect(tap.textContent).toContain("۱۶.۵");
    expect(tap.textContent).toContain("۲۴");
    expect(tap.textContent).not.toMatch(/[0-9]/);
    expect(screen.getByText("ریکارڈنگ محفوظ ہے، نمبر بعد میں لگیں گے")).toBeTruthy();
  });

  it("a 404 (switch off, or not this coach's session) → not available", async () => {
    api.getResults.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404, data: { success: false } } }));
    renderAt();
    expect(await screen.findByText("These results are not available.")).toBeTruthy();
    expect(screen.queryByTestId(/^result-task-/)).toBeNull();
  });

  it("another failure → try again, which reloads", async () => {
    api.getResults.mockRejectedValueOnce(Object.assign(new Error("Network Error"), { request: {} }));
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /Try again/ }));
    expect(await screen.findByTestId("result-task-ur.letters")).toBeTruthy();
    expect(api.getResults).toHaveBeenCalledTimes(2);
  });

  it("never shows a name", async () => {
    const { container } = renderAt();
    await screen.findByTestId("result-task-ur.letters");
    expect(container.textContent).not.toContain("Testwala");
  });

  it("each task is headed by its name in the page's language, the code small underneath; no name, the code alone", async () => {
    const titled = { ...RESULTS, tasks: [{ ...RESULTS.tasks[1], title: { en: "Addition, quick", ur: "جمع، فوری" } }, RESULTS.tasks[0]] };
    api.getResults.mockResolvedValue(titled);
    const { unmount } = renderAt();
    const add = await screen.findByTestId("result-task-ma.add1");
    expect(within(add).getByRole("heading")).toHaveTextContent("Addition, quick");
    expect(within(add).getByRole("heading")).not.toHaveTextContent("ma.add1");
    expect(within(add).getByTestId("result-task-id")).toHaveTextContent("ma.add1");
    expect(within(screen.getByTestId("result-task-ur.letters")).getByRole("heading")).toHaveTextContent("ur.letters");
    unmount();
    window.localStorage.setItem("niete-assess-lang", "ur");
    renderAt();
    expect(within(await screen.findByTestId("result-task-ma.add1")).getByRole("heading")).toHaveTextContent("جمع، فوری");
  });

  it("a skipped task (sandbox Jump, level 2, no mic) names how it ended and shows no counts, never 0 or None", async () => {
    api.getResults.mockResolvedValue({ ...RESULTS, tasks: [
      { taskId: "ma.number_id", mode: "tap", attempted: 0, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "skipped_dev", recording: "none", score: null },
      { taskId: "ma.sub2", mode: "keypad", attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "skipped_level2", recording: "none", score: null },
      { taskId: "ur.story", mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "mic_unavailable", recording: "none", score: null },
    ] });
    renderAt();
    const dev = await screen.findByTestId("result-task-ma.number_id");
    expect(within(dev).getByText("Skipped (sandbox Jump)")).toBeTruthy();
    expect(dev.textContent).not.toContain("skipped_dev");
    for (const id of ["ma.number_id", "ma.sub2", "ur.story"]) {
      const card = screen.getByTestId(`result-task-${id}`);
      expect(within(card).queryByText("Attempted")).toBeNull();
      expect(within(card).queryByText("Options per tile")).toBeNull();
      expect(within(card).queryByText("None")).toBeNull();
      expect(within(card).queryByText("Recording kept, scored later")).toBeNull();
    }
    expect(within(screen.getByTestId("result-task-ma.sub2")).getByText("Skipped")).toBeTruthy();
    expect(within(screen.getByTestId("result-task-ur.story")).getByText("No microphone")).toBeTruthy();
  });

  it("Urdu: the sandbox Jump skip reads in Urdu", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getResults.mockResolvedValue({ ...RESULTS, tasks: [
      { taskId: "ma.number_id", mode: "tap", attempted: 0, correct: null, optionsN: null, chanceCorrected: null, itemsPerMin: null, stopReason: "skipped_dev", recording: "none", score: null },
    ] });
    renderAt();
    const dev = await screen.findByTestId("result-task-ma.number_id");
    expect(within(dev).getByText("چھوڑ دیا گیا (سینڈ باکس جمپ)")).toBeTruthy();
  });

  it("a row's label never wraps beside a long value: the label keeps its width", async () => {
    renderAt();
    const tap = await screen.findByTestId("result-task-ur.letters");
    expect(within(tap).getByText("How it ended").className).toContain("shrink-0");
  });
});
