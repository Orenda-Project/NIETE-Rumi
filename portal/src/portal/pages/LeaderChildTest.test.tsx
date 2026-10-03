import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-s1oo0.7 — the child-test page: flag gate, the server's list, present →
// the first block's card, absent → back to the updated list, and the check
// form once Rumi's marks are in. The network (services/api) is mocked.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/recordingSupport", async (orig) => ({ ...(await orig<any>()), canRecordHere: vi.fn(async () => true) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTest: {
    getVisits: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getSession: vi.fn(), getCard: vi.fn(),
    presignBlockUpload: vi.fn(), uploadToR2: vi.fn(), registerBlockMedia: vi.fn(), submitCheck: vi.fn(),
  },
}));

import { portal, childTest } from "../services/api";
import LeaderChildTest from "./LeaderChildTest";

const api = childTest as any;
const child = (n: number, extra: any = {}) => ({
  drawId: `d${n}`, studentId: `st${n}`, rollNumber: String(10 + n), displayName: `Child ${n}`, role: n === 5 ? "returning" : "new", form: "A", status: "listed",
  classLabel: n % 2 ? "Grade 3 - A" : "Grade 3 - B", classLabelUr: n % 2 ? "جماعت سوم - A" : "جماعت سوم - B", classShort: n % 2 ? "3-A" : "3-B",
  teacherName: n % 2 ? "Saima Bibi" : null, namesakes: 1, ...extra,
});
const LIST = { cycleId: "ICT-2026-Q4", grade: 3, classId: "c1", children: [1, 2, 3, 4, 5].map((n) => child(n)), alternates: [child(6), child(7)] };
const urduCard = {
  block: "urdu", grade: 3, form: "A", timedSeconds: 60, cue: { start: "اب شروع کریں", stop: "بس" },
  child: { story: { id: "s", title: null, text: "آج بلال دریا گیا۔" }, nonwords: [], fallback: null },
  coach: { questions: [{ id: "q1", prompt: "سوال؟" }], firstSounds: [] },
};
const card = (block: string) => (block === "maths"
  ? { block, grade: 3, form: "A", timedSeconds: 60, cue: { start: null, stop: null }, child: { numbers: [6], quickSums: ["1 + 1"], written: ["2 + 2"] }, coach: { numbersStopRule: null, numberIds: ["n1"], writtenIds: ["w1"], wordProblem: null } }
  : { ...urduCard, block });

