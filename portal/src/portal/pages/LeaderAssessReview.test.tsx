import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The visit review (/portal/leader/assess/review and …/review/:sessionId), behind sa_review_page. The list is the
// dashboard's own read (sa/sessions); a child opens task by task with the recordings, the app's and the agents' marks
// per item, a suspect flag, and the reviewer's own mark per item saved to the server. Never a name.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  childTestSa: { getSwitches: vi.fn(), getSessions: vi.fn(), getReview: vi.fn(), markReviewItem: vi.fn() },
}));

import { childTestSa } from "../services/api";
import LeaderAssessReview from "./LeaderAssessReview";

const api = childTestSa as any;
const SID = "cccccccc-0000-4000-8000-000000000003";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/leader/assess/review" element={<LeaderAssessReview />} />
        <Route path="/portal/leader/assess/review/:sessionId" element={<LeaderAssessReview />} />
      </Routes>
    </MemoryRouter>,
  );
}

const session = (id: string, minutes: number, grade = 3) => ({
  schoolId: "sch-1", schoolName: "School One", sector: "Urban-I", grade,
  results: {
    session: { id, grade, form: "A", block: "rdf_auto", status: "completed", startedAt: "2026-10-23T04:00:00Z", endedAt: new Date(Date.parse("2026-10-23T04:00:00Z") + minutes * 60000).toISOString(), lang: "ur" },
    tasks: [],
  },
});