function renderPage() {
  return render(<MemoryRouter><LeaderChildTest /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.setItem("niete-child-test-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTest: true } });
  api.getVisits.mockResolvedValue({ visits: [{ visitId: "v1", startedAt: "2026-10-02T05:00:00Z", sealed: false, schoolId: "sch", schoolName: "IMCB G-10/4", observedGrade: 3 }] });
  api.getList.mockResolvedValue({ list: LIST });
  api.getCard.mockImplementation(async (_s: string, b: string) => ({ card: card(b) }));
});

describe("LeaderChildTest", () => {
  it("is off without the flag and calls nothing", async () => {
    (portal.getConfig as any).mockResolvedValue({ features: { childTest: false } });
    renderPage();
    expect(await screen.findByText(/not on for your account/)).toBeInTheDocument();
    expect(api.getVisits).not.toHaveBeenCalled();
  });

  it("opens today's only visit straight to Rumi's list of five, returning child marked", async () => {
    renderPage();
    expect(await screen.findByText("Child 1")).toBeInTheDocument();
    expect(api.getList).toHaveBeenCalledWith("v1");
    expect(screen.getAllByText("Returning")).toHaveLength(1);
    // Alternates by name and room, never by roll (L25).
    expect(screen.getByText("Child 6 (3-B) · Child 7 (3-A)")).toBeInTheDocument();
  });

  it("names each child by room and class teacher, and shows no roll anywhere (L25)", async () => {
    const twins = { ...LIST, children: [child(1, { namesakes: 2, fatherTellsApart: true, fatherName: "Ahmed Raza" }), child(2, { namesakes: 2 }), child(3), child(4), child(5)] };
    api.getList.mockResolvedValue({ list: twins });
    const { container } = renderPage();
    expect(await screen.findByText("Child 1")).toBeInTheDocument();
    expect(screen.getAllByText("Grade 3 - A · Teacher: Saima Bibi").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Grade 3 - B").length).toBeGreaterThan(0);
    expect(screen.getByText("father: Ahmed Raza · Grade 3 - A · Teacher: Saima Bibi")).toBeInTheDocument();
    expect(screen.getByText("2 in this class · Grade 3 - B")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/roll|رول|1[1-7]/i);
    fireEvent.click(screen.getByTestId("child-d1"));
    expect(await screen.findByText("father: Ahmed Raza · Grade 3 - A · Teacher: Saima Bibi")).toBeInTheDocument();
    expect(screen.getByText("Is this child here?")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/roll|رول|1[1-7]/i);
  });

  it("present opens the Urdu block with the card; absent goes back to the list", async () => {
    api.markOutcome.mockResolvedValueOnce({ sessionId: "s1", list: LIST });
    renderPage();
    fireEvent.click(await screen.findByTestId("child-d1"));
    fireEvent.click(screen.getByRole("button", { name: "Present — start" }));
    expect(await screen.findByTestId("story-text")).toHaveTextContent("آج بلال دریا گیا۔");
    expect(api.markOutcome).toHaveBeenCalledWith({ visitId: "v1", drawId: "d1", outcome: "present" });
    expect(screen.getByText("Part 1 of 3")).toBeInTheDocument();
  });

  it("absent records the outcome and shows the updated list", async () => {
    const updated = { ...LIST, children: [child(2), child(3), child(4), child(5), child(6)], alternates: [child(7), child(8)] };
    api.markOutcome.mockResolvedValueOnce({ list: updated });
    // the server's list for this visit, before and after the outcome (it is idempotent per visit)
    api.getList.mockResolvedValueOnce({ list: LIST }).mockResolvedValue({ list: updated });
    renderPage();
    fireEvent.click(await screen.findByTestId("child-d1"));
    fireEvent.click(screen.getByRole("button", { name: "Absent" }));
    expect(await screen.findByText("Child 6")).toBeInTheDocument();
    expect(screen.queryByText("Child 1")).not.toBeInTheDocument();
  });

  it("a tested child opens the check; a scored block shows the form, a pending one says marks are coming", async () => {
    api.getList.mockResolvedValue({ list: { ...LIST, children: [child(1, { status: "tested", sessionId: "s1", sessionStatus: "in_progress" }), ...LIST.children.slice(1)] } });
    api.getSession.mockResolvedValue({
      session: { id: "s1", status: "in_progress", grade: 3, form: "A" }, thresholdsSource: "default",
      blocks: [
        { block: "urdu", hasAudio: true, hasPhoto: false, aiStatus: "scored", aiReason: null, checked: false,
          prefill: { version: "ai-marks-v1", story: { words_correct: 30, flagged: [], uncertain: [] }, questions: [{ id: "q1", verdict: "correct", hint: null }], first_sounds: [], nonwords: [] } },
        { block: "english", hasAudio: true, hasPhoto: false, aiStatus: "scoring", aiReason: null, checked: false, prefill: null },
        { block: "maths", hasAudio: false, hasPhoto: false, aiStatus: null, aiReason: null, checked: false, prefill: null },
      ],
    });
    api.submitCheck.mockResolvedValue({ edits: 0, allChecked: false });
    renderPage();
    fireEvent.click(await screen.findByTestId("child-d1"));
    expect(await screen.findByTestId("check-urdu")).toBeInTheDocument();
    expect(screen.getByTestId("words-correct")).toHaveValue(30);
    expect(screen.getByText(/Marks are being prepared/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the recording/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.submitCheck).toHaveBeenCalledWith("s1", expect.objectContaining({ block: "urdu" })));
    const marks = api.submitCheck.mock.calls[0][1].coachMarks;
    expect(marks.story.words_correct).toBe(30);
    expect(marks.questions[0]).toMatchObject({ id: "q1", verdict: "correct" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("the check will not save while an item is empty", async () => {
    api.getList.mockResolvedValue({ list: { ...LIST, children: [child(1, { status: "tested", sessionId: "s1" })] } });
    api.getSession.mockResolvedValue({
      session: { id: "s1", status: "in_progress", grade: 3, form: "A" }, thresholdsSource: "default",
      blocks: [{ block: "urdu", hasAudio: true, hasPhoto: false, aiStatus: "scored", aiReason: null, checked: false,
        prefill: { version: "ai-marks-v1", story: { words_correct: null, flagged: [], uncertain: [] }, questions: [{ id: "q1", verdict: null, hint: "wrong" }], first_sounds: [], nonwords: [] } }],
    });
    renderPage();
    fireEvent.click(await screen.findByTestId("child-d1"));
    expect(await screen.findByText("Rumi thinks: Wrong")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Please answer every item.")).toBeInTheDocument();
    expect(api.submitCheck).not.toHaveBeenCalled();
  });

  it("Urdu is the default language for the coach", async () => {
    try { window.localStorage.removeItem("niete-child-test-lang"); } catch { /* none */ }
    api.getList.mockResolvedValue({ list: { ...LIST, children: [child(1, { displayNameUrdu: "بچہ الف" }), ...LIST.children.slice(1)] } });
    renderPage();
    expect(await screen.findByText(/آج کے بچے/)).toBeInTheDocument();
    // the roster's Urdu name when it has one (CONTRACT v0.8 §13 CR-L3-3), else the English one
    expect(screen.getByText("بچہ الف")).toBeInTheDocument();
    expect(screen.getByText("Child 2")).toBeInTheDocument();
  });
});