const review = () => ({
  session: { id: SID, grade: 3, block: "rdf_auto", status: "completed", startedAt: "2026-10-23T04:00:00Z", endedAt: "2026-10-23T04:36:00Z", minutes: 36 },
  fixAt: "2026-10-22T06:37:45Z",
  tasks: [
    {
      taskId: "ur.words4", mode: "record", timeUsedS: 7.8, app: { correct: 3, attempted: 4, of: null, perMinute: null },
      scoredAt: "2026-10-23T04:06:00Z", scoredAfterFix: true,
      clips: [{ label: "ur.words4", url: "https://r2.example/a.webm?sig=1" }],
      items: [
        { key: "1", ref: "گھر", app: { verdict: "correct", conf: 0.9, noSpeech: false }, agents: { consensus: "c", flash: "c", pro: "c", stt: "c", confidence: 0.95, noSpeech: false, disputed: false, lowTrust: false }, suspect: false, ear: { mark: "correct", note: null, at: "2026-10-23T09:00:00Z", mine: true }, appRight: "right" },
        { key: "2", ref: "آم", app: { verdict: "correct", conf: 0.8, noSpeech: true }, agents: { consensus: "s", flash: null, pro: null, stt: null, confidence: 0, noSpeech: true, disputed: false, lowTrust: false }, suspect: true, ear: null, appRight: null },
      ],
      agreement: { reviewed: 1, earAgreesWithApp: 1, agentsAgreeWithApp: 1, withAgents: 2 },
    },
    {
      taskId: "ma.missing4", mode: "keypad", timeUsedS: 7.5, app: { correct: 2, attempted: 4, of: null, perMinute: null },
      scoredAt: null, scoredAfterFix: null, clips: [], items: [], agreement: { reviewed: 0, earAgreesWithApp: 0, agentsAgreeWithApp: 0, withAgents: 0 },
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
});

describe("LeaderAssessReview", () => {
  it("switch off: not available, and nothing is read", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: false });
    renderAt(`/portal/leader/assess/review/${SID}`);
    expect(await screen.findByTestId("review-off")).toBeInTheDocument();
    expect(api.getReview).not.toHaveBeenCalled();
  });

  it("the list: one row per child by short id (no names), minutes against the 30–45 target, each opening its review", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: true, realDashboard: true });
    api.getSessions.mockResolvedValue({ sessions: [session("aaaaaaaa-1111-4000-8000-000000000001", 20), session("bbbbbbbb-1111-4000-8000-000000000002", 38, 5), session("cccccccc-1111-4000-8000-000000000003", 52)] });
    renderAt("/portal/leader/assess/review");
    const rows = await screen.findAllByTestId("review-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("aaaaaaaa");
    expect(rows.map((r) => r.getAttribute("data-band"))).toEqual(["under", "in", "over"]);
    expect(within(rows[1]).getByRole("link")).toHaveAttribute("href", "/portal/leader/assess/review/bbbbbbbb-1111-4000-8000-000000000002");
    expect(screen.getByTestId("review-no-name")).toHaveTextContent(/Never type a child's name/);
  });

  it("a child: per task the time, the app score, before/after the fix, the recordings (no download) and the agreement", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: true });
    api.getReview.mockResolvedValue(review());
    renderAt(`/portal/leader/assess/review/${SID}`);
    const words = await screen.findByTestId("review-task-ur.words4");
    expect(words).toHaveTextContent(/7.8 s/);
    expect(words).toHaveTextContent(/Scored after the scorer fix/);
    const audio = words.querySelector("audio") as HTMLAudioElement;
    expect(audio.getAttribute("src")).toBe("https://r2.example/a.webm?sig=1");
    expect(audio.getAttribute("controlslist")).toMatch(/nodownload/);
    expect(words.querySelector("a[download]")).toBeNull();
    expect(within(words).getByTestId("review-agreement")).toHaveTextContent(/1 of 1 marked/);
    expect(screen.getByTestId("review-task-ma.missing4")).toHaveTextContent(/No recording/);
    expect(api.getReview).toHaveBeenCalledWith(SID);
  });

  it("a task where the scorer heard another voice says so on its card (EN + UR); others do not", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: true });
    const r = review();
    (r.tasks[0] as any).secondVoice = true;
    api.getReview.mockResolvedValue(r);
    const { unmount } = renderAt(`/portal/leader/assess/review/${SID}`);
    const words = await screen.findByTestId("review-task-ur.words4");
    expect(within(words).getByTestId("review-second-voice")).toHaveTextContent(/Another person's voice was heard/);
    expect(within(screen.getByTestId("review-task-ma.missing4")).queryByTestId("review-second-voice")).toBeNull();
    unmount();
    window.localStorage.setItem("niete-assess-lang", "ur");
    renderAt(`/portal/leader/assess/review/${SID}`);
    expect(within(await screen.findByTestId("review-task-ur.words4")).getByTestId("review-second-voice")).toHaveTextContent(/کسی اور کی آواز/);
  });

  it("per item: the app's and the agents' marks, the suspect flag, and the ear's mark with the derived verdict", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: true });
    api.getReview.mockResolvedValue(review());
    renderAt(`/portal/leader/assess/review/${SID}`);
    const items = await screen.findAllByTestId("review-item");
    expect(items[0]).toHaveTextContent(/The app scored it right/);
    expect(within(items[1]).getByTestId("review-suspect")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent(/silent/);
    expect(within(items[0]).queryByTestId("review-suspect")).toBeNull();
  });

  it("marking an item saves the ear's mark and note, and shows the derived verdict", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: true });
    api.getReview.mockResolvedValue(review());
    api.markReviewItem.mockResolvedValue({ status: "ok" });
    renderAt(`/portal/leader/assess/review/${SID}`);
    const item = (await screen.findAllByTestId("review-item"))[1];
    fireEvent.click(within(item).getByTestId("review-mark-wrong"));
    fireEvent.change(within(item).getByTestId("review-note"), { target: { value: "no voice on the clip" } });
    fireEvent.click(within(item).getByTestId("review-save"));
    await waitFor(() => expect(api.markReviewItem).toHaveBeenCalledWith(SID, { taskId: "ur.words4", itemKey: "2", mark: "wrong", note: "no voice on the clip" }));
    expect(await within(item).findByTestId("review-saved")).toBeInTheDocument();
    expect(item).toHaveTextContent(/The app scored it wrong/);
    expect((within(item).getByTestId("review-note") as HTMLTextAreaElement).maxLength).toBe(500);
  });

  it("the server refuses a note with the child's name: says so, and keeps the note for editing", async () => {
    api.getSwitches.mockResolvedValue({ reviewPage: true });
    api.getReview.mockResolvedValue(review());
    api.markReviewItem.mockRejectedValue({ response: { status: 400, data: { status: "invalid", reason: "name_in_note" } } });
    renderAt(`/portal/leader/assess/review/${SID}`);
    const item = (await screen.findAllByTestId("review-item"))[1];
    fireEvent.click(within(item).getByTestId("review-mark-correct"));
    fireEvent.change(within(item).getByTestId("review-note"), { target: { value: "x read it" } });
    fireEvent.click(within(item).getByTestId("review-save"));
    expect(await within(item).findByTestId("review-error")).toHaveTextContent(/Remove the child's name/);
    expect((within(item).getByTestId("review-note") as HTMLTextAreaElement).value).toBe("x read it");
  });

  it("Urdu: headings in Urdu with Urdu digits", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSwitches.mockResolvedValue({ reviewPage: true });
    api.getReview.mockResolvedValue(review());
    renderAt(`/portal/leader/assess/review/${SID}`);
    const words = await screen.findByTestId("review-task-ur.words4");
    expect(words.textContent).toMatch(/[۰-۹]/);
    expect(screen.getByTestId("review-no-name")).toHaveTextContent(/کبھی کسی بچے کا نام/);
  });
});
